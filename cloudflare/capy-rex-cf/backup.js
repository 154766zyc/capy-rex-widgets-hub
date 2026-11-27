// Versioned, byte-safe backups. IDs, slugs and aliases are identities, not hints.
import { assertFetchableUrl } from './remote.js';
import {shareRows,validateShareBackup} from './sharing.js';
import {exportIcons,validateIconBackup,restoreIcons,validateIcon,ICON_LIMITS} from './icons.js';
import {decodeBase64} from './binary.js';
import {nameRows,namingSettings,validateFilename,nameStatement,safeFilename} from './filenames.js';
import {loadAutoRules,normalizeRules,saveAutoRules} from './auto-rules.js';
import {exportHomes,prepareHomes,validateHomeRestore,restoreHomes} from './home-configs.js';
import {exportHubFiles,loadHubFile,prepareHubFiles,restoreHubFiles} from './files.js';
// A restored/deleted-and-recreated source must not reuse an in-flight epoch.
// Stay below Number.MAX_SAFE_INTEGER, leaving room for SQL generation + 1.
export function sourceGeneration() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0xfffff) * 0x100000000 + words[1];
}
export function moduleStatement(DB, module) {
  const fields = ['id', 'filename', 'widget_id', 'title', 'version', 'author', 'file_size',
    'is_encrypted', 'source_url', 'note', 'sort_order', 'group_id', 'legacy_json', 'created_at', 'updated_at',
    'content_hash','required_version','source_managed','manual_override','file_key','metadata_id',
    'code_title','manifest_title','title_locked','generated_filename','title_scan_v1'];
  return DB.prepare(`INSERT INTO modules (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${fields.slice(1).map(k => k + '=excluded.' + k).join(',')}`)
    .bind(...fields.map(key => module[key] ?? null));
}

export async function syncAutoAll(DB, newIds = null) {
  if (newIds) {
    for (const id of newIds) await DB.prepare(`INSERT OR IGNORE INTO collection_modules (collection_id,module_id,position)
      SELECT c.id, ?, COALESCE((SELECT MAX(position) + 1 FROM collection_modules WHERE collection_id = c.id), 0)
      FROM collections c WHERE c.auto_all = 1`).bind(id).run();
    return;
  }
  await DB.prepare(`INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position)
    SELECT c.id, m.id, COALESCE((SELECT MAX(position) + 1 FROM collection_modules WHERE collection_id = c.id), 0)
      + ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.sort_order, m.created_at DESC)
    FROM collections c CROSS JOIN modules m WHERE c.auto_all = 1`).run();
}

export async function setCollectionSlug(DB, id, slug) {
  const current = await DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first();
  if (!current || current.slug === slug) return;
  const row = await DB.prepare('SELECT id FROM collections WHERE slug = ?').bind(slug).first();
  const alias = await DB.prepare('SELECT collection_id FROM collection_aliases WHERE slug = ?').bind(slug).first();
  if ((row && row.id !== id) || (alias && alias.collection_id !== id)) {
    throw new Error('路径已被其他合集或历史订阅地址占用：' + slug);
  }
  await DB.batch([
    DB.prepare('DELETE FROM collection_aliases WHERE slug = ? AND collection_id = ?').bind(slug, id),
    DB.prepare('INSERT OR REPLACE INTO collection_aliases (slug, collection_id) VALUES (?, ?)').bind(current.slug, id),
    DB.prepare('UPDATE collections SET slug = ? WHERE id = ?').bind(slug, id)
  ]);
}

