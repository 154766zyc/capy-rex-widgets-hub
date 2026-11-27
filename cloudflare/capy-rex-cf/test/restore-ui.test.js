import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {restoreUI,restoreStyles} from '../restore-ui.js';
class Element{
 constructor(){this.isConnected=true;this.hidden=false;this.disabled=false;this.textContent='';this.children=new Map();this.files=[];this.listeners={};}
 addEventListener(type,fn){this.listeners[type]=fn;}
 querySelector(key){if(!this.children.has(key))this.children.set(key,new Element());return this.children.get(key);}
 removeAttribute(key){delete this[key];}click(){}remove(){this.isConnected=false;}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve)),root='/api/admin/backup/restore/jobs',id='00000000-0000-4000-8000-000000000001';
function fixture({saved='',request=async()=>({ok:true,job:null})}={}){
 const storage=new Map(saved?[['rex_hub_restore_job_v1',saved]]:[]),calls=[],dialogs=[],inputs=[],uploads=[],timers=[];let loads=0;
 const context={hubReadDialog:(title,html)=>{const e=new Element();e.title=title;e.html=html;dialogs.push(e);return e;},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  api:async(...args)=>{calls.push(args);return request(...args);},document:{body:{},addEventListener(){},removeEventListener(){},createElement:()=>{const e=new Element();inputs.push(e);return e;}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>id},
  XMLHttpRequest:class{constructor(){this.upload={};uploads.push(this);}open(method,url){this.method=method;this.url=url;}setRequestHeader(){}send(body){this.body=body;}},
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},loadAll:async()=>{loads++;}};
 context.window=context;vm.createContext(context);vm.runInContext(restoreUI,context);context.importBackup();
 return {context,calls,storage,dialogs,inputs,uploads,timers,loads:()=>loads,element:key=>dialogs.at(-1).querySelector(key)};
}
test('restore is lazy, uses one dialog and requires explicit confirmation before reserving or uploading',async()=>{
 const f=fixture();await settle();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],root+'/current');assert.equal(f.element('#restorePick').disabled,false);
 f.element('#restorePick').onclick();const file={name:'backup.json',size:1024,text(){throw Error('must not read/re-serialize the selected file');}};f.inputs[0].files=[file];f.inputs[0].onchange();
 assert.equal(f.calls.length,1);assert.equal(f.uploads.length,0);assert.equal(f.element('#restoreConfirm').hidden,false);assert.match(f.dialogs[0].html,/原 ID/);
 assert.match(restoreStyles,/\[hidden\].*display:none!important/);
});
test('confirmation sends the original File, uses real upload progress and waits for committed completion',async()=>{
 const f=fixture({request:async(path,options)=>options?{ok:true,job:{id,status:'uploading'}}:path.endsWith('/current')?{ok:true,job:null}:{ok:true,job:{id,status:'done',stage:'done',result:{modules:2,collections:1},created_at:1000,finished_at:2500}}});await settle();
 f.element('#restorePick').onclick();const file={name:'backup.json',size:2048};f.inputs[0].files=[file];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();
 const xhr=f.uploads[0];assert.equal(xhr.body,file);assert.equal(xhr.timeout,300000);assert.equal(xhr.method,'PUT');assert.equal(xhr.url,root+'/'+id);assert.equal(f.element('#mC').disabled,true);
 let prevented=0;f.dialogs[0].listeners.click({target:f.dialogs[0],preventDefault(){prevented++;},stopImmediatePropagation(){prevented++;}});assert.equal(prevented,2);
 xhr.upload.onprogress({lengthComputable:true,loaded:500,total:1000});assert.equal(f.element('#restoreProgress').value,50);assert.match(f.element('#restoreStatus').textContent,/上传备份 50%/);
 xhr.responseText=JSON.stringify({ok:true,job:{id,status:'writing',stage:'writing',processed:2,total:2}});xhr.status=202;xhr.onload();
 assert.match(f.element('#restoreStatus').textContent,/等待最终完成/);assert.equal(f.loads(),0);assert.equal(f.element('#mC').disabled,false);
 await f.element('#restoreRetry').onclick();await settle();assert.match(f.element('#restoreStatus').textContent,/恢复完成/);assert.equal(f.loads(),1);assert.equal(f.storage.size,0);
});
test('a dropped upload response queries the saved task and never automatically resubmits the file',async()=>{
 const f=fixture({request:async(path,options)=>options?{ok:true,job:{id,status:'uploading'}}:path.endsWith('/current')?{ok:true,job:null}:{ok:true,job:{id,status:'validating',stage:'validating',processed:3,total:10}}});await settle();
 f.element('#restorePick').onclick();f.inputs[0].files=[{name:'backup.json',size:1}];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();f.uploads[0].ontimeout();await settle();
 assert.equal(f.uploads.length,1);assert.equal(f.calls.filter(c=>c[1]?.method==='POST').length,1);assert.match(f.element('#restoreStatus').textContent,/校验模块 3 \/ 10/);assert.equal(f.storage.get('rex_hub_restore_job_v1'),id);
});
test('reopening restores task tracking, does not upload again, and a closed dialog stops polling',async()=>{
 const f=fixture({saved:id,request:async()=>({ok:true,job:{id,status:'writing',stage:'writing',processed:1,total:2}})});await settle();
 assert.equal(f.calls[0][0],root+'/'+id);assert.equal(f.uploads.length,0);assert.equal(f.element('#restorePick').disabled,true);
 const before=f.calls.length;f.dialogs[0].remove();await f.timers.at(-1).fn();assert.equal(f.calls.length,before);
});
test('an existing job conflict is followed rather than overwritten; oversized files cannot be confirmed',async()=>{
 let calls=0;const f=fixture({request:async(path,options)=>options?{ok:false,error:'busy',job:{id:'another-job-00000001',status:'writing',stage:'writing',processed:1,total:2}}:({ok:true,job:null})});await settle();
 f.element('#restorePick').onclick();f.inputs[0].files=[{name:'large.json',size:513*1024*1024}];f.inputs[0].onchange();assert.equal(f.element('#restoreConfirm').hidden,true);assert.match(f.element('#restoreStatus').textContent,/512 MiB/);
 f.inputs[0].files=[{name:'backup.json',size:1}];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();assert.equal(f.uploads.length,0);assert.match(f.element('#restoreStatus').textContent,/写入模块/);
});
test('an uncreated task after a lost reservation response can be confirmed again only after checking for other active tasks',async()=>{
 const f=fixture({request:async(path,options)=>{if(options)throw Error('connection lost');return path.endsWith('/current')?{ok:true,job:null}:{error:'恢复任务不存在'};}});await settle();
 f.element('#restorePick').onclick();f.inputs[0].files=[{name:'backup.json',size:1}];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();await settle();
 assert.equal(f.uploads.length,0);assert.equal(f.element('#restorePick').disabled,false);assert.equal(f.element('#restoreConfirm').disabled,false);assert.equal(f.element('#restoreConfirm').hidden,false);assert.equal(f.storage.size,0);assert.match(f.element('#restoreStatus').textContent,/未找到已提交/);assert.equal(f.calls.at(-1)[0],root+'/current');
});
test('missing reservation ID follows another active task and does not re-upload',async()=>{
 let first=true;const f=fixture({request:async(path,options)=>{if(options)throw Error('connection lost');if(!path.endsWith('/current'))return {error:'恢复任务不存在'};if(first){first=false;return {ok:true,job:null};}return {ok:true,job:{id:'other-job-00000001',status:'writing',stage:'writing',processed:1,total:2}};}});await settle();
 f.element('#restorePick').onclick();f.inputs[0].files=[{name:'backup.json',size:1}];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();await settle();
 assert.equal(f.uploads.length,0);assert.equal(f.element('#restorePick').disabled,true);assert.match(f.element('#restoreStatus').textContent,/写入模块 1 \/ 2/);assert.equal(f.storage.get('rex_hub_restore_job_v1'),'other-job-00000001');
});
test('HTTP NAS browsers without crypto.randomUUID can still reserve and upload with a valid random task ID',async()=>{
 const f=fixture({request:async(path,options)=>options?{ok:true,job:{id:options.json.id,status:'uploading'}}:{ok:true,job:null}});await settle();
 f.context.crypto={getRandomValues:bytes=>{for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes;}};
 f.element('#restorePick').onclick();f.inputs[0].files=[{name:'backup.json',size:1}];f.inputs[0].onchange();await f.element('#restoreConfirm').onclick();
 assert.equal(f.uploads.length,1);assert.match(f.uploads[0].url,/\/00010203-0405-4607-8809-0a0b0c0d0e0f$/);assert.equal(f.element('#restoreStatus').textContent,'正在上传备份…');
});
test('home backup stages and committed home counts are shown without treating partial writes as success',async()=>{
 let complete=false;const f=fixture({saved:id,request:async()=>({ok:true,job:complete?{id,status:'done',stage:'done',created_at:1000,finished_at:2000,result:{modules:0,collections:0,home_configs:2}}:{id,status:'writing',stage:'writing_homes',processed:1,total:2}})});await settle();
 assert.match(f.element('#restoreStatus').textContent,/正在写入首页配置 1 \/ 2/);assert.equal(f.loads(),0);complete=true;await f.element('#restoreRetry').onclick();await settle();assert.match(f.element('#restoreStatus').textContent,/2 个首页配置/);assert.equal(f.loads(),1);
});
