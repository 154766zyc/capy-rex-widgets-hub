// Remote manifests are data only; never evaluate downloaded JavaScript.
import { withModuleLock } from './uploads.js';
import {resolveTitle,cleanTitle,METADATA_SCAN_BYTES} from './metadata.js';
import {prepareName,nameStatement,urlFilename,validateFilename,decorateNames} from './filenames.js';
import {assertModuleFile,assertFetchableUrl as assertPublicUrl,remoteErrorText} from './remote.js';
import {prepareCollectionIcon,assertStoredIcon} from './icons.js';
import {linkCandidates} from './duplicates.js';
import {nextVersion} from './versions.js';
import {syncIntervalMs} from './sync-interval.js';
export async function upgradeSubscriptions(env){
 const columns=new Set((await env.DB.prepare('PRAGMA table_info(subscription_sources)').all()).results.map(c=>c.name));
 for(const d of ["kind TEXT NOT NULL DEFAULT 'collection'","title_locked INTEGER DEFAULT 0","revision TEXT NOT NULL DEFAULT ''","etag TEXT DEFAULT ''","last_modified TEXT DEFAULT ''"])
  if(!columns.has(d.split(' ')[0]))await env.DB.prepare('ALTER TABLE subscription_sources ADD COLUMN '+d).run();
 const {results:unversioned}=await env.DB.prepare("SELECT id FROM subscription_sources WHERE revision='' OR revision IS NULL").all();
 for(const row of unversioned)await env.DB.prepare('UPDATE subscription_sources SET revision=? WHERE id=?').bind(crypto.randomUUID(),row.id).run();
 // 3.5.5：合集里每个模块单独记 ETag/Last-Modified，下次同步发条件请求，没变就回 304 不重下。
 const itemColumns=new Set((await env.DB.prepare('PRAGMA table_info(subscription_items)').all()).results.map(c=>c.name));
 for(const d of ["etag TEXT DEFAULT ''","last_modified TEXT DEFAULT ''"])
  if(!itemColumns.has(d.split(' ')[0]))await env.DB.prepare('ALTER TABLE subscription_items ADD COLUMN '+d).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS source_previews(id TEXT PRIMARY KEY,url TEXT NOT NULL,kv_key TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,metadata TEXT NOT NULL,expires_at INTEGER NOT NULL,generation TEXT NOT NULL)`).run();
}
export const subscriptionSchema = [
  `CREATE TABLE IF NOT EXISTS source_previews(id TEXT PRIMARY KEY,url TEXT NOT NULL,kv_key TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,metadata TEXT NOT NULL,expires_at INTEGER NOT NULL,generation TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS subscription_sources (
    id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    group_id TEXT DEFAULT '', enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'idle', next_sync_at INTEGER DEFAULT 0,
    last_started_at INTEGER DEFAULT 0, last_finished_at INTEGER DEFAULT 0,
    last_error TEXT DEFAULT '', summary TEXT DEFAULT '{}', snapshot TEXT,
    cursor INTEGER DEFAULT 0, sort_base INTEGER DEFAULT 0,
    lease_until INTEGER DEFAULT 0, lease_token TEXT DEFAULT '', created_at INTEGER,
    kind TEXT NOT NULL DEFAULT 'collection',title_locked INTEGER DEFAULT 0,revision TEXT NOT NULL DEFAULT '',
    etag TEXT DEFAULT '',last_modified TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS subscription_items (
    source_id TEXT NOT NULL, remote_id TEXT NOT NULL, module_id TEXT,
    url TEXT NOT NULL, title TEXT, version TEXT, author TEXT,
    description TEXT, required_version TEXT, active INTEGER DEFAULT 1,
    last_error TEXT DEFAULT '', etag TEXT DEFAULT '', last_modified TEXT DEFAULT '', PRIMARY KEY(source_id, remote_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_subscription_module ON subscription_items(module_id)`,
  `CREATE INDEX IF NOT EXISTS idx_module_source ON modules(source_url)`
];

// 3.6.0：自动更新间隔改由设置决定（sync-interval.js，默认 6 小时）。
// Keep the proven memory/lease boundary from Docker 3.4.
const BATCH = 2;
// 3.5.8：每轮处理的模块数可由运行环境调大（Cloudflare 版设为 6）；同时下载仍是 2 个，内存上限不变。
const batchSize = env => { const n = Number(env?.SYNC_BATCH); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : BATCH; };
const MAX_ITEMS = 500;
const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
const errorText = remoteErrorText;
function subscriptionIcon(value, baseUrl) {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim()) return '';
  try {
    const url = assertPublicUrl(new URL(value.trim(), baseUrl).href);
    return url.protocol === 'https:' && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}
const customIcon = value => typeof value==='string' && /^\/api\/icons\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value) ? value : '';
const storedSummary = "CASE WHEN json_valid(summary) THEN CASE WHEN json_type(summary)='object' THEN summary ELSE '{}' END ELSE '{}' END";
// Sync replaces its counters and upstream metadata, never the administrator's override.
const syncSummary = "json_patch(?,json_object('custom_icon_url',json_extract("+storedSummary+",'$.custom_icon_url')))";
function readSummary(value) {
  try { const result=JSON.parse(value||'{}');return result&&typeof result==='object'&&!Array.isArray(result)?result:{}; } catch { return {}; }
}
function sourceIcons(kind,summary) {
  const custom_icon_url=customIcon(summary.custom_icon_url);
  const upstream_icon_url=kind==='collection'?subscriptionIcon(summary.icon_url):'';
  return {custom_icon_url,upstream_icon_url,icon_url:custom_icon_url||upstream_icon_url};
}

export async function changeSubscriptionIcon(env,source,body) {
  const epoch=env.CONTENT_EPOCH||0;
  const previous=sourceIcons(source.kind,readSummary(source.summary));
  if(body.revision!==source.revision||body.expected_icon_url!==previous.custom_icon_url)throw Error('订阅或图标已变化，请重新打开');
  const mode=body.icon_mode;
  let url='';
  if(mode==='custom'){
    const input=typeof body.icon_url==='string'?body.icon_url.trim():'';
    if(!customIcon(input)&&!subscriptionIcon(input))throw Error('请选择图标库中的图标，或输入有效的 HTTPS 图片地址');
    url=(await prepareCollectionIcon(env,{icon_url:input},null))?.url||'';
    if(!customIcon(url))throw Error('图标缓存失败');
  }else if(mode!=='auto'||body.icon_url!==undefined)throw Error('图标设置无效');
  const publish=async()=>{
  if(epoch!==(env.CONTENT_EPOCH||0)||env.SHUTDOWN_SIGNAL?.aborted)throw Error('图标修改已取消，请重新打开');
  if(url)await assertStoredIcon(env,url);
  const result=await env.DB.prepare("UPDATE subscription_sources SET summary=CASE WHEN ?='' THEN json_remove("+storedSummary+",'$.custom_icon_url') ELSE json_set("+storedSummary+",'$.custom_icon_url',?) END WHERE id=? AND revision=? AND COALESCE(json_extract("+storedSummary+",'$.custom_icon_url'),'')=?")
    .bind(url,url,source.id,source.revision,previous.custom_icon_url).run();
  if(!result.meta.changes)throw Error('订阅或图标已变化，请重新打开');
  return {ok:true};
  };return env.ATOMIC?env.ATOMIC(publish):publish();
}
function sourceFilename(url,header=''){
 const name=urlFilename(url,'module.js');if(/\.js$/i.test(name))return name;
 try{const utf=header.match(/filename\*=UTF-8''([^;]+)/i),ascii=header.match(/filename="([^"]+)"|filename=([^;]+)/i);
  const value=utf?decodeURIComponent(utf[1]):(ascii?.[1]||ascii?.[2]||'').trim();if(value)return validateFilename(value);
 }catch{}
 return name+'.js';
}

async function sourceAtomic(env,source,work) {
  const run=async()=>{
    const current=await env.DB.prepare('SELECT enabled,lease_token,revision,url FROM subscription_sources WHERE id=?').bind(source.id).first();
    if(!current?.enabled || current.lease_token!==source.lease_token || current.revision!==source.revision || current.url!==source.url || env.SHUTDOWN_SIGNAL?.aborted){
      if(env.SHUTDOWN_SIGNAL?.aborted&&env.SHUTDOWN_SIGNAL.reason?.code==='HUB_SHUTDOWN')throw Object.assign(new Error('服务重启，本次同步已中止'),{cancelled:true,code:'REMOTE_SHUTDOWN'});
      const error=new Error('同步已取消（订阅源已暂停、删除或恢复）');error.cancelled=true;throw error;
    }
    return work();
  };
  return env.ATOMIC ? env.ATOMIC(run) : run();
}

export function parseManifest(buffer, baseUrl, assertUrl) {
  const raw = new TextDecoder().decode(buffer).replace(/^\uFEFF/, '').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null;
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw new Error('合集 JSON 格式不正确'); }
  if (!manifest || !Array.isArray(manifest.widgets)) throw new Error('不是有效的合集：缺少 widgets 列表');
  if (manifest.widgets.length > MAX_ITEMS) throw new Error('一个订阅源最多支持 500 个模块');
  const seen = new Set(), urls = new Set();
  const widgets = manifest.widgets.map(item => {
    if (!item || typeof item.url !== 'string') throw new Error('合集存在缺少下载地址的模块');
    const url = assertUrl(new URL(item.url, baseUrl).href);
    if (url.username || url.password) throw new Error('模块地址不能包含用户名或密码');
    url.hash = '';
    const remote_id = text(item.id, 200) || url.href;
    if (seen.has(remote_id) || urls.has(url.href)) throw new Error('合集存在重复的模块 ID 或地址');
    seen.add(remote_id); urls.add(url.href);
    return { remote_id, url: url.href, title: text(item.title), version: text(item.version, 100),
      author: text(item.author), description: text(item.description, 4000),
      required_version: text(item.requiredVersion, 100) || '0.0.1' };
  });
  return { title: text(manifest.title) || '未命名订阅', widgets,
    icon_url:subscriptionIcon(manifest.icon,baseUrl)||subscriptionIcon(manifest.logo,baseUrl) };
}

export async function addSubscription(env, rawUrl, groupId, helpers, prefetched, options={}) {
  const u = helpers.assertFetchableUrl(rawUrl);
  if (u.username || u.password) throw new Error('订阅地址不能包含用户名或密码');
  u.hash = '';
  const existing = await env.DB.prepare('SELECT id,kind FROM subscription_sources WHERE url = ?').bind(u.href).first();
  if (existing) return { ...existing, existing: true,added:[] };
  // Validate before persisting a subscription, including every module URL.
  const epoch=env.CONTENT_EPOCH||0;
  const info={},buffer = prefetched || await helpers.fetchCapped(u.href, 10 * 1024 * 1024,info);
  const manifest = parseManifest(buffer, u.href, helpers.assertFetchableUrl);
  if(manifest&&buffer.byteLength>1024*1024)throw Error('合集超过 1 MB');
  if(!manifest){assertModuleFile(new Uint8Array(buffer),info.contentType);validateModule(buffer,helpers);}
  const publish=async()=>{
  if(epoch!==(env.CONTENT_EPOCH||0))throw Error('导入已取消（数据已清空或恢复）');
  if(options.preview_id)await readSourcePreview(env,options);
  const duplicate=await env.DB.prepare('SELECT id,kind FROM subscription_sources WHERE url=?').bind(u.href).first();
  if(duplicate)return {...duplicate,existing:true,added:[]};
  const kind=manifest?'collection':'module';let filename=options.filename||sourceFilename(u.href,info.contentDisposition);
  if(!/\.js$/i.test(filename))filename+='.js';
  const meta=manifest?{}:helpers.parseMeta(filename,new Uint8Array(buffer.slice(0,METADATA_SCAN_BYTES)));
  const title=manifest?.title||cleanTitle(meta.title)||filename.replace(/\.js$/i,'');
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO subscription_sources
    (id,url,title,group_id,created_at,kind,revision,snapshot,summary) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, u.href, title, groupId || '', Date.now(),kind,crypto.randomUUID(),manifest?JSON.stringify(manifest.widgets):null,JSON.stringify(manifest?.icon_url?{icon_url:manifest.icon_url}:{})).run();
  if(kind==='module'){
   try{
    const item=singleItem(u.href);
    await env.DB.prepare(`INSERT INTO subscription_items(source_id,remote_id,url,active) VALUES(?,'single',?,1)`).bind(id,u.href).run();
    const source=await env.DB.prepare('SELECT * FROM subscription_sources WHERE id=?').bind(id).first();
    source.sort_base=await helpers.nextSortOrder(env.DB);
    const result=await syncItem(env,source,item,0,{...helpers,initialName:options,fetchCapped:async()=>buffer,fetchRemote:undefined});
    const summary={added:0,updated:0,unchanged:0,manual:0,failed:0,removed:0};summary[result]++;
    await finishSingle(env,source,summary);
    const m=await env.DB.prepare('SELECT m.* FROM modules m JOIN subscription_items i ON i.module_id=m.id WHERE i.source_id=?').bind(id).first();
    return {id,kind,existing:false,added:m?[m]:[],done:true};
   }catch(e){await env.DB.batch([env.DB.prepare('DELETE FROM subscription_items WHERE source_id=?').bind(id),env.DB.prepare('DELETE FROM subscription_sources WHERE id=?').bind(id)]);throw e;}
  }
  return { id,kind, existing: false };
  };
  return env.ATOMIC?env.ATOMIC(publish):publish();
}

export async function listSubscriptions(env) {
  const { results } = await env.DB.prepare(`SELECT s.id,s.url,s.title,s.group_id,s.enabled,s.status,s.kind,s.title_locked,s.revision,
    s.next_sync_at,s.last_started_at,s.last_finished_at,s.last_error,s.summary,s.cursor,s.created_at,
    CASE WHEN s.snapshot IS NOT NULL AND json_extract(CASE WHEN json_valid(s.summary) THEN s.summary ELSE '{}' END,'$.retry_only') IS NOT 1 THEN json_array_length(s.snapshot)
      ELSE (SELECT COUNT(*) FROM subscription_items i WHERE i.source_id=s.id AND i.active=1) END AS total,
    (SELECT COUNT(*) FROM subscription_items i JOIN modules m ON m.id=i.module_id
      WHERE i.source_id=s.id AND i.active=1) AS imported,
    (SELECT COUNT(*) FROM subscription_items i WHERE i.source_id=s.id AND i.active=0) AS removed
    FROM subscription_sources s ORDER BY s.created_at DESC`).all();
  return (results||[]).map(s=>{const summary=readSummary(s.summary);return {...s,summary,...sourceIcons(s.kind,summary)};});
}

async function stageManifest(env, source, helpers) {
  const cached=source.status==='idle'&&source.snapshot;
  const manifest=cached?{title:source.title,widgets:JSON.parse(source.snapshot),icon_url:subscriptionIcon(readSummary(source.summary).icon_url)}:parseManifest(await helpers.fetchCapped(source.url,1024*1024),source.url,helpers.assertFetchableUrl);
  if (!manifest) throw new Error('上游没有返回有效的合集');
  return sourceAtomic(env,source,async()=>{
  const removed = await env.DB.prepare(`SELECT remote_id FROM subscription_items
    WHERE source_id=? AND active=1`).bind(source.id).all();
  const ids = new Set(manifest.widgets.map(w => w.remote_id));
  const summary = { added: 0, updated: 0, unchanged: 0, failed: 0,
    removed: (removed.results || []).filter(w => !ids.has(w.remote_id)).length,
    ...(manifest.icon_url?{icon_url:manifest.icon_url}:{}) };
  const sortBase = await helpers.nextSortOrder(env.DB) - Math.max(0,manifest.widgets.length-1);
  // One bounded SQL update instead of one query per manifest item. New items are
  // materialized with their download batch, keeping large sources within free-tier limits.
  const statements = [env.DB.prepare(`UPDATE subscription_items SET active=CASE
    WHEN remote_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE source_id=?`)
    .bind(JSON.stringify(manifest.widgets.map(w=>w.remote_id)),source.id)];
  // D1 batch is transactional: a malformed/incomplete manifest cannot mark everything removed.
  statements.push(env.DB.prepare(`UPDATE subscription_sources SET title=?,snapshot=?,cursor=0,
    sort_base=?,summary=${syncSummary},status='syncing',last_started_at=?,last_error='' WHERE id=?`)
    .bind(source.title_locked?source.title:manifest.title,JSON.stringify(manifest.widgets),sortBase,JSON.stringify(summary),Date.now(),source.id));
  await env.DB.batch(statements);
  return { ...source, title: manifest.title, snapshot: JSON.stringify(manifest.widgets), cursor: 0,
    sort_base: sortBase, summary: JSON.stringify(summary), status: 'syncing' };
  });
}

function validateModule(buffer, helpers) {
  assertModuleFile(new Uint8Array(buffer));
  if (!buffer.byteLength) throw new Error('模块文件为空');
  const head = new TextDecoder().decode(buffer.slice(0, 32768)).replace(/^\uFEFF/, '').trim();
  if (helpers.isEncrypted(new Uint8Array(buffer))) return;
  if (/^(?:<!doctype\s+html|<html|<head|<body|\{|\[)/i.test(head)) {
    throw new Error('下载结果不是模块（返回了网页或 JSON），保留旧版本');
  }
  if (!/WidgetMetadata|\bexport\s|\bfunction\b|\b(?:const|let|var)\s/.test(head)) {
    throw new Error('无法识别为模块文件，保留旧版本');
  }
}

// 服务器偶尔会回超长的校验值，截断后再存/再发，避免请求头过大（参考 feedparser-rs）。
const validator=(value,max)=>typeof value==='string'&&value.length<=max?value:'';
// 只有合集里的元数据与本地完全一致时才发条件请求；否则仍走完整下载，保证标题、版本、作者能更新。
function canRevalidate(mod,item,mapping,helpers){
  return !!(helpers.fetchRemote&&!helpers.forceFile&&mapping&&(mapping.etag||mapping.last_modified)&&mod&&!mod.manual_override&&
    mod.content_hash&&mod.source_url===item.url&&mod.required_version===item.required_version&&
    (mod.manifest_title||'')===cleanTitle(item.title)&&(!item.author||item.author===mod.author)&&(!item.version||item.version===mod.version));
}
async function syncItem(env, source, item, index, helpers) {
  const mapping = await env.DB.prepare('SELECT module_id,etag,last_modified FROM subscription_items WHERE source_id=? AND remote_id=?')
    .bind(source.id,item.remote_id).first();
  let mod = mapping?.module_id ? await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(mapping.module_id).first() : null;
  if (!mod) mod = await env.DB.prepare('SELECT * FROM modules WHERE source_url=? ORDER BY created_at LIMIT 1').bind(item.url).first();
  let buffer=null,hash='',etag='',lastModified='';
  if(!mod?.manual_override){
    if(canRevalidate(mod,item,mapping,helpers)){
      const headers={};if(mapping.etag)headers['If-None-Match']=mapping.etag;if(mapping.last_modified)headers['If-Modified-Since']=mapping.last_modified;
      const remote=await helpers.fetchRemote(item.url,10*1024*1024,{headers,allowNotModified:true});
      etag=validator(remote.etag||mapping.etag,1024);lastModified=validator(remote.lastModified||mapping.last_modified,64);
      if(remote.status===304){
        // 没变：只更新校验值，不下载、不写文件、不动模块（无论内容是否变化都要保存最新校验值，参考 NetNewsWire 的修复）。
        return withModuleLock(env,'module:'+mod.id,()=>sourceAtomic(env,source,async()=>{
          const current=await env.DB.prepare('SELECT id,manual_override,content_hash FROM modules WHERE id=?').bind(mod.id).first();
          if(!current)throw Error('模块已在下载期间删除，本次未重新添加');
          await env.DB.batch([env.DB.prepare(`UPDATE subscription_items SET module_id=?,last_error='',etag=?,last_modified=?
            WHERE source_id=? AND remote_id=?`).bind(mod.id,etag,lastModified,source.id,item.remote_id),
            ...(current.manual_override?[env.DB.prepare('UPDATE modules SET source_managed=1 WHERE id=?').bind(mod.id)]:[])]);
          return current.manual_override?'manual':'unchanged';
        }));
      }
      buffer=remote.bytes.buffer.byteLength===remote.bytes.byteLength?remote.bytes.buffer:remote.bytes.slice().buffer;
    }else{
      const info={};buffer=await helpers.fetchCapped(item.url,10*1024*1024,info);
      etag=validator(info.etag,1024);lastModified=validator(info.lastModified,64);
    }
    validateModule(buffer,helpers);
    hash=helpers.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)));
  }
  // Equal URLs imported concurrently from two sources share one local identity.
  const urlHash = helpers.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(item.url))));
  const id = mod?.id || [urlHash.slice(0,8),urlHash.slice(8,12),urlHash.slice(12,16),urlHash.slice(16,20),urlHash.slice(20,32)].join('-');
  // Downloads remain concurrent; catalog publication must serialize names shared
  // by different module IDs after cleaning (e.g. REX-video.js and video.js).
  return withModuleLock(env,'module:'+id,()=>sourceAtomic(env,source,async()=>{
  mod=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first();
  if(mapping?.module_id&&!mod)throw Error('模块已在下载期间删除，本次未重新添加');
  if(mod?.manual_override){
    await env.DB.batch([env.DB.prepare(`UPDATE subscription_items SET module_id=?,last_error=''
      WHERE source_id=? AND remote_id=?`).bind(id,source.id,item.remote_id),
      env.DB.prepare('UPDATE modules SET source_managed=1 WHERE id=?').bind(id)]);
    return 'manual';
  }
  if(!buffer)throw Error('维护方式在下载期间发生变化，请重试');
  const now = Date.now();
  const filename = mod?.filename || (source.kind==='module'?(helpers.initialName?.filename||urlFilename(item.url,'module.js')):id + '.js');
  const meta = helpers.isEncrypted(new Uint8Array(buffer))?{}:helpers.parseMeta(filename, new Uint8Array(buffer.slice(0, METADATA_SCAN_BYTES)));
  const codeTitle=cleanTitle(meta.title),manifestTitle=cleanTitle(item.title);
  const naming=await prepareName(env,id,filename,{existing:!!mod,preferred:mod?undefined:urlFilename(item.url,filename),requested:mod?undefined:helpers.initialName?.effective_filename||undefined});
  const title = resolveTitle({...mod,filename,effective_filename:naming.filename},codeTitle,manifestTitle);
  // 3.5.8：加密模块读不到内部版本号；内容变了、合集也没给版本号时自动生成日期版本号。
  const encrypted = helpers.isEncrypted(new Uint8Array(buffer));
  const version = nextVersion({fromFile: meta.version || item.version, prev: mod?.version || '', encrypted, changed: !!mod?.content_hash && mod.content_hash !== hash});
  const author = item.author || meta.author || mod?.author || '';
  const changed = !mod || mod.content_hash !== hash || mod.title !== title || mod.version !== version ||
    mod.author !== author || mod.source_url !== item.url || mod.required_version !== item.required_version ||
    mod.code_title!==codeTitle || mod.manifest_title!==manifestTitle;
  let fileKey=mod?.file_key||'';
  if (helpers.forceFile || !mod || mod.content_hash !== hash) {
    // Download and validate completely before replacing a working file.
    fileKey=(await helpers.putFile(env, id, buffer, now))||'';
  }
  const statements = [nameStatement(env,naming)];
  if (mod) {
    // Do not touch note, group_id, sort_order, widget_id or any collection links.
    statements.push(env.DB.prepare(`UPDATE modules SET title=?,version=?,author=?,file_size=?,
      is_encrypted=?,source_url=?,content_hash=?,required_version=?,updated_at=?,source_managed=1,
      file_key=?,metadata_id=?,code_title=?,manifest_title=?,title_scan_v1=1 WHERE id=?`)
      .bind(title,version,author,buffer.byteLength,helpers.isEncrypted(new Uint8Array(buffer)),item.url,
        hash,item.required_version,changed ? now : mod.updated_at,fileKey,meta.id||mod.metadata_id||'',codeTitle,manifestTitle,id));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO modules (id,filename,widget_id,title,version,author,
      file_size,is_encrypted,source_url,note,group_id,sort_order,created_at,updated_at,content_hash,required_version,source_managed,
      code_title,manifest_title,title_scan_v1,generated_filename,metadata_id,file_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,1,1,?,?)`)
      .bind(id,filename,meta.id || (source.kind==='module'?id:item.remote_id),title,version,author,buffer.byteLength,
        helpers.isEncrypted(new Uint8Array(buffer)),item.url,item.description,source.group_id,
        source.sort_base + index,now,now,hash,item.required_version,codeTitle,manifestTitle,meta.id||'',fileKey));
  }
  statements.push(env.DB.prepare(`UPDATE subscription_items SET module_id=?,last_error='',etag=?,last_modified=?
    WHERE source_id=? AND remote_id=?`).bind(id,etag,lastModified,source.id,item.remote_id));
  try{await env.DB.batch(statements);}catch(e){if(fileKey&&fileKey!==mod?.file_key)await env.KV.delete(fileKey).catch(()=>{});throw e;}
  if(mod?.file_key?.startsWith('upload-content:') && mod.content_hash!==hash)
    await env.KV.delete(mod.file_key).catch(()=>{});
  return !mod ? 'added' : changed ? 'updated' : 'unchanged';
  }));
}

