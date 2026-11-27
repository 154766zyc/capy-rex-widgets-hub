// Runs on Node (Docker) and in a Cloudflare Durable Object: no static node:sqlite import.
const yieldIO=()=>new Promise(resolve=>setTimeout(resolve,0));
import {prepareBackup,restoreBackup,resetAllData,fullResetPlan} from './backup.js';
import {readBackupBody} from './backup-stream.js';

export const RESTORE_ROOT='/api/admin/backup/restore';
export const restoreRoute=path=>path===RESTORE_ROOT||path===RESTORE_ROOT+'/jobs'||path.startsWith(RESTORE_ROOT+'/jobs/');
const validId=id=>/^[a-zA-Z0-9-]{16,100}$/.test(id||'');
// 3.5.8：merge = 增量合并（默认，按 ID 覆盖）；full = 全量，先清空备份包含的部分再恢复，同一事务内完成。
const MODES=['merge','full'];
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const view=job=>Object.fromEntries(['id','status','stage','mode','processed','total','created_at','updated_at','finished_at','result','error'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]]));

// One writer, but an independent read-only WAL connection for session/status checks.
// Status polling must not queue behind the restoring connection's publication gate.
// `source` is the Docker SQLite filename, or a ready read-only {prepare(sql).get(),close()} reader.
export async function createRestoreJobs(env,source,{parseMeta,isEncrypted}){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS restore_jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,detail TEXT NOT NULL,updated_at INTEGER NOT NULL)`).run();
 const interrupted=(await env.DB.prepare("SELECT detail FROM restore_jobs WHERE status NOT IN ('done','failed','interrupted')").all()).results;
 for(const row of interrupted){const job={...JSON.parse(row.detail),status:'interrupted',stage:'interrupted',error:'服务重启，恢复任务已中断；请确认结果后重新选择备份',updated_at:Date.now(),finished_at:Date.now()};await persist(job);}
 await env.DB.prepare("DELETE FROM restore_jobs WHERE status IN ('done','failed','interrupted') AND id NOT IN (SELECT id FROM restore_jobs ORDER BY updated_at DESC LIMIT 100)").run();
 const reader=typeof source==='string'?new (process.getBuiltinModule('node:sqlite').DatabaseSync)(source,{readOnly:true}):source;
 let current=null,closing=false;
 async function persist(job){await env.DB.prepare('INSERT OR REPLACE INTO restore_jobs(id,status,detail,updated_at) VALUES(?,?,?,?)').bind(job.id,job.status,JSON.stringify(view(job)),job.updated_at).run();}
 function authenticated(headers){const token=(headers.get('Cookie')||'').match(/fwh_admin=([^;]+)/)?.[1];if(!token)return false;return Number(reader.prepare('SELECT expires_at FROM sessions WHERE token=?').get(token)?.expires_at||0)>=Date.now();}
 function stored(id){const row=reader.prepare('SELECT detail FROM restore_jobs WHERE id=?').get(id);return row?JSON.parse(row.detail):null;}
 // 暂存的模块文件：恢复成功时已在事务里删除；失败或中断时在这里删掉（另有 1 小时过期兜底）。
 async function dropStaged(job){const keys=job.stagedKeys||[];job.stagedKeys=[];for(const key of keys)await env.KV.delete(key).catch(()=>{});}
 async function fail(job,error){
  const state=env.SHUTDOWN_SIGNAL?.aborted?'interrupted':'failed';
  Object.assign(job,{status:state,stage:state,error:String(error?.message||error).slice(0,1500),updated_at:Date.now(),finished_at:Date.now()});
  try{await persist(job);}finally{clearTimeout(job.timer);if(current===job)current=null;}
 }
 async function reserve(id,mode='merge'){
  if(!validId(id))return reply({error:'无效的恢复任务编号'},400);
  if(!MODES.includes(mode))return reply({error:'无效的恢复模式'},400);
  if(current?.id===id)return reply({ok:true,job:view(current)});
  const old=stored(id);if(old)return reply({ok:true,job:old});
  if(current)return reply({error:'已有恢复任务正在进行',job:view(current)},409);
  if(closing)return reply({error:'服务正在关闭'},503);
  const now=Date.now(),job={id,status:'uploading',stage:'uploading',mode,processed:0,total:0,created_at:now,updated_at:now,epoch:env.CONTENT_EPOCH||0};current=job;
  try{await persist(job);}catch(e){current=null;throw e;}
  job.timer=setTimeout(()=>{if(current===job&&job.status==='uploading')void fail(job,Error('备份上传超时，请重新选择文件'));},310000);job.timer?.unref?.();
  return reply({ok:true,job:view(job)},201);
 }
 async function run(job,body){
  const progress=async update=>{
   if(env.SHUTDOWN_SIGNAL?.aborted&&job.status!=='writing')throw Error('服务关闭，恢复未提交');
   Object.assign(job,update,{updated_at:Date.now()});
   if(update.processed%16===0)await yieldIO();
  };
  try{
   job.status='validating';job.stage='validating';await persist(job);
   const prepared=await prepareBackup(body,parseMeta,isEncrypted,progress);
   job.stage='waiting';job.updated_at=Date.now();await persist(job);
   const result=await env.ATOMIC(async()=>{
    if(closing||job.epoch!==(env.CONTENT_EPOCH||0))throw Error('数据在上传或校验期间已清空/恢复，请重新选择备份');
    Object.assign(job,{status:'writing',stage:'writing',processed:0,total:prepared.files.size,updated_at:Date.now()});
    if(job.mode==='full')await resetAllData(env,fullResetPlan(body));
    const result={...await restoreBackup(env,body,parseMeta,isEncrypted,prepared,progress),mode:job.mode||'merge'};
    const finished={...view(job),status:'done',stage:'done',result,updated_at:Date.now(),finished_at:Date.now()};
    // This terminal record commits with the restored data, never before it.
    await persist(finished);return finished;
   });
   Object.assign(job,result);
  }catch(e){await fail(job,e);}
  finally{if(current===job)current=null;}
 }
 async function submit(job,request,legacy=false){
  if(job.status!=='uploading')return reply({ok:true,job:view(job)},202);
  clearTimeout(job.timer);job.status='validating';job.stage='reading';job.updated_at=Date.now();
  // 3.5.8：边读边解析，模块文件读完一个就暂存一个（不把整份备份同时放在内存里）。
  let body,count=0;job.stagedKeys=[];
  const stage=async(_id,bytes)=>{const key='restore-stage:'+job.id+':'+(count++);job.stagedKeys.push(key);await env.KV.put(key,bytes,{expirationTtl:3600});return key;};
  try{body=await readBackupBody(request.body,{stage});if(!body||typeof body!=='object'||Array.isArray(body))throw Error('备份不是有效的 JSON 文件');}
  catch(e){await dropStaged(job);await fail(job,Error(e?.status===400&&e.message?e.message:'备份不是有效的 JSON 文件'));return reply({error:job.error,job:view(job)},400);}
  job.task=new Promise(resolve=>setTimeout(()=>{void run(job,body).catch(async e=>{await fail(job,e);}).finally(async()=>{await dropStaged(job);resolve();});},0));
  if(legacy){await job.task;return job.status==='done'?reply(job.result):reply({error:job.error},400);}
  return reply({ok:true,job:view(job)},202);
 }
 return {
  authenticated,
  async handle(request){
   if(!authenticated(request.headers))return reply({error:'Unauthorized'},401);
   const path=new URL(request.url).pathname,method=request.method,tail=path.slice((RESTORE_ROOT+'/jobs/').length);
   if(path===RESTORE_ROOT&&method==='POST'){
    if(current)return reply({error:'已有恢复任务正在进行',job:view(current)},409);
    const response=await reserve(crypto.randomUUID(),new URL(request.url).searchParams.get('mode')||'merge');if(!response.ok)return response;
    return submit(current,request,true);
   }
   if(path===RESTORE_ROOT+'/jobs'&&method==='POST'){
    const body=await request.json().catch(()=>null);return reserve(body?.id,body?.mode===undefined?'merge':body.mode);
   }
   if(path===RESTORE_ROOT+'/jobs/current'&&method==='GET')return reply({ok:true,job:current?view(current):null});
   if(path.startsWith(RESTORE_ROOT+'/jobs/')&&validId(tail)){
    const job=current?.id===tail?current:stored(tail);
    if(!job)return reply({error:'恢复任务不存在'},404);
    if(method==='GET')return reply({ok:true,job:view(job)});
    if(method==='PUT')return submit(job,request);
   }
   return reply({error:'Method not allowed'},405);
  },
  async failedUpload(path,error){if(current?.status==='uploading'&&path===RESTORE_ROOT+'/jobs/'+current.id)await fail(current,error);},
  async close(){closing=true;if(current?.task)await current.task;else if(current)await fail(current,Error('服务关闭，备份上传中断'));reader.close();}
 };
}
