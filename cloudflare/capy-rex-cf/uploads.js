// Upload matching is static inspection only. Never evaluate module code.
import {resolveTitle,cleanTitle,METADATA_SCAN_BYTES,parseModuleMeta} from './metadata.js';
import {filenameSchema,decorateNames,prepareName,nameStatement} from './filenames.js';
import {cleanVersion,nextVersion} from './versions.js';
export const uploadSchema = [
  ...filenameSchema,
  `CREATE TABLE IF NOT EXISTS module_write_locks (id TEXT PRIMARY KEY,token TEXT,expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS upload_jobs (id TEXT PRIMARY KEY,plan TEXT,expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS upload_results (job_id TEXT,item_index INTEGER,result TEXT,
    PRIMARY KEY(job_id,item_index))`,
  `CREATE TABLE IF NOT EXISTS module_previous_versions (module_id TEXT PRIMARY KEY,
    kv_key TEXT NOT NULL,metadata TEXT NOT NULL,created_at INTEGER,expires_at INTEGER)`
];
const WEEK = 7*86400000;
const fields = ['filename','widget_id','metadata_id','title','version','author','file_size',
  'is_encrypted','content_hash','required_version','code_title','generated_filename'];
export const fingerprint = mod => JSON.stringify([...fields,'title_locked','manifest_title','updated_at','source_url','source_managed','manual_override','file_key','name_revision'].map(k=>mod?.[k]??null));
const actualId = mod => mod.metadata_id || (!mod.is_encrypted && mod.widget_id !== mod.id ? mod.widget_id : '') || '';

export function planUploads(files, modules) {
  const rows=files.map((file,index)=>{
    const ids=file.metadata_id ? modules.filter(m=>actualId(m)===file.metadata_id) : [];
    const names=modules.filter(m=>m.filename===file.filename||m.original_filenames?.includes(file.filename));
    const candidates=[...new Map([...ids,...names].map(m=>[m.id,m])).values()];
    let reason='',target=null;
    if(ids.length>1 || names.length>1) reason='已有多个相同 ID 或文件名的模块，请指定目标';
    else if(ids.length && names.length && ids[0].id!==names[0].id) reason='模块 ID 与文件名分别匹配不同模块';
    else if(ids.length) target=ids[0];
    else if(names.length){
      if(file.metadata_id && actualId(names[0]) && file.metadata_id!==actualId(names[0])) reason='文件名相同，但代码内部 ID 不同';
      else target=names[0];
    }
    const identical=target?.content_hash && target.content_hash===file.hash;
    return {...file,index,kind:reason?'conflict':target?(identical?'identical':'replace'):'new',reason,
      matched_by:target?(ids.length?'模块 ID':'完整文件名'):'',
      target:target?{id:target.id,title:target.title,filename:target.filename,effective_filename:target.effective_filename,revision:fingerprint(target),
        subscribed:!!(target.source_managed||target.source_url),manual:!!target.manual_override}:null,
      candidates:candidates.map(m=>({id:m.id,title:m.title,filename:m.filename,effective_filename:m.effective_filename,revision:fingerprint(m),
        subscribed:!!(m.source_managed||m.source_url),manual:!!m.manual_override}))};
  });
  for(const row of rows){
    const duplicates=rows.filter(other=>other!==row &&
      (other.filename===row.filename || (row.metadata_id && other.metadata_id===row.metadata_id) ||
        (row.target && other.target?.id===row.target.id)));
    if(duplicates.length){row.kind='conflict';row.reason='本批次多个文件指向相同模块：请只保留其中一个，其余跳过';}
  }
  return rows;
}

