// Upgrade a synthetic DB using the real previous release, never a production volume.
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createHubServer} from '../server.js';
if(!process.argv[2])throw Error('Usage: node tools/verify-v321-upgrade.mjs /absolute/path/to/3.2.1');
const old=await import(pathToFileURL(join(resolve(process.argv[2]),'server.js')));
const directory=mkdtempSync(join(tmpdir(),'rex-v321-upgrade-'));
const config={DATA_DIR:directory,ADMIN_SECRET:'synthetic-test-password',DISABLE_SCHEDULER:'true',PUBLIC_URL:'http://hub.example'};
const transport=async url=>new Response(String(url).endsWith('.rex')?JSON.stringify({title:'Old collection source',widgets:[{id:'third',url:'https://source.example/third.js',title:'Third'}]}):'REXENC\nexact original bytes for '+url);
let server,base,cookie;
async function start(factory){server=await factory(config,{remoteFetch:transport});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/admin/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:config.ADMIN_SECRET})});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];}
async function stop(){const current=server;server=null;const done=once(current,'close');current.close();await done;await current.hubClosed;}
async function ok(path,method='GET',json){const r=await fetch(base+path,{method,headers:{Cookie:cookie,'content-type':'application/json'},...(json===undefined?{}:{body:JSON.stringify(json)})});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 await start(old.createHubServer);
 const ids=[];
 for(const name of ['first','second'])ids.push((await ok('/api/admin/modules/import','POST',{url:'https://source.example/'+name+'.js'})).added[0].id);
 await ok('/api/admin/modules/'+ids[1]+'/maintenance','PATCH',{manual:true});
 await ok('/api/admin/modules?id='+ids[0],'PATCH',{title:'Custom title',note:'Keep note'});
 const source=(await ok('/api/admin/modules/import','POST',{url:'https://source.example/list.rex'})).subscription.id;
 for(let n=0;n<5;n++)if((await ok('/api/admin/subscriptions/'+source+'/sync','POST')).done)break;
 const col=(await ok('/api/admin/collections','POST',{slug:'original',title:'My collection',moduleIds:ids}));
 await ok('/api/admin/collections','PATCH',{id:col.id,slug:'current'});
 const before=await ok('/api/admin/backup'),paths=ids.flatMap(id=>['/api/modules/'+id,'/api/modules/'+id+'.js','/api/modules/'+id+'/raw','/api/modules/'+id+'/file/legacy-name.js','/'+id+'.js']);
 paths.push('/api/collections/original.rex','/api/collections/current.rex');
 const responses=new Map();for(const path of paths){const r=await fetch(base+path);assert.equal(r.status,200);responses.set(path,digest(Buffer.from(await r.arrayBuffer())));}
 await stop();
 const beforeSQL=new DatabaseSync(join(directory,'rex.sqlite'),{readOnly:true}),originalRows=beforeSQL.prepare('SELECT * FROM modules ORDER BY id').all();beforeSQL.close();
 await start(createHubServer);
 const after=await ok('/api/admin/backup');assert.equal(after.format,7);assert.equal(after.meta.shareAliases.length,0);
 const withoutHash=rows=>rows.map(({content_hash,...m})=>m);
 assert.deepEqual(withoutHash(after.meta.modules),withoutHash(before.meta.modules));assert.deepEqual(after.meta.collections,before.meta.collections);assert.deepEqual(after.meta.names,before.meta.names);
 const sources=await ok('/api/admin/subscriptions');assert.equal(sources.length,1);assert.equal(sources[0].id,source);assert.equal(sources[0].kind,'collection');assert.ok(sources[0].revision);
 const legacy=(await ok('/api/admin/subscriptions/legacy')).rows;assert.equal(legacy.length,2);assert.equal(legacy.find(m=>m.id===ids[0]).enabled,true);assert.equal(legacy.find(m=>m.id===ids[1]).enabled,false);
 for(const path of paths){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(digest(Buffer.from(await r.arrayBuffer())),responses.get(path),path);}
 await stop();
 const afterSQL=new DatabaseSync(join(directory,'rex.sqlite'),{readOnly:true});assert.deepEqual(afterSQL.prepare('SELECT * FROM modules ORDER BY id').all(),originalRows);afterSQL.close();
 const snapshots=readdirSync(join(directory,'backups')).filter(n=>n.startsWith('pre-v33-'));assert.equal(snapshots.length,1);
 const snapshot=new DatabaseSync(join(directory,'backups',snapshots[0]),{readOnly:true});assert.equal(snapshot.prepare("SELECT value FROM settings WHERE key='docker_v33'").get(),undefined);assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM modules').get().n,3);snapshot.close();
 await start(createHubServer);await stop();assert.equal(readdirSync(join(directory,'backups')).filter(n=>n.startsWith('pre-v33-')).length,1);
 console.log('PASS: real 3.2.1 → 3.3 in-place SQLite migration; unchanged module rows/bytes, collections, old routes, filenames and manual modes; no automatic adoption; verified pre-v33 snapshot and idempotent restart.');
}finally{if(server)await stop();rmSync(directory,{recursive:true,force:true});}