export async function syncSubscription(env, id, action, helpers) {
  const token = crypto.randomUUID(), now = Date.now();
  const lock = await env.DB.prepare(`UPDATE subscription_sources SET lease_until=?,lease_token=?
    WHERE id=? AND lease_until < ?`).bind(now + 150000,token,id,now).run();
  if (!lock.meta.changes) throw new Error('订阅源不存在或正在同步，请稍后刷新');
  let source;
  try {
    source = await env.DB.prepare('SELECT * FROM subscription_sources WHERE id=?').bind(id).first();
    if (!source.enabled) throw new Error('订阅源已暂停，请先恢复');
    if(source.kind==='module')return await syncSingle(env,source,helpers);
    if(action==='retry'&&source.status!=='syncing'){
      const failed=(await env.DB.prepare("SELECT * FROM subscription_items WHERE source_id=? AND active=1 AND COALESCE(last_error,'')!='' ORDER BY remote_id").bind(id).all()).results||[];
      if(!failed.length)return {ok:true,done:true,processed:0,total:0,summary:{added:0,updated:0,unchanged:0,manual:0,failed:0,removed:0}};
      const icon=subscriptionIcon(readSummary(source.summary).icon_url);
      const summary={added:0,updated:0,unchanged:0,manual:0,failed:0,removed:0,retry_only:true,...(icon?{icon_url:icon}:{})};
      await sourceAtomic(env,source,()=>env.DB.prepare("UPDATE subscription_sources SET snapshot=?,cursor=0,status='syncing',summary="+syncSummary+",last_started_at=?,next_sync_at=0,last_error='' WHERE id=?")
        .bind(JSON.stringify(failed),JSON.stringify(summary),now,id).run());
      source={...source,snapshot:JSON.stringify(failed),cursor:0,status:'syncing',summary:JSON.stringify(summary),last_started_at:now};
    }
    // A repeated start resumes a pending cycle, never resets its cursor.
    if (source.status !== 'syncing' || !source.snapshot) {
      source = await stageManifest(env, source, helpers);
      return { ok: true, done: false, processed: 0, total: JSON.parse(source.snapshot).length };
    }
    const items = JSON.parse(source.snapshot), summary = JSON.parse(source.summary);
    summary.manual=summary.manual||0;
    const cursor = source.cursor;
    const BATCH = batchSize(env);
    const batch = items.slice(cursor,cursor+BATCH);
    if (batch.length) await sourceAtomic(env,source,()=>env.DB.batch(batch.map(w=>env.DB.prepare(`INSERT INTO subscription_items
      (source_id,remote_id,url,title,version,author,description,required_version,active)
      VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(source_id,remote_id) DO UPDATE SET
      url=excluded.url,title=excluded.title,version=excluded.version,author=excluded.author,
      description=excluded.description,required_version=excluded.required_version,active=1`)
      .bind(id,w.remote_id,w.url,w.title,w.version,w.author,w.description,w.required_version))));
    // Two concurrent downloads bound memory and finish within the source lease.
    for (let offset=cursor; offset<Math.min(items.length,cursor+BATCH); offset+=2) {
      const downloads=await Promise.allSettled(items.slice(offset,Math.min(offset+2,cursor+BATCH)).map(async (item,k) => {
        try { summary[await syncItem(env,source,item,offset+k,helpers)]++; }
        catch (error) {
          if(error.cancelled)throw error;
          summary.failed++;
          const previous=await env.DB.prepare('SELECT m.id FROM subscription_items i JOIN modules m ON m.id=i.module_id WHERE i.source_id=? AND i.remote_id=?').bind(id,item.remote_id).first();
          await sourceAtomic(env,source,()=>env.DB.prepare('UPDATE subscription_items SET last_error=? WHERE source_id=? AND remote_id=?')
            .bind(errorText(error,{retained:!!previous}),id,item.remote_id).run());
        }
      }));
      const rejected=downloads.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
    }
    const next = Math.min(items.length,cursor+BATCH), done = next >= items.length, INTERVAL = done ? await syncIntervalMs(env) : 0;
    const status = done ? (summary.failed ? 'partial' : 'ok') : 'syncing';
    await sourceAtomic(env,source,()=>env.DB.prepare(`UPDATE subscription_sources SET cursor=?,summary=${syncSummary},status=?,snapshot=?,
      last_finished_at=?,next_sync_at=?,last_error=? WHERE id=? AND lease_token=?`)
      .bind(next,JSON.stringify(summary),status,done ? null : source.snapshot,
        done ? Date.now() : source.last_finished_at,done ? Date.now()+INTERVAL : 0,
        summary.failed ? summary.failed+' 个模块下载失败，已有版本保留；可查看详情并重试' : '',id,token).run());
    return { ok: true, done, processed: next, total: items.length, summary };
  } catch (error) {
    const previous=source?.kind==='module'?await env.DB.prepare('SELECT m.id FROM subscription_items i JOIN modules m ON m.id=i.module_id WHERE i.source_id=? LIMIT 1').bind(id).first():null;
    const INTERVAL = await syncIntervalMs(env);
    await env.DB.prepare(`UPDATE subscription_sources SET last_error=?,status=?,next_sync_at=? WHERE id=? AND lease_token=?`)
      .bind(errorText(error,{retained:!!previous}),source?.status === 'syncing' ? 'syncing' : 'error',Date.now()+INTERVAL,id,token).run();
    throw error;
  } finally {
    await env.DB.prepare(`UPDATE subscription_sources SET lease_until=0,lease_token='' WHERE id=? AND lease_token=?`)
      .bind(id,token).run();
  }
}

