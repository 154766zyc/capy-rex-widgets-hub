import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync as readPackage} from 'node:fs';
// 版本号只在 package.json / CF_VERSION 改一次，测试从这里读，不再写死。
const PACKAGE_VERSION=JSON.parse(readPackage(new URL('../package.json',import.meta.url),'utf8')).version;
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import worker,{bootstrap,getHTML} from '../worker.js';
import {SQLiteKV} from '../kv.js';
import {SQLiteD1} from '../storage.js';
import {createSourcePolicy} from '../remote.js';
import {cleanupIcons} from '../icons.js';
import {temporary} from './helpers.js';
const code=(id='test',v='1')=>`var WidgetMetadata={id:'${id}',title:'测试模块',version:'${v}'};function play(){}`;
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,bytes){const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,checksum]);}
function png(color=1){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,color,70,100]))),chunk('IEND',Buffer.alloc(0))]);}
const manifest=(extra={})=>({title:'测试订阅',icon:'/avatar.png',widgets:[{id:'remote',url:'https://source.example/a.js',title:'上游名称',version:'9'}],...extra});
async function app(t){
 const kv=new SQLiteKV(join(temporary(t),'rex.sqlite')),DB=new SQLiteD1(kv.db,kv.gate);t.after(()=>kv.close());
 const f={sql:kv.db,remote:async url=>new Response(url.endsWith('.png')?png():url.endsWith('.rex')?JSON.stringify(manifest()):code(),{headers:{'content-type':url.endsWith('.png')?'image/png':'application/javascript'}})};
 const env=f.env={KV:kv,DB,ATOMIC:work=>kv.transaction(work),SOURCE_URL_POLICY:createSourcePolicy(),REMOTE_FETCH:(...args)=>f.remote(...args)};
 await bootstrap(env);f.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test',Date.now(),Date.now()+3600000);
 f.call=(path,{method='GET',json,body,auth=true}={})=>worker.fetch(new Request('https://hub.example'+path,{method,headers:{...(auth?{cookie:'fwh_admin=test'}:{}),...(json?{'content-type':'application/json'}:{})},body:json?JSON.stringify(json):body}),env);
 f.ok=async(path,opts)=>{const r=await f.call(path,opts),b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
 f.add=(url='https://source.example/a.rex')=>f.ok('/api/admin/modules/import',{method:'POST',json:{url}});
 f.source=async id=>(await f.ok('/api/admin/subscriptions')).find(s=>s.id===id);
 f.icon=async(id,url)=>{const s=await f.source(id);return f.ok('/api/admin/subscriptions/'+id+'/icon',{method:'PATCH',json:{revision:s.revision,expected_icon_url:s.custom_icon_url,icon_mode:url?'custom':'auto',...(url?{icon_url:url}:{})}});};
 f.sync=id=>f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});
 f.complete=async id=>{for(let i=0;i<20;i++){const r=await f.sync(id);if(r.done)return r;}throw Error('sync timeout');};
 return f;
}
test('3.4 collection avatars resolve relative icon/logo and reject non-public HTTPS or credentials',async t=>{
 const f=await app(t);let body=manifest({widgets:[],icon:'http://bad.example/x',logo:'../logo.png'});f.remote=async()=>new Response(JSON.stringify(body));
 const p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/nested/a.rex'}});assert.equal(p.icon_url,'https://source.example/logo.png');
 const added=await f.ok('/api/admin/modules/import',{method:'POST',json:{url:p.url,preview_id:p.preview_id}});const s=await f.source(added.subscription.id);assert.equal(s.upstream_icon_url,p.icon_url);assert.equal(s.icon_url,p.icon_url);
 for(const icon of ['https://127.0.0.1/a','https://192.168.1.5/a','https://user:pass@example.com/a','data:image/png,aaa']){body={widgets:[],icon};const v=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/test.rex'}});assert.equal(v.icon_url,'');}
});
test('3.4 custom subscription image saves only after valid download; failed save and auto restore preserve scheduling',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id,before=await f.source(id);
 assert.equal((await f.call('/api/admin/subscriptions/'+id+'/icon',{method:'PATCH',auth:false,json:{}})).status,401);
 await f.icon(id,'https://source.example/custom.png');const s=await f.source(id);assert.match(s.custom_icon_url,/^\/api\/icons\/.*\.png$/);assert.equal(s.icon_url,s.custom_icon_url);
 for(const key of ['id','url','revision','enabled','next_sync_at','last_finished_at','status'])assert.equal(s[key],before[key]);
 f.remote=async()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}});
 const bad=await f.call('/api/admin/subscriptions/'+id+'/icon',{method:'PATCH',json:{revision:s.revision,expected_icon_url:s.custom_icon_url,icon_mode:'custom',icon_url:'https://source.example/bad.png'}});assert.equal(bad.status,400);assert.equal((await f.source(id)).custom_icon_url,s.custom_icon_url);
 await f.icon(id,null);assert.equal((await f.source(id)).icon_url,before.upstream_icon_url);assert.equal((await f.source(id)).custom_icon_url,'');
});
test('3.4 stale icon windows and a paused/deleted source during image download cannot publish',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id,s=await f.source(id);
 await f.icon(id,'https://source.example/new.png');const stale={revision:s.revision,expected_icon_url:'',icon_mode:'auto'};
 assert.equal((await f.call('/api/admin/subscriptions/'+id+'/icon',{method:'PATCH',json:stale})).status,409);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);f.remote=async()=>{entered();await gate;return new Response(png(2),{headers:{'content-type':'image/png'}});};
 const current=await f.source(id),pending=f.call('/api/admin/subscriptions/'+id+'/icon',{method:'PATCH',json:{revision:current.revision,expected_icon_url:current.custom_icon_url,icon_mode:'custom',icon_url:'https://source.example/delayed.png'}});
 await started;await f.ok('/api/admin/subscriptions/'+id,{method:'PATCH',json:{enabled:false}});release();assert.equal((await pending).status,409);assert.equal((await f.source(id)).custom_icon_url,current.custom_icon_url);
 await f.icon(id,null);assert.equal((await f.source(id)).enabled,0);
});
test('3.4 sync publication merges live custom image even when changed during download',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id;await f.sync(id);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const transport=f.remote;f.remote=async url=>{if(url.endsWith('.js')){entered();await gate;}return transport(url);};
 const pending=f.sync(id);await started;await f.icon(id,'https://source.example/override.png');const image=(await f.source(id)).custom_icon_url;release();await pending;assert.equal((await f.source(id)).custom_icon_url,image);
 f.remote=transport;await f.complete(id);assert.equal((await f.source(id)).custom_icon_url,image);
 const items=await f.ok('/api/admin/subscriptions/'+id+'/items');assert.equal(items[0].version,'9');assert.equal(items[0].local_version,'1');assert.equal(items[0].local_encrypted,0);
});
test('3.4 clearing an override during sync is not undone by a stale summary',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id;await f.icon(id,'https://source.example/custom.png');await f.sync(id);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const remote=f.remote;f.remote=async url=>{if(url.endsWith('.js')){entered();await gate;}return remote(url);};
 const pending=f.sync(id);await started;await f.icon(id,null);release();await pending;assert.equal((await f.source(id)).custom_icon_url,'');assert.equal((await f.source(id)).icon_url,'https://source.example/avatar.png');
});
test('3.4 encrypted single-module subscriptions keep image on sync/pause and format7 round trip',async t=>{
 const f=await app(t),remote=f.remote;f.remote=async url=>url.endsWith('.js')?new Response('REXENC\nsecret'):remote(url);
 const id=(await f.add('https://source.example/enc.js')).subscription.id;await f.icon(id,'https://source.example/custom.png');const before=await f.source(id);await f.sync(id);await f.ok('/api/admin/subscriptions/'+id,{method:'PATCH',json:{enabled:false}});
 assert.equal((await f.source(id)).custom_icon_url,before.custom_icon_url);assert.equal((await f.ok('/api/admin/subscriptions/'+id+'/items'))[0].local_encrypted,1);
 const backup=await f.ok('/api/admin/backup');assert.equal(backup.format,7);const other=await app(t);await other.ok('/api/admin/backup/restore',{method:'POST',json:backup});const s=await other.source(id);assert.equal(s.custom_icon_url,before.custom_icon_url);assert.equal((await other.call(s.icon_url,{auth:false})).status,200);
});
test('3.4 backup rejects missing/invalid subscription image references without modifying data',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id;await f.icon(id,'https://source.example/custom.png');const saved=await f.ok('/api/admin/backup');
 for(const corrupt of [b=>{b.meta.icons.assets=[];},b=>{b.meta.sources[0].summary=JSON.stringify({custom_icon_url:'https://evil.example/x.png'});}]){const other=await app(t),b=structuredClone(saved);corrupt(b);assert.equal((await other.call('/api/admin/backup/restore',{method:'POST',json:b})).status,400);assert.equal(other.sql.prepare('SELECT COUNT(*) n FROM subscription_sources').get().n,0);}
});
test('3.4 cache cleanup pins custom subscription images and collects unused images',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id;await f.icon(id,'https://source.example/first.png');const first=(await f.source(id)).custom_icon_url;
 f.remote=async()=>new Response(png(2),{headers:{'content-type':'image/png'}});await f.icon(id,'https://source.example/second.png');const second=(await f.source(id)).custom_icon_url;assert.notEqual(first,second);f.sql.exec('UPDATE icon_assets SET last_used_at=1');await cleanupIcons(f.env);assert.equal((await f.call(first)).status,404);assert.equal((await f.call(second)).status,200);
});
test('3.4 changing collection source URL or title preserves custom image and refreshes upstream image',async t=>{
 const f=await app(t),id=(await f.add()).subscription.id;await f.icon(id,'https://source.example/custom.png');const before=await f.source(id);
 f.remote=async()=>new Response(JSON.stringify(manifest({icon:'/new-avatar.png'})));
 const preview=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/new.rex'}});
 await f.ok('/api/admin/subscriptions/'+id,{method:'PATCH',json:{url:preview.url,preview_id:preview.preview_id,revision:before.revision,title:'新标题'}});
 const next=await f.source(id);assert.equal(next.custom_icon_url,before.custom_icon_url);assert.equal(next.upstream_icon_url,'https://source.example/new-avatar.png');assert.equal(next.title,'新标题');
 const backup=await f.ok('/api/admin/backup');backup.meta.sources[0].summary=JSON.parse(backup.meta.sources[0].summary);const other=await app(t);await other.ok('/api/admin/backup/restore',{method:'POST',json:backup});assert.equal((await other.source(id)).custom_icon_url,before.custom_icon_url);
});
test('3.4 icon preview is paginated, capped at60, permits explicit disabled source only',async t=>{
 const f=await app(t);f.remote=async()=>new Response(JSON.stringify({name:'Library',icons:Array.from({length:67},(_,i)=>({name:'blue '+i,url:'https://icons.example/'+i+'.png'}))}));
 const s=await f.ok('/api/admin/icon-sources',{method:'POST',json:{url:'https://icons.example/set.json'}});await f.ok('/api/admin/icon-sources/'+s.id,{method:'PATCH',json:{enabled:false}});
 assert.equal((await f.ok('/api/admin/icons?preview=1&size=60')).items.length,0);const preview=await f.ok('/api/admin/icons?preview=1&size=100&source='+s.id);assert.equal(preview.items.length,60);assert.equal(preview.pages,2);assert.equal((await f.ok('/api/admin/icons?preview=1&size=60&page=2&source='+s.id)).items.length,7);assert.equal((await f.ok('/api/admin/icons?source='+s.id)).total,0);
});
async function duplicateFixture(t){
 const f=await app(t);const a=(await f.add('https://source.example/a.js')).added[0];
 // 3.5 now requires an explicit decision to create duplicate test fixtures.
 const p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/b.js'}});
 const b=(await f.ok('/api/admin/modules/import',{method:'POST',json:{url:p.url,preview_id:p.preview_id,duplicate_action:'new',duplicate_token:p.duplicate_token}})).added[0];
 const c=await f.ok('/api/admin/collections',{method:'POST',json:{title:'我的合集',slug:'mine',moduleIds:[a.id,b.id]}});return {...f,a,b,c};
}
test('3.4 duplicate scan uses saved metadata only and consolidates identical sets',async t=>{
 const f=await duplicateFixture(t);f.remote=()=>{throw Error('scan must not download');};const before=f.sql.prepare('SELECT * FROM modules ORDER BY id').all();
 const r=await f.ok('/api/admin/modules/duplicates');assert.equal(r.groups.length,1);assert.equal(r.modules.length,2);assert.deepEqual(r.groups[0].reasons.map(x=>x.type),['hash','id']);assert.deepEqual(f.sql.prepare('SELECT * FROM modules ORDER BY id').all(),before);
 assert.equal((await f.call('/api/admin/modules/duplicates',{auth:false})).status,401);
});
test('3.4 duplicate deletion rejects changed references, then deletes only confirmed module and tombstones alias',async t=>{
 const f=await duplicateFixture(t);const p=await f.ok('/api/admin/modules/'+f.a.id+'/share/preview',{method:'POST',json:{alias:'测试.js'}});const share=await f.ok('/api/admin/modules/'+f.a.id+'/share',{method:'PUT',json:{alias:p.alias,revision:p.revision}});
 const scanned=await f.ok('/api/admin/modules/duplicates'),entry=scanned.modules.find(m=>m.id===f.a.id),body={id:f.a.id,group_token:scanned.groups[0].token,revision:entry.revision};
 f.sql.prepare('DELETE FROM collection_modules WHERE module_id=?').run(f.a.id);assert.equal((await f.call('/api/admin/modules/duplicates/delete',{method:'POST',json:body})).status,409);assert.ok(f.sql.prepare('SELECT id FROM modules WHERE id=?').get(f.a.id));
 const fresh=await f.ok('/api/admin/modules/duplicates');await f.ok('/api/admin/modules/duplicates/delete',{method:'POST',json:{id:f.a.id,group_token:fresh.groups[0].token,revision:fresh.modules.find(m=>m.id===f.a.id).revision}});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);assert.equal((await f.call(share.path,{auth:false})).status,404);assert.equal(f.sql.prepare('SELECT tombstoned FROM module_share_aliases WHERE module_id=?').get(f.a.id).tombstoned,1);assert.equal(f.sql.prepare('SELECT module_id FROM collection_modules WHERE collection_id=?').get(f.c.id).module_id,f.b.id);
});
test('3.4 duplicate ID ignores inherited encrypted IDs, single constant and URLs',async t=>{
 const f=await duplicateFixture(t);f.sql.exec("UPDATE modules SET is_encrypted=1,content_hash='',metadata_id='inherited',filename=id||'.js'");assert.equal((await f.ok('/api/admin/modules/duplicates')).groups.length,0);
 f.sql.prepare('UPDATE modules SET filename=? WHERE id=?').run('Shared.js',f.a.id);f.sql.prepare('UPDATE modules SET filename=? WHERE id=?').run('shared.js',f.b.id);assert.equal((await f.ok('/api/admin/modules/duplicates')).groups.length,0);
});
test('3.4 automatic-all collections cannot be manual bulk-append targets',async t=>{
 const f=await duplicateFixture(t);f.sql.prepare('UPDATE collections SET auto_all=1 WHERE id=?').run(f.c.id);
 const response=await f.call('/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:[f.a.id],collectionId:f.c.id}});assert.equal(response.status,400);
});
test('3.4 rendered UI scripts compile and retain Docker backup endpoint and new controls',()=>{
 const html=getHTML();for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 for(const word of ['移入其他分组','保存图标','恢复自动图标','未分类','重复模块','Capy/Rex Widgets Hub · V1','/api/admin/backup/restore'])assert.ok(html.includes(word),word);
 assert.ok(!html.includes('/api/admin/backup/restore/start'));assert.ok(!html.includes('Cloudflare Workers · D1'));
});
