// Rex home packages are opaque original ZIP bytes, not module collections.
// Read bounded JSON metadata in memory only. Never extract files or fetch URLs.
import {inflateRaw} from './inflate.js';
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
// Our own inflate (inflate.js) and unsigned CRC-32: runtimes differ (Cloudflare's built-in zlib is not
// guaranteed to behave like Node's), and Rex exports often have CRCs >= 2^31.
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
import {createHash} from 'node:crypto';
import {validateIcon} from './icons.js';
import {decodeBase64} from './binary.js';
import {contentDisposition} from './filenames.js';
import {fwdToRex} from './fwd.js';
import {checkHomePackage,CHECK_VERSION} from './home-check.js';
import {moduleReport,relinkHome,attachHtml} from './home-tools.js';

export const HOME_LIMITS={file:25*1024*1024,expanded:64*1024*1024,entry:32*1024*1024,entries:256,count:200};
export const homeSchema=[`CREATE TABLE IF NOT EXISTS home_configs(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,package_title TEXT NOT NULL,filename TEXT NOT NULL,
 size INTEGER NOT NULL,hash TEXT NOT NULL,sections INTEGER NOT NULL,items INTEGER NOT NULL,
 bytes BLOB NOT NULL,avatar_bytes BLOB,avatar_mime TEXT NOT NULL DEFAULT '',
 share_key TEXT UNIQUE,revision TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`];
