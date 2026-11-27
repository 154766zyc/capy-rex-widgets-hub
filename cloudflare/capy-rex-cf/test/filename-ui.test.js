import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {filenameUI,filenameStyles} from '../filename-ui.js';
import {duplicatesUI} from '../duplicates-ui.js';
import {autoRulesUI} from '../auto-rules-ui.js';

class Element{
 constructor(){this.id='';this.dataset={};this.attributes={};this.disabled=false;this.hidden=false;this.textContent='';this.value='';this.children=[];this.elements=new Map();this.isConnected=true;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 prepend(element){this.children.unshift(element);element.parent=this;}
 after(element){const siblings=this.parent.children;siblings.splice(siblings.indexOf(this)+1,0,element);element.parent=this.parent;}
 querySelector(selector){if(!this.elements.has(selector)){const element=new Element();if(selector.startsWith('#'))element.id=selector.slice(1);this.elements.set(selector,element);}return this.elements.get(selector);}
 querySelectorAll(selector){
  if(selector.startsWith('[data-name-index]'))return [...this.elements.values()].filter(e=>e.dataset?.nameIndex!==undefined&&(!selector.endsWith(':checked')||e.checked));
  if(selector==='button,input')return [...this.elements.values()];
  return [];
 }
 addEventListener(){}
 remove(){this.isConnected=false;}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const row={id:'module-a',title:'测试模块',current:'REX_视频.js',suggested:'视频.js',revision:'saved-revision'};
function fixture({missing=false,request=async()=>({auto_clean:true})}={}){
 const tools=new Element(),calls=[],messages=[],dialogs=[],modals=[];let loads=0;
 function dialog(title,html){
  const overlay=new Element();overlay.title=title;overlay.html=html;dialogs.push(overlay);
  for(const match of html.matchAll(/id="([^"]+)"/g))overlay.querySelector('#'+match[1]);
  for(const match of html.matchAll(/data-name-index="(\d+)"/g)){const c=overlay.querySelector('[data-name-index="'+match[1]+'"]');c.dataset={nameIndex:match[1]};c.checked=true;}
  for(const match of html.matchAll(/id="(repairName-\d+)"[^>]*value="([^"]*)"/g))overlay.querySelector('#'+match[1]).value=match[2];
  return overlay;
 }
 const originalSettings=()=>{};
 const context={document:{getElementById:()=>missing?null:tools,createElement:()=>new Element(),querySelector:()=>dialogs.at(-1)},
  api:async(...args)=>{calls.push(args);return request(...args);},toast:value=>messages.push(value),
  hubReadDialog:dialog,showModal:(title,html,commit)=>{const overlay=dialog(title,html);modals.push({overlay,commit});},
  loadAll:async()=>{loads++;},renderSettings:originalSettings,esc:String};
 vm.createContext(context);vm.runInContext(filenameUI,context);
 return {tools,calls,messages,dialogs,modals,context,originalSettings,loads:()=>loads,open:()=>tools.children.find(e=>e.id==='openFilenameCleanup').onclick()};
}
test('filename cleanup is one lazy tool entry and stays between automatic rules and duplicates',()=>{
 const f=fixture(),button=f.tools.children[0];
 assert.equal(button.id,'openFilenameCleanup');assert.equal(button.type,'button');assert.equal(button.attributes['aria-haspopup'],'dialog');
 assert.match(button.innerHTML,/<strong>文件名清理<\/strong>/);assert.match(button.innerHTML,/清理文件名中的 rex，避免导入 Rex 后出现「模块校验失败」的情况。/);
 assert.equal(f.calls.length,0);assert.equal(f.context.renderSettings,f.originalSettings);
 assert.match(filenameStyles,/#retryFilenameSettings\[hidden\]\{display:none!important\}/);
 f.tools.elements.set('#openFilenameCleanup',button);
 vm.runInContext(duplicatesUI,f.context);vm.runInContext(autoRulesUI,f.context);
 assert.deepEqual(f.tools.children.map(e=>e.id),['openAutoRules','openFilenameCleanup','findDuplicateModules']);
 assert.doesNotThrow(()=>fixture({missing:true}));
});
test('opening loads the saved setting without modifying it, blocks controls until loaded and describes autosave',async()=>{
 const pending=deferred(),f=fixture({request:()=>pending.promise});f.open();
 const overlay=f.dialogs[0],toggle=overlay.querySelector('#autoCleanFilename'),scan=overlay.querySelector('#scanFilenames');
 assert.equal(overlay.title,'文件名清理');assert.match(overlay.html,/修改后自动保存/);assert.match(overlay.html,/其他原因导致的校验失败/);
 assert.equal(toggle.disabled,true);assert.equal(scan.disabled,true);assert.equal(f.calls.length,1);
 pending.resolve({auto_clean:false});await settle();
 assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(toggle.disabled,false);assert.equal(scan.disabled,false);
 assert.equal(f.calls[0][0],'/api/admin/filename-settings');assert.equal(f.calls[0][1],undefined);
});
test('load failure can be retried and save failure rolls back without blocking future actions',async()=>{
 let reads=0;
 const f=fixture({request:async(path,options)=>options?{error:'保存失败'}:++reads===1?{error:'读取失败'}:{auto_clean:false}});f.open();await settle();
 const overlay=f.dialogs[0],toggle=overlay.querySelector('#autoCleanFilename'),retry=overlay.querySelector('#retryFilenameSettings');
 assert.equal(toggle.disabled,true);assert.equal(retry.hidden,false);assert.equal(overlay.querySelector('#filenameSettingError').textContent,'读取失败');
 await retry.onclick();assert.equal(toggle.disabled,false);assert.equal(retry.hidden,true);
 await toggle.onclick();assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(toggle.disabled,false);
 assert.equal(overlay.querySelector('#filenameSettingError').textContent,'保存失败');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),['/api/admin/filename-settings',{method:'PATCH',json:{auto_clean:true}}]);
});
test('saving prevents concurrent toggles and scans, and reopening reads the persisted value',async()=>{
 const pending=deferred();let saved=false;
 const f=fixture({request:async(path,options)=>{if(!options)return {auto_clean:saved};const result=await pending.promise;saved=result.auto_clean;return result;}});f.open();await settle();
 const overlay=f.dialogs[0],toggle=overlay.querySelector('#autoCleanFilename'),scan=overlay.querySelector('#scanFilenames');
 const saving=toggle.onclick();assert.equal(toggle.disabled,true);assert.equal(scan.disabled,true);
 await toggle.onclick();await scan.onclick();assert.equal(f.calls.length,2);
 pending.resolve({auto_clean:true});await saving;assert.equal(toggle.getAttribute('aria-checked'),'true');assert.equal(scan.disabled,false);
 overlay.remove();f.open();await settle();assert.equal(f.dialogs.at(-1).querySelector('#autoCleanFilename').getAttribute('aria-checked'),'true');
});
test('scan is read-only until confirmation, replaces the settings modal and preserves cancellation',async()=>{
 const f=fixture({request:async path=>path.endsWith('/filenames')?{rows:[row]}:{auto_clean:true}});f.open();await settle();
 const settings=f.dialogs[0];await settings.querySelector('#scanFilenames').onclick();
 assert.equal(settings.isConnected,false);assert.equal(f.dialogs.filter(e=>e.isConnected).length,1);
 assert.equal(f.modals.length,1);assert.equal(f.modals[0].overlay.querySelector('#mC').textContent,'确认改名');
 assert.equal(f.modals[0].overlay.querySelector('.modal').getAttribute('role'),'dialog');
 f.modals[0].overlay.remove();assert.ok(f.calls.every(call=>!call[1]));
});
test('empty and failed scans keep the settings open with feedback; closed pending scans never reopen a dialog',async()=>{
 let scanCount=0;const pending=deferred();
 const f=fixture({request:async path=>path.endsWith('/filenames')?(++scanCount===1?{rows:[]}:scanCount===2?{error:'扫描失败'}:pending.promise):{auto_clean:true}});f.open();await settle();
 const overlay=f.dialogs[0],scan=overlay.querySelector('#scanFilenames'),status=overlay.querySelector('#filenameStatus');
 await scan.onclick();assert.equal(status.textContent,'没有需要清理的文件名');assert.equal(overlay.isConnected,true);
 await scan.onclick();assert.equal(status.textContent,'扫描失败');assert.equal(scan.disabled,false);
 const running=scan.onclick();overlay.remove();pending.resolve({rows:[row]});await running;
 assert.equal(f.dialogs.length,1);assert.equal(f.modals.length,0);
});
test('confirmation preserves editable names, selection, revisions, batch size and completed-item retry behavior',async()=>{
 let writes=0;const rows=Array.from({length:22},(_,i)=>({...row,id:'module-'+i,revision:'revision-'+i}));
 const f=fixture({request:async(path,options)=>{if(path.endsWith('/filenames')){
   if(!options)return {rows};if(++writes===2)return {error:'暂时失败'};
   return {results:options.json.rows.map(r=>({id:r.id,filename:r.filename}))};
  }return {auto_clean:true};}});f.open();await settle();await f.dialogs[0].querySelector('#scanFilenames').onclick();
 const {overlay,commit}=f.modals[0];overlay.querySelector('[data-name-index="21"]').checked=false;
 overlay.querySelector('#repairName-0').value='自定名称.js';
 await commit(()=>overlay.remove());assert.equal(overlay.isConnected,true);assert.match(overlay.querySelector('#repairProgress').textContent,/暂时失败/);
 let posted=f.calls.filter(call=>call[1]?.method==='POST');assert.deepEqual(posted.map(call=>call[1].json.rows.length),[20,1]);
 assert.deepEqual(JSON.parse(JSON.stringify(posted[0][1].json.rows[0])),{id:'module-0',filename:'自定名称.js',revision:'revision-0'});
 await commit(()=>overlay.remove());posted=f.calls.filter(call=>call[1]?.method==='POST');assert.equal(posted.at(-1)[1].json.rows[0].id,'module-20');
 assert.equal(f.loads(),1);assert.equal(overlay.querySelector('#mC').textContent,'完成');
 assert.equal(overlay.querySelector('#repairName-0').disabled,true);assert.equal(overlay.querySelector('[data-name-index="21"]').disabled,false);
});
