import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker,{bootstrap} from '../worker.js';
import {SQLiteKV} from '../kv.js';
import {SQLiteD1} from '../storage.js';
import {createSourcePolicy} from '../remote.js';
import {temporary} from './helpers.js';
import {join} from 'node:path';
const enc=value=>Buffer.concat([Buffer.from('REXENC\n'+value),Buffer.from([255,0,128])]);
const code=(id='lx',title='LX-music',v='1')=>`var WidgetMetadata={id:'${id}',title:'${title}',version:'${v}'};function play(){}`;
async function app(t,policy=createSourcePolicy()){
 const kv=new SQLiteKV(join(temporary(t),'rex.sqlite')),DB=new SQLiteD1(kv.db,kv.gate);
 t.after(()=>kv.close());
 const prepare=DB.prepare.bind(DB);DB.prepare=query=>{const mark=s=>{s.query=query;const bind=s.bind.bind(s);s.bind=(...args)=>mark(bind(...args));return s;};return mark(prepare(query));};
 let fail=false;const batch=DB.batch.bind(DB);DB.batch=async statements=>{if(fail){fail=false;throw Error('Injected publish failure');}return batch(statements);};
 const env={KV:kv,DB,ATOMIC:work=>kv.transaction(work),SOURCE_URL_POLICY:policy,REMOTE_FETCH:(...args)=>globalThis.fetch(...args)};
 await bootstrap(env);
 const f={env,sql:kv.db,files:{delete:key=>kv.db.prepare('DELETE FROM kv WHERE key=?').run(key)},fail(){fail=true;}};
 f.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test',Date.now(),Date.now()+3600000);
 f.call=(path,{method='GET',json,body,auth=true,headers={}}={})=>worker.fetch(new Request('https://hub.example'+path,{method,headers:{...(auth?{cookie:'fwh_admin=test'}:{}),...(json?{'content-type':'application/json'}:{}),...headers},body:json?JSON.stringify(json):body}),env);
 f.ok=async(path,opts)=>{const r=await f.call(path,opts),b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
 f.add=async(url,more={})=>{
  if(more.allow_duplicate){const p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}});more={...more,preview_id:p.preview_id,duplicate_action:'new',duplicate_token:p.duplicate_token};}
  return f.ok('/api/admin/modules/import',{method:'POST',json:{url,...more}});
 };
 f.share=async(id,alias)=>{const p=await f.ok('/api/admin/modules/'+id+'/share/preview',{method:'POST',json:alias?{alias}:{}});return f.ok('/api/admin/modules/'+id+'/share',{method:'PUT',json:{alias:p.alias,revision:p.revision}});};
 f.mod=id=>f.sql.prepare('SELECT * FROM modules WHERE id=?').get(id);
 return f;
}
async function restore(f,saved){return f.ok('/api/admin/backup/restore',{method:'POST',json:saved});}
test('readable alias returns exact encrypted bytes with GET/HEAD/CORS/304; rename keeps old links and module identity',async t=>{
 const bytes=enc('content'),f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(bytes));
 const r=await f.add('https://source.example/original.js'),m=r.added[0],first=await f.share(m.id,'音乐 & LX.js');
 for(const path of [first.path,m.public_path,'/api/modules/'+m.id+'.js','/api/modules/'+m.id+'/raw','/'+m.id+'.js']){
  const response=await f.call(path,{auth:false});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 const head=await f.call(first.path,{method:'HEAD',auth:false});assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(head.headers.get('access-control-allow-origin'),'*');assert.match(head.headers.get('content-disposition'),/filename\*=UTF-8/);
 const notModified=await f.call(first.path,{auth:false,headers:{'If-None-Match':head.headers.get('etag')}});assert.equal(notModified.status,304);
 const second=await f.share(m.id,'LX-music.js');assert.equal((await f.call(first.path,{auth:false})).status,200);assert.equal((await f.call(second.path,{auth:false})).status,200);
 assert.equal(f.mod(m.id).filename,'original.js');assert.equal(f.mod(m.id).widget_id,m.id);assert.notEqual(f.mod(m.id).widget_id,'single');
});
test('case-insensitive alias conflicts allocate suffix, stale confirmation rejects, tombstones cannot be reused',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const a=(await f.add('https://source.example/a.js')).added[0],b=(await f.add('https://source.example/b.js',{allow_duplicate:true})).added[0];
 await f.share(a.id,'LX-music.js');const p=await f.ok('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:'lx-MUSIC.js'}});assert.equal(p.conflict,true);assert.notEqual(p.alias,'lx-MUSIC.js');
 const stale=await f.ok('/api/admin/modules/'+a.id+'/share/preview',{method:'POST',json:{}});await f.share(a.id,'New-name.js');
 assert.equal((await f.call('/api/admin/modules/'+a.id+'/share',{method:'PUT',json:{alias:'Old-stale.js',revision:stale.revision}})).status,409);
 await f.ok('/api/admin/modules?id='+a.id,{method:'DELETE'});assert.equal((await f.call('/api/modules/LX-music.js',{auth:false})).status,404);
 const after=await f.ok('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:'LX-music.js'}});assert.equal(after.conflict,true);
 for(const bad of ['../evil.js','x/y.js','x%2fy.js','x\\y.js'])assert.equal((await f.call('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:bad}})).status,409);
 const reserved=await f.ok('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:b.id+'.js'}});assert.equal(reserved.conflict,true);
});
test('preview identifies content not suffix and first commit reuses download; duplicate URL preserves pause and query order',async t=>{
 let hits=0;const f=await app(t);t.mock.method(globalThis,'fetch',async()=>{hits++;return new Response(code());});
 const url='https://source.example/raw?b=2&a=1#fragment',p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}});
 assert.equal(p.kind,'module');assert.equal(p.title,'LX-music');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,0);
 const r=await f.add(url,{preview_id:p.preview_id});assert.equal(hits,1);assert.equal(r.subscription.kind,'module');assert.equal(r.added[0].source_managed,1);
 await f.ok('/api/admin/subscriptions/'+r.subscription.id,{method:'PATCH',json:{enabled:0}});
 const duplicate=await f.add(url);assert.equal(hits,1);assert.equal(duplicate.subscription.id,r.subscription.id);assert.equal(f.sql.prepare('SELECT enabled,url FROM subscription_sources').get().enabled,0);assert.equal(f.sql.prepare('SELECT url FROM subscription_sources').get().url,'https://source.example/raw?b=2&a=1');
});
test('encrypted single subscription detects same-version byte changes, preserves identities, aliases and collection links',async t=>{
 let bytes=enc('version-one');const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(bytes));
 const r=await f.add('https://source.example/123av-stream.js'),m=r.added[0],s=r.subscription;
 assert.equal(m.title,'123av-stream');assert.equal(m.version,'');assert.notEqual(m.widget_id,'single');
 await f.share(m.id,'123av-stream.js');f.sql.exec("INSERT INTO collections(id,slug,title,description,icon_url,created_at,updated_at) VALUES('mine','mine','Mine','','',1,1)");f.sql.prepare('INSERT INTO collection_modules VALUES(?,?,0)').run('mine',m.id);f.sql.prepare('UPDATE modules SET note=?,group_id=?,sort_order=17 WHERE id=?').run('note','group',m.id);
 const old=f.mod(m.id),unchanged=await f.ok('/api/admin/subscriptions/'+s.id+'/sync',{method:'POST'});assert.equal(unchanged.summary.unchanged,1);assert.equal(f.mod(m.id).updated_at,old.updated_at);
 bytes=enc('version-two');const updated=await f.ok('/api/admin/subscriptions/'+s.id+'/sync',{method:'POST'});assert.equal(updated.summary.updated,1);
 const now=f.mod(m.id);for(const key of ['id','widget_id','filename','note','group_id','sort_order'])assert.equal(now[key],old[key]);assert.notEqual(now.content_hash,old.content_hash);
 const collection=await f.ok('/api/collections/mine.rex');assert.equal(collection.widgets[0].url,'https://hub.example/api/modules/123av-stream.js');assert.deepEqual(Buffer.from(await (await f.call('/api/modules/123av-stream.js',{auth:false})).arrayBuffer()),bytes);
});
test('failed fetch/type change, pause, manual override and cancellation never replace working files',async t=>{
 let bytes=enc('original'),type='application/javascript',status=200;const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{status,headers:{'content-type':type}}));
 const r=await f.add('https://source.example/a.js'),m=r.added[0],id=r.subscription.id,old=f.mod(m.id);
 for(const body of ['<html>login</html>',JSON.stringify({widgets:[]})]){bytes=Buffer.from(body);assert.equal((await f.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'})).status,400);assert.equal(f.mod(m.id).file_key,old.file_key);}
 bytes=enc('new-content');await f.ok('/api/admin/modules/'+m.id+'/maintenance',{method:'PATCH',json:{manual:true}});
 const manual=await f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});assert.equal(manual.summary.manual,1);assert.equal(f.mod(m.id).file_key,old.file_key);
 await f.ok('/api/admin/subscriptions/'+id,{method:'PATCH',json:{enabled:0}});assert.equal((await f.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'})).status,400);
 await f.ok('/api/admin/subscriptions/'+id,{method:'DELETE'});assert.ok(f.mod(m.id));assert.equal(f.mod(m.id).source_managed,1);assert.equal(f.mod(m.id).manual_override,1);
});
test('conditional 304 works only with a local file; missing local bytes trigger full recovery',async t=>{
 const f=await app(t),body=code(),seen=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{seen.push(opts.headers||{});return opts.headers?.['If-None-Match']?new Response(null,{status:304,headers:{etag:'"v1"'}}):new Response(body,{headers:{etag:'"v1"'}});});
 const r=await f.add('https://source.example/a.js'),id=r.subscription.id,m=r.added[0];
 await f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});
 const next=await f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});assert.equal(next.summary.unchanged,1);assert.equal(seen.at(-1)['If-None-Match'],'"v1"');
 f.files.delete(f.mod(m.id).file_key||'file:'+m.id);await f.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});assert.ok(!seen.at(-1)['If-None-Match']);assert.equal(await (await f.call('/api/modules/'+m.id+'.js')).text(),body);
});
test('editing source preserves local module id, requires revision/identity confirmation and validates kind',async t=>{
 const f=await app(t);let body=code('original');t.mock.method(globalThis,'fetch',async()=>new Response(body));
 const r=await f.add('https://source.example/old.js'),m=r.added[0],s=(await f.ok('/api/admin/subscriptions'))[0];body=code('different','New title','2');
 const url='https://source.example/new.js',p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}}),change={url,title:'My source',revision:s.revision,preview_id:p.preview_id};
 assert.equal((await f.call('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:change})).status,409);
 await f.ok('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:{...change,confirm_identity:true}});assert.equal((await f.call('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:change})).status,409);
 await f.ok('/api/admin/subscriptions/'+s.id+'/sync',{method:'POST'});assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);assert.equal(f.mod(m.id).source_url,url);assert.equal(f.mod(m.id).title,'New title');assert.equal((await f.ok('/api/admin/subscriptions'))[0].title,'My source');
});
test('single and collection sources with equal URLs share one module; cancelling one preserves the other',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async url=>new Response(String(url).includes('list')?JSON.stringify({title:'List',widgets:[{id:'remote',url:'https://source.example/a.js',title:'A'}]}):code()));
 const r=await f.add('https://source.example/a.js'),s=await f.add('https://source.example/list.rex');
 for(let i=0;i<2;i++)await f.ok('/api/admin/subscriptions/'+s.subscription.id+'/sync',{method:'POST'});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM subscription_items WHERE module_id=?').get(r.added[0].id).n,2);
 await f.ok('/api/admin/subscriptions/'+r.subscription.id,{method:'DELETE'});assert.ok((await f.ok('/api/admin/subscriptions/'+s.subscription.id+'/sync',{method:'POST'})).done===false);
});
test('legacy source migration is explicit, bounded, repeatable and keeps manual modules paused',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));const r=await f.add('https://source.example/old.js'),id=r.added[0].id;
 f.sql.exec('DELETE FROM subscription_items;DELETE FROM subscription_sources;UPDATE modules SET source_managed=0,manual_override=1');
 const p=await f.ok('/api/admin/subscriptions/legacy');assert.equal(p.rows[0].enabled,false);
 await f.ok('/api/admin/subscriptions/legacy',{method:'POST',json:{rows:p.rows}});assert.equal(f.mod(id).source_managed,1);assert.equal(f.mod(id).manual_override,1);assert.equal((await f.ok('/api/admin/subscriptions'))[0].enabled,0);assert.equal((await f.ok('/api/admin/subscriptions/legacy')).rows.length,0);
});
test('format 7 roundtrip includes current/historical aliases, source types and locks; conflicts fail before publication',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));const r=await f.add('https://source.example/a.js'),m=r.added[0];await f.share(m.id,'Old.js');await f.share(m.id,'LX-music.js');
 const s=(await f.ok('/api/admin/subscriptions'))[0];await f.ok('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:{title:'Pinned',revision:s.revision}});
 const saved=await f.ok('/api/admin/backup');assert.equal(saved.format,7);assert.equal(saved.meta.shareAliases.length,2);const dest=await app(t);await restore(dest,saved);
 assert.equal((await dest.ok('/api/admin/subscriptions'))[0].kind,'module');assert.equal((await dest.ok('/api/admin/subscriptions'))[0].title_locked,1);
 assert.equal(await (await dest.call('/api/modules/Old.js',{auth:false})).text(),code());assert.equal(await (await dest.call('/api/modules/LX-music.js',{auth:false})).text(),code());
 const broken=structuredClone(saved);broken.meta.shareAliases[0].module_id='different';await assert.rejects(()=>restore(dest,broken),/引用缺失|冲突/);
});

