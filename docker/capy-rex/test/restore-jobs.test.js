import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {SQLiteKV} from '../kv.js';
import {decodeBase64} from '../binary.js';
import {listen,close,temporary,api,login} from './helpers.js';
// The same gate test applies to the Cloudflare build's KV class.
const KVClass=process.env.REX_TEST_RUNTIME==='cf'?(await import('../cf/do-storage.js')).DOKV:SQLiteKV;

const root='/api/admin/backup/restore/jobs',bytes=Buffer.from('REXENC\nsynthetic-restore-bytes\0\xff'),digest=b=>createHash('sha256').update(b).digest('hex');
function backup(content=bytes){return {format:7,files:{stable:{filename:'stable.js',encoding:'base64',content:content.toString('base64'),hash:digest(content),size:content.length}},meta:{modules:[{id:'stable',filename:'stable.js',title:'Saved title',is_encrypted:1,note:'saved note',sort_order:9}],collections:[{id:'col',slug:'stable',title:'Mine',moduleIds:['stable']}],shareAliases:[],names:[],filenameSettings:{auto_clean:true},icons:{sources:[],entries:[],assets:[]}}};}
async function fixture(t,directory=temporary(t)){
 const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'restore-test-password',DISABLE_SCHEDULER:'true'});let closed=false;
 t.after(async()=>{if(!closed)await close(server);});const cookie=await login(base,'restore-test-password');
 return {directory,base,cookie,call:(path,options={})=>api(base,path,{cookie,...options}),async close(){closed=true;await close(server);}};
}
async function json(response){const r=await response;const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function reserve(f,id=crypto.randomUUID()){const r=await json(f.call(root,{method:'POST',json:{id}}));return r.job.id;}
const submit=(f,id,body)=>json(f.call(root+'/'+id,{method:'PUT',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}));
async function finished(f,id){for(let i=0;i<200;i++){const {job}=await json(f.call(root+'/'+id));if(['done','failed','interrupted'].includes(job.status))return job;await delay(5);}throw Error('Restore job did not finish');}
const sql=f=>new DatabaseSync(join(f.directory,'rex.sqlite'));

test('strict Base64 decoder accepts binary and large modules without backtracking, and rejects malformed/oversized values',()=>{
 for(const b of [Buffer.alloc(0),Buffer.from([0,255]),Buffer.from('abc'),Buffer.alloc(4*1024*1024,255)])assert.deepEqual(decodeBase64(b.toString('base64'),25*1024*1024),b);
 for(const value of ['a','abc','A===','====','ab=c','ab_c','ab-c','YW Jj','YWJj\n','YQ==AAAA'])assert.throws(()=>decodeBase64(value,100),/base64/);
 assert.throws(()=>decodeBase64('YWJj',2),/大小/);
});

test('restore jobs and status require an unexpired administrator session',async t=>{
 const f=await fixture(t),id=await reserve(f);
 for(const [path,method] of [[root,'POST'],[root+'/current','GET'],[root+'/'+id,'GET'],[root+'/'+id,'PUT']])assert.equal((await api(f.base,path,{method,json:method==='POST'?{id}:undefined})).status,401);
 const db=sql(f);db.prepare('UPDATE sessions SET expires_at=0').run();db.close();assert.equal((await f.call(root+'/'+id)).status,401);
});

test('reservation and submission are idempotent; only one async or legacy restore runs; raw file bytes and public identity survive',async t=>{
 const f=await fixture(t),id=await reserve(f);
 assert.equal((await json(f.call(root,{method:'POST',json:{id}}))).job.id,id);
 assert.equal((await f.call(root,{method:'POST',json:{id:crypto.randomUUID()}})).status,409);
 assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:backup()})).status,409);
 await submit(f,id,backup());const job=await finished(f,id);assert.equal(job.status,'done');assert.equal(job.result.modules,1);
 const manifest=await json(f.call('/api/collections/stable.rex'));assert.equal(manifest.widgets[0].title,'Saved title');
 assert.deepEqual(Buffer.from(await(await f.call('/api/modules/stable.js')).arrayBuffer()),bytes);
 await submit(f,id,backup(Buffer.from('REXENC\nDo not overwrite')));assert.deepEqual(Buffer.from(await(await f.call('/api/modules/stable/raw')).arrayBuffer()),bytes);
 const m=(await json(f.call('/api/admin/modules')))[0];assert.equal(m.id,'stable');assert.equal(m.note,'saved note');assert.equal(m.sort_order,9);
 assert.equal((await json(f.call(root+'/current'))).job,null);
});

