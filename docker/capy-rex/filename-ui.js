export const filenameStyles=String.raw`
.hub-tool-row.set-row{width:100%;box-sizing:border-box;min-height:60px;padding:6px 14px;gap:10px}
button.hub-tool-row.set-row{border:0;background:none;text-align:left;font:inherit;color:var(--text)}
.hub-tool-group .set-row+.hub-tool-row,#settingsTools .hub-tool-row+.set-row{border-top:1px solid var(--div)}
button.hub-tool-row:disabled{opacity:.55;cursor:default}
.hub-tool-switch-row{cursor:default}
.hub-tool-row .hub-tool-icon{width:18px;height:18px;flex:none;color:var(--text2)}
.hub-tool-meta{display:grid;gap:3px;min-width:0;flex:1}
.hub-tool-meta strong{font-size:14px;font-weight:600;color:var(--text)}
.hub-tool-meta small,.hub-tool-hint{font-size:11.5px;color:var(--text2);line-height:1.45}
.hub-tool-hint{margin:8px 4px 0}
.hub-tool-hint code{font-size:inherit}
.hub-tool-status{color:var(--hub-bad);margin:5px 4px 0;font-size:11.5px;line-height:1.45;overflow-wrap:anywhere}
.hub-tool-status:empty{display:none}
#retryFilenameSettings[hidden]{display:none!important}
`;