export async function withModuleLock(env,id,work) {
  // Docker has one SQLite connection: the re-entrant gate is the publication
  // lock. Acquire it before any SQL lease to avoid nested lock inversion.
  // All network downloads happen before entering this function.
  if(env.ATOMIC)return env.ATOMIC(work);
  const token=crypto.randomUUID();
  let acquired=false;
  for(let attempt=0;attempt<8;attempt++){
    const now=Date.now();
    const r=await env.DB.prepare(`INSERT INTO module_write_locks (id,token,expires_at) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
      WHERE module_write_locks.expires_at<?`).bind(id,token,now+90000,now).run();
    if(r.meta.changes){acquired=true;break;}
    await new Promise(resolve=>setTimeout(resolve,Math.min(200*2**attempt,2000)));
  }
  if(!acquired) throw new Error('模块正在被其他操作更新，请稍后重试');
  try{return await (env.ATOMIC ? env.ATOMIC(work) : work());}
  finally{await env.DB.prepare('DELETE FROM module_write_locks WHERE id=? AND token=?').bind(id,token).run();}
}

export async function getFileKey(env,id) {
  const row=await env.DB.prepare('SELECT file_key FROM modules WHERE id=?').bind(id).first();
  return row?.file_key || 'file:'+id;
}

function validateFile(buffer,encrypted) {
  if(!buffer.byteLength) throw new Error('文件为空');
  if(encrypted) {
    if(buffer.byteLength<10) throw new Error('加密文件缺少内容');
    return;
  }
  const head=new TextDecoder().decode(buffer.slice(0,32768)).replace(/^\uFEFF/,'').trim();
  if(/^(?:<!doctype\s+html|<html|<head|<body|\{|\[)/i.test(head)) throw new Error('文件看起来是网页或 JSON，不是模块');
  if(!/WidgetMetadata|\bexport\s|\bfunction\b|\b(?:const|let|var)\s/.test(head)) throw new Error('无法识别模块内容');
}

export async function describeFile(file,helpers) {
  if(!/\.js$/i.test(file.name)) throw new Error('只接受 .js 文件');
  if(file.size>25*1024*1024) throw new Error('单个文件不能超过 25 MB');
  const buffer=await file.arrayBuffer();
  const encrypted=helpers.isEncrypted(new Uint8Array(buffer));
  validateFile(buffer,encrypted);
  const meta=encrypted?{}:helpers.parseMeta(file.name,new Uint8Array(buffer.slice(0,METADATA_SCAN_BYTES)));
  const hash=helpers.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)));
  return {buffer,descriptor:{filename:file.name,metadata_id:meta.id||'',title:meta.title||'',
    version:meta.version||'',author:meta.author||'',required_version:meta.requiredVersion||'',
    is_encrypted:encrypted,size:buffer.byteLength,hash}};
}

export async function previewUploads(env,files,groupId,helpers,explicitTarget='') {
  if(!files.length || files.length>45) throw new Error('请选择 1～45 个模块');
  if(files.reduce((n,f)=>n+f.size,0)>50*1024*1024) throw new Error('一批上传总大小不能超过 50 MB，请分批上传');
  const descriptors=[];
  for(const file of files){
    try{descriptors.push((await describeFile(file,helpers)).descriptor);}
    catch(e){descriptors.push({filename:file.name,error:String(e.message||e)});}
  }
  const modules=await decorateNames(env,(await env.DB.prepare('SELECT * FROM modules').all()).results||[]);
  const rows=planUploads(descriptors,modules||[]);
  if(explicitTarget){
    if(rows.length!==1)throw new Error('指定替换只支持一个文件');
    const m=(modules||[]).find(m=>m.id===explicitTarget);if(!m)throw new Error('目标模块不存在');
    const target={id:m.id,title:m.title,filename:m.filename,effective_filename:m.effective_filename,revision:fingerprint(m),
      subscribed:!!(m.source_managed||m.source_url),manual:!!m.manual_override};
    rows[0].target=target;rows[0].candidates=[target];rows[0].kind='replace';rows[0].matched_by='手动指定';rows[0].reason='';
  }
  rows.forEach(r=>{if(r.error){r.kind='invalid';r.reason=r.error;}});
  const reserved=[];
  for(const row of rows){
    if(row.kind==='invalid')continue;
    row.new_id=crypto.randomUUID();
    const target=modules.find(m=>m.id===row.target?.id);
    const n=await prepareName(env,target?.id||row.new_id,target?.filename||row.filename,{existing:!!target,reserved});
    row.effective_filename=n.filename;reserved.push(n.filename);
  }
  const id=crypto.randomUUID(),expires=Date.now()+3600000;
  await env.DB.prepare('INSERT INTO upload_jobs (id,plan,expires_at) VALUES (?,?,?)')
    .bind(id,JSON.stringify({rows,group_id:groupId||''}),expires).run();
  return {ok:true,job_id:id,expires_at:expires,rows};
}

