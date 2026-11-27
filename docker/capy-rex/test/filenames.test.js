import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readdirSync} from 'node:fs';
import {listen,close,temporary,api,login} from './helpers.js';
import {safeFilename,validateFilename,contentDisposition,downloadFilename} from '../filenames.js';
const code=(id,v=1)=>`var WidgetMetadata={id:'${id}',title:'REX 模块标题',version:'${v}'};function load(){return '${v}';}`;
const ok=async response=>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
async function start(t,dependencies,directory=temporary(t)){
 const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'},dependencies);
 let closed=false;t.after(async()=>{if(!closed)await close(server);});
 const cookie=await login(base,'test-password');return {server,base,directory,call:(p,o={})=>api(base,p,{cookie,...o}),async close(){closed=true;await close(server);}};
}
async function preview(s,file,target=''){
 const fd=new FormData();fd.append('files',file);if(target)fd.append('target_id',target);
 return ok(await s.call('/api/admin/modules/upload/preview',{method:'POST',body:fd}));
}
async function commit(s,p,file,filename){
 const row=p.rows[0],fd=new FormData();
 for(const [key,value] of Object.entries({job_id:p.job_id,index:'0',action:row.target?'replace':'new',target_id:row.target?.id||'',mode:'temporary'}))fd.append(key,value);
 if(filename!==undefined)fd.append('filename',filename);fd.append('file',file);
 return s.call('/api/admin/modules/upload/commit',{method:'POST',body:fd});
}
async function upload(s,name,bytes,filename,target){const f=new File([bytes],name),p=await preview(s,f,target);return ok(await commit(s,p,f,filename));}
const modules=s=>s.call('/api/admin/modules').then(ok);
const settings=(s,on)=>s.call('/api/admin/filename-settings',{method:'PATCH',json:{auto_clean:on}}).then(ok);
const scan=s=>s.call('/api/admin/modules/filenames').then(ok);
const repair=(s,rows)=>s.call('/api/admin/modules/filenames',{method:'POST',json:{rows:rows.map(r=>({...r,filename:r.suggested||r.filename}))}});
const backup=s=>s.call('/api/admin/backup').then(ok);

test('filename rules remove literal rex in any case, preserve JS, bound length and produce safe Chinese headers',()=>{
 assert.equal(safeFilename('REX__视频-reX - 4K.js','id',true),'视频-4K.js');
 assert.equal(safeFilename('pREXfix.JS','id',true),'pfix.js');
 assert.equal(safeFilename('rex.js','abcd-1234',true),'module-abcd1234.js');
 assert.doesNotMatch(safeFilename('rex.js','rex-module',true),/rex/i);
 assert.doesNotThrow(()=>contentDisposition(safeFilename('\ud800.js')));
 assert.equal(safeFilename('REX_视频.js','id',false),'REX_视频.js');
 assert.ok([...safeFilename('字'.repeat(180)+'.js')].length<=153);
 for(const name of ['../a.js','a\r\n.js','bad.txt','.js','a/b.js'])assert.throws(()=>validateFilename(name));
 assert.match(contentDisposition('视频.js',true),/^attachment; filename="__\.js"; filename\*=UTF-8''%/);
});

test('download names use readable titles and real versions without repeating a version suffix',()=>{
 const mod={id:'b4c478c1-b7a7-1691-baff-8db1721cbb6e',filename:'b4c478c1-b7a7-1691-baff-8db1721cbb6e.js',manifest_title:'Javheo',is_encrypted:1};
 assert.equal(downloadFilename(mod),'Javheo.js');
 assert.equal(downloadFilename({...mod,version:'1.3.2'}),'Javheo-v1.3.2.js');
 assert.equal(downloadFilename({...mod,version:'v1.3.2'}),'Javheo-v1.3.2.js');
 for(const title of ['Javheo-v1.3.2','Javheo 1.3.2','Javheo (v1.3.2)','Javheo[v1.3.2]'])
  assert.equal(downloadFilename({...mod,manifest_title:title,version:'1.3.2'}),'Javheo-v1.3.2.js');
 assert.equal(downloadFilename({...mod,title_locked:1,title:'我的模块',code_title:'代码名',version:'2.0.0-beta.1'}),'我的模块-v2.0.0-beta.1.js');
 assert.equal(downloadFilename({...mod,code_title:'视频 4K',version:'2.0'}),'视频-4K-v2.0.js');
 assert.equal(downloadFilename({...mod,manifest_title:'REX/视频',version:'1.0\r\n/evil'}),'视频-v1.0-evil.js');
 assert.equal(downloadFilename({...mod,manifest_title:'',effective_filename:'original.js'}),'original.js');
 const long=downloadFilename({...mod,manifest_title:'字'.repeat(180),version:'1.2.3'});
 assert.ok([...long].length<=153);assert.ok(long.endsWith('-v1.2.3.js'));
});