export const filenameUI=String.raw`
async function downloadModule(id,button){
 if(button&&button.disabled)return;if(button)button.disabled=true;
 try{var r=await fetch(org()+'/api/admin/modules/'+encodeURIComponent(id)+'/download',{credentials:'same-origin'});
  if(!r.ok){var error=await r.json().catch(function(){return {};});throw Error(error.error||'下载失败（'+r.status+'）');}
  var header=r.headers.get('Content-Disposition')||'',match=header.match(/filename\*=UTF-8''([^;]+)/i);
  if(!/^attachment;/i.test(header)||!match)throw Error('下载响应无效，未保存文件');
  var name=decodeURIComponent(match[1]),blob=await r.blob();if(!blob.size)throw Error('模块文件为空');
  var link=URL.createObjectURL(blob),a=document.createElement('a');a.href=link;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(link);},30000);toast('已下载：'+name);
 }catch(e){toast(e.message);}finally{if(button)button.disabled=false;}
}
(function(){
 async function call(path,options){var r=await api(path,options);if(!r||r.error&&!r.ok)throw Error(r?r.error:'请求失败');return r;}
 var fileIcon='<svg class="hub-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h6l4 4v14H6V3h2Zm6 0v5h4M9 12h6m-6 4h6"/></svg>';
 var scanIcon='<svg class="hub-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></svg>';
 var chev='<span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></span>';
 var tools=document.getElementById('settingsTools');if(!tools)return;
 var open=document.createElement('button');open.type='button';open.className='set-row hub-tool-row';open.id='openFilenameCleanup';open.setAttribute('aria-haspopup','dialog');
 open.innerHTML=fileIcon+'<span class="hub-tool-meta"><strong>文件名清理</strong><small>清理文件名中的 rex，避免导入 Rex 后出现「模块校验失败」的情况。</small></span>'+chev;
 tools.prepend(open);
 open.onclick=function(){
  var overlay=hubReadDialog('文件名清理','<div id="filenameSettings"><div class="set-group hub-tool-group"><div class="set-row hub-tool-row hub-tool-switch-row">'+fileIcon+
   '<div class="hub-tool-meta"><strong id="filenameAutoLabel">自动清理新模块文件名</strong><small id="filenameAutoHint">仅对之后新导入的模块生效，修改后自动保存</small></div><button type="button" class="hub-icon-switch" id="autoCleanFilename" role="switch" aria-labelledby="filenameAutoLabel" aria-describedby="filenameAutoHint" aria-checked="false" disabled><span class="hub-switch-track" aria-hidden="true"></span></button></div>'+
   '<button type="button" class="set-row hub-tool-row" id="scanFilenames">'+scanIcon+'<span class="hub-tool-meta"><strong>扫描已有文件名</strong><small>先预览改名结果，再确认</small></span>'+chev+'</button></div>'+
   '<p class="hub-tool-hint">仅清理文件名中的 <code>rex</code>，不区分大小写。不修改模块代码，也不处理其他原因导致的校验失败。旧模块链接、合集地址、顺序和备注继续保留。</p><p class="hub-tool-status" id="filenameSettingError" role="status"></p><button type="button" class="btn btn-sm" id="retryFilenameSettings" hidden>重新读取设置</button><p class="hub-tool-status" id="filenameStatus" role="status"></p></div>');
  var toggle=overlay.querySelector('#autoCleanFilename'),scan=overlay.querySelector('#scanFilenames'),status=overlay.querySelector('#filenameStatus'),settingError=overlay.querySelector('#filenameSettingError'),retry=overlay.querySelector('#retryFilenameSettings');
  var loading=false,loaded=false,saving=false,scanning=false;
  function checked(next){toggle.setAttribute('aria-checked',String(!!next));}
  function controls(){toggle.disabled=!loaded||loading||saving||scanning;scan.disabled=loading||saving||scanning;retry.disabled=loading||saving||scanning;toggle.setAttribute('aria-busy',String(loading||saving));}
  async function load(){
   if(loading||saving||scanning)return;loading=true;loaded=false;settingError.textContent='';retry.hidden=true;controls();
   try{var r=await call('/api/admin/filename-settings');if(typeof r.auto_clean!=='boolean')throw Error('设置响应无效，请重试');checked(r.auto_clean);loaded=true;}
   catch(e){settingError.textContent=e.message;retry.hidden=false;}
   finally{loading=false;controls();}
  }
  toggle.onclick=async function(){
   if(toggle.disabled)return;var previous=toggle.getAttribute('aria-checked')==='true';saving=true;checked(!previous);settingError.textContent='';controls();
   try{var r=await call('/api/admin/filename-settings',{method:'PATCH',json:{auto_clean:!previous}});if(typeof r.auto_clean!=='boolean')throw Error('设置响应无效，请重新打开确认');checked(r.auto_clean);if(overlay.isConnected)toast('配置已保存');}
   catch(e){checked(previous);settingError.textContent=e.message;}
   finally{saving=false;controls();}
  };
  retry.onclick=load;
  scan.onclick=async function(){
   if(scan.disabled)return;scanning=true;controls();scan.setAttribute('aria-busy','true');status.textContent='';toast('正在扫描…');
   try{var r=await call('/api/admin/modules/filenames');if(!Array.isArray(r.rows))throw Error('扫描响应无效，请重试');if(!overlay.isConnected)return;if(r.rows.length){overlay.remove();showScan(r.rows);}else{status.textContent='没有需要清理的文件名';toast(status.textContent);}}
   catch(e){status.textContent=e.message;}
   finally{scanning=false;controls();scan.removeAttribute('aria-busy');}
  };
  void load();
 };
 function showScan(rows){
  var h='<p class="icon-help">仅改变对外文件名。旧模块链接、合集地址、顺序和备注继续保留。可取消勾选或编辑建议名称；同名时自动附加模块编号。</p><label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input type="checkbox" id="filenameAll" checked>全选</label><div style="max-height:46vh;overflow:auto">';
  rows.forEach(function(row,i){h+='<div style="padding:12px 0;border-bottom:1px solid var(--div);overflow-wrap:anywhere"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-name-index="'+i+'" checked>'+esc(row.title||row.current)+'</label><p class="icon-help">当前：'+esc(row.current)+'</p><label for="repairName-'+i+'">改为</label><input class="input" id="repairName-'+i+'" maxlength="153" value="'+esc(row.suggested)+'"><p class="icon-help" id="repairResult-'+i+'"></p></div>';});
  h+='</div><p class="icon-help" id="repairProgress" aria-live="polite"></p>';
  var busy=false,completed=new Set();
  showModal('清理已有模块文件名',h,async function(close){if(busy)return;
   var selected=Array.from(overlay.querySelectorAll('[data-name-index]:checked')).map(function(c){return Number(c.dataset.nameIndex);}).filter(function(i){return !completed.has(i);});
   if(!selected.length){if(completed.size)close();else toast('请选择模块');return;}
   var draft=selected.map(function(i){return {id:rows[i].id,filename:overlay.querySelector('#repairName-'+i).value.trim(),revision:rows[i].revision};});
   busy=true;controls(true);var progress=overlay.querySelector('#repairProgress');
   try{for(var offset=0;offset<draft.length;offset+=20){progress.textContent='正在保存 '+(offset+1)+'～'+Math.min(offset+20,draft.length)+' / '+draft.length;
     var r=await call('/api/admin/modules/filenames',{method:'POST',json:{rows:draft.slice(offset,offset+20)}});
     r.results.forEach(function(result){var i=rows.findIndex(function(row){return row.id===result.id;});completed.add(i);overlay.querySelector('#repairResult-'+i).textContent='已改为：'+result.filename;});}
    progress.textContent='已完成 '+completed.size+' 个模块。';toast(progress.textContent);overlay.querySelector('#mC').textContent='完成';await loadAll();
   }catch(e){progress.textContent='未完成：'+e.message+'。已完成的项目已保留；模块有变化时请关闭后重新扫描。';}finally{busy=false;controls(false);}
  });
  var overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent='确认改名';
  var panel=overlay.querySelector('.modal');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','清理已有模块文件名');
  function controls(disabled){overlay.querySelectorAll('button,input').forEach(function(el){var i=el.dataset.nameIndex!==undefined?Number(el.dataset.nameIndex):el.id.startsWith('repairName-')?Number(el.id.slice(11)):-1;el.disabled=disabled||completed.has(i);});}
  overlay.querySelector('#filenameAll').onchange=function(){var checked=this.checked;overlay.querySelectorAll('[data-name-index]').forEach(function(c){if(!c.disabled)c.checked=checked;});};
  overlay.addEventListener('click',function(e){if(busy&&e.target===overlay){e.stopImmediatePropagation();e.preventDefault();}},true);
 }
})();
`;
