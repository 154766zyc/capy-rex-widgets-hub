import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import oldWorker,{bootstrap as oldBootstrap} from './fixtures/docker-v21.js';
import {exportBackup as oldExport} from './fixtures/v21-backup.js';
import {listen,close,temporary,api,login} from './helpers.js';
import {isPublicAddress,publicFetch,publicLookup} from '../network.js';
import {fetchRemote,assertModuleFile} from '../remote.js';
import {restoreSnapshot} from '../restore-snapshot.js';

const origin='https://modules.example';
const code=(version=1,id='sample.id')=>`WidgetMetadata = {id:'${id}',title:'示例模块',version:'${version}',author:'作者'};\nfunction load(){return [];}`;
const json=async response=>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
async function start(t,options={}){
  const directory=options.directory||temporary(t);
  let {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true',...options.config},options.dependencies);
  t.after(()=>close(server));
  const cookie=await login(base,'test-password');
  const call=(path,options={})=>api(base,path,{cookie,...options});
  return {server,base,directory,cookie,call};
}
async function upload(s,source=code(),name='sample.js',mode='',target=''){
  const file=new File([source],name),fd=new FormData();fd.append('files',file);if(target)fd.append('target_id',target);
  const plan=await json(await s.call('/api/admin/modules/upload/preview',{method:'POST',body:fd}));
  const row=plan.rows[0],commit=new FormData();
  for(const [key,value] of Object.entries({job_id:plan.job_id,index:'0',action:row.target?'replace':'new',target_id:target||row.target?.id||'',mode}))commit.append(key,value);
  commit.append('file',file);
  return json(await s.call('/api/admin/modules/upload/commit',{method:'POST',body:commit}));
}
async function source(s,url=origin+'/collection.rex'){
  const result=await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url}}));
  return result.subscription.id;
}
async function cycle(s,id){
  for(let n=0;n<10;n++){
    const result=await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));
    if(result.done)return result;
  }throw Error('cycle not finished');
}

test('Docker 2.1 migration preserves bytes, IDs, aliases, source mappings, metadata, password and public responses',async t=>{
  const directory=temporary(t),kv=new SQLiteKV(join(directory,'rex.sqlite')),DB=new SQLiteD1(kv.db),env={KV:kv,DB,ADMIN_PASSWORD:'test-password',ALLOW_HTTP:true};
  await oldBootstrap(env);
  await kv.put('file:old-id','REXENC\nold binary\u0000\u00ff');
  await DB.prepare(`INSERT INTO modules(id,filename,widget_id,title,version,author,note,source_url,group_id,sort_order,is_encrypted,created_at,updated_at)
    VALUES ('old-id','old.js','stable.widget','原始标题','1','作者','我的备注',?,'g1',9,1,100,200)`).bind(origin+'/a.js').run();
  await DB.prepare("INSERT INTO groups(id,name,position) VALUES('g1','收藏',0)").run();
  await DB.prepare("INSERT INTO collections(id,slug,title,description,auto_all) VALUES('c1','stable','我的合集','描述',0),('c2','all','全部', '',1)").run();
  await DB.prepare("INSERT INTO collection_modules VALUES('c1','old-id',0),('c2','old-id',0)").run();
  await DB.prepare("INSERT INTO collection_aliases VALUES('previous','c1')").run();
  await DB.prepare(`INSERT INTO sources(id,url,title,enabled,status,next_sync_at,last_success_at) VALUES('source1',?,'旧源',0,'paused',12345,123)`).bind(origin+'/collection.rex').run();
  await DB.prepare(`INSERT INTO source_items(source_id,remote_key,remote_id,identity,url,module_id,title,position)
    VALUES('source1','id:remote1','remote1','oldidentity',?,'old-id','上游标题',0)`).bind(origin+'/a.js').run();
  const expected=await (await oldWorker.fetch(new Request('http://stable.example/api/collections/stable.rex'),env)).json();
  const backup3=await oldExport(env);
  // A real 2.1 marker guarantees a full SQL+KV pre-v3 snapshot.
  await DB.prepare("INSERT INTO settings VALUES('docker_v2','1'),('docker_v21','1')").run();kv.close();
  const s=await start(t,{directory,config:{PUBLIC_URL:'http://stable.example'}});
  for(const suffix of ['', '.rex','.fwd','/rex','/fwd'])assert.deepEqual(await json(await s.call('/api/collections/stable'+suffix)),expected);
  assert.deepEqual(await json(await s.call('/api/collections/previous.rex')),expected);
  assert.equal(await (await s.call('/api/modules/old-id/raw')).text(),'REXENC\nold binary\u0000\u00ff');
  const modules=await json(await s.call('/api/admin/modules'));assert.equal(modules[0].id,'old-id');
  assert.equal(modules[0].note,'我的备注');assert.equal(modules[0].sort_order,9);assert.equal(modules[0].group_id,'g1');
  const sources=await json(await s.call('/api/admin/subscriptions'));assert.equal(sources[0].id,'source1');assert.equal(sources[0].enabled,0);
  assert.equal((await json(await s.call('/api/admin/subscriptions/source1/items')))[0].module_id,'old-id');
  const names=readdirSync(join(directory,'backups'));assert.equal(names.length,1);assert.match(names[0],/^pre-v3-/);
  const snapshot=new DatabaseSync(join(directory,'backups',names[0]),{readOnly:true});
  assert.equal(snapshot.prepare('SELECT module_id FROM source_items').get().module_id,'old-id');snapshot.close();
  await json(await s.call('/api/admin/collections',{method:'PATCH',json:{id:'c1',slug:'renamed'}}));
  assert.deepEqual(await json(await s.call('/api/collections/stable.rex')),expected);
  assert.equal((await s.call('/api/admin/collections',{method:'PATCH',json:{id:'c1',slug:'all'}})).status,409);
  const added=await upload(s,code(),'new.js');
  const cols=await json(await s.call('/api/admin/collections'));
  assert.deepEqual(cols.find(c=>c.id==='c1').moduleIds,['old-id']);
  assert.deepEqual(cols.find(c=>c.id==='c2').moduleIds,['old-id',added.module_id]);
  const other=await start(t);
  await json(await other.call('/api/admin/backup/restore',{method:'POST',json:backup3}));
  assert.equal((await json(await other.call('/api/admin/subscriptions')))[0].id,'source1');
  assert.equal((await json(await other.call('/api/admin/modules')))[0].widget_id,'stable.widget');
  assert.equal(await (await other.call('/api/modules/old-id/raw')).text(),'REXENC\nold binary\u0000\u00ff');
});

