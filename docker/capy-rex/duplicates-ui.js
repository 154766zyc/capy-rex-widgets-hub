export const duplicatesStyles=String.raw`
.hub-dupe-dialog.modal{max-width:520px}
.hub-dupe-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px}
.hub-dupe-head .hub-help{margin:0}
.hub-dupe-summary{font-size:12px;color:var(--text2);margin:0 0 8px}
.hub-dupe-list{max-height:52dvh;overflow:auto;overscroll-behavior:contain}
.hub-dupe-group{margin:0 0 7px;border:1px solid var(--div);border-radius:11px;background:var(--card);padding:0 10px;min-width:0}
.hub-dupe-group summary{cursor:pointer;padding:9px 0;font-size:13px;line-height:1.5;color:var(--text)}
.hub-dupe-group summary small,.hub-dupe-reason{color:var(--text2);font-size:11.5px;font-weight:400}
.hub-dupe-reason{margin:0 0 5px;overflow-wrap:anywhere}
.hub-dupe-entry{border-top:1px solid var(--div);padding:9px 0}
.hub-dupe-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:14px}
.hub-dupe-title strong{min-width:0;overflow-wrap:anywhere}
.hub-dupe-delete.btn{flex:none;color:var(--hub-bad);padding-inline:9px}
.hub-dupe-meta,.hub-dupe-where,.hub-dupe-more-meta{font-size:11.5px;line-height:1.5;color:var(--text2);overflow-wrap:anywhere;margin-top:3px}
.hub-dupe-more-meta summary{font-size:11.5px;color:var(--accent);padding:2px 0}
.hub-dupe-more-meta p{margin:2px 0 0}
.hub-dupe-confirm{color:var(--text2);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.hub-dupe-confirm ul{padding-inline-start:18px;margin:6px 0 9px}
.hub-dupe-confirm li{padding:2px 0}
.hub-dupe-confirm code{font-size:11px}
.btn.hub-dupe-final{background:var(--hub-bad);color:var(--bg);border-color:var(--hub-bad);font-weight:700}
`;

