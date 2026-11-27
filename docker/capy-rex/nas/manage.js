/* NAS-only integration; platform and author group stay independent. */
(()=>{
let platforms=new Map();
const checker=document.createElement('a');checker.href='/checker';checker.textContent='在线静态检查 · 测试前请勿加密！';checker.className='checker-entry';document.body.prepend(checker);
const original=renderMods;
renderMods=function(){original();document.querySelectorAll('#modulesList .row[data-mid]').forEach(row=>{const m=platforms.get(row.dataset.mid);if(!m)return;const b=row.querySelector('.rex-import');if(b){b.textContent=m.platform==='capy'?'安装 Capy':'安装 Rex';const img=document.createElement('img');img.src=m.platform==='capy'?'/app-icons/capy-v1-48.png':'/app-icons/rex-mulberry-v1-192.png';img.width=22;img.height=22;img.alt='';img.style.borderRadius='6px';b.prepend(img);b.title=b.textContent;b.setAttribute('aria-label',b.textContent+' '+m.title);b.onclick=()=>install(m);}
const info=row.querySelector('.info');if(info){const edit=document.createElement('button');edit.className='module-tag';edit.textContent='播放器 '+(m.platform==='capy'?'Capy':'Rex');edit.onclick=async()=>{const next=m.platform==='capy'?'rex':'capy';if(!confirm('将播放器改为 '+next+'？作者分组保持不变。'))return;const r=await fetch('/api/community/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module_id:m.id,platform:next})});if(!r.ok){toast('分类修改失败');return;}await refresh();};info.append(edit);}});};
function install(m){if(m.platform==='capy'&&/Windows/i.test(navigator.userAgent)){copyText(m.url);toast('已复制 JS 地址，请在支持 CapyPlayer 的设备导入');return;}location.href=m.platform==='capy'?m.capy:m.rex;}
const previousCopy=copyModLink;copyModLink=function(id){const m=platforms.get(id);if(m){copyText(m.url);return;}previousCopy(id);};
const previousEditor=openEditor;openEditor=async function(id){await previousEditor(id);if(ed.id!==id)return;const m=platforms.get(id);if(!m)return;const title=document.getElementById('edTitle');const img=document.createElement('img');img.src=m.platform==='capy'?'/app-icons/capy-v1-48.png':'/app-icons/rex-mulberry-v1-192.png';img.width=24;img.height=24;img.alt=m.platform==='capy'?'CapyPlayer':'Rex';img.className='ed-platform-icon';title.prepend(img);let entry=document.getElementById('edCheckerEntry');if(!entry){entry=document.createElement('a');entry.id='edCheckerEntry';entry.href='/checker';entry.target='_blank';entry.rel='noopener';entry.textContent='在线静态检查 · 测试前请勿加密！';title.after(entry);}};
const previousImport=importToRex;importToRex=function(url){const m=[...platforms.values()].find(m=>url===m.url||url.includes('/'+m.id));if(m)return install(m);previousImport(url);};
showUploadMods=()=>{location.href='/admin#developer';};
changePassword=()=>{location.href='/admin#account';};
async function refresh(){const r=await fetch('/api/community/catalog');if(!r.ok)return;platforms=new Map((await r.json()).map(m=>[m.id,m]));renderMods();}refresh();
})();
