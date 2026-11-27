// 3.6.0：首页工具——模块对照、本机模块换成 Hub 链接、给某一行装上 HTML 卡片。
// 只改 rex-layout.json / rex-manifest.json / rex-html/，其余文件原样带回；不执行脚本、不联网。
import {storedZip,macJson} from './fwd.js';
import {decorateNamesFor,modulePath} from './filenames.js';
import {checkHtml} from './home-check.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const readJson=(entries,name)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get(name)));
const widgetOf=item=>String(item?.widgetId||item?.widgetBundleId||'').trim();
// rex-manifest / layout / home 排在最前（Mac Rex 导出顺序），其余文件保持原顺序。
const ROOT=['rex-manifest.json','rex-layout.json','rex-home.json'];
function rebuild(entries,changes){
 const out=new Map(entries);for(const [name,value] of Object.entries(changes)){if(value===null)out.delete(name);else out.set(name,Buffer.from(value));}
 const ordered=[...ROOT.filter(n=>out.has(n)),...[...out.keys()].filter(n=>!ROOT.includes(n))];
 return storedZip(ordered.map(n=>[n,new Uint8Array(out.get(n))]));
}
function linkKind(url,origin){
 if(!url)return 'builtin';
 if(/^file:\/\/\//i.test(url))return 'bundled';
 if(/^file:\/\//i.test(url))return 'local';
 try{return new URL(url).origin===origin?'hub':'external';}catch{return 'invalid';}
}
// Hub 里按 widget_id 找模块；同一个 widget_id 有多个时取最近更新的一个，并告诉调用方有几个。
export async function hubModules(env,widgetIds){
 const ids=[...new Set(widgetIds.filter(Boolean))].slice(0,500);if(!ids.length)return new Map();
 const rows=(await env.DB.prepare('SELECT * FROM modules WHERE widget_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC,id').bind(JSON.stringify(ids)).all()).results||[];
 const decorated=await decorateNamesFor(env,rows),map=new Map();
 for(const m of decorated){const list=map.get(m.widget_id);if(list)list.push(m);else map.set(m.widget_id,[m]);}
 return map;
}
const hubUrl=(origin,m)=>origin+(m.share_path||modulePath(m));
export async function moduleReport(env,refs,origin){
 const groups=new Map();
 for(const r of refs){const kind=linkKind(r.url,origin);if(!r.widget_id&&kind==='builtin')continue;const key=r.widget_id+'\u0000'+kind;
  const g=groups.get(key)||{widget_id:r.widget_id,name:r.name,kind,items:0,url:kind==='external'||kind==='hub'?r.url.slice(0,300):''};g.items+=r.items;groups.set(key,g);}
 const hub=await hubModules(env,[...groups.values()].map(g=>g.widget_id));
 return [...groups.values()].map(g=>{const list=hub.get(g.widget_id)||[],m=list[0];
  return {...g,hub:m?{id:m.id,title:String(m.title||'').slice(0,80),version:m.version||'',encrypted:!!m.is_encrypted,url:hubUrl(origin,m),copies:list.length}:null,
   relinkable:!!m&&(g.kind==='local'||g.kind==='bundled')};}).sort((a,b)=>b.items-a.items).slice(0,300);
}
// 本机模块（file://UUID.js）和内置脚本（file:///x.js）换成本站模块链接。只换 Hub 里有同 widgetId 的；其余不动。
export async function relinkHome(env,entries,origin,only){
 const layout=readJson(entries,'rex-layout.json'),hub=await hubModules(env,layout.flatMap(s=>(s.items||[]).map(widgetOf)));
 const wanted=Array.isArray(only)&&only.length?new Set(only.map(String)):null;let changed=0;const skipped=new Map();
 for(const section of layout)for(const item of section.items||[]){
  const url=typeof item.widgetURL==='string'?item.widgetURL:'',kind=linkKind(url,origin);if(kind!=='local'&&kind!=='bundled')continue;
  const id=widgetOf(item);if(wanted&&!wanted.has(id))continue;
  const m=(hub.get(id)||[])[0];if(!m){skipped.set(id||'（没有 widgetId）',(skipped.get(id||'（没有 widgetId）')||0)+1);continue;}
  item.widgetURL=hubUrl(origin,m);changed++;
 }
 if(!changed)fail(skipped.size?'没有可替换的项目：这些模块在本站找不到同 widgetId 的模块：'+[...skipped.keys()].slice(0,8).join('、'):'没有需要替换的本机模块或内置脚本');
 const stillUsed=new Set(layout.flatMap(s=>(s.items||[]).map(i=>typeof i.widgetURL==='string'&&/^file:\/\/\//i.test(i.widgetURL)?'rex-scripts/'+i.widgetURL.slice(8):'')));
 const changes={'rex-layout.json':macJson(layout)},dropped=[];
 for(const name of entries.keys())if(name.startsWith('rex-scripts/')&&!stillUsed.has(name)){changes[name]=null;dropped.push(name.slice(12));}
 return {bytes:rebuild(entries,changes),changed,skipped:[...skipped].map(([widget_id,items])=>({widget_id,items})),dropped_scripts:dropped};
}
const GRID={x1:1,x2:2,x3:3,x4:4};
function safeHtmlName(name,taken){
 let stem=String(name||'card').replace(/\.html?$/i,'').normalize('NFC').replace(/[\/\\<>:"|?*\u0000-\u001f\u007f]/g,'-').replace(/^[.\s-]+|[.\s-]+$/g,'');
 stem=[...stem].slice(0,80).join('')||'card';let out=stem+'.html',n=2;while(taken.has('rex-html/'+out))out=stem+'-'+(n++)+'.html';return out;
}
// 给第 section 行第 item 个项目装上（或换掉、去掉）HTML 卡片；按声明配好 style / gridSize，manifest 改成 version 2。
export function attachHtml(entries,{section,item,html,filename,remove=false}){
 const layout=readJson(entries,'rex-layout.json'),manifest=readJson(entries,'rex-manifest.json');
 const row=layout[Number(section)],target=row&&Array.isArray(row.items)?row.items[Number(item)]:null;
 if(!Number.isInteger(Number(section))||!Number.isInteger(Number(item))||!target||typeof target!=='object')fail('找不到要放卡片的栏目或项目，请刷新后重选');
 const old=typeof target.htmlTemplate==='string'&&!target.htmlTemplate.includes('<')?'rex-html/'+target.htmlTemplate:null,changes={};
 if(remove){
  if(!('htmlTemplate' in target))fail('这个项目没有 HTML 卡片');
  delete target.htmlTemplate;delete target.htmlTemplateSource;
 }else{
  if(typeof html!=='string'||!html.trim())fail('请选择 HTML 卡片文件');
  const result=checkHtml(html),decl=result.declaration;
  if(result.blocking.length||!decl)fail('HTML 卡片不能用：'+(result.blocking.join('；')||'缺少尺寸声明'));
  const others=row.items.filter(x=>x!==target);
  if((decl.type==='full-width'||decl.type==='rail')&&others.length)fail('全宽单卡和横滑要求这一行只有一个项目（这一行有 '+row.items.length+' 个）');
  const fields=Object.fromEntries(decl.text.split('; ').map(p=>p.split('=')));
  if(decl.type==='card'){target.style='cover';target.gridSize=[GRID[fields.width],GRID[fields.height]];
   const mismatch=others.filter(x=>'htmlTemplate' in x&&JSON.stringify(x.gridSize)!==JSON.stringify(target.gridSize));if(mismatch.length)fail('同一行的 HTML 卡片要用相同的宽高档位');}
  else{const h=Array.isArray(target.gridSize)&&target.gridSize[0]===-1&&Number(target.gridSize[1])>0?target.gridSize[1]:2.3;target.style=decl.type==='rail'?'fullWidthPoster':'cover';target.gridSize=[-1,h];}
  const taken=new Set([...entries.keys()].filter(n=>n!==old)),name=safeHtmlName(filename,taken);
  target.htmlTemplate=name;delete target.htmlTemplateSource;changes['rex-html/'+name]=html;
  manifest.version=2;changes['rex-manifest.json']=macJson(manifest);
 }
 changes['rex-layout.json']=macJson(layout);
 const stillUsed=new Set(layout.flatMap(s=>(s.items||[]).map(i=>typeof i.htmlTemplate==='string'&&!i.htmlTemplate.includes('<')?'rex-html/'+i.htmlTemplate:'')));
 if(old&&!stillUsed.has(old)&&!(old in changes))changes[old]=null;
 return {bytes:rebuild(entries,changes),filename:remove?'':target.htmlTemplate,style:target.style,gridSize:target.gridSize};
}