test('invalid JSON and corrupt hashes fail without modifying data and do not leave the global restore lock held',async t=>{
 const f=await fixture(t),first=await reserve(f);assert.equal((await f.call(root+'/'+first,{method:'PUT',body:'{invalid',headers:{'Content-Type':'application/json'}})).status,400);
 assert.equal((await finished(f,first)).status,'failed');const id=await reserve(f),bad=backup();bad.files.stable.hash='0'.repeat(64);await submit(f,id,bad);
 assert.equal((await finished(f,id)).status,'failed');assert.deepEqual(await json(f.call('/api/admin/modules')),[]);
 const valid=await reserve(f);await submit(f,valid,backup());assert.equal((await finished(f,valid)).status,'done');
});

test('a 4MiB encrypted module restores byte-for-byte through the job API',async t=>{
 const f=await fixture(t),large=Buffer.alloc(4*1024*1024,255);large.write('REXENC\n');const id=await reserve(f);await submit(f,id,backup(large));assert.equal((await finished(f,id)).status,'done');
 assert.equal(digest(Buffer.from(await(await f.call('/api/modules/stable.js')).arrayBuffer())),digest(large));
});

test('publication errors roll back module bytes and metadata together, including the terminal success record',async t=>{
 const f=await fixture(t);await json(f.call('/api/admin/backup/restore',{method:'POST',json:backup()}));const before=await json(f.call('/api/admin/backup'));
 const db=sql(f);db.exec("CREATE TRIGGER fail_restore BEFORE UPDATE ON modules BEGIN SELECT RAISE(ABORT,'injected restore failure'); END");
 const id=await reserve(f);await submit(f,id,backup(Buffer.from('REXENC\nnew bytes')));const job=await finished(f,id);assert.equal(job.status,'failed');assert.match(job.error,/injected/);
 assert.equal(db.prepare('SELECT status FROM restore_jobs WHERE id=?').get(id).status,'failed');db.exec('DROP TRIGGER fail_restore');db.close();
 const after=await json(f.call('/api/admin/backup'));after.meta.exportedAt=before.meta.exportedAt;assert.deepEqual(after,before);
});

test('authenticated status polling bypasses the publication gate and never reports success before COMMIT',async t=>{
 const f=await fixture(t),entered=deferred(),hold=deferred(),original=KVClass.prototype.put;
 KVClass.prototype.put=async function(key,...rest){if(key==='file:stable'){entered.resolve();await hold.promise;}return original.call(this,key,...rest);};
 t.after(()=>{hold.resolve();KVClass.prototype.put=original;});const id=await reserve(f);await submit(f,id,backup());
 await Promise.race([entered.promise,delay(2000).then(()=>{throw Error('Publication was not reached');})]);
 try{
  const response=await fetch(f.base+root+'/'+id,{headers:{cookie:f.cookie},signal:AbortSignal.timeout(1500)});const {job}=await response.json();assert.equal(job.status,'writing');assert.notEqual(job.status,'done');
  assert.equal((await fetch(f.base+root+'/'+id,{signal:AbortSignal.timeout(1500)})).status,401);
 }finally{hold.resolve();KVClass.prototype.put=original;}
 assert.equal((await finished(f,id)).status,'done');
});

