// Icon catalogs and immutable, content-addressed images. No module code executes.
import {createHash} from 'node:crypto';
import {fetchRemote,assertFetchableUrl} from './remote.js';
import {decodeBase64} from './binary.js';

export const ICON_LIMITS={sources:20,entries:2000,manifest:1024*1024,image:2*1024*1024,assets:128*1024*1024};
export const ICON_DAY=86400000;
export const iconSchema=[
  `CREATE TABLE IF NOT EXISTS icon_sources(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,etag TEXT DEFAULT '',last_modified TEXT DEFAULT '',last_attempt_at INTEGER DEFAULT 0,
    last_success_at INTEGER DEFAULT 0,next_sync_at INTEGER DEFAULT 0,last_error TEXT DEFAULT '',failures INTEGER DEFAULT 0,
    lease_token TEXT DEFAULT '',lease_until INTEGER DEFAULT 0,revision TEXT DEFAULT '',created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS icon_entries(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,
    position INTEGER NOT NULL,active INTEGER DEFAULT 1,asset_hash TEXT DEFAULT '',cached_at INTEGER DEFAULT 0,
    UNIQUE(source_id,url))`,
  `CREATE INDEX IF NOT EXISTS idx_icon_entries_source ON icon_entries(source_id,active,position)`,
  `CREATE TABLE IF NOT EXISTS icon_assets(hash TEXT PRIMARY KEY,mime TEXT NOT NULL,ext TEXT NOT NULL,
    size INTEGER NOT NULL,bytes BLOB NOT NULL,created_at INTEGER NOT NULL,last_used_at INTEGER NOT NULL)`
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const iconPath=asset=>'/api/icons/'+asset.hash+'.'+asset.ext;
const atomic=(env,work)=>env.ATOMIC?env.ATOMIC(work):work();
function sourceUrl(env,raw){if(typeof raw!=='string'||raw.length>2048)throw Error('图标地址无效');return (env.SOURCE_URL_POLICY?.assertUrl(raw)||assertFetchableUrl(raw)).href;}
function name(value,fallback=''){if(typeof value!=='string')value=fallback;value=value.trim();if(!value||value.length>200||/[\u0000-\u001f]/.test(value))throw Error('图标名称无效（最多 200 字）');return value;}
export function parseIconManifest(env,bytes){
  if(bytes.length>ICON_LIMITS.manifest)throw Error('图标清单超过 1 MiB');
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('图标清单不是有效 JSON');}
  if(!data||Array.isArray(data)||!Array.isArray(data.icons)||!data.icons.length||data.icons.length>ICON_LIMITS.entries)throw Error('图标清单需包含 1–2000 项 icons 数组');
  const title=name(data.name,'图标集'),seen=new Set(),items=[];
  for(const item of data.icons){if(!item||typeof item!=='object')throw Error('图标条目无效');const url=sourceUrl(env,item.url),label=name(item.name);
    if(!seen.has(url)){seen.add(url);items.push({name:label,url});}}
  return {name:title,items};
}