// 3.6.0：检查结果按文件指纹缓存（check_json 完整报告、check_summary 列表摘要、checked_hash 对应的文件指纹）。
const HOME_COLUMNS=["check_json TEXT NOT NULL DEFAULT ''","check_summary TEXT NOT NULL DEFAULT ''","checked_hash TEXT NOT NULL DEFAULT ''"];
export async function migrateHomes(env){
 const names=new Set(((await env.DB.prepare('PRAGMA table_info(home_configs)').all()).results||[]).map(c=>c.name));
 for(const definition of HOME_COLUMNS){if(names.has(definition.split(' ')[0]))continue;
  try{await env.DB.prepare('ALTER TABLE home_configs ADD COLUMN '+definition).run();}catch(e){if(!String(e.message).includes('duplicate column'))throw e;}}
}
// 哪些首页请求要收大请求体（上传、替换、装 HTML 卡片）。分享开关、换链接、改名、删除都只收小 JSON。CF 和 Docker 共用。
export function isHomeUpload(path,method){
 if(!['POST','PUT'].includes(method))return false;
 return path==='/api/admin/home-configs'||/^\/api\/admin\/home-configs\/[a-f0-9-]{36}(?:\/html)?$/.test(path);
}
const summaryOf=check=>({check_version:check.check_version,version:check.version,html_cards:check.html_cards.length,html_issues:check.html_cards.filter(c=>c.issues.length).length,scripts:check.scripts.length,warnings:check.warnings.length,local_items:check.local_items});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const shareKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim();
function title(value){if(typeof value!=='string'||!clean(value)||value.length>200)fail('首页名称不能为空，且最多 200 字');return clean(value);}
function filename(value){if(typeof value!=='string'||!clean(value)||value.length>240||/[\/\\\u0000-\u001f\u007f]/.test(value)||!/^.+\.rex$/i.test(value))fail('请选择有效的 .rex 首页文件');return value;}
function exportName(row){return (clean(row.title).replace(/\.rex$/i,'').replace(/[<>:"/\\|?*]/g,'_').slice(0,160).replace(/[. ]+$/,'')||'首页配置')+'.rex';}

// ZIP64 is a container encoding, not permission to exceed the existing limits.
function zipNumber(value){if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('首页 ZIP64 数值超出安全范围');return Number(value);}
function zipExtra(bytes,start,length,fields){
 let p=start,zip=null;const end=start+length;
 while(p<end){
  if(p+4>end)fail('首页 ZIP 扩展字段损坏');const tag=bytes.readUInt16LE(p),n=bytes.readUInt16LE(p+2);p+=4;
  if(p+n>end)fail('首页 ZIP 扩展字段损坏');
  if(tag===1){if(zip)fail('首页 ZIP64 扩展字段重复');zip=bytes.subarray(p,p+n);}p+=n;
 }
 let at=0;
 return fields.map(([value,width=8])=>{
  if(value!==(width===4?0xffff:0xffffffff))return value;
  if(!zip||at+width>zip.length)fail('首页 ZIP64 缺少有效的大小或偏移信息');
  const actual=width===4?zip.readUInt32LE(at):zipNumber(zip.readBigUInt64LE(at));at+=width;return actual;
 });
}
function zipDirectory(bytes,end){
 let count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16),finish=end;
 const onDisk=bytes.readUInt16LE(end+8),locator=end-20,hasLocator=locator>=0&&bytes.readUInt32LE(locator)===0x07064b50;
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))fail('不支持多卷首页 ZIP 包');
 if(hasLocator){
  if(bytes.readUInt32LE(locator+4)||bytes.readUInt32LE(locator+16)!==1)fail('不支持多卷首页 ZIP64 包');
  const pos=zipNumber(bytes.readBigUInt64LE(locator+8));
  if(pos+56>locator||bytes.readUInt32LE(pos)!==0x06064b50)fail('首页 ZIP64 目录损坏');
  const recordSize=zipNumber(bytes.readBigUInt64LE(pos+4));
  if(recordSize<44||pos+12+recordSize!==locator||bytes.readUInt32LE(pos+16)||bytes.readUInt32LE(pos+20))fail('首页 ZIP64 目录损坏或不支持多卷');
  const actualCount=zipNumber(bytes.readBigUInt64LE(pos+32)),actualSize=zipNumber(bytes.readBigUInt64LE(pos+40)),actualStart=zipNumber(bytes.readBigUInt64LE(pos+48));
  if(bytes.readBigUInt64LE(pos+24)!==BigInt(actualCount)||(onDisk!==0xffff&&onDisk!==actualCount)||(count!==0xffff&&count!==actualCount)||(size!==0xffffffff&&size!==actualSize)||(start!==0xffffffff&&start!==actualStart))fail('首页 ZIP64 目录不一致');
  count=actualCount;size=actualSize;start=actualStart;finish=pos;
 }else if(count===0xffff||onDisk===0xffff||size===0xffffffff||start===0xffffffff)fail('首页 ZIP64 缺少有效目录');
 else if(onDisk!==count)fail('首页 ZIP 目录不一致');
 if(!count||count>HOME_LIMITS.entries||start+size!==finish||start<0||start>finish)fail('不支持的 ZIP 目录或文件过多');
 return {count,start,finish};
}
function descriptorEnd(bytes,at,limit,crc,packed,length,wide){
 // Some writers use ZIP64 only in the central directory. Accept either legal
 // descriptor width, but require its CRC/sizes and include it in overlap checks.
 for(const signature of [true,false])for(const size of wide?[8,4]:[4,8]){
  const p=at+(signature?4:0),end=p+4+size*2;if(end>limit)continue;
  if(signature&&bytes.readUInt32LE(at)!==0x08074b50)continue;
  if(bytes.readUInt32LE(p)!==crc)continue;
  if(size===8?(bytes.readBigUInt64LE(p+4)!==BigInt(packed)||bytes.readBigUInt64LE(p+12)!==BigInt(length)):(bytes.readUInt32LE(p+4)!==packed||bytes.readUInt32LE(p+8)!==length))continue;
  return end;
 }
 fail('首页 ZIP 数据描述符损坏');
}
// Central directory is authoritative, but local names/methods/offsets must agree.
// Encryption, symlinks, traversal, duplicate entries and overlap are rejected.
export function readHomeZip(input){
 const bytes=Buffer.from(input);if(bytes.length<22||bytes.length>HOME_LIMITS.file)fail('首页文件为空、损坏或超过 25 MiB');
 if(bytes.readUInt32LE(0)!==0x04034b50)fail('不是有效的 Rex 首页 ZIP 包');
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
 if(end<0)fail('首页 ZIP 目录损坏');
 const {count,start,finish:directoryEnd}=zipDirectory(bytes,end);
 const entries=new Map(),ranges=[];let p=start,total=0;
 for(let i=0;i<count;i++){
  if(p+46>directoryEnd||bytes.readUInt32LE(p)!==0x02014b50)fail('首页 ZIP 目录损坏');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),n=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32);
  const next=p+46+n+extra+comment;if(next>directoryEnd||!n)fail('首页 ZIP 文件名损坏');
  const [length,packed,offset,disk]=zipExtra(bytes,p+46+n,extra,[[bytes.readUInt32LE(p+24)],[bytes.readUInt32LE(p+20)],[bytes.readUInt32LE(p+42)],[bytes.readUInt16LE(p+34),4]]);
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+46,p+46+n));}catch{fail('首页 ZIP 文件名编码无效');}
  if(entries.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').some(part=>part==='..'||part==='.')||/[\u0000-\u001f\u007f:]/.test(name))fail('首页 ZIP 包含重复或不安全的文件名');
  if((flags&~0x080e)||(flags&1)||![0,8].includes(method)||disk||(bytes.readUInt32LE(p+38)>>>16&0xf000)===0xa000)fail('不支持加密、链接或特殊压缩的首页包');
  total+=length;if(length>HOME_LIMITS.entry||total>HOME_LIMITS.expanded||packed>HOME_LIMITS.file)fail('首页包解压后超过大小限制');
  if(offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method)fail('首页 ZIP 本地目录不一致');
  const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),data=offset+30+localName+localExtra,finish=data+packed;
  if(finish>start||localName!==n||!bytes.subarray(offset+30,offset+30+localName).equals(bytes.subarray(p+46,p+46+n)))fail('首页 ZIP 数据范围或文件名不一致');
  const localWide=bytes.readUInt32LE(offset+18)===0xffffffff||bytes.readUInt32LE(offset+22)===0xffffffff;
  const [localLength,localPacked]=zipExtra(bytes,offset+30+localName,localExtra,[[bytes.readUInt32LE(offset+22)],[bytes.readUInt32LE(offset+18)]]),localCrc=bytes.readUInt32LE(offset+14);
  if(flags&8){if((localCrc&&localCrc!==crc)||(localLength&&localLength!==length)||(localPacked&&localPacked!==packed))fail('首页 ZIP 本地摘要不一致');}
  else if(localCrc!==crc||localPacked!==packed||localLength!==length)fail('首页 ZIP 本地摘要不一致');
  const rangeEnd=flags&8?descriptorEnd(bytes,finish,start,crc,packed,length,localWide):finish;
  if(ranges.some(([a,b])=>offset<b&&rangeEnd>a))fail('首页 ZIP 数据重叠');ranges.push([offset,rangeEnd]);
  let content;try{content=method===0?bytes.subarray(data,finish):Buffer.from(inflateRaw(bytes.subarray(data,finish),length));}catch(e){fail('首页 ZIP 解压失败或超过大小限制（'+name+'：'+String(e&&e.message||e).slice(0,120)+'）');}
  if(content.length!==length||crc32(content)!==crc)fail('首页 ZIP 内容校验失败');
  entries.set(name,content);p=next;
 }
 if(p!==directoryEnd)fail('首页 ZIP 目录长度不一致');return entries;
}
export function parseHomePackage(input,original='首页配置.rex'){
 const bytes=Buffer.from(input),entries=readHomeZip(bytes);
 function read(name){try{if(!entries.has(name))fail('缺少 '+name);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get(name)));}catch(e){fail('首页包 '+name+' 无效：'+e.message);}}
 const manifest=read('rex-manifest.json'),home=read('rex-home.json'),layout=read('rex-layout.json');
 if(!object(manifest)||manifest.format!=='video.fika.rex.home-package'||![1,2].includes(manifest.version))fail('仅支持 Rex 首页包 home-package version 1 或 2，不是模块合集 JSON');
 if(!object(home)||!Array.isArray(layout)||layout.length>1000)fail('首页信息或布局结构无效');
 let items=0;for(const section of layout){if(!object(section)||(section.items!==undefined&&!Array.isArray(section.items)))fail('首页栏目结构无效');for(const item of section.items||[])if(!object(item))fail('首页布局项目无效');items+=(section.items||[]).length;}
 if(items>10000)fail('首页布局项目过多');
 // 3.6.0：version 2 可带 rex-html/ HTML 卡片和 rex-scripts/ 内置脚本；布局引用缺失的 HTML 文件直接拒绝，其余只提示。
 const check=checkHomePackage(entries,manifest,layout);
 const packageTitle=(clean(typeof home.title==='string'?home.title:'')||clean(original).replace(/\.rex$/i,'')||'未命名首页').slice(0,200);
 let avatar=null;
 if(typeof home.avatarData==='string'&&home.avatarData.length<3*1024*1024)try{avatar=validateIcon(decodeBase64(home.avatarData.replace(/^data:image\/(?:png|jpeg|webp);base64,/i,''),2*1024*1024,'首页头像'));}catch{/* Unknown/invalid avatars use a neutral placeholder; never render SVG/HTML. */}
 return {bytes,entries,hash:digest(bytes),size:bytes.length,package_title:packageTitle,sections:layout.length,items,avatar,check};
}
const columns='id,title,package_title,filename,size,hash,sections,items,share_key,revision,created_at,updated_at';
const listColumns=columns+',check_summary,checked_hash';
const view=row=>{const {share_key,check_summary,checked_hash,...rest}=row;let check=null;
 if(check_summary&&checked_hash===row.hash)try{const c=JSON.parse(check_summary);if(c.check_version===CHECK_VERSION)check=c;}catch{}
 return {...rest,check,shared:!!share_key,share_path:share_key?'/api/home-configs/'+share_key+'.rex':'',avatar_url:row.has_avatar?'/api/admin/home-configs/'+row.id+'/avatar?v='+row.hash:''};};
