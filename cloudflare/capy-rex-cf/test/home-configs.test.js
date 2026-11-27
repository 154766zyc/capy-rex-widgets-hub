import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseHomePackage,readHomeZip,HOME_LIMITS} from '../home-configs.js';
import {homePackage,homeEntries,zipEntries,avatar} from './fixtures/home-package.js';
import {listen,close,login,api,temporary} from './helpers.js';
const root='/api/admin/home-configs',hash=b=>createHash('sha256').update(b).digest('hex');
async function app(t,directory=temporary(t)){
 let hits=0,closed=false;const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'home-test-password',DISABLE_SCHEDULER:'true'},{remoteFetch:async()=>{hits++;throw Error('No network in home tests');}});
 t.after(async()=>{if(!closed)await close(server);});const cookie=await login(base,'home-test-password');
 const f={base,directory,hits:()=>hits,call:(path,options={})=>api(base,path,{cookie,...options}),async close(){closed=true;await close(server);}};
 f.ok=async(path,options)=>{const response=await f.call(path,options),body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
 f.rows=()=>f.ok(root);f.row=async id=>(await f.rows()).find(row=>row.id===id);
 f.upload=(bytes=homePackage(),{id,revision,name='home.rex'}={})=>{const form=new FormData();form.append('file',new File([bytes],name));if(revision)form.append('revision',revision);return f.call(root+(id?'/'+id:''),{method:id?'PUT':'POST',body:form});};
 f.add=async(bytes=homePackage())=>{const response=await f.upload(bytes),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));return f.row(body.home.id);};
 f.share=async row=>(await f.ok(root+'/'+row.id+'/share',{method:'POST',json:{revision:row.revision,accept_public:true}})).path;
 return f;
}
async function seed(f){await f.ok('/api/admin/backup/restore',{method:'POST',json:{format:1,files:{stable:{filename:'stable.js',content:'WidgetMetadata={id:"stable",title:"Original"};'}},meta:{modules:[{id:'stable',note:'keep'}],collections:[{id:'col',slug:'keep',title:'Keep',moduleIds:['stable']}]}}});}
const bytes=async response=>Buffer.from(await(await response).arrayBuffer());

