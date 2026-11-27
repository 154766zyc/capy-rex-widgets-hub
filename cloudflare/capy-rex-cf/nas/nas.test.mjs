import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialize } from './init.mjs';
import { capyLink } from './community.mjs';
import { listen,close,api,login } from '../test/helpers.js';
const pass=()=>randomBytes(24).toString('base64url');
const code=(v,id='nas.sample')=>`var WidgetMetadata={id:'${id}',title:'中文组件',version:'${v}',modules:[]};\nglobalThis.NAS_SHOULD_NOT_EXECUTE=true;\nasync function get(){return [];}`;
const good=async r=>{const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};

test('NAS real HTTP: initialization, ownership, immutable review, publication, session security and persistence',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'rex-nas-test-')),adminPassword=pass(),alicePassword=pass(),bobPassword=pass();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  await initialize(directory,adminPassword);
  await assert.rejects(()=>initialize(directory,pass()),/数据库已存在/);
  let {server,base}=await listen({DATA_DIR:directory,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});
  t.after(async()=>{if(server)await close(server);});
  let admin=await login(base,adminPassword),alice,bob,aliceId,firstId,moduleId;
  const call=(path,who,options={})=>api(base,'/api/community/'+path,{cookie:who,...options});
  const post=(path,who,json)=>call(path,who,{method:'POST',json});
  async function submit(who,source=code(1),target='',name='sample.js',platform='capy'){
    const body=new FormData();body.set('file',new File([source],name));body.set('module_id',target);body.set('platform',platform);return call('submissions',who,{method:'POST',body});
  }
  async function review(id,action='approve',hash){const all=await good(await call('submissions',admin)),s=all.find(s=>s.id===id);return post('submissions/'+id+'/review',admin,{action,sha256:hash??s.sha256,note:'测试审核'});}
  await t.test('no default password, PBKDF2 storage, admin creates users',async()=>{
    const db=new DatabaseSync(join(directory,'rex.sqlite'));const stored=db.prepare("SELECT value FROM settings WHERE key='admin_password'").get().value;assert.match(stored,/^pbkdf2\$/);assert.notEqual(stored,adminPassword);db.close();
    aliceId=(await good(await post('users',admin,{username:'alice',password:alicePassword}))).id;
    await good(await post('users',admin,{username:'bob',password:bobPassword}));
    // Developer login requires both username and password.
    const a=await post('login',null,{username:'alice',password:alicePassword});assert.equal(a.status,200);alice=a.headers.get('set-cookie').split(';')[0];assert.match(a.headers.get('set-cookie'),/HttpOnly/);
    const b=await post('login',null,{username:'bob',password:bobPassword});assert.equal(b.status,200);bob=b.headers.get('set-cookie').split(';')[0];
  });
  await t.test('developers cannot administer, impersonate owner, read audit or other drafts',async()=>{
    assert.equal((await call('users',alice)).status,403);
    assert.equal((await api(base,'/api/admin/modules',{cookie:alice})).status,401);
    assert.equal((await call('audit',alice)).status,404);
    assert.equal((await submit(alice,code(1),'foreign-id')).status,403);
    const s=await good(await submit(alice));firstId=s.id;
    assert.equal((await call('submissions/'+firstId+'/source',bob)).status,403);
    assert.equal((await call('submissions/'+firstId+'/source')).status,401);
    assert.equal((await post('submissions/'+firstId+'/review',alice,{action:'approve',sha256:s.sha256})).status,403);
    assert.equal((await good(await call('submissions',bob))).length,0);
  });
  await t.test('pending source never public or executed; source response is plain text',async()=>{
    assert.equal((await good(await call('catalog'))).length,0);
    const r=await call('submissions/'+firstId+'/source',alice);assert.match(r.headers.get('content-type'),/text\/plain/);assert.equal(await r.text(),code(1));assert.match(r.headers.get('content-security-policy'),/sandbox/);
    assert.equal(globalThis.NAS_SHOULD_NOT_EXECUTE,undefined);
    assert.equal((await api(base,'/api/modules/'+firstId+'.js')).status,404);
  });
  await t.test('review hashes, atomic publication, Capy UTF-8 base64url, original module API',async()=>{
    assert.equal((await review(firstId,'approve','incorrect')).status,409);
    moduleId=(await good(await review(firstId))).module_id;
    const publicRow=(await good(await call('catalog')))[0];assert.equal(publicRow.platform,'capy');assert.equal(Buffer.from(publicRow.capy.split('data=')[1],'base64url').toString(),publicRow.url);
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(1));
    assert.equal((await review(firstId)).status,409);
    assert.equal((await call('submissions/'+firstId+'/source',admin)).status,410);
    const u='https://example.com/中文.js?q=a%26b#片段';assert.equal(Buffer.from(capyLink(u).split('data=')[1],'base64url').toString(),u);
  });
  await t.test('revisions stay isolated, other users cannot replace, rejection preserves published bytes',async()=>{
    assert.equal((await submit(bob,code(2),moduleId)).status,403);
    const draft=await good(await submit(alice,code(2),moduleId));
    assert.equal((await submit(alice,code(3),moduleId)).status,409);
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(1));
    await good(await review(draft.id,'reject'));
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(1));
    const second=await good(await submit(alice,code(2),moduleId));await good(await review(second.id));
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(2));
  });
  await t.test('duplicate identity cannot steal ownership',async()=>{
    const s=await good(await submit(bob,code(9)));assert.equal((await review(s.id)).status,409);await good(await review(s.id,'reject'));
    assert.equal((await good(await call('mine',bob))).length,0);
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(2));
  });
  await t.test('stale admin edits invalidate draft',async()=>{
    const s=await good(await submit(alice,code(3),moduleId));await good(await api(base,'/api/admin/modules?id='+moduleId,{cookie:admin,method:'PATCH',json:{title:'管理员更新'}}));assert.equal((await review(s.id)).status,409);await good(await review(s.id,'reject'));
  });
  await t.test('database failure rolls back publication and review together',async()=>{
    const s=await good(await submit(alice,code(4),moduleId));
    const db=new DatabaseSync(join(directory,'rex.sqlite'));db.exec("CREATE TRIGGER nas_test_failure BEFORE UPDATE ON nas_submissions WHEN NEW.status='approved' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.equal((await review(s.id)).status,400);
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(2));
    assert.equal((await good(await call('submissions',admin))).find(x=>x.id===s.id).status,'pending');
    db.exec('DROP TRIGGER nas_test_failure');db.close();await good(await review(s.id));
  });
  await t.test('concurrent review publishes once',async()=>{
    const s=await good(await submit(alice,code(5),moduleId));const r=await Promise.all([review(s.id),review(s.id)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
  });
  await t.test('malformed filename, encrypted code, oversized upload and cross-site writes fail',async()=>{
    assert.equal((await submit(alice,code(1,'path'),'','..%2fsecret.js')).status,400);
    assert.equal((await submit(alice,'REXENC\n0123456789','','encrypted.js')).status,400);
    assert.equal((await submit(alice,'x'.repeat(2*1024*1024+1),'','large.js')).status,400);
    assert.equal((await api(base,'/api/community/users',{cookie:admin,method:'POST',json:{username:'evil',password:pass()},headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await api(base,'/api/admin/settings',{cookie:admin,method:'POST',json:{},headers:{Origin:'null'}})).status,403);
  });
  await t.test('disabled author cannot log in or publish; password reset revokes sessions',async()=>{
    const s=await good(await submit(alice,code(6),moduleId));await good(await call('users/'+aliceId,admin,{method:'PATCH',json:{disabled:true}}));
    assert.equal((await call('submissions',alice)).status,401);assert.equal((await review(s.id)).status,409);
    assert.equal((await post('login',null,{username:'alice',password:alicePassword})).status,401);
    await good(await call('users/'+aliceId,admin,{method:'PATCH',json:{disabled:false,password:pass()}}));await good(await review(s.id,'reject'));
  });
  await t.test('Capy excluded from Rex collections; admin classification is explicit',async()=>{
    const c=await good(await api(base,'/api/admin/collections',{cookie:admin,method:'POST',json:{title:'播放器隔离',slug:'separate',moduleIds:[moduleId]}}));
    assert.equal((await good(await api(base,'/api/collections/separate.rex'))).widgets.length,0);
    assert.equal((await post('classify',bob,{module_id:moduleId,platform:'rex'})).status,403);
    await good(await post('classify',admin,{module_id:moduleId,platform:'rex'}));
    assert.equal((await good(await api(base,'/api/collections/separate.rex'))).widgets.length,1);
    await good(await post('classify',admin,{module_id:moduleId,platform:'capy'}));
    assert.equal((await api(base,'/api/admin/change-password',{cookie:admin,method:'POST',json:{password:'short'}})).status,400);
  });
  await t.test('static page has restrictive CSP and no inline code',async()=>{
    const old=await api(base,'/community');assert.equal(old.status,308);assert.equal(old.headers.get('location'),'/user');const r=await api(base,'/user');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await r.text(),/CapyPlayer/);
    assert.equal((await api(base,'/community/app.js')).status,200);
  });
  await t.test('restart preserves accounts, audit, ownership and published bytes without ADMIN_SECRET',async()=>{
    await close(server);server=null;
    const next=await listen({DATA_DIR:directory,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});server=next.server;base=next.base;admin=await login(base,adminPassword);
    assert.equal((await good(await call('users',admin))).length,2);
    assert.ok((await good(await call('audit',admin))).length>5);
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(5));
  });
  await t.test('live full SQLite backup and offline recovery retain NAS data and revoke sessions',async()=>{
    const backup=spawnSync(process.execPath,[fileURLToPath(new URL('./backup.mjs',import.meta.url))],{env:{...process.env,DATA_DIR:directory},encoding:'utf8'});assert.equal(backup.status,0,backup.stderr);
    const filename=readdirSync(join(directory,'backups')).find(x=>x.startsWith('nas-full-'));assert.ok(filename);
    await good(await api(base,'/api/admin/modules?id='+moduleId,{cookie:admin,method:'PATCH',json:{title:'备份后的修改'}}));
    await close(server);server=null;
    const restored=spawnSync(process.execPath,[fileURLToPath(new URL('./restore.mjs',import.meta.url)),join(directory,'backups',filename),'--offline'],{env:{...process.env,DATA_DIR:directory},encoding:'utf8'});assert.equal(restored.status,0,restored.stderr);
    const next=await listen({DATA_DIR:directory,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});server=next.server;base=next.base;
    assert.equal((await call('users',admin)).status,401);
    admin=await login(base,adminPassword);
    assert.equal((await good(await call('users',admin))).length,2);
    assert.ok((await good(await call('submissions',admin))).length>5);
    assert.notEqual((await good(await call('catalog')))[0].title,'备份后的修改');
    assert.equal(await (await api(base,'/api/modules/'+moduleId+'.js')).text(),code(5));
  });
  await t.test('login rate limit cannot be bypassed by forged CF client IP',async()=>{
    let status;
    for(let i=0;i<14;i++)status=(await api(base,'/api/community/login',{method:'POST',json:{username:'nobody',password:pass()},headers:{'CF-Connecting-IP':'203.0.113.'+i}})).status;
    assert.equal(status,429);
  });
});
