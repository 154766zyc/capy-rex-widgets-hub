import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {managementUI,managementStyles} from './management-ui.js';
import {getHTML} from './worker.js';

test('module group tabs wrap without changing other horizontally scrolling tabs',()=>{
 const html=getHTML();
 assert.match(html,/#groupTabs\{flex-wrap:wrap;overflow-x:visible!important\}/);
 assert.match(html,/#groupTabs \.ftab\{max-width:100%;white-space:normal;overflow-wrap:anywhere\}/);
 assert.match(html,/\.folder-tabs\{display:flex;gap:6px;overflow-x:auto/);
});

function functionSource(start,end){return managementUI.slice(managementUI.indexOf(start),managementUI.indexOf(end));}
test('collection and subscription management buttons use one accessible sliders icon instead of text dots',()=>{
 const ctx={esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;')};vm.createContext(ctx);
 vm.runInContext(functionSource('function manageIcon','function rexButton'),ctx);
 for(const label of ['合集管理','订阅管理']){
  const html=ctx.hubManageButton(label);
  assert.match(html,/type="button" class="hub-more"/);assert.ok(html.includes('aria-label="'+label+'"'));assert.ok(html.includes('title="'+label+'"'));
  assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/<svg[^>]*aria-hidden="true"/);assert.equal((html.match(/<circle /g)||[]).length,2);assert.doesNotMatch(html,/[•⋯…]/);
 }
 assert.match(ctx.hubManageButton('管理 "标题"'),/&quot;标题&quot;/);
 assert.match(managementUI,/hubManageButton\('合集管理'\)/);assert.match(managementUI,/hubManageButton\('订阅管理'\)/);
 assert.match(managementUI,/querySelector\('\.hub-more'\)\.onclick=function\(\)\{showCollectionActions\(c.id\);\}/);
 assert.match(managementUI,/querySelector\('\.hub-more'\)\.onclick=function\(\)\{hubSourceActions\(s\);\}/);
});
test('management icons keep a transparent 44px target, theme-aware feedback and a visible keyboard focus ring',()=>{
 const css=managementStyles.match(/\.hub-more\{([^}]+)\}/)[1];
 for(const rule of ['flex:0 0 44px','width:44px','height:44px','min-width:44px','min-height:44px','padding:0','background:transparent','color:var(--text2)'])assert.ok(css.includes(rule),rule);
 assert.match(managementStyles,/\.hub-more svg\{width:18px;height:18px;/);
 assert.match(managementStyles,/\.hub-more:active\{background:color-mix\(in srgb,var\(--accent\) 12%,transparent\);color:var\(--accent\)\}/);
 assert.match(managementStyles,/\.hub-more:focus-visible\{outline:2px solid var\(--accent\);outline-offset:2px\}/);
});
test('batch UI keeps failures selected, clears successful items, and retries in bounded chunks',async()=>{
 const calls=[],ids=Array.from({length:7},(_,i)=>String(i));
 const ctx={bulkBusy:false,selectedModuleIds:new Set(ids),state:{modules:[]},document:{getElementById(){return null;}},renderBulkBar(){},loadAll:async()=>{},showModal(){},toast(){},esc:x=>x,
  api:async(path,{json})=>{calls.push(json.ids);return {ok:true,results:json.ids.map(id=>({id,ok:id!=='3',error:'test failure'}))};}};
 vm.createContext(ctx);vm.runInContext(functionSource('async function runManagedBulk','function chooseBulkTarget'),ctx);
 assert.equal(await ctx.runManagedBulk(ids,'delete'),false);
 assert.deepEqual(calls.map(c=>c.length),[2,2,2,1]);assert.deepEqual([...ctx.selectedModuleIds],['3']);assert.equal(ctx.bulkBusy,false);
 calls.length=0;ctx.api=async(path,{json})=>{calls.push(json.ids);return {ok:true,results:json.ids.map(id=>({id,ok:true}))};};
 assert.equal(await ctx.runManagedBulk([...ctx.selectedModuleIds],'delete'),true);assert.deepEqual(calls,[['3']]);assert.equal(ctx.selectedModuleIds.size,0);
});
test('unconfirmed batch responses preserve every affected selection for retry',async()=>{
 const ctx={bulkBusy:false,selectedModuleIds:new Set(['a','b']),state:{modules:[]},document:{getElementById(){return null;}},renderBulkBar(){},loadAll:async()=>{},showModal(){},toast(){},esc:x=>x,api:async()=>{throw Error('network failure');}};
 vm.createContext(ctx);vm.runInContext(functionSource('async function runManagedBulk','function chooseBulkTarget'),ctx);
 await ctx.runManagedBulk(['a','b'],'append',{collectionId:'mine'});assert.deepEqual([...ctx.selectedModuleIds],['a','b']);assert.equal(ctx.bulkBusy,false);
});
test('Rex import encodes public URL once and never claims a successful client import',()=>{
 const messages=[],ctx={window:{location:{href:''}},toast:m=>messages.push(m)};
 vm.createContext(ctx);vm.runInContext(functionSource('function importToRex','var selectButton'),ctx);
 const url='https://example.com/api/collections/中文.rex?x=a&y=b';ctx.importToRex(url);
 assert.equal(ctx.window.location.href,'https://rexnow.tv/widget/?url='+encodeURIComponent(url));assert.match(messages[0],/尝试/);assert.doesNotMatch(messages[0],/导入成功/);
 ctx.window.location.href='';ctx.importToRex('javascript:alert(1)');assert.equal(ctx.window.location.href,'');
});