const rowSelect=listColumns+",CASE WHEN avatar_bytes IS NOT NULL THEN 1 ELSE 0 END AS has_avatar";
export async function listHomes(env){return (await env.DB.prepare('SELECT '+rowSelect+' FROM home_configs ORDER BY updated_at DESC,id').all()).results.map(view);}
const fullFields=['id','title','package_title','filename','size','hash','sections','items','bytes','avatar_bytes','avatar_mime','share_key','revision','created_at','updated_at','check_json','check_summary','checked_hash'];
function statement(env,row){return env.DB.prepare('INSERT INTO home_configs('+fullFields.join(',')+') VALUES('+fullFields.map(()=>'?').join(',')+') ON CONFLICT(id) DO UPDATE SET '+fullFields.slice(1).map(key=>key+'=excluded.'+key).join(',')).bind(...fullFields.map(key=>row[key]??null));}
function record(parsed,saved){return {...saved,package_title:parsed.package_title,size:parsed.size,hash:parsed.hash,sections:parsed.sections,items:parsed.items,bytes:parsed.bytes,avatar_bytes:parsed.avatar?.bytes||null,avatar_mime:parsed.avatar?.mime||'',check_json:JSON.stringify(parsed.check),check_summary:JSON.stringify(summaryOf(parsed.check)),checked_hash:parsed.hash};}
async function current(env,id,revision){const row=await env.DB.prepare('SELECT '+columns+' FROM home_configs WHERE id=?').bind(id).first();if(!row)fail('首页配置不存在',404);if(typeof revision!=='string'||revision!==row.revision)fail('首页已被修改，请刷新后重试',409);return row;}
// 3.5.8：也接受 Forward 的 .fwd，先转换成 .rex 再按 .rex 校验保存（转换结果未在 Rex 实测）。
async function uploaded(request){const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||!file.name)fail('请选择首页文件');if(file.size>HOME_LIMITS.file)fail('首页文件超过 25 MiB',413);
 if(/\.fwd$/i.test(file.name)){const converted=fwdToRex(await file.arrayBuffer(),file.name);filename(converted.filename);
  return {file:{name:converted.filename,size:converted.bytes.length},form,converted,parsed:parseHomePackage(converted.bytes,converted.filename)};}
 filename(file.name);return {file,form,parsed:parseHomePackage(await file.arrayBuffer(),file.name)};}