test('upload preview, immutable replacement, seven-day previous version, current backup/restore and stale previews',async t=>{
  const s=await start(t),first=await upload(s),id=first.module_id;
  await json(await s.call('/api/admin/collections',{method:'POST',json:{slug:'mine',title:'Mine',moduleIds:[id]}}));
  await json(await s.call('/api/admin/modules?id='+id,{method:'PATCH',json:{note:'不变',title:'锁定名称'}}));
  await upload(s,code(2),'renamed.js');
  assert.equal(await (await s.call('/api/modules/'+id+'.js')).text(),code(2));
  const previous=(await json(await s.call('/api/admin/modules/'+id+'/previous-version'))).previous;
  assert.ok(previous);assert.ok(previous.expires_at>Date.now()+6.9*86400000);
  const backup=await json(await s.call('/api/admin/backup'));assert.equal(backup.format,7);
  assert.equal(Buffer.from(backup.files[id].content,'base64').toString(),code(2));
  assert.equal(backup.meta.previousVersions.length,1);
  const other=await start(t);
  await json(await other.call('/api/admin/backup/restore',{method:'POST',json:backup}));
  assert.equal(await (await other.call('/api/modules/'+id+'/raw')).text(),code(2));
  const prior=(await json(await other.call('/api/admin/modules/'+id+'/previous-version'))).previous;
  await json(await other.call('/api/admin/modules/'+id+'/previous-version',{method:'POST',json:{created_at:prior.created_at}}));
  assert.equal(await (await other.call('/api/modules/'+id+'/raw')).text(),code());
  const mod=(await json(await other.call('/api/admin/modules')))[0];assert.equal(mod.id,id);assert.equal(mod.note,'不变');assert.equal(mod.title,'锁定名称');
  assert.equal((await json(await other.call('/api/collections/mine.rex'))).widgets[0].id,'sample.id');
  const invalid=structuredClone(backup);invalid.meta.collections[0].moduleIds=['missing'];
  assert.equal((await other.call('/api/admin/backup/restore',{method:'POST',json:invalid})).status,400);
  assert.equal(await (await other.call('/api/modules/'+id+'/raw')).text(),code());
  const fd=new FormData();fd.append('files',new File([code(3)],'next.js'));
  const preview=await json(await other.call('/api/admin/modules/upload/preview',{method:'POST',body:fd}));
  await upload(other,code(4),'four.js');
  fd.set('file',new File([code(3)],'next.js'));fd.set('job_id',preview.job_id);fd.set('index','0');fd.set('action','replace');fd.set('target_id',id);
  assert.equal((await other.call('/api/admin/modules/upload/commit',{method:'POST',body:fd})).status,400);
  assert.equal(await (await other.call('/api/modules/'+id+'/raw')).text(),code(4));
});