export async function subscriptionTick(env, helpers) {
  await env.DB.prepare('DELETE FROM source_previews WHERE id IN (SELECT id FROM source_previews WHERE expires_at<? LIMIT 20)').bind(Date.now()).run();
  // Minute dispatcher resumes durable batches; each source starts a cycle every six hours.
  // Oldest serviced source first prevents a large subscription starving the others.
  const row = await env.DB.prepare(`SELECT id FROM subscription_sources WHERE enabled=1
    AND lease_until < ? AND (status='syncing' OR next_sync_at<=?)
    ORDER BY CASE WHEN status='syncing' THEN last_started_at ELSE next_sync_at END ASC LIMIT 1`)
    .bind(Date.now(),Date.now()).first();
  if (!row) return false;
  try { console.log('[subscription-sync]',row.id,await syncSubscription(env,row.id,'continue',helpers)); }
  catch (error) { console.log('[subscription-sync]',row.id,errorText(error)); }
  return true;
}

export async function subscriptionItems(env, id) {
  const { results } = await env.DB.prepare(`SELECT i.*,m.title AS local_title,m.version AS local_version,
    m.is_encrypted AS local_encrypted,m.updated_at FROM subscription_items i LEFT JOIN modules m ON m.id=i.module_id
    WHERE i.source_id=? ORDER BY i.active DESC,i.title`).bind(id).all();
  return results || [];
}

