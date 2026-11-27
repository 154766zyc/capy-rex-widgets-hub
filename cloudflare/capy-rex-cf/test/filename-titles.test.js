import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {listen,close,temporary,api,login} from './helpers.js';

const encrypted='REXENC\nsynthetic-title-fallback-bytes';
const plain=(id,title)=>'var WidgetMetadata='+JSON.stringify({id,version:'1.2.3',...(title===undefined?{}:{title})})+';function play(){}';
async function fixture(t,remoteFetch,directory=temporary(t)){
 const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-title-password',DISABLE_SCHEDULER:'true'},remoteFetch?{remoteFetch}:undefined);
 let closed=false;t.after(async()=>{if(!closed)await close(server);});const cookie=await login(base,'test-title-password');
 async function request(path,options={}){const r=await api(base,path,{cookie,...options});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;}
 return {directory,base,request,modules:()=>request('/api/admin/modules'),async close(){closed=true;await close(server);},async upload(filename,bytes,accepted,target=''){
  const file=new File([bytes],filename),fd=new FormData();fd.append('files',file);if(target)fd.append('target_id',target);
  const p=await request('/api/admin/modules/upload/preview',{method:'POST',body:fd}),row=p.rows[0],commit=new FormData();
  for(const [key,value] of Object.entries({job_id:p.job_id,index:'0',action:target?'replace':'new',target_id:target}))commit.append(key,value);
  if(accepted!==undefined)commit.append('filename',accepted);commit.append('file',file);
  return request('/api/admin/modules/upload/commit',{method:'POST',body:commit});
 },setting:on=>request('/api/admin/filename-settings',{method:'PATCH',json:{auto_clean:on}}),async sync(id){
  for(let n=0;n<10;n++)if((await request('/api/admin/subscriptions/'+id+'/sync',{method:'POST'})).done)return;
  throw Error('Synthetic subscription did not finish');
 }};
}
const stable=m=>Object.fromEntries(['id','widget_id','metadata_id','filename','effective_filename','public_path','content_hash','file_key','group_id','sort_order','note'].map(key=>[key,m[key]]));

test('new encrypted and title-less uploads derive their titles from accepted names; disabled cleaning and overrides are honored',async t=>{
 const f=await fixture(t);
 const a=await f.upload('REX_加密影视.js',encrypted),b=await f.upload('rex_无标题字幕.js',plain('no-title'));
 let modules=await f.modules();
 for(const [id,name] of [[a.module_id,'加密影视'],[b.module_id,'无标题字幕']]){
  const m=modules.find(m=>m.id===id);assert.equal(m.title,name);assert.equal(m.title_source,'文件名');assert.equal(m.effective_filename,name+'.js');
 }
 await f.setting(false);const off=await f.upload('REX_未清理.js',encrypted+'off');
 assert.equal((await f.modules()).find(m=>m.id===off.module_id).title,'REX_未清理');
 const custom=await f.upload('REX_新文件.js',encrypted+'custom','手选文件名.js');
 assert.equal((await f.modules()).find(m=>m.id===custom.module_id).title,'手选文件名');
 await f.setting(true);modules=await f.modules();assert.equal(modules.find(m=>m.id===off.module_id).title,'REX_未清理');
 const download=await api(f.base,'/api/admin/modules/'+a.module_id+'/download',{cookie:await login(f.base,'test-title-password')});
 assert.match(decodeURIComponent(download.headers.get('content-disposition')),/加密影视\.js/);assert.equal(await download.text(),encrypted);
});

