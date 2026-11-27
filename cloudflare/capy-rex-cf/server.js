import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createSetupServer } from './nas/setup.mjs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import worker, { bootstrap,parseMeta,isEncrypted } from './worker.js';
import { isHomeUpload } from './home-configs.js';
import {createRestoreJobs,restoreRoute,RESTORE_ROOT} from './restore-jobs.js';
import { SQLiteKV } from './kv.js';
import { SQLiteD1, upgradeBackup } from './storage.js';
import { createPublicFetch } from './network.js';
import { createSourcePolicy } from './remote.js';
import { createCommunity } from './nas/community.mjs';

function publicOrigin(value) {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL must be an HTTP(S) origin, e.g. https://rex.example.com');
  }
  return url.origin;
}

export async function createHubServer(config = process.env, { remoteFetch } = {}) {
  const skipBackup = config.SKIP_UPGRADE_BACKUP ?? 'false';
  if (!['', 'true', 'false'].includes(skipBackup)) throw new Error('SKIP_UPGRADE_BACKUP must be true or false');
  const addressCheck = config.SOURCE_ADDRESS_CHECK ?? 'true';
  if (!['', 'true', 'false'].includes(addressCheck)) throw new Error('SOURCE_ADDRESS_CHECK must be true or false');
  const sourcePolicy = createSourcePolicy(config.TRUSTED_SOURCE_ORIGINS || '', {addressCheck:addressCheck !== 'false'});
  if (!sourcePolicy.addressCheck) console.warn('WARNING: SOURCE_ADDRESS_CHECK=false; source downloads may access private, loopback and reserved addresses. TLS verification and download limits remain enabled. Use trusted sources only.');
  const directory = resolve(config.DATA_DIR || './data');
  const kv = new SQLiteKV(resolve(directory, 'rex.sqlite'));
  let restoreJobs;
  try {
    const DB = new SQLiteD1(kv.db, kv.gate);
    const hasSettings = kv.db.prepare("SELECT 1 FROM sqlite_master WHERE name='settings' AND type='table'").get();
    const password = hasSettings && await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_password').first();
    if (!password && !await kv.get('admin_password') && (!config.ADMIN_SECRET || config.ADMIN_SECRET.length < 4)) {
      throw new Error('尚未初始化：请先运行 node nas/init.mjs（本地终端隐藏输入密码）');
    }
    const origin = publicOrigin(config.PUBLIC_URL);
    const trustProxy = config.TRUST_PROXY === 'true';
    // NAS origins are explicit deployment configuration. Never infer HTTPS or
    // another host from arbitrary forwarded headers supplied by a client.
    const allowedOrigins = [...new Set([origin,...(config.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean).map(publicOrigin)].filter(Boolean))];
    if(config.NAS_MODE==='true' && allowedOrigins.length && new Set(allowedOrigins.map(v=>new URL(v).host)).size!==allowedOrigins.length)
      throw Error('NAS 每个主机只能配置一种访问协议');
    const shutdown = new AbortController();
    const env = { KV: kv, DB, ADMIN_PASSWORD: config.ADMIN_SECRET,
      REMOTE_FETCH: remoteFetch ?? createPublicFetch(sourcePolicy), SOURCE_URL_POLICY: sourcePolicy,
      SHUTDOWN_SIGNAL: shutdown.signal, ATOMIC: work => kv.transaction(work), NAS_MODE:config.NAS_MODE==='true' };
    const alreadyV2 = hasSettings && await DB.prepare('SELECT value FROM settings WHERE key=?').bind('docker_v2').first();
    const alreadyV3=hasSettings&&await DB.prepare("SELECT value FROM settings WHERE key='docker_v3'").first();
    const alreadyV31=hasSettings&&await DB.prepare("SELECT value FROM settings WHERE key='docker_v31'").first();
    const alreadyV32=hasSettings&&await DB.prepare("SELECT value FROM settings WHERE key='docker_v32'").first();
    const alreadyV33=hasSettings&&await DB.prepare("SELECT value FROM settings WHERE key='docker_v33'").first();
    if (skipBackup === 'true') console.warn('WARNING: SKIP_UPGRADE_BACKUP=true; no pre-upgrade SQLite snapshot will be created. Migration remains transactional.');
    const backup = skipBackup === 'true' ? null : upgradeBackup(kv, directory, alreadyV33?{marker:'docker_v35',prefix:'pre-v35',full:true}:alreadyV32?{marker:'docker_v33',prefix:'pre-v33',full:true}:alreadyV31?{marker:'docker_v32',prefix:'pre-v32',full:true}:alreadyV3?{marker:'docker_v31',prefix:'pre-v31',full:true}:alreadyV2 ? { marker:'docker_v3',prefix:'pre-v3',full:true }
      : { marker:'docker_v3',prefix:'pre-v3',full:!!hasSettings });
    if (backup) console.log('Upgrade backup:', backup);
    await kv.transaction(async () => {
      await bootstrap(env);
      for (const key of ['docker_v2','docker_v21','docker_v3','docker_v31','docker_v32','docker_v33','docker_v35']) await DB.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)')
        .bind(key,String(Date.now())).run();
      await DB.prepare("UPDATE subscription_sources SET lease_until=0,lease_token='' WHERE lease_until<>0").run();
      await DB.prepare('DELETE FROM module_write_locks').run();
      await DB.prepare("UPDATE icon_sources SET lease_until=0,lease_token='' WHERE lease_until<>0").run();
    });
    restoreJobs=await createRestoreJobs(env,resolve(directory,'rex.sqlite'),{parseMeta,isEncrypted});
    const community = config.NAS_MODE === 'true' ? await createCommunity(env) : null;
    const maxBody = 128 * 1024 * 1024;
    let queued = 0, shuttingDown = false, scheduledJob = null, maintenanceAt=0;
    const requests = new Set();
    function kick() {
      if(shuttingDown || scheduledJob || config.DISABLE_SCHEDULER==='true')return scheduledJob;
      scheduledJob=(async()=>{
        if(Date.now()<maintenanceAt){
          const due=await DB.prepare(`SELECT 1 FROM subscription_sources WHERE enabled=1 AND lease_until<?
            AND (status='syncing' OR next_sync_at<=?) LIMIT 1`).bind(Date.now(),Date.now()).first();
          const iconsDue=await DB.prepare('SELECT 1 FROM icon_sources WHERE enabled=1 AND next_sync_at<=? AND lease_until<? LIMIT 1').bind(Date.now(),Date.now()).first();
          if(!due&&!iconsDue)return;
        }
        maintenanceAt=Date.now()+60000;
        const jobs=[];
        await worker.scheduled({},env,{waitUntil:p=>jobs.push(p)});
        await Promise.all(jobs);
        await kv.cleanup();
      })().catch(error=>{ if(!shuttingDown)console.error('Scheduler:',error.message); })
        .finally(()=>{scheduledJob=null;});
      return scheduledJob;
    }
    // Durable cursor batches continue once per second; a completed source waits
    // its persisted six-hour deadline. The timer never holds a DB transaction.
    const timer=setInterval(kick,1000);timer.unref();
    const server = createServer(async (incoming, outgoing) => {
      let requestPath='';
      try {
        if (incoming.url === '/healthz' && incoming.method === 'GET') {
          await DB.prepare('SELECT 1').first();
          outgoing.writeHead(200, { 'Content-Type': 'application/json' });
          outgoing.end('{"ok":true}');
          return;
        }
        if (queued >= 64 && !incoming.url.startsWith(RESTORE_ROOT+'/jobs/')) {
          outgoing.writeHead(503, { 'Retry-After': '5' });
          outgoing.end('Server busy');
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const first = (name) => headers.get(name)?.split(',')[0].trim();
        const protocol = trustProxy && first('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const host = (trustProxy && first('x-forwarded-host')) || headers.get('host') || 'localhost';
        let base = origin || publicOrigin(`${protocol}://${host}`);
        if(community){
          const directHost=headers.get('host')||'localhost';
          if(allowedOrigins.length){
            base=allowedOrigins.find(value=>new URL(value).host===directHost);
            if(!base){outgoing.writeHead(421,{'Content-Type':'text/plain; charset=utf-8',Connection:'close'});outgoing.end('Host is not in ALLOWED_ORIGINS');incoming.resume();return;}
          }else base=publicOrigin(`http://${directHost}`);
        }
        const path = new URL(incoming.url, 'http://localhost');
        requestPath=path.pathname;
        if(community && !['GET','HEAD','OPTIONS'].includes(incoming.method)) {
          const claimedOrigin=headers.get('origin'),site=headers.get('sec-fetch-site');
          if((claimedOrigin && claimedOrigin!==base) || site==='cross-site') {
            outgoing.writeHead(403,{'Content-Type':'application/json',Connection:'close'});outgoing.end('{"error":"跨站写入已拒绝"}');incoming.resume();return;
          }
        }
        if(community && requestPath.startsWith('/api/community/') && queued>=8) {
          outgoing.writeHead(503,{'Retry-After':'5',Connection:'close'});outgoing.end('Busy');incoming.resume();return;
        }

        const restoring=restoreRoute(requestPath),largeRestore=restoring&&(incoming.method==='PUT'||requestPath===RESTORE_ROOT);
        const homeAdmin=requestPath.startsWith('/api/admin/home-configs'),homeUpload=isHomeUpload(requestPath,incoming.method);
        if((restoring||homeAdmin||(community&&requestPath.startsWith('/api/admin/')&&requestPath!=='/api/admin/auth'))&&!restoreJobs.authenticated(headers)){
          outgoing.writeHead(401,{'Content-Type':'application/json',Connection:'close'});outgoing.end('{"error":"Unauthorized"}');incoming.resume();return;
        }
        const url = new URL(base + path.pathname + path.search);
        let ip = incoming.socket.remoteAddress || 'unknown';
        const forwarded = trustProxy && first('x-forwarded-for');
        if (forwarded && isIP(forwarded)) ip = forwarded;
        // Never accept an untrusted CF-Connecting-IP supplied by a direct client.
        headers.set('CF-Connecting-IP', ip);
        headers.set('Host', url.host);
        const chunks = [];
        let size = 0;
        const uploadTimer=setTimeout(()=>incoming.destroy(Error('上传超时')),largeRestore?300000:homeUpload?120000:30000);uploadTimer.unref();
        try{for await (const chunk of incoming) {
          size += chunk.length;
          const bodyLimit=community&&requestPath.startsWith('/api/community/')?3*1024*1024:community&&!restoreJobs.authenticated(headers)?32768:largeRestore?512*1024*1024:homeUpload?26*1024*1024:(restoring||homeAdmin)?32768:maxBody;
          if (size > bodyLimit) {
            await restoreJobs.failedUpload(requestPath,Error('备份超过 512 MiB 上传限制'));
            outgoing.writeHead(413, { Connection: 'close' });
            outgoing.end('Request body exceeds limit');
            return;
          }
          chunks.push(chunk);
        }}finally{clearTimeout(uploadTimer);}
        const body = Buffer.concat(chunks);
        const request = new Request(url, { method: incoming.method, headers,
          ...(body.length ? { body } : {}) });
        queued++;
        const responsePromise = (async()=>{
          if(community && requestPath==='/admin/manage' && !restoreJobs.authenticated(headers))
            return new Response(null,{status:303,headers:{Location:'/admin','Cache-Control':'no-store'}});
          if(community) {
            try { const reply=await kv.transaction(()=>community(request));if(reply)return reply; }
            catch(error){return Response.json({error:error.status?error.message:'操作失败，请检查投稿内容或服务日志'},{status:error.status||400});}
          }
          return restoring?restoreJobs.handle(request):incoming.method==='GET'||incoming.method==='HEAD'
            ? kv.transaction(()=>worker.fetch(request,env)):worker.fetch(request,env);
        })();
        requests.add(responsePromise);
        let response;
        try { response = await responsePromise; } finally { queued--; requests.delete(responsePromise); }
        if(community&&requestPath==='/admin/manage'&&response.ok){
          const content=(await response.text()).replace('</head>','<link rel="stylesheet" href="/user/admin-theme.css"><style>button.btn-primary,.ftab.active,.rex-import{background:var(--field)!important;color:var(--text)!important;border:1px solid var(--field-brd)!important}button{border-radius:10px!important}.row{border-radius:14px;padding:12px}.btn-primary:hover,.rex-import:hover{filter:brightness(.96)}a:focus-visible,button:focus-visible{outline:2px solid #007aff;outline-offset:3px}</style></head>').replace('</body>','<script src="/user/manage.js"></script></body>');
          response=new Response(content,{status:response.status,headers:response.headers});
        }
        if (incoming.method !== 'GET' && response.ok && !shuttingDown) void kick();
        // Uploaded HTML runs in an opaque origin: it cannot read admin cookies or call same-origin APIs.
        const responseHeaders = Object.fromEntries(response.headers);
        if(community){
          responseHeaders['x-content-type-options']='nosniff';
          responseHeaders['referrer-policy']='no-referrer';
          if(!['/user','/admin','/admin/manage','/checker','/crypto'].includes(requestPath)&&/text\/html|image\/svg\+xml/i.test(response.headers.get('content-type')||''))
            responseHeaders['content-security-policy']="sandbox allow-scripts; default-src https: http: data: blob: 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'";
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length) responseHeaders['set-cookie'] = cookies;
        // Compress the static UI only. Public module/collection bytes and ETag
        // validation always pass through the Worker, never an in-memory cache.
        const staticUI=['/','/index.html','/user','/admin','/admin/manage'].includes(path.pathname)&&response.status===200&&
          /text\/html/i.test(response.headers.get('content-type')||'');
        if(staticUI)responseHeaders.vary='Accept-Encoding';
        const compress=staticUI&&
          (incoming.headers['accept-encoding']||'').split(',').some(v=>/^\s*gzip\s*(?:;\s*q\s*=\s*(?:1(?:\.0*)?|0\.(?!0*(?:\s|$))\d+))?\s*$/i.test(v));
        if(compress){responseHeaders['content-encoding']='gzip';delete responseHeaders['content-length'];}
        outgoing.writeHead(response.status, responseHeaders);
        if (incoming.method === 'HEAD' || !response.body) outgoing.end();
        else if(compress)await pipeline(Readable.fromWeb(response.body),createGzip(),outgoing);
        else await pipeline(Readable.fromWeb(response.body), outgoing);
      } catch (error) {
        await restoreJobs.failedUpload(requestPath,error).catch(()=>{});
        console.error('Request failed:', error.message);
        if (!outgoing.headersSent) {
          outgoing.writeHead(500, { 'Content-Type': 'application/json' });
          outgoing.end('{"error":"Internal server error"}');
        } else outgoing.destroy();
      }
    });
    // Restore uploads have a 5-minute total budget. Other bodies keep their 30s guard above.
    server.requestTimeout = 300_000;
    if(community)server.maxConnections=32;
    server.headersTimeout = 15_000;
    let finishClose;
    server.hubClosed = new Promise(resolve => { finishClose = resolve; });
    server.on('close', () => {
      shuttingDown = true;
      clearInterval(timer);
      shutdown.abort(Object.assign(new Error('Server shutting down'),{code:'HUB_SHUTDOWN'}));
      void Promise.allSettled([scheduledJob,...requests].filter(Boolean)).then(()=>restoreJobs.close()).then(()=>kv.gate.pending)
        .finally(() => { kv.close(); finishClose(); });
    });
    setImmediate(() => { if (!shuttingDown) void kick(); });
    return server;
  } catch (error) {
    if(restoreJobs)await restoreJobs.close();
    kv.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory=resolve(process.env.DATA_DIR||'./data');
  const needsSetup=process.env.NAS_MODE==='true'&&!existsSync(resolve(directory,'rex.sqlite'))&&!process.env.ADMIN_SECRET;
  const server = needsSetup ? createSetupServer(directory,process.env,()=>server.close(()=>process.exit(0))) : await createHubServer();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => console.log(`Rex Widgets Hub listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close();
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