// Validate containers and dimensions before serving as an image. SVG is excluded.
export function validateIcon(bytes,type=''){
  bytes=Buffer.from(bytes);if(!bytes.length||bytes.length>ICON_LIMITS.image)throw Error('图片为空或超过 2 MiB');
  let mime,ext,width=0,height=0;
  if(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('PNG 结构无效');
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);let offset=8,ended=false,hasData=false;
    while(offset+12<=bytes.length){const len=bytes.readUInt32BE(offset);if(len>bytes.length-offset-12)throw Error('PNG 数据不完整');const chunk=bytes.toString('ascii',offset+4,offset+8);
      if(chunk==='IDAT'&&len)hasData=true;offset+=len+12;if(chunk==='IEND'){if(len!==0||offset!==bytes.length)throw Error('PNG 结束标记无效');ended=true;break;}}
    if(!ended||!hasData)throw Error('PNG 数据不完整');mime='image/png';ext='png';
  }else if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
    let p=2;while(p+4<bytes.length){if(bytes[p++]!==255)break;let marker=bytes[p++];while(marker===255)marker=bytes[p++];if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;const len=bytes.readUInt16BE(p);if(len<2||p+len>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&len>=8){height=bytes.readUInt16BE(p+3);width=bytes.readUInt16BE(p+5);break;}p+=len;}
    mime='image/jpeg';ext='jpg';
  }else if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)===bytes.length-8){
    const chunk=bytes.toString('ascii',12,16);if(chunk==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    else if(chunk==='VP8L'&&bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
    else if(chunk==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
    mime='image/webp';ext='webp';
  }
  const declared=type.split(';')[0].trim().toLowerCase().replace('image/jpg','image/jpeg');
  if(!mime||!width||!height||width>8192||height>8192||width*height>16777216)throw Error('仅支持有效的 PNG/JPEG/WebP 图片（最多 1600 万像素）');
  if(declared&&declared!=='application/octet-stream'&&declared!==mime)throw Error('图片内容与 Content-Type 不匹配');
  return {hash:hash(bytes),mime,ext,size:bytes.length,bytes};
}

const runtime=new WeakMap();
function state(env){if(!runtime.has(env))runtime.set(env,{sync:new Map(),cache:new Map(),active:0,waiting:[]});return runtime.get(env);}
async function limited(env,work){const s=state(env);if(s.active>=3)await new Promise(r=>s.waiting.push(r));else s.active++;
  try{env.SHUTDOWN_SIGNAL?.throwIfAborted();return await work();}finally{const next=s.waiting.shift();if(next)next();else s.active--;}}
async function remote(env,url,max,options={}){return fetchRemote(url,max,{...options,signal:env.SHUTDOWN_SIGNAL,transport:env.REMOTE_FETCH||fetch,assertUrl:raw=>new URL(sourceUrl(env,raw))});}
export async function listIconSources(env){return (await env.DB.prepare(`SELECT s.*,COUNT(e.id) AS count FROM icon_sources s
  LEFT JOIN icon_entries e ON e.source_id=s.id AND e.active=1 GROUP BY s.id ORDER BY s.created_at,s.id`).all()).results.map(({lease_token,...s})=>({...s,syncing:s.lease_until>Date.now()}));}
export async function addIconSource(env,body){const url=sourceUrl(env,body.url);const id=crypto.randomUUID(),now=Date.now();
  await atomic(env,async()=>{if((await env.DB.prepare('SELECT COUNT(*) AS n FROM icon_sources').first()).n>=ICON_LIMITS.sources)throw Error('最多支持 20 个图标源');
    const existing=await env.DB.prepare('SELECT id FROM icon_sources WHERE url=?').bind(url).first();if(existing)throw Error('该图标源已存在');
    await env.DB.prepare('INSERT INTO icon_sources(id,url,name,created_at,next_sync_at) VALUES(?,?,?,?,?)').bind(id,url,name(body.name,'图标集'),now,now).run();});
  const result=await refreshIconSource(env,id);return {ok:true,id,...result};
}
export async function changeIconSource(env,id,body){return atomic(env,async()=>{
  const s=await env.DB.prepare('SELECT * FROM icon_sources WHERE id=?').bind(id).first();if(!s)throw Error('图标源不存在');
  if(body.url!==undefined&&sourceUrl(env,body.url)!==s.url)throw Error('修改链接请新建图标源，以保留原图标身份');
  if(body.enabled!==undefined&&typeof body.enabled!=='boolean')throw Error('enabled 必须是布尔值');
  await env.DB.prepare("UPDATE icon_sources SET name=?,enabled=?,lease_token='',lease_until=0,next_sync_at=? WHERE id=?")
    .bind(body.name===undefined?s.name:name(body.name),body.enabled===undefined?s.enabled:Number(body.enabled),Date.now(),id).run();return {ok:true};});}
export async function deleteIconSource(env,id){return atomic(env,async()=>{await env.DB.batch([
  env.DB.prepare('DELETE FROM icon_entries WHERE source_id=?').bind(id),env.DB.prepare('DELETE FROM icon_sources WHERE id=?').bind(id)]);return {ok:true};});}
export function refreshIconSource(env,id){const jobs=state(env).sync;if(jobs.has(id))return jobs.get(id);
  const job=doRefresh(env,id).finally(()=>jobs.delete(id));jobs.set(id,job);return job;}
async function doRefresh(env,id){const now=Date.now(),token=crypto.randomUUID(),epoch=env.CONTENT_EPOCH||0;
  const s=await atomic(env,async()=>{const row=await env.DB.prepare('SELECT * FROM icon_sources WHERE id=?').bind(id).first();if(!row)throw Error('图标源不存在');
    if(row.lease_until>now)throw Error('图标源正在同步，请稍后重试');await env.DB.prepare('UPDATE icon_sources SET lease_token=?,lease_until=?,last_attempt_at=? WHERE id=?').bind(token,now+60000,now,id).run();return row;});
  try{
    const headers={};if(s.last_success_at){if(s.etag)headers['If-None-Match']=s.etag;if(s.last_modified)headers['If-Modified-Since']=s.last_modified;}
    const response=await remote(env,s.url,ICON_LIMITS.manifest,{headers,allowNotModified:!!s.last_success_at});
    const parsed=response.status===304?null:parseIconManifest(env,response.bytes);
    return await atomic(env,async()=>{
      const current=await env.DB.prepare('SELECT lease_token FROM icon_sources WHERE id=?').bind(id).first();if(current?.lease_token!==token||epoch!==(env.CONTENT_EPOCH||0))throw Error('图标同步已被取消');
      if(parsed){await env.DB.prepare("UPDATE icon_entries SET active=0 WHERE source_id=?").bind(id).run();
        await env.DB.batch(parsed.items.map((item,i)=>env.DB.prepare(`INSERT INTO icon_entries(id,source_id,url,name,position,active) VALUES(?,?,?,?,?,1)
          ON CONFLICT(source_id,url) DO UPDATE SET name=excluded.name,position=excluded.position,active=1`)
          .bind(hash(id+'\0'+item.url),id,item.url,item.name,i)));}
      if(parsed)await env.DB.prepare('DELETE FROM icon_entries WHERE source_id=? AND active=0').bind(id).run();
      // A source refresh invalidates only browse caches; pinned collection URLs stay immutable.
      await env.DB.prepare("UPDATE icon_entries SET asset_hash='',cached_at=0 WHERE source_id=?").bind(id).run();
      await env.DB.prepare(`UPDATE icon_sources SET etag=?,last_modified=?,last_success_at=?,next_sync_at=?,
        last_error='',failures=0,lease_token='',lease_until=0,revision=? WHERE id=?`).bind(response.etag||(parsed?'':s.etag),response.lastModified||(parsed?'':s.last_modified),Date.now(),Date.now()+ICON_DAY,token,id).run();
      const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM icon_entries WHERE source_id=? AND active=1').bind(id).first()).n;
      // Preserve administrator-defined names; fill the default from the manifest only.
      if(parsed&&s.name==='图标集')await env.DB.prepare('UPDATE icon_sources SET name=? WHERE id=?').bind(parsed.name,id).run();
      return {synced:true,count,notModified:response.status===304};});
  }catch(error){await atomic(env,()=>env.DB.prepare(`UPDATE icon_sources SET last_error=?,failures=failures+1,
    next_sync_at=?,lease_token='',lease_until=0 WHERE id=? AND lease_token=?`).bind(String(error.message).slice(0,500),Date.now()+Math.min(ICON_DAY,300000*2**Math.min(s.failures,8)),id,token).run());
    return {synced:false,error:error.message};}
}

const aliases={'蓝色':'blue','绿色':'green','紫色':'purple','红色':'red','橙色':'orange','黄色':'yellow','黑色':'black','白色':'white','彩虹':'rainbow'};
export async function queryIcons(env,params){let q=String(params.get('q')||'').slice(0,200).trim().toLowerCase();for(const [key,value] of Object.entries(aliases))q=q.replaceAll(key,value);
  const source=params.get('source')||'',page=Math.max(1,Math.min(2000,Number(params.get('page'))||1))|0;
  const preview=!!source&&params.get('preview')==='1';
  const requested=Number(params.get('size'));
  const size=preview&&Number.isInteger(requested)&&requested>0?Math.min(60,requested):12;
  const where=(preview?'':'s.enabled=1 AND ')+"e.active=1 AND (?='' OR e.source_id=?) AND (?='' OR instr(lower(e.name),?)>0)";
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM icon_entries e JOIN icon_sources s ON s.id=e.source_id WHERE '+where).bind(source,source,q,q).first();
  const result=(await env.DB.prepare('SELECT e.*,s.name AS source_name,a.ext FROM icon_entries e JOIN icon_sources s ON s.id=e.source_id LEFT JOIN icon_assets a ON a.hash=e.asset_hash WHERE '+where+' ORDER BY s.created_at,s.id,e.position,e.id LIMIT ? OFFSET ?').bind(source,source,q,q,size,(page-1)*size).all()).results;
  const cached=result.filter(e=>e.ext);
  if(!preview&&cached.length)await env.DB.prepare('UPDATE icon_assets SET last_used_at=? WHERE hash IN (SELECT value FROM json_each(?))').bind(Date.now(),JSON.stringify(cached.map(e=>e.asset_hash))).run();
  return {total:count.n,page,pages:Math.max(1,Math.ceil(count.n/size)),items:result.map(e=>({...e,preview_url:e.ext?iconPath({hash:e.asset_hash,ext:e.ext}):''}))};
}
export async function cleanupIcons(env,needed=0){return atomic(env,async()=>{
  const rows=(await env.DB.prepare(`SELECT a.hash,a.size,a.last_used_at FROM icon_assets a WHERE NOT EXISTS
    (SELECT 1 FROM collections c WHERE c.icon_url='/api/icons/'||a.hash||'.'||a.ext) AND NOT EXISTS (SELECT 1 FROM subscription_sources s WHERE json_extract(CASE WHEN json_valid(s.summary) THEN s.summary ELSE '{}' END,'$.custom_icon_url')='/api/icons/'||a.hash||'.'||a.ext) ORDER BY a.last_used_at`).all()).results;
  let total=(await env.DB.prepare('SELECT COALESCE(SUM(size),0) AS n FROM icon_assets').first()).n;
  for(const row of rows){if(total+needed<=ICON_LIMITS.assets&&row.last_used_at>Date.now()-30*ICON_DAY)continue;
    await env.DB.prepare('DELETE FROM icon_assets WHERE hash=?').bind(row.hash).run();await env.DB.prepare("UPDATE icon_entries SET asset_hash='',cached_at=0 WHERE asset_hash=?").bind(row.hash).run();total-=row.size;}
  if(total+needed>ICON_LIMITS.assets)throw Error('图标缓存已满（128 MiB），不会删除合集或订阅正在使用的图片');return total;});}
async function storeAsset(env,asset){const exists=await env.DB.prepare('SELECT hash FROM icon_assets WHERE hash=?').bind(asset.hash).first();await cleanupIcons(env,exists?0:asset.size);const now=Date.now();await env.DB.prepare(`INSERT INTO icon_assets(hash,mime,ext,size,bytes,created_at,last_used_at) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(hash) DO UPDATE SET last_used_at=excluded.last_used_at`).bind(asset.hash,asset.mime,asset.ext,asset.size,asset.bytes,now,now).run();return asset;}
// 3.5.8：直接上传图片作图标（PNG / JPEG / WebP，最多 2 MiB）。保存到本站，返回 /api/icons/… 地址。
export async function uploadIcon(env,bytes,type=''){
  const asset=validateIcon(bytes,type);
  return atomic(env,async()=>{await storeAsset(env,asset);return {url:iconPath(asset),hash:asset.hash,ext:asset.ext,size:asset.size};});
}
export async function cacheIcon(env,id){const jobs=state(env).cache,key='entry:'+id;if(jobs.has(key))return jobs.get(key);
  const job=limited(env,async()=>{
    const e=await env.DB.prepare('SELECT e.*,s.revision AS source_revision FROM icon_entries e JOIN icon_sources s ON s.id=e.source_id WHERE e.id=? AND e.active=1 AND s.enabled=1').bind(id).first();if(!e)throw Error('图标已下架或图标源已停用');
    const cached=e.asset_hash&&await env.DB.prepare('SELECT hash,mime,ext,size FROM icon_assets WHERE hash=?').bind(e.asset_hash).first();if(cached)return {...cached,url:iconPath(cached)};
    const epoch=env.CONTENT_EPOCH||0,response=await remote(env,e.url,ICON_LIMITS.image),asset=validateIcon(response.bytes,response.contentType);
    return atomic(env,async()=>{const current=await env.DB.prepare(`SELECT e.*,s.revision AS source_revision FROM icon_entries e JOIN icon_sources s ON s.id=e.source_id
      WHERE e.id=? AND e.active=1 AND s.enabled=1`).bind(id).first();if(!current||current.source_revision!==e.source_revision||epoch!==(env.CONTENT_EPOCH||0))throw Error('图标下载已被取消，请重新选择');
      await storeAsset(env,asset);await env.DB.prepare('UPDATE icon_entries SET asset_hash=?,cached_at=? WHERE id=?').bind(asset.hash,Date.now(),id).run();return {hash:asset.hash,mime:asset.mime,ext:asset.ext,url:iconPath(asset)};});
  }).finally(()=>jobs.delete(key));jobs.set(key,job);return job;
}
export async function prepareCollectionIcon(env,body,current){
  const hasEntry=Object.hasOwn(body,'icon_entry_id'),hasUrl=Object.hasOwn(body,'icon_url');if(!hasEntry&&!hasUrl)return null;
  if(hasEntry&&body.icon_entry_id){if(typeof body.icon_entry_id!=='string'||(hasUrl&&body.icon_url))throw Error('请只选择图标库或图片 URL 中的一种');return {url:(await cacheIcon(env,body.icon_entry_id)).url};}
  if(hasEntry&&!hasUrl){if(body.icon_entry_id!==null&&body.icon_entry_id!=='')throw Error('图标选择无效');return {url:''};}
  if(typeof body.icon_url!=='string')throw Error('图标 URL 无效');const url=body.icon_url.trim();if(!url)return {url:''};
  if(url===current?.icon_url)return null; // A metadata-only edit never migrates old external icons.
  const local=url.match(/^\/api\/icons\/([a-f0-9]{64})\.(png|jpg|webp)$/);if(local){const row=await env.DB.prepare('SELECT hash FROM icon_assets WHERE hash=? AND ext=?').bind(local[1],local[2]).first();if(!row)throw Error('缓存图标不存在');return {url};}
  sourceUrl(env,url);const epoch=env.CONTENT_EPOCH||0;const response=await limited(env,()=>remote(env,url,ICON_LIMITS.image)),asset=validateIcon(response.bytes,response.contentType);
  return atomic(env,async()=>{if(epoch!==(env.CONTENT_EPOCH||0))throw Error('图标下载已被取消');await storeAsset(env,asset);return {url:iconPath(asset)};});
}
export async function iconTick(env){const row=await env.DB.prepare('SELECT id FROM icon_sources WHERE enabled=1 AND next_sync_at<=? AND lease_until<? ORDER BY next_sync_at LIMIT 1').bind(Date.now(),Date.now()).first();
  if(row)await refreshIconSource(env,row.id);
  // 3.6.0：日常清理最多 6 小时一次（只清 30 天没用过的图）；存新图时仍会先按需清理腾空间。
  const last=ICON_SWEEP.get(env.DB)||0;if(row||Date.now()-last>=6*60*60*1000){ICON_SWEEP.set(env.DB,Date.now());await cleanupIcons(env);}}
const ICON_SWEEP=new WeakMap();
export async function iconResponse(env,path,request){const match=path.match(/^\/api\/icons\/([a-f0-9]{64})\.(png|jpg|webp)$/);if(!match)return new Response('Not found',{status:404});
  // 3.5.6：先只读元数据；304 和 HEAD 不再把整张图片（可能是分片的大 BLOB）读出来。
  const asset=await env.DB.prepare('SELECT hash,ext,mime,size FROM icon_assets WHERE hash=? AND ext=?').bind(match[1],match[2]).first();if(!asset)return new Response('Not found',{status:404});
  const headers={'Content-Type':asset.mime,'Content-Length':String(asset.size),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*',ETag:'"'+asset.hash+'"'};
  if(request.headers.get('if-none-match')===headers.ETag)return new Response(null,{status:304,headers});
  if(request.method==='HEAD')return new Response(null,{headers});
  const body=await env.DB.prepare('SELECT bytes FROM icon_assets WHERE hash=? AND ext=?').bind(match[1],match[2]).first();if(!body)return new Response('Not found',{status:404});
  return new Response(body.bytes,{headers});}

export async function assertStoredIcon(env,url){if(!url?.startsWith('/api/icons/'))return;const row=await env.DB.prepare("SELECT hash FROM icon_assets WHERE '/api/icons/'||hash||'.'||ext=?").bind(url).first();if(!row)throw Error('图片缓存已被回收，请重新选择图标');
  await env.DB.prepare('UPDATE icon_assets SET last_used_at=? WHERE hash=?').bind(Date.now(),row.hash).run();}
export async function exportIcons(env){const sources=(await env.DB.prepare('SELECT * FROM icon_sources').all()).results.map(({lease_token,lease_until,...s})=>s);
  const entries=(await env.DB.prepare('SELECT * FROM icon_entries').all()).results;
  // 3.5.6：一张一张读、一张一张编码：原来一次把全部图片字节读进内存再全部转 base64，峰值是两份。
  const assets=[];
  for(const {hash,ext} of (await env.DB.prepare('SELECT hash,ext FROM icon_assets ORDER BY rowid').all()).results){
    const row=await env.DB.prepare('SELECT * FROM icon_assets WHERE hash=? AND ext=?').bind(hash,ext).first();if(!row)continue;
    const {bytes,...a}=row;assets.push({...a,encoding:'base64',content:Buffer.from(bytes).toString('base64')});}
  return {sources,entries,assets};}
export async function validateIconBackup(env,data,collections,sources=[],prepared=new Map()){
  const plan={sources:[],entries:[],assets:[]};if(data===undefined)data=plan;
  if(!data||!['sources','entries','assets'].every(k=>Array.isArray(data[k])))throw Error('图标备份字段无效');
  if(data.sources.length>ICON_LIMITS.sources||data.entries.length>ICON_LIMITS.sources*ICON_LIMITS.entries)throw Error('图标备份条目过多');
  const existing=(await env.DB.prepare('SELECT id,url FROM icon_sources').all()).results;
  const sourceIDs=new Map(existing.map(s=>[s.id,s.url])),urls=new Map(existing.map(s=>[s.url,s.id])),seen=new Set();
  for(const s of data.sources){if(!s||typeof s.id!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(s.id)||seen.has(s.id))throw Error('图标源身份无效');seen.add(s.id);
    const url=sourceUrl(env,s.url);if((sourceIDs.has(s.id)&&sourceIDs.get(s.id)!==url)||(urls.has(url)&&urls.get(url)!==s.id))throw Error('图标源身份冲突');
    sourceIDs.set(s.id,url);urls.set(url,s.id);plan.sources.push({...s,url,name:name(s.name)});}
  if(sourceIDs.size>ICON_LIMITS.sources)throw Error('恢复后图标源超过上限');
  const available=new Map((await env.DB.prepare('SELECT hash,ext,size FROM icon_assets').all()).results.map(a=>[a.hash,a]));seen.clear();
  for(const a of data.assets){if(!a||seen.has(a.hash)||a.encoding!=='base64')throw Error('图标图片备份编码无效');
    seen.add(a.hash);const asset=prepared.get(a)||validateIcon(decodeBase64(a.content,ICON_LIMITS.image,'图标图片'),a.mime);if(asset.hash!==a.hash||asset.ext!==a.ext||asset.size!==a.size)throw Error('图标图片校验失败');available.set(asset.hash,asset);plan.assets.push(asset);}
  if([...available.values()].reduce((sum,a)=>sum+a.size,0)>ICON_LIMITS.assets)throw Error('恢复后图标缓存超过 128 MiB');
  seen.clear();const counts=new Map();
  for(const e of data.entries){if(!e||!plan.sources.some(s=>s.id===e.source_id))throw Error('图标条目来源缺失');const url=sourceUrl(env,e.url);
    if(e.id!==hash(e.source_id+'\0'+url)||seen.has(e.id))throw Error('图标条目身份无效');seen.add(e.id);counts.set(e.source_id,(counts.get(e.source_id)||0)+1);
    if(counts.get(e.source_id)>ICON_LIMITS.entries)throw Error('单源图标超过上限');
    plan.entries.push({...e,url,name:name(e.name),asset_hash:available.has(e.asset_hash)?e.asset_hash:''});}
  for(const col of collections){const match=col.icon_url?.match(/^\/api\/icons\/([a-f0-9]{64})\.(png|jpg|webp)$/);if(col.icon_url?.startsWith('/api/icons/')&&(!match||available.get(match[1])?.ext!==match[2]))throw Error('合集引用的图标文件缺失');}
  for(const source of sources){
    let summary;try{summary=typeof source.summary==='string'?JSON.parse(source.summary||'{}'):(source.summary||{});}catch{throw Error('订阅摘要无效');}
    if(!summary||typeof summary!=='object'||Array.isArray(summary))throw Error('订阅摘要无效');
    const url=summary.custom_icon_url;
    if(url!==undefined){const match=typeof url==='string'&&url.match(/^\/api\/icons\/([a-f0-9]{64})\.(png|jpg|webp)$/);if(!match||available.get(match[1])?.ext!==match[2])throw Error('订阅引用的图标文件缺失');}
  }
  return plan;
}
export async function restoreIcons(env,plan){
  await env.DB.prepare("UPDATE icon_sources SET lease_until=0,lease_token=''").run();
  for(const a of plan.assets)await env.DB.prepare(`INSERT INTO icon_assets(hash,mime,ext,size,bytes,created_at,last_used_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(hash) DO UPDATE SET last_used_at=excluded.last_used_at`).bind(a.hash,a.mime,a.ext,a.size,a.bytes,Date.now(),Date.now()).run();
  for(const s of plan.sources){await env.DB.prepare(`INSERT INTO icon_sources(id,url,name,enabled,etag,last_modified,last_attempt_at,last_success_at,next_sync_at,last_error,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,etag=excluded.etag,last_modified=excluded.last_modified,
    last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,next_sync_at=excluded.next_sync_at,last_error=excluded.last_error,lease_token='',lease_until=0`)
    .bind(s.id,s.url,s.name,s.enabled?1:0,String(s.etag||'').slice(0,1000),String(s.last_modified||'').slice(0,1000),Number(s.last_attempt_at)||0,Number(s.last_success_at)||0,Date.now()+ICON_DAY,String(s.last_error||'').slice(0,500),Number(s.created_at)||Date.now()).run();
    await env.DB.prepare('DELETE FROM icon_entries WHERE source_id=?').bind(s.id).run();}
  await env.DB.batch(plan.entries.map(e=>env.DB.prepare('INSERT INTO icon_entries(id,source_id,url,name,position,active,asset_hash,cached_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(e.id,e.source_id,e.url,e.name,Number(e.position)||0,e.active?1:0,e.asset_hash,Number(e.cached_at)||0)));
}
