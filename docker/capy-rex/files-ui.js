// 3.5.8：合集页「文件」栏目的界面。只放 PDF / txt / zip 原文件，可分享下载。
export const filesStyles=String.raw`
.file-card{padding:16px!important}
.file-card .hub-title{white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.45}
.file-kind{display:inline-flex;align-items:center;justify-content:center;flex:none;width:42px;height:42px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:.02em}
.file-kind-pdf{color:#b42318;background:rgba(220,38,38,.10)}.file-kind-txt{color:#2465ba;background:rgba(37,99,235,.10)}.file-kind-zip{color:#8a5a00;background:rgba(217,119,6,.12)}
.dark .file-kind-pdf{color:#ffa39a}.dark .file-kind-txt{color:#a5c4ff}.dark .file-kind-zip{color:#f4bf7b}
.file-note{font-size:12px;color:var(--text2);line-height:1.6;margin-top:8px;overflow-wrap:anywhere;white-space:pre-wrap}
.file-shared{color:#22834a}.dark .file-shared{color:#8bd6a6}
`;
export const filesUI=String.raw`
(function(){
 var root='/api/admin/files',files=[],total=0,limits={file:25*1024*1024,total:100*1024*1024,count:200},loaded=false,loading=null,generation=0;
 var list=document.getElementById('hubFilesList'),status=document.getElementById('hubFileStatus');
 var ACCEPT='.pdf,.txt,.zip,application/pdf,text/plain,application/zip';
 var KIND={pdf:'PDF',txt:'TXT',zip:'ZIP'};
 function kindOf(name){var n=String(name||'').toLowerCase();return /\.pdf$/.test(n)?'pdf':/\.txt$/.test(n)?'txt':/\.zip$/.test(n)?'zip':'';}
 function render(){
  document.getElementById('hubFileCount').textContent='共 '+files.length+' 个文件 · '+fmt(total)+' / '+fmt(limits.total);
  list.replaceChildren();
  if(!files.length){list.innerHTML='<div class="empty"><p>还没有文件</p><p class="hub-help">可以放 PDF、txt 和 zip，单个最多 25 MiB。分享后别人用链接就能打开或下载。</p></div>';return;}
  files.forEach(function(f){
   var card=document.createElement('article');card.className='card file-card';
   card.innerHTML='<div class="hub-row"><span class="file-kind file-kind-'+esc(f.kind)+'" aria-hidden="true">'+esc(KIND[f.kind]||'')+'</span><div class="hub-meta"><span class="hub-title">'+esc(f.name)+'</span><span class="hub-muted">'+esc(fmt(f.size))+' · '+esc(new Date(f.updated_at).toLocaleDateString('zh-CN'))+' 更新'+(f.shared?' · <span class="file-shared">已分享</span>':'')+'</span></div>'+hubManageButton('文件管理：'+f.name)+'</div>'+(f.note?'<div class="file-note">'+esc(f.note)+'</div>':'')+'<div class="home-foot"><small>'+(f.kind==='zip'?'zip 原样保存，不会解压':'浏览器可直接打开')+'</small><a class="rex-import home-export" href="'+root+'/'+encodeURIComponent(f.id)+'/download" target="_blank" rel="noopener">'+manageIcon('import')+(f.kind==='zip'?'下载':'打开')+'</a></div>';
   list.append(card);card.querySelector('.hub-more').onclick=function(){showActions(f);};
  });
 }
 async function load(force){
  if(loading&&!force)return loading;if(loaded&&!force)return true;
  var stamp=++generation;status.textContent=files.length?'正在刷新文件…':'正在读取文件…';
  var task=(async function(){try{var r=await api(root);if(stamp!==generation)return false;if(!r||!r.ok)throw Error(r?r.error:'请重新登录后查看文件');files=r.files;total=r.total;limits=r.limits||limits;loaded=true;status.textContent='';render();return true;}
   catch(e){if(stamp!==generation)return false;status.replaceChildren();var p=document.createElement('p');p.className='home-load-error';p.textContent='读取失败：'+e.message;var b=document.createElement('button');b.type='button';b.className='btn btn-sm';b.textContent='重试';b.onclick=function(){void load(true);};p.append(b);status.append(p);return false;}
   finally{if(stamp===generation)loading=null;}})();loading=task;return task;
 }
 window.loadHubFiles=load;
 window.invalidateHubFiles=function(){loaded=false;generation++;loading=null;if(window.isHubFilesView&&window.isHubFilesView())void load(true);};
 async function changed(){loaded=false;await load(true);}
 function shareUrl(f,path){return org()+(path||f.share_path);}
 async function copyShare(f){
  if(f.shared&&f.share_path){await copyText(shareUrl(f));return;}
  if(!await showConfirmAsync('分享后，任何拿到链接的人都能打开或下载「'+f.name+'」。替换文件后链接仍指向新内容。确认公开分享？'))return;
  var link=api(root+'/'+f.id+'/share',{method:'POST',json:{revision:f.revision,accept_public:true}}).then(function(r){if(!r||!r.ok)throw Error(r?r.error:'请重新登录');return shareUrl(f,r.path);});
  try{await (typeof copyTextLater==='function'?copyTextLater(link):link.then(function(t){return copyText(t);}));await changed();}catch(e){toast(e.message);}
 }
 async function unshare(f){
  if(!await showConfirmAsync('取消分享后，原链接立即失效。再次分享会生成新链接。确定？'))return;
  try{var r=await api(root+'/'+f.id+'/unshare',{method:'POST',json:{revision:f.revision}});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');await changed();toast('已取消分享');}catch(e){toast(e.message);}
 }
 function showActions(f){
  var actions=[[f.shared?'复制分享链接':'分享并复制链接',function(){void copyShare(f);}]];
  if(f.shared)actions.push(['取消分享',function(){void unshare(f);}]);
  actions.push(['替换文件',function(){window.showUploadHubFile(f);}],['重命名 / 备注',function(){edit(f);}],['删除文件',function(){void remove(f);},true]);
  hubActionMenu('文件 — '+f.name,actions,'文件原样保存，不会解压或修改内容。');
 }
 function guarded(overlay,isBusy){
  function guard(e){if(isBusy()&&(e.key==='Escape'||e.target===overlay)){e.preventDefault();e.stopImmediatePropagation();}}
  overlay.addEventListener('click',guard,true);document.addEventListener('keydown',guard,true);
  new MutationObserver(function(_,observer){if(!overlay.isConnected){observer.disconnect();document.removeEventListener('keydown',guard,true);}}).observe(document.body,{childList:true});
 }
 window.showUploadHubFile=function(f){
  var busy=false,overlay;
  showModal(f?'替换文件':'上传文件','<p class="hub-help">'+(f?'替换「'+esc(f.name)+'」的内容；已开启的分享链接保持不变。':'支持 PDF、txt（UTF-8）和 zip，单个最多 25 MiB，总共最多 '+fmt(limits.total)+'、'+limits.count+' 个。zip 原样保存，不会解压。')+'</p><label for="hubFileInput">文件</label><input class="input" id="hubFileInput" type="file" accept="'+ACCEPT+'">'+(f?'':'<label for="hubFileNote">备注（可选）</label><input class="input" id="hubFileNote" maxlength="500">')+'<p class="home-form-status" id="hubFileFormStatus" role="status" aria-live="polite"></p>',async function(close){
   if(busy)return;var input=overlay.querySelector('#hubFileInput'),file=input.files[0],message=overlay.querySelector('#hubFileFormStatus');
   if(!file){message.textContent='请先选择文件';return;}
   if(!kindOf(file.name)){message.textContent='只支持 .pdf、.txt 和 .zip 文件';return;}
   if(file.size>limits.file){message.textContent='单个文件不能超过 25 MiB';return;}
   busy=true;overlay.querySelector('#mC').disabled=true;overlay.querySelector('#mc').disabled=true;input.disabled=true;message.textContent='正在上传并校验，请勿重复提交…';
   try{var form=new FormData();form.append('file',file);if(f)form.append('revision',f.revision);var note=overlay.querySelector('#hubFileNote');if(note&&note.value.trim())form.append('note',note.value.trim());
    var r=await api(root+(f?'/'+f.id:''),{method:f?'PUT':'POST',body:form,timeout:120000});if(!r||!r.ok)throw Error(r?r.error:'请重新登录后核对文件列表');close();await changed();toast(f?'文件已替换，分享链接保持不变':'文件已保存');
   }catch(e){if(overlay.isConnected)message.textContent=e.name==='AbortError'?'请求超时，结果可能已保存；请关闭弹窗刷新列表核对，不要重复上传。':e.message;}
   finally{busy=false;if(overlay.isConnected){overlay.querySelector('#mC').disabled=false;overlay.querySelector('#mc').disabled=false;input.disabled=false;}}
  });overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent=f?'确认替换':'上传保存';guarded(overlay,function(){return busy;});
 };
 function edit(f){
  var busy=false,overlay;
  showModal('重命名 / 备注','<label for="hubFileName">文件名</label><input class="input" id="hubFileName" maxlength="200" value="'+esc(f.name)+'"><p class="hub-help">扩展名必须保留为 .'+esc(f.kind)+'。</p><label for="hubFileEditNote">备注</label><input class="input" id="hubFileEditNote" maxlength="500" value="'+esc(f.note||'')+'"><p class="home-form-status" id="hubFileFormStatus" role="status"></p>',async function(close){
   if(busy)return;busy=true;overlay.querySelector('#mC').disabled=true;
   try{var r=await api(root+'/'+f.id,{method:'PATCH',json:{name:overlay.querySelector('#hubFileName').value,note:overlay.querySelector('#hubFileEditNote').value,revision:f.revision}});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');close();await changed();toast('已保存');}
   catch(e){if(overlay.isConnected)overlay.querySelector('#hubFileFormStatus').textContent=e.message;}
   finally{busy=false;if(overlay.isConnected)overlay.querySelector('#mC').disabled=false;}
  });overlay=document.querySelector('.modal-overlay:last-child');guarded(overlay,function(){return busy;});
 }
 async function remove(f){
  if(!await showConfirmAsync('删除文件「'+f.name+'」？分享链接会失效。'))return;
  try{var r=await api(root+'/'+f.id,{method:'DELETE',json:{revision:f.revision}});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');await changed();toast('文件已删除');}catch(e){toast(e.message);}
 }
})();
`;