test('encrypted subscription downloads follow the title and current version while leaving names, links and bytes unchanged',async t=>{
 let version='';const bytes=Buffer.concat([Buffer.from('REXENC\n'),Buffer.from([0,255,128,91,93,10])]);
 const s=await start(t,{remoteFetch:async url=>new Response(url.endsWith('.rex')?
  JSON.stringify({title:'Source',widgets:[{id:'upstream',title:'Javheo',version,url:'https://modules.example/b4c478c1-b7a7-1691-baff-8db1721cbb6e.js'}]}):bytes)});
 const source=(await ok(await s.call('/api/admin/modules/import',{method:'POST',json:{url:'https://modules.example/collection.rex'}}))).subscription.id;
 async function cycle(){for(let n=0;n<5;n++)if((await ok(await s.call('/api/admin/subscriptions/'+source+'/sync',{method:'POST'}))).done)return;throw Error('sync incomplete');}
 await cycle();const before=(await modules(s))[0],endpoint='/api/admin/modules/'+before.id+'/download';
 await ok(await s.call('/api/admin/collections',{method:'POST',json:{slug:'stable',title:'Mine',moduleIds:[before.id]}}));
 const manifest=await s.call('/api/collections/stable.rex').then(ok),saved=await backup(s);
 async function check(name){const r=await s.call(endpoint);assert.equal(decodeURIComponent(r.headers.get('content-disposition').split("filename*=UTF-8''")[1]),name);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);}
 await check('Javheo.js');const again=await backup(s);again.meta.exportedAt=saved.meta.exportedAt;assert.deepEqual(again,saved);
 version='1.3.2';await cycle();await check('Javheo-v1.3.2.js');
 version='1.3.3';await cycle();await check('Javheo-v1.3.3.js');
 let after=(await modules(s))[0];assert.equal(after.effective_filename,before.effective_filename);assert.equal(after.public_path,before.public_path);
 assert.equal((await s.call('/api/collections/stable.rex').then(ok)).widgets[0].url,manifest.widgets[0].url);
 await ok(await s.call('/api/admin/modules?id='+before.id,{method:'PATCH',json:{title:'我的标题'}}));await check('我的标题-v1.3.3.js');
 after=(await modules(s))[0];assert.equal(after.id,before.id);assert.equal(after.filename,before.filename);
});

test('download requires login, returns exact encrypted bytes and accepted filename, preserves stable module and collection identities',async t=>{
 const s=await start(t),bytes=Buffer.concat([Buffer.from('REXENC\n'),Buffer.from([0,255,128,13,10,91,93,9])]);
 const file=new File([bytes],'REX__视频.js'),p=await preview(s,file);assert.equal(p.rows[0].effective_filename,'视频.js');
 const added=await ok(await commit(s,p,file)),id=added.module_id;
 const col=await ok(await s.call('/api/admin/collections',{method:'POST',json:{slug:'stable',title:'Mine',moduleIds:[id]}}));
 await ok(await s.call('/api/admin/modules?id='+id,{method:'PATCH',json:{note:'保留备注'}}));
 const before=(await modules(s))[0];assert.equal(before.filename,'REX__视频.js');assert.equal(before.effective_filename,'视频.js');
 const endpoint='/api/admin/modules/'+id+'/download';
 assert.equal((await api(s.base,endpoint)).status,401);assert.equal((await s.call(endpoint,{method:'POST'})).status,405);
 const r=await s.call(endpoint);assert.match(r.headers.get('content-disposition'),/attachment;.*UTF-8''%E8%A7%86%E9%A2%91\.js/);
 assert.equal(r.headers.get('content-length'),String(bytes.length));assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 for(const path of [before.public_path,'/api/modules/'+id+'/raw','/api/modules/'+id+'.js','/'+id+'.js']){
  const raw=await api(s.base,path);assert.ok(raw.ok);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
 }
 const manifest=await s.call('/api/collections/stable.rex').then(ok);assert.match(manifest.widgets[0].url,/\/file\/%E8%A7%86%E9%A2%91.js$/);
 assert.equal(manifest.widgets[0].id,before.widget_id);
 assert.equal((await modules(s))[0].note,'保留备注');assert.equal((await s.call('/api/admin/collections').then(ok))[0].id,col.id);
 assert.equal((await s.call('/api/admin/modules/missing/download')).status,404);
});

