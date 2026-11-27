// Cross-runtime format 7 compatibility, including 3.4 subscription icons.
// Only isolated synthetic data is used; no account, production DB or remote source is read.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import worker,{bootstrap} from '../worker.js';
import {SQLiteKV} from '../kv.js';
import {SQLiteD1} from '../storage.js';
import {createSourcePolicy} from '../remote.js';

if(!process.argv[2])throw Error('Usage: node tools/verify-cf33.mjs /absolute/path/to/CF/widget-hub');
const cfRoot=resolve(process.argv[2]);
const {fixture}=await import(pathToFileURL(join(cfRoot,'test-fixtures/platform.mjs')));
const {HubCoordinator}=await import(pathToFileURL(join(cfRoot,'worker.js')));
const directory=mkdtempSync(join(tmpdir(),'rex-cf33-interop-'));
const kv=new SQLiteKV(join(directory,'rex.sqlite')),DB=new SQLiteD1(kv.db,kv.gate);
const bytes=Buffer.concat([Buffer.from('REXENC\nsynthetic encrypted module'),Buffer.from([0,255,128])]);
const replacement=Buffer.concat([bytes,Buffer.from(' updated')]);
const png=readFileSync(new URL('../public/app-icons/rex-mulberry-v1-32.png',import.meta.url));
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>String(url).endsWith('.png')?new Response(png,{headers:{'content-type':'image/png'}})
 :new Response(String(url).endsWith('.json')?JSON.stringify({name:'Synthetic icons',icons:[{name:'Music',url:'https://source.example/music.png'}]})
 :String(url).endsWith('.rex')?JSON.stringify({title:'Upstream',widgets:[{id:'cf-remote',url:'https://source.example/music.js',title:'Music'}]}):bytes);
