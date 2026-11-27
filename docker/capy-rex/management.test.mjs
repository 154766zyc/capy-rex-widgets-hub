import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {uploadSchema} from './uploads.js';
import {subscriptionSchema} from './subscriptions.js';
import {sharingSchema} from './sharing.js';
import {bulkManage,replaceMembers,memberIds,deleteModule,uniqueIds} from './management.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE modules(id TEXT PRIMARY KEY,filename TEXT,widget_id TEXT,title TEXT,note TEXT,group_id TEXT,sort_order INTEGER,created_at INTEGER,updated_at INTEGER,file_key TEXT,source_url TEXT);
 CREATE TABLE collections(id TEXT PRIMARY KEY,updated_at INTEGER,auto_all INTEGER DEFAULT 0);
 CREATE TABLE groups(id TEXT PRIMARY KEY);
 CREATE TABLE collection_modules(collection_id TEXT,module_id TEXT,position INTEGER,PRIMARY KEY(collection_id,module_id));`);
 for(const s of [...uploadSchema,...subscriptionSchema,...sharingSchema])sql.exec(s);
 let fail=false;const DB={prepare(query){const s=sql.prepare(query);let a=[];return {bind(...args){a=args;return this;},async first(){return s.get(...a)||null;},async all(){return {results:s.all(...a)};},async run(){return {meta:{changes:Number(s.run(...a).changes)}};}};},async batch(list){if(fail){fail=false;throw Error('DB failure');}sql.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const deleted=[];const env={DB,KV:{async delete(key){deleted.push(key);}}};
 for(const id of ['a','b','c'])sql.prepare('INSERT INTO modules VALUES (?,?,?,?,?,?,?,?,?,?,NULL)').run(id,id+'.js','remote-'+id,'Title '+id,'note '+id,'',20,10,10,'upload-content:'+id);
 sql.exec("INSERT INTO collections(id,updated_at) VALUES ('mine',1);INSERT INTO groups VALUES ('group1');INSERT INTO collection_modules VALUES ('mine','a',0)");
 return {env,sql,deleted,fail(){fail=true;}};
}
test('batch group preserves public identity, notes, ordering and bytes; missing IDs fail individually',async()=>{
 const f=fixture();const before=f.sql.prepare('SELECT * FROM modules WHERE id=?').get('a');
 const r=await bulkManage(f.env,{action:'group',ids:['a','absent','b'],groupId:'group1'});
 assert.deepEqual(r.results.map(x=>x.ok),[true,false,true]);const after=f.sql.prepare('SELECT * FROM modules WHERE id=?').get('a');
 for(const key of ['id','filename','widget_id','title','note','sort_order','created_at','file_key'])assert.equal(after[key],before[key]);
 assert.equal(after.group_id,'group1');assert.deepEqual(f.deleted,[]);
 await assert.rejects(()=>bulkManage(f.env,{action:'group',ids:['a'],groupId:'nope'}),/不存在/);
});
test('append deduplicates without changing existing order, survives retry and concurrent requests',async()=>{
 const f=fixture();await bulkManage(f.env,{action:'append',ids:['b','a'],collectionId:'mine'});
 assert.deepEqual(await memberIds(f.env.DB,'mine'),['a','b']);
 await bulkManage(f.env,{action:'append',ids:['b','a'],collectionId:'mine'});
 await Promise.all([bulkManage(f.env,{action:'append',ids:['c'],collectionId:'mine'}),bulkManage(f.env,{action:'append',ids:['b'],collectionId:'mine'})]);
 assert.deepEqual(await memberIds(f.env.DB,'mine'),['a','b','c']);
});
test('member save preserves explicit order, validates IDs, rejects stale windows, and rolls back failures',async()=>{
 const f=fixture();await replaceMembers(f.env,'mine',['c','a','b','a'],['a']);
 assert.deepEqual(await memberIds(f.env.DB,'mine'),['c','a','b']);
 await assert.rejects(()=>replaceMembers(f.env,'mine',['a'],['a']),/其他操作更新/);
 await assert.rejects(()=>replaceMembers(f.env,'mine',['missing'],['c','a','b']),/不存在/);
 f.fail();await assert.rejects(()=>replaceMembers(f.env,'mine',[],['c','a','b']),/DB failure/);
 assert.deepEqual(await memberIds(f.env.DB,'mine'),['c','a','b']);
 await replaceMembers(f.env,'mine',[],['c','a','b']);assert.deepEqual(await memberIds(f.env.DB,'mine'),[]);
});
test('delete failure never deletes bytes; success cleans file pointers, versions and all references; retry safe',async()=>{
 const f=fixture();f.sql.exec("INSERT INTO module_previous_versions VALUES ('a','backup:a','{}',0,1);INSERT INTO subscription_sources(id,url,title,created_at) VALUES ('s','https://example.com','Source',1);INSERT INTO subscription_items(source_id,remote_id,url,module_id) VALUES ('s','r','https://example.com/a','a')");
 f.fail();await assert.rejects(()=>deleteModule(f.env,'a'),/DB failure/);assert.deepEqual(f.deleted,[]);assert.deepEqual(await memberIds(f.env.DB,'mine'),['a']);
 await deleteModule(f.env,'a');assert.equal(f.sql.prepare('SELECT * FROM modules WHERE id=?').get('a'),undefined);
 assert.deepEqual(await memberIds(f.env.DB,'mine'),[]);assert.equal(f.sql.prepare('SELECT module_id FROM subscription_items').get().module_id,null);
 assert.deepEqual(new Set(f.deleted),new Set(['file:a','upload-content:a','backup:a']));
 assert.equal((await deleteModule(f.env,'a')).absent,true);
});
test('ID validation bounds requests and multi-statement collection writes stay below binding limit',async()=>{
 assert.throws(()=>uniqueIds(['a',null]),/无效/);assert.throws(()=>uniqueIds(Array(11).fill('a'),10),/超过/);
 await assert.rejects(()=>bulkManage(fixture().env,{action:'delete',ids:['a','b','c']}),/超过 2/);
 const f=fixture(),ids=[];for(let i=0;i<120;i++){const id='x'+i;ids.push(id);f.sql.prepare('INSERT INTO modules(id) VALUES (?)').run(id);}
 await replaceMembers(f.env,'mine',ids,['a']);assert.deepEqual(await memberIds(f.env.DB,'mine'),ids);
});