async function backupCurrent(env,mod,existingBuffer) {
  const buffer=existingBuffer||await env.KV.get(mod.file_key||'file:'+mod.id,'arrayBuffer');
  if(!buffer) throw new Error('原模块文件缺失，未执行覆盖');
  const key='upload-backup:'+crypto.randomUUID();
  const created=Date.now(),expires=created+WEEK;
  await env.KV.put(key,buffer,{expirationTtl:WEEK/1000});
  const metadata=Object.fromEntries(fields.map(k=>[k,mod[k]??null]));
  const old=await env.DB.prepare('SELECT kv_key FROM module_previous_versions WHERE module_id=?').bind(mod.id).first();
  return {key,metadata,created,expires,oldKey:old?.kv_key};
}

function versionStatement(env,id,backup) {
  return env.DB.prepare(`INSERT INTO module_previous_versions
    (module_id,kv_key,metadata,created_at,expires_at) VALUES (?,?,?,?,?)
    ON CONFLICT(module_id) DO UPDATE SET kv_key=excluded.kv_key,metadata=excluded.metadata,
    created_at=excluded.created_at,expires_at=excluded.expires_at`)
    .bind(id,backup.key,JSON.stringify(backup.metadata),backup.created,backup.expires);
}

async function cleanupOld(env,mod,backup) {
  // Only obsolete immutable keys. Working legacy keys and source files are never removed here.
  const keys=[backup?.oldKey,mod?.file_key?.startsWith('upload-content:')?mod.file_key:null].filter(Boolean);
  await Promise.all(keys.map(key=>env.KV.delete(key).catch(()=>{})));
}