test('real code titles and manual titles containing Rex remain intact through replacement and collection output',async t=>{
 const f=await fixture(t),a=await f.upload('REX_代码.js',plain('explicit','Rex 官方片单'));
 let m=(await f.modules())[0];assert.equal(m.title,'Rex 官方片单');assert.equal(m.title_source,'模块代码中的 title');
 await f.request('/api/admin/modules?id='+a.module_id,{method:'PATCH',json:{title:'REX_代码',title_locked:true,note:'保留备注'}});
 const before=(await f.modules())[0];await f.upload('REX_新版文件.js',plain('explicit','Rex 新标题'),'代码.js',a.module_id);
 m=(await f.modules())[0];assert.equal(m.title,'REX_代码');assert.equal(m.title_source,'自定义标题（已锁定）');
 assert.equal(m.id,before.id);assert.equal(m.public_path,before.public_path);assert.equal(m.note,before.note);
 await f.request('/api/admin/collections',{method:'POST',json:{slug:'locked',title:'Mine',moduleIds:[m.id]}});
 assert.equal((await f.request('/api/collections/locked.rex')).widgets[0].title,'REX_代码');
});

test('single-module link preview, import and refresh use the accepted fallback while preserving source identity and old URLs',async t=>{
 let bytes=encrypted+'v1';const f=await fixture(t,async()=>new Response(bytes));
 const url='https://source.example/REX_untitled.js',preview=await f.request('/api/admin/subscriptions/preview',{method:'POST',json:{url}});
 assert.equal(preview.title,'untitled');
 const r=await f.request('/api/admin/modules/import',{method:'POST',json:{url,preview_id:preview.preview_id}}),m=(await f.modules())[0];
 assert.equal(m.title,'untitled');assert.equal(r.added[0].title,'untitled');assert.equal(m.title_source,'文件名');
 const source=(await f.request('/api/admin/subscriptions'))[0];assert.equal(source.title,'untitled');
 bytes=encrypted+'v2';await f.sync(source.id);
 const changed=(await f.modules())[0];assert.equal(changed.id,m.id);assert.equal(changed.title,'untitled');assert.equal(changed.public_path,m.public_path);
 assert.equal((await f.request('/api/admin/subscriptions'))[0].id,source.id);
 for(const path of [m.public_path,'/api/modules/'+m.id+'.js','/api/modules/'+m.id+'/raw'])assert.equal(await (await api(f.base,path)).text(),bytes);
});

test('collection imports preserve declared Rex titles but unnamed encrypted items fall back to cleaned URL filenames',async t=>{
 const manifest={title:'REX 合集',widgets:[{id:'declared',title:'Rex 作者标题',url:'https://source.example/REX_declared.js'},{id:'untitled',url:'https://source.example/REX_collection-name.js'}]};
 const f=await fixture(t,async url=>new Response(url.endsWith('.rex')?JSON.stringify(manifest):encrypted+url));
 const source=(await f.request('/api/admin/modules/import',{method:'POST',json:{url:'https://source.example/list.rex'}})).subscription;
 await f.sync(source.id);let modules=await f.modules();
 const explicit=modules.find(m=>m.manifest_title),fallback=modules.find(m=>!m.manifest_title);
 assert.equal(explicit.title,'Rex 作者标题');assert.equal(explicit.title_source,'订阅清单标题');
 assert.equal(fallback.title,'collection-name');assert.equal(fallback.title_source,'文件名');
 await f.request('/api/admin/collections',{method:'POST',json:{slug:'cleaned',title:'Mine',moduleIds:[fallback.id,explicit.id]}});
 const before=await f.request('/api/collections/cleaned.rex');assert.deepEqual(before.widgets.map(w=>w.title),['collection-name','Rex 作者标题']);
 await f.sync(source.id);modules=await f.modules();assert.deepEqual(stable(modules.find(m=>m.id===fallback.id)),stable(fallback));
 assert.deepEqual(await f.request('/api/collections/cleaned.rex'),before);
});

