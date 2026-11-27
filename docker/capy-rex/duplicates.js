import {createHash} from 'node:crypto';
import {modulePath,safeFilename,decorateNames} from './filenames.js';
import {resolveTitle} from './metadata.js';
import {deleteModule} from './management.js';
import {fingerprint,previewUploads,commitUpload} from './uploads.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const values=async(db,sql)=>(await db.prepare(sql).all()).results||[];

function groupByModule(rows){
 const map=new Map();
 for(const row of rows){
  if(!map.has(row.module_id))map.set(row.module_id,[]);
  map.get(row.module_id).push(row);
 }
 return map;
}

// Collection manifests fall back to URL as remote_id; single-module sources use
// the constant "single". Neither is evidence of a module identity.
function declaredId(item,module){
 const id=String(item.remote_id||'').trim();
 return item.kind==='collection'&&id&&id!==item.url&&id!==module.id&&!/^[a-z][a-z0-9+.-]*:\/\//i.test(id)?id:'';
}

export async function scanDuplicateModules(env,includeIgnored=false){
 const DB=env.DB;
 const [modules,collectionRows,subscriptionRows,aliasRows]=await Promise.all([
  values(DB,`SELECT m.*,g.name AS group_name,n.filename AS effective_filename,n.named_url,n.revision AS name_revision
    FROM modules m LEFT JOIN groups g ON g.id=m.group_id LEFT JOIN module_names n ON n.module_id=m.id ORDER BY m.id`),
  values(DB,`SELECT cm.module_id,c.id,c.title,c.slug,cm.position,COALESCE(c.auto_all,0) AS auto_all
    FROM collection_modules cm JOIN collections c ON c.id=cm.collection_id ORDER BY cm.module_id,c.id`),
  values(DB,`SELECT i.module_id,i.source_id,i.remote_id,i.url,i.active,s.title,s.enabled,s.kind
    FROM subscription_items i JOIN subscription_sources s ON s.id=i.source_id
    WHERE i.module_id IS NOT NULL ORDER BY i.module_id,i.source_id,i.remote_id`),
  values(DB,`SELECT module_id,alias,is_current FROM module_share_aliases
    WHERE tombstoned=0 ORDER BY module_id,is_current DESC,alias_key`)
 ]);
 const byModule=new Map(modules.map(m=>[m.id,m])),collections=groupByModule(collectionRows);
 const subscriptions=groupByModule(subscriptionRows),aliases=groupByModule(aliasRows);
 const buckets={hash:new Map(),id:new Map(),filename:new Map()};
 function add(type,value,id,basis=''){
  if(!value)return;
  if(!buckets[type].has(value))buckets[type].set(value,new Map());
  buckets[type].get(value).set(id,basis);
 }
 for(const m of modules){
  const hash=String(m.content_hash||'').trim().toLowerCase();
  if(/^[a-f0-9]{64}$/.test(hash))add('hash',hash,m.id);
  const internal=String(m.metadata_id||'').trim();
  if(internal&&!m.is_encrypted)add('id',internal,m.id,'code');
  else for(const item of subscriptions.get(m.id)||[])add('id',declaredId(item,m),m.id,'manifest');
  add('filename',String(m.filename||'').normalize('NFC'),m.id);
 }

 // Collapse only identical member sets. Overlapping groups with different
 // sets stay separate, so filename matches cannot widen a stronger result.
 const groups=[],sets=new Map(),reported=new Set();
 for(const type of ['hash','id','filename'])for(const [value,members] of buckets[type]){
  if(members.size<2)continue;
  const ids=[...members.keys()].sort(),setKey=JSON.stringify(ids);
  const reason={type,value,...(type==='id'?{basis:Object.fromEntries(members)}:{})};
  let group=sets.get(setKey);
  if(!group){group={key:digest([type,value]),module_ids:ids,reasons:[]};sets.set(setKey,group);groups.push(group);}
  group.reasons.push(reason);
  ids.forEach(id=>reported.add(id));
 }
 for(const group of groups){
  group.token=digest([group.module_ids.map(id=>[id,fingerprint(byModule.get(id))]),
   group.reasons.map(r=>[r.type,r.value,r.basis||null])]);
 }
 const entries=[...reported].map(id=>{
  const m=byModule.get(id),cols=collections.get(id)||[],subs=subscriptions.get(id)||[],shares=aliases.get(id)||[];
  const name=m.effective_filename||safeFilename(m.filename,id);
  const paths=[...new Set([modulePath({...m,effective_filename:name}),'/api/modules/'+id+'.js',
   ...shares.map(a=>'/api/modules/'+encodeURIComponent(a.alias))])];
  return {id,title:resolveTitle(m),version:m.version||'',author:m.author||'',filename:m.filename,effective_filename:name,
   encrypted:!!m.is_encrypted,size:m.file_size||0,updated_at:m.updated_at||0,group:m.group_name||'',
   has_source:!!(m.source_url||m.source_managed),has_share_alias:shares.length>0,paths,
   collections:cols.map(c=>({title:c.title,slug:c.slug,automatic:!!c.auto_all})),
   subscriptions:subs.map(s=>({title:s.title,enabled:!!s.enabled,active:!!s.active})),
   may_reimport:subs.some(s=>s.enabled&&s.active),
   revision:digest([fingerprint(m),m.group_id,m.note,cols,subs,shares,paths])};
 });
 const ignored=new Set((await values(DB,'SELECT members FROM duplicate_ignores')).map(r=>r.members));
 const visible=groups.filter(g=>includeIgnored||!ignored.has(JSON.stringify(g.module_ids)));
 const visibleIds=new Set(visible.flatMap(g=>g.module_ids));
 return {groups:visible,modules:entries.filter(m=>visibleIds.has(m.id)),ignored:groups.length-groups.filter(g=>!ignored.has(JSON.stringify(g.module_ids))).length};
}