test('file validation does not hold the database gate; live slug conflicts are rechecked before publication',async t=>{
 // 3.5.8：模块文件边读边校验（摘要在读取时算好），读完一个就暂存一个。卡住暂存这一步，确认此时数据库没有被占住。
 const f=await fixture(t),entered=deferred(),hold=deferred(),original=KVClass.prototype.put;let held=false;
 KVClass.prototype.put=async function(key,value,options){if(!held&&String(key).startsWith('restore-stage:')){held=true;assert.deepEqual(Buffer.from(value),bytes);entered.resolve();await hold.promise;}return original.call(this,key,value,options);};
 t.after(()=>{hold.resolve();KVClass.prototype.put=original;});const id=await reserve(f);const submitted=f.call(root+'/'+id,{method:'PUT',body:JSON.stringify(backup()),headers:{'Content-Type':'application/json'}});
 await Promise.race([entered.promise,delay(2000).then(()=>{throw Error('Validation was not reached');})]);
 try{assert.deepEqual(await json(f.call('/api/admin/modules')),[]);await json(f.call('/api/admin/collections',{method:'POST',json:{slug:'stable',title:'Live conflicting collection',moduleIds:[]}}));}
 finally{hold.resolve();KVClass.prototype.put=original;}
 await json(submitted);
 const job=await finished(f,id);assert.equal(job.status,'failed');assert.match(job.error,/路径冲突/);assert.deepEqual(await json(f.call('/api/admin/modules')),[]);
});

test('reset during the upload window invalidates a pending restore instead of resurrecting cleared data',async t=>{
 const f=await fixture(t),id=await reserve(f);await json(f.call('/api/admin/reset',{method:'POST'}));await submit(f,id,backup());const job=await finished(f,id);assert.equal(job.status,'failed');assert.match(job.error,/清空/);assert.deepEqual(await json(f.call('/api/admin/modules')),[]);
});

test('completion persists across restart; interrupted uploads are marked interrupted rather than replayed',async t=>{
 const f=await fixture(t),id=await reserve(f);await submit(f,id,backup());assert.equal((await finished(f,id)).status,'done');const pending=await reserve(f);await f.close();
 const next=await fixture(t,f.directory);assert.equal((await json(next.call(root+'/'+id))).job.status,'done');assert.equal((await json(next.call(root+'/'+pending))).job.status,'interrupted');assert.equal((await json(next.call('/api/admin/modules'))).length,1);
});

test('an uncommitted success and its data disappear together after process interruption',async t=>{
 const f=await fixture(t),id=await reserve(f);await f.close();const filename=join(f.directory,'rex.sqlite');
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.prepare("UPDATE restore_jobs SET status='validating' WHERE id=?").run(process.argv[2]);db.exec('BEGIN IMMEDIATE');db.prepare("UPDATE restore_jobs SET status='done',detail=? WHERE id=?").run(JSON.stringify({id:process.argv[2],status:'done'}),process.argv[2]);db.exec("INSERT INTO modules(id,filename,title) VALUES('uncommitted','bad.js','must roll back')");process.exit(0);`,filename,id],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const next=await fixture(t,f.directory);assert.equal((await json(next.call(root+'/'+id))).job.status,'interrupted');assert.deepEqual(await json(next.call('/api/admin/modules')),[]);
});

test('an interrupted upload never starts restoring partial JSON',async t=>{
 if(process.env.REX_TEST_TRANSPORT==='memory'){t.skip('requires an actual streaming socket');return;}
 const f=await fixture(t),id=await reserve(f);
 await new Promise(resolve=>{const r=httpRequest(f.base+root+'/'+id,{method:'PUT',headers:{cookie:f.cookie,'content-type':'application/json','content-length':100000}});r.on('error',resolve);r.write('{"files":');setTimeout(()=>r.destroy(Error('synthetic disconnect')),20);});
 const job=await finished(f,id);assert.equal(job.status,'failed');assert.deepEqual(await json(f.call('/api/admin/modules')),[]);
});
