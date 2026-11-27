import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHomePackage,readHomeZip,HOME_LIMITS} from '../home-configs.js';
import {homePackage,homeEntries,zipEntries} from './fixtures/home-package.js';
import {listen,close,login,api,temporary} from './helpers.js';
const directory=b=>{const end=b.length-22;return b.readUInt32LE(end+16)===0xffffffff?Number(b.readBigUInt64LE(Number(b.readBigUInt64LE(end-12))+48)):b.readUInt32LE(end+16);};
const centralExtra=b=>{const p=directory(b);return p+46+b.readUInt16LE(p+28);};

test('bounded ZIP64 supports central-only sizes, local sizes/offsets, stored data, descriptors and ZIP64 EOCD',()=>{
 for(const zip64 of ['central',true])for(const descriptor of [false,true])for(const descriptorSignature of [false,true])for(const zip64End of [false,true]){
  const raw=homePackage({extra:[['rex-scripts/example.js','globalThis.zip64PayloadExecuted=true;']]},{zip64,descriptor,descriptorSignature,zip64End,zip64Offset:true,stored:!descriptorSignature});
  globalThis.zip64PayloadExecuted=false;const parsed=parseHomePackage(raw),files=readHomeZip(raw);
  assert.deepEqual(parsed.bytes,raw);assert.equal(parsed.sections,1);assert.equal(parsed.items,1);assert.equal(files.size,4);assert.equal(globalThis.zip64PayloadExecuted,false);delete globalThis.zip64PayloadExecuted;
 }
 // Offset-only extra fields must not be mistaken for expanded/compressed sizes.
 assert.equal(parseHomePackage(homePackage({}, {zip64Offset:true,zip64End:true})).package_title,'测试首页');
});
test('ZIP64 rejects missing/truncated extensions, oversized or unsafe values, forged offsets and local mismatches',()=>{
 const mutations=[
  b=>b.writeUInt16LE(2,centralExtra(b)),
  b=>b.writeUInt16LE(1,centralExtra(b)+2),
  b=>b.writeBigUInt64LE(BigInt(HOME_LIMITS.entry+1),centralExtra(b)+4),
  b=>b.writeBigUInt64LE(2n**63n,centralExtra(b)+4),
  b=>b.writeBigUInt64LE(BigInt(HOME_LIMITS.file+1),centralExtra(b)+12),
  b=>b.writeBigUInt64LE(BigInt(directory(b)),centralExtra(b)+20),
  b=>b.writeUInt16LE(1,directory(b)+34),
  b=>b.writeUInt16LE(2,30+b.readUInt16LE(26)),
  b=>b.writeBigUInt64LE(1n,30+b.readUInt16LE(26)+4),
  b=>b.writeUInt16LE(0xffff,directory(b)+30)
 ];
 for(const mutate of mutations){const raw=homePackage({}, {zip64:true,zip64Offset:true});mutate(raw);assert.throws(()=>readHomeZip(raw));}
});
test('ZIP64 EOCD rejects missing locator, multi-disk, unsafe offsets/counts and inconsistent directories',()=>{
 const mutations=[
  b=>b.writeUInt32LE(0,b.length-42),
  b=>b.writeUInt32LE(1,b.length-38),
  b=>b.writeUInt32LE(2,b.length-26),
  b=>b.writeBigUInt64LE(2n**63n,b.length-34),
  b=>b.writeBigUInt64LE(1n,b.length-98+24),
  b=>b.writeBigUInt64LE(33n,b.length-98+32),
  b=>b.writeBigUInt64LE(43n,b.length-98+4),
  b=>b.writeUInt32LE(1,b.length-22+16),
  b=>b.writeBigUInt64LE(1n,b.length-98+40)
 ];
 for(const mutate of mutations){const raw=homePackage({}, {zip64:true,zip64End:true});mutate(raw);assert.throws(()=>readHomeZip(raw));}
});
test('descriptors are validated and counted in ranges; ZIP64 still rejects CRC damage and traversal',()=>{
 for(const zip64 of [false,true]){
  const raw=homePackage({}, {zip64,descriptor:true}),bad=Buffer.from(raw),p=bad.indexOf(Buffer.from([0x50,0x4b,0x07,0x08]));bad[p+4]^=1;assert.throws(()=>readHomeZip(bad),/描述符/);
  const corrupt=homePackage({}, {zip64,stored:true});corrupt[30+corrupt.readUInt16LE(26)+corrupt.readUInt16LE(28)]^=1;assert.throws(()=>readHomeZip(corrupt),/校验/);
  assert.throws(()=>readHomeZip(zipEntries([...homeEntries(),['../escape','bad']],{zip64})),/不安全/);
 }
});
test('ZIP64 upload/export/share/replace/backup restore preserve bytes, old URLs and module records',async t=>{
 const {server,base}=await listen({DATA_DIR:temporary(t),ADMIN_SECRET:'zip64-test-only',DISABLE_SCHEDULER:'true'},{remoteFetch:async()=>{throw Error('No network');}});t.after(()=>close(server));
 const cookie=await login(base,'zip64-test-only'),call=(path,options={})=>api(base,path,{cookie,...options}),root='/api/admin/home-configs';
 async function ok(path,options){const r=await call(path,options),body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;}
 async function upload(raw,row){const form=new FormData();form.append('file',new File([raw],'ZIP64.rex'));if(row)form.append('revision',row.revision);return call(root+(row?'/'+row.id:''),{method:row?'PUT':'POST',body:form});}
 const before=await ok('/api/admin/modules'),raw=homePackage({}, {zip64:true,zip64End:true,descriptor:true});
 assert.equal((await upload(raw)).status,201);let row=(await ok(root))[0];
 const {path}=await ok(root+'/'+row.id+'/share',{method:'POST',json:{revision:row.revision,accept_public:true}});row=(await ok(root))[0];
 assert.deepEqual(Buffer.from(await(await api(base,path)).arrayBuffer()),raw);
 const next=homePackage({title:'新包内名称'}, {zip64:'central'});
 assert.equal((await upload(next,row)).status,200);const fresh=(await ok(root))[0];assert.equal(fresh.share_path,path);assert.equal(fresh.id,row.id);assert.equal(fresh.title,row.title);
 const bad=Buffer.from(next);bad.writeUInt16LE(2,centralExtra(bad));assert.equal((await upload(bad,fresh)).status,400);
 assert.deepEqual(Buffer.from(await(await call(root+'/'+row.id+'/file')).arrayBuffer()),next);
 const backup=await ok('/api/admin/backup');assert.equal(backup.format,8);await ok('/api/admin/backup/restore',{method:'POST',json:backup});
 assert.deepEqual(Buffer.from(await(await api(base,path)).arrayBuffer()),next);assert.deepEqual(await ok('/api/admin/modules'),before);
});