function identity(value, name) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\/\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('无效的' + name);
  }
  return value;
}
function recordId(value, name) {
  identity(value, name);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('无效的' + name);
  return value;
}
function legacyJSON(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效的兼容元数据');
  return value;
}
// 3.5.6：直接用 Buffer 编码，不再先拼一份同样大小的二进制字符串再 btoa（少一份临时内存，也更快）。
function base64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
// 3.5.6：把整份备份边编码边输出，不再先 JSON.stringify 出一整份字符串。
// 模块文件（files）和图标图片（meta.icons.assets）逐个写出、写完就丢；其余小字段一次序列化。
// 输出与 JSON.stringify(backup) 逐字节一致。
// 3.5.8：文件栏目（meta.hubFiles）同样逐个读取、写出；有 loadHubFile 时才按需从数据库读内容。
export function backupStream(backup) {
  const { files, ...head } = backup, encoder = new TextEncoder();
  const assets = Array.isArray(head.meta?.icons?.assets) ? head.meta.icons.assets : null;
  const hubFiles = Array.isArray(head.meta?.hubFiles) && head.meta.hubFiles.length ? head.meta.hubFiles : null;
  const load = typeof backup.loadHubFile === 'function' ? backup.loadHubFile : row => row;
  const marker = JSON.stringify('__rex_icon_assets_' + crypto.randomUUID() + '__');
  const fileMarker = JSON.stringify('__rex_hub_files_' + crypto.randomUUID() + '__');
  if (assets) head.meta.icons.assets = JSON.parse(marker);
  if (hubFiles) head.meta.hubFiles = JSON.parse(fileMarker);
  const text = JSON.stringify(head);
  if (assets) head.meta.icons.assets = assets;
  if (hubFiles) head.meta.hubFiles = hubFiles;
  // 两个占位符按在文本里出现的顺序展开。
  const slots = [[marker, assets, async v => JSON.stringify(v)], [fileMarker, hubFiles, async v => JSON.stringify(await load(v))]]
    .filter(([, list]) => list).map(slot => [text.indexOf(slot[0]), ...slot]).sort((a, b) => a[0] - b[0]);
  async function* parts() {
    let rest = text.slice(0, -1);
    for (const [, mark, list, encode] of slots) {
      const at = rest.indexOf(mark);
      yield rest.slice(0, at) + '[';
      for (let i = 0; i < list.length; i++) { yield (i ? ',' : '') + await encode(list[i]); list[i] = null; }
      yield ']';
      rest = rest.slice(at + mark.length);
    }
    yield rest + (text === '{}' ? '' : ',') + '"files":{';
    let first = true;
    for (const id of Object.keys(files)) {
      yield (first ? '' : ',') + JSON.stringify(id) + ':' + JSON.stringify(files[id]);
      delete files[id]; first = false;
    }
    yield '}}';
  }
  const it = parts();
  return new ReadableStream({
    async pull(controller) {
      const next = await it.next();
      if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() { await it.return?.(); }
  });
}

// 3.5.8：部分导出。all = 全部；core = 不含首页；homes = 只导出首页配置。
// all = 全部；core = 模块数据（不含首页和文件）；homes = 只首页配置；files = 只文件栏目。
// meta.parts 记录备份包含哪些部分，全量恢复只清空这些部分。
export const BACKUP_SCOPES=['all','core','homes','files'];
const SCOPE_PARTS={all:['core','homes','files'],core:['core'],homes:['homes'],files:['files']};
// 文件栏目内容不提前读进内存，由 backupStream 逐个读取。
function withFileLoader(backup,env){Object.defineProperty(backup,'loadHubFile',{value:row=>loadHubFile(env,row),enumerable:false});return backup;}
export async function exportBackup(env, {scope='all'}={}) {
  if(!BACKUP_SCOPES.includes(scope))throw Error('无效的导出范围');
  const exportedAt=new Date().toISOString();
  if(scope==='homes')return {format:8,scope:'homes',meta:{parts:SCOPE_PARTS.homes,homeConfigs:await exportHomes(env),exportedAt},files:{}};
  if(scope==='files')return withFileLoader({format:8,scope:'files',meta:{parts:SCOPE_PARTS.files,hubFiles:await exportHubFiles(env),exportedAt},files:{}},env);
  const { results: modules } = await env.DB.prepare('SELECT * FROM modules ORDER BY sort_order, created_at DESC').all();
  const { results: cols } = await env.DB.prepare('SELECT * FROM collections ORDER BY created_at DESC').all();
  const { results: groups } = await env.DB.prepare('SELECT * FROM groups ORDER BY position').all();
  const { results: aliases } = await env.DB.prepare('SELECT * FROM collection_aliases').all();
  const { results: sources } = await env.DB.prepare('SELECT * FROM subscription_sources').all();
  const { results: sourceItems } = await env.DB.prepare('SELECT * FROM subscription_items').all();
  const files = Object.create(null);
  for (const m of modules) {
    const bytes = await env.KV.get(m.file_key||'file:'+m.id, 'arrayBuffer');
    if (!bytes) throw new Error('模块文件缺失：' + m.id + '，已中止导出');
    const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
    m.content_hash=hash;
    files[m.id] = { filename: m.filename, encoding: 'base64', size:bytes.byteLength, hash, content: base64(new Uint8Array(bytes)) };
  }
  const collections = [];
  for (const c of cols) {
    const { results } = await env.DB.prepare('SELECT module_id FROM collection_modules WHERE collection_id = ? ORDER BY position').bind(c.id).all();
    collections.push({ ...JSON.parse(c.legacy_json || '{}'), ...c, autoAll: !!c.auto_all, moduleIds: results.map(r => r.module_id) });
  }
  const previousVersions=[];
  const {results:previous}=await env.DB.prepare('SELECT * FROM module_previous_versions WHERE expires_at>?').bind(Date.now()).all();
  for(const row of previous){
    const bytes=await env.KV.get(row.kv_key,'arrayBuffer');
    if(bytes)previousVersions.push({...row,encoding:'base64',size:bytes.byteLength,
      hash:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),content:base64(new Uint8Array(bytes))});
  }
  const homeConfigs=scope==='core'?[]:await exportHomes(env);
  const hubFiles=scope==='core'?[]:await exportHubFiles(env);
  return withFileLoader({ format:homeConfigs.length?8:7, ...(scope==='core'?{scope:'core'}:{}), meta:{parts:SCOPE_PARTS[scope],modules,collections,groups,aliases,shareAliases:await shareRows(env),sources,sourceItems,previousVersions,
    ...(homeConfigs.length?{homeConfigs}:{}),
    ...(scope==='all'?{hubFiles}:{}),
    names:await nameRows(env),filenameSettings:await namingSettings(env),
    icons:await exportIcons(env),enhancements:{autoRules:await loadAutoRules(env),duplicateIgnores:(await env.DB.prepare('SELECT members,created_at FROM duplicate_ignores ORDER BY members').all()).results||[]},exportedAt},files },env);
}

