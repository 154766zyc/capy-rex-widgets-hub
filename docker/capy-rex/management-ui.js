import {displayRemoteError} from './remote.js';
export const managementStyles=String.raw`
:root{--hub-good:#167145;--hub-warn:#895300;--hub-bad:#b82940}
.dark{--hub-good:#63d89a;--hub-warn:#ffb667;--hub-bad:#ff8d9e}
.hub-col,.hub-source{min-width:0;overflow:hidden;padding:13px 14px}
.hub-col:last-child,.hub-source:last-child{margin-bottom:0}
.hub-row{display:flex;align-items:center;gap:8px;min-width:0}
.hub-open{display:flex;align-items:center;gap:10px;min-width:0;flex:1;text-align:left;border:0;background:none;padding:0;color:var(--text);font:inherit;cursor:pointer}
.hub-avatar{width:40px;height:40px;flex:0 0 40px;display:grid;place-items:center;position:relative;overflow:hidden;border-radius:11px;border:1px solid var(--div);background:var(--field);color:var(--accent);font-size:17px;font-weight:700}
.hub-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hub-avatar.has-image{color:transparent}
.hub-source .hub-avatar img{object-fit:contain}
.hub-meta{display:block;min-width:0;flex:1}
.hub-title,.hub-muted{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hub-title{font-size:15px;font-weight:700;line-height:1.3;color:var(--text)}
.hub-muted{color:var(--text2);font-size:11.5px;margin-top:3px;line-height:1.4}
.hub-more{flex:0 0 44px;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--text2);font:inherit;line-height:1;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hub-more svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.hub-more:active{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.hub-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hub-col .rex-import{flex:none;min-height:34px;padding:5px 8px}
.hub-col-foot,.hub-source-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;min-width:0}
.hub-chips{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;flex:1}
.hub-chip-fade{mask-image:linear-gradient(to right,var(--text) calc(100% - 18px),transparent)}
.hub-chip{flex:none;max-width:min(145px,55%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 8px;background:var(--field);border-radius:7px;font-size:11.5px;color:var(--text2)}
.hub-link,.hub-col-empty{flex:none;color:var(--accent);cursor:pointer;font:inherit;font-size:12px;font-weight:650}
.hub-link{background:none;border:0;min-height:30px;padding:0 3px}
.hub-col-empty{display:block;margin-top:10px;min-height:32px;border:1px dashed var(--field-brd);background:var(--field);padding:4px 9px;border-radius:9px}
.hub-help{color:var(--text2);font-size:12px;line-height:1.5;margin:0 0 10px}
.hub-dialog{width:min(100%,480px)}
.hub-dialog #mc[hidden]{display:none}
.hub-menu{display:grid;gap:6px}.hub-menu-item.btn{width:100%;justify-content:flex-start;text-align:left}
.hub-menu-item.hub-danger,.hub-danger{color:var(--hub-bad)}
.hub-members{padding-inline-start:22px;margin:6px 0 0;max-height:49dvh;overflow:auto;overscroll-behavior:contain}
.hub-members li{color:var(--text);font-size:14px;padding:8px 2px;border-bottom:1px solid var(--div);overflow-wrap:anywhere}
.hub-members small{margin-inline-start:8px;color:var(--text2)}
.hub-source-list{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.hub-source-list .hub-source{margin:0}
.hub-pill,.hub-stat{background:var(--field);color:var(--text2);padding:4px 7px;border-radius:8px;font-size:11px;line-height:1.25}
.hub-pill{flex:none;white-space:nowrap;font-weight:650}
.hub-good{color:var(--hub-good)}.hub-warn{color:var(--hub-warn)}.hub-bad{color:var(--hub-bad)}
.hub-stats{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.hub-source-foot{border-top:1px solid var(--div);padding-top:7px}
.hub-source-foot .btn{flex:none}.hub-progress{font-size:11.5px;min-width:0;line-height:1.4;color:var(--text2);overflow-wrap:anywhere}
.hub-error{font-size:12px;color:var(--hub-bad);background:color-mix(in srgb,var(--hub-bad) 9%,var(--field));border-radius:8px;padding:6px 8px;margin:8px 0 0;overflow-wrap:anywhere}
.hub-cut{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hub-detail-list{max-height:48dvh;overflow:auto;overscroll-behavior:contain;margin-top:8px}
.hub-detail{padding:8px 0;border-bottom:1px solid var(--div)}
.hub-detail:last-child{border:0}
.hub-detail-line{display:flex;align-items:center;gap:6px;font-size:13px}
.hub-detail-name{flex:1;min-width:0;overflow-wrap:anywhere}
.hub-detail-version{display:block;color:var(--text2);font-size:11.5px;line-height:1.4;margin:4px 0 0 13px;overflow-wrap:anywhere}
.hub-dot{height:7px;width:7px;flex:0 0 7px;border-radius:50%;background:currentColor}
#groupTabs .ftab{font-family:inherit}
#appMain .header .avatar[role=button]{cursor:pointer;transition:transform .15s}
#appMain .header .avatar[role=button]:active{transform:scale(.94)}
#appMain .header .avatar[aria-busy=true] img{animation:hub-spin .8s linear infinite}
@keyframes hub-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){#appMain .header .avatar[role=button]{transition:none}#appMain .header .avatar[aria-busy=true] img{animation:none}}
@media(max-width:400px){.hub-col,.hub-source{padding:11px 10px}.hub-row{gap:6px}.hub-open{gap:7px}.hub-avatar{width:36px;height:36px;flex-basis:36px}.hub-source .hub-avatar{width:32px;height:32px;flex-basis:32px}}
.rex-import{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid rgba(139,108,205,.25);border-radius:10px;background:rgba(139,108,205,.10);color:var(--accent);padding:8px 10px;font:500 11px inherit;white-space:nowrap;cursor:pointer;flex-shrink:0;min-height:36px}
.rex-import svg,.manage-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.rex-import:disabled{opacity:.38;cursor:default}.select-mode-btn{border:0;background:none;color:var(--accent);font:600 13px inherit;padding:10px;cursor:pointer}.mod-check{width:21px;height:21px;accent-color:var(--accent);flex-shrink:0}.mod-selected{background:rgba(139,108,205,.08)!important}.mod-grip{display:none;cursor:grab;touch-action:auto;flex-shrink:0;color:var(--text3);padding:4px;border:0;background:none}.mod-grip svg{width:15px;height:20px;fill:currentColor}.drop-target{outline:2px solid var(--accent);outline-offset:-2px;background:rgba(139,108,205,.12)!important}.bulk-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(86px + env(safe-area-inset-bottom));width:min(580px,calc(100vw - 32px));background:var(--bg);border:1px solid rgba(139,108,205,.4);box-shadow:0 8px 35px #0003;border-radius:17px;padding:12px 14px;z-index:35}.bulk-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);margin-bottom:10px}.bulk-head strong{color:var(--accent);margin-right:auto}.bulk-head button{border:0;background:none;color:var(--accent);font-size:12px;cursor:pointer;padding:5px}.bulk-actions{display:flex;gap:7px}.bulk-actions button{flex:1;justify-content:center;min-height:40px}.bulk-actions .danger{flex:0 0 65px;color:#d55d75;border-color:#d55d7540}.batch-progress{font-size:12px;line-height:1.8;white-space:pre-wrap;color:var(--text2)}.selecting #modulesList{padding-bottom:120px}.module-badges .badge{font-size:9px;padding:2px 5px;margin-right:5px}.collection-card{padding:19px!important}.collection-title{display:flex;align-items:center;gap:9px;min-width:0}.collection-title h3{font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}.collection-count{flex-shrink:0;color:var(--text2);font-size:10px;background:var(--field);border-radius:6px;padding:4px 7px}.collection-title .btn-xs{margin-left:auto;flex-shrink:0}.collection-description{font-size:12px;line-height:1.6;color:var(--text2);margin-top:8px;overflow-wrap:anywhere}.collection-chips{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}.collection-chip{max-width:100%;display:inline-flex;align-items:center;gap:6px;background:var(--field);border:1px solid var(--field-brd);border-radius:9px;padding:8px 10px;font-size:11px;min-width:0}.collection-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.collection-chip small{font-size:10px;color:var(--text2);flex-shrink:0}.collection-remaining{display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;font-size:11px;color:var(--text2)}.collection-remaining button{color:var(--accent);background:none;border:0;font:inherit;cursor:pointer;padding:6px}.collection-actions{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--div);padding-top:12px;gap:12px}.manage-link{display:flex;align-items:center;gap:6px;color:var(--accent);background:none;border:0;font:600 12px inherit;padding:9px 0;cursor:pointer}.collection-empty{display:flex;gap:10px;align-items:center;background:var(--field);border-radius:10px;padding:13px;margin:15px 0;color:var(--text2);font-size:11px;line-height:1.7}.collection-empty strong{display:block;color:var(--text);font-size:12px;font-weight:500}.picker-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;margin:10px 0}.picker-controls button{border:0;background:none;color:var(--accent);padding:8px 4px;cursor:pointer;font:inherit}.picker-controls label{display:flex;align-items:center;gap:5px;cursor:pointer}.picker-row{display:flex;align-items:center;gap:9px;padding:12px 2px;border-bottom:1px solid var(--div);min-width:0}.picker-title{min-width:0;flex:1;text-align:left;border:0;background:none;color:var(--text);padding:6px 0;cursor:pointer}.picker-title span{display:block;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.picker-title small{display:block;color:var(--text2);font-size:10px;margin-top:5px}.picker-order{display:flex;gap:2px}.picker-order button{border:0;background:var(--field);color:var(--text2);border-radius:7px;width:28px;height:32px;cursor:pointer}.picker-order button:disabled{opacity:.3}.picker-status{font-size:11px;line-height:1.7;color:var(--text2);margin-bottom:9px}.pick-save-status{font-size:12px;line-height:1.8;color:#d66d46;white-space:pre-wrap}.bulk-errors{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:38vh;overflow:auto;color:var(--text2)}button:disabled{cursor:default;opacity:.5}
.rex-import,.select-mode-btn,.manage-link{font-family:inherit}.rex-import{font-size:11px;font-weight:500}.select-mode-btn{font-size:13px;font-weight:600}.manage-link{font-size:12px;font-weight:600}
.collection-empty svg{width:25px;height:25px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6}.collection-chip .encrypted-mark{color:var(--text2);font-size:10px;flex-shrink:0}
@media(pointer:fine){.mod-grip{display:inline-flex;align-items:center}.picker-row .mod-grip{display:inline-flex}}
@media(max-width:460px){#modulesList>.card{padding-left:11px!important;padding-right:11px!important}#modulesList .row{gap:8px}#modulesList .ico-sq{width:32px;height:35px;border-radius:10px}#modulesList .row .name{font-size:14px}#modulesList .rex-import{padding:7px;font-size:10px;gap:3px}.collection-title h3{font-size:16px}.picker-row{gap:6px}.bulk-bar{bottom:calc(80px + env(safe-area-inset-bottom))}.bulk-actions button{font-size:11px;padding:9px 7px}}
@media(max-width:460px){
 #page-modules .actions{min-width:0;gap:6px}
 #page-modules .ios-search{width:auto;flex:1;min-width:70px;padding:0 10px;flex-shrink:1}
 #page-modules .actions>.btn{flex-shrink:0;white-space:nowrap;padding:8px 10px;font-size:12px;gap:4px}
 .dock{width:calc(100vw - 24px);max-width:420px;box-sizing:border-box;gap:2px}
 .dock-item{flex:1;min-width:0;flex-shrink:1!important;padding:10px 6px!important;gap:4px!important;justify-content:center}
 #modulesList .mod-grip{width:20px}
}
`;

