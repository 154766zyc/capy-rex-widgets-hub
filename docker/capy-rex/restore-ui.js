export const restoreStyles=String.raw`
.restore-file{font-size:13px;overflow-wrap:anywhere;color:var(--text);margin:10px 0}
.restore-progress{width:100%;height:9px;accent-color:var(--accent);margin:12px 0}
.restore-status{font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text2)}
.restore-mode{border:1px solid var(--div);border-radius:12px;padding:8px 12px;margin:10px 0}
.restore-mode legend{font-size:12px;color:var(--text2);padding:0 4px}
.restore-mode label{display:flex;gap:8px;align-items:flex-start;padding:7px 0;font-size:13px;cursor:pointer}
.restore-mode input{margin-top:3px;flex:none}
.restore-mode small{display:block;font-size:12px;line-height:1.6;color:var(--text2);margin-top:2px}
.restore-mode small.hub-danger{color:#c2410c}
.restore-mode[disabled]{opacity:.6}
.restore-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.restore-controls [hidden],.restore-progress[hidden]{display:none!important}
`;
export const restoreUI=String.raw`
(function(){
 var key='rex_hub_restore_job_v1',root='/api/admin/backup/restore/jobs',overlay=null;
 function saved(){try{return localStorage.getItem(key)||'';}catch(e){return '';}}
 function remember(id){try{if(id)localStorage.setItem(key,id);else localStorage.removeItem(key);}catch(e){}}
 function taskId(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  // getRandomValues also works on an ordinary HTTP NAS origin.
  var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  var hex=Array.from(bytes,function(b){return b.toString(16).padStart(2,'0');}).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 }
 window.importBackup=function(){
  if(overlay&&overlay.isConnected)return;
  var panel=overlay=hubReadDialog('恢复备份','<p class="hub-help">按原 ID 恢复模块、合集、首页配置和订阅源，保留原地址。</p><fieldset class="restore-mode" id="restoreMode"><legend>恢复方式</legend><label><input type="radio" name="restoreMode" value="merge" checked> <span><strong>增量合并</strong><small>保留现有数据，备份里相同 ID 的内容覆盖现有内容。路径或分享/来源身份冲突会中止恢复。</small></span></label><label><input type="radio" name="restoreMode" value="full"> <span><strong>全量恢复</strong><small class="hub-danger">先清空备份包含的部分，再恢复成备份里的样子；不在备份里的模块、合集、订阅都会删除。失败会整体回滚。</small></span></label></fieldset><div class="restore-file" id="restoreFile"></div><div class="restore-status" id="restoreStatus" role="status" aria-live="polite">正在检查恢复任务…</div><progress class="restore-progress" id="restoreProgress" max="100" hidden aria-label="当前恢复阶段进度"></progress><div class="restore-controls"><button type="button" class="btn" id="restorePick" disabled>选择备份文件</button><button type="button" class="btn btn-primary" id="restoreConfirm" hidden>确认恢复</button><button type="button" class="btn" id="restoreRetry" hidden>重新查询状态</button></div><p class="hub-help" style="margin-top:12px">上传期间请勿关闭页面；上传完成后可关闭弹窗。重新打开「恢复」可查看任务结果，请勿重复提交。</p>');
  var status=panel.querySelector('#restoreStatus'),bar=panel.querySelector('#restoreProgress'),pick=panel.querySelector('#restorePick'),confirm=panel.querySelector('#restoreConfirm'),retry=panel.querySelector('#restoreRetry'),close=panel.querySelector('#mC');
  var file=null,id=saved(),timer=null,busy=false,done=false,generation=0,modeBox=panel.querySelector('#restoreMode');
  function chosenMode(){var el=panel.querySelector('input[name=restoreMode]:checked');return el?el.value:'merge';}
  function guard(e){if(busy&&(e.key==='Escape'||e.target===panel)){e.preventDefault();e.stopImmediatePropagation();}}
  panel.addEventListener('click',guard,true);document.addEventListener('keydown',guard,true);
  new MutationObserver(function(_,observer){if(!panel.isConnected){clearTimeout(timer);document.removeEventListener('keydown',guard,true);observer.disconnect();}}).observe(document.body,{childList:true});
  function message(text){if(panel.isConnected)status.textContent=text;}
  function schedule(){clearTimeout(timer);if(panel.isConnected&&!done)timer=setTimeout(poll,1500);}
  function display(job){
   if(!panel.isConnected)return;
   id=job.id;remember(id);pick.disabled=true;confirm.hidden=true;bar.hidden=false;retry.hidden=false;modeBox.disabled=true;
   if(job.status==='done'){
    done=true;remember('');bar.value=100;retry.hidden=true;pick.disabled=false;pick.textContent='选择其他备份';
    modeBox.disabled=false;var r=job.result||{};message((r.mode==='full'?'全量恢复完成：':'增量恢复完成：')+(r.scope==='homes'?'':r.modules+' 个模块、'+r.collections+' 个合集')+(r.home_configs!==undefined?(r.scope==='homes'?'':'、')+r.home_configs+' 个首页配置':'')+(r.hub_files?'、'+r.hub_files+' 个文件':'')+'。\n用时 '+Math.max(0,(job.finished_at-job.created_at)/1000).toFixed(1)+' 秒');if(window.invalidateHomes)window.invalidateHomes();if(window.invalidateHubFiles)window.invalidateHubFiles();void loadAll();return;
   }
   if(job.status==='failed'||job.status==='interrupted'){
    done=true;remember('');bar.hidden=true;retry.hidden=true;pick.disabled=false;modeBox.disabled=false;pick.textContent='重新选择备份';message((job.status==='interrupted'?'任务已中断：':'恢复失败：')+(job.error||'未知原因'));return;
   }
   if(['validating','writing','validating_homes','writing_homes'].includes(job.stage)){
    if(job.total)bar.value=job.processed/job.total*100;else bar.removeAttribute('value');
    var labels={validating:'正在校验模块',writing:'正在写入模块',validating_homes:'正在校验首页包',writing_homes:'正在写入首页配置'};
    message(labels[job.stage]+' '+job.processed+' / '+job.total+(['writing','writing_homes'].includes(job.stage)&&job.processed===job.total?'\n正在提交合集和关联数据，请等待最终完成。':''));
   }else{bar.removeAttribute('value');message(job.stage==='uploading'?'等待备份上传完成；如果刚才断线，请等待状态确认。':job.stage==='waiting'?'文件校验完成，等待数据库提交…':'上传完成，正在读取备份…');}
   schedule();
  }
  async function poll(){
   if(!panel.isConnected||busy||!id)return;
   var stamp=++generation;
   try{var r=await api(root+'/'+encodeURIComponent(id));if(stamp!==generation||!panel.isConnected)return;
    if(r&&r.error==='恢复任务不存在'){
     r=await api(root+'/current');if(stamp!==generation||!panel.isConnected)return;
     if(r&&r.ok&&!r.job){id='';remember('');pick.disabled=false;confirm.hidden=!file;confirm.disabled=false;retry.hidden=true;bar.hidden=true;message('未找到已提交的恢复任务，请重新选择文件或点击「确认恢复」。');return;}
    }
    if(!r){message('请重新登录后查询恢复状态');retry.hidden=false;return;}
    if(!r.ok)throw Error(r.error);display(r.job);}
   catch(e){if(stamp!==generation)return;message('暂时无法确认恢复结果，不代表后台失败。\n'+e.message);retry.hidden=false;schedule();}
  }
  function upload(){
   var xhr=new XMLHttpRequest();busy=true;close.disabled=true;retry.hidden=true;bar.hidden=false;bar.value=0;message('正在上传备份…');
   function uncertain(){busy=false;close.disabled=false;message('连接中断，正在查询任务状态；不会自动重新上传。');void poll();}
   xhr.open('PUT',root+'/'+encodeURIComponent(id));xhr.withCredentials=true;xhr.timeout=300000;xhr.setRequestHeader('Content-Type','application/json');
   xhr.upload.onprogress=function(e){if(!panel.isConnected||!e.lengthComputable)return;bar.value=e.loaded/e.total*100;message(e.loaded===e.total?'上传完成，服务端正在读取备份…':'正在上传备份 '+Math.floor(e.loaded/e.total*100)+'%');};
   xhr.onload=function(){busy=false;close.disabled=false;try{var r=JSON.parse(xhr.responseText);if(r.job){display(r.job);return;}if(xhr.status===401){message('登录已过期，请重新登录后查询恢复状态');retry.hidden=false;return;}throw Error(r.error||'无法确认恢复状态');}catch(e){uncertain();}};
   xhr.onerror=uncertain;xhr.ontimeout=uncertain;xhr.onabort=uncertain;xhr.send(file);
  }
  pick.onclick=function(){
   var input=document.createElement('input');input.type='file';input.accept='.json,application/json';
   input.onchange=function(){if(!input.files.length)return;file=input.files[0];if(file.size>512*1024*1024){message('备份超过 512 MiB，请使用离线 SQLite 快照恢复。');confirm.hidden=true;return;}
    generation++;clearTimeout(timer);done=false;id='';bar.hidden=true;retry.hidden=true;panel.querySelector('#restoreFile').textContent=file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB';message('请确认以上恢复规则，再点击「确认恢复」。');confirm.hidden=false;confirm.disabled=false;
    if(file.size>40*1024*1024){var picked=file;fetch('/healthz',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(h){if(file!==picked||!panel.isConnected||!/^cloudflare/.test(h.runtime||''))return;
     if(file.size>95*1024*1024){confirm.hidden=true;message('这份备份有 '+(file.size/1024/1024).toFixed(1)+' MB，超过 Cloudflare 单次上传上限（100 MB）。请在「导出备份」里分开导出「只导出模块数据」「只导出首页配置」「只导出文件栏目」，再分别恢复。');return;}
     message('提醒：这份备份有 '+(file.size/1024/1024).toFixed(1)+' MB。模块文件会边读边处理，一次只占一个文件的内存；但首页配置和文件栏目的内容仍要整段读进内存，它们很多时可能超出 Cloudflare 的 128 MB 内存（失败会整体回滚，现有数据不受影响）。如果失败，请分开导出再分别恢复。\n仍要继续请点击「确认恢复」。');}).catch(function(){});}
   };input.click();
  };
  confirm.onclick=async function(){
   if(busy||!file)return;
   var mode=chosenMode();
   if(mode==='full'&&!await showConfirmAsync('全量恢复会先清空备份包含的部分（不在备份里的模块、合集、订阅、图标、文件都会删除），再按备份恢复。确定继续？'))return;busy=true;close.disabled=true;pick.disabled=true;confirm.disabled=true;done=false;id=taskId();remember(id);message('正在创建恢复任务…');
   try{var r=await api(root,{method:'POST',json:{id:id,mode:mode},timeout:30000});busy=false;close.disabled=false;if(!r||!r.job)throw Error(r?r.error:'无法确认是否创建恢复任务');
    if(!r.ok){display(r.job);return;}id=r.job.id;remember(id);confirm.hidden=true;
    if(r.job.status==='uploading')upload();else display(r.job);
   }catch(e){busy=false;close.disabled=false;confirm.hidden=true;message('创建任务的结果尚未确认，不会自动重复提交。');retry.hidden=false;void poll();}
  };
  retry.onclick=function(){void poll();};
  (async function(){
   try{var r=await api(id?root+'/'+encodeURIComponent(id):root+'/current');if(!panel.isConnected)return;
    if(r&&r.job){display(r.job);return;}if(!r||!r.ok){if(r&&r.error==='恢复任务不存在'){remember('');id='';}else throw Error(r?r.error:'请重新登录后查看恢复任务');}
    pick.disabled=false;message('请选择 JSON 备份文件。');
   }catch(e){message('暂时无法检查恢复任务：'+e.message);retry.hidden=false;retry.onclick=function(){panel.remove();window.importBackup();};}
  })();
 };
})();
`;