test('home ZIP reader supports stored/deflate/data-descriptor packages, counts layout, and safely reads embedded PNG',()=>{
 for(const options of [{},{stored:true},{descriptor:true}]){const raw=homePackage({},options),parsed=parseHomePackage(raw);assert.deepEqual(parsed.bytes,raw);assert.equal(parsed.package_title,'测试首页');assert.equal(parsed.sections,1);assert.equal(parsed.items,1);assert.equal(parsed.avatar.mime,'image/png');assert.deepEqual(parsed.avatar.bytes,avatar);}
 assert.equal(parseHomePackage(homePackage({home:{title:undefined,avatarData:undefined}}),'Original.rex').package_title,'Original');
});
test('home package validation rejects wrong format, damaged JSON/CRC, traversal, duplicate entries and expanded bombs',()=>{
 for(const raw of [Buffer.from('{"widgets":[]}'),homePackage().subarray(0,60),homePackage({manifest:{version:3}}),homePackage({manifest:{format:'collection'}}),homePackage({layout:{items:[]}}),zipEntries(homeEntries().slice(1)),zipEntries([...homeEntries(),['../escape','bad']]),zipEntries([...homeEntries(),homeEntries()[0]]),zipEntries(homeEntries().map(([name,value])=>[name,name==='rex-home.json'?'{bad':value]))])assert.throws(()=>parseHomePackage(raw));
 const raw=homePackage({}, {stored:true}),nameBytes=raw.readUInt16LE(26),bad=Buffer.from(raw);bad[30+nameBytes]^=1;assert.throws(()=>parseHomePackage(bad),/校验/);
 const bomb=Buffer.from(raw),end=bomb.length-22,start=bomb.readUInt32LE(end+16);bomb.writeUInt32LE(HOME_LIMITS.entry+1,start+24);assert.throws(()=>readHomeZip(bomb),/大小限制/);
 const encrypted=Buffer.from(raw);encrypted.writeUInt16LE(0x801,6);encrypted.writeUInt16LE(0x801,start+8);assert.throws(()=>readHomeZip(encrypted),/加密/);
 const link=Buffer.from(raw);link.writeUInt32LE(0xa1ff0000,start+38);assert.throws(()=>readHomeZip(link),/链接/);
});
test('unknown avatar formats are never rendered and arbitrary JSON/script strings are not executed',()=>{
 globalThis.homePackageWasExecuted=false;const parsed=parseHomePackage(homePackage({title:'<img onerror="homePackageWasExecuted=true">',home:{avatarData:Buffer.from('<svg onload="homePackageWasExecuted=true"/>').toString('base64')},extra:[['payload.js','globalThis.homePackageWasExecuted=true']]}));
 assert.equal(parsed.avatar,null);assert.equal(globalThis.homePackageWasExecuted,false);delete globalThis.homePackageWasExecuted;
});
test('upload, list, export and avatar require auth; raw bytes stay original and no module URL is fetched',async t=>{
 const f=await app(t),raw=homePackage(),row=await f.add(raw);assert.equal(row.package_title,'测试首页');assert.equal(row.shared,false);assert.equal(row.share_path,'');assert.equal(row.sections,1);assert.equal(row.items,1);assert.equal(row.hash,hash(raw));assert.ok(row.avatar_url);
 for(const key of ['bytes','avatar_bytes','content','share_key'])assert.equal(Object.hasOwn(row,key),false);
 for(const path of [root,root+'/'+row.id+'/file',row.avatar_url])assert.equal((await api(f.base,path)).status,401);
 const file=await f.call(root+'/'+row.id+'/file');assert.equal(file.headers.get('cache-control'),'no-store');assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.match(file.headers.get('content-disposition'),/^attachment/);assert.deepEqual(await bytes(file),raw);
 assert.deepEqual(await bytes(f.call(row.avatar_url)),avatar);const head=await f.call(root+'/'+row.id+'/file',{method:'HEAD'});assert.equal(head.headers.get('content-length'),String(raw.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal(f.hits(),0);assert.equal((await api(f.base,'/api/home-configs/'+row.id+'.rex')).status,404);
});
test('bad upload and exact duplicate are rejected without replacing an existing homepage',async t=>{
 const f=await app(t),raw=homePackage(),row=await f.add(raw);assert.equal((await f.upload(raw)).status,409);assert.equal((await f.upload(raw,{name:'bad.js'})).status,400);assert.equal((await f.upload(Buffer.from('not a zip'))).status,400);
 assert.deepEqual(await f.row(row.id),row);assert.deepEqual(await bytes(f.call(root+'/'+row.id+'/file')),raw);
 assert.equal((await f.add(homePackage({title:'Another'}))).title,'Another');
});
test('first share requires explicit acceptance; shared GET/HEAD/ETag are private-by-default and original bytes',async t=>{
 const f=await app(t),raw=homePackage(),row=await f.add(raw),endpoint=root+'/'+row.id+'/share';
 assert.equal((await f.call(endpoint,{method:'POST',json:{revision:row.revision}})).status,409);
 assert.equal((await api(f.base,endpoint,{method:'POST',json:{revision:row.revision,accept_public:true}})).status,401);
 const path=await f.share(row);assert.match(path,/^\/api\/home-configs\/[a-f0-9]{64}\.rex$/);const fresh=await f.row(row.id);assert.equal(fresh.shared,true);assert.equal(fresh.share_path,path);
 assert.equal(await f.share(fresh),path);const response=await api(f.base,path);assert.equal(response.status,200);assert.deepEqual(await bytes(response),raw);
 assert.equal((await api(f.base,path,{method:'HEAD'})).headers.get('content-length'),String(raw.length));assert.equal((await api(f.base,path,{method:'POST'})).status,405);
 const cached=await api(f.base,path,{headers:{'If-None-Match':'"'+hash(raw)+'"'}});assert.equal(cached.status,304);assert.equal(cached.headers.get('cache-control'),'no-store');
});
test('rename only changes the readable download name; revisions protect concurrent edits',async t=>{
 const f=await app(t),raw=homePackage(),row=await f.add(raw);await f.ok(root+'/'+row.id,{method:'PATCH',json:{revision:row.revision,title:'我的唱片馆.rex'}});
 const fresh=await f.row(row.id);assert.equal(fresh.package_title,row.package_title);assert.equal(fresh.title,'我的唱片馆.rex');assert.equal((await f.call(root+'/'+row.id,{method:'PATCH',json:{revision:row.revision,title:'stale'}})).status,409);
 const response=await f.call(root+'/'+row.id+'/file');assert.ok(response.headers.get('content-disposition').includes(encodeURIComponent('我的唱片馆.rex')));assert.deepEqual(await bytes(response),raw);
 assert.equal((await f.call(root+'/'+row.id,{method:'PATCH',json:{revision:fresh.revision,title:''}})).status,400);
});
test('replacement validates first and atomically preserves identity, display title, and original public share address',async t=>{
 const f=await app(t);await seed(f);const before=await f.ok('/api/admin/modules'),first=homePackage(),added=await f.add(first),path=await f.share(added),row=await f.row(added.id),next=homePackage({title:'上游新名称',layout:[]});
 assert.equal((await f.upload(Buffer.from('invalid'),{id:row.id,revision:row.revision})).status,400);assert.deepEqual(await f.row(row.id),row);assert.deepEqual(await bytes(api(f.base,path)),first);
 const results=await Promise.all([f.upload(next,{id:row.id,revision:row.revision}),f.upload(next,{id:row.id,revision:row.revision})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const fresh=await f.row(row.id);assert.equal(fresh.id,row.id);assert.equal(fresh.title,row.title);assert.equal(fresh.package_title,'上游新名称');assert.equal(fresh.sections,0);assert.equal(fresh.share_path,path);assert.deepEqual(await bytes(api(f.base,path)),next);assert.deepEqual(await f.ok('/api/admin/modules'),before);
});
test('deleting a home revokes public and cached access without deleting modules or collections',async t=>{
 const f=await app(t);await seed(f);const row=await f.add(),path=await f.share(row),fresh=await f.row(row.id);
 assert.equal((await f.call(root+'/'+row.id,{method:'DELETE',json:{revision:row.revision}})).status,409);
 await f.ok(root+'/'+row.id,{method:'DELETE',json:{revision:fresh.revision}});assert.equal((await api(f.base,path,{headers:{'If-None-Match':'"'+row.hash+'"'}})).status,404);assert.equal((await f.rows()).length,0);assert.equal((await f.ok('/api/admin/modules')).length,1);assert.equal((await f.ok('/api/admin/collections')).length,1);
 assert.equal((await f.ok('/api/admin/backup')).format,7);
});
test('home bytes, images, titles and share identities survive service restart',async t=>{
 const f=await app(t),raw=homePackage(),row=await f.add(raw),path=await f.share(row),before=await f.row(row.id);await f.close();const next=await app(t,f.directory);assert.deepEqual(await next.row(row.id),before);assert.deepEqual(await bytes(api(next.base,path)),raw);assert.deepEqual(await bytes(next.call(before.avatar_url)),avatar);
});
test('format 8 includes all home bytes and shares; format 7 remains unchanged when no homes exist',async t=>{
 const f=await app(t);await seed(f);assert.equal((await f.ok('/api/admin/backup')).format,7);
 const first=homePackage(),second=homePackage({title:'Private'}),a=await f.add(first),path=await f.share(a),b=await f.add(second),saved=await f.ok('/api/admin/backup');assert.equal(saved.format,8);assert.equal(saved.meta.homeConfigs.length,2);
 const next=await app(t),result=await next.ok('/api/admin/backup/restore',{method:'POST',json:saved});assert.equal(result.home_configs,2);assert.deepEqual(await bytes(api(next.base,path)),first);assert.deepEqual(await bytes(next.call(root+'/'+b.id+'/file')),second);assert.equal((await next.row(b.id)).shared,false);assert.equal((await next.ok('/api/admin/modules'))[0].id,'stable');
 const after=await next.ok('/api/admin/backup');assert.deepEqual(after.meta.homeConfigs,saved.meta.homeConfigs);assert.equal(next.hits(),0);
});
test('bad home bytes or downgraded format fail before modifying any module, collection or home',async t=>{
 const f=await app(t);await seed(f);await f.add();const saved=await f.ok('/api/admin/backup'),before=JSON.stringify(saved.meta.homeConfigs);
 for(const mutate of [b=>{b.meta.homeConfigs[0].hash='0'.repeat(64);},b=>{b.format=7;},b=>{const row=b.meta.homeConfigs[0],bad=Buffer.from('not zip');row.content=bad.toString('base64');row.size=bad.length;row.hash=hash(bad);},b=>{delete b.meta.homeConfigs;}]){
  const bad=structuredClone(saved);mutate(bad);assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:bad})).status,400);assert.equal(JSON.stringify((await f.ok('/api/admin/backup')).meta.homeConfigs),before);
 }
});
test('restore checks live sharing conflicts and an older private backup cannot break an existing share URL',async t=>{
 const f=await app(t),row=await f.add(),privateBackup=await f.ok('/api/admin/backup'),path=await f.share(row),saved=await f.ok('/api/admin/backup');
 await f.ok('/api/admin/backup/restore',{method:'POST',json:privateBackup});assert.equal((await f.row(row.id)).share_path,path);
 for(const mutate of [b=>{b.meta.homeConfigs[0].share_key='0'.repeat(64);},b=>{b.meta.homeConfigs[0].id=crypto.randomUUID();}]){
  const bad=structuredClone(saved);mutate(bad);assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:bad})).status,400);assert.equal((await api(f.base,path)).status,200);assert.equal((await f.rows()).length,1);
 }
 const old=structuredClone(saved);old.format=7;delete old.meta.homeConfigs;await f.ok('/api/admin/backup/restore',{method:'POST',json:old});assert.equal((await f.row(row.id)).share_path,path);
});
test('an injected home write failure rolls back both module and home changes in one restore transaction',async t=>{
 const f=await app(t);await seed(f);const row=await f.add(),saved=await f.ok('/api/admin/backup'),originalModule=await bytes(f.call('/api/modules/stable.js'));
 const db=new DatabaseSync(join(f.directory,'rex.sqlite'));db.exec("CREATE TRIGGER fail_home BEFORE UPDATE ON home_configs BEGIN SELECT RAISE(ABORT,'injected home write failure'); END");
 const backup=structuredClone(saved),content='WidgetMetadata={id:"stable",title:"must roll back"};';backup.files.stable={filename:'stable.js',encoding:'text',content};
 assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:backup})).status,400);db.exec('DROP TRIGGER fail_home');db.close();
 assert.deepEqual(await bytes(f.call('/api/modules/stable.js')),originalModule);assert.equal((await f.row(row.id)).hash,row.hash);assert.equal((await f.ok('/api/admin/modules'))[0].title,'Original');
});
test('reset removes home bytes and all share links while retaining the administrator session',async t=>{
 const f=await app(t),row=await f.add(),path=await f.share(row);await f.ok('/api/admin/reset',{method:'POST'});assert.deepEqual(await f.rows(),[]);assert.equal((await api(f.base,path)).status,404);assert.equal((await f.ok('/api/admin/backup')).format,7);
});
test('format 8 works through the durable restore job API and commits the home count with the result',async t=>{
 const source=await app(t),raw=homePackage(),row=await source.add(raw),path=await source.share(row),backup=await source.ok('/api/admin/backup'),dest=await app(t),id=crypto.randomUUID(),jobs='/api/admin/backup/restore/jobs';
 await dest.ok(jobs,{method:'POST',json:{id}});await dest.ok(jobs+'/'+id,{method:'PUT',json:backup});let job;
 for(let i=0;i<100;i++){job=(await dest.ok(jobs+'/'+id)).job;if(['done','failed'].includes(job.status))break;await delay(5);}
 assert.equal(job.status,'done');assert.equal(job.result.home_configs,1);assert.deepEqual(await bytes(api(dest.base,path)),raw);
});
test('homepage limit and expired auth reject mutations without replacing data',async t=>{
 const f=await app(t),row=await f.add();const db=new DatabaseSync(join(f.directory,'rex.sqlite'));
 const fields=db.prepare('PRAGMA table_info(home_configs)').all().map(column=>column.name),original=db.prepare('SELECT * FROM home_configs WHERE id=?').get(row.id);
 const insert=db.prepare('INSERT INTO home_configs('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')');
 for(let i=1;i<HOME_LIMITS.count;i++)insert.run(...fields.map(key=>key==='id'?crypto.randomUUID():key==='hash'?'synthetic-'+i:original[key]));
 assert.equal((await f.upload(homePackage({title:'beyond the limit'}))).status,400);assert.equal((await f.rows()).length,HOME_LIMITS.count);
 db.prepare('UPDATE sessions SET expires_at=0').run();
 // Auth rejects before reading the upload. Buffer this small valid multipart
 // request so undici's lazy File writer cannot race the deliberate close/401.
 const form=new FormData();form.append('file',new File([homePackage()],'home.rex'));
 const request=new Request(f.base+root,{method:'POST',body:form});
 assert.equal((await f.call(root,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')},body:Buffer.from(await request.arrayBuffer())})).status,401);
 assert.equal((await f.call(root+'/'+row.id,{method:'DELETE',json:{revision:row.revision}})).status,401);db.close();
});