export const managementUI=String.raw`
var hubRemoteError=${displayRemoteError.toString()};
var selectedModuleIds=new Set(),selectionMode=false,bulkBusy=false,visibleModuleIds=[];
function manageIcon(name){
 var paths={import:'<path d="M12 3v11m-4-4 4 4 4-4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',manage:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17h7m-3.5-3.5v7"/>',sliders:'<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.6" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="2.6" fill="currentColor" stroke="none"/>'};
 return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.manage)+'</svg>';
}
function hubManageButton(label){
 return '<button type="button" class="hub-more" aria-label="'+esc(label)+'" title="'+esc(label)+'" aria-haspopup="dialog">'+manageIcon('sliders')+'</button>';
}
function rexButton(url,disabled){
 return '<button class="rex-import" '+(disabled?'disabled title="请先添加模块"':'')+' data-rex-url="'+esc(url)+'">'+manageIcon('import')+'导入 Rex</button>';
}
function bindRexButtons(root){root.querySelectorAll('[data-rex-url]').forEach(function(b){b.onclick=function(){importToRex(b.dataset.rexUrl);};});}
function importToRex(url){
 if(!/^https?:\/\//.test(url)){toast('导入链接无效');return;}
 toast('已尝试打开 Rex；未打开时可在更多菜单复制链接');
 window.location.href='https://rexnow.tv/widget/?url='+encodeURIComponent(url);
}
var selectButton=document.createElement('button');selectButton.id='moduleSelectMode';selectButton.className='select-mode-btn';selectButton.textContent='选择';
document.getElementById('btnThemeToggle').before(selectButton);
selectButton.onclick=function(){if(bulkBusy)return;selectionMode=!selectionMode;if(!selectionMode)selectedModuleIds.clear();renderMods();};
var bulkBar=document.createElement('div');bulkBar.id='moduleBulkBar';bulkBar.className='bulk-bar';bulkBar.style.display='none';document.body.appendChild(bulkBar);
function renderBulkBar(){
 var active=selectionMode&&state.tab==='modules';bulkBar.style.display=active?'block':'none';
 selectButton.style.display=state.tab==='modules'?'block':'none';selectButton.textContent=selectionMode?'完成':'选择';selectButton.disabled=bulkBusy;
 document.body.classList.toggle('selecting',active);
 if(!active)return;
 bulkBar.innerHTML='<div class="bulk-head"><strong>共选中 '+selectedModuleIds.size+' 个</strong><button id="bulkAll">全选当前列表</button><button id="bulkNone">清空选择</button></div><div class="bulk-actions"><button class="btn btn-sm" id="bulkGroup">移动分组</button><button class="btn btn-sm" id="bulkAppend">加入合集</button><button class="btn btn-sm danger" id="bulkDelete">删除</button></div><div id="bulkProgress" class="batch-progress"></div>';
 bulkBar.querySelector('#bulkAll').onclick=function(){visibleModuleIds.forEach(function(id){selectedModuleIds.add(id);});renderMods();};
 bulkBar.querySelector('#bulkNone').onclick=function(){selectedModuleIds.clear();renderMods();};
 bulkBar.querySelector('#bulkGroup').onclick=function(){chooseBulkTarget('group');};bulkBar.querySelector('#bulkAppend').onclick=function(){chooseBulkTarget('append');};bulkBar.querySelector('#bulkDelete').onclick=deleteSelectedModules;
 bulkBar.querySelectorAll('button').forEach(function(b){b.disabled=bulkBusy||(!selectedModuleIds.size&&b.id!=='bulkAll');});
}
async function runManagedBulk(ids,action,extra){
 if(bulkBusy)return false;bulkBusy=true;renderBulkBar();
 var failed=[],succeeded=0;
 try{
  var batchSize=action==='delete'?2:10;
  for(var i=0;i<ids.length;i+=batchSize){
   var part=ids.slice(i,i+batchSize),p=document.getElementById('bulkProgress');if(p)p.textContent='正在处理 '+Math.min(i+batchSize,ids.length)+' / '+ids.length;
   try{
    var r=await api('/api/admin/modules/bulk',{method:'POST',json:Object.assign({action:action,ids:part},extra||{}),timeout:120000});
    if(!r||!r.ok)throw Error(r?r.error:'请求未确认，可安全重试');
    part.forEach(function(id){var item=r.results.find(function(x){return x.id===id;});if(item&&item.ok){selectedModuleIds.delete(id);succeeded++;}else failed.push({id:id,error:item?item.error:'未确认成功'});});
   }catch(e){part.forEach(function(id){failed.push({id:id,error:e.message});});}
  }
  if(failed.length){var names={};state.modules.forEach(function(m){names[m.id]=m.title||m.filename;});
   showModal('部分操作未完成','<p class="batch-progress">成功 '+succeeded+' / '+ids.length+'，失败项已保留选中。可在批量栏重试；拖拽失败项也可重新拖动。</p><pre class="bulk-errors">'+esc(failed.map(function(f){return (names[f.id]||f.id)+'：'+f.error;}).join('\n'))+'</pre>',function(close){close();});
  }else toast('已处理 '+succeeded+' 个模块');
  return !failed.length;
 }finally{bulkBusy=false;await loadAll();renderBulkBar();}
}
function chooseBulkTarget(action){
 var ids=Array.from(selectedModuleIds),items=action==='group'?[{id:'',name:'未分类（移出原分组）'}].concat(state.groups.map(function(g){return {id:g.id,name:g.name};})):state.collections.filter(function(c){return !c.autoAll;}).map(function(c){return {id:c.id,name:c.title};});
 if(!ids.length||bulkBusy)return;if(!items.length){toast('请先创建一个手动合集');return;}
 var h='<p class="batch-progress">将处理 '+ids.length+' 个模块。'+(action==='append'?'已在合集中的模块不会重复添加，新模块追加到末尾。':'不会改变模块链接或合集引用。')+'</p><select class="input" id="bulkDestination">';
 items.forEach(function(x){h+='<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>';});h+='</select>';
 showModal(action==='group'?'移动分组':'加入合集',h,async function(close){var target=document.getElementById('bulkDestination').value;close();await runManagedBulk(ids,action,action==='group'?{groupId:target}:{collectionId:target});});
}
async function deleteSelectedModules(){
 var ids=Array.from(selectedModuleIds);if(!ids.length||bulkBusy)return;
 var subscribed=state.modules.some(function(m){return ids.includes(m.id)&&m.source_managed;});
 if(!await showConfirmAsync('永久删除选中的 '+ids.length+' 个模块？模块链接将失效，并移除它们在所有合集中的引用。此操作不支持上一版恢复。'+(subscribed?'<br><br>包含订阅模块：后续同步可能重新导入，第一阶段不提供永久屏蔽。':'')))return;
 await runManagedBulk(ids,'delete');
}
var originalRenderMods=renderMods;
renderMods=function(){
 var known=new Set(state.modules.map(function(m){return m.id;}));selectedModuleIds.forEach(function(id){if(!known.has(id))selectedModuleIds.delete(id);});
 originalRenderMods();visibleModuleIds=[];
 document.querySelectorAll('#modulesList .row[data-mid]').forEach(function(row){
  var id=row.dataset.mid,m=state.modules.find(function(x){return x.id===id;});visibleModuleIds.push(id);
  row.classList.toggle('mod-selected',selectedModuleIds.has(id));
  var sub=row.querySelector('.sub'),badges=document.createElement('span');badges.className='module-badges';
  Array.from(row.children).filter(function(el){return el.classList.contains('badge');}).forEach(function(b){badges.appendChild(b);});
  sub.prepend(badges);
  if(selectionMode){var check=document.createElement('input');check.type='checkbox';check.className='mod-check';check.checked=selectedModuleIds.has(id);check.disabled=bulkBusy;check.setAttribute('aria-label','选择 '+(m.title||m.filename));check.onchange=function(){check.checked?selectedModuleIds.add(id):selectedModuleIds.delete(id);row.classList.toggle('mod-selected',check.checked);renderBulkBar();};row.prepend(check);row.querySelector('.row-od').style.display='none';}
  else{row.querySelector('.row-od').insertAdjacentHTML('beforebegin',rexButton(org()+(m.share_path||m.public_path||'/api/modules/'+encodeURIComponent(id)+'.js'),false));}
  var grip=document.createElement('button');grip.type='button';grip.className='mod-grip';grip.title='拖到分组标签';grip.setAttribute('aria-label','拖动 '+(m.title||m.filename));grip.innerHTML='<svg viewBox="0 0 18 24"><circle cx="6" cy="5" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="6" cy="19" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';grip.draggable=true;row.appendChild(grip);
  grip.ondragstart=function(e){e.stopPropagation();if(bulkBusy){e.preventDefault();return;}e.dataTransfer.setData('application/x-widget-modules',JSON.stringify(selectedModuleIds.has(id)?Array.from(selectedModuleIds):[id]));e.dataTransfer.effectAllowed='move';};
  grip.ondragend=function(){document.querySelectorAll('.drop-target').forEach(function(el){el.classList.remove('drop-target');});};
 });
 bindRexButtons(document.getElementById('modulesList'));
 document.querySelectorAll('#groupTabs [data-drop-group]').forEach(function(tab){
  var gid=tab.dataset.gid;tab.title='拖到这里'+(gid?'移入分组':'移出分组');
  function accepts(e){return Array.from(e.dataTransfer.types||[]).includes('application/x-widget-modules');}
  tab.ondragover=function(e){if(!bulkBusy&&accepts(e)){e.preventDefault();e.dataTransfer.dropEffect='move';tab.classList.add('drop-target');}};
  tab.ondragleave=function(){tab.classList.remove('drop-target');};
  tab.ondrop=async function(e){
   tab.classList.remove('drop-target');if(bulkBusy||!accepts(e))return;e.preventDefault();e.stopPropagation();
   try{
    var ids=JSON.parse(e.dataTransfer.getData('application/x-widget-modules'));
    if(!Array.isArray(ids)||!ids.length||!ids.every(function(id){return known.has(id);}))throw Error('模块列表无效');
    ids=Array.from(new Set(ids));if(!await showConfirmAsync('将 '+ids.length+' 个模块'+(gid?'移入此分组？':'移出原分组？')))return;
    var wasSelecting=selectionMode;ids.forEach(function(id){selectedModuleIds.add(id);});selectionMode=true;
    var complete=await runManagedBulk(ids,'group',{groupId:gid});
    if(complete&&!wasSelecting){selectionMode=false;renderMods();}
   }catch(err){toast(err.message);}
  };
 });renderBulkBar();
};
var originalSwitchTab=switchTab;
var pageKeys=['modules','collections','subscriptions','settings'];
try{var lastPage=localStorage.getItem('rex_hub_page_v1');if(pageKeys.includes(lastPage))state.tab=lastPage;}catch(e){}
switchTab=function(tab){if(!pageKeys.includes(tab))tab='modules';originalSwitchTab(tab);renderBulkBar();try{localStorage.setItem('rex_hub_page_v1',tab);}catch(e){}};
renderGroupTabs=function(){
 var el=document.getElementById('groupTabs');if(!el)return;
 if(state.activeGroup&&state.activeGroup!=='__none__'&&!state.groups.some(function(g){return g.id===state.activeGroup;}))state.activeGroup='';
 var counts=new Map();state.modules.forEach(function(m){var id=m.group_id||'__none__';counts.set(id,(counts.get(id)||0)+1);});
 var rows=[{id:'',name:'全部'}].concat(state.groups,[{id:'__none__',name:'未分类'}]),scroll=el.scrollLeft;
 el.replaceChildren();
 rows.forEach(function(g){
  var b=document.createElement('button'),count=document.createElement('span');
  b.type='button';b.className='ftab'+(state.activeGroup===g.id?' active':'');b.dataset.gid=g.id==='__none__'?'':g.id;
  if(g.id)b.dataset.dropGroup='1';b.setAttribute('aria-pressed',String(state.activeGroup===g.id));
  count.className='cnt';count.textContent=g.id?counts.get(g.id)||0:state.modules.length;
  b.append(g.name,count);b.onclick=function(){setGroupTab(g.id);};el.append(b);
 });el.scrollLeft=scroll;
};
promptDeleteMod=function(id,name){showConfirm('永久删除模块「'+esc(name)+'」？模块链接将失效，所有合集中的引用将移除，不支持上一版恢复。'+(state.modules.some(function(m){return m.id===id&&m.source_managed;})?'<br>此模块来自订阅，后续同步可能重新导入。':''),async function(ok){if(!ok)return;try{var r=await api('/api/admin/modules?id='+encodeURIComponent(id),{method:'DELETE'});if(!r||!r.ok)throw Error(r?r.error:'删除失败');toast('已删除');await loadAll();}catch(e){toast(e.message);}});};

function hubInitial(value,fallback){return (Array.from(String(value||'').normalize('NFKC').trim())[0]||fallback).toUpperCase();}
function hubAvatarImage(avatar,url){
 if(!url)return;
 var image=document.createElement('img');
 image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';
 image.onload=function(){avatar.classList.add('has-image');};
 image.onerror=function(){image.remove();avatar.classList.remove('has-image');};
 image.src=url;avatar.append(image);
}
function hubReadDialog(title,body){
 showModal(esc(title),body,function(close){close();});
 var overlay=document.querySelector('.modal-overlay:last-child');
 var panel=overlay.querySelector('.modal'),close=overlay.querySelector('#mC'),previous=document.activeElement;
 panel.classList.add('hub-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
 overlay.querySelector('#mc').hidden=true;close.textContent='关闭';close.focus();
 function key(e){if(e.key==='Escape'&&document.querySelector('.modal-overlay:last-child')===overlay){e.preventDefault();overlay.remove();}}
 document.addEventListener('keydown',key);
 new MutationObserver(function(_,observer){if(!overlay.isConnected){observer.disconnect();document.removeEventListener('keydown',key);if(previous&&previous.isConnected&&!_anyModalOpen())previous.focus();}}).observe(document.body,{childList:true});
 return overlay;
}
function hubActionMenu(title,actions,note){
 var overlay=hubReadDialog(title,(note?'<p class="hub-help hub-menu-note">'+esc(note)+'</p>':'')+'<div class="hub-menu"></div>'),list=overlay.querySelector('.hub-menu');
 actions.forEach(function(item){var b=document.createElement('button');b.type='button';b.className='btn hub-menu-item'+(item[2]?' hub-danger':'');b.textContent=item[0];b.onclick=function(){overlay.remove();item[1]();};list.append(b);});
}
function showCollectionMembers(col){
 var mods=new Map(state.modules.map(function(m){return [m.id,m];}));
 var rows=(col.moduleIds||[]).map(function(id){var m=mods.get(id);return '<li><span>'+esc(m?(m.title||m.filename):'模块暂不可用')+'</span>'+(m&&m.version?'<small>'+esc(m.version)+'</small>':'')+'</li>';});
 hubReadDialog('合集模块 — '+col.title,'<p class="hub-help">'+(col.autoAll?'自动包含全部模块 · ':'')+rows.length+' 个模块</p>'+(rows.length?'<ol class="hub-members">'+rows.join('')+'</ol>':'<p class="hub-help">还没有模块</p>'));
}
renderCols=function(){
 document.getElementById('colCount').textContent='共 '+state.collections.length+' 个合集';
 var el=document.getElementById('collectionsList');if(!state.collections.length){el.innerHTML='<div class="empty"><p>暂无合集，点击新建合集开始整理模块</p></div>';return;}
 var mods=new Map(state.modules.map(function(m){return [m.id,m];}));el.replaceChildren();
 state.collections.forEach(function(c){
  var ids=c.moduleIds||[],n=ids.length,card=document.createElement('article');card.className='card hub-col';
  var sub=n+' 个模块'+(c.autoAll?' · 自动包含全部模块':'')+(c.description?' · '+c.description:'');
  var h='<div class="hub-row"><button type="button" class="hub-open hub-col-open"><span class="hub-avatar">'+esc(hubInitial(c.title,'合'))+'</span><span class="hub-meta"><span class="hub-title" title="'+esc(c.title)+'">'+esc(c.title)+'</span><span class="hub-muted" title="'+esc(sub)+'">'+esc(sub)+'</span></span></button>'+
    rexButton(org()+'/api/collections/'+encodeURIComponent(c.slug)+'.rex',!n)+hubManageButton('合集管理')+'</div>';
  if(n){h+='<div class="hub-col-foot"><div class="hub-chips">';ids.slice(0,8).forEach(function(id){var m=mods.get(id),title=m?(m.title||m.filename):'模块暂不可用';h+='<span class="hub-chip" title="'+esc(title)+'">'+esc(title)+'</span>';});h+='</div><button type="button" class="hub-link hub-view">查看全部 ›</button></div>';}
  else if(!c.autoAll)h+='<button type="button" class="hub-col-empty">＋ 从模块库挑选模块</button>';
  card.innerHTML=h;el.append(card);
  hubAvatarImage(card.querySelector('.hub-avatar'),c.icon_url);
  card.querySelector('.hub-col-open').onclick=function(){if(c.autoAll)showCollectionMembers(c);else showPickMods(c.id,false);};
  var view=card.querySelector('.hub-view');if(view)view.onclick=function(){showCollectionMembers(c);};
  var empty=card.querySelector('.hub-col-empty');if(empty)empty.onclick=function(){showPickMods(c.id,false);};
  card.querySelector('.hub-more').onclick=function(){showCollectionActions(c.id);};bindRexButtons(card);
 });
 hubUpdateChipFade();
};
function showCollectionActions(id){
 var col=state.collections.find(function(c){return c.id===id;});if(!col)return;
 var actions=col.autoAll?[['查看模块',function(){showCollectionMembers(col);}]]:[['管理模块',function(){showPickMods(id,false);}]];
 actions.push(['复制链接',function(){copyText(org()+'/api/collections/'+encodeURIComponent(col.slug)+'.rex');}],['编辑合集',function(){showEditCol(id);}],['删除合集（不删除模块）',function(){promptDeleteCol(id,col.title);},true]);
 hubActionMenu('合集操作 — '+col.title,actions);
}

showPickMods=function(colId,onlySelected){
 var col=state.collections.find(function(c){return c.id===colId;});if(!col)return;if(col.autoAll){showCollectionMembers(col);return;}if(!state.modules.length){toast('请先上传或订阅模块');return;}
 var known=new Map(state.modules.map(function(m){return [m.id,m];})),baseline=(col.moduleIds||[]).slice(),order=baseline.filter(function(id){return known.has(id);}),chosen=new Set(order),q='',gid='',only=!!onlySelected,saving=false,dragId='';
 var body='<input class="input" id="pickModSearch" placeholder="搜索模块标题或文件名"><select class="input" id="pickGroup"><option value="">全部分组</option>';
 state.groups.forEach(function(g){body+='<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>';});
 body+='</select><div class="picker-controls"><strong id="pickCount"></strong><label><input type="checkbox" id="pickOnly">仅看已选</label><button id="pickAll">全选当前结果</button><button id="pickNone">取消当前结果</button></div><div class="picker-status">筛选不会丢失选择。仅看已选时可用上下按钮或桌面手柄排序；保存后才生效。</div><div id="pickModList" style="max-height:38vh;overflow:auto"></div><p class="pick-save-status" id="pickSaveStatus"></p>';
 showModal('管理模块 — '+esc(col.title),body,async function(close){
  if(saving)return;saving=true;setBusy(true);
  try{var r=await api('/api/admin/collections/'+encodeURIComponent(colId)+'/members',{method:'PUT',json:{moduleIds:order,expectedModuleIds:baseline}});if(!r||!r.ok)throw Error(r?r.error:'保存未确认，请重试或重新打开窗口');close();toast('已保存');await loadAll();}
  catch(e){overlay.querySelector('#pickSaveStatus').textContent=e.message;}finally{saving=false;if(overlay.isConnected)setBusy(false);}
 });
 var overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent='保存';overlay.querySelector('#pickOnly').checked=only;
 function setBusy(v){overlay.querySelectorAll('button,input,select').forEach(function(el){el.disabled=v;});}
 function dirty(){return JSON.stringify(order)!==JSON.stringify(baseline);}
 async function cancel(){if(saving)return;if(!dirty()||await showConfirmAsync('有未保存的模块选择或排序，放弃修改？')){overlay.remove();document.removeEventListener('keydown',escape);}}
 function escape(e){if(e.key==='Escape'&&document.querySelector('.modal-overlay:last-child')===overlay){e.preventDefault();cancel();}}
 document.addEventListener('keydown',escape);
 new MutationObserver(function(_,observer){if(!overlay.isConnected){document.removeEventListener('keydown',escape);observer.disconnect();}}).observe(document.body,{childList:true});
 overlay.addEventListener('click',function(e){if(e.target===overlay||e.target===overlay.querySelector('#mc')){e.stopImmediatePropagation();e.preventDefault();cancel();}},true);
 function list(){return (only?order.map(function(id){return known.get(id);}):state.modules).filter(function(m){return m&&(!gid||m.group_id===gid)&&(!q||((m.title||'')+' '+m.filename).toLowerCase().includes(q));});}
 function toggle(id,on){if(saving)return;if(!on&&col.autoAll){toast('请先在编辑合集中关闭自动包含全部模块');render();return;}if(on){if(!chosen.has(id)){chosen.add(id);order.push(id);}}else{chosen.delete(id);order=order.filter(function(x){return x!==id;});}render();}
 function move(id,delta){if(saving)return;var i=order.indexOf(id),j=i+delta;if(i<0||j<0||j>=order.length)return;var x=order[i];order[i]=order[j];order[j]=x;render();}
 function render(){
  overlay.querySelector('#pickCount').textContent='已选 '+order.length+' 个';var el=overlay.querySelector('#pickModList');el.innerHTML='';
  list().forEach(function(m){var row=document.createElement('div');row.className='picker-row';row.dataset.mid=m.id;
   var cb=document.createElement('input');cb.type='checkbox';cb.className='mod-check';cb.checked=chosen.has(m.id);cb.setAttribute('aria-label','选择 '+(m.title||m.filename));cb.onchange=function(){toggle(m.id,cb.checked);};row.appendChild(cb);
   var title=document.createElement('button');title.className='picker-title';title.innerHTML='<span>'+esc(m.title||m.filename)+'</span><small>'+(chosen.has(m.id)?'已加入本次选择 · ':'')+esc(m.subscription_title?'订阅：'+m.subscription_title:fmt(m.file_size))+'</small>';title.onclick=function(){toggle(m.id,!chosen.has(m.id));};row.appendChild(title);
   if(only){var controls=document.createElement('div');controls.className='picker-order';[-1,1].forEach(function(delta){var b=document.createElement('button');b.textContent=delta<0?'↑':'↓';b.setAttribute('aria-label',(delta<0?'上移 ':'下移 ')+(m.title||m.filename));b.disabled=delta<0?order.indexOf(m.id)===0:order.indexOf(m.id)===order.length-1;b.onclick=function(){move(m.id,delta);};controls.appendChild(b);});row.appendChild(controls);
    var grip=document.createElement('button');grip.className='mod-grip';grip.textContent='⠿';grip.setAttribute('aria-label','拖动排序 '+(m.title||m.filename));grip.draggable=true;grip.ondragstart=function(e){if(saving){e.preventDefault();return;}dragId=m.id;e.dataTransfer.setData('application/x-widget-collection',m.id);e.dataTransfer.effectAllowed='move';};grip.ondragend=function(){dragId='';el.querySelectorAll('.drop-target').forEach(function(x){x.classList.remove('drop-target');});};row.appendChild(grip);
    row.ondragover=function(e){if(!saving&&dragId&&dragId!==m.id&&Array.from(e.dataTransfer.types).includes('application/x-widget-collection')){e.preventDefault();row.classList.add('drop-target');}};row.ondragleave=function(){row.classList.remove('drop-target');};row.ondrop=function(e){e.preventDefault();if(saving||!dragId||dragId===m.id)return;var from=order.indexOf(dragId),to=order.indexOf(m.id);if(from<0||to<0)return;order.splice(from,1);order.splice(to,0,dragId);dragId='';render();};
   }el.appendChild(row);
  });if(!el.children.length)el.innerHTML='<div class="empty"><p>没有匹配的模块</p></div>';
 }
 overlay.querySelector('#pickModSearch').oninput=function(e){q=e.target.value.toLowerCase().trim();render();};overlay.querySelector('#pickGroup').onchange=function(e){gid=e.target.value;render();};overlay.querySelector('#pickOnly').onchange=function(e){only=e.target.checked;render();};
 overlay.querySelector('#pickAll').onclick=function(){if(saving)return;list().forEach(function(m){if(!chosen.has(m.id)){chosen.add(m.id);order.push(m.id);}});render();};
 overlay.querySelector('#pickNone').onclick=function(){if(saving)return;if(col.autoAll){toast('请先在编辑合集中关闭自动包含全部模块');return;}var ids=new Set(list().map(function(m){return m.id;}));ids.forEach(function(id){chosen.delete(id);});order=order.filter(function(id){return !ids.has(id);});render();};render();
};
function hubSourcePath(value){
 try{var u=new URL(value),last=u.pathname.split('/').filter(Boolean).pop()||'';try{last=decodeURIComponent(last);}catch(e){}return u.host+(last?' / '+last:'');}catch(e){return String(value||'');}
}
function hubRelative(time,future){
 if(!time)return future?'待安排':'尚未同步';
 var delta=future?time-Date.now():Date.now()-time;
 if(delta<60000)return future?'即将检查':'刚刚';
 var minutes=Math.floor(delta/60000);
 return (minutes<60?minutes+' 分钟':minutes<1440?Math.floor(minutes/60)+' 小时':Math.floor(minutes/1440)+' 天')+(future?'后':'前');
}
function hubFormatTime(time){return time?new Date(time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false}):'—';}
function hubSubscriptionResult(s,busy){
 if(busy)return '正在同步…';
 if(s.status==='syncing')return '分批处理中，后台会继续';
 if(!s.last_finished_at)return s.status==='error'?'尚未完成首次同步':'尚未同步';
 var sum=s.summary||{},parts=[];
 [['added','新增'],['updated','更新'],['manual','手动保留'],['failed','失败']].forEach(function(item){var n=Number(sum[item[0]])||0;if(n>0)parts.push(item[1]+' '+n);});
 if(s.status==='error')return s.last_error?'本轮同步失败 · 已有模块不变':'本轮同步失败';
 return parts.length?(sum.retry_only?'失败项重试：':'上一轮：')+parts.join(' · '):s.status==='ok'?(sum.retry_only?'失败项重试完成，无变化':'上一轮无变化'):'查看模块了解同步结果';
}
function hubSourceActions(s){
 hubActionMenu('订阅操作 — '+(s.title||'订阅源'),[
  ['查看模块',function(){void showSourceItems(s.id);}],['编辑来源',function(){editSubscription(s.id);}],['变更图标',function(){window.openSubscriptionIcon(s.id);}],['复制订阅链接',function(){copyText(s.url);}],
  [s.enabled?'暂停自动更新':'恢复自动更新',function(){void toggleSource(s.id,!s.enabled);}],['取消订阅',function(){removeSource(s.id);},true]
 ]);
}
renderSubscriptions=function(){
 var labels={idle:['待同步',''],syncing:['同步中','hub-warn'],ok:['已同步','hub-good'],partial:['部分失败','hub-warn'],error:['同步失败','hub-bad']};
 var box=document.getElementById('subscriptionsList'),list=state.subscriptions||[],groups=new Map(state.groups.map(function(g){return [g.id,g.name];}));
 document.getElementById('sourceCount').textContent='共 '+list.length+' 个订阅源';
 box.innerHTML='<div class="hub-source-list"></div>';
 var cards=box.querySelector('.hub-source-list');
 if(!list.length){cards.innerHTML='<div class="empty"><p>暂无订阅源，可添加合集或单模块链接</p></div>';return;}
 list.forEach(function(s){
  var title=s.title||'订阅源',busy=!!sourceSyncing[s.id],st=!s.enabled?['已暂停','']:busy?labels.syncing:(labels[s.status]||['未知状态','']);
  var kind=s.kind==='module'?'单模块':'合集',path=hubSourcePath(s.url),group=groups.get(s.group_id);
  var stats=['已导入 '+(Number(s.imported)||0)+' / '+(Number(s.total)||0),'上次 '+hubFormatTime(s.last_finished_at),s.enabled?'下次 '+hubRelative(s.next_sync_at,true):'不自动更新'];
  if(Number(s.removed)>0)stats.push('下架 '+Number(s.removed));if(group)stats.push('→ '+group);
  var card=document.createElement('article');card.className='card hub-source';
  card.innerHTML='<div class="hub-row"><button type="button" class="hub-open hub-source-open"><span class="hub-avatar">'+esc(hubInitial(title,'订'))+'</span><span class="hub-meta"><span class="hub-title" title="'+esc(title)+'">'+esc(title)+'</span><span class="hub-muted" title="'+esc(kind+' · '+path)+'">'+esc(kind+' · '+path)+'</span></span></button>'+
   '<span class="hub-pill '+st[1]+'">'+st[0]+'</span>'+hubManageButton('订阅管理')+'</div>'+
   '<div class="hub-stats">'+stats.map(function(x){return '<span class="hub-stat">'+esc(x)+'</span>';}).join('')+'</div>'+
   (s.last_error?'<p class="hub-error hub-cut" title="'+esc(hubRemoteError(s.last_error))+'">'+esc(hubRemoteError(s.last_error))+'</p>':'')+
   '<div class="hub-source-foot"><span class="hub-progress" aria-live="polite" id="syncProgress-'+esc(String(s.id))+'">'+esc(hubSubscriptionResult(s,busy))+'</span><button type="button" class="btn btn-sm hub-sync" '+(!s.enabled||busy?'disabled':'')+'>'+(busy?'同步中':s.status==='syncing'?'继续同步':'同步')+'</button></div>';
  hubAvatarImage(card.querySelector('.hub-avatar'),s.icon_url);
  card.querySelector('.hub-more').onclick=function(){hubSourceActions(s);};
  card.querySelector('.hub-source-open').onclick=function(){void showSourceItems(s.id);};
  card.querySelector('.hub-sync').onclick=function(){void syncSource(s.id);};cards.append(card);
 });
};
showSourceItems=async function(id){
 var source=state.subscriptions.find(function(s){return s.id===id;});if(!source)return;
 try{
  var rows=await api('/api/admin/subscriptions/'+encodeURIComponent(id)+'/items');
  if(!Array.isArray(rows))throw Error(rows&&rows.error||'加载失败');
  if(!state.isAuthed||state.tab!=='subscriptions')return;
  var counts=[0,0,0,0],labels=['已导入','未导入','失败','已下架'],tones=['hub-good','','hub-bad',''];
  var body=rows.map(function(i){
   var local=!!i.module_id&&i.updated_at!=null,idx=!i.active?3:i.last_error?2:local?0:1;
   counts[idx]++;
   var label=idx===2&&local?'失败 · 保留旧版':idx===3&&local?'已下架 · 本地保留':labels[idx];
   var declared=String(i.version||'').trim(),localVersion=local?String(i.local_version||'').trim():'';
   var encrypted=local&&Number(i.local_encrypted)===1,versions=[],name=i.local_title||i.title||i.remote_id;
   if(localVersion&&(!encrypted||localVersion!==declared))versions.push('本地版本 '+localVersion);
   if(declared&&(encrypted||declared!==localVersion))versions.push('清单版本 '+declared);
   if(encrypted)versions.push('加密 · 内部版本未核验');
   return '<div class="hub-detail"><div class="hub-detail-line"><span class="hub-dot '+tones[idx]+'" aria-hidden="true"></span><strong class="hub-detail-name">'+esc(name)+'</strong><span class="hub-pill '+tones[idx]+'">'+label+'</span></div>'+
    (versions.length?'<small class="hub-detail-version">'+esc(versions.join(' · '))+'</small>':'')+
    (i.last_error?'<p class="hub-error">'+esc(hubRemoteError(i.last_error))+'</p>':'')+'</div>';
  });
  hubReadDialog('订阅模块 — '+(source.title||'订阅源'),'<p class="hub-help">已导入模块可在合集的「管理模块」中选择。</p><div class="hub-stats">'+labels.map(function(label,i){return '<span class="hub-stat '+tones[i]+'">'+label+' '+counts[i]+'</span>';}).join('')+'</div>'+
   (body.length?'<div class="hub-detail-list">'+body.join('')+'</div>':'<p class="hub-help">暂无模块</p>'));
 }catch(e){toast(e.message);}
};
var hubIntro=document.querySelector('#page-subscriptions > p');
if(hubIntro){hubIntro.className='hub-help';hubIntro.textContent='按设置的间隔自动同步（默认每 6 小时）；上游下架不删除本地模块。';}
function hubUpdateChipFade(){
 document.querySelectorAll('.hub-chips').forEach(function(el){el.classList.toggle('hub-chip-fade',el.scrollWidth>el.clientWidth);});
}
window.addEventListener('resize',hubUpdateChipFade);
(function(){
 var logo=document.querySelector('#appMain .header .avatar');if(!logo)return;
 logo.tabIndex=0;logo.setAttribute('role','button');logo.setAttribute('aria-label','刷新当前页面数据');logo.title='刷新当前页面数据';
 var reads={modules:['modules','groups'],collections:['collections','modules','groups'],subscriptions:['subscriptions','groups'],settings:['modules','collections']};
 var draw={modules:renderMods,collections:renderCols,subscriptions:renderSubscriptions};
 async function refresh(){
  var tab=state.tab;if(!state.isAuthed||logo.getAttribute('aria-busy')==='true'||_loadP||bulkBusy||!reads[tab])return;
  if(_anyModalOpen()){toast('请先关闭当前窗口');return;}
  if(tab==='subscriptions'&&Object.keys(sourceSyncing).length){toast('同步进行中，请稍后刷新');return;}
  logo.setAttribute('aria-busy','true');
  try{
   if(tab==='collections'&&window.isHomeConfigsView&&window.isHomeConfigsView()){
    if(await window.refreshHomeConfigs())toast('已刷新');return;
   }
   var values=await Promise.all(reads[tab].map(function(k){return api('/api/admin/'+k);}));
   if(!values.every(Array.isArray))throw Error('刷新失败，请重试');
   if(!state.isAuthed||state.tab!==tab||_anyModalOpen()||_loadP||bulkBusy||tab==='subscriptions'&&Object.keys(sourceSyncing).length)return;
   reads[tab].forEach(function(k,i){state[k]=values[i];});
   if(tab==='settings'){if(!await renderSettings())return;}else draw[tab]();
   toast('已刷新');
  }catch(e){if(state.isAuthed)toast(e.message);}
  finally{logo.removeAttribute('aria-busy');}
 }
 logo.onclick=refresh;
 logo.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();void refresh();}};
})();
renderBulkBar();
`;