export async function ignoreDuplicateGroup(env,input){
 if(input?.clear===true){await env.DB.prepare('DELETE FROM duplicate_ignores').run();return {ok:true};}
 const report=await scanDuplicateModules(env,true),group=report.groups.find(g=>g.token===input?.group_token);
 if(!group)throw Error('重复组已变化，请重新扫描');
 await env.DB.prepare('INSERT OR REPLACE INTO duplicate_ignores VALUES(?,?)').bind(JSON.stringify(group.module_ids),Date.now()).run();
 return {ok:true};
}

export async function linkCandidates(env,p){
 if(p.kind!=='module')return {candidates:[],duplicate_token:''};
 // Re-importing an already registered URL remains an ordinary refresh.
 if(await env.DB.prepare('SELECT id FROM subscription_sources WHERE url=?').bind(p.url).first()||await env.DB.prepare('SELECT id FROM modules WHERE source_url=?').bind(p.url).first())return {candidates:[],duplicate_token:''};
 const hash=createHash('sha256').update(new Uint8Array(p.buffer)).digest('hex');
 const modules=await decorateNames(env,(await env.DB.prepare('SELECT * FROM modules').all()).results||[]);
 const candidates=[];
 for(const m of modules){
  const reasons=[];
  if(m.content_hash===hash)reasons.push('内容相同');
  if(p.meta.id&&m.metadata_id===p.meta.id&&!m.is_encrypted)reasons.push('模块 ID 相同');
  if(m.filename===p.meta.source_filename)reasons.push('文件名相同（仅疑似）');
  if(reasons.length)candidates.push({id:m.id,title:resolveTitle(m),filename:m.filename,version:m.version,subscribed:!!(m.source_managed||m.source_url),revision:fingerprint(m),reasons});
 }
 return {candidates,duplicate_token:digest([p.url,hash,candidates])};
}

export async function resolveLinkDuplicate(env,p,body,helpers){
 const result=await linkCandidates(env,p);
 if(!result.candidates.length){
  if(body.duplicate_action==='replace')throw Error('替换目标已变化，请重新预览');
  return null;
 }
 if(!['new','replace'].includes(body.duplicate_action)||body.duplicate_token!==result.duplicate_token){
  const error=Error('发现可能重复的模块，请选择新增、覆盖或取消');error.status=409;Object.assign(error,result);throw error;
 }
 if(body.duplicate_action==='new')return null;
 const target=result.candidates.find(m=>m.id===body.target_id);if(!target)throw Error('请选择预览中的目标模块');
 const file=new File([p.buffer],p.meta.source_filename,{type:'application/javascript'});
 const upload=await previewUploads(env,[file],'',helpers,target.id);
 const saved=await commitUpload(env,{job_id:upload.job_id,index:0,action:'replace',target_id:target.id,mode:body.mode,file},helpers);
 return {ok:true,...saved,message:'已覆盖原模块；保留原 ID、合集引用、分组和更新来源'};
}

export async function deleteScannedDuplicate(env,input){
 const {id,group_token:token,revision}=input||{};
 const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(typeof id!=='string'||!id||id.length>100||!validToken(token)||!validToken(revision))throw Error('请重新扫描后再删除');
 return deleteModule(env,id,async()=>{
  const current=await scanDuplicateModules(env);
  const found=current.modules.find(m=>m.id===id);
  if(!found||found.revision!==revision||!current.groups.some(g=>g.token===token&&g.module_ids.includes(id)))
   throw Error('模块、重复分组或引用已变化，请重新核对后再删除');
 });
}
