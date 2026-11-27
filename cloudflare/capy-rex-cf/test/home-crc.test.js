import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parseHomePackage} from '../home-configs.js';
import {homePackage} from './fixtures/home-package.js';

test('校验值 ≥ 2^31 的首页包（Rex 导出常见）能正常解析，且不依赖运行环境的 zlib.crc32',()=>{
 const source=readFileSync(new URL('../home-configs.js',import.meta.url),'utf8');
 assert.ok(!/zlib\.crc32/.test(source),'不得使用 zlib.crc32：Cloudflare 上结果可能不同');
 let high=0;
 for(let i=0;i<40&&high<3;i++){
  const raw=homePackage({extra:[['assets/x.bin',randomBytes(64)]]});
  const end=raw.length-22,start=raw.readUInt32LE(end+16),count=raw.readUInt16LE(end+10);
  let p=start,hasHigh=false;
  for(let k=0;k<count;k++){if(raw.readUInt32LE(p+16)>=2**31)hasHigh=true;p+=46+raw.readUInt16LE(p+28)+raw.readUInt16LE(p+30)+raw.readUInt16LE(p+32);}
  if(!hasHigh)continue;high++;
  assert.equal(parseHomePackage(raw).package_title,'测试首页');
 }
 assert.ok(high>=3,'生成了足够的高位校验值样本');
});
