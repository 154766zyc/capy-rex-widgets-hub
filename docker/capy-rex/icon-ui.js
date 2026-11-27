export const iconStyles=String.raw`
.hub-icon-count{font-size:11.5px;color:var(--text2);font-weight:500;line-height:1.4;margin-top:3px}
#iconSettings .icon-settings-head{margin:20px 4px 8px;min-height:32px}
#iconSettings .icon-settings-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 9px}
#iconSettings .icon-settings-heading .hub-icon-count{margin:0}
#iconSettings .icon-add-source{min-height:32px;padding:2px 4px;white-space:nowrap}
#iconSettings .icon-settings-hint{margin:8px 4px 0;font-size:11.5px;line-height:1.5;color:var(--text2)}
#iconSourceList .hub-icon-source{gap:3px;padding:5px 10px 5px 14px;min-width:0;cursor:default}
.hub-icon-open{min-height:44px;align-self:stretch}
.hub-icon-glyph{display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;border-radius:8px;background:var(--field);color:var(--accent)}
.hub-icon-glyph svg,.hub-icon-more svg{width:16px;height:16px;display:block}
.hub-icon-source .hub-icon-name{min-width:0;display:flex;align-items:center;gap:5px}
.hub-icon-source .hub-title{font-size:14px;font-weight:600}
.hub-icon-source .hub-icon-chev{flex:none;width:11px;height:11px;color:var(--text3)}
.hub-icon-source .hub-muted{display:flex;gap:5px;align-items:center;margin-top:2px}
.hub-icon-source .hub-muted>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis}
.hub-icon-source .hub-dot{width:5px;height:5px;flex-basis:5px}
.hub-icon-source-actions{display:flex;align-items:center;gap:0;flex:none}
.hub-icon-more,.hub-icon-switch{display:grid;place-items:center;box-sizing:border-box;padding:0;border:0;background:none;color:var(--text2);cursor:pointer;width:40px;height:44px;flex:none;border-radius:9px}
.hub-icon-more:disabled,.hub-icon-switch:disabled{opacity:.55;cursor:default}
.hub-icon-more:hover:not(:disabled),.hub-icon-switch:hover:not(:disabled){background:var(--field)}
.hub-icon-switch .hub-switch-track{display:block;box-sizing:border-box;width:34px;height:20px;border-radius:20px;background:var(--field);border:1px solid var(--field-brd);padding:2px}
.hub-icon-switch .hub-switch-track::before{content:"";display:block;width:14px;height:14px;border-radius:50%;background:var(--text3);transition:transform .15s}
.hub-icon-switch[aria-checked=true] .hub-switch-track{background:var(--accent);border-color:var(--accent)}
.hub-icon-switch[aria-checked=true] .hub-switch-track::before{transform:translateX(14px);background:white}
.hub-icon-pulse{animation:hub-icon-pulse 1.1s ease-in-out infinite}@keyframes hub-icon-pulse{50%{opacity:.35}}
.hub-icon-empty{padding:14px 16px;margin:0;color:var(--text2);font-size:13px;line-height:1.5}
.hub-menu-note{overflow-wrap:anywhere;white-space:pre-wrap}
.hub-preview-overlay.modal-overlay{padding:0;align-items:stretch}
.hub-preview.modal{display:flex;flex-direction:column;width:100%;height:100dvh;max-height:100dvh;max-width:none;border:0;border-radius:0;padding:0;background:var(--bg);overflow:hidden}
.hub-preview-head{padding:calc(12px + env(safe-area-inset-top,0px)) 14px 9px;border-bottom:1px solid var(--div);flex:none}
.hub-preview-inner{width:100%;max-width:620px;min-width:0;margin-inline:auto}
.hub-preview-head h3{margin:0;font-size:17px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hub-preview-head .input{margin:9px 0 0;width:100%;font-size:16px}
.hub-preview-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px 14px calc(18px + env(safe-area-inset-bottom,0px))}
.hub-preview-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;min-width:0}
.hub-preview-tile{display:grid;justify-items:center;align-content:start;min-width:0;gap:5px;padding:8px 4px;border:1px solid var(--div);border-radius:12px;background:var(--card);color:var(--text2);cursor:pointer;font:inherit;font-size:11px}
.hub-preview-tile img,.hub-preview-placeholder{display:grid;place-items:center;width:40px;height:40px;object-fit:contain;color:var(--text3)}
.hub-preview-tile span:last-child{display:block;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hub-preview-foot{margin:12px 0 0;text-align:center;color:var(--text2);font-size:12px}
.hub-preview-retry{display:block;margin:8px auto}
.hub-preview-retry[hidden]{display:none}
@media(max-width:520px){.hub-preview-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){.hub-icon-pulse{animation:none}.hub-icon-switch .hub-switch-track::before{transition:none}}
.icon-settings-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:24px}.icon-settings-head .set-sec{margin:0}.icon-source{padding:16px;border-bottom:1px solid var(--div)}.icon-source:last-child{border:0}.icon-source strong{display:block;overflow-wrap:anywhere}.icon-source-url,.icon-source-status{font-size:12px;color:var(--text2);overflow-wrap:anywhere;line-height:1.7;margin:5px 0}.icon-source-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.icon-source-actions .btn{font-size:12px;padding:8px 10px}.icon-error{color:#d66d66!important;white-space:pre-wrap;overflow-wrap:anywhere}.icon-overlay .icon-modal{width:100%;max-width:620px;padding:0;max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden}.icon-head{display:flex;align-items:center;gap:10px;padding:20px 22px;border-bottom:1px solid var(--div);flex-shrink:0}.icon-head h3{margin:0!important;flex:1;min-width:0}.icon-head button{border:0;background:var(--field);color:var(--text);border-radius:9px;min-width:38px;min-height:38px;font:inherit}.icon-body{padding:18px 22px;overflow-y:auto;min-height:0}.icon-footer{display:flex;gap:10px;border-top:1px solid var(--div);padding:16px 22px;flex-shrink:0}.icon-footer button{flex:1;justify-content:center;min-height:44px}.icon-two-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.icon-current{display:flex;align-items:center;gap:13px;margin:12px 0}.icon-current img{width:58px;height:58px;object-fit:contain;border-radius:12px;background:var(--field)}.icon-placeholder{width:58px;height:58px;display:grid;place-items:center;border-radius:12px;background:var(--field);color:var(--text2);flex-shrink:0}.icon-current-copy{min-width:0;flex:1;overflow-wrap:anywhere;font-size:13px}.icon-help{font-size:12px;color:var(--text2);line-height:1.7;margin-top:7px;overflow-wrap:anywhere}.icon-field-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.icon-form-status{margin-top:12px;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.icon-search-row{display:flex;gap:8px;margin:12px 0}.icon-search-row .input{flex:1;min-width:0;margin:0}.icon-search-row button{flex-shrink:0}.icon-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:10px}.icon-tile{position:relative;min-width:0;min-height:122px;display:flex;align-items:center;flex-direction:column;justify-content:center;gap:8px;background:var(--field);border:1px solid var(--field-brd);border-radius:13px;padding:13px 6px;color:var(--text);font:inherit;cursor:pointer}.icon-tile[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.icon-tile[aria-pressed=true]::after{content:'✓';position:absolute;right:5px;top:4px;color:var(--accent);font-weight:700}.icon-tile img{width:48px;height:48px;border-radius:10px;object-fit:contain}.icon-tile-name{font-size:11px;text-align:center;overflow-wrap:anywhere;line-height:1.4}.icon-tile-load{height:48px;display:grid;place-items:center;font-size:11px;color:var(--text2)}.icon-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:15px 0;font-size:12px;color:var(--text2)}.icon-large{display:flex;align-items:center;gap:14px;background:var(--field);border-radius:13px;padding:13px}.icon-large-image{width:82px;height:82px;background:var(--bg);border-radius:12px;flex-shrink:0;display:grid;place-items:center}.icon-large-image[data-bg=light]{background:#fafafa}.icon-large-image[data-bg=dark]{background:#17171c}.icon-large-image img{width:70px;height:70px;object-fit:contain;border-radius:12px}.icon-large-copy{font-size:12px;min-width:0;overflow-wrap:anywhere;flex:1}.icon-large-copy strong{display:block;font-size:13px}.icon-preview-bg{margin-top:8px;max-width:140px;border:1px solid var(--field-brd);border-radius:7px;background:var(--bg);color:var(--text);font:inherit;padding:5px}.icon-query-status{font-size:12px;color:var(--text2);min-height:20px;line-height:1.7}.icon-url-preview{display:flex;gap:8px}.icon-url-preview .input{min-width:0;flex:1}.icon-url-preview button{flex-shrink:0;font-size:12px;padding:10px}.icon-none{padding:24px 0;text-align:center;color:var(--text2);font-size:13px;line-height:1.8}.icon-overlay [hidden]{display:none!important}
@media(max-width:460px){.icon-overlay{padding:10px!important}.icon-head{padding:16px 14px}.icon-body{padding:15px 14px}.icon-footer{padding:14px}.icon-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.icon-two-fields{grid-template-columns:1fr;gap:0}.icon-overlay input,.icon-overlay select{font-size:16px!important}.icon-tile{min-height:120px}.icon-source-actions .btn,.icon-head button,.icon-preview-bg{min-height:44px}.icon-url-preview{flex-wrap:wrap}.icon-url-preview .input{flex-basis:100%}}
.icon-subscription-row{margin-top:0}
.icon-subscription-row .hub-avatar{width:58px;height:58px;flex-basis:58px;font-size:21px}
.icon-subscription-row .hub-avatar img{width:100%;height:100%;background:none}
.icon-subscription-row strong,.icon-subscription-row small{display:block}
.icon-subscription-row small{color:var(--text2);margin-top:3px}
`;