export const duplicatesUI=String.raw`
(function(){
 var tools=document.getElementById('settingsTools');if(!tools)return;
 var open=document.createElement('button');open.type='button';open.className='set-row hub-tool-row';open.id='findDuplicateModules';
 open.innerHTML='<svg class="hub-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="11" height="11" rx="2"/><path d="M18 9h.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V18"/></svg><span class="hub-tool-meta"><strong>查找重复模块</strong><small>按内容、模块 ID 或文件名查找</small></span><span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></span>';
 open.onclick=showDuplicates;var filename=tools.querySelector('#openFilenameCleanup');if(filename)filename.after(open);else tools.prepend(open);
 async function request(path,opts){var data=await api('/api/admin/modules/duplicates'+path,opts);if(!data||data.error)throw Error(data&&data.error||'操作未确认，请重试');return data;}
 function reasonLabel(r){
  if(r.type==='hash')return '内容完全相同';
  if(r.type==='filename')return '同名疑似';
  var origins=Object.values(r.basis||{});
  return origins.every(function(x){return x==='code';})?'内部 ID 相同':origins.every(function(x){return x==='manifest';})?'清单 ID 相同':'同 ID · 含清单声明';
 }
 function collectionTitle(c){return c.title+(c.automatic?'（自动合集）':'');}
 function shortList(arr,max){return arr.slice(0,max).join('、')+(arr.length>max?' 等 '+arr.length+' 项':'');}
 function confirmDelete(m){
  var cols=m.collections.map(collectionTitle),paths=m.paths||[];
  var html='<div class="hub-dupe-confirm"><p>永久删除 <strong>'+esc(m.title)+'</strong>？此操作不可撤销，也不会把引用转给另一份模块。</p>'+
   '<p><strong>会移出合集：</strong>'+esc(cols.length?cols.join('、'):'无')+'</p>'+
   '<p><strong>该模块所有直链都会失效。</strong>当前地址和已登记的分享链接：</p><ul>'+paths.map(function(p){return '<li><code>'+esc(p)+'</code></li>';}).join('')+'</ul>'+
   (m.may_reimport?'<p class="hub-danger">启用中的订阅仍包含此模块，后续同步可能再次导入。</p>':'')+'</div>';
  return new Promise(function(resolve){
   showModal('确认永久删除模块',html,function(close){close();done(true);});
   var overlay=document.querySelector('.modal-overlay:last-child'),yes=overlay.querySelector('#mC');
   var panel=overlay.querySelector('.modal'),cancel=overlay.querySelector('#mc');
   panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','确认永久删除模块');
   yes.textContent='永久删除';yes.classList.add('hub-dupe-final');cancel.focus();
   function done(result){document.removeEventListener('keydown',escape);resolve(result);}
   function escape(e){if(e.key==='Escape'&&overlay.isConnected&&document.querySelector('.modal-overlay:last-child')===overlay){e.preventDefault();cancel.click();}}
   document.addEventListener('keydown',escape);
   overlay.addEventListener('click',function(e){if(e.target===overlay||e.target===cancel)done(false);});
  });
 }
 function showDuplicates(){
  if(document.querySelector('.hub-dupe-dialog'))return;
  var overlay=hubReadDialog('重复模块','<div class="hub-dupe-head"><p class="hub-help">扫描不会修改模块。相同 ID 或文件名不表示内容相同。</p><button type="button" class="btn btn-sm hub-dupe-refresh">重新扫描</button></div><button type="button" class="hub-link hub-dupe-clear">重置忽略记录</button><p class="hub-dupe-summary" role="status"></p><div class="hub-dupe-list"></div>');
  overlay.querySelector('.modal').classList.add('hub-dupe-dialog');
  var status=overlay.querySelector('.hub-dupe-summary'),list=overlay.querySelector('.hub-dupe-list'),refresh=overlay.querySelector('.hub-dupe-refresh');
  var report=null,limit=16,scanning=false,deleting=false;
  function controls(){
   refresh.disabled=scanning||deleting;
   list.querySelectorAll('.hub-dupe-delete').forEach(function(b){b.disabled=scanning||deleting;});
  }
  function moduleRow(m,group){
   var item=document.createElement('article');item.className='hub-dupe-entry';
   var ids=group.reasons.filter(function(r){return r.type==='id';}).map(function(r){return (r.basis[m.id]==='code'?'内部 ID：':'清单 ID：')+r.value;});
   var sub=m.subscriptions.length?shortList(m.subscriptions.map(function(s){return s.title+(!s.active?'（已下架）':!s.enabled?'（已暂停）':'');}),2):m.has_source?'有来源链接':'本地模块';
   var facts=[m.encrypted?'加密':'明文',m.version?'版本 '+m.version:'',m.author?'作者 '+m.author:'',fmt(m.size)].filter(Boolean);
   if(m.updated_at)facts.push(new Date(m.updated_at).toLocaleString());
   var cols=m.collections.map(collectionTitle);
   item.innerHTML='<div class="hub-dupe-title"><strong>'+esc(m.title)+'</strong><button type="button" class="btn btn-sm hub-dupe-delete">删除</button></div>'+
    '<p class="hub-dupe-meta">'+esc(facts.join(' · '))+'</p>'+
    '<p class="hub-dupe-where">'+esc((m.group||'未分类')+' · '+sub+' · '+(cols.length?'在 '+cols.length+' 个合集':'未加入合集')+(m.has_share_alias?' · 有可读分享链接':''))+'</p>'+
    '<details class="hub-dupe-more-meta"><summary>查看文件名、ID 和引用</summary><p>'+esc('文件名：'+m.filename+(m.effective_filename!==m.filename?' · 对外：'+m.effective_filename:''))+'</p>'+
    (ids.length?'<p>'+ids.map(esc).join('<br>')+'</p>':'')+'<p>合集：'+esc(cols.join('、')||'无')+'</p>'+
    (m.has_share_alias?'<p>公开地址：'+esc(shortList(m.paths,3))+'</p>':'')+'</details>';
   var del=item.querySelector('.hub-dupe-delete');
   del.setAttribute('aria-label','删除模块：'+m.title);del.onclick=function(){void remove(m,group,del);};
   return item;
  }
  function draw(){
   var opened=new Set(Array.from(list.querySelectorAll('details[data-group][open]')).map(function(el){return el.dataset.group;}));
   list.replaceChildren();if(!report.groups.length)return;
   var byId=new Map(report.modules.map(function(m){return [m.id,m];}));
   report.groups.slice(0,limit).forEach(function(group,i){
    var panel=document.createElement('details'),summary=document.createElement('summary');panel.className='hub-dupe-group';panel.dataset.group=group.key;
    var labels=[...new Set(group.reasons.map(reasonLabel))];
    summary.append(labels.join(' · '));
    var count=document.createElement('small');count.textContent='　'+group.module_ids.length+' 个模块';summary.append(count);
    panel.open=opened.has(group.key)||(opened.size===0&&i===0&&group.reasons[0].type!=='filename');
    panel.append(summary);
    var ignore=document.createElement('button');ignore.type='button';ignore.className='hub-link hub-dupe-ignore';ignore.textContent='忽略此组（不删模块）';ignore.onclick=async function(){if(scanning||deleting)return;deleting=true;controls();try{await request('/ignore',{method:'POST',json:{group_token:group.token}});await scan('已忽略此组');}catch(e){status.textContent=e.message;}finally{deleting=false;controls();}};panel.append(ignore);
    var identifiers=group.reasons.filter(function(r){return r.type!=='hash';}).map(function(r){return (r.type==='id'?'ID：':'文件名：')+r.value;});
    if(identifiers.length){var note=document.createElement('p');note.className='hub-dupe-reason';note.textContent=identifiers.join(' · ');panel.append(note);}
    group.module_ids.forEach(function(id){var m=byId.get(id);if(m)panel.append(moduleRow(m,group));});
    list.append(panel);
   });
   if(report.groups.length>limit){
    var more=document.createElement('button');more.type='button';more.className='hub-link';more.textContent='显示更多组';
    more.onclick=function(){limit+=16;draw();controls();};list.append(more);
   }
  }
  async function scan(prefix){
   if(!overlay.isConnected||scanning)return;
   scanning=true;controls();status.textContent=(prefix?prefix+'。':'')+'正在扫描…';
   try{
    var data=await request('',{timeout:30000});
    if(!Array.isArray(data.groups)||!Array.isArray(data.modules))throw Error('无法读取扫描结果');
    report=data;if(!overlay.isConnected)return;
    draw();status.textContent=(prefix?prefix+'。':'')+(report.groups.length?'共 '+report.groups.length+' 组，涉及 '+report.modules.length+' 个模块':'未发现可判定的重复模块')+(report.ignored?' · 已忽略 '+report.ignored+' 组':'');
   }catch(e){
    report=null;if(!state.isAuthed){overlay.remove();return;}
    status.textContent=(prefix?prefix+'。':'')+'扫描失败：'+e.message;list.replaceChildren();
   }finally{scanning=false;controls();}
  }
  async function remove(m,group,button){
   if(scanning||deleting)return;
   deleting=true;controls();
   try{
    if(!await confirmDelete(m))return;
    status.textContent='正在删除已确认的模块…';
    var r=await request('/delete',{method:'POST',json:{id:m.id,revision:m.revision,group_token:group.token},timeout:120000});
    if(!r.ok)throw Error('删除未确认，请重新扫描');
    toast(r.absent?'该模块已不存在':'模块已删除');
    await Promise.allSettled([scan(),loadAll()]);
   }catch(e){
    if(state.isAuthed)await scan('删除未确认：'+e.message);else overlay.remove();
   }finally{deleting=false;controls();if(button.isConnected&&!_anyOtherDialog())button.focus({preventScroll:true});}
  }
  function _anyOtherDialog(){return document.querySelector('.modal-overlay:last-child')!==overlay;}
  overlay.querySelector('.hub-dupe-clear').onclick=async function(){if(scanning||deleting)return;if(!await showConfirmAsync('重置全部重复忽略记录？不会删除任何模块。'))return;try{await request('/ignore',{method:'POST',json:{clear:true}});await scan('忽略记录已重置');}catch(e){status.textContent=e.message;}};
  refresh.onclick=function(){void scan();};void scan();
 }
})();
`;
