import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {enhancementsUI,enhancementsStyles} from '../enhancements-ui.js';

class Element {
 constructor(tagName='div'){this.tagName=tagName;this.children=[];this.attributes={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}
}
function fixture({busy=false,selecting=false}={}){
 const modules=[
  {id:'a',title:'订阅模块',group_id:'g',source_url:'https://up.example/a.js',subscription_collection:1,subscription_module:1},
  {id:'b',title:'单链接模块',group_id:'',source_url:'https://up.example/b.js',subscription_collection:0,subscription_module:1},
  {id:'c',title:'上传模块',group_id:'',source_url:null},
  {id:'d',title:'历史链接',source_url:'https://old.example/module.js'},
  {id:'e',title:'历史订阅',source_managed:1}
 ];
 const rows=modules.map(m=>{
  const row=new Element();row.dataset={mid:m.id};row.info=new Element();row.append(row.info);
  row.rex=selecting?null:new Element('button');if(row.rex){row.rex.dataset={rexUrl:'https://hub.example/original-'+m.id+'.js'};row.rex.onclick=()=>row.imported=true;row.append(row.rex);}
  row.querySelector=selector=>selector==='.info'?row.info:selector==='.rex-import'?row.rex:null;
  return row;
 });
 const calls=[],messages=[];let modal,loads=0;
 const context={state:{modules,groups:[{id:'g',name:'动漫与动画'}],collections:[{id:'one',title:'我的精选',moduleIds:['a']},{id:'two',title:'第二合集',moduleIds:['a']},{id:'all',title:'自动全部',autoAll:true,moduleIds:[]}]},
  renderMods:()=>{},renderSubscriptions:()=>{},bulkBusy:busy,
  document:{createElement:tag=>new Element(tag),querySelectorAll:()=>rows,getElementById:id=>id==='quickAppend'?{value:'one'}:null},
  showMoveToGroup:id=>calls.push(['group',id]),showCollectionActions:id=>calls.push(['collection',id]),
  showModal:(title,html,commit)=>{modal={title,html,commit};},toast:message=>messages.push(message),
  api:async(path,options)=>{calls.push([path,options]);return {ok:true,results:[{ok:true}]};},loadAll:async()=>{loads++;},
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),localStorage:{getItem:()=>null}
 };
 vm.createContext(context);vm.runInContext(enhancementsUI,context);context.renderMods();
 return {context,rows,calls,messages,modal:()=>modal,loads:()=>loads,tags:index=>rows[index].info.children.at(-1)};
}
test('module origin, group, collections and add action share one flowing container inside module info',()=>{
 const f=fixture(),tags=f.tags(0);
 assert.equal(tags.className,'module-tags');assert.equal(tags.attributes.role,'group');
 assert.deepEqual(tags.children.map(c=>c.textContent),['订阅','分组：动漫与动画','合集：我的精选','合集：第二合集','＋合集']);
 assert.ok(!f.rows[0].children.includes(tags));
 assert.match(tags.children[0].className,/module-origin-subscription/);
 assert.match(tags.children[1].className,/module-tag-group/);assert.match(tags.children[2].className,/module-tag-collection/);assert.match(tags.children.at(-1).className,/module-tag-add/);
 for(const row of f.rows){assert.equal(row.rex.textContent,'导入');assert.match(row.rex.attributes['aria-label'],/^导入 Rex：/);row.rex.onclick();assert.ok(row.imported);assert.match(row.rex.dataset.rexUrl,/original-/);}
 assert.equal(f.calls.length,0);
 assert.match(enhancementsStyles,/\.module-tags\{[^}]*display:flex;flex-wrap:wrap/);
 assert.doesNotMatch(enhancementsStyles,/flex:0 0 100%|padding-left:54px|padding-left:40px/);
});
test('unjoined, ungrouped and legacy modules retain compact actionable labels without an empty collection badge',()=>{
 const f=fixture();
 assert.deepEqual(f.tags(1).children.map(c=>c.textContent),['链接','分组：未分类','＋合集']);
 assert.deepEqual(f.tags(2).children.map(c=>c.textContent),['上传','分组：未分类','＋合集']);
 assert.equal(f.tags(3).children[0].textContent,'链接');assert.equal(f.tags(4).children[0].textContent,'订阅');
 assert.ok(!f.tags(1).children.some(c=>c.className.includes('module-tag-collection')));
});
test('tag actions keep group and collection targets, append idempotently using the existing API, and do not bubble',async()=>{
 const f=fixture();let stops=0;
 f.tags(0).children[1].onclick({stopPropagation:()=>stops++});
 f.tags(0).children[2].onclick({stopPropagation:()=>stops++});
 assert.deepEqual(f.calls,[['group','a'],['collection','one']]);
 f.tags(1).children.at(-1).onclick({stopPropagation:()=>stops++});
 assert.equal(stops,3);assert.equal(f.modal().title,'加入合集');assert.doesNotMatch(f.modal().html,/自动全部/);
 let closed=false;await f.modal().commit(()=>closed=true);
 assert.equal(closed,true);assert.equal(f.loads(),1);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),['/api/admin/modules/bulk',{method:'POST',json:{action:'append',ids:['b'],collectionId:'one'}}]);
});
test('selection mode needs no import button; busy tag buttons cannot mutate modules',()=>{
 const f=fixture({busy:true,selecting:true});
 for(const row of f.rows)assert.equal(row.rex,null);
 for(const tag of f.tags(0).children.filter(c=>c.tagName==='button')){assert.equal(tag.disabled,true);tag.onclick({stopPropagation:()=>{}});}
 assert.equal(f.calls.length,0);assert.equal(f.modal(),undefined);
});
