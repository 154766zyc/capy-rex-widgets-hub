export const sharingUI=String.raw`
async function showShareModule(id){
 var m=state.modules.find(function(x){return x.id===id;});if(!m)return;
 try{
  var p=await api('/api/admin/modules/'+id+'/share/preview',{method:'POST',json:{}});if(!p||p.error)throw Error(p?p.error:'预览失败');
  showModal('分享模块','<p class="icon-help">分享名称确认后固定。修改名称后，旧别名和 UUID 链接继续有效。</p><label>分享名称</label><input class="input" id="shareAlias" value="'+esc(p.alias)+'"><p class="icon-help" id="shareStatus">'+(p.conflict?'名称冲突，已建议加后缀的新名称。':'')+'</p>',async function(close){
   try{
    var alias=document.getElementById('shareAlias').value.trim(),check=await api('/api/admin/modules/'+id+'/share/preview',{method:'POST',json:{alias:alias}});
    if(!check||check.error)throw Error(check?check.error:'预览失败');
    if(check.revision!==p.revision)throw Error('模块或分享名已变化，请重新打开分享窗口');
    if(check.conflict){document.getElementById('shareAlias').value=check.alias;toast('名称已占用，请再次确认建议名称');return;}
    var saved=await api('/api/admin/modules/'+id+'/share',{method:'PUT',json:{alias:check.alias,revision:p.revision}});
    if(!saved||saved.error)throw Error(saved?saved.error:'保存失败');close();await loadAll();showSavedShare(m,org()+saved.path);
   }catch(e){toast(e.message);}
  });
  var modal=document.querySelector('.modal-overlay:last-child .modal');
  var old=document.createElement('button');old.className='btn btn-sm';old.textContent='复制原有模块地址';old.onclick=function(){copyText(org()+(m.public_path||'/api/modules/'+id+'.js'));};modal.querySelector('.btn-row').before(old);
 }catch(e){toast(e.message);}
}
function showSavedShare(m,url){
 var heading=(m.title||m.filename)+(m.version?' · v'+m.version:'');
 showModal('分享链接','<p style="margin:12px 0">'+esc(heading)+'</p><input class="input" readonly value="'+esc(url)+'"><div id="shareActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"></div>',function(close){close();});
 var box=document.getElementById('shareActions');
 [['复制分享内容',function(){copyText(heading+'\n模块地址：'+url);}],['复制模块地址',function(){copyText(url);}],['导入 Rex',function(){importToRex(url);}]].forEach(function(item){var b=document.createElement('button');b.className='btn btn-sm';b.textContent=item[0];b.onclick=item[1];box.appendChild(b);});
}
// Both entry points use this one preview/commit flow. Typing never downloads files.
showImportUrl=function(){
 var identified=null,busy=false;
 showModal('添加模块 / 合集订阅','<label>模块或合集 URL</label><input class="input" id="importUrl" placeholder="https://.../widget.js 或 collection.rex"><button class="btn btn-sm" id="identifySource" style="margin:10px 0">识别链接</button><p class="icon-help" id="importProgress">先识别类型并预览，再确认添加；每 6 小时检查更新。</p><label>新模块分组（已有模块不移动）</label><select class="input" id="importGroup">'+groupOptions('')+'</select><label>原始文件名（仅单模块，可选）</label><input class="input" id="importFilename" placeholder="从 URL 提取"><label>导入后的文件名（仅单模块，可修改）</label><input class="input" id="importEffectiveFilename" placeholder="识别后显示">',async function(close){
  if(busy)return;if(!identified){toast('请先点击“识别链接”并核对预览');return;}
  busy=true;var status=document.getElementById('importProgress');status.textContent='正在保存订阅…';
  try{
   var decision=await chooseLinkDuplicate(identified);if(decision===null){status.textContent='已取消导入';return;}
   var r=await api('/api/admin/modules/import',{method:'POST',timeout:120000,json:Object.assign({url:identified.url,preview_id:identified.preview_id,group_id:document.getElementById('importGroup').value,filename:document.getElementById('importFilename').value.trim(),effective_filename:document.getElementById('importEffectiveFilename').value.trim()||undefined},decision)});
   if(!r||!r.ok)throw Error(r?r.error:'导入失败');close();
   if(!r.subscription){await loadAll();toast(r.message||'已覆盖原模块，保留原更新来源');return;}
   state.tab='subscriptions';await loadAll();
   if(!r.subscription.done&&!r.subscription.existing)await syncSource(r.subscription.id);else toast(r.subscription.existing?'此地址已有订阅；保留原状态':'已添加单模块订阅');
  }catch(e){if(status.isConnected)status.textContent=e.message;toast(e.message);}finally{busy=false;}
 });
 var overlay=document.querySelector('.modal-overlay:last-child'),input=overlay.querySelector('#importUrl'),identify=overlay.querySelector('#identifySource');
 input.oninput=function(){identified=null;overlay.querySelector('#importProgress').textContent='地址已变化，请重新识别';};
 identify.onclick=async function(){if(busy)return;busy=true;identify.disabled=true;var raw=input.value.trim(),status=overlay.querySelector('#importProgress');status.textContent='正在读取链接（最多 20 秒）…';
  try{
   var p=await api('/api/admin/subscriptions/preview',{method:'POST',timeout:120000,json:{url:raw}});if(!p||p.error)throw Error(p?p.error:'识别失败');if(!overlay.isConnected||raw!==input.value.trim())return;
   var naming=p.kind==='module'?await api('/api/admin/filename-preview',{method:'POST',json:{url:p.url,filename:p.filename}}):null;
   if(!overlay.isConnected||raw!==input.value.trim())return;
   if(naming?.error)throw Error(naming.error);identified=p;
   overlay.querySelector('#importFilename').value=p.kind==='module'?p.filename:'';overlay.querySelector('#importEffectiveFilename').value=naming?.suggested||'';
   status.textContent=(p.kind==='module'?'单模块':'合集 · '+p.total+' 个模块')+'：'+p.title+'\n来源：'+p.url+(p.existing_source?'\n已有订阅，将复用并保留暂停状态':p.existing_module?'\n复用已有模块：'+p.existing_module.title:'\n确认后添加到模块库，不改变普通合集的成员');
  }catch(e){identified=null;status.textContent=e.message;}finally{busy=false;identify.disabled=false;}
 };
};
async function editSubscription(id){
 var s=state.subscriptions.find(function(x){return x.id===id;});if(!s)return;
 showModal('编辑订阅','<label>来源名称</label><input class="input" id="sourceTitle" value="'+esc(s.title)+'"><label>来源 URL</label><input class="input" id="sourceUrl" value="'+esc(s.url)+'"><p class="icon-help">来源名称与模块标题独立。修改链接将校验类型，保留原模块及合集关系。</p>',async function(close){
  try{
   var body={url:document.getElementById('sourceUrl').value.trim(),title:document.getElementById('sourceTitle').value.trim(),revision:s.revision};
   if(body.url!==s.url){var p=await api('/api/admin/subscriptions/preview',{method:'POST',timeout:120000,json:{url:body.url}});if(!p||p.error)throw Error(p?p.error:'新地址无效');body.preview_id=p.preview_id;if(p.kind!==s.kind)throw Error('不能改变原有来源类型');body.confirm_identity=await showConfirmAsync('新来源：'+esc(p.title)+'。确认替换来源地址？如内部 ID 不同，也将继续更新原模块。');if(!body.confirm_identity)return;}
   var r=await api('/api/admin/subscriptions/'+id,{method:'PATCH',json:body});if(!r||r.error)throw Error(r?r.error:'保存失败');close();await loadAll();
  }catch(e){toast(e.message);}
 });
}
async function migrateLegacySources(){
 try{
  var p=await api('/api/admin/subscriptions/legacy');if(!p||p.error||!Array.isArray(p.rows))throw Error(p&&p.error||'预览失败');if(!p.rows.length){toast('没有需要整理的旧链接');return;}
  var rows=p.rows.slice(0,10),busy=false,h='<p class="hub-help">共 '+p.rows.length+' 个可整理，本批 '+rows.length+' 个。为旧模块建立订阅来源，不重新导入模块；保留原 ID、合集引用、分组和备注。手动维护模块保持暂停。</p><div class="hub-detail-list">'+rows.map(function(m){return '<div class="hub-detail"><div class="hub-detail-line"><strong class="hub-detail-name">'+esc(m.title)+'</strong><span class="hub-pill '+(m.enabled?'hub-good':'')+'">'+(m.enabled?'启用自动更新':'保持暂停')+'</span></div></div>';}).join('')+'</div><p class="hub-tool-status" id="legacyLinksError" role="alert"></p>';
  showModal('整理旧链接',h,async function(close){
   if(busy)return;busy=true;var overlay=document.querySelector('.modal-overlay:last-child'),confirm=overlay.querySelector('#mC');confirm.disabled=true;
   try{var r=await api('/api/admin/subscriptions/legacy',{method:'POST',json:{rows:rows.map(function(m){return {id:m.id,revision:m.revision};})}});if(!r||r.error||!r.ok)throw Error(r&&r.error||'整理失败');close();await loadAll();toast('已整理 '+r.processed+' 个来源'+(p.rows.length>rows.length?'，可继续下一批':''));}
   catch(e){if(overlay.isConnected)overlay.querySelector('#legacyLinksError').textContent=e.message;else toast(e.message);}
   finally{busy=false;if(overlay.isConnected)confirm.disabled=false;}
  });
  var panel=document.querySelector('.modal-overlay:last-child');panel.querySelector('#mC').textContent='确认整理';panel.querySelector('.modal').setAttribute('role','dialog');panel.querySelector('.modal').setAttribute('aria-modal','true');panel.querySelector('.modal').setAttribute('aria-label','整理旧链接');
 }catch(e){toast(e.message);}
}
`;
