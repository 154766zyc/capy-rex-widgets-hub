import {test} from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {readFileSync} from 'node:fs';
import {randomBytes,randomInt} from 'node:crypto';
import {inflateRaw} from '../inflate.js';

test('自带解压与 zlib 结果完全一致（随机数据、各压缩级别和策略）',()=>{
 const gens=[()=>randomBytes(randomInt(0,4000)),()=>Buffer.from('abc'.repeat(randomInt(0,30000))),
  ()=>Buffer.from(JSON.stringify(Array.from({length:randomInt(0,2000)},(_,i)=>({id:i,t:'标题'+i,u:'https:\\/\\/x.example\\/'+i})))),
  ()=>Buffer.concat([randomBytes(randomInt(0,300)),Buffer.alloc(randomInt(0,70000),7),randomBytes(randomInt(0,300))])];
 for(let k=0;k<800;k++){const d=gens[k%gens.length]();const level=randomInt(0,10),strategy=randomInt(0,5);
  assert.ok(Buffer.from(inflateRaw(zlib.deflateRawSync(d,{level,strategy}),d.length)).equals(d),`level ${level} strategy ${strategy}`);}
});
test('自带解压：超过大小上限、截断、损坏的数据都会报错，不会卡住',()=>{
 assert.throws(()=>inflateRaw(zlib.deflateRawSync(Buffer.alloc(100000)),99999),/大小限制/);
 const c=zlib.deflateRawSync(randomBytes(5000));
 assert.throws(()=>inflateRaw(c.subarray(0,c.length>>1),5000),/不完整|损坏/);
 assert.throws(()=>inflateRaw(Buffer.from([0x07]),10),/损坏|不完整/);
 for(let k=0;k<300;k++){const x=Buffer.from(c);x[randomInt(0,x.length)]^=1<<randomInt(0,8);try{inflateRaw(x,5000);}catch{}}
});
test('首页包解析不再依赖 node:zlib（Cloudflare 上结果可能不同）',()=>{
 assert.ok(!/node:zlib/.test(readFileSync(new URL('../home-configs.js',import.meta.url),'utf8')));
});

test('自带解压：回溯距离超过已解压内容（伪造数据）会被拒绝',()=>{
 // 固定哈夫曼块：一开头就引用「往前 1 字节、长 3」，此时还没有任何输出
 const bits=[1,1,0, 0,0,0,0,0,0,1, 0,0,0,0,0, 0,0,0,0,0,0,0];
 const bytes=new Uint8Array(Math.ceil(bits.length/8));bits.forEach((b,i)=>{bytes[i>>3]|=b<<(i&7);});
 assert.throws(()=>inflateRaw(bytes,100),/损坏/);
 assert.throws(()=>zlib.inflateRawSync(bytes),'zlib 同样拒绝');
});
