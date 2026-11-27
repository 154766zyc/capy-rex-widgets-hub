// 3.5.8：「文件」栏目。保存 PDF / txt / zip 原文件，可分享下载。
// 只按文件头判断类型，从不解压、执行或渲染内容；网页、SVG 等可执行内容一律不收。
import {createHash} from 'node:crypto';
import {decodeBase64} from './binary.js';
import {contentDisposition} from './filenames.js';

export const FILE_LIMITS={file:25*1024*1024,total:100*1024*1024,count:200,name:200};
export const fileSchema=[`CREATE TABLE IF NOT EXISTS hub_files(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL,hash TEXT NOT NULL,
 bytes BLOB NOT NULL,share_key TEXT UNIQUE,note TEXT NOT NULL DEFAULT '',revision TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`];
const TYPES={
 pdf:{ext:'.pdf',mime:'application/pdf',inline:true,label:'PDF'},
 txt:{ext:'.txt',mime:'text/plain; charset=utf-8',inline:true,label:'文本'},
 zip:{ext:'.zip',mime:'application/zip',inline:false,label:'ZIP'}
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const shareKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const newShareKey=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim();

// 文件名：去掉路径和控制字符，最多 200 字，扩展名必须与内容类型一致。
export function fileName(value,kind){
 const name=clean(value).normalize('NFC');
 if(!name||name.length>FILE_LIMITS.name||/[\/\\]/.test(name)||/^\.+$/.test(name))fail('文件名不能为空，最多 200 字，且不能包含 / 或 \\');
 if(kind&&!name.toLowerCase().endsWith(TYPES[kind].ext))fail('文件名必须以 '+TYPES[kind].ext+' 结尾');
 return name;
}

// 按扩展名 + 文件头判断类型。扩展名和内容不一致时拒绝。
export function detectKind(name,input){
 const bytes=Buffer.from(input);
 if(!bytes.length)fail('文件为空');
 if(bytes.length>FILE_LIMITS.file)fail('单个文件不能超过 25 MiB',413);
 const lower=String(name||'').toLowerCase();
 const kind=lower.endsWith('.pdf')?'pdf':lower.endsWith('.txt')?'txt':lower.endsWith('.zip')?'zip':'';
 if(!kind)fail('只支持 PDF、txt 和 zip 文件');
 if(kind==='pdf'){
  // 允许开头有少量空白或 BOM（有些工具会写），但必须在前 1 KB 内出现 %PDF-。
  const at=bytes.subarray(0,1024).indexOf('%PDF-');
  if(at<0||/[^\s﻿ï»¿]/.test(bytes.subarray(0,at).toString('latin1')))fail('不是有效的 PDF 文件');
 }else if(kind==='zip'){
  const sig=bytes.length>=4?bytes.readUInt32LE(0):0;
  if(sig!==0x04034b50&&sig!==0x06054b50)fail('不是有效的 zip 文件');
 }else{
  if(bytes.includes(0))fail('txt 文件包含二进制内容');
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('txt 文件必须是 UTF-8 编码');}
 }
 return kind;
}

const columns='id,name,kind,size,hash,share_key,note,revision,created_at,updated_at';
const view=row=>{const {share_key,...rest}=row;return {...rest,label:TYPES[row.kind]?.label||'',shared:!!share_key,
 share_path:share_key?'/api/files/'+share_key+'/'+encodeURIComponent(row.name):''};};
export async function listFiles(env){
 const rows=(await env.DB.prepare('SELECT '+columns+' FROM hub_files ORDER BY updated_at DESC,id').all()).results||[];
 return {ok:true,files:rows.map(view),total:rows.reduce((n,r)=>n+Number(r.size||0),0),limits:FILE_LIMITS};
}
async function usage(env,exceptId=''){
 const row=await env.DB.prepare('SELECT COUNT(*) n,COALESCE(SUM(size),0) bytes FROM hub_files WHERE id!=?').bind(exceptId).first();
 return {count:Number(row?.n||0),bytes:Number(row?.bytes||0)};
}
async function current(env,id,revision){
 const row=await env.DB.prepare('SELECT '+columns+' FROM hub_files WHERE id=?').bind(id).first();
 if(!row)fail('文件不存在',404);
 if(typeof revision!=='string'||revision!==row.revision)fail('文件已被修改，请刷新后重试',409);
 return row;
}
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

