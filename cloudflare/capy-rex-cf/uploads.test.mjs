import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseMeta,isEncrypted} from './worker.js';
import {uploadSchema,planUploads,previewUploads,commitUpload,previousVersion,restorePrevious,getFileKey} from './uploads.js';
import {subscriptionSchema,syncSubscription} from './subscriptions.js';
import {backfillTitles} from './title-maintenance.js';
import {sharingSchema} from './sharing.js';

function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE modules (id TEXT PRIMARY KEY,filename TEXT,widget_id TEXT,metadata_id TEXT DEFAULT '',
    title TEXT,version TEXT,author TEXT,file_size INTEGER,is_encrypted INTEGER,source_url TEXT,note TEXT,
    group_id TEXT,sort_order INTEGER,created_at INTEGER,updated_at INTEGER,content_hash TEXT DEFAULT '',
    required_version TEXT DEFAULT '0.0.1',source_managed INTEGER DEFAULT 0,manual_override INTEGER DEFAULT 0,
    file_key TEXT DEFAULT '',code_title TEXT DEFAULT '',manifest_title TEXT DEFAULT '',
    title_locked INTEGER DEFAULT 0,generated_filename INTEGER DEFAULT 0,title_scan_v1 INTEGER DEFAULT 0);
    CREATE TABLE collection_modules (collection_id TEXT,module_id TEXT,position INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT);`);
  for(const statement of [...uploadSchema,...subscriptionSchema,...sharingSchema])sql.exec(statement);
  let fail=false;
  const DB={prepare(query){const statement=sql.prepare(query);let args=[];return {
    bind(...a){args=a;return this;},async first(){return statement.get(...args)||null;},
    async all(){return {results:statement.all(...args)};},async run(){const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};}
  };},async batch(statements){if(fail){fail=false;throw Error('simulated transaction failure');}sql.exec('BEGIN');try{
    const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;
  }catch(e){sql.exec('ROLLBACK');throw e;}}};
  const bytes=new Map(),writes=[],deleted=[];
  const KV={async get(key,type){const value=bytes.get(key);if(!value)return null;return type==='arrayBuffer'?new Uint8Array(value.bytes).buffer:null;},
    async put(key,buffer,options){bytes.set(key,{bytes:Buffer.from(buffer),options});writes.push(key);},
    async delete(key){bytes.delete(key);deleted.push(key);}};
  const helpers={parseMeta,isEncrypted,toHex:b=>Buffer.from(b).toString('hex'),
    async nextSortOrder(){return (sql.prepare('SELECT MIN(sort_order) n FROM modules').get().n||0)-1;}};
  return {env:{DB,KV},sql,bytes,writes,deleted,helpers,failNextTransaction(){fail=true;}};
}
const source=(id,version='1',extra='')=>`var WidgetMetadata = { id: '${id}', title: 'Title', version: '${version}', author: 'Author' };\nfunction run(){return '${extra}';}`;
const file=(name,body)=>new File([body],name,{type:'application/javascript'});
async function preview(f,files,target=''){return previewUploads(f.env,files,'new-group',f.helpers,target);}
async function commit(f,p,upload,index=0,mode,action,target){const row=p.rows[index];return commitUpload(f.env,
  {job_id:p.job_id,index,file:upload,mode,action:action||(row.target?'replace':'new'),target_id:target||row.target?.id},f.helpers);}
async function add(f,upload){const p=await preview(f,[upload]);return commit(f,p,upload);}
const moduleRow=(f,id)=>f.sql.prepare('SELECT * FROM modules WHERE id=?').get(id);
const content=async(f,id)=>(await f.env.KV.get(await getFileKey(f.env,id),'arrayBuffer'));

test('static metadata accepts single/double quoted fields, and encrypted files never expose an inferred id',async()=>{
  const f=fixture(),plain=file('first.js',source('real-id'));
  const p=await preview(f,[plain]);assert.equal(p.rows[0].metadata_id,'real-id');
  const encrypted=file('enc.js','REXENC\nvar WidgetMetadata={id:"fake-inside-ciphertext"};');
  const e=await preview(f,[encrypted]);assert.equal(e.rows[0].metadata_id,'');assert.equal(e.rows[0].is_encrypted,1);
});

test('upload, replacement and restore honor a locked title, then unlocked updates use the code title',async()=>{
  const f=fixture(),a=await add(f,file('one.js',source('a'))),id=a.module_id;
  f.sql.prepare('UPDATE modules SET title=?,title_locked=1,manifest_title=? WHERE id=?').run('我的标题','清单标题',id);
  const next=file('one.js',source('a','2').replace("title: 'Title'","title: '新代码 (4K) [原画]'"));
  await commit(f,await preview(f,[next]),next);
  assert.equal(moduleRow(f,id).title,'我的标题');assert.equal(moduleRow(f,id).code_title,'新代码 (4K) [原画]');
  await restorePrevious(f.env,id,(await previousVersion(f.env,id)).created_at);
  assert.equal(moduleRow(f,id).title,'我的标题');assert.equal(moduleRow(f,id).code_title,'Title');
  f.sql.prepare('UPDATE modules SET title_locked=0 WHERE id=?').run(id);
  await commit(f,await preview(f,[next]),next);
  assert.equal(moduleRow(f,id).title,'新代码 (4K) [原画]');
  const encrypted=file('one.js','REXENC\nnew ciphertext');
  await commit(f,await preview(f,[encrypted]),encrypted);
  assert.equal(moduleRow(f,id).title,'清单标题');assert.equal(moduleRow(f,id).code_title,'');
});

test('legacy backfill preserves identity, content and relationships, and infers only distinct manual titles',async()=>{
  const f=fixture(),a=await add(f,file('first.js',source('a'))),b=await add(f,file('second.js',source('b'))),
    enc=await add(f,file('encrypted.js','REXENC\nWidgetMetadata={title:"not real"};'));
  f.sql.prepare('UPDATE modules SET title=?,title_scan_v1=0,code_title=?,note=?,sort_order=44 WHERE id=?')
    .run('first','','my note',a.module_id);
  f.sql.prepare('UPDATE modules SET title=?,title_scan_v1=0,code_title=? WHERE id=?').run('手动旧标题','',b.module_id);
  f.sql.prepare('UPDATE modules SET title=?,title_scan_v1=0 WHERE id=?').run('订阅原标题',enc.module_id);
  f.sql.prepare('INSERT INTO collection_modules VALUES (?,?,?)').run('mine',a.module_id,4);
  f.sql.prepare('INSERT INTO subscription_sources (id,url,title,created_at) VALUES (?,?,?,?)').run('src','https://example.com/list','src',1);
  f.sql.prepare('INSERT INTO subscription_items (source_id,remote_id,module_id,title,url,active) VALUES (?,?,?,?,?,1)')
    .run('src','encrypted',enc.module_id,'订阅原标题','https://example.com/encrypted.js');
  const before=moduleRow(f,a.module_id),bytes=Buffer.from(await content(f,a.module_id));
  assert.equal((await backfillTitles(f.env,10)).done,true);
  const after=moduleRow(f,a.module_id);
  for(const key of ['id','widget_id','filename','file_key','note','sort_order','created_at','updated_at'])assert.equal(after[key],before[key]);
  assert.equal(after.title,'Title');assert.equal(after.title_locked,0);
  assert.equal(moduleRow(f,b.module_id).title,'手动旧标题');assert.equal(moduleRow(f,b.module_id).title_locked,1);
  assert.equal(moduleRow(f,enc.module_id).title,'订阅原标题');assert.equal(moduleRow(f,enc.module_id).code_title,'');
  assert.equal(moduleRow(f,enc.module_id).manifest_title,'订阅原标题');assert.equal(moduleRow(f,enc.module_id).title_locked,0);
  assert.deepEqual(Buffer.from(await content(f,a.module_id)),bytes);
  assert.equal(f.sql.prepare('SELECT module_id FROM collection_modules').get().module_id,a.module_id);
  assert.equal((await backfillTitles(f.env)).scanned,0);
});

test('matching priority, id/name disagreement, known-id mismatch and ambiguity',()=>{
  const modules=[{id:'a',filename:'one.js',widget_id:'wid-a',is_encrypted:0},{id:'b',filename:'two.js',widget_id:'wid-b',is_encrypted:0}];
  assert.equal(planUploads([{filename:'renamed.js',metadata_id:'wid-a'}],modules)[0].target.id,'a');
  assert.equal(planUploads([{filename:'one.js',metadata_id:''}],modules)[0].target.id,'a');
  assert.equal(planUploads([{filename:'two.js',metadata_id:'wid-a'}],modules)[0].kind,'conflict');
  assert.equal(planUploads([{filename:'one.js',metadata_id:'different'}],modules)[0].kind,'conflict');
  assert.equal(planUploads([{filename:'one.js'}],[...modules,{...modules[0],id:'c'}])[0].kind,'conflict');
  assert.ok(planUploads([{filename:'new.js'},{filename:'new.js'}],[]).every(r=>r.kind==='conflict'));
  assert.ok(planUploads([{filename:'x.js',metadata_id:'wid-a'},{filename:'y.js',metadata_id:'wid-a'}],modules).every(r=>r.kind==='conflict'));
});

test('replace renamed module by id, preserve stable public identity, collections, notes, group and order',async()=>{
  const f=fixture(),initial=file('one.js',source('same','1'));
  const added=await add(f,initial),id=added.module_id;
  f.sql.prepare('UPDATE modules SET note=?,group_id=?,sort_order=? WHERE id=?').run('my note','my group',42,id);
  f.sql.prepare('INSERT INTO collection_modules VALUES (?,?,?)').run('mine',id,7);
  const original=moduleRow(f,id),next=file('renamed.js',source('same','2'));
  const p=await preview(f,[next]);assert.equal(p.rows[0].matched_by,'模块 ID');
  const result=await commit(f,p,next);assert.equal(result.status,'replaced');
  const current=moduleRow(f,id);
  for(const key of ['widget_id','note','group_id','sort_order','created_at'])assert.equal(current[key],original[key]);
  assert.equal(current.filename,'renamed.js');assert.equal(current.version,'2');
  assert.equal(f.sql.prepare('SELECT module_id FROM collection_modules').get().module_id,id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);
  assert.equal(new TextDecoder().decode(await content(f,id)),await next.text());
});

test('encrypted filename fallback, idempotent retries and identical content never delete active immutable file',async()=>{
  const f=fixture(),original=file('enc.js','REXENC\nfirst payload'),added=await add(f,original),id=added.module_id;
  const p=await preview(f,[original]),key=moduleRow(f,id).file_key,writes=f.writes.length;
  assert.equal((await commit(f,p,original)).status,'unchanged');assert.equal(f.writes.length,writes);
  assert.ok(f.bytes.has(key));assert.equal(moduleRow(f,id).file_key,key);
  const update=file('enc.js','REXENC\nsecond payload'),p2=await preview(f,[update]);
  assert.equal(p2.rows[0].matched_by,'完整文件名');
  const result=await commit(f,p2,update),after=f.writes.length;
  assert.deepEqual(await commit(f,p2,update),result);assert.equal(f.writes.length,after);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);
});

test('conflicts default to no write, but explicit preview candidate can be selected',async()=>{
  const f=fixture();const a=await add(f,file('one.js',source('a')));await add(f,file('two.js',source('b')));
  const upload=file('two.js',source('a','2')),p=await preview(f,[upload]);
  assert.equal(p.rows[0].kind,'conflict');
  await assert.rejects(()=>commit(f,p,upload,0,undefined,'replace','not-a-candidate'),/请选择/);
  assert.equal((await commit(f,p,upload,0,undefined,'replace',a.module_id)).status,'replaced');
  assert.equal(moduleRow(f,a.module_id).widget_id,'a');
});

test('stale previews, altered files and batch duplicates are rejected without touching active file',async()=>{
  const f=fixture();const a=await add(f,file('one.js',source('a'))),id=a.module_id;
  const next=file('one.js',source('a','2')),p=await preview(f,[next]),key=moduleRow(f,id).file_key;
  await assert.rejects(()=>commit(f,p,file('one.js',source('a','3'))),/文件已变更/);
  f.sql.prepare('UPDATE modules SET version=? WHERE id=?').run('external update',id);
  await assert.rejects(()=>commit(f,p,next),/预览后发生变化/);
  assert.equal(moduleRow(f,id).file_key,key);assert.ok(f.bytes.has(key));
  const same=file('repeat.js',source('duplicate')),multi=await preview(f,[same,same]);
  await commit(f,multi,same,0,undefined,'new');
  await assert.rejects(()=>commit(f,multi,same,1,undefined,'new'),/已有匹配/);
});

test('database publish failure leaves previous content and metadata intact, then retry succeeds',async()=>{
  const f=fixture(),a=await add(f,file('one.js',source('a'))),id=a.module_id;
  const old=moduleRow(f,id),before=Buffer.from(await content(f,id));
  const update=file('one.js',source('a','2')),p=await preview(f,[update]);
  f.failNextTransaction();await assert.rejects(()=>commit(f,p,update),/transaction failure/);
  assert.equal(moduleRow(f,id).file_key,old.file_key);assert.equal(moduleRow(f,id).version,old.version);
  assert.deepEqual(Buffer.from(await content(f,id)),before);
  assert.equal((await commit(f,p,update)).status,'replaced');
});

test('last version retained seven days; restore swaps versions while preserving relationships and maintenance',async()=>{
  const f=fixture(),original=file('one.js',source('a','1')),a=await add(f,original),id=a.module_id;
  const next=file('one.js',source('a','2')),p=await preview(f,[next]);await commit(f,p,next);
  const previous=await previousVersion(f.env,id);assert.equal(previous.metadata.version,'1');
  assert.equal(previous.expires_at-previous.created_at,7*86400000);
  f.sql.prepare('UPDATE modules SET manual_override=1,note=? WHERE id=?').run('note',id);
  await restorePrevious(f.env,id,previous.created_at);
  assert.equal(moduleRow(f,id).version,'1');assert.equal(moduleRow(f,id).note,'note');assert.equal(moduleRow(f,id).manual_override,1);
  assert.equal(new TextDecoder().decode(await content(f,id)),await original.text());
  assert.equal((await previousVersion(f.env,id)).metadata.version,'2');
  f.sql.prepare('UPDATE module_previous_versions SET expires_at=0').run();
  assert.equal(await previousVersion(f.env,id),null);
  await assert.rejects(()=>restorePrevious(f.env,id,previous.created_at),/过期/);
});

test('subscription upload requires explicit mode; manual maintenance survives sync, temporary mode follows upstream',async()=>{
  const f=fixture(),original=file('one.js',source('a')),a=await add(f,original),id=a.module_id;
  f.sql.prepare('UPDATE modules SET source_managed=1,source_url=? WHERE id=?').run('https://example.com/a.js',id);
  const updated=file('one.js',source('a','2')),p=await preview(f,[updated]);
  await assert.rejects(()=>commit(f,p,updated),/明确选择/);
  await commit(f,p,updated,0,'manual');assert.equal(moduleRow(f,id).manual_override,1);
  const now=Date.now();
  f.sql.prepare('INSERT INTO subscription_sources (id,url,title,created_at) VALUES (?,?,?,?)').run('src','https://example.com/list.rex','src',now);
  f.sql.prepare(`INSERT INTO subscription_items (source_id,remote_id,module_id,url,active) VALUES (?,?,?,?,1)`)
    .run('src','a',id,'https://example.com/a.js');
  const upstream=source('a','3'),encoder=new TextEncoder();let downloads=0;
  const helpers={...f.helpers,assertFetchableUrl:u=>new URL(u),
    async fetchCapped(url){if(!url.endsWith('.rex'))downloads++;return encoder.encode(url.endsWith('.rex')?JSON.stringify({title:'src',widgets:[{id:'a',url:'https://example.com/a.js',version:'3'}]}):upstream).buffer;},
    async putFile(env,id,buffer){await env.KV.put('file:'+id,buffer);}};
  for(let i=0;i<2;i++)await syncSubscription(f.env,'src','continue',helpers);
  assert.equal(moduleRow(f,id).version,'2');assert.equal(moduleRow(f,id).manual_override,1);
  assert.equal(downloads,0);
  const p2=await preview(f,[updated]);await commit(f,p2,updated,0,'temporary');
  for(let i=0;i<2;i++)await syncSubscription(f.env,'src','continue',helpers);
  assert.equal(moduleRow(f,id).version,'3');assert.equal(moduleRow(f,id).file_key,'');
  assert.equal(downloads,1);
  assert.equal(new TextDecoder().decode(await content(f,id)),upstream);
});

test('concurrent confirmation of two previews produces one replacement, never duplicate or lost content',async()=>{
  const f=fixture(),initial=file('one.js',source('a')),a=await add(f,initial);
  const v2=file('one.js',source('a','2')),v3=file('one.js',source('a','3'));
  const [p2,p3]=await Promise.all([preview(f,[v2]),preview(f,[v3])]);
  const results=await Promise.allSettled([commit(f,p2,v2),commit(f,p3,v3)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM modules').get().n,1);
  assert.ok(f.bytes.has(moduleRow(f,a.module_id).file_key));
});

test('expired preview, invalid file and failed backup never replace existing content',async()=>{
  const f=fixture(),original=file('one.js',source('a')),a=await add(f,original),id=a.module_id;
  const next=file('one.js',source('a','2')),p=await preview(f,[next]),key=moduleRow(f,id).file_key;
  f.sql.prepare('UPDATE upload_jobs SET expires_at=0 WHERE id=?').run(p.job_id);
  await assert.rejects(()=>commit(f,p,next),/预览已过期/);
  const invalid=await preview(f,[file('one.js','<!DOCTYPE html><html>Error</html>')]);
  assert.equal(invalid.rows[0].kind,'invalid');assert.equal(moduleRow(f,id).file_key,key);
  const fresh=await preview(f,[next]),put=f.env.KV.put;
  f.env.KV.put=async(key,...rest)=>{if(key.startsWith('upload-backup:'))throw Error('backup failed');return put(key,...rest);};
  await assert.rejects(()=>commit(f,fresh,next),/backup failed/);
  assert.equal(moduleRow(f,id).file_key,key);assert.equal(moduleRow(f,id).version,'1');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM upload_results WHERE job_id=?').get(fresh.job_id).n,0);
});
