export const homeStyles=String.raw`
#page-collections [hidden]{display:none!important}
.collection-head{gap:8px;margin:14px 0 10px;min-width:0}
.collection-head>.btn{flex:none;white-space:nowrap}
.collection-segments{display:inline-flex;min-width:0;background:var(--field);border:1px solid var(--card-brd);padding:3px;border-radius:13px;gap:2px}
.collection-segments button{position:relative;min-height:34px;padding:6px 11px;border:0;border-radius:10px;background:transparent;color:var(--text2);font-family:inherit;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}
.collection-segments button::before{content:'';position:absolute;inset:-5px 0}
.collection-segments button[aria-selected=true]{color:var(--accent);background:var(--card);box-shadow:0 1px 5px #0000000c}
.collection-segments button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.collection-total{font-size:12px;color:var(--text2);margin:0 4px 12px;line-height:1.6}
.home-card{padding:16px!important}.home-card .hub-title{white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.45}
.home-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--div);padding-top:12px;margin-top:12px}
.home-foot small{font-size:11px;color:var(--text2);min-width:0;overflow-wrap:anywhere;line-height:1.7}
.home-export{text-decoration:none;font-family:inherit;font-size:12px;font-weight:600;min-height:36px}
.home-load-error{font-size:12px;color:var(--text2);line-height:1.7;margin:10px 4px}.home-load-error button{margin-left:8px}
.home-status{display:block;margin-top:3px;font-size:11px;color:var(--text2);line-height:1.5;overflow-wrap:anywhere}.home-status.warn{color:#c2410c}
.home-pick{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}.home-copy{margin-top:8px}
.home-check{margin:0;max-height:60vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);background:var(--field);border:1px solid var(--card-brd);border-radius:10px;padding:10px}
.home-form-status{font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text2);margin-top:10px}
@media(max-width:360px){.collection-head{gap:5px}.collection-head>.btn{font-size:12px;padding:8px 9px}.collection-segments button{padding:6px 8px;font-size:11px}.collection-segments{gap:0}.home-card{padding:14px!important}}
`;
export const homeUI=String.raw`
(function(){
 var root='/api/admin/home-configs',homes=[],loaded=false,loading=null,generation=0,section='modules';
 // 3.5.8：合集页三个栏目：模块合集、首页配置、文件。
 var SECTIONS=['modules','homes','files'];
 try{var savedSection=localStorage.getItem('rex_hub_col_section_v1');if(SECTIONS.indexOf(savedSection)>=0)section=savedSection;}catch(e){}
 var moduleTab=document.getElementById('moduleCollectionsTab'),homeTab=document.getElementById('homeConfigsTab'),fileTab=document.getElementById('hubFilesTab'),list=document.getElementById('homeConfigsList'),status=document.getElementById('homeLoadStatus');
 var tabs={modules:moduleTab,homes:homeTab,files:fileTab};
 function active(){return state.tab==='collections'&&section==='homes';}
 function applySection(){
  var isHome=section==='homes',isFiles=section==='files';
  document.getElementById('moduleCollectionsPanel').hidden=isHome||isFiles;document.getElementById('homeConfigsPanel').hidden=!isHome;document.getElementById('hubFilesPanel').hidden=!isFiles;
  document.getElementById('newModuleCollection').hidden=isHome||isFiles;document.getElementById('uploadHomeConfig').hidden=!isHome;document.getElementById('uploadHubFile').hidden=!isFiles;
  SECTIONS.forEach(function(name){tabs[name].setAttribute('aria-selected',String(section===name));tabs[name].tabIndex=section===name?0:-1;});
  if(active())void loadHomes(false);
  if(state.tab==='collections'&&isFiles&&window.loadHubFiles)void window.loadHubFiles(false);
 }
 window.isHomeConfigsView=active;
 window.isHubFilesView=function(){return state.tab==='collections'&&section==='files';};
 window.switchCollectionSection=function(value){section=SECTIONS.indexOf(value)>=0?value:'modules';try{localStorage.setItem('rex_hub_col_section_v1',section);}catch(e){}applySection();};
 SECTIONS.forEach(function(name){tabs[name].onkeydown=function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();var i=SECTIONS.indexOf(section);var target=e.key==='Home'?SECTIONS[0]:e.key==='End'?SECTIONS[SECTIONS.length-1]:SECTIONS[(i+(e.key==='ArrowRight'?1:SECTIONS.length-1))%SECTIONS.length];window.switchCollectionSection(target);tabs[target].focus();};});
 var render=renderCols;renderCols=function(){render.apply(this,arguments);applySection();};
 window.invalidateHomes=function(){loaded=false;generation++;loading=null;if(active())void loadHomes(true);};
 window.refreshHomeConfigs=function(){return loadHomes(true);};
 // 3.6.0：卡片上直接显示检查摘要；没检查过的显示「还没检查」。
 function statusText(home){var c=home.check;if(!c)return '还没检查 · 点调整按钮里的「检查首页」';var parts=['v'+c.version];if(c.html_cards)parts.push(c.html_cards+' 张 HTML 卡片');if(c.scripts)parts.push(c.scripts+' 个内置脚本');if(c.local_items)parts.push(c.local_items+' 个本机模块项目');parts.push(c.warnings?c.warnings+' 条提示':'没有问题');return parts.join(' · ');}
 function renderHomes(){
  document.getElementById('homeCount').textContent='共 '+homes.length+' 个首页配置';list.replaceChildren();
  if(!homes.length){list.innerHTML='<div class="empty"><p>还没有首页配置</p><p class="hub-help">上传从 Rex 导出的 .rex 首页包（也支持 Forward 的 .fwd，会自动转换），原文件会完整保留。</p></div>';return;}
  homes.forEach(function(home){
   var card=document.createElement('article');card.className='card home-card';
   card.innerHTML='<div class="hub-row"><span class="hub-avatar">'+esc(hubInitial(home.title,'首'))+'</span><div class="hub-meta"><span class="hub-title">'+esc(home.title)+'</span><span class="hub-muted">'+home.sections+' 个栏目 · '+home.items+' 个布局项目</span><span class="home-status'+(home.check&&(home.check.warnings||home.check.html_issues)?' warn':'')+'">'+esc(statusText(home))+'</span></div>'+hubManageButton('首页配置管理')+'</div><div class="home-foot"><small>'+esc(fmt(home.size))+' · '+esc(new Date(home.updated_at).toLocaleDateString('zh-CN'))+' 更新</small><a class="rex-import home-export" href="'+root+'/'+encodeURIComponent(home.id)+'/file" download>'+manageIcon('import')+'导出 .rex</a></div>';
   list.append(card);hubAvatarImage(card.querySelector('.hub-avatar'),home.avatar_url||'');card.querySelector('.hub-more').onclick=function(){showActions(home);};
  });
 }
 async function loadHomes(force){
  if(loading&&!force)return loading;if(loaded&&!force)return true;
  var stamp=++generation;status.textContent=homes.length?'正在刷新首页配置…':'正在读取首页配置…';
  var task=(async function(){try{var rows=await api(root);if(stamp!==generation)return false;if(!Array.isArray(rows))throw Error(rows?rows.error:'请重新登录后查看首页配置');homes=rows;loaded=true;status.textContent='';renderHomes();return true;}
   catch(e){if(stamp!==generation)return false;status.replaceChildren();var text=document.createElement('p');text.className='home-load-error';text.textContent='读取失败：'+e.message;var retry=document.createElement('button');retry.type='button';retry.className='btn btn-sm';retry.textContent='重试';retry.onclick=function(){void loadHomes(true);};text.append(retry);status.append(text);return false;}
   finally{if(stamp===generation)loading=null;}})();loading=task;return task;
 }
 async function changed(){loaded=false;await loadHomes(true);}
 async function copyShare(home){
  // Already shared: copy right away inside the tap (iOS Safari blocks copies after a network wait).
  if(home.shared&&home.share_path){await copyText(org()+home.share_path);return;}
  if(!await showConfirmAsync('分享后，持有链接的人可下载完整首页文件，其中可能包含模块地址和参数。替换文件后链接仍指向新文件。确认公开分享？'))return;
  var link=api(root+'/'+home.id+'/share',{method:'POST',json:{revision:home.revision,accept_public:true}}).then(function(r){if(!r||!r.ok)throw Error(r?r.error:'请重新登录');return org()+r.path;});
  try{await (typeof copyTextLater==='function'?copyTextLater(link):link.then(function(t){return copyText(t);}));await changed();}catch(e){toast(e.message);}
 }
 function showActions(home){hubActionMenu('首页配置 — '+home.title,[
  ['复制分享链接',function(){void copyShare(home);}]].concat(home.shared?[['取消分享',function(){void revokeShare(home);}],['换新分享链接',function(){void rotateShare(home);}]]:[]).concat([
  ['替换文件',function(){showUploadHome(home);}],['重命名',function(){renameHome(home);}],['检查首页',function(){void checkHome(home);}],
  ['换成 Hub 模块链接',function(){void showRelink(home);}],['装上 HTML 卡片',function(){void showAttachHtml(home);}],
  ['删除首页配置',function(){void deleteHome(home);},true]
 ]),'首页包独立保存，不修改模块库或模块合集。');}
 // 3.6.0：首页检查报告（只读，不执行脚本、不发网）。
 function checkLines(r){
  var out=[];out.push('首页包格式：version '+r.version+(r.version===2?'（支持 HTML 卡片）':''));
  out.push('HTML 卡片：'+r.html_cards.length+' 张；内置脚本：'+r.scripts.length+' 个；本机模块项目：'+r.local_items);
  if(r.warnings.length){out.push('');out.push('需要注意（'+r.warnings.length+'）：');r.warnings.forEach(function(w,i){out.push((i+1)+'. '+w);});}else{out.push('');out.push('没有发现问题。');}
  if(r.html_cards.length){out.push('');out.push('HTML 卡片：');var uses={};r.html_cards.forEach(function(c){if(c.template_id)uses[c.template_id]=(uses[c.template_id]||0)+1;});r.html_cards.forEach(function(c){out.push('· '+c.where+'｜'+(c.source==='file'?'rex-html/'+c.name:'内联')+(c.template_id?'｜模板 '+c.template_id+(c.template_version!=null?' 第 '+c.template_version+' 版':'')+(uses[c.template_id]>1?'（'+uses[c.template_id]+' 行共用）':''):'')+'｜'+c.bytes+' 字节｜'+(c.declaration?c.declaration.text:'无声明'));c.issues.forEach(function(x){out.push('    ⚠ '+x);});});}
  if(r.scripts.length){out.push('');out.push('内置脚本（rex-scripts/）：');r.scripts.forEach(function(x){out.push('· '+x.name+'｜'+(x.encrypted?'加密':'明文')+'｜'+x.bytes+' 字节'+(x.hosts.length?'｜用到：'+x.hosts.join('、'):''));});}
  if(r.links.length){out.push('');out.push('模块链接来源：');r.links.forEach(function(x){out.push('· '+x.host+'（'+x.items+' 个项目）');});}
  if(r.modules&&r.modules.length){out.push('');out.push('模块对照（和本站模块库比）：');var KIND={hub:'本站链接',external:'外站链接',local:'本机模块',bundled:'内置脚本',builtin:'Rex 内置',invalid:'地址无效'};
   r.modules.forEach(function(m){out.push('· '+(m.name||m.widget_id||'未命名')+'｜'+(KIND[m.kind]||m.kind)+'｜'+m.items+' 个项目｜'+(m.hub?'本站有：'+m.hub.title+(m.hub.version?' '+m.hub.version:'')+(m.hub.encrypted?'（加密）':'')+(m.hub.copies>1?'（同 ID 共 '+m.hub.copies+' 个，用最近更新的）':'')+(m.relinkable?'，可换成本站链接':''):'本站没有'));});}
  out.push('');out.push(r.note);return out.join('\n');
 }
 async function checkHome(home){
  try{var r=await api(root+'/'+home.id+'/check');if(!r||!r.ok)throw Error(r?r.error:'请重新登录');
   var text=checkLines(r);
   showModal('检查首页 — '+esc(home.title),'<pre class="home-check">'+esc(text)+'</pre><button type="button" class="btn btn-sm home-copy" id="homeCopyReport">复制全文</button>',function(close){close();});
   // 3.6.0：「复制全文」方便贴到群里或发给 AI。
   var overlay=document.querySelector('.modal-overlay:last-child');if(overlay){var ok=overlay.querySelector('#mC');if(ok)ok.textContent='关闭';var cancel=overlay.querySelector('#mc');if(cancel){cancel.hidden=true;cancel.style.display='none';}var copy=overlay.querySelector('#homeCopyReport');if(copy)copy.onclick=function(){void copyText(text);};}
   if(!home.check||home.check.check_version!==r.check_version)void changed();
  }catch(e){toast('检查失败：'+e.message);}
 }
 window.checkHomeConfig=checkHome;
 async function shareAction(home,action,message,done){
  if(!await showConfirmAsync(message))return;
  // 换新链接：和首次分享一样，在点确认的当下就开始写剪贴板（iOS Safari 不允许网络等待后再复制）。
  var request=api(root+'/'+home.id+'/share/'+action,{method:'POST',json:{revision:home.revision}}).then(function(r){if(!r||!r.ok)throw Error(r?r.error:'请重新登录');return r;});
  try{if(action==='rotate'){var link=request.then(function(r){return org()+r.path;});await (typeof copyTextLater==='function'?copyTextLater(link):link.then(function(t){return copyText(t);}));}else await request;await changed();toast(done);}catch(e){toast(e.message);}
 }
 function revokeShare(home){return shareAction(home,'revoke','取消分享后，旧链接马上失效（已经下载走的文件收不回）。首页本身保留，以后再分享会生成新地址。确认取消？','已取消分享，旧链接失效');}
 function rotateShare(home){return shareAction(home,'rotate','换新链接后，旧链接马上作废，新链接会复制到剪贴板。确认换新？','已换新分享链接，并已复制');}
 var SAVE_OPTIONS='<label for="homeSave">保存方式</label><select class="input" id="homeSave"><option value="new">另存为新首页（推荐，原首页不动）</option><option value="replace">覆盖当前首页（保留分享链接）</option></select>';
 function lockModal(overlay,busy){['#mC','#mc'].forEach(function(k){var b=overlay.querySelector(k);if(b)b.disabled=busy;});}
 async function savedToast(r,what){await changed();toast(what+(r.saved==='new'?'，已另存为新首页':'，已覆盖当前首页')+(r.check&&r.check.warnings?'；有 '+r.check.warnings+' 条提示':''));}
 async function loadReport(home){var r=await api(root+'/'+home.id+'/check');if(!r||!r.ok)throw Error(r?r.error:'请重新登录');return r;}
 async function showRelink(home){
  var r;try{r=await loadReport(home);}catch(e){toast('读取失败：'+e.message);return;}
  var list=(r.modules||[]).filter(function(m){return m.relinkable;}),missing=(r.modules||[]).filter(function(m){return (m.kind==='local'||m.kind==='bundled')&&!m.hub;});
  if(!list.length){toast(missing.length?'本机模块在本站都找不到同 widgetId 的模块，先把模块上传到 Hub 再试':'没有需要替换的本机模块或内置脚本');return;}
  var busy=false,overlay,rows=list.map(function(m,i){return '<label class="home-pick"><input type="checkbox" id="relink'+i+'" checked> '+esc(m.name||m.widget_id)+'（'+m.items+' 个项目 → '+esc(m.hub.title)+'）</label>';}).join('');
  showModal('换成 Hub 模块链接','<p class="hub-help">把用本机模块（file://）或内置脚本的项目，换成本站同 widgetId 模块的链接。别人导入后这些行就能自己下载模块。其他项目不动。</p>'+rows+(missing.length?'<p class="hub-help">本站没有、不会替换：'+esc(missing.map(function(m){return m.name||m.widget_id;}).join('、'))+'</p>':'')+SAVE_OPTIONS+'<p class="home-form-status" id="homeFormStatus" role="status" aria-live="polite"></p>',async function(close){
   if(busy)return;var ids=list.filter(function(m,i){return overlay.querySelector('#relink'+i).checked;}).map(function(m){return m.widget_id;}),message=overlay.querySelector('#homeFormStatus');
   if(!ids.length){message.textContent='至少选一个模块';return;}busy=true;lockModal(overlay,true);message.textContent='正在生成新的首页包…';
   try{var x=await api(root+'/'+home.id+'/relink',{method:'POST',json:{revision:home.revision,widget_ids:ids,save:overlay.querySelector('#homeSave').value}});if(!x||!x.ok)throw Error(x?x.error:'请重新登录');close();await savedToast(x,'已替换 '+x.changed+' 个项目');}
   catch(e){if(overlay.isConnected)message.textContent=e.message;}finally{busy=false;if(overlay.isConnected)lockModal(overlay,false);}
  });overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent='生成';protect(overlay,function(){return busy;});
 }
 async function showAttachHtml(home){
  var r;try{r=await loadReport(home);}catch(e){toast('读取失败：'+e.message);return;}
  var options=[];(r.outline||[]).forEach(function(s){(s.items||[]).forEach(function(it){options.push('<option value="'+s.index+':'+it.index+'">'+esc((s.title||'未命名栏目')+' · '+(it.title||'项目 '+(it.index+1))+(it.html?'（已有 HTML 卡片）':''))+'</option>');});});
  if(!options.length){toast('这个首页没有可放卡片的项目');return;}
  var busy=false,overlay;
  showModal('装上 HTML 卡片','<p class="hub-help">选一个项目，上传官方工作台下载的单卡 .html。会按卡片里的尺寸声明自动配好 style 和 gridSize，把 HTML 放进 rex-html/，manifest 改成 version 2。全宽和横滑卡要求这一行只有一个项目。</p><label for="homeTarget">放在哪个项目</label><select class="input" id="homeTarget">'+options.join('')+'</select><label for="homeHtml">HTML 卡片文件</label><input class="input" id="homeHtml" type="file" accept=".html,.htm,text/html"><label class="home-pick"><input type="checkbox" id="homeRemove"> 改为去掉这个项目的 HTML 卡片</label>'+SAVE_OPTIONS+'<p class="home-form-status" id="homeFormStatus" role="status" aria-live="polite"></p>',async function(close){
   if(busy)return;var message=overlay.querySelector('#homeFormStatus'),target=overlay.querySelector('#homeTarget').value.split(':'),remove=overlay.querySelector('#homeRemove').checked,file=overlay.querySelector('#homeHtml').files[0];
   if(!remove&&!file){message.textContent='请先选择 .html 文件';return;}if(!remove&&file.size>32768){message.textContent='HTML 卡片超过 32,768 字节，Rex 会拒绝';return;}
   busy=true;lockModal(overlay,true);message.textContent='正在生成新的首页包…';
   try{var form=new FormData();form.append('revision',home.revision);form.append('section',target[0]);form.append('item',target[1]);form.append('save',overlay.querySelector('#homeSave').value);if(remove)form.append('remove','true');else form.append('file',file);
    var x=await api(root+'/'+home.id+'/html',{method:'POST',body:form,timeout:120000});if(!x||!x.ok)throw Error(x?x.error:'请重新登录');close();await savedToast(x,remove?'已去掉 HTML 卡片':'已装上 HTML 卡片（'+x.style+' '+JSON.stringify(x.gridSize)+'）');}
   catch(e){if(overlay.isConnected)message.textContent=e.message;}finally{busy=false;if(overlay.isConnected)lockModal(overlay,false);}
  });overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent='生成';protect(overlay,function(){return busy;});
 }
 function protect(overlay,isBusy){
  var panel=overlay.querySelector('.modal');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',panel.querySelector('h3').textContent);
  function guard(e){if(isBusy()&&(e.key==='Escape'||e.target===overlay)){e.preventDefault();e.stopImmediatePropagation();}}
  overlay.addEventListener('click',guard,true);document.addEventListener('keydown',guard,true);
  new MutationObserver(function(_,observer){if(!overlay.isConnected){observer.disconnect();document.removeEventListener('keydown',guard,true);}}).observe(document.body,{childList:true});
 }
 window.showUploadHome=function(home){
  var busy=false,overlay;
  showModal(home?'替换首页文件':'上传首页','<p class="hub-help">'+(home?'替换「'+esc(home.title)+'」的原文件；显示名称和已开启的分享链接保持不变。新文件验证失败会保留旧文件。':'支持 Rex 导出的 .rex 首页包（version 1 和带 HTML 卡片的 version 2），也支持 Forward 的 .fwd（自动转换成 .rex，栏目原样保留；转换结果未在 Rex 实测）。最多 25 MiB，不展开导入模块。')+'</p><label for="homeFile">首页文件</label><input class="input" id="homeFile" type="file" accept=".rex,.fwd"><p class="home-form-status" id="homeFormStatus" role="status" aria-live="polite"></p>',async function(close){
   if(busy)return;var file=overlay.querySelector('#homeFile').files[0],message=overlay.querySelector('#homeFormStatus');
   if(!file){message.textContent='请先选择 .rex 或 .fwd 首页文件';return;}if(!/^.+\.(rex|fwd)$/i.test(file.name)||file.size>25*1024*1024){message.textContent='请选择不超过 25 MiB 的 .rex 或 .fwd 文件';return;}
   busy=true;overlay.querySelector('#mC').disabled=true;overlay.querySelector('#mc').disabled=true;overlay.querySelector('#homeFile').disabled=true;message.textContent='正在上传并校验首页包，请勿重复提交…';
   try{var form=new FormData();form.append('file',file);if(home)form.append('revision',home.revision);
    var r=await api(root+(home?'/'+home.id:''),{method:home?'PUT':'POST',body:form,timeout:120000});if(!r||!r.ok)throw Error(r?r.error:'请重新登录后核对首页列表');close();await changed();toast((r.converted_from==='fwd'?'已从 Forward .fwd 转换为 .rex（未在 Rex 实测）。':'')+(home?'首页文件已替换，原分享链接保持不变':'首页配置已保存')+(r.check&&r.check.html_cards?'；含 '+r.check.html_cards+' 张 HTML 卡片':'')+(r.check&&r.check.warnings?'；有 '+r.check.warnings+' 条提示，可在菜单「检查首页」查看':''));
   }catch(e){if(overlay.isConnected)message.textContent=e.name==='AbortError'?'请求超时，结果可能已保存；请先关闭弹窗刷新列表核对，不要重复上传。':e.message;}
   finally{busy=false;if(overlay.isConnected){overlay.querySelector('#mC').disabled=false;overlay.querySelector('#mc').disabled=false;overlay.querySelector('#homeFile').disabled=false;}}
  });overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent=home?'确认替换':'上传保存';protect(overlay,function(){return busy;});
 };
 function renameHome(home){
  var busy=false,overlay;showModal('重命名首页','<label for="homeName">显示名称</label><input class="input" id="homeName" maxlength="200" value="'+esc(home.title)+'"><p class="hub-help">仅修改 Hub 卡片和导出文件名，不修改包内首页名称或原文件内容。</p><p class="home-form-status" id="homeFormStatus" role="status"></p>',async function(close){
   if(busy)return;busy=true;overlay.querySelector('#mC').disabled=true;
   try{var r=await api(root+'/'+home.id,{method:'PATCH',json:{title:overlay.querySelector('#homeName').value,revision:home.revision}});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');close();await changed();toast('已重命名');}
   catch(e){if(overlay.isConnected)overlay.querySelector('#homeFormStatus').textContent=e.message;}
   finally{busy=false;if(overlay.isConnected)overlay.querySelector('#mC').disabled=false;}
  });overlay=document.querySelector('.modal-overlay:last-child');protect(overlay,function(){return busy;});
 }
 async function deleteHome(home){
  if(!await showConfirmAsync('删除首页配置「'+home.title+'」？原分享链接将失效，不会删除模块库和模块合集。'))return;
  try{var r=await api(root+'/'+home.id,{method:'DELETE',json:{revision:home.revision}});if(!r||!r.ok)throw Error(r?r.error:'请重新登录');await changed();toast('首页配置已删除');}catch(e){toast(e.message);}
 }
 applySection();
})();
`;
