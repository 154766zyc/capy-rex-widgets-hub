import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { uploadSchema } from './uploads.js';
import {parseModuleMeta} from './metadata.js';
import {getHTML} from './worker.js';
import { addSubscription, parseManifest, syncSubscription, subscriptionSchema, listSubscriptions,
  subscriptionTick, subscriptionItems } from './subscriptions.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE modules (id TEXT PRIMARY KEY,filename TEXT,widget_id TEXT,title TEXT,
    version TEXT,author TEXT,file_size INTEGER,is_encrypted INTEGER,source_url TEXT,note TEXT,
    group_id TEXT,sort_order INTEGER,created_at INTEGER,updated_at INTEGER,content_hash TEXT DEFAULT '',
    required_version TEXT DEFAULT '0.0.1',source_managed INTEGER DEFAULT 0,
    manual_override INTEGER DEFAULT 0,file_key TEXT DEFAULT '',metadata_id TEXT DEFAULT '',
    code_title TEXT DEFAULT '',manifest_title TEXT DEFAULT '',title_locked INTEGER DEFAULT 0,
    generated_filename INTEGER DEFAULT 0,title_scan_v1 INTEGER DEFAULT 0);
    CREATE TABLE collection_modules (collection_id TEXT,module_id TEXT,position INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT);`);
  for(const sql of subscriptionSchema) sqlite.exec(sql);
  for(const sql of uploadSchema) sqlite.exec(sql);
  const DB = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let args = [];
      return { bind(...values){args=values;return this;},
        async first(){ return stmt.get(...args) || null; },
        async all(){ return { results:stmt.all(...args) }; },
        async run(){ const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result=[]; for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result; }
      catch(e){sqlite.exec('ROLLBACK');throw e;}
    }
  };
  const files = new Map(), resources=new Map(), writes=[];
  const encode=s=>new TextEncoder().encode(s).buffer;
  const manifest={title:'Test source',widgets:[
    {id:'remote-a',title:'A',version:'1',url:'https://modules.example/a.js',requiredVersion:'0.0.7'},
    {id:'remote-b',title:'B',version:'1',url:'https://modules.example/b.js'}
  ]};
  const sourceUrl='https://collections.example/list.rex';
  resources.set(sourceUrl,()=>encode(JSON.stringify(manifest)));
  resources.set('https://modules.example/a.js',()=>encode('REXENC\nfirst encrypted bytes'));
  resources.set('https://modules.example/b.js',()=>encode('var WidgetMetadata = { id:"b" }; function play() {}'));
  const helpers={
    assertFetchableUrl(raw){const u=new URL(raw); if(!['https:','http:'].includes(u.protocol)||u.hostname==='localhost')throw Error('不允许的地址');return u;},
    async fetchCapped(url,max){const f=resources.get(url);if(!f)throw Error('Failed to fetch: 404'); const b=f();if(b.byteLength>max)throw Error('too big');return b;},
    async nextSortOrder(){return (sqlite.prepare('SELECT MAX(sort_order) n FROM modules').get().n||0)+1;},
    parseMeta:parseModuleMeta,
    isEncrypted(buf){return new TextDecoder().decode(buf).startsWith('REXENC')?1:0;},
    toHex(buf){return Buffer.from(buf).toString('hex');},
    async putFile(env,id,buf){files.set(id,Buffer.from(buf));writes.push(id);}
  };
  return {env:{DB},sqlite,manifest,resources,files,writes,helpers,sourceUrl,encode};
}

async function complete(f,id){
  let result;
  for(let i=0;i<20;i++){result=await syncSubscription(f.env,id,'continue',f.helpers);if(result.done)return result;}
  throw Error('sync did not finish');
}

test('import, deduplicate and preserve identities, notes, ordering and personal collections',async()=>{
  const f=fixture();
  const source=await addSubscription(f.env,f.sourceUrl,'initial-group',f.helpers);
  let r=await complete(f,source.id);
  assert.equal(r.summary.added,2);
  const original=f.sqlite.prepare('SELECT * FROM modules WHERE title=?').get('A');
  assert.equal(original.required_version,'0.0.7');
  f.sqlite.prepare('UPDATE modules SET note=?,group_id=?,sort_order=? WHERE id=?').run('my note','my group',77,original.id);
  f.sqlite.prepare('INSERT INTO collection_modules VALUES (?,?,?)').run('mine',original.id,3);
  assert.equal((await addSubscription(f.env,f.sourceUrl,'other',f.helpers)).id,source.id);
  const before=f.writes.length;
  r=await complete(f,source.id);
  assert.equal(r.summary.unchanged,2);
  assert.equal(f.writes.length,before);
  f.manifest.widgets[0].version='2';
  f.resources.set('https://modules.example/a.js',()=>f.encode('REXENC\nupdated encrypted bytes'));
  r=await complete(f,source.id);
  assert.equal(r.summary.updated,1);
  const after=f.sqlite.prepare('SELECT * FROM modules WHERE id=?').get(original.id);
  assert.equal(after.version,'2');assert.equal(after.note,'my note');assert.equal(after.group_id,'my group');
  assert.equal(after.sort_order,77);assert.equal(after.widget_id,original.widget_id);
  assert.equal(f.sqlite.prepare('SELECT module_id,position FROM collection_modules').get().module_id,original.id);
  assert.equal(f.sqlite.prepare('SELECT position FROM collection_modules').get().position,3);
});

test('removed upstream modules stay local and failed downloads retain old content and metadata',async()=>{
  const f=fixture();const s=await addSubscription(f.env,f.sourceUrl,'',f.helpers);await complete(f,s.id);
  const original=f.sqlite.prepare('SELECT * FROM modules WHERE title=?').get('A'), bytes=f.files.get(original.id);
  f.manifest.widgets.pop();
  f.resources.set('https://modules.example/a.js',()=>f.encode('<!DOCTYPE html><html>upstream error</html>'));
  const r=await complete(f,s.id);assert.equal(r.summary.failed,1);assert.equal(r.summary.removed,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM modules').get().n,2);
  assert.deepEqual(f.files.get(original.id),bytes);
  assert.equal(f.sqlite.prepare('SELECT version FROM modules WHERE id=?').get(original.id).version,'1');
  const items=await subscriptionItems(f.env,s.id);assert.equal(items.filter(i=>!i.active).length,1);
  assert.match(items.find(i=>i.active).last_error,/保留旧版本/);
  const list=await listSubscriptions(f.env);assert.equal(list[0].status,'partial');assert.equal(list[0].removed,1);
});

test('subscription title uses literal code first, manifest for encryption, and respects title lock only',async()=>{
  const f=fixture();f.resources.set('https://modules.example/b.js',()=>f.encode('var WidgetMetadata={id:"b",title:"代码 (4K) [完整]"};'));
  const s=await addSubscription(f.env,f.sourceUrl,'',f.helpers);await complete(f,s.id);
  let b=f.sqlite.prepare('SELECT * FROM modules WHERE metadata_id=?').get('b');
  assert.equal(b.title,'代码 (4K) [完整]');assert.equal(b.manifest_title,'B');assert.equal(b.generated_filename,1);
  f.sqlite.prepare('UPDATE modules SET title=?,title_locked=1 WHERE id=?').run('自定义',b.id);
  f.resources.set('https://modules.example/b.js',()=>f.encode('var WidgetMetadata={id:"b",title:"更新代码"};'));
  f.manifest.widgets[1].title='更新清单';
  await complete(f,s.id);b=f.sqlite.prepare('SELECT * FROM modules WHERE id=?').get(b.id);
  assert.equal(b.title,'自定义');assert.equal(b.code_title,'更新代码');assert.equal(b.manifest_title,'更新清单');
  f.sqlite.prepare('UPDATE modules SET title_locked=0 WHERE id=?').run(b.id);
  await complete(f,s.id);assert.equal(f.sqlite.prepare('SELECT title FROM modules WHERE id=?').get(b.id).title,'更新代码');
  const a=f.sqlite.prepare('SELECT * FROM modules WHERE is_encrypted=1').get();
  assert.equal(a.title,'A');assert.equal(a.code_title,'');assert.equal(a.manifest_title,'A');
});

test('new remote URLs for stable IDs retain local identity, and shared URLs reuse existing modules',async()=>{
  const f=fixture();const s=await addSubscription(f.env,f.sourceUrl,'',f.helpers);await complete(f,s.id);
  const id=f.sqlite.prepare('SELECT id FROM modules WHERE title=?').get('A').id;
  f.manifest.widgets[0].url='https://modules.example/new-a.js';
  f.resources.set('https://modules.example/new-a.js',()=>f.encode('REXENC\nsecond'));
  await complete(f,s.id);
  assert.equal(f.sqlite.prepare('SELECT id FROM modules WHERE title=?').get('A').id,id);
  const secondUrl='https://collections.example/second.rex';
  f.resources.set(secondUrl,()=>f.encode(JSON.stringify(f.manifest)));
  const s2=await addSubscription(f.env,secondUrl,'',f.helpers);await complete(f,s2.id);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM modules').get().n,2);
  assert.equal(f.sqlite.prepare('SELECT module_id FROM subscription_items WHERE source_id=? AND remote_id=?').get(s2.id,'remote-a').module_id,id);
});

test('validate complete index before marking removed; reject unsafe addresses and duplicate ids',async()=>{
  const f=fixture();const s=await addSubscription(f.env,f.sourceUrl,'',f.helpers);await complete(f,s.id);
  f.manifest.widgets.push({id:'bad',url:'http://localhost/internal'});
  await assert.rejects(()=>syncSubscription(f.env,s.id,'continue',f.helpers),/不允许/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM subscription_items WHERE active=1').get().n,2);
  assert.throws(()=>parseManifest(f.encode(JSON.stringify({widgets:[{id:'same',url:'https://x/a'},{id:'same',url:'https://x/b'}]})),f.sourceUrl,f.helpers.assertFetchableUrl),/重复/);
});

test('durable batches resume, six-hour timer does not refresh early, pause and leases prevent writes',async()=>{
  const f=fixture();
  for(let i=0;i<7;i++) { const url='https://modules.example/'+i+'.js';f.manifest.widgets.push({id:'x'+i,url});f.resources.set(url,()=>f.encode('REXENC\ncontent-'+i)); }
  const s=await addSubscription(f.env,f.sourceUrl,'',f.helpers);
  let r=await syncSubscription(f.env,s.id,'continue',f.helpers);assert.equal(r.processed,0);assert.equal(r.done,false);
  r=await syncSubscription(f.env,s.id,'continue',f.helpers);assert.equal(r.processed,2);assert.equal(r.done,false);
  await subscriptionTick(f.env,f.helpers);assert.equal(f.sqlite.prepare('SELECT cursor FROM subscription_sources').get().cursor,4);
  await subscriptionTick(f.env,f.helpers);assert.equal(f.sqlite.prepare('SELECT cursor FROM subscription_sources').get().cursor,6);
  await subscriptionTick(f.env,f.helpers);assert.equal(f.sqlite.prepare('SELECT cursor FROM subscription_sources').get().cursor,8);
  await subscriptionTick(f.env,f.helpers);assert.equal(f.sqlite.prepare('SELECT status FROM subscription_sources').get().status,'ok');
  assert.equal(await subscriptionTick(f.env,f.helpers),false);
  f.sqlite.prepare('UPDATE subscription_sources SET enabled=0,next_sync_at=0').run();
  assert.equal(await subscriptionTick(f.env,f.helpers),false);
  await assert.rejects(()=>syncSubscription(f.env,s.id,'continue',f.helpers),/暂停/);
  f.sqlite.prepare('UPDATE subscription_sources SET enabled=1,lease_until=?').run(Date.now()+200000);
  await assert.rejects(()=>syncSubscription(f.env,s.id,'continue',f.helpers),/正在同步/);
});

test('embedded browser scripts are syntactically valid',async()=>{
  for(const match of getHTML().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});

test('500-item manifest stages with bounded database batches instead of hundreds of queries',async()=>{
  const f=fixture();
  f.manifest.widgets=Array.from({length:500},(_,i)=>({id:'large'+i,url:'https://modules.example/large'+i+'.js'}));
  for(const item of f.manifest.widgets)f.resources.set(item.url,()=>f.encode('REXENC\ncontent'));
  const source=await addSubscription(f.env,f.sourceUrl,'',f.helpers);
  const batchSizes=[],original=f.env.DB.batch;
  f.env.DB.batch=async statements=>{batchSizes.push(statements.length);return original(statements);};
  const first=await syncSubscription(f.env,source.id,'continue',f.helpers);
  assert.equal(first.total,500);assert.equal(first.processed,0);
  assert.equal((await listSubscriptions(f.env))[0].total,500);
  const second=await syncSubscription(f.env,source.id,'continue',f.helpers);
  assert.equal(second.processed,2);
  assert.ok(Math.max(...batchSizes)<=4);
});