test('cleaned name collision never merges modules; encrypted reuploads retain original filename aliases and accepted names',async t=>{
 const s=await start(t),a=await upload(s,'REX-video.js','REXENC\nfirst encrypted payload');
 const b=await upload(s,'video.js','REXENC\nsecond encrypted payload');
 assert.notEqual(a.module_id,b.module_id);assert.equal(a.effective_filename,'video.js');assert.match(b.effective_filename,/^video-[a-z0-9]{8}\.js$/);
 const renamed=await upload(s,'new-source.js','REXENC\nupdated payload','我的文件.js',a.module_id);
 assert.equal(renamed.module_id,a.module_id);
 const reupload=new File(['REXENC\nthird payload'],'REX-video.js'),p=await preview(s,reupload);
 assert.equal(p.rows[0].target.id,a.module_id);assert.equal(p.rows[0].effective_filename,'我的文件.js');
 await ok(await commit(s,p,reupload));assert.equal((await modules(s)).length,2);
 const accepted=(await modules(s)).find(m=>m.id===a.module_id);assert.equal(accepted.effective_filename,'我的文件.js');
 assert.ok(accepted.original_filenames.includes('new-source.js'));assert.ok(accepted.original_filenames.includes('REX-video.js'));
});

test('settings affect future imports only; existing repair is explicit, editable and rejects stale previews atomically',async t=>{
 const s=await start(t);await settings(s,false);
 const a=await upload(s,'A_REX.js',code('a')),b=await upload(s,'B_rex.js',code('b'));
 await settings(s,true);assert.equal((await modules(s)).find(m=>m.id===a.module_id).effective_filename,'A_REX.js');
 let rows=(await scan(s)).rows;assert.equal(rows.length,2);
 const original=(await modules(s)).find(m=>m.id===a.module_id);
 await ok(await s.call('/api/admin/modules?id='+a.module_id,{method:'PATCH',json:{note:'new note'}}));
 assert.equal((await repair(s,rows)).status,409);assert.equal((await scan(s)).rows.length,2);
 rows=(await scan(s)).rows;rows.find(r=>r.id===a.module_id).suggested='自定名称.js';
 await ok(await repair(s,rows));assert.equal((await scan(s)).rows.length,0);
 const changed=(await modules(s)).find(m=>m.id===a.module_id);
 for(const key of ['id','widget_id','filename','sort_order','group_id','file_key','content_hash'])assert.equal(changed[key],original[key]);
 assert.equal(changed.title,'REX 模块标题');assert.equal(changed.effective_filename,'自定名称.js');
 const oldNamed=changed.public_path;await settings(s,false);const c=await upload(s,'C_REX.js',code('c'));
 await ok(await repair(s,(await scan(s)).rows));assert.equal((await s.call(oldNamed)).status,200);
 assert.match(c.effective_filename,/REX/);
 const f=new File([code('manual')],'rex-manual.js');const p=await preview(s,f);
 await ok(await commit(s,p,f,'编辑后的名字.js'));assert.equal((await modules(s)).find(m=>m.metadata_id==='manual').effective_filename,'编辑后的名字.js');
});

