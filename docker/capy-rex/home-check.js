// 3.6.0：首页包检查（适配 Rex 1.2 的 HTML 首页卡片与 home-package version 2）。
// 只读已解压到内存的条目，不执行脚本、不发网。返回给管理员看的报告；
// 只有「布局引用了包里不存在的 HTML 文件」会让上传失败，其余都是提示。
const ITEM_FIELDS=['style','count','gridSize','id','title','subtitle','iconUrl','functionId','params','widgetBundleId','widgetId','widgetURL','name'];
export const HTML_LIMIT=32768;
// 检查规则一改就加 1，旧的缓存结果自动作废重算。
export const CHECK_VERSION=3;
const SCAN_LIMIT=128*1024,SCRIPT_SCAN_LIMIT=512*1024;
const text=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}};
const label=(section,item)=>{const a=String(section?.title||'').trim(),b=String(item?.title||'').trim();return (a&&b&&a!==b?a+' · '+b:a||b||'未命名项目').slice(0,80);};
const safeName=name=>typeof name==='string'&&/^[^/\\\u0000-\u001f\u007f]{1,200}$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.');
// 尺寸声明：type=card; width=x1..x4; height=x1..x4 / type=full-width; height=96..960 / type=rail; height=n; item-ratio=a:b
export function parseDeclaration(value){
 const out={},issues=[];
 for(const part of String(value).split(';')){const t=part.trim();if(!t)continue;const i=t.indexOf('=');if(i<1){issues.push('声明片段无效：'+t.slice(0,40));continue;}const k=t.slice(0,i).trim(),v=t.slice(i+1).trim();if(k in out)issues.push('声明重复：'+k);out[k]=v;}
 const type=out.type;
 if(type==='card'){for(const k of ['width','height'])if(!/^x[1-4]$/.test(out[k]||''))issues.push('卡片的 '+k+' 只能是 x1～x4');}
 else if(type==='full-width'){const h=Number(out.height);if(!/^\d+$/.test(out.height||'')||h<96||h>960)issues.push('全宽单卡的 height 要写 96～960 的整数');}
 else if(type==='rail'){const h=Number(out.height),m=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(out['item-ratio']||'');
  if(!/^\d+$/.test(out.height||'')||h<50||h>2048)issues.push('横滑的 height 要写整数');
  if(!m||!(Number(m[1])>0&&Number(m[2])>0))issues.push('横滑缺少 item-ratio（例如 2:3）');else{const r=Number(m[1])/Number(m[2]);if(r<1/3-1e-9||r>3+1e-9)issues.push('item-ratio 只允许 1:3～3:1');}}
 else issues.push(type?'未知承载类型：'+type:'缺少 type');
 if(out.background&&!['glass','clear-glass'].includes(out.background))issues.push('background 只能是 glass 或 clear-glass');
 return {type:type||'',fields:out,issues};
}
// 线性切出每个标签（最长 2000 字符），避免回溯型正则在恶意输入上耗尽 CPU。
function tags(html){const out=[];let i=0;while((i=html.indexOf('<',i))>=0){const end=html.indexOf('>',i);const stop=end<0?Math.min(html.length,i+2000):Math.min(end+1,i+2000);out.push(html.slice(i,stop));i=stop>i?stop:i+1;if(out.length>20000)break;}return out;}
// blocking：Rex 一定会拒绝的问题（大小、NUL、尺寸声明）；其余是提示。「装上 HTML 卡片」只按 blocking 拒绝。
export function checkHtml(html,bytes=Buffer.byteLength(html)){
 const issues=[],blocking=[],block=text=>{issues.push(text);blocking.push(text);};
 if(bytes>HTML_LIMIT)block('超过 32,768 字节（'+bytes+'），Rex 会拒绝');
 if(html.includes('\u0000'))block('包含 NUL 字符');
 // 只在前 128 KiB 里做正则检查：超限文件 Rex 本来就会拒绝，也避免 Cloudflare 单次请求 CPU 时间被大文件耗尽。
 html=html.length>SCAN_LIMIT?html.slice(0,SCAN_LIMIT):html;
 const tagList=tags(html),metas=tagList.filter(t=>/^<meta\b/i.test(t)&&/\bname\s*=\s*["']rex-widget["']/i.test(t));
 let declaration=null;
 if(!metas.length)block('缺少 <meta name="rex-widget"> 尺寸声明');
 else if(metas.length>1)block('rex-widget 声明重复');
 if(metas.length===1){const c=/\bcontent\s*=\s*(["'])(.*?)\1/i.exec(metas[0]);if(!c)block('rex-widget 声明缺少 content');else{declaration=parseDeclaration(c[2]);declaration.issues.forEach(block);}}
 if(tagList.some(t=>/^<(?:script|link|img|iframe|source)\b/i.test(t)&&/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(t))||/@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i.test(html))issues.push('引用了外部脚本、样式或图片（只能内联，图片用宿主 icon: token）');
 if(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(html))issues.push('含网络请求代码（HTML 卡片没有网络能力）');
 return {bytes,declaration:declaration?{type:declaration.type,text:Object.entries(declaration.fields).map(([k,v])=>k+'='+v).join('; ')}:null,issues,blocking};
}
function styleIssue(decl,item){
 if(!decl)return null;const g=Array.isArray(item.gridSize)?item.gridSize:[],full=g[0]===-1;
 if(decl.type==='card'&&(item.style!=='cover'||full))return '方卡声明应配 style "cover" 和网格 gridSize（例如 [2,2]）';
 if(decl.type==='full-width'&&(item.style!=='cover'||!full))return '全宽单卡应配 style "cover"、gridSize 宽度 -1';
 if(decl.type==='rail'&&(item.style!=='fullWidthPoster'||!full))return '横滑应配 style "fullWidthPoster"、gridSize 宽度 -1';
 return null;
}
const hostsIn=source=>{const map=new Map();for(const m of source.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)){const h=m[1].toLowerCase();map.set(h,(map.get(h)||0)+1);}return [...map.keys()].sort().slice(0,30);};
export function checkHomePackage(entries,manifest,layout){
 const version=manifest.version,warnings=[],cards=[],used=new Set(),scriptsUsed=new Set(),links=new Map();
 let local=0,missingFields=0;const missingExamples=[],localExamples=[],missingScripts=[];
 const htmlFiles=[...entries.keys()].filter(n=>n.startsWith('rex-html/')&&!n.endsWith('/'));
 const scriptFiles=[...entries.keys()].filter(n=>n.startsWith('rex-scripts/')&&!n.endsWith('/'));
 for(const section of layout)for(const item of section.items||[]){
  const where=label(section,item);
  const missing=ITEM_FIELDS.filter(k=>!(k in item));if(missing.length){missingFields++;if(missingExamples.length<5)missingExamples.push(where+'（缺 '+missing.join('、')+'）');}
  const url=typeof item.widgetURL==='string'?item.widgetURL:'';
  if(/^file:\/\/\//i.test(url)){const name=url.slice(8);if(entries.has('rex-scripts/'+name))scriptsUsed.add('rex-scripts/'+name);else missingScripts.push(where+'：'+name);}
  else if(/^file:\/\//i.test(url)){local++;if(localExamples.length<5)localExamples.push(where);}
  else if(/^https?:\/\//i.test(url)){try{const h=new URL(url).host;links.set(h,(links.get(h)||0)+1);}catch{}}
  if(!('htmlTemplate' in item))continue;
  const value=item.htmlTemplate;
  if(typeof value!=='string'||!value.trim())throw Object.assign(Error('「'+where+'」的 htmlTemplate 无效'),{status:400});
  let html,source;
  if(value.includes('<')){html=value;source='inline';}
  else{if(!safeName(value))throw Object.assign(Error('「'+where+'」的 htmlTemplate 文件名不安全：'+value.slice(0,60)),{status:400});
   const key='rex-html/'+value;if(!entries.has(key))throw Object.assign(Error('「'+where+'」引用的 '+key+' 不在首页包里'),{status:400});
   used.add(key);const raw=entries.get(key);source='file';html=raw.length>SCAN_LIMIT*4?new TextDecoder().decode(raw.subarray(0,SCAN_LIMIT*4)):text(raw);if(html===null){cards.push({where,source,name:value,bytes:entries.get(key).length,declaration:null,issues:['不是有效的 UTF-8 文本']});continue;}}
  const {blocking:_b,...result}=checkHtml(html,source==='file'?entries.get('rex-html/'+value).length:undefined),issue=styleIssue(result.declaration,item);if(issue)result.issues.push(issue);
  cards.push({where,source,name:source==='file'?value:'',template_id:item.htmlTemplateSource&&typeof item.htmlTemplateSource.id==='string'?item.htmlTemplateSource.id.slice(0,60):'',template_version:item.htmlTemplateSource&&Number.isFinite(Number(item.htmlTemplateSource.version))&&item.htmlTemplateSource.version!==''?Number(item.htmlTemplateSource.version):null,...result});
 }
 if(cards.length&&version!==2)warnings.push('包含 HTML 卡片，但 rex-manifest.json 的 version 是 '+version+'；按官方指南应改成 2');
 if(cards.some(c=>c.issues.length))warnings.push(cards.filter(c=>c.issues.length).length+' 张 HTML 卡片有问题，详见卡片列表');
 if(missingFields)warnings.push(missingFields+' 个布局项目缺少必需字段，Rex 可能整包导入失败：'+missingExamples.join('；'));
 if(missingScripts.length)warnings.push(missingScripts.length+' 个布局项目指向 file:/// 内置脚本，但 rex-scripts/ 里没有：'+missingScripts.slice(0,5).join('；'));
 if(local)warnings.push(local+' 个布局项目用的是本机模块（file://UUID.js），别人导入后这些行会是空的，请改成模块链接或把脚本放进 rex-scripts/：'+localExamples.join('；'));
 const unusedHtml=htmlFiles.filter(n=>!used.has(n)),unusedScripts=scriptFiles.filter(n=>!scriptsUsed.has(n));
 if(unusedHtml.length)warnings.push('rex-html/ 里有 '+unusedHtml.length+' 个文件没有被布局引用：'+unusedHtml.slice(0,5).map(n=>n.slice(9)).join('、'));
 if(unusedScripts.length)warnings.push('rex-scripts/ 里有 '+unusedScripts.length+' 个脚本没有被布局引用：'+unusedScripts.slice(0,5).map(n=>n.slice(12)).join('、'));
 const scripts=scriptFiles.map(n=>{const b=entries.get(n),head=b.subarray(0,16).toString('latin1'),encrypted=/^REXENC/.test(head),src=encrypted?null:text(b.subarray(0,SCRIPT_SCAN_LIMIT));return {name:n.slice(12),bytes:b.length,encrypted,hosts:src?hostsIn(src):[]};});
 // 3.6.0：模块引用按 widgetId + 地址合并计数，给「模块对照」用（是不是本站链接要看请求来源，取用时再判断）。
 const refMap=new Map();for(const section of layout)for(const it of section.items||[]){const w=String(it?.widgetId||it?.widgetBundleId||'').slice(0,200),u=typeof it?.widgetURL==='string'?it.widgetURL.slice(0,500):'';if(!w&&!u)continue;const k=w+'\u0000'+u,r=refMap.get(k)||{widget_id:w,name:String(it.name||'').slice(0,80),url:u,items:0};r.items++;refMap.set(k,r);}
 const refs=[...refMap.values()].slice(0,2000);
 // 3.6.0：栏目大纲，给「添加 HTML 卡片」选位置用。
 const outline=layout.slice(0,300).map((section,si)=>({index:si,title:String(section?.title||'').slice(0,80),items:(section.items||[]).slice(0,50).map((it,ii)=>({index:ii,title:String(it?.title||'').slice(0,80),style:typeof it.style==='string'?it.style:'',grid:Array.isArray(it.gridSize)?it.gridSize.slice(0,2):[],html:'htmlTemplate' in it,widget:String(it.widgetId||it.widgetBundleId||'').slice(0,120)}))}));
 return {check_version:CHECK_VERSION,outline,refs,version,html_cards:cards,scripts,links:[...links].map(([host,rows])=>({host,items:rows})).sort((a,b)=>b.items-a.items).slice(0,50),local_items:local,warnings,
  note:'首页包只包含布局、首页信息、内置脚本（rex-scripts/）和 HTML 卡片（rex-html/），本来就不包含 Worker 或接口服务；模块依赖的 Worker 要另外部署或在模块参数里填写地址。加密脚本看不到里面用的地址。'};
}
