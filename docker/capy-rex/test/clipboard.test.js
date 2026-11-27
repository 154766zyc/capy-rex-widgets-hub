import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {getHTML} from '../worker.js';
import {homeUI} from '../home-ui.js';

// The copy helpers from the admin page, run in a tiny fake browser.
const html=getHTML(),start=html.indexOf('function copyFallback('),end=html.indexOf('function promptReplace(');
const source=html.slice(start,end);
function page({secure=true,clipboard,execOk=true,clipboardItem=false}={}){
 const nodes=[],toasts=[];
 const make=tag=>{const e={tag,value:'',style:{},attributes:{},children:[],listeners:{},setAttribute(k,v){this.attributes[k]=v;},focus(){},select(){},setSelectionRange(){},remove(){this.removed=true;},
  addEventListener(k,f){this.listeners[k]=f;},querySelector(sel){const child=this.children[sel]||(this.children[sel]=make(sel));return child;},set innerHTML(v){this._html=v;},get innerHTML(){return this._html;}};return e;};
 const ctx={toast:t=>toasts.push(t),setTimeout:f=>f(),Blob,Promise,String,
  document:{createElement:make,body:{appendChild:n=>nodes.push(n)},execCommand:()=>execOk},navigator:{clipboard},isSecureContext:secure};
 if(clipboardItem)ctx.ClipboardItem=class{constructor(items){this.items=items;}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 const manual=()=>nodes.filter(n=>n._html&&n._html.includes('手动复制'));
 return {ctx,toasts,nodes,manual};
}
const settle=()=>new Promise(r=>setImmediate(r));

test('HTTP 地址没有剪贴板接口时也能复制，不报错',async()=>{
 const p=page({secure:false,clipboard:undefined});await p.ctx.copyText('http://192.168.1.5:8083/x.rex');
 assert.deepEqual(p.toasts,['已复制']);assert.equal(p.manual().length,0);
});
test('自动复制都被拒绝时，弹出手动复制框并显示完整链接',async()=>{
 const p=page({secure:true,clipboard:{writeText:()=>Promise.reject(new Error('NotAllowedError'))},execOk:false});
 await p.ctx.copyText('https://hub.example/api/home-configs/a.rex');await settle();
 assert.equal(p.manual().length,1);assert.equal(p.manual()[0].children.textarea.value,'https://hub.example/api/home-configs/a.rex');assert.deepEqual(p.toasts,[]);
});
test('HTTPS 下使用剪贴板接口复制',async()=>{
 const written=[];const p=page({clipboard:{writeText:async t=>{written.push(t);}}});await p.ctx.copyText('abc');
 assert.deepEqual(written,['abc']);assert.deepEqual(p.toasts,['已复制']);
});
test('首次分享在点击当下就开始写剪贴板，不等服务器返回',async()=>{
 const writes=[];let resolve;const link=new Promise(r=>{resolve=r;});
 const p=page({clipboardItem:true,clipboard:{writeText:async()=>{},write:items=>{writes.push(items);return items[0].items['text/plain'].then(()=>{});}}});
 const done=p.ctx.copyTextLater(link);assert.equal(writes.length,1,'write() called synchronously');
 resolve('https://hub.example/s.rex');await done;assert.deepEqual(p.toasts,['已复制']);
});
test('浏览器不支持延后复制时改用普通复制，分享出错会提示',async()=>{
 const written=[];const p=page({clipboard:{writeText:async t=>{written.push(t);}}});
 await p.ctx.copyTextLater(Promise.resolve('x'));assert.deepEqual(written,['x']);
 await assert.rejects(p.ctx.copyTextLater(Promise.reject(new Error('请重新登录'))),/请重新登录/);
});
test('已分享的首页直接复制链接，不再请求服务器',async()=>{
 const calls=[],copies=[],menus=[];
 const row={id:'h1',title:'儿童早教',revision:'r1',shared:true,share_path:'/api/home-configs/kids.rex',sections:9,items:9,size:1,updated_at:1,avatar_url:''};
 const el=()=>({children:[],nodes:new Map(),attributes:{},setAttribute(){},getAttribute(){},querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,el());return this.nodes.get(k);},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},addEventListener(){},removeEventListener(){},remove(){},focus(){}});
 const els=new Map(),get=k=>{if(!els.has(k))els.set(k,el());return els.get(k);};
 const ctx={document:{body:el(),getElementById:get,querySelector:()=>null,createElement:el,addEventListener(){},removeEventListener(){}},MutationObserver:class{observe(){}},
  state:{tab:'collections',modules:[],collections:[]},renderCols(){},localStorage:{getItem:()=>'homes',setItem(){}},api:async(...a)=>{calls.push(a);return [row];},
  esc:v=>String(v),hubInitial:v=>v[0],fmt:v=>v,hubManageButton:()=>'<button class="hub-more"></button>',manageIcon:()=>'',hubAvatarImage(){},
  hubActionMenu:(title,actions)=>menus.push(actions),showConfirmAsync:async()=>{throw new Error('should not ask again');},copyText:async t=>{copies.push(t);},
  org:()=>'https://hub.example',toast(){},FormData,File,showModal(){}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(homeUI,ctx);ctx.switchCollectionSection('homes');await settle();
 get('homeConfigsList').children[0].querySelector('.hub-more').onclick();const before=calls.length;
 menus.at(-1)[0][1]();await settle();
 assert.deepEqual(copies,['https://hub.example/api/home-configs/kids.rex']);assert.equal(calls.length,before,'no share request');
});