const singleItem=url=>({remote_id:'single',url,title:'',version:'',author:'',description:'',required_version:'0.0.1'});
async function finishSingle(env,source,summary,remote={}){
 const INTERVAL=await syncIntervalMs(env);
 return sourceAtomic(env,source,async()=>{
 await env.DB.prepare(`UPDATE subscription_sources SET summary=${syncSummary},status='ok',last_started_at=?,last_finished_at=?,next_sync_at=?,last_error='',snapshot=NULL,cursor=1,etag=?,last_modified=? WHERE id=?`)
 .bind(JSON.stringify(summary),Date.now(),Date.now(),Date.now()+INTERVAL,remote.etag||'',remote.lastModified||'',source.id).run();
 if(!source.title_locked){const m=await env.DB.prepare('SELECT m.* FROM modules m JOIN subscription_items i ON i.module_id=m.id WHERE i.source_id=?').bind(source.id).first();if(m){const named=(await decorateNames(env,[m]))[0];await env.DB.prepare('UPDATE subscription_sources SET title=? WHERE id=?').bind(named.title,source.id).run();}}
 });
}
async function syncSingle(env,source,helpers){
 const mod=await env.DB.prepare(`SELECT m.* FROM modules m JOIN subscription_items i ON i.module_id=m.id WHERE i.source_id=? AND i.remote_id='single'`).bind(source.id).first();
 const summary={added:0,updated:0,unchanged:0,manual:0,failed:0,removed:0};
 if(mod?.manual_override){summary.manual=1;await finishSingle(env,source,summary);return {ok:true,done:true,processed:1,total:1,summary};}
 let remote={},buffer,forceFile=false;
 if(helpers.fetchRemote){
  const local=mod?await env.KV.get(mod.file_key||'file:'+mod.id,'stream'):null;
  if(local)await local.cancel();
  forceFile=!local;
  const headers={};if(local&&source.etag)headers['If-None-Match']=source.etag;if(local&&source.last_modified)headers['If-Modified-Since']=source.last_modified;
  remote=await helpers.fetchRemote(source.url,10*1024*1024,{headers,allowNotModified:!!local});
  if(remote.status===304){summary.unchanged=1;await finishSingle(env,source,summary,{etag:remote.etag||source.etag,lastModified:remote.lastModified||source.last_modified});return {ok:true,done:true,processed:1,total:1,summary};}
  buffer=remote.bytes.buffer;assertModuleFile(remote.bytes,remote.contentType);
 }else buffer=await helpers.fetchCapped(source.url,10*1024*1024);
 validateModule(buffer,helpers);
 const current=await env.DB.prepare('SELECT * FROM subscription_sources WHERE id=?').bind(source.id).first();
 if(!current?.enabled||current.url!==source.url||current.revision!==source.revision)throw Error('来源已变化，取消旧同步');
 await sourceAtomic(env,source,()=>env.DB.prepare(`INSERT INTO subscription_items(source_id,remote_id,url,active) VALUES(?,'single',?,1) ON CONFLICT(source_id,remote_id) DO UPDATE SET url=excluded.url,active=1`).bind(source.id,source.url).run());
 source.sort_base=await helpers.nextSortOrder(env.DB);
 summary[await syncItem(env,source,singleItem(source.url),0,{...helpers,forceFile,fetchCapped:async()=>buffer,fetchRemote:undefined})]++;
 await finishSingle(env,source,summary,remote);return {ok:true,done:true,processed:1,total:1,summary};
}

