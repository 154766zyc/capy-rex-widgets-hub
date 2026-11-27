import {normalizeUsername,usernameKey,validUsername,inspectSource,boundedRegex,suggestPlatform} from './validation.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hashPassword, verifyPassword, parseMeta, isEncrypted } from '../worker.js';
import { previewUploads, commitUpload, describeFile, fingerprint as coreFingerprint } from '../uploads.js';
import { syncAutoAll } from '../backup.js';

const fingerprint=m=>JSON.stringify([coreFingerprint(m),m?.group_id,m?.note]);
const MAX_FILE = 2 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const helpers = {parseMeta,isEncrypted,toHex:bytes=>Buffer.from(bytes).toString('hex'),nextSortOrder:async DB=>(await DB.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM modules').first()).n};
const cookie = (r,name) => (r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const fail = (message,status=400) => {throw Object.assign(Error(message),{status});};
const passwordValid = p => typeof p==='string' && p.length>=8 && p.length<=256;
const json = (body,status=200,headers={}) => Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export const capyLink = url => 'com.feifeiduck.capyplayer://add-widget?data='+Buffer.from(url,'utf8').toString('base64url');

export async function createCommunity(env) {
  const {DB}=env;
  for(const sql of [
    `CREATE TABLE IF NOT EXISTS nas_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS nas_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS nas_owners(module_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,platform TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS nas_submissions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,module_id TEXT NOT NULL DEFAULT '',filename TEXT NOT NULL,platform TEXT NOT NULL,source BLOB,sha256 TEXT NOT NULL,base_revision TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,reviewed_at INTEGER)`,
    `CREATE TRIGGER IF NOT EXISTS nas_module_deleted AFTER DELETE ON modules BEGIN DELETE FROM nas_owners WHERE module_id=OLD.id; UPDATE nas_submissions SET status='rejected',note='管理员删除了公开组件',source=NULL,reviewed_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE module_id=OLD.id AND status='pending'; END`,
    `CREATE INDEX IF NOT EXISTS nas_submissions_user ON nas_submissions(user_id,status)`,
    `CREATE TABLE IF NOT EXISTS nas_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at INTEGER NOT NULL)`
  ]) await DB.prepare(sql).run();
  const columns=(await DB.prepare('PRAGMA table_info(nas_submissions)').all()).results;
  if(!columns.some(c=>c.name==='snapshot'))await DB.prepare("ALTER TABLE nas_submissions ADD COLUMN snapshot TEXT NOT NULL DEFAULT '{}' ").run();
  const rate=new Map();
  function allowed(key,max=12) {
    const now=Date.now();
    for(const [k,v] of rate)if(v.until<now)rate.delete(k);
    if(rate.size>=2048&&!rate.has(key))return false;
    let v=rate.get(key);if(!v){v={n:0,until:now+300000};rate.set(key,v);}return ++v.n<=max;
  }
  const audit=(actor,action,target)=>DB.prepare('INSERT INTO nas_audit(actor,action,target,created_at) VALUES(?,?,?,?)').bind(actor,action,target,Date.now()).run();
  async function identity(request) {
    const admin=cookie(request,'fwh_admin');
    if(admin && await DB.prepare('SELECT 1 FROM sessions WHERE token=? AND expires_at>?').bind(admin,Date.now()).first()) return {id:'admin',username:(await DB.prepare("SELECT value FROM settings WHERE key='nas_admin_username'").first())?.value||'管理员',admin:true};
    const token=cookie(request,'nas_dev');
    if(!token)return null;
    return DB.prepare(`SELECT u.id,u.username FROM nas_users u JOIN nas_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).bind(sha(token),Date.now()).first();
  }
  async function publish(s,admin){
    const snapshot=JSON.parse(s.snapshot||'{}');
    const inspection=inspectSource(new TextDecoder('utf-8',{fatal:true}).decode(s.source),s.filename);
    if(s.platform==='rex'&&!inspection.encrypted)fail('所有Rex模块均需加密 否则不予通过审核');
    let group=await DB.prepare('SELECT id FROM groups WHERE name=? ORDER BY created_at,id LIMIT 1').bind(snapshot.author_group||'未分类作者').first();
    if(!group){group={id:crypto.randomUUID()};await DB.prepare('INSERT INTO groups(id,name,position,created_at) VALUES(?,?,0,?)').bind(group.id,snapshot.author_group||'未分类作者',Date.now()).run();}
    const file=new File([s.source],s.filename),plan=await previewUploads(env,[file],group.id,helpers,s.module_id);
    const row=plan.rows[0];if(row.error)fail(row.error);
    if(!s.module_id&&row.kind!=='new')fail('模块 ID 或文件名已存在；请选择维护已有组件',409);
    if(s.module_id){const m=await DB.prepare('SELECT * FROM modules WHERE id=?').bind(s.module_id).first();if(!m||fingerprint(m)!==s.base_revision)fail('公开版本已变化，请重新提交',409);}
    const result=await commitUpload(env,{job_id:plan.job_id,index:0,action:s.module_id?'replace':'new',target_id:s.module_id,file,mode:'manual'},helpers),id=result.module_id;
    await DB.prepare('UPDATE modules SET title=?,title_locked=1,author=?,version=?,group_id=?,note=? WHERE id=?').bind(snapshot.title||s.filename,snapshot.author_group||'',snapshot.version||'1.0.0',group.id,snapshot.notes||'',id).run();
    await DB.prepare('INSERT INTO nas_owners(module_id,user_id,platform) VALUES(?,?,?) ON CONFLICT(module_id) DO UPDATE SET platform=excluded.platform').bind(id,s.user_id,s.platform).run();
    await DB.prepare("UPDATE nas_submissions SET status='approved',module_id=?,reviewed_at=?,source=NULL WHERE id=?").bind(id,Date.now(),s.id).run();await syncAutoAll(DB);return id;
  }
  const summaries=`SELECT id,user_id,module_id,filename,platform,sha256,status,note,created_at,reviewed_at,snapshot FROM nas_submissions`;
  return async function community(request) {
    const url=new URL(request.url),p=url.pathname,method=request.method;
    if(['/','/index.html','/community','/community/','/user/','/admin/'].includes(p)&&['GET','HEAD'].includes(method))
      return new Response(null,{status:308,headers:{Location:(p.startsWith('/admin')?'/admin':'/user')+url.search,'Cache-Control':'no-store'}});
    if(['/user','/admin'].includes(p)&&['GET','HEAD'].includes(method)){
      const page=readFileSync(new URL('./community.html',import.meta.url),'utf8').replace('data-view="workspace"',`data-view="${p==='/user'?'public':'workspace'}"`);
      return new Response(page,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'}});
    }
    const checkerFiles={'/crypto':'../validator/crypto.html','/checker':'../validator/index.html','/checker/app.js':'../validator/app.js','/checker/worker.js':'../validator/worker.js','/checker/acorn.mjs':'./vendor/acorn.mjs'};
    if(p==='/checker/'&&['GET','HEAD'].includes(method))return new Response(null,{status:308,headers:{Location:'/checker'}});
    if(Object.hasOwn(checkerFiles,p)){
      if(!['GET','HEAD'].includes(method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
      return new Response(method==='HEAD'?null:readFileSync(new URL(checkerFiles[p],import.meta.url)),{headers:{'Content-Type':['/checker','/crypto'].includes(p)?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
    }
    if(p==='/user/admin-theme.css'&&['GET','HEAD'].includes(method))return new Response(method==='HEAD'?null:readFileSync(new URL('./admin-theme.css',import.meta.url)),{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-cache'}});
    if(p==='/user/manage.js'&&method==='GET')return new Response(readFileSync(new URL('./manage.js',import.meta.url)),{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'}});
    if(['/user/app.js','/user/style.css','/community/app.js','/community/style.css'].includes(p)&&['GET','HEAD'].includes(method))return new Response(readFileSync(new URL(p.endsWith('.js')?'./app.js':'./style.css',import.meta.url)),{headers:{'Content-Type':p.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
    if(!p.startsWith('/api/community/'))return null;
    try {
      if(p==='/api/community/catalog' && method==='GET'){
        const rows=(await DB.prepare(`SELECT m.id,m.title,m.version,m.author,m.filename,m.group_id,m.note,COALESCE(o.platform,'rex') AS platform FROM modules m LEFT JOIN nas_owners o ON o.module_id=m.id ORDER BY m.sort_order,m.created_at DESC`).all()).results;
        return json(rows.map(m=>{const direct=url.origin+(m.platform==='capy'?'/raw/':'/api/modules/')+encodeURIComponent(m.id)+'.js';return {...m,url:direct,capy:m.platform==='capy'?capyLink(direct):null,rex:m.platform==='rex'?'https://rexnow.tv/widget/?url='+encodeURIComponent(direct):null};}));
      }
      if(p==='/api/community/login' && method==='POST'){
        const ip=request.headers.get('CF-Connecting-IP')||'unknown';
        if(!allowed('ip:'+ip)||!allowed('global',100))fail('登录尝试过多，请五分钟后再试',429);
        const body=await request.json();
        if(typeof body.username!=='string'||!passwordValid(body.password))fail('用户名或密码错误',401);
        const u=await DB.prepare('SELECT * FROM nas_users WHERE username=?').bind(body.username).first() || (await DB.prepare('SELECT * FROM nas_users').all()).results.find(x=>usernameKey(x.username)===usernameKey(body.username));
        // Always perform a password derivation, including unknown/disabled users.
        const valid=await verifyPassword(body.password,u?.password_hash||dummyHash,'');
        if(!u||u.disabled||!valid)fail('用户名或密码错误',401);
        const token=randomBytes(32).toString('hex');
        await DB.prepare('DELETE FROM nas_sessions WHERE expires_at<? OR user_id=?').bind(Date.now(),u.id).run();
        await DB.prepare('INSERT INTO nas_sessions VALUES(?,?,?)').bind(sha(token),u.id,Date.now()+86400000).run();
        return json({ok:true},200,{'Set-Cookie':`nas_dev=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`});
      }
      const user=await identity(request);
      if(p==='/api/community/me'&&method==='GET')return json({user});
      if(!user)fail('请先登录',401);
      if(p==='/api/community/logout'&&method==='POST'){
        await DB.prepare('DELETE FROM nas_sessions WHERE token_hash=?').bind(sha(cookie(request,'nas_dev'))).run();
        if(user.admin)await DB.prepare('DELETE FROM sessions WHERE token=?').bind(cookie(request,'fwh_admin')).run();
        return json({ok:true},200,{'Set-Cookie':'nas_dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
      }
      if(p==='/api/community/admin-account'&&method==='POST'){
        if(!user.admin)fail('仅管理员可修改',403);
        const b=await request.json(),stored=(await DB.prepare("SELECT value FROM settings WHERE key='admin_password'").first())?.value||'';
        if(!allowed('password:admin')||typeof b.current!=='string'||!await verifyPassword(b.current,stored,env.ADMIN_PASSWORD))fail('当前密码错误',403);
        const username=normalizeUsername(b.username);
        if(!validUsername(username)||!passwordValid(b.password))fail('用户名 2–40 字符，新密码 8–256 字符');
        await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('nas_admin_username',?)").bind(username).run();
        await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_password',?)").bind(await hashPassword(b.password)).run();
        await DB.prepare('DELETE FROM sessions').run();await audit('admin','account-change','self');return json({ok:true});
      }
      if(p==='/api/community/rules'){
        if(!user.admin)fail('仅管理员可管理规则',403);
        if(method==='GET')return json(JSON.parse((await DB.prepare("SELECT value FROM settings WHERE key='nas_platform_rules'").first())?.value||'[]'));
        if(method==='POST'){
          const b=await request.json();if(!Array.isArray(b)||b.length>50)fail('最多 50 条规则');
          for(const r of b){if(!['filename','category','code'].includes(r.field)||!['rex','capy'].includes(r.platform))fail('规则字段或平台无效');boundedRegex(r.pattern);}
          await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('nas_platform_rules',?)").bind(JSON.stringify(b)).run();return json({ok:true});
        }
      }
      if(p==='/api/community/preview'&&method==='POST'){
        const fd=await request.formData(),file=fd.get('file');if(!file||!file.size||file.size>MAX_FILE)fail('请选择不超过 2 MiB 的 JS');
        const source=await file.text(),inspection=inspectSource(source,file.name);
        const rules=JSON.parse((await DB.prepare("SELECT value FROM settings WHERE key='nas_platform_rules'").first())?.value||'[]');
        const suggestion=suggestPlatform(rules,{filename:file.name,category:fd.get('platform'),code:source});
        return json({...inspection,suggestion,filename:file.name,sha256:sha(Buffer.from(await file.arrayBuffer())),action:fd.get('module_id')?'update':'new',author_group:fd.get('author_group')||inspection.metadata.author||user.username});
      }
      if(p==='/api/community/password'&&method==='POST'&&!user.admin){
        const b=await request.json(),u=await DB.prepare('SELECT password_hash FROM nas_users WHERE id=?').bind(user.id).first();
        if(!allowed('password:'+user.id)||typeof b.current!=='string'||!passwordValid(b.password)||!await verifyPassword(b.current,u.password_hash,''))fail('当前密码错误或新密码不足 8 字符');
        await DB.prepare('UPDATE nas_users SET password_hash=? WHERE id=?').bind(await hashPassword(b.password),user.id).run();
        await DB.prepare('DELETE FROM nas_sessions WHERE user_id=?').bind(user.id).run();await audit(user.id,'password','self');return json({ok:true});
      }
      if(p==='/api/community/users'){
        if(!user.admin)fail('仅管理员可管理账号',403);
        if(method==='GET')return json((await DB.prepare('SELECT id,username,disabled,created_at FROM nas_users ORDER BY created_at').all()).results);
        if(method==='POST'){
          const b=await request.json();
          b.username=normalizeUsername(b.username);if(!validUsername(b.username)||!passwordValid(b.password))fail('用户名限 2–40 位中文、拉丁字母、数字、下划线或短横线；密码至少 8 字符');
          if((await DB.prepare('SELECT COUNT(*) AS n FROM nas_users').first()).n>=200)fail('账号上限为 200');
          if((await DB.prepare('SELECT username FROM nas_users').all()).results.some(u=>usernameKey(u.username)===usernameKey(b.username)))fail('用户名已存在',409);
          const id=crypto.randomUUID();await DB.prepare('INSERT INTO nas_users(id,username,password_hash,created_at) VALUES(?,?,?,?)').bind(id,b.username,await hashPassword(b.password),Date.now()).run();await audit('admin','create-user',id);return json({ok:true,id},201);
        }
      }
      const um=p.match(/^\/api\/community\/users\/([a-f0-9-]+)$/);
      if(um&&method==='PATCH'){
        if(!user.admin)fail('仅管理员可管理账号',403);
        const b=await request.json();if(!await DB.prepare('SELECT 1 FROM nas_users WHERE id=?').bind(um[1]).first())fail('账号不存在',404);
        if(b.password!==undefined){if(!passwordValid(b.password))fail('密码至少 8 字符');await DB.prepare('UPDATE nas_users SET password_hash=? WHERE id=?').bind(await hashPassword(b.password),um[1]).run();}
        if(typeof b.disabled==='boolean')await DB.prepare('UPDATE nas_users SET disabled=? WHERE id=?').bind(Number(b.disabled),um[1]).run();
        await DB.prepare('DELETE FROM nas_sessions WHERE user_id=?').bind(um[1]).run();await audit('admin','update-user',um[1]);return json({ok:true});
      }
      if(p==='/api/community/classify'&&method==='POST'){
        if(!user.admin)fail('仅管理员可调整播放器分类',403);
        const b=await request.json();if(!['rex','capy'].includes(b.platform)||typeof b.module_id!=='string')fail('无效分类');
        if(!await DB.prepare('SELECT 1 FROM modules WHERE id=?').bind(b.module_id).first())fail('组件不存在',404);
        await DB.prepare('INSERT INTO nas_owners(module_id,user_id,platform) VALUES(?,?,?) ON CONFLICT(module_id) DO UPDATE SET platform=excluded.platform').bind(b.module_id,'admin',b.platform).run();
        await audit('admin','classify-'+b.platform,b.module_id);return json({ok:true});
      }
      if(p==='/api/community/mine'&&method==='GET')return json((await DB.prepare(`SELECT m.id,m.title,m.filename,m.version,o.platform FROM modules m JOIN nas_owners o ON o.module_id=m.id WHERE o.user_id=?`).bind(user.id).all()).results);
      if(p==='/api/community/submissions'||p==='/api/community/publish'){
        if(method==='GET')return json((await DB.prepare(summaries+(user.admin?' ORDER BY created_at DESC LIMIT 500':' WHERE user_id=? ORDER BY created_at DESC LIMIT 200')).bind(...(user.admin?[]:[user.id])).all()).results);
        if(method==='POST'){
          if(p.endsWith('/publish')&&!user.admin)fail('仅管理员可直接发布',403);
          const fd=await request.formData(),f=fd.get('file'),target=String(fd.get('module_id')||''),platform=String(fd.get('platform')||'');
          if(!['rex','capy'].includes(platform)||!f||typeof f.arrayBuffer!=='function'||f.size>MAX_FILE||!f.size)fail('仅接受不超过 2 MiB 的 Rex 或 Capy JS 文件');
          if(!/^[^/\\\x00-\x1f\x7f%]{1,120}\.js$/i.test(f.name)||f.name.startsWith('.'))fail('无效文件名，禁止路径或编码路径');
          if((await DB.prepare('SELECT COUNT(*) AS n FROM nas_submissions WHERE user_id=? AND status=?').bind(user.id,'pending').first()).n>=20)fail('每个账号最多 20 个待审稿',429);
          if((await DB.prepare('SELECT COUNT(*) AS n FROM nas_submissions WHERE user_id=?').bind(user.id).first()).n>=2000)fail('投稿历史已达上限，请联系管理员归档',429);
          let revision='';
          if(target){
            const own=user.admin?{platform}:await DB.prepare('SELECT * FROM nas_owners WHERE module_id=? AND user_id=?').bind(target,user.id).first();if(!own)fail('只能修改自己的组件',403);
            const mod=await DB.prepare('SELECT * FROM modules WHERE id=?').bind(target).first();if(!mod)fail('公开组件已被删除',409);
            if(own.platform!==platform)fail('更新时不能变更播放器类型');
            revision=fingerprint(mod);
            if(await DB.prepare("SELECT 1 FROM nas_submissions WHERE module_id=? AND status='pending'").bind(target).first())fail('该组件已有待审核版本',409);
          }
          const {buffer,descriptor}=await describeFile(f,helpers);
          const inspection=inspectSource(new TextDecoder('utf-8',{fatal:true}).decode(buffer),f.name);
          if(platform==='rex'&&!inspection.encrypted)fail('所有Rex模块均需加密 否则不予通过审核');
          if(platform==='capy'&&inspection.encrypted)fail('REXENC 是 Rex 格式，不能提交为 Capy');
          const snapshot={title:String(fd.get('title')||descriptor.title||f.name.replace(/\.js$/i,'')).trim().slice(0,200),author_group:String(fd.get('author_group')||descriptor.author||user.username).trim().slice(0,80),version:String(fd.get('version')||descriptor.version||'1.0.0').trim().slice(0,40),notes:String(fd.get('notes')||'').slice(0,2000),platform,filename:f.name,action:target?'update':'new'};
          if(!snapshot.title||!snapshot.author_group)fail('标题和作者分组不能为空');
          const id=crypto.randomUUID();
          await DB.prepare('INSERT INTO nas_submissions(id,user_id,module_id,filename,platform,source,sha256,base_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,user.id,target,f.name,platform,new Uint8Array(buffer),descriptor.hash,revision,Date.now()).run();
          await DB.prepare('UPDATE nas_submissions SET snapshot=? WHERE id=?').bind(JSON.stringify(snapshot),id).run();
          await audit(user.id,'submit',id);
          if(user.admin){const submission=await DB.prepare('SELECT * FROM nas_submissions WHERE id=?').bind(id).first();const module_id=await publish(submission,true);return json({ok:true,id,module_id},201);}
          return json({ok:true,id,sha256:descriptor.hash},201);
        }
      }
      const sm=p.match(/^\/api\/community\/submissions\/([a-f0-9-]+)(\/source|\/review)?$/);
      if(sm){
        const s=await DB.prepare('SELECT * FROM nas_submissions WHERE id=?').bind(sm[1]).first();if(!s)fail('投稿不存在',404);
        if(!user.admin&&s.user_id!==user.id)fail('无权访问他人的投稿',403);
        if(sm[2]==='/source'&&method==='GET'){
          if(!s.source)fail('此稿源码已归档，仅保留审核记录和哈希',410);
          return new Response(s.source,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="review.txt"','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
        }
        if(sm[2]==='/review'&&method==='POST'){
          if(!user.admin)fail('仅管理员可审核',403);
          if(s.status!=='pending')fail('此稿已处理',409);
          const b=await request.json();if(!['approve','reject'].includes(b.action))fail('无效审核动作');
          if(typeof b.sha256!=='string'||b.sha256!==s.sha256)fail('请重新查看待审稿，哈希不一致',409);
          let id=s.module_id;
          if(b.action==='approve'){
            const active=await DB.prepare('SELECT 1 FROM nas_users WHERE id=? AND disabled=0').bind(s.user_id).first();if(!active)fail('作者账号已禁用',409);
            if(id){
              const own=await DB.prepare('SELECT user_id,platform FROM nas_owners WHERE module_id=?').bind(id).first(),m=await DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first();
              if(own?.user_id!==s.user_id||own.platform!==s.platform||!m||fingerprint(m)!==s.base_revision)fail('公开版本或归属已变化，请拒绝此稿后重新投稿',409);
            }
            id=await publish(s,false);
          }
          await DB.prepare('UPDATE nas_submissions SET status=?,module_id=?,note=?,reviewed_at=?,source=NULL WHERE id=?').bind(b.action==='approve'?'approved':'rejected',id,String(b.note||'').slice(0,1000),Date.now(),s.id).run();
          await audit('admin',b.action,s.id);return json({ok:true,module_id:id});
        }
      }
      if(p==='/api/community/audit'&&method==='GET'&&user.admin)return json((await DB.prepare('SELECT * FROM nas_audit ORDER BY id DESC LIMIT 500').all()).results);
      fail('接口不存在或不支持此方法',404);
    } catch(e) { throw e; } // Let the outer SQLite transaction roll back before rendering errors.
  };
}
// Precomputed PBKDF2 record used only for timing equalization, never an account.
const dummyHash='pbkdf2$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