test('URL preview, single imports and subscription refresh share the rule, preserving accepted names and IDs when upstream changes',async t=>{
 let version=1,name='REX-%E8%A7%86%E9%A2%91.js';const root='https://modules.example';
 const s=await start(t,{remoteFetch:async url=>new Response(url.endsWith('.rex')?JSON.stringify({title:'源',widgets:[{id:'remote',title:'模块',url:root+'/'+name}]}):code('source',version))});
 const p=await ok(await s.call('/api/admin/filename-preview',{method:'POST',json:{url:root+'/'+name}}));assert.equal(p.original,'REX-视频.js');assert.equal(p.suggested,'视频.js');
 const imported=await ok(await s.call('/api/admin/modules/import',{method:'POST',json:{url:root+'/'+name}}));assert.equal(imported.added[0].effective_filename,'视频.js');
 const src=(await ok(await s.call('/api/admin/modules/import',{method:'POST',json:{url:root+'/collection.rex'}}))).subscription.id;
 async function cycle(){for(let n=0;n<5;n++)if((await ok(await s.call('/api/admin/subscriptions/'+src+'/sync',{method:'POST'}))).done)return;throw Error('sync incomplete');}
 await cycle();const before=(await modules(s))[0];assert.equal(before.id,imported.added[0].id);
 version=2;name='another-REX-name.js';await cycle();const after=(await modules(s))[0];
 assert.equal(after.id,before.id);assert.equal(after.effective_filename,before.effective_filename);assert.equal(after.public_path,before.public_path);
 assert.equal(await (await s.call(after.public_path)).text(),code('source',2));
 const subOnly=await start(t,{remoteFetch:async url=>new Response(url.endsWith('.rex')?JSON.stringify({title:'源',widgets:[{id:'remote',url:root+'/new-REX-file.js'}]}):code('other'))});
 const sid=(await ok(await subOnly.call('/api/admin/modules/import',{method:'POST',json:{url:root+'/collection.rex'}}))).subscription.id;
 await ok(await subOnly.call('/api/admin/subscriptions/'+sid+'/sync',{method:'POST'}));await ok(await subOnly.call('/api/admin/subscriptions/'+sid+'/sync',{method:'POST'}));
 const sub=(await modules(subOnly))[0];assert.equal(sub.effective_filename,'new-file.js');assert.ok(sub.original_filenames.includes('new-REX-file.js'));
});

test('format 7 round-trip retains naming, aliases, settings, bytes and old links; malformed names roll back; format 5 remains readable',async t=>{
 const s=await start(t),a=await upload(s,'REX-file.js',code('a'),'我的名字.js');await settings(s,false);
 const saved=await backup(s);assert.equal(saved.format,7);assert.equal(saved.meta.names.length,1);
 const other=await start(t);await ok(await other.call('/api/admin/backup/restore',{method:'POST',json:saved}));
 const m=(await modules(other))[0];assert.equal(m.id,a.module_id);assert.equal(m.effective_filename,'我的名字.js');
 assert.equal((await other.call('/api/admin/filename-settings').then(ok)).auto_clean,false);
 assert.equal(await (await other.call(m.public_path)).text(),code('a'));
 const bad=structuredClone(saved);bad.meta.names[0].filename='../bad.js';assert.equal((await other.call('/api/admin/backup/restore',{method:'POST',json:bad})).status,400);
 assert.equal((await modules(other))[0].effective_filename,'我的名字.js');
 const legacy=structuredClone(saved);legacy.format=5;delete legacy.meta.names;delete legacy.meta.filenameSettings;
 const old=await start(t);await ok(await old.call('/api/admin/backup/restore',{method:'POST',json:legacy}));
 assert.equal((await modules(old))[0].effective_filename,'REX-file.js');assert.equal((await scan(old)).rows.length,1);
 await ok(await other.call('/api/admin/modules?id='+a.module_id,{method:'DELETE'}));assert.equal((await backup(other)).meta.names.length,0);
 assert.equal((await other.call(m.public_path)).status,404);
});

test('v3.1 upgrade snapshots the database and leaves legacy filenames and manifest URLs untouched until confirmed',async t=>{
 const directory=temporary(t),old=await start(t,undefined,directory),a=await upload(old,'Legacy-REX.js',code('legacy'));
 await old.close();const db=new DatabaseSync(join(directory,'rex.sqlite'));
 // Model an actual 3.1 database, without upgrade markers from the current server.
 db.exec("DROP TABLE module_names;DELETE FROM settings WHERE key IN ('docker_v32','docker_v33','docker_v35')");db.close();
 const upgraded=await start(t,undefined,directory),m=(await modules(upgraded))[0];
 assert.equal(m.id,a.module_id);assert.equal(m.effective_filename,'Legacy-REX.js');assert.equal(m.public_path,'/api/modules/'+a.module_id+'.js');
 assert.ok(readdirSync(join(directory,'backups')).some(n=>n.startsWith('pre-v32-')));
 assert.equal((await scan(upgraded)).rows.length,1);
});