test('subscription cycles preserve identity, personal order and notes; removals and failed downloads keep last good bytes',async t=>{
  let version=1,fail=false,items=[{id:'a',url:origin+'/a.js',title:'A'}];
  const s=await start(t,{dependencies:{remoteFetch:async url=>new Response(url.endsWith('.rex')?JSON.stringify({title:'订阅',widgets:items}):fail?'<html>Failure</html>':code(version))}});
  const id=await source(s);await cycle(s,id);
  const module=(await json(await s.call('/api/admin/modules')))[0],mid=module.id;
  await json(await s.call('/api/admin/modules?id='+mid,{method:'PATCH',json:{note:'自定义备注'}}));
  const col=await json(await s.call('/api/admin/collections',{method:'POST',json:{slug:'chosen',title:'Chosen',moduleIds:[mid]}}));
  version=2;items.push({id:'b',url:origin+'/b.js',title:'B'});await cycle(s,id);
  assert.equal(await (await s.call('/api/modules/'+mid+'/raw')).text(),code(2));
  let mods=await json(await s.call('/api/admin/modules'));assert.equal(mods.length,2);assert.equal(mods.find(m=>m.id===mid).note,'自定义备注');
  assert.deepEqual((await json(await s.call('/api/admin/collections'))).find(c=>c.id===col.id).moduleIds,[mid]);
  const database=new DatabaseSync(join(s.directory,'rex.sqlite'));
  database.exec("CREATE TRIGGER fail_publish BEFORE UPDATE ON modules BEGIN SELECT RAISE(ABORT,'injected publication failure'); END");
  version=3;const failed=await cycle(s,id);assert.equal(failed.summary.failed,2);
  assert.equal(await (await s.call('/api/modules/'+mid+'/raw')).text(),code(2));
  database.exec('DROP TRIGGER fail_publish');database.close();
  fail=true;items=items.slice(0,1);const result=await cycle(s,id);assert.equal(result.summary.failed,1);assert.equal(result.summary.removed,1);
  assert.equal(await (await s.call('/api/modules/'+mid+'/raw')).text(),code(2));
  assert.equal((await json(await s.call('/api/admin/modules'))).length,2);
  const backup=await json(await s.call('/api/admin/backup'));
  const other=await start(t);await json(await other.call('/api/admin/backup/restore',{method:'POST',json:backup}));
  assert.equal((await json(await other.call('/api/admin/subscriptions')))[0].id,id);
  assert.equal((await json(await other.call('/api/admin/subscriptions/'+id+'/items'))).find(i=>i.remote_id==='a').module_id,mid);
});

for(const operation of ['pause','delete','reset','restore'])test('slow downloads remain responsive and cannot write after '+operation,async t=>{
  let release,started;const waiting=new Promise(r=>{started=r;});
  let slow=false;const manifest=JSON.stringify({title:'订阅',widgets:[{id:'a',url:origin+'/a.js',title:'A'}]});
  const s=await start(t,{dependencies:{remoteFetch:async url=>{
    if(url.endsWith('.rex'))return new Response(manifest);
    if(!slow)return new Response(code());started();return new Promise(r=>{release=()=>r(new Response(code(2)));});
  }}});
  const id=await source(s);await cycle(s,id);const before=await json(await s.call('/api/admin/backup')),mid=before.meta.modules[0].id;
  slow=true;await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));
  const pending=s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});await waiting;
  const quick=await Promise.race([s.call('/api/admin/modules'),new Promise((_,reject)=>setTimeout(()=>reject(Error('UI blocked by download')),1500).unref())]);assert.equal(quick.status,200);
  if(operation==='pause')await json(await s.call('/api/admin/subscriptions/'+id,{method:'PATCH',json:{enabled:false}}));
  if(operation==='delete')await json(await s.call('/api/admin/subscriptions/'+id,{method:'DELETE'}));
  if(operation==='reset')await json(await s.call('/api/admin/reset',{method:'POST'}));
  if(operation==='restore')await json(await s.call('/api/admin/backup/restore',{method:'POST',json:before}));
  release();assert.equal((await pending).status,400);
  if(operation==='reset'){
    assert.deepEqual(await json(await s.call('/api/admin/modules')),[]);assert.equal((await s.call('/api/modules/'+mid+'/raw')).status,404);
  }else assert.equal(await (await s.call('/api/modules/'+mid+'/raw')).text(),code());
});

