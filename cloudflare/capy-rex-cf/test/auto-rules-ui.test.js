import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {autoRulesUI} from '../auto-rules-ui.js';

function fixture({missing=false,request=async()=>({auto:false,rules:[]})}={}){
 const button={attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
 const elements=new Map();
 const panel={attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
 const overlay={querySelector(selector){if(selector==='.modal')return panel;if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);}};
 const calls=[],messages=[],modals=[];
 const tools={prepend(element){this.first=element;}};
 const context={document:{getElementById:()=>missing?null:tools,createElement:()=>button,querySelector:()=>overlay},
  state:{groups:[],collections:[]},api:async(...args)=>{calls.push(args);return request(...args);},toast:value=>messages.push(value),
  showModal:(...args)=>modals.push(args),esc:String};
 vm.runInNewContext(autoRulesUI,context);
 return {button,tools,panel,calls,messages,modals};
}
test('automatic rules entry uses the shared tool row icon, title, hint and chevron',()=>{
 const f=fixture();
 assert.equal(f.tools.first,f.button);assert.equal(f.button.id,'openAutoRules');assert.equal(f.button.type,'button');
 assert.equal(f.button.className,'set-row hub-tool-row');assert.equal(f.button.attributes['aria-haspopup'],'dialog');
 assert.match(f.button.innerHTML,/<svg class="hub-tool-icon"[^>]*aria-hidden="true"/);
 assert.match(f.button.innerHTML,/<span class="hub-tool-meta"><strong>自动分类规则<\/strong><small>按关键词分组，追加指定合集<\/small><\/span>/);
 assert.match(f.button.innerHTML,/<span class="chev" aria-hidden="true">/);
 assert.equal(f.calls.length,0);
 assert.doesNotThrow(()=>fixture({missing:true}));
});
test('automatic rules entry still loads the existing editor and releases its loading lock',async()=>{
 let resolve;
 const f=fixture({request:()=>new Promise(done=>resolve=done)}),opening=f.button.onclick();
 assert.equal(f.button.disabled,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'/api/admin/auto-rules');
 resolve({auto:false,rules:[]});await opening;
 assert.equal(f.button.disabled,false);assert.equal(f.modals.length,1);assert.equal(f.modals[0][0],'自动分类规则');
 assert.match(f.modals[0][1],/新模块自动整理/);assert.equal(f.panel.attributes.role,'dialog');
 assert.equal(f.messages.length,0);
});
test('automatic rules entry retains failure feedback without leaving the button disabled',async()=>{
 const f=fixture({request:async()=>({error:'读取失败'})});
 await f.button.onclick();
 assert.equal(f.button.disabled,false);assert.deepEqual(f.messages,['读取失败']);assert.equal(f.modals.length,0);
});
