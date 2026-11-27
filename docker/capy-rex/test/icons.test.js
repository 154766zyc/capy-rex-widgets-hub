import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deflateSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {listen,close,temporary,api,login} from './helpers.js';
import {parseIconManifest,validateIcon,ICON_LIMITS} from '../icons.js';
import {createSourcePolicy} from '../remote.js';
import {getHTML} from '../worker.js';
const host='https://icons.example';
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,bytes){const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,checksum]);}
function png(color=1){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,color,70,100]))),chunk('IEND',Buffer.alloc(0))]);}
const manifest=(items=[{name:'blue',url:host+'/one.png'}])=>JSON.stringify({name:'测试图标集',icons:items});
const ok=async r=>{const data=await r.json();assert.ok(r.ok,JSON.stringify(data));assert.ok(!data.error||data.ok,JSON.stringify(data));return data;};
async function start(t,transport,config={}){const directory=temporary(t),{server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true',...config},{remoteFetch:transport||(async url=>new Response(url.endsWith('.json')?manifest():png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}}))});
 t.after(()=>close(server));const cookie=await login(base,'test-password');return {base,directory,call:(p,o={})=>api(base,p,{cookie,...o})};}
const add=(s,url=host+'/set.json',name='')=>s.call('/api/admin/icon-sources',{method:'POST',json:{url,...(name?{name}:{})}}).then(ok);
const items=s=>s.call('/api/admin/icons').then(ok);
const backup=s=>s.call('/api/admin/backup').then(ok);
const cache=(s,id)=>s.call('/api/admin/icons/'+id+'/cache',{method:'POST'}).then(ok);
const create=(s,json)=>s.call('/api/admin/collections',{method:'POST',json:{slug:'mine',title:'我的合集',...json}}).then(ok);

test('icon catalogs are strict data, deduplicated by URL, respecting the existing address policy',()=>{
 const env={SOURCE_URL_POLICY:createSourcePolicy()};const encode=text=>Buffer.from(text);
 const data=parseIconManifest(env,encode(manifest([{name:'same',url:host+'/one.png#ignored'},{name:'another',url:host+'/one.png'}])));assert.equal(data.items.length,1);
 for(const text of ['[]','{}','{"icons":[]}',manifest([{name:'x',url:'javascript:alert(1)'}]),manifest([{name:'x',url:'http://192.168.1.5/x.png'}])])assert.throws(()=>parseIconManifest(env,encode(text)));
 assert.equal(parseIconManifest({SOURCE_URL_POLICY:createSourcePolicy('',{addressCheck:false})},encode(manifest([{name:'LAN',url:'http://192.168.1.5/icon.png'}]))).items.length,1);
 assert.equal(validateIcon(png(),'image/png').ext,'png');assert.throws(()=>validateIcon(Buffer.from('<svg/>'),'image/svg+xml'));assert.throws(()=>validateIcon(png(),'text/html'));assert.throws(()=>validateIcon(png().subarray(0,40),'image/png'));
 const huge=png();huge.writeUInt32BE(100000,16);assert.throws(()=>validateIcon(huge,'image/png'));
});
test('icon configuration and downloads require authentication; public endpoints cannot proxy arbitrary URLs',async t=>{
 let requests=0;const s=await start(t,async()=>{requests++;return new Response(manifest());});
 for(const path of ['/api/admin/icon-sources','/api/admin/icons','/api/admin/icons/'+'a'.repeat(64)+'/cache'])assert.equal((await api(s.base,path,{method:path.endsWith('cache')?'POST':'GET'})).status,401);
 assert.equal((await api(s.base,'/api/icons/'+ 'a'.repeat(64)+'.png?url=http://localhost')).status,404);assert.equal(requests,0);
});
test('multiple sources, cross-source search, per-source filtering, pagination and byte deduplication',async t=>{
 const content=manifest(Array.from({length:15},(_,i)=>({name:'blue_'+i,url:host+'/'+i+'.png'})));const s=await start(t,async url=>new Response(url.endsWith('.json')?content:png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}}));
 const a=await add(s),b=await add(s,host+'/other.json','另一图标集');assert.notEqual(a.id,b.id);assert.equal((await items(s)).total,30);
 assert.equal((await ok(await s.call('/api/admin/icons?source='+a.id+'&q='+encodeURIComponent('蓝色')+'&page=2'))).items.length,3);
 const all=(await items(s)).items;const image=await cache(s,all[0].id);await cache(s,all[1].id);assert.equal((await backup(s)).meta.icons.assets.length,1);
 const r=await s.call(image.url);assert.equal(r.headers.get('content-type'),'image/png');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),png());
 assert.equal((await s.call(image.url,{headers:{'If-None-Match':r.headers.get('etag')}})).status,304);assert.equal((await s.call(image.url,{method:'HEAD'})).status,200);
 assert.equal((await s.call('/api/admin/icon-sources',{method:'POST',json:{url:host+'/set.json'}})).status,400);
});
test('refresh preserves entry identity, conditional 304 works, invalid/failed manifests keep old catalog',async t=>{
 let body=manifest(),conditional=false,notModified=false;const s=await start(t,async(url,opts)=>{conditional=!!opts.headers['If-None-Match'];return notModified?new Response(null,{status:304}):new Response(body,{headers:{ETag:'"version1"'}});});
 const source=await add(s),first=(await items(s)).items[0];body=manifest([{name:'renamed blue',url:host+'/one.png'}]);
 assert.equal((await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}))).synced,true);assert.equal((await items(s)).items[0].id,first.id);assert.equal(conditional,true);
 notModified=true;assert.equal((await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}))).notModified,true);
 notModified=false;body='<html>denied</html>';const failed=await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}));assert.equal(failed.synced,false);assert.equal((await items(s)).items[0].name,'renamed blue');
 assert.match((await ok(await s.call('/api/admin/icon-sources')))[0].last_error,/JSON/);
});
test('collection pins remain stable across image update, removal, pause and deleting a source',async t=>{
 let version=1,body=manifest();const s=await start(t,async url=>new Response(url.endsWith('.json')?body:png(version),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}}));
 const source=await add(s),entry=(await items(s)).items[0],col=await create(s,{icon_entry_id:entry.id});const old=(await ok(await s.call('/api/admin/collections')))[0].icon_url;
 assert.equal((await ok(await s.call('/api/collections/mine.rex'))).icon,s.base+old);
 version=2;await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}));const updated=await cache(s,entry.id);assert.notEqual(updated.url,old);
 assert.deepEqual(Buffer.from(await (await s.call(old)).arrayBuffer()),png(1));assert.equal((await ok(await s.call('/api/admin/collections')))[0].id,col.id);
 body=manifest([{name:'replacement',url:host+'/other.png'}]);await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}));assert.notEqual((await items(s)).items[0].id,entry.id);
 await ok(await s.call('/api/admin/icon-sources/'+source.id,{method:'PATCH',json:{enabled:false}}));assert.equal((await items(s)).total,0);
 await ok(await s.call('/api/admin/icon-sources/'+source.id,{method:'DELETE'}));assert.equal((await s.call(old)).status,200);assert.equal((await ok(await s.call('/api/collections/mine.rex'))).icon,s.base+old);
});
test('custom URL caching, clear, unchanged legacy URL, failed image saves leave old collection untouched',async t=>{
 let fail=false,hits=0;const s=await start(t,async()=>{hits++;return new Response(fail?'<html>no</html>':png(),{headers:{'content-type':fail?'text/html':'image/png'}});});
 const col=await create(s,{icon_url:host+'/custom.png'});const old=(await ok(await s.call('/api/admin/collections')))[0].icon_url;assert.match(old,/^\/api\/icons\//);
 fail=true;const result=await s.call('/api/admin/collections',{method:'PATCH',json:{id:col.id,title:'must not save',icon_url:host+'/bad.png'}});assert.equal(result.status,400);assert.equal((await ok(await s.call('/api/admin/collections')))[0].title,'我的合集');
 await ok(await s.call('/api/admin/collections',{method:'PATCH',json:{id:col.id,icon_entry_id:null}}));assert.equal((await ok(await s.call('/api/admin/collections')))[0].icon_url,'');
 const db=new DatabaseSync(join(s.directory,'rex.sqlite'));db.prepare('UPDATE collections SET icon_url=? WHERE id=?').run('https://legacy.example/image.png',col.id);db.close();
 const before=hits;await ok(await s.call('/api/admin/collections',{method:'PATCH',json:{id:col.id,title:'renamed',icon_url:'https://legacy.example/image.png'}}));assert.equal(hits,before);
 assert.equal((await ok(await s.call('/api/admin/collections')))[0].icon_url,'https://legacy.example/image.png');
});
test('current backup restores icons and stable paths, corrupt image backup rolls back, format-4 remains readable',async t=>{
 const s=await start(t);await add(s);const entry=(await items(s)).items[0];await create(s,{icon_entry_id:entry.id});const saved=await backup(s);assert.equal(saved.format,7);
 const other=await start(t);await ok(await other.call('/api/admin/backup/restore',{method:'POST',json:saved}));const col=(await ok(await other.call('/api/admin/collections')))[0];assert.equal(col.icon_url,saved.meta.collections[0].icon_url);assert.equal((await other.call(col.icon_url)).status,200);assert.equal((await items(other)).items[0].id,entry.id);
 const corrupt=structuredClone(saved);corrupt.meta.icons.assets[0].hash='0'.repeat(64);corrupt.meta.collections[0].title='do not publish';assert.equal((await other.call('/api/admin/backup/restore',{method:'POST',json:corrupt})).status,400);assert.equal((await ok(await other.call('/api/admin/collections')))[0].title,'我的合集');
 const missing=structuredClone(saved);missing.meta.icons.assets=[];const empty=await start(t);assert.equal((await empty.call('/api/admin/backup/restore',{method:'POST',json:missing})).status,400);
 const legacy={format:4,files:{},meta:{collections:[{id:'legacy',slug:'legacy',title:'Old',icon_url:host+'/old.png',moduleIds:[]}]}};await ok(await empty.call('/api/admin/backup/restore',{method:'POST',json:legacy}));assert.equal((await ok(await empty.call('/api/collections/legacy.rex'))).icon,host+'/old.png');
});
for(const operation of ['pause','delete','reset','restore'])test('in-flight icon source refresh cannot publish after '+operation,async t=>{
 let slow=false,release,started;const waiting=new Promise(r=>started=r);const s=await start(t,async()=>{if(!slow)return new Response(manifest());started();return new Promise(r=>release=()=>r(new Response(manifest([{name:'must not publish',url:host+'/new.png'}]))));});
 const source=await add(s),saved=await backup(s);slow=true;const running=s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'});await waiting;
 assert.equal((await s.call('/api/admin/collections')).status,200,'network must not hold the SQLite lock');
 if(operation==='pause')await ok(await s.call('/api/admin/icon-sources/'+source.id,{method:'PATCH',json:{enabled:false}}));
 if(operation==='delete')await ok(await s.call('/api/admin/icon-sources/'+source.id,{method:'DELETE'}));
 if(operation==='reset')await ok(await s.call('/api/admin/reset',{method:'POST'}));
 if(operation==='restore')await ok(await s.call('/api/admin/backup/restore',{method:'POST',json:saved}));
 release();assert.equal((await ok(await running)).synced,false);assert.ok(!(await backup(s)).meta.icons.entries.some(e=>e.name==='must not publish'));
});
test('an in-flight image cache cannot write after source deletion',async t=>{
 let release,started;const waiting=new Promise(r=>started=r);const s=await start(t,async url=>{if(url.endsWith('.json'))return new Response(manifest());started();return new Promise(r=>release=()=>r(new Response(png(),{headers:{'content-type':'image/png'}})));});
 const source=await add(s),entry=(await items(s)).items[0],running=s.call('/api/admin/icons/'+entry.id+'/cache',{method:'POST'});await waiting;await ok(await s.call('/api/admin/icon-sources/'+source.id,{method:'DELETE'}));release();assert.equal((await running).status,400);assert.equal((await backup(s)).meta.icons.assets.length,0);
});
test('a source revision change rejects late image bytes from the previous catalog',async t=>{
 let release,started,slow=true;const waiting=new Promise(r=>started=r);const s=await start(t,async url=>{if(url.endsWith('.json'))return new Response(manifest());if(!slow)return new Response(png(2),{headers:{'content-type':'image/png'}});started();return new Promise(r=>release=()=>r(new Response(png(1),{headers:{'content-type':'image/png'}})));});
 const source=await add(s),entry=(await items(s)).items[0],running=s.call('/api/admin/icons/'+entry.id+'/cache',{method:'POST'});await waiting;
 await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}));release();assert.equal((await running).status,400);assert.equal((await backup(s)).meta.icons.assets.length,0);
 slow=false;const cached=await cache(s,entry.id);assert.deepEqual(Buffer.from(await (await s.call(cached.url)).arrayBuffer()),png(2));
});
test('saving a previewed immutable path never silently selects newer upstream image bytes',async t=>{
 let version=1;const s=await start(t,async url=>new Response(url.endsWith('.json')?manifest():png(version),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}}));
 const source=await add(s),entry=(await items(s)).items[0],preview=await cache(s,entry.id);version=2;
 await ok(await s.call('/api/admin/icon-sources/'+source.id+'/refresh',{method:'POST'}));const updated=await cache(s,entry.id);assert.notEqual(updated.url,preview.url);
 await create(s,{icon_url:preview.url});const col=(await ok(await s.call('/api/admin/collections')))[0];assert.equal(col.icon_url,preview.url);assert.deepEqual(Buffer.from(await (await s.call(col.icon_url)).arrayBuffer()),png(1));
});
test('daily icon deadline persists and the server scheduler refreshes icons without due module subscriptions',async t=>{
 let requests=0,resolveSync;const synced=new Promise(r=>resolveSync=r);const s=await start(t,async(url,options)=>{requests++;if(requests===2){assert.equal(options.headers['If-None-Match'],'"daily"');resolveSync();return new Response(null,{status:304});}return new Response(manifest(),{headers:{ETag:'"daily"'}});},{DISABLE_SCHEDULER:'false'});
 const source=await add(s),list=await ok(await s.call('/api/admin/icon-sources'));assert.ok(list[0].next_sync_at-Date.now()>23.9*3600000);assert.equal(requests,1);
 const db=new DatabaseSync(join(s.directory,'rex.sqlite'));db.prepare('UPDATE icon_sources SET next_sync_at=? WHERE id=?').run(Date.now()-1,source.id);db.close();
 let timeout;try{await Promise.race([synced,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('icon scheduler did not run')),5000);})]);}finally{clearTimeout(timeout);}
 for(let i=0;i<50;i++){const state=(await ok(await s.call('/api/admin/icon-sources')))[0];if(!state.syncing&&state.next_sync_at>Date.now()+23.9*3600000){assert.equal(state.last_error,'');assert.equal(requests,2);return;}await new Promise(r=>setTimeout(r,10));}assert.fail('daily schedule was not committed');
});
test('cache eviction protects pinned images and rejects new saves when only referenced assets fill quota',async t=>{
 const s=await start(t,async url=>new Response(png(url.includes('two')?2:1),{headers:{'content-type':'image/png'}}));await create(s,{icon_url:host+'/one.png'});const savedLimit=ICON_LIMITS.assets;
 try{ICON_LIMITS.assets=png().length;assert.equal((await s.call('/api/admin/collections',{method:'POST',json:{slug:'other',title:'Other',icon_url:host+'/two.png'}})).status,400);assert.equal((await ok(await s.call('/api/admin/collections'))).length,1);assert.equal((await backup(s)).meta.icons.assets.length,1);}finally{ICON_LIMITS.assets=savedLimit;}
});
test('production HTML includes multi-source picker and every embedded script parses',()=>{const html=getHTML();for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);assert.match(html,/全部图标集/);assert.match(html,/data-role="preview"/);assert.match(html,/图标 URL（可手填）/);assert.match(html,/if\(draft.changed\)/);});
