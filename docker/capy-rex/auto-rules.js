// Rules inspect catalog text, never execute uploaded or downloaded JavaScript.
import {createHash} from 'node:crypto';
export const RULES_KEY='auto_rules_v1';
export const RULE_FIELDS=['title','filename','author','sub'];
export const enhancementSchema=[
 `CREATE TABLE IF NOT EXISTS auto_rule_seen(module_id TEXT PRIMARY KEY)`,
 `CREATE TABLE IF NOT EXISTS duplicate_ignores(members TEXT PRIMARY KEY,created_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_subscription_errors ON subscription_items(source_id,active,last_error)`
];
const setting=async(env,key)=>(await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first())?.value;
const put=(env,key,value)=>env.DB.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').bind(key,value);
const atomic=(env,fn)=>env.ATOMIC?env.ATOMIC(fn):fn();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const keywordsOf=value=>[...new Set(String(value||'').split(/[,，、;；\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean))];
export function normalizeRules(body){
 if(!body||!Array.isArray(body.rules)||body.rules.length>100||typeof body.auto!=='boolean')throw Error('规则格式不正确（最多 100 条）');
 const rules=body.rules.map((r,i)=>{
  if(!r||typeof r.kw!=='string'||r.kw.length>500||!keywordsOf(r.kw).length)throw Error('规则 '+(i+1)+' 的关键词无效');
  if(!Array.isArray(r.fields)||!r.fields.length||r.fields.some(f=>!RULE_FIELDS.includes(f)))throw Error('请选择有效的匹配范围');
  if(typeof r.group!=='string'||r.group.length>100||!Array.isArray(r.cols)||r.cols.length>50||r.cols.some(c=>typeof c!=='string'||!c||c.length>100))throw Error('规则目标无效');
  if(!r.group&&!r.cols.length)throw Error('规则 '+(i+1)+' 至少指定一个分组或合集');
  return {kw:r.kw.trim(),fields:[...new Set(r.fields)],group:r.group,cols:[...new Set(r.cols)]};
 });return {auto:body.auto,rules};
}
export async function loadAutoRules(env){
 const raw=await setting(env,RULES_KEY);
 if(!raw)return {auto:false,rules:[],configured:false};
 const data=JSON.parse(raw);return {...normalizeRules(data),configured:true,updated_at:data.updated_at||0};
}
export async function saveAutoRules(env,body){
 const clean=normalizeRules(body);
 return atomic(env,async()=>{
  const groups=new Set(((await env.DB.prepare('SELECT id FROM groups').all()).results||[]).map(r=>r.id));
  const cols=new Set(((await env.DB.prepare('SELECT id FROM collections WHERE COALESCE(auto_all,0)=0').all()).results||[]).map(r=>r.id));
  if(clean.rules.some(r=>(r.group&&!groups.has(r.group))||r.cols.some(id=>!cols.has(id))))throw Error('目标已删除或是自动全部合集，请重新选择');
  const previous=await loadAutoRules(env);
  if(!await setting(env,'auto_rules_baseline')||(!previous.auto&&clean.auto))await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO auto_rule_seen SELECT id FROM modules'),put(env,'auto_rules_baseline','1')]);
  const updated_at=Date.now();await put(env,RULES_KEY,JSON.stringify({...clean,updated_at})).run();
  return {ok:true,...clean,configured:true,updated_at};
 });
}
// 关键词按规则缓存：同一批规则匹配上千个模块时不再每次重新拆分。
const KEYWORDS=new WeakMap();
const ruleWords=r=>{let w=KEYWORDS.get(r);if(!w){w=keywordsOf(r.kw);KEYWORDS.set(r,w);}return w;};
export function firstMatch(rules,fields){
 const lower={};
 for(const r of rules)if(r.fields.some(f=>{const v=lower[f]??=String(fields[f]||'').toLowerCase();return ruleWords(r).some(w=>v.includes(w));}))return r;
 return null;
}
async function plan(env,rules,ids=null){
 const DB=env.DB;
 const modules=(await DB.prepare(ids?'SELECT * FROM modules WHERE id IN (SELECT value FROM json_each(?)) ORDER BY created_at,id':"SELECT * FROM modules WHERE COALESCE(group_id,'')='' ORDER BY created_at,id LIMIT 2000").bind(...(ids?[JSON.stringify(ids)]:[])).all()).results||[];
 const sources=(await DB.prepare('SELECT i.module_id,s.title FROM subscription_items i JOIN subscription_sources s ON s.id=i.source_id WHERE i.active=1 ORDER BY i.module_id,s.id').all()).results||[];
 const groups=(await DB.prepare('SELECT id,name FROM groups ORDER BY id').all()).results||[];
 const cols=(await DB.prepare('SELECT id,title,auto_all FROM collections ORDER BY id').all()).results||[];
 const members=(await DB.prepare('SELECT collection_id,module_id,position FROM collection_modules ORDER BY collection_id,position,module_id').all()).results||[];
 const groupIds=new Set(groups.map(g=>g.id)),colIds=new Set(cols.filter(c=>!c.auto_all).map(c=>c.id));
 const existing=new Set(members.map(m=>m.collection_id+'\n'+m.module_id)),changes=[];
 // 订阅源标题按模块预先分好：原来每个模块都要扫一遍全部订阅条目（模块数 × 条目数）。
 const subTitles=new Map();
 for(const x of sources){const list=subTitles.get(x.module_id);if(list)list.push(x.title);else subTitles.set(x.module_id,[x.title]);}
 for(const m of modules){
  const sub=(subTitles.get(m.id)||[]).join('\n');
  const rule=firstMatch(rules,{title:(m.title||'')+'\n'+(m.manifest_title||''),filename:m.filename,author:m.author,sub});
  if(!rule)continue;
  const group=!m.group_id&&groupIds.has(rule.group)?rule.group:'';
  const collections=rule.cols.filter(c=>colIds.has(c)&&!existing.has(c+'\n'+m.id));
  if(group||collections.length)changes.push({id:m.id,title:m.title||m.filename,group,collections});
 }
 return {checked:modules.length,changes,groups,collections:cols,
  token:digest([rules,modules,sources,groups,cols,members])};
}
async function apply(env,p){
 const statements=[],touched=new Set(),positions=new Map();
 for(const r of (await env.DB.prepare('SELECT collection_id,MAX(position) AS p FROM collection_modules GROUP BY collection_id').all()).results||[])positions.set(r.collection_id,Number(r.p));
 let grouped=0,added=0;
 for(const c of p.changes){
  if(c.group){statements.push(env.DB.prepare("UPDATE modules SET group_id=? WHERE id=? AND COALESCE(group_id,'')=''").bind(c.group,c.id));grouped++;}
  for(const id of c.collections){const pos=(positions.get(id)??-1)+1;positions.set(id,pos);touched.add(id);added++;
   statements.push(env.DB.prepare('INSERT OR IGNORE INTO collection_modules(collection_id,module_id,position) VALUES(?,?,?)').bind(id,c.id,pos));}
 }
 for(const id of touched)statements.push(env.DB.prepare('UPDATE collections SET updated_at=? WHERE id=?').bind(Date.now(),id));
 for(let i=0;i<statements.length;i+=100)await env.DB.batch(statements.slice(i,i+100));
 return {ok:true,checked:p.checked,grouped,added};
}
export async function previewAutoRules(env){return atomic(env,async()=>({ok:true,...await plan(env,(await loadAutoRules(env)).rules)}));}
export async function runAutoRules(env,body){
 return atomic(env,async()=>{
  const p=await plan(env,(await loadAutoRules(env)).rules);
  if(!body?.token||body.token!==p.token)throw Error('规则或模块列表已变化，请重新预览');
  return apply(env,p);
 });
}
// 3.6.0：没有新模块就不扫。新模块一定会让 MAX(rowid) 或 MAX(created_at) 变大；恢复备份会换 content_generation；
// 改规则会换 auto_rules_v1 / auto_rules_baseline。这几样都没变时直接跳过，只读几行（原来每次维护都把全部模块扫三遍）。
// 孤儿记录清理照旧在有变化时做，另外最多 24 小时补做一次。
const RULE_STATE=new WeakMap(),RULE_SWEEP=24*60*60*1000;
async function ruleSignal(env){
 const row=await env.DB.prepare(`SELECT (SELECT MAX(rowid) FROM modules) AS r,(SELECT MAX(created_at) FROM modules) AS c,
  (SELECT value FROM settings WHERE key='content_generation') AS g,(SELECT value FROM settings WHERE key='auto_rules_v1') AS v,
  (SELECT value FROM settings WHERE key='auto_rules_baseline') AS b`).first();
 return JSON.stringify([row?.r??null,row?.c??null,row?.g??null,row?.v??null,row?.b??null]);
}
export async function autoRulesTick(env){
 const key=env.DB,state=RULE_STATE.get(key)||{signal:'',swept:0};RULE_STATE.set(key,state);
 const signal=await ruleSignal(env),now=Date.now();
 // 刚建的模块要等 20 秒才处理；这段时间内不记住 signal，下一轮再看。
 if(signal===state.signal&&now-state.swept<RULE_SWEEP)return {skipped:true,unchanged:true};
 const result=await atomic(env,async()=>{
  const config=await loadAutoRules(env);
  if(!config.configured||!await setting(env,'auto_rules_baseline'))return {skipped:true};
  await env.DB.prepare('DELETE FROM auto_rule_seen WHERE module_id NOT IN (SELECT id FROM modules)').run();
  const ids=((await env.DB.prepare('SELECT id FROM modules WHERE created_at<=? AND NOT EXISTS(SELECT 1 FROM auto_rule_seen s WHERE s.module_id=modules.id) ORDER BY created_at,id LIMIT 200').bind(Date.now()-20000).all()).results||[]).map(m=>m.id);
  if(!ids.length)return {skipped:true};
  const result=config.auto?await apply(env,await plan(env,config.rules,ids)):{checked:ids.length,grouped:0,added:0};
  await env.DB.batch(ids.map(id=>env.DB.prepare('INSERT OR IGNORE INTO auto_rule_seen VALUES(?)').bind(id)));
  return {...result,more:ids.length>=200};
 });
 // 还有没处理完的（每轮最多 200 个，或有不到 20 秒的新模块），下一轮继续；否则记住这次的 signal。
 const young=await env.DB.prepare('SELECT 1 FROM modules WHERE created_at>? LIMIT 1').bind(now-20000).first();
 if(!result?.more&&!young){state.signal=signal;state.swept=now;}
 return result;
}
