import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {homeUI,homeStyles} from '../home-ui.js';
import {getHTML} from '../worker.js';
class Element{
 constructor(){this.children=[];this.nodes=new Map();this.attributes={};this.hidden=false;this.disabled=false;this.textContent='';this.innerHTML='';this.isConnected=true;this.files=[];this.value='';}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
 querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,new Element());return this.nodes.get(k);}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.innerHTML='';this.textContent='';}
 addEventListener(){}removeEventListener(){}remove(){this.isConnected=false;}focus(){this.focused=true;}
}
const settle=()=>new Promise(r=>setImmediate(r)),root='/api/admin/home-configs',id='00000000-0000-4000-8000-000000000001';
const row={id,title:'测试首页',package_title:'包内名称',size:1234,sections:12,items:16,revision:'revision-one',shared:false,share_path:'',updated_at:1000,avatar_url:''};
function fixture({mode='modules',request=async()=>[row],confirm=true}={}){
 const elements=new Map(),calls=[],dialogs=[],menus=[],prompts=[],copies=[],toasts=[],storage=new Map([['rex_hub_col_section_v1',mode]]);let rendered=0;
 const get=k=>{if(!elements.has(k))elements.set(k,new Element());return elements.get(k);};
 const ctx={document:{body:new Element(),getElementById:get,querySelector:()=>dialogs.at(-1),createElement:()=>new Element(),addEventListener(){},removeEventListener(){}},MutationObserver:class{observe(){}},
  state:{tab:'collections',modules:[{id:'kept'}],collections:[{id:'kept-col'}]},renderCols(){rendered++;},localStorage:{getItem:k=>storage.get(k)||'',setItem:(k,v)=>storage.set(k,v)},
  api:async(...args)=>{calls.push(args);return request(...args);},esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),hubInitial:v=>v[0],fmt:v=>v+' B',
  hubManageButton:label=>'<button class="hub-more" aria-label="'+label+'">sliders</button>',manageIcon:()=>'<svg></svg>',hubAvatarImage(){},
  hubActionMenu:(title,actions,note)=>menus.push({title,actions,note}),showConfirmAsync:async text=>{prompts.push(text);return typeof confirm==='function'?confirm():confirm;},
  copyText:async text=>copies.push(text),org:()=> 'http://hub.test',toast:text=>toasts.push(text),FormData,File,
  showModal:(title,html,callback)=>{const e=new Element();e.title=title;e.innerHTML=html;e.submit=()=>callback(()=>e.remove());dialogs.push(e);}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(homeUI,ctx);
 return {ctx,get,calls,dialogs,menus,prompts,copies,toasts,storage,rendered:()=>rendered,card:()=>get('homeConfigsList').children[0],async open(){ctx.switchCollectionSection('homes');await settle();},menu(){this.card().querySelector('.hub-more').onclick();return menus.at(-1);}};
}
test('collection segments keep exactly four bottom destinations and compile with keyboard and responsive styles',()=>{
 const html=getHTML();assert.equal((html.match(/class="dock-item(?: active)?"/g)||[]).length,4);assert.match(html,/模块合集<\/button>.*首页配置<\/button>/);assert.match(html,/id="uploadHomeConfig"[^>]*hidden/);assert.match(homeStyles,/\[hidden\]\{display:none!important/);assert.match(homeStyles,/@media\(max-width:360px\)/);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});
test('home data loads lazily; list/action visibility and saved segment are independent from module collections',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.get('newModuleCollection').hidden,false);await f.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],root);assert.equal(f.get('uploadHomeConfig').hidden,false);assert.equal(f.get('moduleCollectionsPanel').hidden,true);assert.equal(f.get('homeConfigsTab').attributes['aria-selected'],'true');
 assert.match(f.card().innerHTML,/12 个栏目 · 16 个布局项目/);assert.match(f.card().innerHTML,/导出 \.rex/);assert.doesNotMatch(f.card().innerHTML,/导入 Rex|data-rex-url/);assert.equal(f.storage.get('rex_hub_col_section_v1'),'homes');
 f.ctx.switchCollectionSection('modules');assert.equal(f.get('uploadHomeConfig').hidden,true);assert.equal(f.get('newModuleCollection').hidden,false);f.ctx.renderCols();assert.equal(f.rendered(),1);assert.equal(f.ctx.state.modules[0].id,'kept');assert.equal(f.ctx.state.collections[0].id,'kept-col');
 f.get('moduleCollectionsTab').onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(f.get('homeConfigsTab').focused,true);assert.equal(f.calls.length,1);
});
test('home errors show retry and stale list requests cannot overwrite a newer refresh',async()=>{
 let count=0,release;const f=fixture({request:async()=>{count++;if(count===1)throw Error('offline');if(count===2)return new Promise(r=>release=r);return [{...row,title:'new'}];}});await f.open();assert.match(f.get('homeLoadStatus').children[0].textContent,/offline/);
 const pending=f.ctx.refreshHomeConfigs();await settle();await f.ctx.refreshHomeConfigs();release([{...row,title:'stale'}]);await pending;assert.match(f.card().innerHTML,/new/);assert.doesNotMatch(f.card().innerHTML,/stale/);
});
test('card titles are escaped and management menu only contains independent home actions',async()=>{
 const f=fixture({request:async()=>[{...row,title:'<script>alert(1)</script>'}]});await f.open();assert.match(f.card().innerHTML,/&lt;script>/);assert.doesNotMatch(f.card().innerHTML,/<script>/);
 assert.deepEqual(Array.from(f.menu().actions,a=>a[0]),['复制分享链接','替换文件','重命名','检查首页','换成 Hub 模块链接','装上 HTML 卡片','删除首页配置']);
});
test('first share is opt-in and copies only the server-issued file URL; cancellation makes no write',async()=>{
 let accept=false;const f=fixture({confirm:()=>accept,request:async(path,options)=>options?{ok:true,path:'/api/home-configs/stable.rex'}:[row]});await f.open();
 f.menu().actions[0][1]();await settle();assert.equal(f.calls.length,1);assert.equal(f.copies.length,0);accept=true;f.menu().actions[0][1]();await settle();assert.match(f.prompts[0],/持有链接的人/);assert.equal(f.calls[1][0],root+'/'+id+'/share');assert.equal(f.calls[1][1].json.revision,row.revision);assert.equal(f.calls[1][1].json.accept_public,true);assert.equal(f.copies[0],'http://hub.test/api/home-configs/stable.rex');
});
test('replacement uploads the original file only to the selected ID with revision; failure leaves the dialog and old list intact',async()=>{
 const f=fixture({request:async(path,options)=>options?{error:'revision changed'}:[row]});await f.open();f.menu().actions[1][1]();const modal=f.dialogs.at(-1);assert.match(modal.innerHTML,/分享链接保持不变/);const file=new File(['original ZIP bytes'],'new.rex');modal.querySelector('#homeFile').files=[file];await modal.submit();
 const call=f.calls.find(c=>c[1]?.method==='PUT');assert.equal(call[0],root+'/'+id);assert.equal(call[1].body.get('revision'),row.revision);assert.equal(await call[1].body.get('file').text(),'original ZIP bytes');assert.equal(modal.isConnected,true);assert.match(modal.querySelector('#homeFormStatus').textContent,/revision changed/);assert.match(f.card().innerHTML,/测试首页/);
});
test('upload requires explicit confirmation and rejects oversized or wrong-extension files before sending',async()=>{
 const f=fixture();await f.open();f.ctx.showUploadHome();const modal=f.dialogs.at(-1);assert.equal(f.calls.length,1);await modal.submit();assert.match(modal.querySelector('#homeFormStatus').textContent,/先选择/);
 for(const file of [{name:'bad.js',size:1},{name:'big.rex',size:26*1024*1024}]){modal.querySelector('#homeFile').files=[file];await modal.submit();assert.match(modal.querySelector('#homeFormStatus').textContent,/25 MiB/);}assert.equal(f.calls.length,1);
});
test('rename and delete use only home endpoints, preserve revisions, and warn that sharing is revoked',async()=>{
 const f=fixture({request:async(path,options)=>options?{ok:true}:[row]});await f.open();f.menu().actions[2][1]();const modal=f.dialogs.at(-1);modal.querySelector('#homeName').value='Alias';await modal.submit();const patch=f.calls.find(c=>c[1]?.method==='PATCH');assert.equal(patch[0],root+'/'+id);assert.equal(patch[1].json.title,'Alias');assert.equal(patch[1].json.revision,row.revision);
 f.menu().actions.find(a=>a[0]==='删除首页配置')[1]();await settle();assert.match(f.prompts.at(-1),/分享链接将失效/);assert.equal(f.calls.find(c=>c[1]?.method==='DELETE')[0],root+'/'+id);assert.equal(f.calls.some(c=>/modules|collections/.test(c[0])),false);
});
