import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readdirSync,existsSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {sharingUI} from '../sharing-ui.js';
import worker,{bootstrap,getHTML} from '../worker.js';
import {SQLiteKV} from '../kv.js';
import {SQLiteD1} from '../storage.js';
import {createSourcePolicy} from '../remote.js';
import {autoRulesTick,firstMatch,normalizeRules} from '../auto-rules.js';
import {temporary,listen,close,login,api} from './helpers.js';

const code=(id='a',title='动漫测试',version='1')=>`var WidgetMetadata={id:'${id}',title:'${title}',author:'Tester',version:'${version}'};function play(){}`;
async function app(t){
 const dir=temporary(t),kv=new SQLiteKV(join(dir,'rex.sqlite'));t.after(()=>kv.close());
 const f={sql:kv.db,kv,dir,hits:[],remote:async url=>new Response(code(new URL(url).pathname))};
 f.env={KV:kv,DB:new SQLiteD1(kv.db,kv.gate),ATOMIC:fn=>kv.transaction(fn),SOURCE_URL_POLICY:createSourcePolicy(),REMOTE_FETCH:(url,options)=>{f.hits.push(url);return f.remote(url,options);}};
 await bootstrap(f.env);f.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test',Date.now(),Date.now()+3600000);
 f.call=(path,{method='GET',json,auth=true,headers={}}={})=>worker.fetch(new Request('http://hub.example'+path,{method,headers:{...(auth?{cookie:'fwh_admin=test'}:{}),...(json?{'content-type':'application/json'}:{}),...headers},body:json?JSON.stringify(json):undefined}),f.env);
 f.ok=async(path,options)=>{const r=await f.call(path,options),body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
 f.add=(url,more={})=>f.ok('/api/admin/modules/import',{method:'POST',json:{url,...more}});
 f.preview=url=>f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}});
 f.mod=id=>({...f.sql.prepare('SELECT * FROM modules WHERE id=?').get(id)});
 f.complete=async(id,action='continue')=>{for(let i=0;i<100;i++){const r=await f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST',json:{action}});action='continue';if(r.done)return r;}throw Error('sync limit');};
 f.targets=async()=>{
  const g=await f.ok('/api/admin/groups',{method:'POST',json:{name:'动画分组'}}),c=await f.ok('/api/admin/collections',{method:'POST',json:{title:'我的合集',slug:'mine',moduleIds:[]}});
  const config={auto:true,rules:[{kw:'动漫,Cartoon',fields:['title'],group:g.id,cols:[c.id]}]};
  return {g,c,config};
 };return f;
}
test('3.5 rules are opt-in, bounded, literal text, first-match wins',async t=>{
 const f=await app(t);assert.deepEqual(await f.ok('/api/admin/auto-rules'),{auto:false,rules:[],configured:false});
 assert.equal((await f.call('/api/admin/auto-rules',{auth:false})).status,401);
 const rule={kw:'动漫,CARTOON',fields:['title'],group:'g',cols:[]};
 assert.equal(firstMatch([rule,{...rule,group:'other'}],{title:'a cartoon'}),rule);
 assert.throws(()=>normalizeRules({auto:true,rules:[{...rule,fields:['__proto__']}]}));
 assert.throws(()=>normalizeRules({auto:true,rules:[{...rule,group:''}]}));
 assert.throws(()=>normalizeRules({auto:true,rules:Array(101).fill(rule)}));
 assert.equal((await f.call('/api/admin/auto-rules',{method:'PUT',json:{auto:true,rules:[rule]}})).status,409);
 assert.equal((await autoRulesTick(f.env)).skipped,true);
});
test('3.5 first save baselines old modules; background groups only fresh ungrouped modules and appends exactly once',async t=>{
 const f=await app(t),old=(await f.add('https://source.example/old.js')).added[0],{g,c,config}=await f.targets();
 await f.ok('/api/admin/auto-rules',{method:'PUT',json:config});
 f.sql.prepare('UPDATE modules SET created_at=1,note=?,sort_order=? WHERE id=?').run('保留备注',50,old.id);
 await autoRulesTick(f.env);assert.equal(f.mod(old.id).group_id,'');
 const fresh=(await f.add('https://source.example/new.js')).added[0];f.sql.prepare('UPDATE modules SET created_at=1 WHERE id=?').run(fresh.id);
 const before=f.mod(fresh.id),r=await autoRulesTick(f.env);assert.equal(r.grouped,1);assert.equal(r.added,1);assert.equal(f.mod(fresh.id).group_id,g.id);
 for(const key of ['id','note','sort_order','source_url','file_key','filename'])assert.equal(f.mod(fresh.id)[key],before[key]);
 assert.equal(f.sql.prepare('SELECT module_id FROM collection_modules WHERE collection_id=?').get(c.id).module_id,fresh.id);
 assert.equal((await autoRulesTick(f.env)).skipped,true);assert.equal(f.mod(old.id).note,'保留备注');
 await f.ok('/api/admin/auto-rules',{method:'PUT',json:{...config,auto:false}});
 const off=(await f.add('https://source.example/off.js')).added[0];f.sql.prepare('UPDATE modules SET created_at=1 WHERE id=?').run(off.id);
 await f.ok('/api/admin/auto-rules',{method:'PUT',json:config});await autoRulesTick(f.env);assert.equal(f.mod(off.id).group_id,'');
});
test('3.5 manual classification previews exact changes and rejects stale confirmation; existing order and groups remain',async t=>{
 const f=await app(t),a=(await f.add('https://source.example/a.js')).added[0],b=(await f.add('https://source.example/b.js')).added[0],{g,c,config}=await f.targets();
 await f.ok('/api/admin/auto-rules',{method:'PUT',json:config});
 await f.ok('/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:[b.id],collectionId:c.id}});
 f.sql.prepare('UPDATE modules SET group_id=? WHERE id=?').run(g.id,b.id);
 const p=await f.ok('/api/admin/auto-rules/preview',{method:'POST',json:{}});assert.deepEqual(p.changes.map(c=>c.id),[a.id]);assert.equal(f.mod(a.id).group_id,'');
 f.sql.prepare('UPDATE modules SET note=? WHERE id=?').run('刚修改',a.id);
 assert.equal((await f.call('/api/admin/auto-rules/run',{method:'POST',json:{token:p.token}})).status,409);
 const next=await f.ok('/api/admin/auto-rules/preview',{method:'POST',json:{}});await f.ok('/api/admin/auto-rules/run',{method:'POST',json:{token:next.token}});
 assert.equal(f.mod(a.id).group_id,g.id);assert.equal(f.mod(a.id).note,'刚修改');
 assert.deepEqual(f.sql.prepare('SELECT module_id FROM collection_modules WHERE collection_id=? ORDER BY position').all(c.id).map(r=>r.module_id),[b.id,a.id]);
});
test('3.5 retry downloads only failed active items; failures retain bytes and success identities',async t=>{
 const f=await app(t);let fail=false;
 f.remote=async url=>{if(url.endsWith('.rex'))return new Response(JSON.stringify({title:'清单',icon:'https://icons.example/avatar.png',widgets:['a','b','c'].map(id=>({id,url:'https://source.example/'+id+'.js'}))}));if(fail&&url.endsWith('/b.js'))throw Error('failed b');return new Response(code(new URL(url).pathname));};
 const s=(await f.add('https://source.example/list.rex')).subscription;await f.complete(s.id);
 const old=f.sql.prepare('SELECT id,content_hash FROM modules ORDER BY id').all();fail=true;
 assert.equal((await f.complete(s.id)).summary.failed,1);assert.deepEqual(f.sql.prepare('SELECT id,content_hash FROM modules ORDER BY id').all(),old);
 fail=false;f.hits=[];const retry=await f.complete(s.id,'retry');assert.equal(retry.summary.failed,0);assert.equal(retry.total,1);assert.deepEqual(f.hits,['https://source.example/b.js']);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_items WHERE last_error!=''").get().n,0);
 assert.equal((await f.ok('/api/admin/subscriptions'))[0].icon_url,'https://icons.example/avatar.png');
});
test('3.5 all-sync queue is durable and excludes paused sources',async t=>{
 const f=await app(t),a=(await f.add('https://source.example/a.js')).subscription,b=(await f.add('https://source.example/b.js')).subscription;
 await f.ok('/api/admin/subscriptions/'+b.id,{method:'PATCH',json:{enabled:false}});f.sql.prepare('UPDATE subscription_sources SET next_sync_at=123456').run();
 assert.equal((await f.call('/api/admin/subscriptions/sync-all',{method:'POST',auth:false,json:{}})).status,401);
 assert.equal((await f.ok('/api/admin/subscriptions/sync-all',{method:'POST',json:{}})).queued,1);
 assert.equal(f.sql.prepare('SELECT next_sync_at FROM subscription_sources WHERE id=?').get(a.id).next_sync_at,0);assert.equal(f.sql.prepare('SELECT next_sync_at FROM subscription_sources WHERE id=?').get(b.id).next_sync_at,123456);
});
test('3.5 duplicate link defaults to no write, explicit new preserves separate identities, stale decisions fail',async t=>{
 const f=await app(t);f.remote=async()=>new Response(code());const a=(await f.add('https://source.example/a.js')).added[0];
 const denied=await f.call('/api/admin/modules/import',{method:'POST',json:{url:'https://source.example/b.js'}});assert.equal(denied.status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);
 const p=await f.preview('https://source.example/b.js');assert.ok(p.candidates[0].reasons.includes('内容相同'));
 f.sql.prepare('UPDATE modules SET version=? WHERE id=?').run('2',a.id);
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url:p.url,preview_id:p.preview_id,duplicate_action:'new',duplicate_token:p.duplicate_token}})).status,409);
 const next=await f.preview(p.url),b=(await f.add(p.url,{preview_id:next.preview_id,duplicate_action:'new',duplicate_token:next.duplicate_token})).added[0];assert.notEqual(a.id,b.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,2);
});
test('3.5 link replacement uses seven-day upload rollback and preserves original source, paths and membership',async t=>{
 const f=await app(t);f.remote=async()=>new Response(code());const a=(await f.add('https://source.example/a.js')).added[0],{g,c}=await f.targets();
 f.sql.prepare('UPDATE modules SET group_id=?,note=?,sort_order=22 WHERE id=?').run(g.id,'我的备注',a.id);
 await f.ok('/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:[a.id],collectionId:c.id}});
 f.remote=async()=>new Response(code('a','动漫新版','2'));const p=await f.preview('https://other.example/new.js');
 const input={preview_id:p.preview_id,duplicate_action:'replace',duplicate_token:p.duplicate_token,target_id:a.id};
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url:p.url,...input}})).status,400);
 const r=await f.add(p.url,{...input,mode:'temporary'});assert.equal(r.module_id,a.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM subscription_sources').get().n,1);
 const m=f.mod(a.id);assert.equal(m.source_url,a.source_url);assert.equal(m.note,'我的备注');assert.equal(m.group_id,g.id);assert.equal(m.sort_order,22);assert.equal(m.version,'2');
 assert.equal(f.sql.prepare('SELECT module_id FROM collection_modules WHERE collection_id=?').get(c.id).module_id,a.id);
 assert.equal((await f.call('/api/modules/'+a.id+'.js',{auth:false})).status,200);
 assert.ok(f.sql.prepare('SELECT expires_at FROM module_previous_versions WHERE module_id=?').get(a.id).expires_at>Date.now()+6*86400000);
});
test('3.5 ignores exact duplicate member sets without deletion, resets them, and round-trips rules safely disabled',async t=>{
 const f=await app(t);f.remote=async()=>new Response(code());await f.add('https://source.example/a.js');const p=await f.preview('https://source.example/b.js');await f.add(p.url,{preview_id:p.preview_id,duplicate_action:'new',duplicate_token:p.duplicate_token});
 const {config}=await f.targets();await f.ok('/api/admin/auto-rules',{method:'PUT',json:config});
 const scan=await f.ok('/api/admin/modules/duplicates');assert.equal(scan.groups.length,1);await f.ok('/api/admin/modules/duplicates/ignore',{method:'POST',json:{group_token:scan.groups[0].token}});
 assert.equal((await f.ok('/api/admin/modules/duplicates')).groups.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,2);
 const backup=await f.ok('/api/admin/backup'),dest=await app(t);await dest.ok('/api/admin/backup/restore',{method:'POST',json:backup});
 assert.equal((await dest.ok('/api/admin/auto-rules')).auto,false);assert.equal((await dest.ok('/api/admin/modules/duplicates')).ignored,1);
 await dest.ok('/api/admin/modules/duplicates/ignore',{method:'POST',json:{clear:true}});assert.equal((await dest.ok('/api/admin/modules/duplicates')).groups.length,1);
 const q=await f.preview('https://source.example/c.js');await f.add(q.url,{preview_id:q.preview_id,duplicate_action:'new',duplicate_token:q.duplicate_token});assert.equal((await f.ok('/api/admin/modules/duplicates')).groups[0].module_ids.length,3);
});
test('3.5 independent schema upgrade ignores old migration flags and preserves all public records and bytes',async t=>{
 const f=await app(t),a=(await f.add('https://source.example/a.js')).added[0],{c}=await f.targets();
 await f.ok('/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:[a.id],collectionId:c.id}});
 const before=await f.ok('/api/admin/backup'),bytes=await (await f.call('/api/modules/'+a.id+'.js',{auth:false})).text();
 f.sql.exec('DROP TABLE duplicate_ignores; DROP TABLE auto_rule_seen; DROP INDEX idx_subscription_errors');
 f.sql.prepare("INSERT OR REPLACE INTO settings VALUES('schema_cf_v33_1','1')").run();
 const next={...f.env,DB:new SQLiteD1(f.sql,f.kv.gate)};await bootstrap(next);await bootstrap({...next,DB:new SQLiteD1(f.sql,f.kv.gate)});
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('duplicate_ignores','auto_rule_seen')").get().n,2);
 const after=await f.ok('/api/admin/backup');for(const field of ['modules','collections','sources','sourceItems','names','shareAliases'])assert.deepEqual(after.meta[field],before.meta[field]);
 assert.equal(await (await f.call('/api/modules/'+a.id+'.js',{auth:false})).text(),bytes);assert.equal((await f.call('/api/collections/mine.rex',{auth:false})).status,200);
 const s=before.meta.sources[0];assert.equal((await f.complete(s.id)).summary.failed,0);
});
test('3.5 UI gzip does not compress or stale-cache public resources; old etags revalidate after writes',async t=>{
 const dir=temporary(t),{server,base}=await listen({DATA_DIR:dir,ADMIN_SECRET:'test-only',DISABLE_SCHEDULER:'true'},{remoteFetch:async()=>new Response(code())});t.after(()=>close(server));
 const raw=await new Promise((resolve,reject)=>{httpRequest(base+'/',{headers:{'Accept-Encoding':'gzip'}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({headers:r.headers,bytes:Buffer.concat(chunks)}));}).on('error',reject).end();});
 assert.equal(raw.headers['content-encoding'],'gzip');assert.equal(gunzipSync(raw.bytes).toString(),getHTML());assert.ok(raw.bytes.length<Buffer.byteLength(getHTML())/2);
 const cookie=await login(base,'test-only'),added=await (await api(base,'/api/admin/modules/import',{cookie,method:'POST',json:{url:'https://source.example/a.js'}})).json(),id=added.added[0].id;
 const first=await api(base,'/api/modules/'+id+'.js');assert.equal(first.headers.get('content-encoding'),null);const etag=first.headers.get('etag');await first.arrayBuffer();
 const file=new FormData();file.set('file',new File([code('a','新版','2')],'a.js'));file.set('mode','temporary');
 assert.equal((await api(base,'/api/admin/modules?id='+id,{method:'PUT',cookie,body:file})).status,200);
 const newer=await api(base,'/api/modules/'+id+'.js',{headers:{'If-None-Match':etag}});assert.equal(newer.status,200);assert.match(await newer.text(),/新版/);
 await api(base,'/api/admin/modules?id='+id,{method:'DELETE',cookie});const absent=await api(base,'/api/modules/'+id+'.js',{headers:{'If-None-Match':etag}});assert.equal(absent.status,404);
});
test('3.5 creates an upgrade snapshot once and honors the existing opt-out',async t=>{
 for(const skip of [false,true]){
  const dir=temporary(t),first=await listen({DATA_DIR:dir,ADMIN_SECRET:'test-only',DISABLE_SCHEDULER:'true'});await close(first.server);
  const kv=new SQLiteKV(join(dir,'rex.sqlite'));kv.db.prepare("DELETE FROM settings WHERE key='docker_v35'").run();kv.close();
  const second=await listen({DATA_DIR:dir,ADMIN_SECRET:'test-only',DISABLE_SCHEDULER:'true',SKIP_UPGRADE_BACKUP:String(skip)});await close(second.server);
  assert.equal(existsSync(join(dir,'backups'))?readdirSync(join(dir,'backups')).filter(n=>n.startsWith('pre-v35-')).length:0,skip?0:1);
 }
});
test('3.5 active link dialog forwards duplicate decisions, handles replacement without a subscription and cancellation without writes',async()=>{
 for(const decision of [null,{duplicate_action:'replace',target_id:'existing',duplicate_token:'token',mode:'manual'}]){
  let commit,closed=false,choices=0;const calls=[],messages=[];
  const elements=Object.fromEntries(['importUrl','importGroup','importFilename','importEffectiveFilename','importProgress','identifySource'].map(id=>[id,{value:id==='importUrl'?'https://source.example/a.js':'',textContent:'',isConnected:true}]));
  const overlay={isConnected:true,querySelector:selector=>elements[selector.slice(1)]};
  const context={state:{tab:'modules'},groupOptions:()=>'',toast:m=>messages.push(m),loadAll:async()=>{},syncSource:async()=>{},
   document:{getElementById:id=>elements[id],querySelector:()=>overlay},
   showModal:(title,body,fn)=>{commit=()=>fn(()=>{closed=true;});},
   chooseLinkDuplicate:async()=>{choices++;return decision;},
   api:async(path,options)=>{calls.push([path,options]);if(path.endsWith('/preview'))return {preview_id:'p',url:elements.importUrl.value,kind:'module',title:'测试',filename:'a.js',candidates:[{id:'existing'}]};if(path.endsWith('/filename-preview'))return {suggested:'a.js'};return {ok:true,module_id:'existing'};}
  };
  vm.createContext(context);vm.runInContext(sharingUI,context);context.showImportUrl();await elements.identifySource.onclick();await commit();
  assert.equal(choices,1);const writes=calls.filter(([p])=>p==='/api/admin/modules/import');
  assert.equal(writes.length,decision?1:0);assert.equal(closed,!!decision);
  if(decision)assert.deepEqual(JSON.parse(JSON.stringify(writes[0][1].json)),{url:'https://source.example/a.js',preview_id:'p',group_id:'',filename:'a.js',effective_filename:'a.js',...decision});
  assert.equal(context.state.tab,'modules');assert.ok(!messages.some(m=>/undefined|读取/.test(m)));
 }
});
test('module source labels distinguish collection, single-link, mixed and uploaded origins with read-only aggregation',async t=>{
 const f=await app(t);
 f.remote=async url=>url.endsWith('.rex')?Response.json({title:'来源测试',widgets:['shared','collection'].map(id=>({id,url:'https://source.example/'+id+'.js'}))}):new Response(code(new URL(url).pathname));
 const shared=(await f.add('https://source.example/shared.js')).added[0];
 const source=(await f.add('https://source.example/origins.rex')).subscription;await f.complete(source.id);
 const single=(await f.add('https://source.example/single.js')).added[0];
 const form=new FormData();form.append('files',new File([code('upload-local')],'local.js'));
 const upload=await worker.fetch(new Request('http://hub.example/api/admin/modules',{method:'POST',headers:{cookie:'fwh_admin=test'},body:form}),f.env);
 assert.equal(upload.status,200);const uploaded=(await upload.json()).added[0];
 const before=f.sql.prepare('SELECT * FROM modules ORDER BY id').all();
 const modules=await f.ok('/api/admin/modules'),lookup=id=>modules.find(m=>m.id===id);
 assert.equal(lookup(shared.id).subscription_collection,1);assert.equal(lookup(shared.id).subscription_module,1);
 assert.equal(lookup(single.id).subscription_collection,0);assert.equal(lookup(single.id).subscription_module,1);
 const collection=modules.find(m=>m.source_url==='https://source.example/collection.js');assert.equal(collection.subscription_collection,1);assert.equal(collection.subscription_module,0);
 assert.equal(lookup(uploaded.id).subscription_collection,null);assert.equal(lookup(uploaded.id).subscription_module,null);
 assert.deepEqual(f.sql.prepare('SELECT * FROM modules ORDER BY id').all(),before);
});