test('concurrent alias claims have one owner; failed publication is atomic and can be retried',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));const a=(await f.add('https://source.example/a.js')).added[0],b=(await f.add('https://source.example/b.js',{allow_duplicate:true})).added[0];
 const pa=await f.ok('/api/admin/modules/'+a.id+'/share/preview',{method:'POST',json:{alias:'Shared.js'}}),pb=await f.ok('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:'Shared.js'}});
 const results=await Promise.all([a,b].map((m,i)=>f.call('/api/admin/modules/'+m.id+'/share',{method:'PUT',json:{alias:'Shared.js',revision:[pa,pb][i].revision}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const p=await f.ok('/api/admin/modules/'+a.id+'/share/preview',{method:'POST',json:{alias:'Retry.js'}});f.fail();assert.equal((await f.call('/api/admin/modules/'+a.id+'/share',{method:'PUT',json:{alias:p.alias,revision:p.revision}})).status,409);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM module_share_aliases WHERE alias='Retry.js'").get().n,0);await f.ok('/api/admin/modules/'+a.id+'/share',{method:'PUT',json:{alias:p.alias,revision:p.revision}});
});
test('source update DB failure preserves prior file pointer and retry succeeds; valid response filename is previewed',async t=>{
 const f=await app(t);let content=enc('original');t.mock.method(globalThis,'fetch',async()=>new Response(content,{headers:{'content-disposition':"inline; filename*=UTF-8''Music.js"}}));
 const p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/raw'}});assert.equal(p.filename,'Music.js');
 const r=await f.add(p.url,{preview_id:p.preview_id}),m=r.added[0],old=f.mod(m.id);assert.equal(m.filename,'Music.js');content=enc('updated');
 const batch=f.env.DB.batch.bind(f.env.DB);let failed=false;f.env.DB.batch=async statements=>{if(!failed&&statements.some(s=>s.query.includes('UPDATE modules SET title='))){failed=true;throw Error('Injected publish failure');}return batch(statements);};
 assert.equal((await f.call('/api/admin/subscriptions/'+r.subscription.id+'/sync',{method:'POST'})).status,400);assert.equal(f.mod(m.id).file_key,old.file_key);assert.deepEqual(Buffer.from(await (await f.call('/api/modules/'+m.id+'.js')).arrayBuffer()),enc('original'));await f.ok('/api/admin/subscriptions/'+r.subscription.id+'/sync',{method:'POST'});assert.notEqual(f.mod(m.id).content_hash,old.content_hash);
});

test('expired, changed-URL and reset-generation previews cannot publish modules or sources',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const url='https://source.example/a.js';
 const expired=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}});
 f.sql.prepare('UPDATE source_previews SET expires_at=0 WHERE id=?').run(expired.preview_id);
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url,preview_id:expired.preview_id}})).status,400);
 const changed=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url}});
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url:'https://source.example/b.js',preview_id:changed.preview_id}})).status,400);
 await f.ok('/api/admin/reset',{method:'POST'});
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url,preview_id:changed.preview_id}})).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM subscription_sources').get().n,0);
});