// 安全下载：PDF / txt 在浏览器打开，zip 下载；不让浏览器猜类型；txt 和 zip 禁止任何脚本。
function serve(request,row,publicFile){
 const type=TYPES[row.kind];if(!type||!row.bytes)return reply({error:'文件不存在'},404);
 const bytes=Buffer.from(row.bytes);
 const asked=new URL(request.url).searchParams.get('download')==='1';
 const headers={'Content-Type':type.mime,'Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Content-Disposition':contentDisposition(row.name,asked||!type.inline),
  'Cache-Control':publicFile?'public, max-age=300':'no-store',ETag:'"'+row.hash+'"'};
 if(row.kind!=='pdf')headers['Content-Security-Policy']="default-src 'none'; sandbox";
 if(publicFile)headers['Access-Control-Allow-Origin']='*';
 if(request.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
 return new Response(request.method==='HEAD'?null:bytes,{headers});
}

async function uploaded(request){
 const form=await request.formData(),file=form.get('file');
 if(!file||typeof file.arrayBuffer!=='function'||!file.name)fail('请选择文件');
 if(file.size>FILE_LIMITS.file)fail('单个文件不能超过 25 MiB',413);
 const bytes=Buffer.from(await file.arrayBuffer()),kind=detectKind(file.name,bytes);
 const name=fileName(form.has('name')&&String(form.get('name')).trim()?form.get('name'):file.name,kind);
 return {form,bytes,kind,name,hash:digest(bytes)};
}

export async function fileResponse(env,request,verifyAuth){
 const url=new URL(request.url),path=url.pathname,method=request.method,admin=path.startsWith('/api/admin/files');
 if(!admin&&!path.startsWith('/api/files/'))return null;
 if(admin&&!await verifyAuth(request))return reply({error:'Unauthorized'},401);
 try{
  if(!admin){
   const m=path.match(/^\/api\/files\/([a-f0-9]{64})(?:\/[^/]*)?$/);
   if(!m)return reply({error:'Not found'},404);
   if(!['GET','HEAD'].includes(method))return reply({error:'Method not allowed'},405);
   const row=await env.DB.prepare('SELECT name,kind,hash,bytes FROM hub_files WHERE share_key=?').bind(m[1]).first();
   return row?serve(request,row,true):reply({error:'Not found'},404);
  }
  const root='/api/admin/files';
  if(path===root&&method==='GET')return reply(await listFiles(env));
  if(path===root&&method==='POST'){
   const {bytes,kind,name,hash,form}=await uploaded(request);
   return await env.ATOMIC(async()=>{
    if(await env.DB.prepare('SELECT id FROM hub_files WHERE hash=?').bind(hash).first())fail('相同内容的文件已存在',409);
    const used=await usage(env);
    if(used.count>=FILE_LIMITS.count)fail('最多保存 200 个文件');
    if(used.bytes+bytes.length>FILE_LIMITS.total)fail('文件栏目总大小不能超过 100 MiB，请先删除不用的文件');
    const now=Date.now(),id=crypto.randomUUID();
    const note=clean(form.get('note')).slice(0,500);
    await env.DB.prepare('INSERT INTO hub_files(id,name,kind,size,hash,bytes,share_key,note,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
     .bind(id,name,kind,bytes.length,hash,bytes,null,note,crypto.randomUUID(),now,now).run();
    return reply({ok:true,file:view({id,name,kind,size:bytes.length,hash,share_key:null,note,created_at:now,updated_at:now})},201);
   });
  }
  const m=path.match(/^\/api\/admin\/files\/([a-f0-9-]{36})(?:\/(download|share|unshare))?$/);
  if(!m||!uuid(m[1]))return reply({error:'Not found'},404);
  const [,id,action]=m;
  if(action==='download'&&['GET','HEAD'].includes(method)){
   const row=await env.DB.prepare('SELECT name,kind,hash,bytes FROM hub_files WHERE id=?').bind(id).first();
   return row?serve(request,row,false):reply({error:'文件不存在'},404);
  }
  if(!action&&method==='PUT'){
   // 替换内容：保留 ID、名称（可改）和分享链接。
   const {bytes,kind,name,hash,form}=await uploaded(request);
   return await env.ATOMIC(async()=>{
    const old=await current(env,id,String(form.get('revision')||''));
    const dup=await env.DB.prepare('SELECT id FROM hub_files WHERE hash=? AND id!=?').bind(hash,id).first();
    if(dup)fail('相同内容的文件已存在',409);
    const used=await usage(env,id);
    if(used.bytes+bytes.length>FILE_LIMITS.total)fail('文件栏目总大小不能超过 100 MiB，请先删除不用的文件');
    const keepName=form.has('name')&&String(form.get('name')).trim()?name:(old.kind===kind?old.name:name);
    await env.DB.prepare('UPDATE hub_files SET name=?,kind=?,size=?,hash=?,bytes=?,revision=?,updated_at=? WHERE id=?')
     .bind(fileName(keepName,kind),kind,bytes.length,hash,bytes,crypto.randomUUID(),Date.now(),id).run();
    return reply({ok:true});
   });
  }
  if((!action&&['PATCH','DELETE'].includes(method))||(['share','unshare'].includes(action)&&method==='POST')){
   const body=await request.json().catch(()=>({}));
   return await env.ATOMIC(async()=>{
    const old=await current(env,id,body.revision);
    if(method==='DELETE'){await env.DB.prepare('DELETE FROM hub_files WHERE id=?').bind(id).run();return reply({ok:true});}
    if(method==='PATCH'){
     const name=body.name===undefined?old.name:fileName(body.name,old.kind);
     const note=body.note===undefined?old.note:clean(body.note).slice(0,500);
     await env.DB.prepare('UPDATE hub_files SET name=?,note=?,revision=?,updated_at=? WHERE id=?').bind(name,note,crypto.randomUUID(),Date.now(),id).run();
     return reply({ok:true});
    }
    if(action==='unshare'){
     await env.DB.prepare('UPDATE hub_files SET share_key=NULL,revision=? WHERE id=?').bind(crypto.randomUUID(),id).run();
     return reply({ok:true});
    }
    if(!old.share_key&&body.accept_public!==true)fail('分享后任何拿到链接的人都能下载这个文件，请先确认',409);
    const key=old.share_key||newShareKey();
    if(!old.share_key)await env.DB.prepare('UPDATE hub_files SET share_key=?,revision=? WHERE id=?').bind(key,crypto.randomUUID(),id).run();
    return reply({ok:true,path:'/api/files/'+key+'/'+encodeURIComponent(old.name)});
   });
  }
  return reply({error:'Method not allowed'},405);
 }catch(error){
  if(!error.status&&/SQLITE|database|constraint/i.test(error.message))throw error;
  return reply({error:error.message},error.status||400);
 }
}

// ===== 备份 =====
// 导出：只列出元数据，内容由 backupStream 逐个读取（不一次把所有文件放进内存）。
export async function exportHubFiles(env){
 return (await env.DB.prepare('SELECT id,name,kind,size,hash,share_key,note,created_at,updated_at FROM hub_files ORDER BY id').all()).results||[];
}
export async function loadHubFile(env,row){
 const found=await env.DB.prepare('SELECT bytes,hash FROM hub_files WHERE id=?').bind(row.id).first();
 if(!found||found.hash!==row.hash)throw Error('导出期间文件发生变化：'+row.name+'，请重新导出');
 const bytes=Buffer.from(found.bytes);
 return {...row,encoding:'base64',content:bytes.toString('base64')};
}
// 恢复前校验：解码、核对大小/摘要/类型，然后丢掉字节，写入时再解码。
export async function prepareHubFiles(data){
 if(data===undefined)return [];
 if(!Array.isArray(data)||data.length>FILE_LIMITS.count)fail('文件备份列表无效');
 const ids=new Set(),shares=new Set(),rows=[];let total=0;
 for(const entry of data){
  if(!entry||typeof entry!=='object'||!uuid(entry.id)||ids.has(entry.id))fail('文件备份 ID 无效或重复');ids.add(entry.id);
  if(entry.share_key!==null&&(!shareKey(entry.share_key)||shares.has(entry.share_key)))fail('文件分享标识无效或重复');
  if(entry.share_key)shares.add(entry.share_key);
  if(!TYPES[entry.kind])fail('文件备份类型无效');
  fileName(entry.name,entry.kind);
  if(!Number.isFinite(entry.created_at)||entry.created_at<0||!Number.isFinite(entry.updated_at)||entry.updated_at<0)fail('文件备份时间无效');
  if(entry.encoding!=='base64')fail('文件备份编码无效');
  let bytes=decodeBase64(entry.content,FILE_LIMITS.file,'文件 '+entry.name);
  if(bytes.length!==entry.size||digest(bytes)!==entry.hash)fail('文件备份大小或摘要不匹配：'+entry.name);
  if(detectKind(entry.name,bytes)!==entry.kind)fail('文件备份内容与类型不符：'+entry.name);
  bytes=null;total+=entry.size;
  rows.push({entry,row:{id:entry.id,name:fileName(entry.name,entry.kind),kind:entry.kind,size:entry.size,hash:entry.hash,share_key:entry.share_key||null,
   note:clean(entry.note).slice(0,500),created_at:entry.created_at,updated_at:entry.updated_at}});
 }
 if(total>FILE_LIMITS.total)fail('备份里的文件总大小超过 100 MiB');
 return rows;
}
export async function restoreHubFiles(env,rows){
 if(!rows.length)return;
 const existing=(await env.DB.prepare('SELECT id,size,share_key FROM hub_files').all()).results||[];
 const byId=new Map(existing.map(r=>[r.id,r])),restored=new Set(rows.map(r=>r.row.id));
 const count=new Set([...byId.keys(),...restored]).size;
 const bytes=existing.filter(r=>!restored.has(r.id)).reduce((n,r)=>n+Number(r.size),0)+rows.reduce((n,r)=>n+r.row.size,0);
 if(count>FILE_LIMITS.count)fail('恢复后文件超过 200 个');
 if(bytes>FILE_LIMITS.total)fail('恢复后文件栏目总大小超过 100 MiB');
 const owner=new Map(existing.filter(r=>r.share_key).map(r=>[r.share_key,r.id]));
 for(const {row} of rows){
  const old=byId.get(row.id);
  if(old?.share_key&&row.share_key&&old.share_key!==row.share_key)fail('文件分享身份冲突，已中止恢复');
  row.share_key=row.share_key||old?.share_key||null;
  if(row.share_key&&owner.has(row.share_key)&&owner.get(row.share_key)!==row.id)fail('文件分享链接已被其他文件占用');
  if(row.share_key)owner.set(row.share_key,row.id);
 }
 for(const item of rows){
  const {row,entry}=item;
  let data=decodeBase64(entry.content,FILE_LIMITS.file,'文件 '+row.name);
  if(data.length!==row.size)fail('备份文件在校验后发生变化：'+row.name);
  await env.DB.prepare(`INSERT INTO hub_files(id,name,kind,size,hash,bytes,share_key,note,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,size=excluded.size,hash=excluded.hash,bytes=excluded.bytes,
   share_key=excluded.share_key,note=excluded.note,revision=excluded.revision,created_at=excluded.created_at,updated_at=excluded.updated_at`)
   .bind(row.id,row.name,row.kind,row.size,row.hash,data,row.share_key,row.note,crypto.randomUUID(),row.created_at,row.updated_at).run();
  data=null;entry.content='';
 }
}
