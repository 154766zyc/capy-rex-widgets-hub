// 3.5.8：把 Forward 首页包（.fwd）转换成 Rex 首页包（.rex）。
// .fwd 是 zip：widgets.json（栏目，格式与 rex-layout.json 相同）+ home.json（名称、头像）。
// 栏目原样保留，只把头像换成 Rex 的写法；输出为 Mac Rex 导出格式（manifest → layout → home，
// 不压缩，Unix 0644，JSON 一行且 / 写成 \/）。转换结果未在 Rex 实测。
import {readHomeZip} from './home-configs.js';
import {validateIcon} from './icons.js';
import {decodeBase64} from './binary.js';

const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
// 每个布局项目必须有的 13 个字段（缺一个整个首页包会导入失败）。
const ITEM_STRINGS=['style','id','title','subtitle','iconUrl','functionId','widgetBundleId','widgetId','widgetURL','name'];

// Mac Rex 的 JSON：一行、/ 写成 \/。
export const macJson=value=>JSON.stringify(value).replaceAll('/','\\/');

// 最小的不压缩 ZIP 写入器（方法 0，UTF-8 文件名，Unix 0644）。
export function storedZip(files){
 const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
 for(const [name,data] of files){
  const nameBytes=enc.encode(name),crc=crc32(data),size=data.length;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(0,8);
  local.writeUInt16LE(0,10);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);
  local.writeUInt16LE(nameBytes.length,26);local.writeUInt16LE(0,28);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(0,10);
  central.writeUInt16LE(0,12);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);
  central.writeUInt16LE(nameBytes.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);
  central.writeUInt32LE((0o100644<<16)>>>0,38);central.writeUInt32LE(offset,42);
  locals.push(local,nameBytes,data);centrals.push(central,nameBytes);
  offset+=30+nameBytes.length+size;
 }
 const directory=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
 end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}

function readJson(entries,name){
 if(!entries.has(name))fail('Forward 首页包缺少 '+name+'（需要在 zip 最外层）');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get(name)));}catch(e){fail('Forward 首页包 '+name+' 无效：'+e.message);}
}

// 只保留 PNG 头像（Rex 自定义头像要 PNG）；其它格式（如 JPEG）改用内置头像 avatar-8。
function rexAvatar(home){
 const raw=typeof home.avatarData==='string'?home.avatarData.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i,''):'';
 if(raw&&raw.length<3*1024*1024){
  try{const image=validateIcon(decodeBase64(raw,2*1024*1024,'首页头像'));if(image.mime==='image/png')return {avatar:'avatar-22',avatarData:raw};}catch{/* 无效头像改用内置头像 */}
 }
 return {avatar:'avatar-8'};
}

export function fwdToRex(input,original='首页.fwd'){
 const entries=readHomeZip(input);
 const layout=readJson(entries,'widgets.json'),home=readJson(entries,'home.json');
 if(!Array.isArray(layout))fail('Forward 首页包 widgets.json 必须是栏目数组');
 if(!object(home))fail('Forward 首页包 home.json 无效');
 // 栏目原样保留；只给缺字段的布局项目补上默认值（空字符串、空参数、count 0、整行宽 gridSize [-1,2]），避免 Rex 整包导入失败。
 let filled=0;
 for(const section of layout){
  if(!object(section))fail('Forward 首页栏目结构无效');
  if(section.items!==undefined&&!Array.isArray(section.items))fail('Forward 首页栏目结构无效');
  for(const item of section.items||[]){
   if(!object(item))fail('Forward 首页布局项目无效');
   for(const key of ITEM_STRINGS)if(item[key]===undefined){item[key]='';filled++;}
   if(item.params===undefined){item.params=[];filled++;}
   if(item.count===undefined){item.count=0;filled++;}
   if(item.gridSize===undefined){item.gridSize=[-1,2];filled++;}
  }
 }
 const title=(typeof home.title==='string'&&home.title.trim()?home.title.trim():String(original).replace(/\.fwd$/i,'').trim()||'首页').slice(0,200);
 const avatar=rexAvatar(home);
 // 字段顺序与 Mac Rex 一致：avatar、avatarData、isIndependent、title。
 const rexHome={avatar:avatar.avatar,...(avatar.avatarData?{avatarData:avatar.avatarData}:{}),isIndependent:false,title};
 const enc=new TextEncoder();
 const bytes=storedZip([
  ['rex-manifest.json',enc.encode(macJson({format:'video.fika.rex.home-package',version:1}))],
  ['rex-layout.json',enc.encode(macJson(layout))],
  ['rex-home.json',enc.encode(macJson(rexHome))]
 ]);
 return {bytes,filename:String(original).replace(/\.fwd$/i,'')+'.rex',filled,avatar:avatar.avatar};
}
