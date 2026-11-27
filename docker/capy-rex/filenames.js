// File names are presentation data. Module IDs, metadata IDs and bytes never change here.
import {resolveTitle,titleSource} from './metadata.js';
import {decorateShares} from './sharing.js';
export const filenameSchema = [
  `CREATE TABLE IF NOT EXISTS module_names (module_id TEXT PRIMARY KEY,filename TEXT NOT NULL,
    originals TEXT NOT NULL DEFAULT '[]',named_url INTEGER DEFAULT 0,revision TEXT NOT NULL)`
];
const key = name => name.normalize('NFC').toLowerCase();
const token = id => {
  const raw=String(id);
  if(/^[a-f0-9-]+$/i.test(raw))return raw.replace(/-/g,'').slice(0,8).toLowerCase();
  let hash=2166136261;for(const c of raw)hash=Math.imul(hash^c.codePointAt(0),16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
};
export function safeFilename(value,id='',clean=false) {
  let stem=String(value||'').toWellFormed().normalize('NFC').replace(/\.js$/i,'')
    .replace(/[\/\\<>:"|?*\u0000-\u001f\u007f]/g,'-');
  if(clean)stem=stem.replace(/rex/gi,'').replace(/[\s_-]+/g,'-');
  stem=stem.replace(/^[.\s_-]+|[.\s_-]+$/g,'');
  stem=[...stem].slice(0,150).join('');
  return (stem||'module-'+token(id))+'.js';
}
export function validateFilename(value) {
  if(typeof value!=='string'||!value.trim()||value!==safeFilename(value)||!value.endsWith('.js'))
    throw Error('请填写不含路径或特殊字符、以 .js 结尾的文件名（最长 150 字）');
  return value;
}
export function urlFilename(raw,fallback='module.js') {
  try{const part=new URL(raw).pathname.split('/').pop();return part?decodeURIComponent(part):fallback;}
  catch{return fallback;}
}
export async function namingSettings(env) {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='filename_auto_clean'").first();
  return {auto_clean:row?.value!=='false'};
}
export async function nameRows(env) {
  return (await env.DB.prepare('SELECT * FROM module_names').all()).results||[];
}
function withName(m,n) {
  const result={...m,effective_filename:n?.filename||safeFilename(m.filename,m.id),
    original_filenames:n?JSON.parse(n.originals):[],name_revision:n?.revision||'',named_url:!!n?.named_url};
  return {...result,title:resolveTitle(result),title_source:titleSource(result),public_path:modulePath(result,'js')};
}
export async function decorateNames(env,modules) {
  const names=new Map((await nameRows(env)).map(n=>[n.module_id,n]));
  return decorateShares(env,modules.map(m=>withName(m,names.get(m.id))));
}
// 3.5.6：只装饰给定的几个模块（公开 .rex 用）：文件名和分享别名都只查这些模块的行，不扫全表。结果与 decorateNames 相同。
export async function decorateNamesFor(env,modules) {
  if(!modules.length)return [];
  const ids=JSON.stringify(modules.map(m=>m.id));
  const names=new Map(((await env.DB.prepare('SELECT * FROM module_names WHERE module_id IN (SELECT value FROM json_each(?))').bind(ids).all()).results||[]).map(n=>[n.module_id,n]));
  const aliases=(await env.DB.prepare('SELECT * FROM module_share_aliases WHERE module_id IN (SELECT value FROM json_each(?)) ORDER BY alias_key').bind(ids).all()).results||[];
  return decorateShares(env,modules.map(m=>withName(m,names.get(m.id))),aliases);
}
// 单模块下载只用 effective_filename：只查一行，不扫全表，也不拉分享别名。
export async function decorateNameOne(env,module) {
  const n=await env.DB.prepare('SELECT * FROM module_names WHERE module_id=?').bind(module.id).first();
  return withName(module,n);
}
export function modulePath(m,legacy='raw') {
  if(m.named_url)return '/api/modules/'+m.id+'/file/'+encodeURIComponent(m.effective_filename);
  return '/api/modules/'+m.id+(legacy==='js'?'.js':'/raw');
}
function uniqueName(name,id,occupied) {
  if(!occupied.has(key(name)))return name;
  const suffix='-'+token(id),stem=[...name.slice(0,-3)].slice(0,130).join('');
  let candidate=stem+suffix+'.js',n=2;
  while(occupied.has(key(candidate)))candidate=stem+suffix+'-'+(n++)+'.js';
  return candidate;
}
// Called under the SQLite publication gate. Also used without writes for previews.
export async function prepareName(env,id,original,{requested,existing=false,preferred,reserved=[]}={}) {
  const names=await nameRows(env),old=names.find(n=>n.module_id===id);
  const modules=(await env.DB.prepare('SELECT id,filename FROM modules').all()).results||[];
  const byId=new Map(names.map(n=>[n.module_id,n]));
  const occupied=new Set([...modules.filter(m=>m.id!==id).map(m=>key(byId.get(m.id)?.filename||safeFilename(m.filename,m.id))),...reserved.map(key)]);
  const auto=(await namingSettings(env)).auto_clean;
  const proposed=requested!==undefined?validateFilename(requested):old?.filename||safeFilename(preferred||original,id,!existing&&auto);
  const filename=uniqueName(proposed,id,occupied);
  const originals=[...new Set([...(old?JSON.parse(old.originals):[]),original,preferred].filter(Boolean))];
  return {module_id:id,filename,originals:JSON.stringify(originals),
    named_url:(old?.named_url||filename!==original)?1:0,revision:crypto.randomUUID()};
}
export function nameStatement(env,n) {
  return env.DB.prepare(`INSERT INTO module_names (module_id,filename,originals,named_url,revision) VALUES (?,?,?,?,?)
    ON CONFLICT(module_id) DO UPDATE SET filename=excluded.filename,originals=excluded.originals,
    named_url=excluded.named_url,revision=excluded.revision`)
    .bind(n.module_id,n.filename,n.originals,n.named_url,n.revision);
}
export function contentDisposition(name,attachment=false) {
  const encoded=encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const ascii=name.replace(/[^\x20-\x7e]|["\\]/g,'_');
  return (attachment?'attachment':'inline')+'; filename="'+ascii+'"; filename*=UTF-8\'\''+encoded;
}
export function downloadFilename(mod) {
  const title=resolveTitle({...mod,filename:mod.effective_filename||mod.filename});
  const filename=safeFilename(title,mod.id,true);
  // Only the saved module version is used; never invent one for an encrypted file.
  const version=String(mod.version??'').trim().replace(/^v(?=\d)/i,'')
    .replace(/[\/\\<>:"|?*\u0000-\u001f\u007f]/g,'-').replace(/[\s_-]+/g,'-')
    .replace(/rex/gi,'').replace(/^[.\s_-]+|[.\s_-]+$/g,'').slice(0,40);
  if(!version)return filename;
  const escaped=version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // A title may already end in this exact version, e.g. "Javheo v1.3.2".
  const sameVersion=new RegExp('(?:[-_\\s]+v?|\\(v?|\\[v?)'+escaped+'[)\\]]?$','i');
  const base=filename.slice(0,-3).replace(sameVersion,'')||filename.slice(0,-3);
  const suffix='-v'+version;
  const stem=[...base].slice(0,150-[...suffix].length).join('').replace(/[.\s_-]+$/g,'')||'module-'+token(mod.id);
  return stem+suffix+'.js';
}
function revision(m) {return JSON.stringify([m.filename,m.updated_at,m.file_key,m.content_hash,m.name_revision]);}
export async function scanNames(env) {
  const modules=await decorateNames(env,(await env.DB.prepare('SELECT * FROM modules ORDER BY sort_order,created_at').all()).results||[]);
  const rows=[],reserved=[];
  for(const m of modules){
    if(!/rex/i.test(m.effective_filename.slice(0,-3)))continue;
    const n=await prepareName(env,m.id,m.filename,{requested:safeFilename(m.effective_filename,m.id,true),reserved});
    reserved.push(n.filename);
    rows.push({id:m.id,title:m.title,original:m.filename,current:m.effective_filename,suggested:n.filename,revision:revision(m)});
  }
  return {ok:true,rows};
}
export async function repairNames(env,rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>20)throw Error('请每批选择 1～20 个模块');
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('重复的模块');
  const work=async()=>{
    const modules=await decorateNames(env,(await env.DB.prepare('SELECT * FROM modules').all()).results||[]);
    const statements=[],results=[],reserved=[];
    for(const row of rows){
      const m=modules.find(m=>m.id===row.id);
      if(!m||revision(m)!==row.revision)throw Error('模块在预览后发生变化，请重新扫描');
      const n=await prepareName(env,m.id,m.filename,{requested:row.filename,reserved});
      if(/rex/i.test(n.filename.slice(0,-3)))throw Error('修复后的文件名仍包含 rex：'+n.filename);
      reserved.push(n.filename);statements.push(nameStatement(env,n));
      results.push({id:m.id,filename:n.filename});
    }
    await env.DB.batch(statements);
    return {ok:true,results};
  };
  return env.ATOMIC?env.ATOMIC(work):work();
}