export const iconUI=String.raw`
(function(){
var settingsVersion=0;
function iconEsc(x){return esc(String(x==null?'':x));}
async function iconCall(path,opts){var r=await api(path,Object.assign({timeout:120000},opts||{}));if(!r||(r.error&&!r.ok))throw Error(r?r.error:'请求未确认，请重试');return r;}
var area=document.createElement('section');area.id='iconSettings';
area.innerHTML='<div class="icon-settings-head"><div class="icon-settings-heading"><h2 class="set-sec">图标集</h2><span class="hub-icon-count" aria-live="polite"></span></div><button type="button" class="hub-link icon-add-source" id="addIconSource">＋ 添加来源</button></div><div class="set-group" id="iconSourceList"></div><p class="icon-settings-hint">点按来源可预览；停用的来源不会出现在合集选图中。</p>';
document.querySelector('#page-settings .stat-box').after(area);
document.getElementById('addIconSource').onclick=function(){editSource(null);};
var libraryGlyph='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>';
var sourceChev='<svg class="hub-icon-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>';
var sourceDots='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.65"/><circle cx="12" cy="12" r="1.65"/><circle cx="19" cy="12" r="1.65"/></svg>';
function iconSourceState(s){
 var count=(Number(s.count)||0)+' 个图标';
 if(s.syncing)return {text:count+' · 同步中',tone:'hub-warn hub-icon-pulse'};
 if(!s.enabled)return {text:count+' · 已停用',tone:''};
 if(s.last_error)return {text:count+' · 同步失败',tone:'hub-bad',error:true};
 if(!s.last_success_at)return {text:count+' · 尚未同步',tone:''};
 return {text:count+' · '+hubRelative(s.last_success_at,false),tone:'hub-good'};
}
function paintIconState(row,s){
 var st=iconSourceState(s),label=row.querySelector('.hub-muted>span:last-child');
 row.querySelector('.hub-dot').className='hub-dot '+st.tone;
 label.classList.toggle('hub-bad',!!st.error);
 label.textContent=st.text;
 label.title=s.last_error||st.text;
}
async function runIconAction(row,s,action){
 var controls=Array.from(row.querySelectorAll('.hub-icon-source-actions button'));
 if(!row.isConnected||controls.some(function(b){return b.disabled;}))return;
 if(action==='delete'){
  if(!await showConfirmAsync('移除图标源「'+iconEsc(s.name)+'」？合集和订阅已保存的图片会保留。'))return;
  if(!row.isConnected||controls.some(function(b){return b.disabled;}))return;
 }
 var target=action==='toggle'?'toggle':'more';
 controls.forEach(function(b){b.disabled=true;});
 if(action==='refresh')paintIconState(row,Object.assign({},s,{syncing:true}));
 try{
  var r=await iconCall('/api/admin/icon-sources/'+encodeURIComponent(s.id)+(action==='refresh'?'/refresh':''),{method:action==='delete'?'DELETE':action==='refresh'?'POST':'PATCH',json:action==='toggle'?{enabled:!s.enabled}:undefined});
  toast(r.synced===false?'刷新失败：'+r.error:action==='refresh'?'图标清单已刷新':'已更新');
  if(await loadIconSources()&&document.activeElement===document.body&&!_anyModalOpen()&&state.tab==='settings'){
   var next=Array.from(area.querySelectorAll('[data-action="'+target+'"]')).find(function(b){return b.dataset.source===s.id;});
   if(next)next.focus({preventScroll:true});
  }
 }catch(e){toast(e.message);}
 finally{if(row.isConnected){paintIconState(row,s);controls.forEach(function(b){b.disabled=false;});}}
}
function showIconActions(row,s){
 hubActionMenu(s.name||'图标源',[
  ['刷新图标源',function(){void runIconAction(row,s,'refresh');}],
  ['编辑图标源',function(){editSource(s);}],
  ['删除图标源',function(){void runIconAction(row,s,'delete');},true]
 ],s.last_error?'最近一次同步失败：'+s.last_error:'');
}
async function loadIconSources(){var version=++settingsVersion,box=document.getElementById('iconSourceList');
 try{
  var list=await iconCall('/api/admin/icon-sources');if(version!==settingsVersion)return false;if(!Array.isArray(list))throw Error('无法读取图标源');
  var sum=list.reduce(function(n,s){return n+(Number(s.count)||0);},0);
  area.querySelector('.hub-icon-count').textContent=list.length+' 个来源 · '+sum+' 个图标';
  box.replaceChildren();
  if(!list.length){box.innerHTML='<p class="hub-icon-empty">还没有图标源，添加后即可预览，也能用作合集图标。</p>';return true;}
  list.forEach(function(s){
   var row=document.createElement('div');row.className='set-row hub-icon-source';
   row.innerHTML='<button type="button" class="hub-open hub-icon-open" data-action="preview"><span class="hub-icon-glyph">'+libraryGlyph+'</span>'+
    '<span class="hub-meta"><span class="hub-icon-name"><span class="hub-title">'+iconEsc(s.name||'图标源')+'</span>'+sourceChev+'</span><span class="hub-muted"><span class="hub-dot" aria-hidden="true"></span><span></span></span></span></button>'+
    '<div class="hub-icon-source-actions"><button type="button" class="hub-icon-switch" data-action="toggle" role="switch" aria-checked="'+Boolean(s.enabled)+'"><span class="hub-switch-track" aria-hidden="true"></span></button>'+
    '<button type="button" class="hub-icon-more" data-action="more">'+sourceDots+'</button></div>';
   paintIconState(row,s);
   row.querySelectorAll('[data-action]').forEach(function(button){
    var action=button.dataset.action;button.dataset.source=s.id;
    button.setAttribute('aria-label',({preview:'预览',toggle:'启用',more:'管理'}[action])+'图标源：'+s.name);
    button.onclick=function(){
     if(action==='preview')previewSource(s);
     else if(action==='more')showIconActions(row,s);
     else void runIconAction(row,s,'toggle');
    };
   });
   box.append(row);
  });return true;
 }catch(e){
  if(version===settingsVersion){if(!box.querySelector('.hub-icon-source'))box.innerHTML='<p class="hub-icon-empty hub-bad">'+iconEsc(e.message)+'</p>';else toast(e.message);}
  return false;
 }}
function previewSource(s){
 var oldFocus=document.activeElement,overlay=document.createElement('div');overlay.className='modal-overlay hub-preview-overlay';
 overlay.innerHTML='<section class="modal hub-preview" role="dialog" aria-modal="true"><header class="hub-preview-head"><div class="hub-preview-inner"><div class="hub-row"><div class="hub-meta"><h3></h3><div class="hub-icon-count" data-role="count"></div></div><button class="btn btn-sm" type="button" data-role="close">关闭</button></div><input type="search" class="input" aria-label="搜索图标" placeholder="搜索图标名称"></div></header>'+
  '<div class="hub-preview-body"><div class="hub-preview-inner"><div class="hub-preview-grid"></div><p class="hub-preview-foot" role="status"></p><button type="button" class="btn btn-sm hub-preview-retry" hidden>重试</button></div></div></section>';
 var modal=overlay.querySelector('.hub-preview'),head=overlay.querySelector('h3'),count=overlay.querySelector('[data-role=count]'),search=overlay.querySelector('input'),closeButton=overlay.querySelector('[data-role=close]');
 var body=overlay.querySelector('.hub-preview-body'),grid=overlay.querySelector('.hub-preview-grid'),foot=overlay.querySelector('.hub-preview-foot'),retry=overlay.querySelector('.hub-preview-retry');
 var title=s.name||'图标预览',page=0,pages=1,q='',version=0,loading=false,failed=false,timer,debouncing=false;
 head.textContent=title;modal.setAttribute('aria-label',title+' · 图标预览');
 count.textContent=(Number(s.count)||0)+' 个图标'+(s.enabled?'':' · 已停用');
 document.body.append(overlay);closeButton.focus();
 function close(){version++;clearTimeout(timer);overlay.remove();document.removeEventListener('keydown',onKey);if(oldFocus&&oldFocus.isConnected)oldFocus.focus();}
 function onKey(e){if(e.key==='Escape'&&document.querySelector('.modal-overlay:last-child')===overlay){e.preventDefault();close();}}
 closeButton.onclick=close;document.addEventListener('keydown',onKey);
 function imageURL(row){
  try{if(String(row.preview_url||'').startsWith('/api/icons/'))return row.preview_url;
   var u=new URL(row.url);if(u.protocol==='https:'||u.protocol==='http:')return u.href;
  }catch(e){}return '';
 }
 function tile(row){
  var b=document.createElement('button'),label=document.createElement('span'),placeholder=document.createElement('span'),name=String(row.name||'未命名图标'),url=imageURL(row);
  b.type='button';b.className='hub-preview-tile';b.title=name;b.setAttribute('aria-label','复制图标链接：'+name);
  placeholder.className='hub-preview-placeholder';placeholder.textContent='◇';
  if(url){var im=document.createElement('img');im.alt='';im.loading='lazy';im.decoding='async';im.referrerPolicy='no-referrer';im.onerror=function(){im.replaceWith(placeholder);};im.src=url;b.append(im);}
  else b.append(placeholder);
  label.textContent=name;b.append(label);b.onclick=function(){copyText(row.url);};return b;
 }
 async function next(){
  if(debouncing||loading||failed||page>=pages)return;
  var stamp=version,nextPage=page+1,success=false;
  loading=true;foot.textContent='加载中…';
  try{
   var params=new URLSearchParams({source:s.id,preview:'1',q:q,size:'60',page:String(nextPage)});
   var r=await iconCall('/api/admin/icons?'+params.toString(),{timeout:15000});
   if(!overlay.isConnected||stamp!==version)return;
   if(!Array.isArray(r.items)||r.page!==nextPage||!Number.isInteger(r.pages))throw Error('图标列表返回异常');
   pages=r.pages;page=nextPage;var frag=document.createDocumentFragment();
   r.items.forEach(function(row){frag.append(tile(row));});grid.append(frag);
   count.textContent=(q?'找到 ':'')+r.total+' 个图标'+(s.enabled?'':' · 已停用');
   foot.textContent=!r.total?'没有匹配的图标':page<pages?'下滑加载更多':'已全部显示 · 点击图标复制链接';
   success=!!r.items.length;
  }catch(e){if(stamp===version&&overlay.isConnected){if(!state.isAuthed){close();return;}failed=true;retry.hidden=false;foot.textContent='加载失败：'+e.message;}}
  finally{if(stamp===version&&overlay.isConnected){
   loading=false;
   if(success&&page<pages&&body.scrollHeight<=body.clientHeight+120)requestAnimationFrame(function(){if(stamp===version)void next();});
  }}
 }
 retry.onclick=function(){failed=false;retry.hidden=true;void next();};
 search.oninput=function(){
  version++;clearTimeout(timer);debouncing=true;retry.hidden=true;
  timer=setTimeout(function(){q=search.value.trim();page=0;pages=1;loading=false;failed=false;debouncing=false;grid.replaceChildren();body.scrollTop=0;void next();},250);
 };
 body.addEventListener('scroll',function(){if(body.scrollHeight-body.scrollTop-body.clientHeight<240)void next();},{passive:true});
 void next();
}
function editSource(source){showModal(source?'编辑图标源':'添加图标源','<label>名称（可选）</label><input class="input" id="iconSourceName" value="'+iconEsc(source?source.name:'')+'" placeholder="自动读取图标集名称"><label>图标集 JSON URL</label><input class="input" id="iconSourceUrl" '+(source?'readonly ':'')+'value="'+iconEsc(source?source.url:'')+'" placeholder="https://.../Logo.json"><p class="icon-help">支持 {name, icons:[{name,url}]} 格式。修改链接请新建来源。</p><p class="icon-error icon-help" id="iconSourceError"></p>',async function(close){var n=document.getElementById('iconSourceName').value.trim(),u=document.getElementById('iconSourceUrl').value.trim(),button=document.getElementById('mC');button.disabled=true;
  try{var r=await iconCall('/api/admin/icon-sources'+(source?'/'+source.id:''),{method:source?'PATCH':'POST',json:source?{name:n||source.name}:{url:u,...(n?{name:n}:{})}});close();toast(r.synced===false?'来源已保存，同步失败：'+r.error:'图标源已保存');await loadIconSources();}
  catch(e){document.getElementById('iconSourceError').textContent=e.message;button.disabled=false;}});}
var baseRenderSettings=renderSettings;renderSettings=function(){baseRenderSettings();return loadIconSources();};
showAddCol=function(){openIconCollection(null);};
showEditCol=function(id){var col=state.collections.find(function(c){return c.id===id;});if(col)openIconCollection(col);};
window.openSubscriptionIcon=function(id){var source=state.subscriptions.find(function(s){return s.id===id;});if(source)openIconCollection(null,source);};

function openIconCollection(col,source){
 var originalCustom=source&&source.custom_icon_url||'',upstream=source&&source.upstream_icon_url||'';
 var heading=source?'变更订阅图标':col?'编辑合集':'新建合集',saveLabel=source?'保存图标':'保存合集';
 var draft={title:col?col.title:'',slug:col?col.slug:'',description:col?col.description:'',url:source?originalCustom:col?col.icon_url||'':'',autoAll:!!(col&&col.autoAll),entry:null,changed:false,mode:originalCustom?'custom':'auto'};
 var fields=source?'':'<div class="icon-two-fields"><div><label>标题</label><input class="input" name="title" maxlength="200" value="'+iconEsc(draft.title)+'"></div><div><label>路径</label><input class="input" name="slug" value="'+iconEsc(draft.slug)+'"></div></div><label>描述</label><input class="input" name="description" value="'+iconEsc(draft.description)+'"><label>合集图标</label>';
 var help=source?'<div class="icon-help">支持 HTTPS 的 PNG、JPEG、WebP（最多 2 MiB）。自定义图标不会被同步覆盖。</div>':'<div class="icon-help">图片会保存到本站；不修改图标时保留原地址。</div><label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="autoAll" '+(draft.autoAll?'checked':'')+'>自动包含全部模块（默认关闭，最多 1000 项）</label>';
 var previousFocus=document.activeElement,overlay=document.createElement('div');overlay.className='modal-overlay icon-overlay';
 overlay.innerHTML='<div class="modal icon-modal" role="dialog" aria-modal="true" aria-label="'+heading+'"><header class="icon-head"><button type="button" data-role="back" aria-label="返回表单" hidden>←</button><h3 data-role="heading">'+heading+'</h3><button type="button" data-role="close" aria-label="关闭">×</button></header><div class="icon-body"><div data-role="form">'+fields+'<div class="icon-current" data-role="current"></div><div class="icon-field-actions"><button type="button" class="btn btn-sm" data-role="open">选择图标</button><button type="button" class="btn btn-sm" data-role="upload">上传图片</button><button type="button" class="btn btn-sm" data-role="clear">'+(source?'恢复自动图标':'清除图标')+'</button></div><label for="iconEditURL">图标 URL（可手填）</label><div class="icon-url-preview"><input class="input" name="url" id="iconEditURL" type="url" value="'+iconEsc(draft.url)+'" placeholder="https://.../icon.png"><button type="button" class="btn" data-role="preview">预览地址</button></div>'+help+'<div class="icon-form-status" data-role="status" aria-live="polite"></div></div><div data-role="picker" hidden><label data-role="source-label" hidden>图标集<select class="input" name="source"></select></label><div class="icon-search-row"><input class="input" name="search" type="search" aria-label="搜索图标" placeholder="搜索名称或颜色，如 purple、蓝色"><button type="button" class="btn btn-sm" data-role="reset">清除</button></div><p class="icon-query-status" data-role="query-status" aria-live="polite"></p><div class="icon-grid" data-role="grid"></div><div class="icon-nav"><button type="button" class="btn btn-sm" data-role="prev">上一页</button><span data-role="page"></span><button type="button" class="btn btn-sm" data-role="next">下一页</button></div><div class="icon-large"><div class="icon-large-image" data-role="large-image"></div><div class="icon-large-copy"><span>当前候选</span><strong data-role="large-name" aria-live="polite">请选择图标</strong><span data-role="large-source"></span><br><select class="icon-preview-bg" name="background" aria-label="预览底色"><option value="auto">跟随外观</option><option value="light">浅色底板</option><option value="dark">深色底板</option></select></div></div></div></div><footer class="icon-footer"><button type="button" class="btn" data-role="cancel">取消</button><button type="button" class="btn btn-primary" data-role="confirm">'+saveLabel+'</button></footer></div>';
 document.body.appendChild(overlay);
 var get=function(role){return overlay.querySelector('[data-role="'+role+'"]');},field=function(n){return overlay.querySelector('[name="'+n+'"]');};
 var closed=false,busy=false,picking=false,version=0,page=1,pages=1,candidate=null,sourceRows=[],rows=[];
 function status(text,error){get('status').textContent=text;get('status').classList.toggle('icon-error',!!error);}
 function img(url,label){var el=document.createElement('img');el.src=url;el.alt=label||'合集图标';el.referrerPolicy='no-referrer';el.onerror=function(){el.replaceWith(document.createTextNode('图片不可用'));};return el;}
 function updateButtons(){get('clear').disabled=source?draft.mode==='auto':!draft.url;get('confirm').disabled=!!source&&!draft.changed;}
 function current(){var box=get('current');box.replaceChildren();
  if(source){
   box.classList.add('icon-subscription-row');
   var avatar=document.createElement('span'),copy=document.createElement('div'),title=document.createElement('strong'),label=document.createElement('small');
   avatar.className='hub-avatar';avatar.textContent=hubInitial(source.title,'订');
   var activeURL=draft.mode==='custom'?draft.url:upstream;
   hubAvatarImage(avatar,activeURL);
   if(activeURL){
    var image=avatar.querySelector('img');image.loading='eager';
    image.addEventListener('error',function(){label.textContent=(draft.mode==='custom'?'自定义图标':'上游清单图标')+' · 图片无法加载';});
   }
   title.textContent=source.title||'订阅源';label.textContent=draft.mode==='custom'?(draft.entry?draft.entry.name+' · 自定义图标':'自定义图标'):upstream?'自动 · 上游清单图标':'自动 · 显示首字';
   copy.className='icon-current-copy';copy.append(title,label);box.append(avatar,copy);updateButtons();return;
  }
  if(draft.url)box.appendChild(img(draft.url,draft.entry?draft.entry.name:'当前合集图标'));else{var placeholder=document.createElement('span');placeholder.className='icon-placeholder';placeholder.textContent='◇';box.appendChild(placeholder);}
  var text=document.createElement('div');text.className='icon-current-copy';text.textContent=draft.entry?draft.entry.name: draft.url?(draft.url.startsWith('/api/icons/')?'已缓存图标':'自定义图标'):'未设置图标';box.appendChild(text);get('clear').disabled=!draft.url;}
 function close(){if(busy)return;closed=true;version++;overlay.remove();previousFocus&&previousFocus.focus();}
 function read(){if(source)return;draft.title=field('title').value.trim();draft.slug=field('slug').value.trim();draft.description=field('description').value.trim();if(field('autoAll'))draft.autoAll=field('autoAll').checked;}
 function leavePicker(){picking=false;version++;get('picker').hidden=true;get('form').hidden=false;get('back').hidden=true;get('heading').textContent=heading;get('confirm').textContent=saveLabel;updateButtons();get('open').focus();}
 function showCandidate(){get('large-image').replaceChildren();if(candidate&&candidate.preview_url)get('large-image').appendChild(img(candidate.preview_url,candidate.name));get('large-name').textContent=candidate?candidate.name:'请选择图标';get('large-source').textContent=candidate?candidate.source_name:'';get('confirm').disabled=!candidate||!candidate.preview_url||busy;get('grid').querySelectorAll('[data-entry]').forEach(function(b){b.setAttribute('aria-pressed',String(!!candidate&&b.dataset.entry===candidate.id));});}
 async function cacheRow(row,tile,stamp){if(row.preview_url)return;var mark=tile.querySelector('.icon-tile-load');if(mark)mark.textContent='加载中…';
  try{var r=await iconCall('/api/admin/icons/'+row.id+'/cache',{method:'POST'});if(closed||!picking||stamp!==version)return;row.preview_url=r.url;var image=img(r.url,row.name);if(mark)mark.replaceWith(image);if(candidate&&candidate.id===row.id){candidate.preview_url=r.url;showCandidate();}}
  catch(e){if(closed||stamp!==version)return;row.failed=true;if(mark)mark.textContent='失败 · 点击重试';tile.title=e.message;}}
 async function query(){var stamp=++version;get('query-status').textContent='正在加载图标…';get('grid').replaceChildren();get('prev').disabled=get('next').disabled=true;
  try{var result=await iconCall('/api/admin/icons?source='+encodeURIComponent(field('source').value)+'&q='+encodeURIComponent(field('search').value)+'&page='+page);if(closed||!picking||stamp!==version)return;
   rows=result.items;pages=result.pages;if(page>pages){page=pages;void query();return;}get('page').textContent=page+' / '+pages;get('query-status').textContent=result.total?'共 '+result.total+' 个图标':'没有匹配图标，可清除搜索或切换来源。';get('prev').disabled=page<=1;get('next').disabled=page>=pages;
   rows.forEach(function(row){var button=document.createElement('button');button.type='button';button.className='icon-tile';button.dataset.entry=row.id;button.setAttribute('aria-label','选择 '+row.name+' · '+row.source_name);button.setAttribute('aria-pressed',String(!!candidate&&candidate.id===row.id));
    if(row.preview_url)button.appendChild(img(row.preview_url,row.name));else{var mark=document.createElement('span');mark.className='icon-tile-load';mark.textContent='待加载';button.appendChild(mark);}
    var label=document.createElement('span');label.className='icon-tile-name';label.textContent=row.name;button.appendChild(label);button.title=row.name+' · '+row.source_name;button.onclick=function(){candidate=row;showCandidate();if(!row.preview_url)void cacheRow(row,button,stamp);};get('grid').appendChild(button);});
   // Three workers, no unbounded per-page fan-out; the backend independently limits concurrency.
   var index=0;async function worker(){while(index<rows.length&&!closed&&picking&&stamp===version){var i=index++,row=rows[i],tile=get('grid').children[i];if(tile)await cacheRow(row,tile,stamp);}}
   void Promise.all([worker(),worker(),worker()]);
  }catch(e){if(stamp===version)get('query-status').textContent='加载失败：'+e.message;}}
 get('open').onclick=async function(){if(busy)return;read();picking=true;candidate=null;get('form').hidden=true;get('picker').hidden=false;get('back').hidden=false;get('heading').textContent=source?'选择订阅图标':'选择合集图标';get('confirm').textContent='使用此图标';get('confirm').disabled=true;get('query-status').textContent='正在读取图标源…';showCandidate();
  try{sourceRows=(await iconCall('/api/admin/icon-sources')).filter(function(s){return s.enabled;});if(closed||!picking)return;field('source').innerHTML='<option value="">全部图标集</option>'+sourceRows.map(function(s){return '<option value="'+iconEsc(s.id)+'">'+iconEsc(s.name)+'</option>';}).join('');get('source-label').hidden=sourceRows.length<=1;
   if(!sourceRows.length){get('query-status').textContent='还没有可用图标源。请到设置添加，或返回手填图片地址。';get('grid').replaceChildren();return;}page=1;void query();field('search').focus();}
  catch(e){get('query-status').textContent=e.message;}};
 function validURL(value){
  if(/^\/api\/icons\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value))return true;
  try{var u=new URL(value);return (source?u.protocol==='https:':/^https?:$/.test(u.protocol))&&!u.username&&!u.password;}
  catch(e){return false;}
 }
 // 3.5.8：直接上传图片作图标。
 get('upload').onclick=function(){if(busy)return;var input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
  input.onchange=async function(){var file=input.files&&input.files[0];if(!file)return;
   if(file.size>2*1024*1024){status('图片超过 2 MiB，请压缩后再上传。',true);return;}
   if(!/^image\/(png|jpeg|webp)$/.test(file.type||'')&&!/\.(png|jpe?g|webp)$/i.test(file.name)){status('只支持 PNG、JPEG、WebP 图片。',true);return;}
   busy=true;get('upload').disabled=true;status('正在上传并校验图片…');
   try{var fd=new FormData();fd.append('file',file);var r=await api('/api/admin/icons/upload',{method:'POST',body:fd,timeout:60000});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');
    if(closed)return;draft.url=r.url;draft.entry=null;draft.mode='custom';draft.changed=true;field('url').value=r.url;current();status('图片已上传（'+fmt(r.size)+'），保存后生效。');}
   catch(e){if(!closed)status('上传失败：'+e.message,true);}
   finally{busy=false;if(!closed)get('upload').disabled=false;updateButtons();}};
  input.click();};
 get('clear').onclick=function(){draft.url='';draft.entry=null;draft.mode='auto';draft.changed=source?!!originalCustom:true;field('url').value='';current();status(source?(originalCustom?'保存后恢复自动图标。':'已还原为自动图标。'):'已清空图标草稿，保存后生效。');};
 field('url').oninput=function(){draft.url=field('url').value.trim();draft.entry=null;draft.mode='custom';draft.changed=true;updateButtons();status('地址已修改，保存时校验并缓存。');};
 get('preview').onclick=function(){draft.url=field('url').value.trim();if((draft.url||source&&draft.mode==='custom')&&!validURL(draft.url)){status(source?'请输入有效的 HTTPS 图片地址。':'请输入无账号密码的 HTTP(S) 图片地址。',true);return;}current();status('这是浏览器地址预览；实际保存需通过后端下载校验。');};
 field('background').onchange=function(){get('large-image').dataset.bg=field('background').value;};
 field('search').oninput=debounce(function(){page=1;void query();},250);field('source').onchange=function(){page=1;void query();};get('reset').onclick=function(){field('search').value='';page=1;void query();};get('prev').onclick=function(){if(page>1){page--;void query();}};get('next').onclick=function(){if(page<pages){page++;void query();}};
 get('back').onclick=leavePicker;get('cancel').onclick=function(){if(busy)return;if(picking)leavePicker();else close();};get('close').onclick=close;overlay.onclick=function(e){if(e.target===overlay){if(picking)leavePicker();else close();}};
 overlay.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();if(!busy){if(picking)leavePicker();else close();}}if(e.key==='Tab'){var controls=Array.from(overlay.querySelectorAll('button,input,select')).filter(function(x){return !x.disabled&&x.getClientRects().length;});var first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
 get('confirm').onclick=async function(){if(busy)return;if(picking){if(!candidate||!candidate.preview_url)return;draft.entry=candidate;draft.url=candidate.preview_url;draft.mode='custom';draft.changed=true;field('url').value=draft.url;leavePicker();current();status('图标已选入草稿，保存后生效。');return;}
  if(source){
   if(!draft.changed)return;
   if(draft.mode==='custom'&&!validURL(draft.url)){status('请选择图标库中的图标，或输入有效的 HTTPS 图片地址。',true);return;}
   var changes={revision:source.revision,expected_icon_url:originalCustom,icon_mode:draft.mode};
   if(draft.mode==='custom')changes.icon_url=draft.url;
   busy=true;overlay.querySelectorAll('button,input,select').forEach(function(el){el.disabled=true;});status('正在保存图标…');
   try{
    await iconCall('/api/admin/subscriptions/'+encodeURIComponent(source.id)+'/icon',{method:'PATCH',json:changes});
    busy=false;close();toast(draft.mode==='auto'?'已恢复自动图标':'订阅图标已更新');await loadAll();
   }catch(e){busy=false;if(!state.isAuthed){close();return;}overlay.querySelectorAll('button,input,select').forEach(function(el){el.disabled=false;});updateButtons();status('保存失败：'+e.message,true);}
   return;
  }
  read();if(!draft.title){status('请输入合集标题。',true);return;}if((!col||draft.slug!==col.slug)&&!/^[A-Za-z0-9]+$/.test(draft.slug)){status('路径只能包含英文字母和数字。',true);return;}
  var body={title:draft.title,slug:draft.slug,description:draft.description,autoAll:draft.autoAll};if(col){body.id=col.id;body.expectedUpdatedAt=col.updated_at;}if(draft.changed)body.icon_url=draft.url;
  busy=true;overlay.querySelectorAll('button,input,select').forEach(function(el){el.disabled=true;});status('正在保存，请稍候…');
  try{await iconCall('/api/admin/collections',{method:col?'PATCH':'POST',json:body});busy=false;close();toast(col?'合集已更新':'合集已创建');await loadAll();}
  catch(e){busy=false;overlay.querySelectorAll('button,input,select').forEach(function(el){el.disabled=false;});status('保存失败：'+e.message,true);}};
 current();(source?get('open'):field('title')).focus();
}
})();
`;

