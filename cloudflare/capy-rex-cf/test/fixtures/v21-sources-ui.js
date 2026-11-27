// Embedded in the existing page; remote labels are escaped as plain text.
export const SOURCE_UI = String.raw`
var sourceLabels={queued:'等待同步',syncing:'正在同步',success:'同步成功',partial:'部分失败',error:'同步失败',paused:'已暂停',idle:'等待下次同步'};
function sourceTime(value){ return value?new Date(value).toLocaleString():'尚无记录'; }
function renderSources(){
  var list=state.sources||[];
  document.getElementById('sourceCount').textContent='共 '+list.length+' 个订阅源';
  document.getElementById('sourcesList').innerHTML=list.length?list.map(function(s){
    var busy=s.status==='syncing'||s.status==='queued',items=s.items||[];
    return '<div class="card source-card"><div class="source-head"><strong>'+esc(s.title||'等待获取合集名称')+'</strong><span class="badge '+(s.status==='error'||s.status==='partial'?'badge-orange':'badge-blue')+'">'+esc(sourceLabels[s.status]||s.status)+'</span></div>'+
      '<div class="source-url">'+esc(s.url)+'</div>'+
      '<div class="source-stats">最近尝试：'+esc(sourceTime(s.last_attempt_at))+'<br>最近成功：'+esc(sourceTime(s.last_success_at))+'<br>下次同步：'+(s.enabled?esc(sourceTime(s.next_sync_at)):'已暂停')+'</div>'+
      '<div class="source-stats">新增 '+s.added_count+' · 更新 '+s.updated_count+' · 未变 '+s.unchanged_count+' · 失败 '+s.failed_count+' · 新下架 '+s.removed_count+'</div>'+
      (s.last_error?'<pre class="source-error">'+esc(s.last_error)+'</pre>':'')+
      '<div class="source-actions"><button class="btn btn-sm" '+(busy?'disabled ':'')+'onclick="refreshSource(\''+s.id+'\')">'+(busy?'同步中…':'立即刷新')+'</button>'+
      '<button class="btn btn-sm" onclick="toggleSource(\''+s.id+'\','+(!s.enabled)+')">'+(s.enabled?'暂停':'启用')+'</button>'+
      '<button class="btn btn-sm" onclick="viewSourceModules(\''+s.id+'\')">查看模块</button>'+
      '<button class="btn btn-ghost btn-sm" onclick="removeSource(\''+s.id+'\')">移除源</button></div>'+
      '<details><summary>上游模块（'+items.length+'）</summary>'+items.map(function(i){
        return '<div class="source-item"><span>'+esc(i.title||i.remote_id||i.url)+'</span><span class="source-item-status">'+
          (i.removed_at?'已下架，保留本地':(i.last_error?'下载失败':(i.module_id?'已入库':'等待下载')))+'</span>'+
          (i.last_error?'<small class="source-error">'+esc(i.last_error)+'</small>':'')+'</div>';
      }).join('')+'</details></div>';
  }).join(''):'<div class="empty"><p>还没有订阅源</p><p>添加别人的合集链接，模块会自动进入模块库。</p></div>';
}
function showAddSource(){
  showModal('添加订阅源','<label>合集链接</label><input class="input" id="sourceUrl" placeholder="https://…/collection.rex">'+
    '<label>名称（可选）</label><input class="input" id="sourceName" placeholder="自动获取合集名称">'+
    '<p class="source-stats">每 6 小时同步；新增模块只进入模块库，不会改动我的合集。</p>',async function(close){
      var url=document.getElementById('sourceUrl').value.trim(); if(!url){toast('请输入合集链接');return;}
      var r=await api('/api/admin/sources',{method:'POST',json:{url:url,title:document.getElementById('sourceName').value.trim()}});
      if(r&&r.ok){close();toast('已添加，后台开始同步');state.tab='sources';await loadAll();}else toast((r&&r.error)||'添加失败');
    });
}
async function refreshSource(id){
  var r=await api('/api/admin/sources/'+id+'/refresh',{method:'POST'});
  if(r&&r.ok){toast('已加入同步队列');loadAll();}else toast((r&&r.error)||'刷新失败');
}
async function toggleSource(id,enabled){
  var r=await api('/api/admin/sources?id='+id,{method:'PATCH',json:{enabled:enabled}});
  if(r&&r.ok){toast(enabled?'已启用同步':'已暂停，保留本地文件');loadAll();}else toast((r&&r.error)||'操作失败');
}
function removeSource(id){
  showConfirm('只移除订阅源，保留模块库文件和我的合集，确定？',async function(ok){
    if(!ok)return; var r=await api('/api/admin/sources?id='+id,{method:'DELETE'});
    if(r&&r.ok){toast('已移除订阅源，文件和合集仍保留');loadAll();}else toast((r&&r.error)||'移除失败');
  });
}
function viewSourceModules(id){state.sourceFilter=id;state.activeGroup='';document.getElementById('modSearch').value='';switchTab('modules');}
function clearSourceFilter(){state.sourceFilter='';renderMods();}
function renderSourceFilter(){
  var s=(state.sources||[]).find(function(s){return s.id===state.sourceFilter;});
  if(!s)state.sourceFilter='';
  document.getElementById('sourceFilter').innerHTML=s?'<span>来源：'+esc(s.title||s.url)+'</span><button class="btn btn-ghost btn-sm" onclick="clearSourceFilter()">显示全部</button>':'';
}
setInterval(async function(){
  if(!state.isAuthed||document.hidden)return;
  var busy=(state.sources||[]).some(function(s){return s.status==='queued'||s.status==='syncing';});
  if(state.tab!=='sources'&&!busy)return;
  try{
    var list=await api('/api/admin/sources');if(!Array.isArray(list))return;
    var changed=JSON.stringify(list)!==JSON.stringify(state.sources||[]);state.sources=list;
    if(changed&&state.tab==='sources')renderSources();
    if(changed){var mods=await api('/api/admin/modules');if(Array.isArray(mods))state.modules=mods;
      if(state.tab==='modules'&&!document.querySelector('.modal-overlay')&&document.getElementById('editorOverlay').style.display!=='flex')renderMods();}
  }catch(e){}
},3000);
`;