export async function commitUpload(env,input,helpers) {
  const job=await env.DB.prepare('SELECT * FROM upload_jobs WHERE id=?').bind(input.job_id).first();
  if(!job || job.expires_at<Date.now()) throw new Error('预览已过期，请重新选择文件并预览');
  const plan=JSON.parse(job.plan),row=plan.rows[input.index];
  if(!row || row.index!==input.index) throw new Error('无效的上传项目');
  if(input.action==='skip') return {ok:true,status:'skipped',filename:row.filename};
  if(row.kind==='invalid') throw new Error(row.reason);
  const manualVersion=cleanVersion(input.version);
  const {buffer,descriptor}=await describeFile(input.file,helpers);
  if(descriptor.hash!==row.hash || descriptor.filename!==row.filename) throw new Error('文件已变更，请重新预览');
  return withModuleLock(env,'upload-catalog',async()=>{
    const currentJob=await env.DB.prepare('SELECT plan,expires_at FROM upload_jobs WHERE id=?').bind(input.job_id).first();
    if(!currentJob||currentJob.expires_at<=Date.now()||currentJob.plan!==job.plan)throw new Error('上传预览已失效，请重新预览');
    const previous=await env.DB.prepare('SELECT result FROM upload_results WHERE job_id=? AND item_index=?')
      .bind(input.job_id,input.index).first();
    if(previous) return JSON.parse(previous.result);
    const modules=await decorateNames(env,(await env.DB.prepare('SELECT * FROM modules').all()).results||[]);
    const candidates=[...(row.target?[row.target]:[]),...row.candidates];
    let target=null;
    if(input.action==='replace'){
      const selected=candidates.find(m=>m.id===input.target_id);
      if(!selected) throw new Error('请选择预览中的替换目标');
      target=(modules||[]).find(m=>m.id===selected.id);
      if(!target || fingerprint(target)!==selected.revision) throw new Error('目标模块在预览后发生变化，请重新预览');
    }else if(input.action==='new'){
      const current=planUploads([descriptor],modules||[])[0];
      if(current.kind!=='new') throw new Error('模块库已有匹配项目，请重新预览，未新增重复模块');
    }else throw new Error('无效的上传操作');
    if((target?.source_managed||target?.source_url) && !['temporary','manual'].includes(input.mode)) throw new Error('请明确选择临时替换或转为手动维护');
    const id=target?.id||row.new_id||crypto.randomUUID();
    return withModuleLock(env,'module:'+id,async()=>{
      if(target){
        const fresh=(await decorateNames(env,[(await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first())].filter(Boolean)))[0];
        if(!fresh || fingerprint(fresh)!==fingerprint(target)) throw new Error('目标刚刚被同步更新，请重新预览');
        target=fresh;
      }
      const {results:completed}=await env.DB.prepare('SELECT result FROM upload_results WHERE job_id=?').bind(input.job_id).all();
      if((completed||[]).some(r=>JSON.parse(r.result).module_id===id)) throw new Error('本批次已处理这个目标，请跳过重复文件');
      const oldBuffer=target?await env.KV.get(target.file_key||'file:'+id,'arrayBuffer'):null;
      if(target && !oldBuffer) throw new Error('原模块文件缺失，未执行覆盖');
      const oldHash=oldBuffer?helpers.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',oldBuffer))):'';
      const identical=oldHash===descriptor.hash;
      const linked=!!(target?.source_managed||target?.source_url);
      const mode=linked?(input.mode==='manual'?1:0):(target?.manual_override||0);
      // Keep the accepted playback name on replacements; source names remain matching aliases.
      const naming=await prepareName(env,id,target?.filename||descriptor.filename,{existing:!!target,
        requested:input.filename===undefined?undefined:input.filename});
      naming.originals=JSON.stringify([...new Set([...JSON.parse(naming.originals),descriptor.filename])]);
      const result={ok:true,status:target?(identical?'unchanged':'replaced'):'added',module_id:id,
        filename:descriptor.filename,effective_filename:naming.filename,mode:linked?(mode?'manual':'temporary'):null};
      const statements=[];
      let backup=null,key=null;
      if(target && identical){
        const codeTitle=cleanTitle(descriptor.title)||target.code_title||'';
        // 内容相同：只有手填了版本号才改版本号。
        statements.push(env.DB.prepare('UPDATE modules SET manual_override=?,content_hash=?,code_title=?,title=?,version=?,title_scan_v1=1 WHERE id=?')
          .bind(mode,descriptor.hash,codeTitle,resolveTitle(target,codeTitle,target.manifest_title),manualVersion||target.version||'',id));
      }else{
        if(target) backup=await backupCurrent(env,target,oldBuffer);
        key='upload-content:'+crypto.randomUUID();
        // Immutable write first. The D1 transaction below publishes bytes and metadata together.
        await env.KV.put(key,buffer,{metadata:{u:Date.now(),s:buffer.byteLength}});
        const now=Date.now();
        if(target){
          statements.push(env.DB.prepare(`UPDATE modules SET filename=?,metadata_id=?,title=?,version=?,author=?,
            file_size=?,is_encrypted=?,content_hash=?,required_version=?,manual_override=?,file_key=?,updated_at=?,
            code_title=?,generated_filename=0,title_scan_v1=1 WHERE id=?`)
            .bind(descriptor.filename,descriptor.metadata_id||target.metadata_id||'',resolveTitle(target,descriptor.title,target.manifest_title),
              nextVersion({explicit:manualVersion,fromFile:descriptor.version,prev:target.version,encrypted:descriptor.is_encrypted,changed:true}),
              descriptor.author||target.author,descriptor.size,descriptor.is_encrypted,
              descriptor.hash,descriptor.required_version||target.required_version||'0.0.1',mode,key,now,cleanTitle(descriptor.title),id));
          statements.push(versionStatement(env,id,backup));
        }else{
          const order=await helpers.nextSortOrder(env.DB);
          statements.push(env.DB.prepare(`INSERT INTO modules (id,filename,widget_id,metadata_id,title,version,author,
            file_size,is_encrypted,source_url,note,group_id,sort_order,created_at,updated_at,content_hash,
            required_version,source_managed,manual_override,file_key,code_title,title_scan_v1) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
            .bind(id,descriptor.filename,descriptor.metadata_id||id,descriptor.metadata_id,
              resolveTitle({filename:descriptor.filename,effective_filename:naming.filename},descriptor.title,''),
              nextVersion({explicit:manualVersion,fromFile:descriptor.version}),descriptor.author,
              descriptor.size,descriptor.is_encrypted,null,'',plan.group_id,order,now,now,
              descriptor.hash,descriptor.required_version||'0.0.1',0,0,key,cleanTitle(descriptor.title)));
        }
      }
      statements.push(nameStatement(env,naming));
      statements.push(env.DB.prepare('INSERT INTO upload_results (job_id,item_index,result) VALUES (?,?,?)')
        .bind(input.job_id,input.index,JSON.stringify(result)));
      try{await env.DB.batch(statements);}
      catch(e){if(key)await env.KV.delete(key).catch(()=>{});throw e;}
      if(backup) await cleanupOld(env,target,backup);
      return result;
    });
  });
}

export async function previousVersion(env,id) {
  const row=await env.DB.prepare('SELECT * FROM module_previous_versions WHERE module_id=? AND expires_at>?')
    .bind(id,Date.now()).first();
  if(!row) return null;
  return {created_at:row.created_at,expires_at:row.expires_at,metadata:JSON.parse(row.metadata)};
}

export async function restorePrevious(env,id,revision) {
  return withModuleLock(env,'module:'+id,async()=>{
    const mod=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first();
    if(!mod) throw new Error('模块不存在');
    const row=await env.DB.prepare('SELECT * FROM module_previous_versions WHERE module_id=? AND expires_at>?')
      .bind(id,Date.now()).first();
    if(!row || row.created_at!==revision) throw new Error('备份已过期或发生变化，请重新打开恢复窗口');
    const buffer=await env.KV.get(row.kv_key,'arrayBuffer');
    if(!buffer) throw new Error('备份文件已过期');
    const backup=await backupCurrent(env,mod),meta=JSON.parse(row.metadata);
    const codeTitle=meta.is_encrypted?'':cleanTitle(parseModuleMeta(meta.filename,new Uint8Array(buffer)).title)||cleanTitle(meta.code_title);
    const restoredTitle=resolveTitle({...mod,title:mod.title_locked?mod.title:meta.title},codeTitle,mod.manifest_title);
    const key='upload-content:'+crypto.randomUUID();
    await env.KV.put(key,buffer,{metadata:{u:Date.now(),s:buffer.byteLength}});
    try{
      await env.DB.batch([
        env.DB.prepare(`UPDATE modules SET filename=?,metadata_id=?,title=?,version=?,author=?,file_size=?,
          is_encrypted=?,content_hash=?,required_version=?,file_key=?,updated_at=?,code_title=?,generated_filename=?,title_scan_v1=1 WHERE id=?`)
          .bind(meta.filename,meta.metadata_id||'',restoredTitle,meta.version,meta.author,buffer.byteLength,
            meta.is_encrypted,meta.content_hash||'',meta.required_version||'0.0.1',key,Date.now(),codeTitle,meta.generated_filename?1:0,id),
        versionStatement(env,id,backup)
      ]);
    }catch(e){await env.KV.delete(key).catch(()=>{});throw e;}
    await cleanupOld(env,mod,backup);
    return {ok:true};
  });
}

export async function cleanupUploadJobs(env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM upload_results WHERE job_id IN (SELECT id FROM upload_jobs WHERE expires_at<?)').bind(Date.now()),
    env.DB.prepare('DELETE FROM upload_jobs WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('DELETE FROM module_previous_versions WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('DELETE FROM module_write_locks WHERE expires_at<?').bind(Date.now())
  ]);
}
