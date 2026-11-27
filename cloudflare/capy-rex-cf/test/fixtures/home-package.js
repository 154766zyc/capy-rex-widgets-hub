import {deflateRawSync,crc32} from 'node:zlib';
import {readFileSync} from 'node:fs';
export const avatar=readFileSync(new URL('../../public/app-icons/rex-mulberry-v1-32.png',import.meta.url));
export function zipEntries(entries,{stored=false,descriptor=false,zip64=false,zip64End=false,zip64Offset=false,descriptorSignature=true}={}){
 const local=[],central=[];let offset=0;
 for(const [name,value] of entries){
  const text=Buffer.from(name),bytes=Buffer.from(value),packed=stored?bytes:deflateRawSync(bytes),crc=crc32(bytes),flags=0x800|(descriptor?8:0);
  const localWide=zip64&&zip64!=='central',centralWide=!!zip64;
  function extra(wide,withOffset,placeholder=false){if(!wide&&!withOffset)return Buffer.alloc(0);const b=Buffer.alloc(4+(wide?16:0)+(withOffset?8:0));b.writeUInt16LE(1);b.writeUInt16LE(b.length-4,2);let p=4;if(wide){b.writeBigUInt64LE(BigInt(placeholder?0:bytes.length),p);b.writeBigUInt64LE(BigInt(placeholder?0:packed.length),p+8);p+=16;}if(withOffset)b.writeBigUInt64LE(BigInt(offset),p);return b;}
  const localExtra=extra(localWide,false,descriptor),centralExtra=extra(centralWide,zip64Offset);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(flags,6);head.writeUInt16LE(stored?0:8,8);head.writeUInt16LE(text.length,26);
  if(!descriptor){head.writeUInt32LE(crc,14);head.writeUInt32LE(packed.length,18);head.writeUInt32LE(bytes.length,22);}
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(flags,8);entry.writeUInt16LE(stored?0:8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(text.length,28);entry.writeUInt32LE(offset,42);
  head.writeUInt16LE(localExtra.length,28);entry.writeUInt16LE(centralExtra.length,30);
  if(localWide){head.writeUInt16LE(45,4);head.writeUInt32LE(0xffffffff,18);head.writeUInt32LE(0xffffffff,22);}
  if(centralWide){entry.writeUInt16LE(45,6);entry.writeUInt32LE(0xffffffff,20);entry.writeUInt32LE(0xffffffff,24);}
  if(zip64Offset){entry.writeUInt16LE(45,6);entry.writeUInt32LE(0xffffffff,42);}
  local.push(head,text,localExtra,packed);central.push(entry,text,centralExtra);offset+=head.length+text.length+localExtra.length+packed.length;
  if(descriptor){const p=descriptorSignature?4:0,d=Buffer.alloc(p+4+(localWide?16:8));if(descriptorSignature)d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,p);if(localWide){d.writeBigUInt64LE(BigInt(packed.length),p+4);d.writeBigUInt64LE(BigInt(bytes.length),p+12);}else{d.writeUInt32LE(packed.length,p+4);d.writeUInt32LE(bytes.length,p+8);}local.push(d);offset+=d.length;}
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 const records=[];
 if(zip64End){
  const record=Buffer.alloc(56),locator=Buffer.alloc(20);record.writeUInt32LE(0x06064b50);record.writeBigUInt64LE(44n,4);record.writeUInt16LE(45,12);record.writeUInt16LE(45,14);record.writeBigUInt64LE(BigInt(entries.length),24);record.writeBigUInt64LE(BigInt(entries.length),32);record.writeBigUInt64LE(BigInt(directory.length),40);record.writeBigUInt64LE(BigInt(offset),48);
  locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(offset+directory.length),8);locator.writeUInt32LE(1,16);records.push(record,locator);
  end.writeUInt16LE(0xffff,8);end.writeUInt16LE(0xffff,10);end.writeUInt32LE(0xffffffff,12);end.writeUInt32LE(0xffffffff,16);
 }
 return Buffer.concat([...local,directory,...records,end]);
}
export function homeEntries({title='测试首页',layout=[{id:'s',title:'栏目',items:[{title:'展示项',widgetURL:'https://not-fetched.example/widget.js'}]}],home={},manifest={},extra=[]}={}){
 return [['rex-manifest.json',JSON.stringify({format:'video.fika.rex.home-package',version:1,...manifest})],['rex-home.json',JSON.stringify({title,avatarData:avatar.toString('base64'),...home})],['rex-layout.json',JSON.stringify(layout)],...extra];
}
export const homePackage=(options={},zipOptions={})=>zipEntries(homeEntries(options),zipOptions);