test('legacy filename-only titles are corrected read-only without rewriting custom titles, records, collection URLs or bytes',async t=>{
 const f=await fixture(t),a=await f.upload('REX_旧模块.js',encrypted),b=await f.upload('REX_自定义.js',encrypted+'saved');
 await f.request('/api/admin/collections',{method:'POST',json:{slug:'stable',title:'Mine',moduleIds:[a.module_id,b.module_id]}});
 const db=new DatabaseSync(join(f.directory,'rex.sqlite'));t.after(()=>db.close());
 db.prepare('UPDATE modules SET title=? WHERE id=?').run('REX_旧模块',a.module_id);
 db.prepare('UPDATE modules SET title=?,title_locked=0 WHERE id=?').run('我的 Rex 特别标题',b.module_id);
 const raw=JSON.stringify(db.prepare('SELECT * FROM modules ORDER BY id').all());
 const names=JSON.stringify(db.prepare('SELECT * FROM module_names ORDER BY module_id').all());
 let modules=await f.modules();assert.equal(modules.find(m=>m.id===a.module_id).title,'旧模块');assert.equal(modules.find(m=>m.id===b.module_id).title,'我的 Rex 特别标题');
 const manifest=await f.request('/api/collections/stable.rex');assert.deepEqual(manifest.widgets.map(w=>w.title),['旧模块','我的 Rex 特别标题']);
 for(const m of modules)assert.ok((await api(f.base,m.public_path)).ok);
 await f.modules();assert.equal(JSON.stringify(db.prepare('SELECT * FROM modules ORDER BY id').all()),raw);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM module_names ORDER BY module_id').all()),names);
});

test('explicit cleanup of an existing filename also updates only its derived display title, keeping historical public paths',async t=>{
 const f=await fixture(t);await f.setting(false);const a=await f.upload('REX_待清理.js',encrypted);
 const before=(await f.modules())[0];assert.equal(before.title,'REX_待清理');
 const scan=await f.request('/api/admin/modules/filenames');
 await f.request('/api/admin/modules/filenames',{method:'POST',json:{rows:scan.rows.map(row=>({...row,filename:row.suggested}))}});
 const after=(await f.modules())[0];assert.equal(after.title,'待清理');assert.equal(after.title_source,'文件名');assert.equal(after.filename,before.filename);
 assert.equal(after.id,a.module_id);assert.equal(after.content_hash,before.content_hash);
 for(const path of [before.public_path,after.public_path])assert.equal(await (await api(f.base,path)).text(),encrypted);
});

test('filename-only titles use the final unique name when cleaning produces a collision',async t=>{
 const f=await fixture(t),a=await f.upload('REX_重名.js',encrypted+'first'),b=await f.upload('rex_重名.js',encrypted+'second');
 const modules=await f.modules();assert.equal(modules.length,2);assert.notEqual(a.module_id,b.module_id);
 assert.equal(new Set(modules.map(m=>m.effective_filename)).size,2);
 for(const m of modules){assert.equal(m.title,m.effective_filename.slice(0,-3));assert.equal(m.title_source,'文件名');assert.doesNotMatch(m.title,/rex/i);}
});

test('cleaned fallback titles and explicit Rex titles survive restart and format 7 backup restore',async t=>{
 const f=await fixture(t);await f.upload('REX_备份测试.js',encrypted);await f.upload('REX_真实标题.js',plain('backup-code','Rex 作者标题'));
 const before=await f.modules(),saved=await f.request('/api/admin/backup');
 await f.close();const restarted=await fixture(t,undefined,f.directory);
 const check=async(current,restored=false)=>{
  const modules=await current.modules();assert.equal(modules.length,before.length);
  for(const original of before){
   const m=modules.find(m=>m.id===original.id),actual=stable(m),expected=stable(original);
   // Restore republishes bytes under its own internal storage key, not the old upload job key.
   if(restored){delete actual.file_key;delete expected.file_key;}
   assert.deepEqual(actual,expected);assert.equal(m.title,original.title);assert.equal(m.title_source,original.title_source);
   assert.equal(await (await api(current.base,m.public_path)).text(),original.code_title?plain('backup-code','Rex 作者标题'):encrypted);
  }
 };
 await check(restarted);const restored=await fixture(t);
 await restored.request('/api/admin/backup/restore',{method:'POST',json:saved});await check(restored,true);
});