const summaryCompat=check=>{const {check_version,local_items,...rest}=summaryOf(check);return rest;};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function download(request,row,avatar=false,publicFile=false){
 const bytes=avatar?row.avatar_bytes:row.bytes;if(!bytes)return reply({error:'文件不存在'},404);
 const headers={'Content-Type':avatar?row.avatar_mime:'application/octet-stream','Content-Length':String(bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',ETag:'"'+row.hash+'"'};
 if(!avatar)headers['Content-Disposition']=contentDisposition(exportName(row),true);
 if(publicFile)headers['Access-Control-Allow-Origin']='*';
 if(request.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
 return new Response(request.method==='HEAD'?null:bytes,{headers});
}
const HTML_UPLOAD_LIMIT=32768;
const newShareKey=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function createHome(env,parsed,filenameText,titleText){
 if(await env.DB.prepare('SELECT id FROM home_configs WHERE hash=?').bind(parsed.hash).first())fail('相同首页文件已存在，请在原卡片中操作',409);
 if((await env.DB.prepare('SELECT COUNT(*) n FROM home_configs').first()).n>=HOME_LIMITS.count)fail('最多保存 200 个首页配置');
 filename(filenameText);
 const now=Date.now(),row=record(parsed,{id:crypto.randomUUID(),title:title(titleText),filename:filenameText,share_key:null,revision:crypto.randomUUID(),created_at:now,updated_at:now});
 await statement(env,row).run();return view({...row,has_avatar:!!parsed.avatar,bytes:undefined,avatar_bytes:undefined,avatar_mime:undefined,check_json:undefined});
}
// 检查结果按文件指纹缓存；规则版本变了或文件换了才重算。重算结果写回，但不改 revision（不算编辑）。
async function cachedCheck(env,id){
 const row=await env.DB.prepare('SELECT title,hash,revision,check_json,checked_hash FROM home_configs WHERE id=?').bind(id).first();if(!row)fail('Not found',404);
 if(row.checked_hash===row.hash&&row.check_json)try{const check=JSON.parse(row.check_json);if(check.check_version===CHECK_VERSION)return {title:row.title,revision:row.revision,check};}catch{}
 const full=await env.DB.prepare('SELECT bytes FROM home_configs WHERE id=?').bind(id).first(),check=parseHomePackage(Buffer.from(full.bytes)).check;
 await env.DB.prepare('UPDATE home_configs SET check_json=?,check_summary=?,checked_hash=? WHERE id=? AND hash=?').bind(JSON.stringify(check),JSON.stringify(summaryOf(check)),row.hash,id,row.hash).run();
 return {title:row.title,revision:row.revision,check};
}
export async function homeResponse(env,request,verifyAuth){
 const path=new URL(request.url).pathname,method=request.method,admin=path.startsWith('/api/admin/home-configs');
 if(!admin&&!path.startsWith('/api/home-configs/'))return null;
 if(admin&&!await verifyAuth(request))return reply({error:'Unauthorized'},401);
 try{
  const publicMatch=path.match(/^\/api\/home-configs\/([a-f0-9]{64})\.rex$/);
  if(!admin){if(!publicMatch)return reply({error:'Not found'},404);if(!['GET','HEAD'].includes(method))return reply({error:'Method not allowed'},405);
   const row=await env.DB.prepare('SELECT title,bytes,hash FROM home_configs WHERE share_key=?').bind(publicMatch[1]).first();return row?download(request,row,false,true):reply({error:'Not found'},404);}
  const root='/api/admin/home-configs',match=path.match(/^\/api\/admin\/home-configs\/([a-f0-9-]{36})(?:\/(file|avatar|share|share\/revoke|share\/rotate|check|relink|html))?$/);
  if(path===root&&method==='GET')return reply(await listHomes(env));
  if(path===root&&method==='POST'){
   const {file,parsed,converted}=await uploaded(request);
   return await env.ATOMIC(async()=>{const home=await createHome(env,parsed,file.name,parsed.package_title);
    return reply({ok:true,check:summaryCompat(parsed.check),...(converted?{converted_from:'fwd',filled_fields:converted.filled}:{}),home},201);});
  }
  if(!match||!uuid(match[1]))return reply({error:'Not found'},404);
  const [,id,action]=match;
  if(action==='check'&&method==='GET'){
   const origin=new URL(request.url).origin,report=await cachedCheck(env,id);
   return reply({ok:true,title:report.title,revision:report.revision,...report.check,modules:await moduleReport(env,report.check.refs||[],origin)});
  }
  // 3.6.0：换成 Hub 模块链接 / 装上 HTML 卡片。save=new 另存为新首页（默认），save=replace 覆盖当前首页（保留 ID 和分享链接）。
  if((action==='relink'||action==='html')&&method==='POST'){
   const origin=new URL(request.url).origin;let input,form=null;
   if(action==='html'){form=await request.formData();const file=form.get('file');
    input={revision:form.get('revision'),save:form.get('save'),section:form.get('section'),item:form.get('item'),remove:form.get('remove')==='true'};
    if(!input.remove){if(!(file instanceof File)||!/\.html?$/i.test(file.name))fail('请选择 .html 卡片文件');if(file.size>HTML_UPLOAD_LIMIT)fail('HTML 卡片超过 32,768 字节，Rex 会拒绝',413);
     try{input.html=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{fail('HTML 卡片不是 UTF-8 文本');}input.filename=file.name;}}
   else input=await request.json();
   if(!['new','replace',null,undefined,''].includes(input.save))fail('保存方式无效');
   const old=await env.DB.prepare('SELECT '+columns+',bytes FROM home_configs WHERE id=?').bind(id).first();if(!old)fail('首页配置不存在',404);
   if(typeof input.revision!=='string'||input.revision!==old.revision)fail('首页已被修改，请刷新后重试',409);
   const source=parseHomePackage(Buffer.from(old.bytes),old.filename);
   const made=action==='relink'?await relinkHome(env,source.entries,origin,input.widget_ids):attachHtml(source.entries,input);
   const suffix=action==='relink'?'（Hub 链接）':input.remove?'（去掉 HTML 卡片）':'（HTML 卡片）';
   const parsed=parseHomePackage(made.bytes,old.filename),{bytes:_drop,...info}=made;
   return await env.ATOMIC(async()=>{
    if(input.save==='replace'){const fresh=await current(env,id,input.revision);
     if(fresh.hash!==parsed.hash&&await env.DB.prepare('SELECT id FROM home_configs WHERE hash=? AND id<>?').bind(parsed.hash,id).first())fail('相同首页文件已存在，请在原卡片中操作',409);
     const row=record(parsed,{...fresh,revision:crypto.randomUUID(),updated_at:Date.now()});await statement(env,row).run();
     return reply({ok:true,saved:'replace',...info,check:summaryCompat(parsed.check),home:view({...row,has_avatar:!!parsed.avatar,bytes:undefined,avatar_bytes:undefined,avatar_mime:undefined,check_json:undefined})});}
    const titleText=(clean(old.title)+suffix).slice(0,200),home=await createHome(env,parsed,exportName({title:titleText}),titleText);
    return reply({ok:true,saved:'new',...info,check:summaryCompat(parsed.check),home},201);
   });
  }
  if(['file','avatar'].includes(action)&&['GET','HEAD'].includes(method)){
   const row=await env.DB.prepare('SELECT title,hash,'+(action==='avatar'?'avatar_bytes,avatar_mime':'bytes')+' FROM home_configs WHERE id=?').bind(id).first();return row?download(request,row,action==='avatar'):reply({error:'Not found'},404);
  }
  if(!action&&method==='PUT'){
   const {file,form,parsed,converted}=await uploaded(request);return await env.ATOMIC(async()=>{const old=await current(env,id,form.get('revision'));
    const row=record(parsed,{...old,filename:file.name,revision:crypto.randomUUID(),updated_at:Date.now()});await statement(env,row).run();return reply({ok:true,check:summaryCompat(parsed.check),...(converted?{converted_from:'fwd',filled_fields:converted.filled}:{})});});
  }
  if((!action&&['PATCH','DELETE'].includes(method))||(['share','share/revoke','share/rotate'].includes(action)&&method==='POST')){
   const body=await request.json();return await env.ATOMIC(async()=>{const old=await current(env,id,body.revision);
    // 3.6.0：取消分享（旧链接立即失效）/ 换新链接（旧链接作废，生成新的）。已经下载走的副本收不回。
    if(action==='share/revoke'){if(!old.share_key)fail('这个首页还没有分享');await env.DB.prepare('UPDATE home_configs SET share_key=NULL,revision=? WHERE id=?').bind(crypto.randomUUID(),id).run();return reply({ok:true});}
    if(action==='share/rotate'){if(!old.share_key)fail('这个首页还没有分享，请先复制分享链接');const key=newShareKey();await env.DB.prepare('UPDATE home_configs SET share_key=?,revision=? WHERE id=?').bind(key,crypto.randomUUID(),id).run();return reply({ok:true,path:'/api/home-configs/'+key+'.rex'});}
    if(method==='DELETE'){await env.DB.prepare('DELETE FROM home_configs WHERE id=?').bind(id).run();return reply({ok:true});}
    if(method==='PATCH'){await env.DB.prepare('UPDATE home_configs SET title=?,revision=?,updated_at=? WHERE id=?').bind(title(body.title),crypto.randomUUID(),Date.now(),id).run();return reply({ok:true});}
    if(!old.share_key&&body.accept_public!==true)fail('分享将公开原首页文件，请先确认',409);
    const key=old.share_key||newShareKey();
    if(!old.share_key)await env.DB.prepare('UPDATE home_configs SET share_key=?,revision=? WHERE id=?').bind(key,crypto.randomUUID(),id).run();
    return reply({ok:true,path:'/api/home-configs/'+key+'.rex'});
   });
  }
  return reply({error:'Method not allowed'},405);
 }catch(error){if(!error.status&&/SQLITE|database|constraint/i.test(error.message))throw error;return reply({error:error.message},error.status||400);}
}

export async function exportHomes(env){return (await env.DB.prepare('SELECT id,title,filename,size,hash,share_key,created_at,updated_at,bytes FROM home_configs ORDER BY id').all()).results.map(({bytes,...row})=>{bytes=Buffer.from(bytes);if(bytes.length!==row.size||digest(bytes)!==row.hash)fail('首页原文件损坏，已中止导出');return {...row,encoding:'base64',content:bytes.toString('base64')};});}
export async function prepareHomes(data,progress=async()=>{}){
 if(!Array.isArray(data)||data.length>HOME_LIMITS.count)fail('首页备份列表无效');
 const ids=new Set(),shares=new Set(),rows=[];let processed=0;
 if(data.length)await progress({stage:'validating_homes',processed,total:data.length});
 for(const row of data){
  if(!object(row)||!uuid(row.id)||ids.has(row.id))fail('首页备份 ID 无效或重复');ids.add(row.id);
  if(row.share_key!==null&&(!shareKey(row.share_key)||shares.has(row.share_key)))fail('首页分享标识无效或重复');if(row.share_key)shares.add(row.share_key);
  filename(row.filename);title(row.title);if(!Number.isFinite(row.created_at)||row.created_at<0||!Number.isFinite(row.updated_at)||row.updated_at<0)fail('首页备份时间无效');
  if(row.encoding!=='base64')fail('首页备份编码无效');const bytes=decodeBase64(row.content,HOME_LIMITS.file,'首页文件');
  if(row.size!==bytes.length||row.hash!==digest(bytes))fail('首页备份大小或摘要不匹配');
  rows.push(record(parseHomePackage(bytes,row.filename),{id:row.id,title:title(row.title),filename:row.filename,share_key:row.share_key,created_at:row.created_at,updated_at:row.updated_at,revision:crypto.randomUUID()}));
  await progress({stage:'validating_homes',processed:++processed,total:data.length});
 }return rows;
}
export async function validateHomeRestore(env,rows){
 const existing=(await env.DB.prepare('SELECT id,share_key FROM home_configs').all()).results,byId=new Map(existing.map(row=>[row.id,row]));
 if(new Set([...byId.keys(),...rows.map(row=>row.id)]).size>HOME_LIMITS.count)fail('恢复后首页配置超过 200 个');
 const owner=new Map(existing.filter(row=>row.share_key).map(row=>[row.share_key,row.id]));
 for(const row of rows){const old=byId.get(row.id);
  if(old?.share_key&&row.share_key&&old.share_key!==row.share_key)fail('首页分享身份冲突，已中止恢复');
  row.share_key=row.share_key||old?.share_key||null;
  if(row.share_key&&owner.has(row.share_key)&&owner.get(row.share_key)!==row.id)fail('首页分享链接已被其他配置占用');
  if(row.share_key)owner.set(row.share_key,row.id);
 }
}
export async function restoreHomes(env,rows,progress=async()=>{}){if(!rows.length)return;let processed=0;await progress({stage:'writing_homes',processed,total:rows.length});for(const row of rows){await statement(env,row).run();await progress({stage:'writing_homes',processed:++processed,total:rows.length});}}