// Pure byte validation deliberately runs before taking the publication gate.
// All identity/alias/source checks below still run against the current DB in the transaction.
export const backupScope=body=>body?.scope===undefined?'all':body.scope;
// 备份里实际包含的部分：全量恢复只清空这些部分。
// 3.5.8 起的备份写了 meta.parts；更早的备份按内容推断（没有首页的旧备份不会清空现有首页）。
// 全量恢复用的清空范围。
export function fullResetPlan(body){
 const parts=backupParts(body);
 return {...parts,keepShares:parts.core&&body?.files&&typeof body.files==='object'?Object.keys(body.files):[]};
}
export function backupParts(body){
 const parts=body?.meta?.parts;
 if(Array.isArray(parts))return {core:parts.includes('core'),homes:parts.includes('homes'),files:parts.includes('files')};
 const scope=backupScope(body);
 return {core:scope==='all'||scope==='core',homes:scope==='homes'||(body?.format===8&&Array.isArray(body?.meta?.homeConfigs)),
  files:scope==='files'||Array.isArray(body?.meta?.hubFiles)};
}
export async function prepareBackup(body,parseMeta,isEncrypted,progress=async()=>{}){
 if(!body||!body.files||typeof body.files!=='object'||Array.isArray(body.files))throw Error('备份缺少模块文件');
 if(body.format!==undefined&&![1,2,3,4,5,6,7,8].includes(body.format))throw Error('不支持的备份版本');
 if(body.scope!==undefined&&!['core','homes','files'].includes(body.scope))throw Error('不支持的备份范围');
 const parts=body.meta?.parts;
 if(parts!==undefined&&(!Array.isArray(parts)||!parts.length||parts.some(p=>!['core','homes','files'].includes(p))||new Set(parts).size!==parts.length||
  JSON.stringify([...parts].sort())!==JSON.stringify([...SCOPE_PARTS[backupScope(body)]].sort())))throw Error('备份范围记录无效');
 if(body.meta?.homeConfigs!==undefined&&body.format!==8)throw Error('包含首页配置的备份必须使用 format 8');
 if(body.scope==='homes'){
  if(body.format!==8||!Array.isArray(body.meta?.homeConfigs))throw Error('首页备份格式无效');
  if(Object.keys(body.files).length)throw Error('首页备份不应包含模块文件');
  return {body,files:new Map(),previous:new Map(),icons:new Map(),homes:await prepareHomes(body.meta.homeConfigs,progress),hubFiles:[]};
 }
 if(body.scope==='files'){
  if(body.format!==8||!Array.isArray(body.meta?.hubFiles))throw Error('文件备份格式无效');
  if(Object.keys(body.files).length||body.meta.homeConfigs!==undefined)throw Error('文件备份不应包含模块或首页');
  return {body,files:new Map(),previous:new Map(),icons:new Map(),homes:[],hubFiles:await prepareHubFiles(body.meta.hubFiles)};
 }
 if(body.scope==='core'&&(body.meta?.homeConfigs!==undefined||body.meta?.hubFiles!==undefined))throw Error('「模块数据」备份不应包含首页或文件');
 const homes=body.format===8?await prepareHomes(body.meta?.homeConfigs,progress):[];
 const meta=body.meta||{};
 for(const key of ['modules','collections','groups','aliases','sources','sourceItems','previousVersions'])if(meta[key]!==undefined&&!Array.isArray(meta[key]))throw Error('无效的备份字段：'+key);
 const filenames=new Map((meta.modules||[]).filter(m=>m&&typeof m==='object').map(m=>[m.id,m.filename]));
 const files=new Map(),previous=new Map(),icons=new Map(),entries=Object.entries(body.files);
 let processed=0;await progress({stage:'validating',processed,total:entries.length});
 for(const [id,file] of entries){
  recordId(id,'模块 ID');if(!file||typeof file.content!=='string'||file.error)throw Error('模块备份不完整：'+id);
  // 3.5.8：边读边解析时已暂存的文件：大小和摘要在读取时算好，只用开头 32 KB 识别元数据。
  if(file.staged){
   const st=file.staged;
   if(file.encoding!=='base64')throw Error('模块备份不完整：'+id);
   if(file.hash!==undefined&&file.hash!==st.hash)throw Error('备份文件摘要不匹配：'+id);
   if(file.size!==undefined&&file.size!==st.size)throw Error('备份文件大小不匹配：'+id);
   files.set(id,{hash:st.hash,size:st.size,parsed:parseMeta(file.filename||filenames.get(id)||'restored.js',st.head),encrypted:isEncrypted(st.head)});
   await progress({stage:'validating',processed:++processed,total:entries.length});
   continue;
  }
  let bytes;
  if(file.encoding==='base64')bytes=decodeBase64(file.content,25*1024*1024,'模块 '+id);
  else{if(file.encoding&&file.encoding!=='text')throw Error('未知文件编码：'+id);bytes=Buffer.from(file.content,'utf8');}
  if(bytes.length>25*1024*1024)throw Error('模块超过 25 MiB：'+id);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  if(file.hash!==undefined&&file.hash!==hash)throw Error('备份文件摘要不匹配：'+id);
  if(file.size!==undefined&&file.size!==bytes.length)throw Error('备份文件大小不匹配：'+id);
  // 3.5.8：校验后不留解码后的字节，写入时再逐个解码（同时只占一份文件的内存）。
  files.set(id,{hash,size:bytes.length,parsed:parseMeta(file.filename||filenames.get(id)||'restored.js',bytes.subarray(0,32768)),encrypted:isEncrypted(bytes)});
  bytes=null;
  await progress({stage:'validating',processed:++processed,total:entries.length});
 }
 if(Array.isArray(body.meta?.previousVersions))for(const row of body.meta.previousVersions){
  if(!row||row.expires_at<=Date.now())continue;
  if(row.encoding!=='base64')throw Error('上一版编码无效');
  const bytes=decodeBase64(row.content,25*1024*1024,'上一版');
  if(row.size!==undefined&&row.size!==bytes.length)throw Error('上一版大小不匹配');
  if(row.hash!==undefined&&row.hash!==Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'))throw Error('上一版摘要不匹配');
  previous.set(row,bytes);
 }
 if(Array.isArray(body.meta?.icons?.assets))for(const a of body.meta.icons.assets){
  if(!a||a.encoding!=='base64')throw Error('图标图片备份编码无效');
  const asset=validateIcon(decodeBase64(a.content,ICON_LIMITS.image,'图标图片'),a.mime);
  if(asset.hash!==a.hash||asset.ext!==a.ext||asset.size!==a.size)throw Error('图标图片校验失败');
  icons.set(a,asset);
 }
 const hubFiles=await prepareHubFiles(body.meta?.hubFiles);
 return {body,files,previous,icons,homes,hubFiles};
}
async function decodeFile(env,id,file){
 if(file.staged){
  const buf=await env.KV.get(file.staged.key,'arrayBuffer');
  if(!buf)throw Error('暂存的备份文件已过期或丢失，请重新恢复：'+id);
  return Buffer.from(buf);
 }
 let bytes;
 if(file.encoding==='base64')bytes=decodeBase64(file.content,25*1024*1024,'模块 '+id);
 else bytes=Buffer.from(file.content,'utf8');
 return bytes;
}

// 3.5.8：只恢复首页配置（「只导出首页」的备份）。
async function restoreHomesOnly(env,prepared,progress){
 await validateHomeRestore(env,prepared.homes);
 env.CONTENT_EPOCH=(env.CONTENT_EPOCH||0)+1;
 await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('content_generation',?)").bind(crypto.randomUUID()).run();
 await restoreHomes(env,prepared.homes,progress);
 return {ok:true,scope:'homes',modules:0,collections:0,home_configs:prepared.homes.length};
}

// 3.5.8：只恢复文件栏目（「只导出文件」的备份）。
async function restoreFilesOnly(env,prepared){
 env.CONTENT_EPOCH=(env.CONTENT_EPOCH||0)+1;
 await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('content_generation',?)").bind(crypto.randomUUID()).run();
 await restoreHubFiles(env,prepared.hubFiles);
 return {ok:true,scope:'files',modules:0,collections:0,hub_files:prepared.hubFiles.length};
}

// 3.5.8：清空数据。core = 模块、合集、订阅、图标、规则、文件栏目；homes = 首页配置。
// 调用方负责放进同一个事务（env.ATOMIC）。管理员密码和登录会话保留。
// keepShares：全量恢复时传入备份里的模块 ID，这些模块的分享名不作废（马上会按备份恢复），其余全部作废。
export async function resetAllData(env,{core=true,homes=true,files=true,keepShares=[]}={}){
 const DB=env.DB;
 env.CONTENT_EPOCH=(env.CONTENT_EPOCH||0)+1;
 await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('content_generation',?)").bind(crypto.randomUUID()).run();
 if(homes)await DB.prepare('DELETE FROM home_configs').run();
 if(files)await DB.prepare('DELETE FROM hub_files').run();
 if(!core)return {removed:0};
 const { results } = await DB.prepare('SELECT id,file_key FROM modules').all();
 const {results:previous}=await DB.prepare('SELECT kv_key FROM module_previous_versions').all();
 for(const row of results||[])if(row.file_key)await env.KV.delete(row.file_key);
 for(const row of previous||[])await env.KV.delete(row.kv_key);
 const ids=(results||[]).map(r=>r.id);
 for(let i=0;i<ids.length;i+=20)await Promise.all(ids.slice(i,i+20).map(id=>env.KV.delete('file:'+id).catch(()=>null)));
 await DB.batch([
  DB.prepare('DELETE FROM module_names'),
  DB.prepare('UPDATE module_share_aliases SET tombstoned=1,is_current=0 WHERE module_id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keepShares)),
  DB.prepare('DELETE FROM source_previews'),
  DB.prepare('DELETE FROM modules'),
  DB.prepare('DELETE FROM collection_modules'),
  DB.prepare('DELETE FROM collection_aliases'),
  DB.prepare('DELETE FROM collections'),
  DB.prepare('DELETE FROM groups'),
  DB.prepare('DELETE FROM subscription_items'),
  DB.prepare('DELETE FROM subscription_sources'),
  DB.prepare('DELETE FROM source_items'),
  DB.prepare('DELETE FROM sources'),
  DB.prepare('DELETE FROM module_previous_versions'),
  DB.prepare('DELETE FROM upload_jobs'),
  DB.prepare('DELETE FROM upload_results'),
  DB.prepare('DELETE FROM duplicate_ignores'),DB.prepare('DELETE FROM auto_rule_seen'),DB.prepare("DELETE FROM settings WHERE key IN ('auto_rules_v1','auto_rules_baseline')"),
  DB.prepare('DELETE FROM icon_entries'),DB.prepare('DELETE FROM icon_sources'),DB.prepare('DELETE FROM icon_assets')
 ]);
 return {removed:ids.length};
}

export async function restoreBackup(env, body, parseMeta, isEncrypted, prepared, progress=async()=>{}) {
 if(!prepared||prepared.body!==body)prepared=await prepareBackup(body,parseMeta,isEncrypted,progress);
 if(body.scope==='homes')return restoreHomesOnly(env,prepared,progress);
 if(body.scope==='files')return restoreFilesOnly(env,prepared);
  const DB = env.DB;
  if (!body || typeof body.files !== 'object' || !body.files || Array.isArray(body.files)) throw new Error('备份缺少模块文件');
  if (body.format !== undefined && ![1, 2, 3, 4, 5, 6, 7, 8].includes(body.format)) throw new Error('不支持的备份版本');
  const { results: existingMods } = await DB.prepare('SELECT * FROM modules').all();
  const { results: existingCols } = await DB.prepare('SELECT * FROM collections').all();
  const { results: existingAliases } = await DB.prepare('SELECT * FROM collection_aliases').all();
  const oldMods = new Map(existingMods.map(m => [m.id, m]));
  // oldMods 在下面会被恢复的新记录覆盖，恢复前的旧记录另存一份供清理旧文件用。
  const oldById = new Map(oldMods);
  const oldCols = new Map(existingCols.map(c => [c.id, c]));
  const slugOwner = new Map([...existingCols.map(c => [c.slug, c.id]), ...existingAliases.map(a => [a.slug, a.collection_id])]);
  const meta = body.meta || {};
  const extra=meta.enhancements;
  if(extra){
    if(!extra.autoRules||!Array.isArray(extra.duplicateIgnores)||extra.duplicateIgnores.length>20000)throw Error('无效的增强功能备份');
    normalizeRules(extra.autoRules);
    for(const row of extra.duplicateIgnores){
      const ids=JSON.parse(row.members);
      if(!Array.isArray(ids)||ids.length<2||ids.length>20000||ids.some(id=>typeof id!=='string'||!id||id.length>100)||JSON.stringify([...new Set(ids)].sort())!==row.members||!Number.isFinite(row.created_at))throw Error('无效的重复忽略记录');
    }
  }
  for (const key of ['modules', 'collections', 'groups', 'aliases', 'sources', 'sourceItems', 'previousVersions']) {
    if (meta[key] !== undefined && !Array.isArray(meta[key])) throw new Error('无效的备份字段：' + key);
  }
  const records = new Map((meta.modules || []).map(m => [recordId(m.id,'模块 ID'), m]));
  if(records.size!==(meta.modules||[]).length)throw new Error('重复的模块 ID');
  const modules = [], files = [], collections = [], groups = [], aliases = [];
  const now = Date.now();
  for (const [rawId, file] of Object.entries(body.files)) {
    const id = recordId(rawId, '模块 ID');
    if (!file || typeof file.content !== 'string' || file.error || file.released) throw new Error('模块备份不完整：' + id);
    const {size,hash,parsed,encrypted}=prepared.files.get(id);
    const old = oldMods.get(id) || {};
    const saved = records.get(id) || {};
    const filename = file.filename || saved.filename || old.filename || 'restored.js';
    const m = { ...old, ...saved, id, filename,
      widget_id: saved.widget_id || parsed.id || old.widget_id || id,
      title: saved.title || parsed.title || old.title || filename.replace(/\.js$/i, ''),
      version: saved.version ?? parsed.version ?? old.version ?? '',
      author: saved.author ?? parsed.author ?? old.author ?? '',
      file_size: size, is_encrypted: (saved.is_encrypted ?? old.is_encrypted ?? encrypted) ? 1 : 0,
      source_url: saved.source_url ?? file.source_url ?? old.source_url ?? null,
      note: saved.note ?? old.note ?? '', group_id: saved.group_id ?? old.group_id ?? '',
      sort_order: saved.sort_order ?? old.sort_order ?? modules.length,
      legacy_json: legacyJSON(saved.legacy_json || old.legacy_json || JSON.stringify(saved)),
      created_at: saved.created_at || old.created_at || now, updated_at: saved.updated_at || now,
      content_hash:hash,file_key:'',
      required_version:saved.required_version||old.required_version||'0.0.1',
      source_managed:saved.source_managed?1:0,manual_override:(saved.manual_override??old.manual_override??(body.format<4||!body.format))?1:0,
      metadata_id:saved.metadata_id||parsed.id||'',code_title:saved.code_title||parsed.title||'',
      manifest_title:saved.manifest_title||'',title_locked:(saved.title_locked??old.title_locked??(body.format<4||!body.format))?1:0,
      generated_filename:saved.generated_filename?1:0,title_scan_v1:1 };
    modules.push(m);
    files.push([id, file, size]);
    oldMods.set(id, m);
  }
  for (const saved of records.values()) if (!oldMods.has(saved.id)) throw new Error('备份缺少文件：' + saved.id);
  for (const g of meta.groups || []) {
    groups.push({ id: recordId(g.id, '分组 ID'), name: String(g.name || ''), position: Number(g.position) || 0, created_at: Number(g.created_at) || now });
  }
  const seen = new Set();
  for (const c of meta.collections || body.collections || []) {
    const id = recordId(c.id || slugOwner.get(c.slug) || crypto.randomUUID(), '合集 ID');
    if (seen.has(id)) throw new Error('备份含重复合集 ID：' + id);
    seen.add(id);
    const old = oldCols.get(id) || {};
    const slug = identity(c.slug || old.slug || id, '合集路径');
    if (slugOwner.has(slug) && slugOwner.get(slug) !== id) throw new Error('合集路径冲突，未覆盖已有地址：' + slug);
    slugOwner.set(slug, id);
    const ids = c.moduleIds?.length ? c.moduleIds : (Array.isArray(c.modules) ? c.modules.map(m => m.id) : c.moduleIds || []);
    if (!Array.isArray(ids) || ids.some(mid => !oldMods.has(mid))) throw new Error('合集引用了不存在的模块：' + slug);
    const collection = { id, slug, title: String(c.title || old.title || 'untitled'),
      description: String(c.description || ''), icon_url: String(c.icon_url || ''),
      auto_all: (c.autoAll ?? c.auto_all ?? old.auto_all) ? 1 : 0,
      legacy_json: legacyJSON(c.legacy_json || old.legacy_json || JSON.stringify(c)),
      created_at: c.created_at || old.created_at || now, updated_at: now,
      moduleIds: [...new Set(ids)] };
    collections.push(collection);
    if (old.slug && old.slug !== slug) aliases.push({ slug: old.slug, collection_id: id });
  }
  for (const a of meta.aliases || []) aliases.push({ slug: identity(a.slug, '历史路径'), collection_id: recordId(a.collection_id, '合集 ID') });
  for (const a of aliases) {
    if (!oldCols.has(a.collection_id) && !seen.has(a.collection_id)) throw new Error('历史地址对应的合集不存在：' + a.slug);
    if (slugOwner.has(a.slug) && slugOwner.get(a.slug) !== a.collection_id) throw new Error('历史路径冲突：' + a.slug);
    slugOwner.set(a.slug, a.collection_id);
  }
  const { results: currentSources } = await DB.prepare('SELECT * FROM subscription_sources').all();
  const sourceIDs = new Set(currentSources.map(s => s.id));
  const sourceURLs = new Map(currentSources.map(s => [s.url, s.id]));
  const sourceByID = new Map(currentSources.map(s => [s.id, s.url]));
  const sources = [], sourceItems = [], seenSources=new Set(), seenItems=new Set();
  for (const raw of meta.sources || []) {
    const s=body.format>=4?raw:legacySource(raw);
    const id = recordId(s.id, '订阅源 ID'), url = assertFetchableUrl(s.url,env.SOURCE_URL_POLICY).href;
    if(seenSources.has(id))throw Error('重复的订阅源 ID');seenSources.add(id);
    if ((sourceURLs.has(url) && sourceURLs.get(url) !== id) || (sourceByID.has(id) && sourceByID.get(id) !== url)) throw new Error('订阅源身份冲突，已中止恢复');
    if(body.format>=7&&(!['collection','module'].includes(s.kind)||![0,1].includes(s.title_locked)))throw Error('订阅类型或标题锁定字段无效');
    sources.push({ ...s, id, url, kind:body.format>=7?s.kind:'collection',title_locked:body.format>=7?s.title_locked:0 }); sourceIDs.add(id); sourceURLs.set(url, id); sourceByID.set(id, url);
  }
  for (const raw of meta.sourceItems || []) {
    const item=body.format>=4?raw:legacyItem(raw);
    if (!sourceIDs.has(item.source_id) || (item.module_id && !oldMods.has(item.module_id))) throw new Error('订阅源引用缺失');
    if (typeof item.remote_id !== 'string' || !item.remote_id) throw new Error('订阅源条目身份无效');
    const key=JSON.stringify([item.source_id,item.remote_id]);
    if(seenItems.has(key))throw Error('重复的订阅源条目');seenItems.add(key);
    const kind=sources.find(s=>s.id===item.source_id)?.kind||currentSources.find(s=>s.id===item.source_id)?.kind;
    if(kind==='module'&&item.remote_id!=='single')throw Error('单模块订阅条目身份无效');
    sourceItems.push({ ...item, url: assertFetchableUrl(item.url,env.SOURCE_URL_POLICY).href });
  }
  const previous=[];
  for(const row of meta.previousVersions||[]){
    if(!oldMods.has(row.module_id))throw new Error('上一版引用缺失');
    if(!Number.isFinite(row.expires_at)||row.expires_at<=now)continue;
    if(row.expires_at>now+7*86400000)throw new Error('上一版保存期不能超过七天');
    const bytes=prepared.previous.get(row);if(!bytes)throw Error('上一版编码无效');
    const metadata=JSON.parse(legacyJSON(row.metadata));
    if(!metadata.filename||typeof metadata.filename!=='string')throw new Error('上一版元数据无效');
    previous.push({...row,bytes,kv_key:'upload-backup:'+crypto.randomUUID()});
  }
  if(body.format>=5&&meta.icons===undefined)throw Error('新版备份缺少图标数据');
  const icons=await validateIconBackup(env,body.format>=5?meta.icons:undefined,collections,sources,prepared.icons);
  const names=[];
  if(body.format>=6){
    if(!Array.isArray(meta.names)||typeof meta.filenameSettings?.auto_clean!=='boolean')throw Error('新版备份缺少文件名配置');
    const restored=new Set(modules.map(m=>m.id)),seenNames=new Set();
    const currentNames=new Map((await nameRows(env)).map(n=>[n.module_id,n]));
    const occupied=new Map(existingMods.filter(m=>!restored.has(m.id)).map(m=>[
      (currentNames.get(m.id)?.filename||safeFilename(m.filename,m.id)).normalize('NFC').toLowerCase(),m.id]));
    for(const n of meta.names){
      if(!n||!restored.has(n.module_id)||seenNames.has(n.module_id))throw Error('文件名记录引用缺失或重复');
      seenNames.add(n.module_id);validateFilename(n.filename);
      const aliases=JSON.parse(n.originals),k=n.filename.normalize('NFC').toLowerCase();
      if(!Array.isArray(aliases)||aliases.length>1000||aliases.some(a=>typeof a!=='string'||a.length>500)||![0,1].includes(n.named_url))throw Error('无效的文件名记录');
      if(occupied.has(k))throw Error('备份文件名与其他模块冲突：'+n.filename);
      occupied.set(k,n.module_id);names.push({...n,revision:crypto.randomUUID()});
    }
  }
  await validateShareBackup(env,body,[...oldMods.values()]);
  await validateHomeRestore(env,prepared.homes);
  // Caller encloses validation and publication in the same SQLite transaction.
  // Invalidate all leases first: pre-restore downloads must never publish later.
  env.CONTENT_EPOCH=(env.CONTENT_EPOCH||0)+1;
  await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('content_generation',?)").bind(crypto.randomUUID()).run();
  await DB.prepare('DELETE FROM source_previews').run();
  await restoreIcons(env,icons);
  await DB.prepare("UPDATE subscription_sources SET lease_token='',lease_until=0").run();
  await DB.batch([DB.prepare('DELETE FROM upload_jobs'),DB.prepare('DELETE FROM upload_results')]);
  // 原来每模块各查一次上一版 kv_key、再各删一次，共 2N 条 SQL；一次查全、一次删完。
  const priors=new Map(((await DB.prepare('SELECT module_id,kv_key FROM module_previous_versions WHERE module_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(modules.map(m=>m.id))).all()).results||[]).map(r=>[r.module_id,r.kv_key]));
  for(const m of modules){
    const old=oldById.get(m.id);
    if(old?.file_key?.startsWith('upload-content:'))await env.KV.delete(old.file_key);
    const priorKey=priors.get(m.id);
    if(priorKey)await env.KV.delete(priorKey);
  }
  await DB.prepare('DELETE FROM module_previous_versions WHERE module_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(modules.map(m=>m.id))).run();
  let written=0;await progress({stage:'writing',processed:0,total:files.length});
  for (const [id, file, size] of files){
    // 逐个解码、写入，写完立即释放这份 base64 文本。
    let bytes=await decodeFile(env,id,file);
    if(bytes.length!==size)throw Error('备份文件在校验后发生变化：'+id);
    await env.KV.put('file:' + id, bytes, { metadata: { u: now, s: bytes.byteLength } });
    if(file.staged)await env.KV.delete(file.staged.key);
    bytes=null;file.content='';file.released=true;
    await progress({stage:'writing',processed:++written,total:files.length});
  }
  await DB.batch(modules.map(m => moduleStatement(DB, m)));
  if(body.format>=6){
    await DB.batch(modules.map(m=>DB.prepare('DELETE FROM module_names WHERE module_id=?').bind(m.id)));
    await DB.batch(names.map(n=>nameStatement(env,n)));
    await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('filename_auto_clean',?)").bind(String(meta.filenameSettings.auto_clean)).run();
  }
  await DB.batch(groups.map(g => DB.prepare(`INSERT INTO groups (id,name,position,created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position`).bind(g.id, g.name, g.position, g.created_at)));
  for (const c of collections) {
    await setCollectionSlug(DB, c.id, c.slug);
    await DB.prepare(`INSERT INTO collections (id,slug,title,description,icon_url,auto_all,legacy_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,
      description=excluded.description,icon_url=excluded.icon_url,auto_all=excluded.auto_all,legacy_json=excluded.legacy_json,updated_at=excluded.updated_at`)
      .bind(c.id, c.slug, c.title, c.description, c.icon_url, c.auto_all, c.legacy_json, c.created_at, now).run();
    await DB.prepare('DELETE FROM collection_modules WHERE collection_id = ?').bind(c.id).run();
    await DB.batch(c.moduleIds.map((mid, i) => DB.prepare('INSERT INTO collection_modules (collection_id,module_id,position) VALUES (?,?,?)').bind(c.id, mid, i)));
  }
  await DB.batch(aliases.map(a => DB.prepare('INSERT OR REPLACE INTO collection_aliases (slug,collection_id) VALUES (?,?)').bind(a.slug, a.collection_id)));
  for(const s of sources){
    await DB.prepare(`INSERT INTO subscription_sources
      (id,url,title,group_id,enabled,status,next_sync_at,last_started_at,last_finished_at,last_error,summary,created_at,kind,title_locked,revision,etag,last_modified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,group_id=excluded.group_id,
      enabled=excluded.enabled,status=excluded.status,next_sync_at=excluded.next_sync_at,last_started_at=excluded.last_started_at,
      last_finished_at=excluded.last_finished_at,last_error=excluded.last_error,summary=excluded.summary,
      kind=excluded.kind,title_locked=excluded.title_locked,revision=excluded.revision,etag='',last_modified='',
      snapshot=NULL,cursor=0,lease_until=0,lease_token=''`)
      .bind(s.id,s.url,String(s.title||''),String(s.group_id||''),s.enabled?1:0,s.enabled?'idle':'paused',now+21600000,
        Number(s.last_started_at)||0,Number(s.last_finished_at)||0,String(s.last_error||''),
        typeof s.summary==='string'?JSON.stringify(JSON.parse(s.summary)):JSON.stringify(s.summary||{}),Number(s.created_at)||now,
        s.kind,s.title_locked,crypto.randomUUID(),'','').run();
    await DB.prepare('DELETE FROM subscription_items WHERE source_id=?').bind(s.id).run();
  }
  for(const item of sourceItems){
    const keys=['source_id','remote_id','module_id','url','title','version','author','description','required_version','active','last_error'];
    await DB.prepare(`INSERT INTO subscription_items (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})
      ON CONFLICT(source_id,remote_id) DO UPDATE SET ${keys.slice(2).map(k=>k+'=excluded.'+k).join(',')}`)
      .bind(...keys.map(k=>item[k]??(k==='active'?1:null))).run();
    if(item.module_id)await DB.prepare('UPDATE modules SET source_managed=1 WHERE id=?').bind(item.module_id).run();
  }
  for(const row of previous){
    const old=await DB.prepare('SELECT kv_key FROM module_previous_versions WHERE module_id=?').bind(row.module_id).first();
    await env.KV.put(row.kv_key,row.bytes,{expiration:Math.ceil(row.expires_at/1000)});
    await DB.prepare('INSERT OR REPLACE INTO module_previous_versions(module_id,kv_key,metadata,created_at,expires_at) VALUES (?,?,?,?,?)')
      .bind(row.module_id,row.kv_key,row.metadata,row.created_at,row.expires_at).run();
    if(old)await env.KV.delete(old.kv_key);
  }
  if(body.format>=7){
    const currentIds=[...new Set(meta.shareAliases.filter(a=>a.is_current).map(a=>a.module_id))];
    if(currentIds.length)await DB.prepare('UPDATE module_share_aliases SET is_current=0 WHERE module_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(currentIds)).run();
    for(const a of meta.shareAliases)await DB.prepare("INSERT INTO module_share_aliases(alias,alias_key,module_id,is_current,tombstoned,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(alias_key) DO UPDATE SET alias=excluded.alias,is_current=excluded.is_current,tombstoned=excluded.tombstoned").bind(a.alias,a.alias_key,a.module_id,a.is_current,a.tombstoned,a.created_at).run();
  }
  // Restoring rules never silently enables background changes or sweeps old modules.
  if(extra){
    await saveAutoRules(env,{...extra.autoRules,auto:false});
    await DB.prepare('INSERT OR IGNORE INTO auto_rule_seen SELECT id FROM modules').run();
    for(const row of extra.duplicateIgnores)await DB.prepare('INSERT OR REPLACE INTO duplicate_ignores VALUES(?,?)').bind(row.members,row.created_at).run();
  }else await DB.prepare('INSERT OR IGNORE INTO auto_rule_seen SELECT id FROM modules').run();
  await restoreHubFiles(env,prepared.hubFiles);
  await restoreHomes(env,prepared.homes,progress);
  return { ok: true, modules: modules.length,...(prepared.hubFiles.length?{hub_files:prepared.hubFiles.length}:{}), collections: collections.length,...(body.format===8?{home_configs:prepared.homes.length}:{}) };
}

function legacySource(s){return {...s,last_started_at:s.last_attempt_at,last_finished_at:s.last_success_at,
  summary:JSON.stringify({added:s.added_count||0,updated:s.updated_count||0,unchanged:s.unchanged_count||0,failed:s.failed_count||0,removed:s.removed_count||0,manual:0})};}
function legacyItem(i){return {...i,remote_id:i.remote_id||(i.remote_key?.startsWith('id:')?i.remote_key.slice(3):i.url),required_version:'0.0.1',active:i.removed_at?0:1};}