test('restore invalidates pending previews; format 6 is still readable and bad hashes roll back bytes and aliases',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const r=await f.add('https://source.example/a.js'),id=r.added[0].id;await f.share(id,'Stable.js');
 const pending=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/b.js'}});
 const saved=await f.ok('/api/admin/backup'),broken=structuredClone(saved);
 broken.files[id].content=Buffer.from(code('other')).toString('base64');
 assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:broken})).status,400);
 assert.equal(await (await f.call('/api/modules/Stable.js')).text(),code());
 const legacy=structuredClone(saved);legacy.format=6;delete legacy.meta.shareAliases;
 await restore(f,legacy);
 assert.equal((await f.call('/api/admin/modules/import',{method:'POST',json:{url:pending.url,preview_id:pending.preview_id}})).status,400);
 assert.equal(await (await f.call('/api/modules/Stable.js')).text(),code());
});

test('clear tombstones aliases; orphan tombstones round-trip without reviving deleted names',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const a=(await f.add('https://source.example/a.js')).added[0];await f.share(a.id,'Permanent.js');
 const before=await f.ok('/api/admin/backup');
 await f.ok('/api/admin/reset',{method:'POST'});
 const empty=await f.ok('/api/admin/backup');assert.equal(empty.meta.shareAliases[0].tombstoned,1);
 const dest=await app(t);await restore(dest,empty);
 assert.equal((await dest.call('/api/modules/Permanent.js',{auth:false})).status,404);
 const b=(await dest.add('https://source.example/b.js')).added[0];
 const preview=await dest.ok('/api/admin/modules/'+b.id+'/share/preview',{method:'POST',json:{alias:'Permanent.js'}});assert.equal(preview.conflict,true);
 assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:before})).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,0);
});