test('SQLite expiry, shared-connection short transaction isolation and rollback include module bytes',async t=>{
  const kv=new SQLiteKV(join(temporary(t),'rex.sqlite')),DB=new SQLiteD1(kv.db,kv.gate);t.after(()=>kv.close());
  await kv.put('expires','old',{expiration:Math.floor(Date.now()/1000)-1});assert.equal(await kv.get('expires'),null);
  await kv.put('ttl','live',{expirationTtl:60});assert.equal(await kv.get('ttl'),'live');
  await DB.prepare('CREATE TABLE example(id TEXT PRIMARY KEY,value TEXT)').run();
  let entered,release;const waiting=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
  const transaction=kv.transaction(async()=>{await kv.put('file:a','bad');await DB.prepare("INSERT INTO example VALUES('a','bad')").run();entered();await hold;throw Error('rollback');});
  await waiting;
  const read=DB.prepare('SELECT * FROM example').all();release();await assert.rejects(transaction,/rollback/);
  assert.deepEqual((await read).results,[]);assert.equal(await kv.get('file:a'),null);
  await kv.cleanup();assert.equal(kv.db.prepare('SELECT value FROM kv WHERE key=?').get('expires'),undefined);
});

test('public transport rejects private/reserved DNS targets, redirects, HTML/JSON and oversized streams',async()=>{
  for(const address of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.31.1.1','192.168.1.1','100.64.0.1','198.18.1.1','198.19.255.254','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1','2002:7f00:1::1'])assert.equal(isPublicAddress(address),false,address);
  for(const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
  await assert.rejects(publicFetch('http://127.0.0.1/'),/地址/);
  await assert.rejects(new Promise((resolve,reject)=>publicLookup('localhost',{},(error,result)=>error?reject(error):resolve(result))),/内网|保留/);
  await assert.rejects(fetchRemote(origin,1024,{transport:async()=>new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}})}),/地址/);
  await assert.rejects(fetchRemote(origin,1024,{transport:async()=>new Response(null,{status:302,headers:{location:'/loop'}})}),/重定向/);
  for(const body of ['<html>Oops</html>','{"error":true}'])assert.throws(()=>assertModuleFile(Buffer.from(body)),/网页|JSON/);
  await assert.rejects(fetchRemote(origin,3,{transport:async()=>new Response('1234')}),/大小/);
});

test('HTTP authentication, proxy trust, encrypted source protection and orphan-file denial',async t=>{
  const s=await start(t,{config:{PUBLIC_URL:'https://hub.example'}});
  const auth=await s.call('/api/admin/auth',{method:'POST',json:{password:'test-password'}});assert.match(auth.headers.get('set-cookie'),/Secure/);
  assert.equal((await api(s.base,'/api/admin/modules')).status,401);
  const result=await upload(s,'REXENC\nprivate payload','encrypted.js');
  assert.equal((await s.call('/api/admin/modules/'+result.module_id+'/source')).status,400);
  assert.equal((await s.call('/api/admin/modules/import',{method:'POST',json:{url:'http://127.0.0.1/private'}})).status,400);
  const raw=await s.call('/api/modules/'+result.module_id+'.js');const etag=raw.headers.get('etag');assert.ok(etag);
  assert.equal((await s.call('/api/modules/'+result.module_id+'.js',{headers:{'If-None-Match':etag}})).status,304);
  await json(await s.call('/api/admin/modules?id='+result.module_id,{method:'DELETE'}));
  assert.equal((await s.call('/api/modules/'+result.module_id+'.js')).status,404);
});

for(const trusted of [false,true])test('HTTP adapter '+(trusted?'accepts trusted':'ignores forged')+' proxy identity and scheme',async t=>{
  const s=await start(t,{config:{TRUST_PROXY:String(trusted)}});
  for(let n=0;n<5;n++){
    assert.equal((await api(s.base,'/api/admin/auth',{method:'POST',json:{password:'wrong'},headers:{
      'CF-Connecting-IP':'192.0.2.'+n,'X-Forwarded-For':trusted?'192.0.2.1':'192.0.2.'+n}})).status,401);
  }
  assert.equal((await api(s.base,'/api/admin/auth',{method:'POST',json:{password:'test-password'},headers:{'CF-Connecting-IP':'198.51.100.1','X-Forwarded-For':'192.0.2.1'}})).status,429);
  if(trusted){
    const response=await api(s.base,'/api/admin/auth',{method:'POST',json:{password:'test-password'},headers:{
      'X-Forwarded-For':'192.0.2.2','X-Forwarded-Host':'hub.example','X-Forwarded-Proto':'https'}});
    assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure/);
  }
});

