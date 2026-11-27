export const enhancementsStyles=String.raw`
#modulesList .row{flex-wrap:nowrap}
#modulesList .row .info{min-width:0}
.module-tags{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:7px;min-width:0}
.module-tag{display:inline-flex;align-items:center;max-width:100%;min-width:0;font:inherit;font-size:11px;line-height:1.4;border:0;border-radius:6px;padding:3px 7px;white-space:normal;overflow-wrap:anywhere;text-align:left;cursor:pointer}
.module-tag-group{color:var(--accent);background:rgba(109,94,242,.10)}
.module-tag-collection{color:#22834a;background:rgba(22,163,74,.10)}
.module-origin{cursor:default}
.module-origin-subscription{color:#2465ba;background:rgba(37,99,235,.09)}
.module-origin-upload{color:#a65b17;background:rgba(217,119,6,.10)}
.module-origin-link{color:#187b72;background:rgba(13,148,136,.10)}
.module-tag-add{color:var(--text2);background:transparent;border:1px dashed var(--div);padding:2px 7px}
button.module-tag:hover{filter:brightness(.95)}
.dark .module-tag-collection{color:#8bd6a6;background:rgba(74,222,128,.12)}
.dark .module-origin-subscription{color:#a5c4ff;background:rgba(96,165,250,.13)}
.dark .module-origin-upload{color:#f4bf7b;background:rgba(251,191,36,.12)}
.dark .module-origin-link{color:#8bd8cc;background:rgba(45,212,191,.12)}
#modulesList .rex-import{min-width:44px}
.hub-source-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0 12px}
.hub-source-bar .hub-sync-all,.hub-source-sort select{box-sizing:border-box;height:44px;min-height:44px;border-radius:12px;font:inherit;font-size:12px;font-weight:600;line-height:1.3;margin:0}
.hub-source-bar .hub-sync-all{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:0 0 112px;width:112px;padding:0 12px;white-space:nowrap}
.hub-sync-all svg{width:15px;height:15px;flex:none}.hub-sync-all[aria-busy=true] svg{animation:hub-sync-turn 1.2s linear infinite}
@keyframes hub-sync-turn{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.hub-sync-all[aria-busy=true] svg{animation:none}}
.hub-source-bar .hub-sync-failed{box-sizing:border-box;height:44px;min-height:44px;border-radius:12px;font:inherit;font-size:12px;font-weight:600;margin:0;padding:0 12px;white-space:nowrap;flex:0 0 auto;color:#b45309;border-color:rgba(217,119,6,.35)}
.dark .hub-source-bar .hub-sync-failed{color:#f4bf7b}
@media(max-width:420px){.hub-source-bar{flex-wrap:wrap;row-gap:8px}}
.hub-source-sort{display:flex;align-items:center;flex:0 0 auto;margin-left:auto;min-width:0;color:var(--text2)}
.hub-source-sort select{width:124px;max-width:100%;padding:0 10px;color:var(--text);cursor:pointer;background:var(--field)}
.hub-source-bar :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.hub-all-progress{font-size:12px;color:var(--text2);line-height:1.6;margin:0 0 10px;overflow-wrap:anywhere}
.link-dupe-item{display:block;padding:10px;border:1px solid var(--div);border-radius:10px;margin:7px 0;font-size:13px;overflow-wrap:anywhere}.link-dupe-item small{display:block;font-size:11px;color:var(--text2);margin:4px 0 0 23px}
.link-dupe-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.link-dupe-actions .btn{flex:1;min-width:88px}
@media(max-width:460px){.module-tags{gap:4px;margin-top:6px}.module-tag{font-size:10.5px;padding:3px 6px}.module-tag-add{padding:2px 6px}#modulesList .rex-import{font-size:11px}.ar-foot .btn{font-size:11px;padding:8px}}
`;
export const enhancementsUI=String.raw`
(function(){
 var tools=document.getElementById('settingsTools');
 if(tools&&!tools.querySelector('#organizeLegacyLinks')){
  var legacyTool=document.createElement('button');legacyTool.type='button';legacyTool.className='set-row hub-tool-row';legacyTool.id='organizeLegacyLinks';legacyTool.setAttribute('aria-haspopup','dialog');
  legacyTool.innerHTML='<svg class="hub-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2M14 11a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2"/></svg><span class="hub-tool-meta"><strong>整理旧链接</strong><small>将早期链接导入的模块纳入订阅管理</small></span><span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></span>';
  legacyTool.onclick=async function(){if(legacyTool.disabled)return;legacyTool.disabled=true;try{await migrateLegacySources();}finally{legacyTool.disabled=false;}};
  var filenameTool=tools.querySelector('#openFilenameCleanup');if(filenameTool)filenameTool.after(legacyTool);else tools.prepend(legacyTool);
 }
 function moduleOrigin(m){
  if(Number(m.subscription_collection))return {kind:'subscription',text:'订阅'};
  if(Number(m.subscription_module)||m.source_url)return {kind:'link',text:'链接'};
  return m.source_managed?{kind:'subscription',text:'订阅'}:{kind:'upload',text:'上传'};
 }
 var baseMods=renderMods;
 renderMods=function(){
  baseMods();var mods=new Map(state.modules.map(function(m){return [m.id,m];})),groups=new Map(state.groups.map(function(g){return [g.id,g.name];})),byMod=new Map();
  state.collections.forEach(function(c){(c.moduleIds||[]).forEach(function(id){if(!byMod.has(id))byMod.set(id,[]);byMod.get(id).push(c);});});
  document.querySelectorAll('#modulesList .row[data-mid]').forEach(function(row){
   var m=mods.get(row.dataset.mid);if(!m)return;
   var tags=document.createElement('div');tags.className='module-tags';tags.setAttribute('role','group');tags.setAttribute('aria-label','模块来源和归属');
   var origin=moduleOrigin(m),source=document.createElement('span');source.className='module-tag module-origin module-origin-'+origin.kind;source.textContent=origin.text;source.setAttribute('aria-label','来源：'+origin.text);tags.append(source);
   function tag(text,kind,label,action){var b=document.createElement('button');b.type='button';b.className='module-tag module-tag-'+kind;b.textContent=text;b.setAttribute('aria-label',label);b.disabled=bulkBusy;b.onclick=function(e){e.stopPropagation();if(!bulkBusy)action();};tags.append(b);}
   tag('分组：'+(groups.get(m.group_id)||'未分类'),'group','修改 '+(m.title||m.filename)+' 的分组',function(){showMoveToGroup(m.id);});
   (byMod.get(m.id)||[]).forEach(function(c){tag('合集：'+c.title,'collection','查看合集 '+c.title,function(){showCollectionActions(c.id);});});
   tag('＋合集','add','将 '+(m.title||m.filename)+' 加入合集',function(){appendOne(m.id);});row.querySelector('.info').append(tags);
   var rex=row.querySelector('.rex-import');if(rex){rex.textContent='导入';rex.setAttribute('aria-label','导入 Rex：'+(m.title||m.filename));rex.title='导入 Rex';}
  });
 };
 function appendOne(id){
  var cols=state.collections.filter(function(c){return !c.autoAll;});if(!cols.length){toast('请先创建手动合集');return;}
  showModal('加入合集','<p class="hub-help">已存在时不重复添加，否则追加到末尾。不会移出其他合集。</p><select class="input" id="quickAppend">'+cols.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.title)+'</option>';}).join('')+'</select>',async function(close){try{var r=await api('/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:[id],collectionId:document.getElementById('quickAppend').value}});if(!r||!r.ok||!r.results[0].ok)throw Error(r&&r.results&&r.results[0].error||r&&r.error||'添加未确认');close();toast('已加入合集');await loadAll();}catch(e){toast(e.message);}});
 }
 var sort='created',allBusy=false,allMessage='';try{sort=localStorage.getItem('hub_source_sort_v35')||sort;}catch(e){}
 var baseSources=renderSubscriptions;
 renderSubscriptions=function(){
  var original=state.subscriptions;
  state.subscriptions=original.slice().sort(function(a,b){return sort==='title'?String(a.title).localeCompare(String(b.title),'zh-CN'):sort==='count'?Number(b.total)-Number(a.total):sort==='updated'?Number(b.last_finished_at)-Number(a.last_finished_at):Number(b.created_at)-Number(a.created_at)||String(a.id).localeCompare(String(b.id));});
  try{baseSources();}finally{state.subscriptions=original;}
  var box=document.getElementById('subscriptionsList'),bar=document.createElement('div');bar.className='hub-source-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','订阅源列表操作');box.prepend(bar);
  var all=document.createElement('button');all.type='button';all.className='btn btn-sm hub-sync-all';all.setAttribute('aria-busy',String(allBusy));all.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1.2L20 9M4 15l2.3 3.2A7 7 0 0 0 17.9 17"/></svg><span>'+(allBusy?'同步中':'全部同步')+'</span>';all.disabled=allBusy||!original.some(function(s){return s.enabled;});all.onclick=syncAll;bar.append(all);
  var failedCount=original.filter(isFailedSource).length;
  if(failedCount){var fb=document.createElement('button');fb.type='button';fb.className='btn btn-sm hub-sync-failed';fb.textContent=allBusy?'处理中':'只同步失败（'+failedCount+'）';fb.disabled=allBusy;fb.setAttribute('aria-label','只同步失败的订阅源，共 '+failedCount+' 个');fb.onclick=syncFailed;bar.append(fb);}
  var label=document.createElement('label');label.className='hub-source-sort';label.innerHTML='<select class="input" aria-label="订阅源排序"><option value="created">添加时间</option><option value="updated">同步时间</option><option value="title">名称</option><option value="count">模块数量</option></select>';label.querySelector('select').value=sort;label.querySelector('select').onchange=function(){sort=this.value;try{localStorage.setItem('hub_source_sort_v35',sort);}catch(e){}renderSubscriptions();};bar.append(label);
  if(allMessage){var p=document.createElement('p');p.className='hub-all-progress';p.setAttribute('role','status');p.textContent=allMessage;bar.after(p);}
  box.querySelectorAll('.hub-source').forEach(function(card,i){
   var ordered=original.slice().sort(function(a,b){return sort==='title'?String(a.title).localeCompare(String(b.title),'zh-CN'):sort==='count'?Number(b.total)-Number(a.total):sort==='updated'?Number(b.last_finished_at)-Number(a.last_finished_at):Number(b.created_at)-Number(a.created_at)||String(a.id).localeCompare(String(b.id));}),s=ordered[i];
   if(!s||!(s.summary&&s.summary.failed)||s.status==='syncing')return;
   var b=document.createElement('button');b.className='btn btn-sm hub-retry';b.textContent='重试失败';b.disabled=!s.enabled||!!sourceSyncing[s.id];b.onclick=function(){void syncSource(s.id,'retry');};card.querySelector('.hub-source-foot').append(b);
  });
 };
 function isFailedSource(s){return !!s.enabled&&(s.status==='partial'||s.status==='error'||(s.status!=='syncing'&&!!s.last_error));}
 async function syncFailed(){
  if(allBusy)return;allBusy=true;var failed=[];
  allMessage='正在找出失败的订阅源…';renderSubscriptions();
  try{
   var q=await api('/api/admin/subscriptions/sync-failed',{method:'POST',json:{}});if(!q||!q.ok)throw Error(q&&q.error||'排队失败');
   var list=q.sources||[];
   if(!list.length){allMessage='没有失败的订阅源。';return;}
   for(var i=0;i<list.length;i++){allMessage='正在重试失败的来源 '+(i+1)+' / '+list.length+'；关闭页面后后台继续。';renderSubscriptions();var r=await syncSource(list[i].id,list[i].retry?'retry':undefined);if(!r||r.summary&&r.summary.failed)failed.push(list[i].id);}
   allMessage='失败来源处理完成：'+(list.length-failed.length)+' 个已恢复，'+failed.length+' 个仍有失败，可查看详情。';
  }catch(e){allMessage='重试未完成：'+e.message+'。已排队的订阅由后台继续。';}
  finally{allBusy=false;if(state.tab==='subscriptions')renderSubscriptions();}
 }
 async function syncAll(){
  if(allBusy)return;allBusy=true;var ids=state.subscriptions.filter(function(s){return s.enabled;}).map(function(s){return s.id;}),failed=[];
  allMessage='正在安排同步…';renderSubscriptions();
  try{
   var q=await api('/api/admin/subscriptions/sync-all',{method:'POST',json:{}});if(!q||!q.ok)throw Error(q&&q.error||'排队失败');
   for(var i=0;i<ids.length;i++){allMessage='正在同步 '+(i+1)+' / '+ids.length+'；关闭页面后后台继续。';renderSubscriptions();var r=await syncSource(ids[i]);if(!r||r.summary&&r.summary.failed)failed.push(ids[i]);}
   allMessage='全部处理完成：'+(ids.length-failed.length)+' 个源成功，'+failed.length+' 个源需查看详情。';
  }catch(e){allMessage='全部同步未完成：'+e.message+'。已排队的订阅由后台继续。';}
  finally{allBusy=false;if(state.tab==='subscriptions')renderSubscriptions();}
 }
 clearAllData=function(){
  showModal('清除所有数据','<p class="hub-help hub-danger">这会永久清除模块、合集、订阅、分组、图标、规则、首页配置和文件栏目，已有链接将失效。管理员密码保留。请完整输入「清除所有数据」确认。</p><input class="input" id="resetPhrase" autocomplete="off" placeholder="清除所有数据"><p class="ar-error" role="alert"></p>',async function(close){
   var overlay=document.querySelector('.modal-overlay:last-child');if(overlay.querySelector('#resetPhrase').value!=='清除所有数据')return;
   overlay.querySelector('#mC').disabled=true;try{var r=await api('/api/admin/reset',{method:'POST'});if(!r||!r.ok)throw Error(r&&r.error||'清除未确认');close();toast('已清除');if(window.invalidateHomes)window.invalidateHomes();if(window.invalidateHubFiles)window.invalidateHubFiles();await loadAll();}catch(e){overlay.querySelector('.ar-error').textContent=e.message;overlay.querySelector('#mC').disabled=false;}
  });
  var panel=document.querySelector('.modal-overlay:last-child'),confirm=panel.querySelector('#mC');confirm.textContent='永久清除';confirm.disabled=true;panel.querySelector('#resetPhrase').oninput=function(){confirm.disabled=this.value!=='清除所有数据';};
 };
})();
function chooseLinkDuplicate(preview){
 if(!preview.candidates||!preview.candidates.length)return Promise.resolve({});
 return new Promise(function(resolve){
  var answered=false;
  var overlay=hubReadDialog('发现可能重复的模块','<p class="hub-help">相同文件名仅为疑似；不会自动覆盖。覆盖会保留原模块 ID、分组、备注、合集引用和更新来源。此链接不会自动变为新的订阅来源。</p><div class="hub-detail-list">'+preview.candidates.map(function(m,i){return '<label class="link-dupe-item"><input type="radio" name="linkDupTarget" value="'+esc(m.id)+'" '+(!i?'checked':'')+'> '+esc(m.title)+'<small>'+esc((m.version?m.version+' · ':'')+m.filename+' · '+m.reasons.join(' / '))+'</small></label>';}).join('')+'</div><label>覆盖有订阅的模块时<select class="input" id="linkDupMode"><option value="temporary">临时覆盖（下次同步可恢复原来源）</option><option value="manual">转为手动维护（停止自动覆盖此模块）</option></select></label><div class="link-dupe-actions"><button type="button" class="btn" id="linkDupNew">仍然新增</button><button type="button" class="btn btn-primary" id="linkDupReplace">覆盖选中模块</button></div>');
  overlay.querySelector('#mC').textContent='取消导入';
  function done(value){if(answered)return;answered=true;overlay.remove();resolve(value);}
  overlay.querySelector('#linkDupNew').onclick=function(){done({duplicate_action:'new',duplicate_token:preview.duplicate_token});};
  overlay.querySelector('#linkDupReplace').onclick=async function(){var id=overlay.querySelector('input:checked').value;if(!await showConfirmAsync('确定覆盖选中的模块？原 ID 和合集引用保持不变，原版本可在七天内恢复。'))return;done({duplicate_action:'replace',duplicate_token:preview.duplicate_token,target_id:id,mode:overlay.querySelector('#linkDupMode').value});};
  new MutationObserver(function(_,observer){if(!overlay.isConnected){observer.disconnect();if(!answered){answered=true;resolve(null);}}}).observe(document.body,{childList:true});
 });
}
`;