test('aliases normalize Unicode and case, reject double-encoded paths and remain stable across title/version changes',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const a=(await f.add('https://source.example/a.js')).added[0];await f.share(a.id,'Café 音源.js');
 const path='/api/modules/'+encodeURIComponent('CAFE\u0301 音源.js');assert.equal((await f.call(path,{auth:false})).status,200);
 for(const alias of ['bad%2Fpath.js','bad%252Fpath.js','../module.js','x\\y.js'])assert.equal((await f.call('/api/admin/modules/'+a.id+'/share/preview',{method:'POST',json:{alias}})).status,409);
 await f.ok('/api/admin/modules?id='+a.id,{method:'PATCH',json:{title:'New custom title',note:'Personal'}});
 const m=(await f.ok('/api/admin/modules'))[0];assert.equal(m.share_alias,'Café 音源.js');
 assert.equal((await f.call(path,{auth:false})).status,200);
});

test('source edits reject foreign/stale previews, type changes and active leases without moving module URLs',async t=>{
 const f=await app(t);let body=code();t.mock.method(globalThis,'fetch',async()=>new Response(body));
 const r=await f.add('https://source.example/a.js'),s=(await f.ok('/api/admin/subscriptions'))[0];
 const p=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/b.js'}});
 assert.equal((await f.call('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:{url:'https://source.example/c.js',revision:s.revision,preview_id:p.preview_id}})).status,409);
 body=JSON.stringify({title:'Collection',widgets:[]});
 const c=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/list.rex'}});
 assert.equal((await f.call('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:{url:c.url,revision:s.revision,preview_id:c.preview_id}})).status,409);
 f.sql.prepare('UPDATE subscription_sources SET lease_until=? WHERE id=?').run(Date.now()+60000,s.id);
 assert.equal((await f.call('/api/admin/subscriptions/'+s.id,{method:'PATCH',json:{title:'Busy',revision:s.revision}})).status,409);
 assert.equal(f.mod(r.added[0].id).source_url,s.url);
});

test('legacy registration is bounded and atomic, performs no downloads, preserves manual mode and rejects duplicate/stale rows',async t=>{
 const f=await app(t);let hits=0;t.mock.method(globalThis,'fetch',async()=>{hits++;return new Response(code());});
 const r=await f.add('https://source.example/a.js'),id=r.added[0].id;
 f.sql.exec('DELETE FROM subscription_items;DELETE FROM subscription_sources;UPDATE modules SET source_managed=0,manual_override=1');
 const rows=(await f.ok('/api/admin/subscriptions/legacy')).rows,before=hits;
 assert.equal((await f.call('/api/admin/subscriptions/legacy',{method:'POST',json:{rows:Array(11).fill(rows[0])}})).status,409);
 assert.equal((await f.call('/api/admin/subscriptions/legacy',{method:'POST',json:{rows:[rows[0],rows[0]]}})).status,409);
 f.fail();assert.equal((await f.call('/api/admin/subscriptions/legacy',{method:'POST',json:{rows}})).status,409);
 assert.equal(f.mod(id).source_managed,0);assert.equal((await f.ok('/api/admin/subscriptions')).length,0);
 await f.ok('/api/admin/subscriptions/legacy',{method:'POST',json:{rows}});
 assert.equal(hits,before);assert.equal(f.mod(id).manual_override,1);assert.equal((await f.ok('/api/admin/subscriptions'))[0].enabled,0);
 assert.equal((await f.call('/api/admin/subscriptions/legacy',{method:'POST',json:{rows}})).status,409);
});

test('format 7 restores trusted LAN and compatibility-mode subscriptions without widening the deployment policy',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 for(const [policy,url] of [[createSourcePolicy('http://192.168.1.5:2233'),'http://192.168.1.5:2233/bridge/widget.js'],
   [createSourcePolicy('',{addressCheck:false}),'http://127.0.0.1:2233/widget.js']]){
  const f=await app(t,policy),r=await f.add(url),saved=await f.ok('/api/admin/backup');
  const target=await app(t,policy);await restore(target,saved);
  const s=(await target.ok('/api/admin/subscriptions'))[0];assert.equal(s.url,url);assert.equal(s.kind,'module');
  assert.equal((await target.ok('/api/admin/subscriptions/'+s.id+'/sync',{method:'POST'})).done,true);
  assert.equal(target.mod(r.added[0].id).source_url,url);
  const protectedTarget=await app(t);
  assert.equal((await protectedTarget.call('/api/admin/backup/restore',{method:'POST',json:saved})).status,400);
  assert.equal((await protectedTarget.ok('/api/admin/modules')).length,0);
 }
});

test('previous-version hashes and sizes are verified before format 7 publication; older backups remain readable',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const r=await f.add('https://source.example/a.js'),m=f.mod(r.added[0].id),bytes=enc('previous');
 await f.env.KV.put('upload-backup:fixture',bytes);
 f.sql.prepare('INSERT INTO module_previous_versions VALUES(?,?,?,?,?)').run(m.id,'upload-backup:fixture',JSON.stringify(m),Date.now(),Date.now()+3600000);
 const saved=await f.ok('/api/admin/backup'),previous=saved.meta.previousVersions[0];
 assert.equal(previous.size,bytes.length);assert.equal(previous.hash,createHash('sha256').update(bytes).digest('hex'));
 for(const field of ['content','size']){
  const bad=structuredClone(saved);bad.meta.previousVersions[0][field]=field==='content'?enc('corrupted').toString('base64'):bytes.length+1;
  assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:bad})).status,400);
  assert.deepEqual(Buffer.from(await f.env.KV.get('upload-backup:fixture','arrayBuffer')),bytes);
 }
 const legacy=structuredClone(saved);legacy.format=6;delete legacy.meta.shareAliases;
 delete legacy.meta.previousVersions[0].hash;delete legacy.meta.previousVersions[0].size;
 await restore(await app(t),legacy);
});