export async function previewSource(env,rawUrl,helpers){
 const epoch=env.CONTENT_EPOCH||0;
 const u=helpers.assertFetchableUrl(rawUrl);u.hash='';const info={};
 const buffer=await helpers.fetchCapped(u.href,10*1024*1024,info),manifest=parseManifest(buffer,u.href,helpers.assertFetchableUrl);
 if(manifest&&buffer.byteLength>1024*1024)throw Error('合集超过 1 MB');
 if(!manifest){assertModuleFile(new Uint8Array(buffer),info.contentType);validateModule(buffer,helpers);}
 const filename=sourceFilename(u.href,info.contentDisposition),meta=manifest?{}:helpers.parseMeta(filename,new Uint8Array(buffer.slice(0,METADATA_SCAN_BYTES)));
 const existing=await env.DB.prepare('SELECT id,title,filename,manual_override,metadata_id FROM modules WHERE source_url=? LIMIT 1').bind(u.href).first();
 const source=await env.DB.prepare('SELECT id,kind FROM subscription_sources WHERE url=?').bind(u.href).first();
 const publish=async()=>{
 if(epoch!==(env.CONTENT_EPOCH||0))throw Error('导入已取消（数据已清空或恢复）');
 await env.DB.prepare('DELETE FROM source_previews WHERE expires_at<=?').bind(Date.now()).run();
 const id=crypto.randomUUID(),key='source-preview:'+id,kind=manifest?'collection':'module';
 const naming=manifest?null:await prepareName(env,existing?.id||id,existing?.filename||filename,{existing:!!existing});
 const title=manifest?.title||resolveTitle({filename,effective_filename:naming?.filename},meta.title,'');
 const generation=(await env.DB.prepare("SELECT value FROM settings WHERE key='content_generation'").first())?.value||'0';
 await env.KV.put(key,buffer,{expirationTtl:600});
 await env.DB.prepare('INSERT INTO source_previews VALUES(?,?,?,?,?,?,?,?)').bind(id,u.href,key,kind,title,JSON.stringify({...meta,source_filename:filename,icon_url:manifest?.icon_url||''}),Date.now()+600000,generation).run();
 return {ok:true,preview_id:id,url:u.href,kind,title,filename,metadata_id:meta.id||'',existing_module:existing,existing_source:source,total:manifest?manifest.widgets.length:1,icon_url:manifest?.icon_url||'',...await linkCandidates(env,{kind,url:u.href,buffer,meta:{...meta,source_filename:filename}})};
 };return env.ATOMIC?env.ATOMIC(publish):publish();
}
export async function readSourcePreview(env,body){
 const p=await env.DB.prepare('SELECT * FROM source_previews WHERE id=?').bind(body.preview_id||'').first();
 const generation=(await env.DB.prepare("SELECT value FROM settings WHERE key='content_generation'").first())?.value||'0';
 if(!p||p.expires_at<Date.now()||p.generation!==generation)throw Error('链接预览已过期，请重新识别');
 if(body.url){const u=new URL(body.url);u.hash='';if(u.href!==p.url)throw Error('地址已修改，请重新识别');}
 const buffer=await env.KV.get(p.kv_key,'arrayBuffer');if(!buffer)throw Error('预览文件已过期，请重新识别');
 return {...p,buffer,meta:JSON.parse(p.metadata)};
}
export async function editSource(env,source,body,helpers){
 if(source.lease_until>Date.now())throw Error('订阅正在同步，请完成后再编辑');
 if(body.revision!==source.revision)throw Error('来源已变化，请重新打开');
 const url=body.url?helpers.assertFetchableUrl(body.url):new URL(source.url);url.hash='';
 let nextSummary=null;
 if(url.href!==source.url){
  const p=await readSourcePreview(env,body);if(p.kind!==source.kind)throw Error('不能改变已保存的来源类型');
  if(source.kind==='collection'){const summary={...readSummary(source.summary)},icon=subscriptionIcon(p.meta.icon_url);if(icon)summary.icon_url=icon;else delete summary.icon_url;nextSummary=JSON.stringify(summary);}
  if(await env.DB.prepare('SELECT id FROM subscription_sources WHERE url=? AND id!=?').bind(url.href,source.id).first())throw Error('此地址已被其他订阅使用');
  if(source.kind==='module'){
   const m=await env.DB.prepare(`SELECT m.* FROM modules m JOIN subscription_items i ON i.module_id=m.id WHERE i.source_id=? AND i.remote_id='single'`).bind(source.id).first();
   if(m?.metadata_id&&p.meta.id&&m.metadata_id!==p.meta.id&&!body.confirm_identity)throw Error('新链接内部 ID 与原模块不同，请明确确认替换来源');
  }
 }
 const title=body.title===undefined?source.title:cleanTitle(body.title);if(!title)throw Error('来源名称不能为空');
 await env.DB.batch([
  env.DB.prepare(`UPDATE subscription_sources SET url=?,title=?,title_locked=?,revision=?,next_sync_at=0,status='idle',snapshot=NULL,cursor=0,etag='',last_modified='',summary=COALESCE(?,summary) WHERE id=?`).bind(url.href,title,body.title===undefined?source.title_locked:1,crypto.randomUUID(),nextSummary,source.id),
  ...(source.kind==='module'?[env.DB.prepare("UPDATE subscription_items SET url=? WHERE source_id=? AND remote_id='single'").bind(url.href,source.id)]:[])
 ]);return {ok:true};
}
export async function legacySources(env,body){
 const rows=(await env.DB.prepare(`SELECT m.id,m.title,m.source_url,m.manual_override,m.updated_at,m.file_key FROM modules m WHERE COALESCE(m.source_url,'')!='' AND m.source_managed=0 AND NOT EXISTS(SELECT 1 FROM subscription_items i WHERE i.module_id=m.id) ORDER BY m.created_at`).all()).results;
 if(!body)return {ok:true,rows:rows.map(m=>({...m,revision:JSON.stringify(m),enabled:!m.manual_override}))};
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>10)throw Error('每批请选择 1～10 个来源');
 if(new Set(body.rows.map(r=>r.id)).size!==body.rows.length)throw Error('重复的模块');
 const statements=[];
 for(const r of body.rows){
  const m=rows.find(m=>m.id===r.id);if(!m||JSON.stringify(m)!==r.revision)throw Error('模块已变化，请重新预览');
  const u=new URL(m.source_url);u.hash='';const old=await env.DB.prepare('SELECT * FROM subscription_sources WHERE url=?').bind(u.href).first();
  if(old&&old.kind!=='module')throw Error('地址已属于合集订阅');
  if(old&&await env.DB.prepare('SELECT module_id FROM subscription_items WHERE source_id=? AND module_id!=?').bind(old.id,m.id).first())throw Error('地址已绑定其他模块，请在订阅中处理');
  const id=old?.id||crypto.randomUUID();
  if(!old)statements.push(env.DB.prepare(`INSERT INTO subscription_sources(id,url,title,enabled,created_at,kind,revision) VALUES(?,?,?,?,?,'module',?)`).bind(id,u.href,m.title,m.manual_override?0:1,Date.now(),crypto.randomUUID()));
  statements.push(env.DB.prepare(`INSERT INTO subscription_items(source_id,remote_id,url,module_id,active) VALUES(?,'single',?,?,1) ON CONFLICT(source_id,remote_id) DO UPDATE SET module_id=excluded.module_id`).bind(id,u.href,m.id),env.DB.prepare('UPDATE modules SET source_managed=1 WHERE id=?').bind(m.id));
 }
 await env.DB.batch(statements);return {ok:true,processed:body.rows.length};
}