try{
 const dockerEnv={KV:kv,DB,ATOMIC:work=>kv.transaction(work),SOURCE_URL_POLICY:createSourcePolicy(),REMOTE_FETCH:(...a)=>globalThis.fetch(...a)};
 await bootstrap(dockerEnv);
 kv.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('interop',Date.now(),Date.now()+3600000);
 const docker={call:(p,o)=>worker.fetch(new Request('https://hub.example'+p,{...o,headers:{cookie:'fwh_admin=interop',...o?.headers}}),dockerEnv)};
 async function cloud(){
  const f=await fixture(),w=new HubCoordinator({waitUntil(){}},f.env);
  f.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run('interop',Date.now(),Date.now()+3600000);
  return {f,call:(p,o)=>w.fetch(new Request('https://hub.example'+p,{...o,headers:{cookie:'fwh_admin=interop',...o?.headers}}))};
 }
 async function ok(app,path,method='GET',json){
  const r=await app.call(path,{method,...(json===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(json)})});
  const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;
 }
 const source=await cloud();
 const imported=await ok(source,'/api/admin/modules/import','POST',{url:'https://source.example/music.js'}),id=imported.added[0].id;
 const file=new File([replacement],'music.js'),previewForm=new FormData();previewForm.set('files',file);previewForm.set('target_id',id);
 const uploadPreview=await (await source.call('/api/admin/modules/upload/preview',{method:'POST',body:previewForm})).json();assert.ok(uploadPreview.ok);
 const commitForm=new FormData();for(const [key,value] of Object.entries({job_id:uploadPreview.job_id,index:'0',action:'replace',target_id:id,mode:'manual'}))commitForm.set(key,value);commitForm.set('file',file);
 const replaced=await source.call('/api/admin/modules/upload/commit',{method:'POST',body:commitForm});assert.equal(replaced.status,200,await replaced.text());
 for(const alias of ['旧音乐.js','Music & Friends.js']){
  const p=await ok(source,'/api/admin/modules/'+id+'/share/preview','POST',{alias});
  await ok(source,'/api/admin/modules/'+id+'/share','PUT',{alias,revision:p.revision});
 }
 const s=(await ok(source,'/api/admin/subscriptions'))[0];
 await ok(source,'/api/admin/subscriptions/'+s.id,'PATCH',{title:'Pinned source',revision:s.revision});
 await ok(source,'/api/admin/subscriptions/'+s.id,'PATCH',{enabled:0});
 await ok(source,'/api/admin/modules?id='+id,'PATCH',{note:'personal note'});
 await ok(source,'/api/admin/icon-sources','POST',{url:'https://source.example/icons.json',name:'Pinned icon source'});
 const icon=(await ok(source,'/api/admin/icons')).items[0];assert.ok(icon);
 const collection=await ok(source,'/api/admin/collections','POST',{slug:'interop',title:'My Music',moduleIds:[id],autoAll:true,icon_entry_id:icon.id});
 const cachedIcon=(await ok(source,'/api/admin/collections')).find(c=>c.id===collection.id).icon_url;
 const currentSource=(await ok(source,'/api/admin/subscriptions')).find(row=>row.id===s.id);
 await ok(source,'/api/admin/subscriptions/'+s.id+'/icon','PATCH',{revision:currentSource.revision,expected_icon_url:'',icon_mode:'custom',icon_url:cachedIcon});
 const cfBackup=await ok(source,'/api/admin/backup');assert.equal(cfBackup.format,7);
 await ok(docker,'/api/admin/backup/restore','POST',cfBackup);
 const dockerBackup=await ok(docker,'/api/admin/backup');assert.equal(dockerBackup.format,7);
 const dest=await cloud(),plan=structuredClone(dockerBackup),resources=[];
 function stage(record,key){const data=Buffer.from(record.content,'base64');record.size=data.length;record.hash=createHash('sha256').update(data).digest('hex');delete record.content;resources.push({key,data});}
 for(const [id,file] of Object.entries(plan.files))stage(file,'module:'+id);
 for(const p of plan.meta.previousVersions||[])stage(p,'previous:'+p.module_id);
 for(const a of plan.meta.icons?.assets||[])stage(a,'icon:'+a.hash);
 const job=await ok(dest,'/api/admin/backup/restore/start','POST',plan);
 for(const resource of resources){const r=await dest.call('/api/admin/backup/restore/'+job.job_id+'/files/'+encodeURIComponent(resource.key),{method:'PUT',body:resource.data});assert.equal(r.status,200,await r.text());}
 await ok(dest,'/api/admin/backup/restore/'+job.job_id+'/commit','POST');
 for(const app of [docker,dest]){
  for(const path of ['/api/modules/'+id+'.js','/api/modules/'+id+'/raw','/api/modules/'+encodeURIComponent('旧音乐.js'),'/api/modules/'+encodeURIComponent('Music & Friends.js')]){
   const r=await app.call(path);assert.equal(r.status,200,path);assert.deepEqual(Buffer.from(await r.arrayBuffer()),replacement);
  }
  const m=(await ok(app,'/api/admin/modules')).find(m=>m.id===id);assert.equal(m.note,'personal note');assert.equal(m.share_alias,'Music & Friends.js');assert.equal(m.manual_override,1);
  const sources=await ok(app,'/api/admin/subscriptions');assert.equal(sources[0].id,s.id);assert.equal(sources[0].kind,'module');assert.equal(sources[0].title,'Pinned source');assert.equal(sources[0].title_locked,1);assert.equal(sources[0].enabled,0);
  assert.equal(sources[0].custom_icon_url,cachedIcon);assert.equal(sources[0].icon_url,cachedIcon);assert.deepEqual(Buffer.from(await (await app.call(cachedIcon)).arrayBuffer()),png);
  const cols=await ok(app,'/api/admin/collections'),c=cols.find(c=>c.id===collection.id);assert.deepEqual(c.moduleIds,[id]);assert.equal(c.autoAll,true);
  const manifest=await ok(app,'/api/collections/interop.rex');assert.equal(manifest.widgets[0].url,'https://hub.example/api/modules/Music%20%26%20Friends.js');assert.notEqual(manifest.widgets[0].id,'single');
  const image=await app.call(new URL(manifest.icon).pathname);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const backup=await ok(app,'/api/admin/backup');assert.deepEqual(Buffer.from(backup.meta.previousVersions[0].content,'base64'),bytes);
  assert.equal(backup.meta.sources[0].etag,'');assert.equal(backup.meta.sources[0].last_modified,'');
  assert.equal(backup.meta.icons.sources[0].name,'Pinned icon source');assert.equal(backup.meta.names.length,1);
 }
 console.log('PASS: CF 3.4 → Docker 3.4 → CF 3.4 format 7; exact encrypted/current/previous/icon bytes, custom subscription icon, IDs, historical/current aliases, paused sources, title locks, manual mode, notes, filenames and autoAll membership.');
 dest.f.sql.close();source.f.sql.close();
}finally{globalThis.fetch=originalFetch;kv.close();rmSync(directory,{recursive:true,force:true});}