test('restoration rejects duplicate subscription identities and invalid single mappings atomically',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 await f.add('https://source.example/a.js');const saved=await f.ok('/api/admin/backup');
 for(const alter of [b=>b.meta.sources.push(b.meta.sources[0]),b=>b.meta.sourceItems.push(b.meta.sourceItems[0]),b=>{b.meta.sourceItems[0].remote_id='not-single';}]){
  const bad=structuredClone(saved);alter(bad);
  assert.equal((await f.call('/api/admin/backup/restore',{method:'POST',json:bad})).status,400);
  assert.equal((await f.ok('/api/admin/subscriptions')).length,1);
  assert.equal((await f.ok('/api/admin/subscriptions'))[0].revision,saved.meta.sources[0].revision);
 }
});

test('creating a new preview prunes expired preview records without removing a live preview',async t=>{
 const f=await app(t);t.mock.method(globalThis,'fetch',async()=>new Response(code()));
 const expired=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/a.js'}});
 f.sql.prepare('UPDATE source_previews SET expires_at=0 WHERE id=?').run(expired.preview_id);
 const live=await f.ok('/api/admin/subscriptions/preview',{method:'POST',json:{url:'https://source.example/b.js'}});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM source_previews').get().n,1);
 assert.equal((await f.add(live.url,{preview_id:live.preview_id})).subscription.kind,'module');
});