async function until(check){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,25));}
  throw Error('background condition timed out');
}
test('restart resumes durable subscription cursor and scheduler respects the next six-hour deadline',async t=>{
  const directory=temporary(t);let downloads=0;
  // 3.5.8：Cloudflare 版每轮处理 6 个，Docker 版 2 个；都多放一个，保证第一轮只做了一部分。
  const per=process.env.REX_TEST_RUNTIME==='cf'?6:2,total=per+1;
  const widgets=Array.from({length:total},(_,i)=>'w'+i).map(id=>({id,url:origin+'/'+id+'.js',title:id}));
  const remoteFetch=async url=>new Response(url.endsWith('.rex')?JSON.stringify({title:'Restart',widgets}):(downloads++,code()));
  let {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'},{remoteFetch});
  t.after(()=>close(server));let cookie=await login(base,'test-password');
  const s={call:(path,options={})=>api(base,path,{cookie,...options})};
  const id=await source(s);
  await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));
  const batch=await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));assert.equal(batch.processed,per);
  await close(server);
  ({server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password'},{remoteFetch}));cookie=await login(base,'test-password');
  await until(async()=>{const sources=await json(await s.call('/api/admin/subscriptions'));return sources[0].status==='ok';});
  const status=(await json(await s.call('/api/admin/subscriptions')))[0];assert.equal(status.id,id);assert.equal(status.cursor,total);
  assert.ok(status.next_sync_at>Date.now()+5.9*3600000);assert.equal(downloads,total);
  assert.equal((await json(await s.call('/api/admin/modules'))).length,total);
});

test('shutdown aborts active background transport before closing SQLite, and interrupted work retries after restart',async t=>{
  const directory=temporary(t);let started,aborted=false;
  const downloading=new Promise(r=>started=r);
  const manifest=JSON.stringify({title:'Shutdown',widgets:[{id:'a',url:origin+'/a.js'}]});
  const remoteFetch=async(url,options)=>{
    if(url.endsWith('.rex'))return new Response(manifest);
    started();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(options.signal.reason);},{once:true});});
  };
  let {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'},{remoteFetch});
  let cookie=await login(base,'test-password');
  const s={call:(path,options={})=>api(base,path,{cookie,...options})};const id=await source(s);
  await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));await close(server);
  ({server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password'},{remoteFetch}));
  await downloading;await close(server);assert.equal(aborted,true);
  const interrupted=new DatabaseSync(join(directory,'rex.sqlite'));
  assert.equal(interrupted.prepare('SELECT last_error FROM subscription_sources WHERE id=?').get(id).last_error,'服务重启，本次同步已中止');interrupted.close();
  ({server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password'},{remoteFetch:async url=>new Response(url.endsWith('.rex')?manifest:code(2))}));
  t.after(()=>close(server));cookie=await login(base,'test-password');
  await until(async()=>{const sources=await json(await s.call('/api/admin/subscriptions'));return sources[0].status==='ok';});
  const mods=await json(await s.call('/api/admin/modules'));assert.equal(mods.length,1);assert.equal(await (await s.call('/api/modules/'+mods[0].id+'/raw')).text(),code(2));
});

test('offline recovery verifies snapshots and saves the upgraded database instead of deleting it',async t=>{
  const directory=temporary(t),kv=new SQLiteKV(join(directory,'rex.sqlite'));
  await kv.put('modules','[]');await kv.put('collections','[]');kv.close();
  const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'});
  const cookie=await login(base,'test-password');await json(await api(base,'/api/admin/collections',{method:'POST',cookie,json:{slug:'new',title:'Upgrade data'}}));
  await close(server);
  const file=join(directory,'backups',readdirSync(join(directory,'backups'))[0]);
  assert.throws(()=>restoreSnapshot(directory,file,false),/停止/);
  const saved=restoreSnapshot(directory,file,true);
  const prior=new DatabaseSync(join(directory,'rex.sqlite'));assert.equal(prior.prepare("SELECT name FROM sqlite_master WHERE name='modules'").get(),undefined);prior.close();
  const current=new DatabaseSync(join(saved,'rex.sqlite'));assert.equal(current.prepare('SELECT title FROM collections').get().title,'Upgrade data');current.close();
});
