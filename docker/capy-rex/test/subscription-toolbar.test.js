import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {enhancementsUI,enhancementsStyles} from '../enhancements-ui.js';
import {sharingUI} from '../sharing-ui.js';
import {getHTML} from '../worker.js';
class Element{
 constructor(){this.children=[];this.attributes={};this.disabled=false;this.isConnected=true;this.textContent='';this.value='';}
 setAttribute(k,v){this.attributes[k]=v;}
 append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
 prepend(node){this.children.unshift(node);node.parent=this;}
 after(node){const siblings=this.parent.children;siblings.splice(siblings.indexOf(this)+1,0,node);node.parent=this.parent;}
 querySelector(selector){if(selector==='select')return this.select??=new Element();return selector.startsWith('#')?this.children.find(n=>n.id===selector.slice(1))||null:null;}
 querySelectorAll(){return [];}
}
function fixture(sources=[],request=async()=>({ok:true})){
 const tools=new Element(),filename=new Element(),duplicates=new Element(),box=new Element();filename.id='openFilenameCleanup';duplicates.id='findDuplicateModules';tools.append(filename,duplicates);
 const calls=[],migrations=[],ordered=[],memory={},context={state:{subscriptions:sources,groups:[],modules:[],collections:[],tab:'subscriptions'},
  document:{getElementById:id=>id==='settingsTools'?tools:id==='subscriptionsList'?box:null,createElement:()=>new Element()},
  renderMods(){},renderSubscriptions(){box.children=[];ordered.push([...context.state.subscriptions].map(s=>s.id));},
  sourceSyncing:{},localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>memory[k]=v},
  api:async(...args)=>{calls.push(args);return request(...args);},syncSource:async id=>({summary:{failed:0}}),migrateLegacySources:async()=>{migrations.push('open');}
 };
 vm.createContext(context);vm.runInContext(enhancementsUI,context);
 return {tools,box,calls,ordered,memory,context,migrations,render:()=>context.renderSubscriptions(),bar:()=>box.children[0]};
}
test('legacy organizer is one lazy settings tool after filename cleanup, with a shared icon/title/hint/chevron',async()=>{
 const f=fixture(),button=f.tools.children[1];assert.deepEqual(f.tools.children.map(n=>n.id),['openFilenameCleanup','organizeLegacyLinks','findDuplicateModules']);
 assert.equal(button.className,'set-row hub-tool-row');assert.equal(button.type,'button');assert.equal(button.attributes['aria-haspopup'],'dialog');assert.match(button.innerHTML,/<strong>整理旧链接<\/strong>/);assert.match(button.innerHTML,/将早期链接导入的模块纳入订阅管理/);assert.match(button.innerHTML,/hub-tool-icon/);assert.equal(f.calls.length,0);
 await button.onclick();assert.deepEqual(f.migrations,['open']);assert.equal(button.disabled,false);
 const html=getHTML();assert.doesNotMatch(html,/整理已有单链接来源|hub-source-top/);
});
test('toolbar survives empty/all-paused lists and repeated rendering without legacy-button coupling',()=>{
 for(const sources of [[],[{id:'a',enabled:0}]]){const f=fixture(sources);for(let i=0;i<3;i++)f.render();assert.equal(f.box.children.length,1);const bar=f.bar();assert.equal(bar.attributes['aria-label'],'订阅源列表操作');assert.equal(bar.children.length,2);assert.equal(bar.children[0].disabled,true);assert.equal(bar.children[0].attributes['aria-busy'],'false');assert.equal(bar.children[1].querySelector('select').attributes['aria-label'],undefined);assert.match(bar.children[1].innerHTML,/aria-label="订阅源排序"/);assert.doesNotMatch(bar.children[1].innerHTML,/^排序 /);}
 assert.match(enhancementsStyles,/\.hub-source-sort\{[^}]*margin-left:auto/);assert.doesNotMatch(enhancementsStyles,/hub-source-sort\{margin-left:0/);assert.match(enhancementsStyles,/min-height:44px/);
});
test('sorting persists and changes only display order, not source identity or original state order',()=>{
 const sources=[{id:'a',title:'乙',enabled:1,created_at:1,total:8},{id:'b',title:'甲',enabled:1,created_at:2,total:1}],f=fixture(sources);f.render();assert.deepEqual(f.ordered.at(-1),['b','a']);
 const select=f.bar().children[1].querySelector('select');select.value='count';select.onchange();assert.equal(f.memory.hub_source_sort_v35,'count');assert.deepEqual(f.ordered.at(-1),['a','b']);assert.equal(f.context.state.subscriptions,sources);assert.deepEqual(sources.map(s=>s.id),['a','b']);
});
test('all-sync disables immediately, uses short fixed-width busy feedback and separates progress from sorting',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),f=fixture([{id:'a',enabled:1}],async()=>pending);f.render();const running=f.bar().children[0].onclick();
 assert.equal(f.bar().children[0].disabled,true);assert.equal(f.bar().children[0].attributes['aria-busy'],'true');assert.match(f.bar().children[0].innerHTML,/>同步中</);assert.doesNotMatch(f.bar().children[0].innerHTML,/正在全部/);
 assert.equal(f.calls.length,1);resolve({ok:true});await running;assert.equal(f.bar().children[0].disabled,false);assert.equal(f.box.children[1].attributes.role,'status');assert.match(f.box.children[1].textContent,/全部处理完成/);
});
function migrationFixture(rows,request=async()=>({ok:true,processed:rows.length})){
 const elements=new Map(),calls=[],messages=[],panel=new Element();let modal,loads=0,closed=false;
 const overlay={isConnected:true,querySelector(selector){if(selector==='.modal')return panel;if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);}};
 const context={document:{querySelector:()=>overlay},esc:String,api:async(path,options)=>{calls.push([path,options]);return options?request(path,options):{ok:true,rows};},
  toast:m=>messages.push(m),loadAll:async()=>{loads++;},showModal:(title,html,commit)=>{modal={title,html,commit:()=>commit(()=>{closed=true;overlay.isConnected=false;})};}};
 vm.createContext(context);vm.runInContext(sharingUI,context);
 return {context,calls,messages,overlay,panel,modal:()=>modal,loads:()=>loads,closed:()=>closed};
}
test('organizer previews ten at a time, preserves pause labels/revisions, and writes only after explicit confirmation',async()=>{
 const rows=Array.from({length:12},(_,i)=>({id:String(i),title:'旧模块'+i,revision:'rev'+i,enabled:i!==1})),f=migrationFixture(rows,async()=>({ok:true,processed:10}));
 await f.context.migrateLegacySources();assert.equal(f.calls.length,1);assert.equal(f.modal().title,'整理旧链接');assert.match(f.modal().html,/保持暂停/);assert.match(f.modal().html,/本批 10 个/);assert.equal(f.overlay.querySelector('#mC').textContent,'确认整理');assert.equal(f.panel.attributes.role,'dialog');assert.equal(f.closed(),false);
 await f.modal().commit();assert.equal(f.closed(),true);assert.equal(f.loads(),1);assert.equal(f.calls[1][1].json.rows.length,10);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1][1].json.rows[1])),{id:'1',revision:'rev1'});assert.match(f.messages[0],/可继续下一批/);
});
test('empty organizer and failed/stale confirmations do not silently write or close the preview',async()=>{
 const empty=migrationFixture([]);await empty.context.migrateLegacySources();assert.equal(empty.modal(),undefined);assert.deepEqual(empty.messages,['没有需要整理的旧链接']);
 const f=migrationFixture([{id:'a',revision:'rev',title:'旧模块',enabled:false}],async()=>({error:'模块已变化，请重新预览'}));await f.context.migrateLegacySources();await f.modal().commit();assert.equal(f.closed(),false);assert.equal(f.loads(),0);assert.equal(f.overlay.querySelector('#mC').disabled,false);assert.equal(f.overlay.querySelector('#legacyLinksError').textContent,'模块已变化，请重新预览');
});
