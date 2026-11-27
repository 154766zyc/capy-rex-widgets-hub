// Stable public aliases, independent of uploaded names and module identities.
import {safeFilename,validateFilename,namingSettings} from './filenames.js';
import {resolveTitle} from './metadata.js';
export const sharingSchema=[
 `CREATE TABLE IF NOT EXISTS module_share_aliases(alias TEXT NOT NULL,alias_key TEXT PRIMARY KEY,
 module_id TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,tombstoned INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS idx_share_current ON module_share_aliases(module_id) WHERE is_current=1 AND tombstoned=0`,
 // 3.5.6：按模块查别名（公开 .rex、单模块分享）走索引。
 `CREATE INDEX IF NOT EXISTS idx_share_module ON module_share_aliases(module_id)`
];
export const aliasKey=value=>value.normalize('NFC').toLowerCase();
export const shareRows=async env=>(await env.DB.prepare('SELECT * FROM module_share_aliases ORDER BY alias_key').all()).results||[];
export function validateAlias(value){validateFilename(value);if(/%[0-9a-f]{2}/i.test(value))throw Error('分享名不能包含编码路径');return value;}
function revision(m,rows){return JSON.stringify([m.id,m.title,m.version,m.updated_at,m.file_key,rows.filter(a=>a.module_id===m.id)]);}
// 3.5.6：别名先按模块分组（保持 alias_key 顺序），每个模块直接查表；原来每个模块都要扫一遍全部别名（模块数 × 别名数）。
// rows 可由调用方传入只属于这些模块的别名（例如公开 .rex 只查合集里的模块）。
export async function decorateShares(env,modules,rows){
 const aliases=rows||await shareRows(env),byModule=new Map();
 for(const a of aliases){const list=byModule.get(a.module_id);if(list)list.push(a);else byModule.set(a.module_id,[a]);}
 return modules.map(m=>{const own=byModule.get(m.id)||[],a=own.find(a=>a.is_current&&!a.tombstoned);
 return {...m,share_alias:a?.alias||'',share_path:a?'/api/modules/'+encodeURIComponent(a.alias):'',share_revision:revision(m,own)};});
}
function reservedIds(modules){return new Set(modules.flatMap(m=>[aliasKey(m.id+'.js'),aliasKey(m.id)]));}
export async function previewShare(env,id,requested){
 const m=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first();if(!m)throw Error('模块不存在');
 const rows=await shareRows(env),modules=(await env.DB.prepare('SELECT id FROM modules').all()).results;
 const current=rows.find(a=>a.module_id===id&&a.is_current&&!a.tombstoned);
 let proposed=requested===undefined?current?.alias:validateAlias(requested);
 if(!proposed){
  // Remove only the exact saved version suffix; arbitrary title digits are meaningful.
  let stem=resolveTitle(m).replace(/\.js$/i,''),v=String(m.version||'').replace(/^v(?=\d)/i,'');
  if(v){const escaped=v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');stem=stem.replace(new RegExp('[-_\\s]+v?'+escaped+'$','i'),'');}
  proposed=safeFilename(stem,id,(await namingSettings(env)).auto_clean);
 }
 validateAlias(proposed);
 const reserved=reservedIds(modules),owners=new Map(rows.map(a=>[a.alias_key,a]));
 const occupied=name=>reserved.has(aliasKey(name))||(owners.has(aliasKey(name))&&(owners.get(aliasKey(name)).module_id!==id||owners.get(aliasKey(name)).tombstoned));
 let alias=proposed,n=1;
 while(occupied(alias)){alias=safeFilename(proposed.slice(0,-3).slice(0,125)+'-'+id.replace(/[^a-z0-9]/gi,'').slice(0,8)+(n++>1?'-'+(n-1):''),id);}
 return {ok:true,alias,requested:proposed,conflict:alias!==proposed,revision:revision(m,rows),path:'/api/modules/'+encodeURIComponent(alias)};
}
export async function saveShare(env,id,body){
 const p=await previewShare(env,id,body.alias);
 if(body.revision!==p.revision)throw Error('模块或分享名已变化，请重新预览');
 if(p.conflict)throw Error('分享名已占用，请确认新的建议：'+p.alias);
 await env.DB.batch([
  env.DB.prepare('UPDATE module_share_aliases SET is_current=0 WHERE module_id=?').bind(id),
  env.DB.prepare(`INSERT INTO module_share_aliases(alias,alias_key,module_id,is_current,tombstoned,created_at) VALUES(?,?,?,1,0,?)
   ON CONFLICT(alias_key) DO UPDATE SET alias=excluded.alias,is_current=1`).bind(p.alias,aliasKey(p.alias),id,Date.now())
 ]);return {...p,revision:(await previewShare(env,id)).revision};
}
export async function resolveAlias(env,encoded){
 let name;try{name=decodeURIComponent(encoded).normalize('NFC');validateAlias(name);}catch{return null;}
 return env.DB.prepare('SELECT module_id,alias FROM module_share_aliases WHERE alias_key=? AND tombstoned=0').bind(aliasKey(name)).first();
}
export async function validateShareBackup(env,body,modules){
 if(!(body.format>=7))return;
 if(!Array.isArray(body.meta.shareAliases))throw Error('新版备份缺少分享别名');
 const owners=new Map((await shareRows(env)).map(a=>[a.alias_key,a])),seen=new Set(),current=new Set(),ids=reservedIds([...modules,...(body.meta.modules||[])]);
 const available=new Set([...modules,...(body.meta.modules||[])].map(m=>m.id));
 for(const a of body.meta.shareAliases){
  validateAlias(a.alias);const key=aliasKey(a.alias),old=owners.get(key);
  if(key!==a.alias_key||seen.has(key)||typeof a.module_id!=='string'||!a.module_id||![0,1].includes(a.is_current)||![0,1].includes(a.tombstoned)||!Number.isFinite(a.created_at))throw Error('分享别名记录无效或重复');
  if((!a.tombstoned&&!available.has(a.module_id))||(a.tombstoned&&a.is_current))throw Error('分享别名引用缺失');
  if(ids.has(key)||(old&&(old.module_id!==a.module_id||old.tombstoned&&!a.tombstoned)))throw Error('分享别名冲突：'+a.alias);
  if(a.is_current){if(current.has(a.module_id))throw Error('同一模块只能有一个当前分享名');current.add(a.module_id);}seen.add(key);
 }
}
