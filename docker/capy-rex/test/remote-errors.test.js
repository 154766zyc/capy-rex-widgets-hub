import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchRemote,remoteErrorText,displayRemoteError} from '../remote.js';
import {listen,close,login,api,temporary} from './helpers.js';
const url='https://upstream.example/module.js',aborted=()=>Object.assign(Error('The operation was aborted'),{name:'AbortError',code:'ABORT_ERR'});

test('a confirmed total timeout overrides generic HTTP AbortError and retains the original cause',async t=>{
 const clock=new AbortController();t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,20_000);return clock.signal;});
 const cause=aborted();await assert.rejects(fetchRemote(url,1024,{transport:async()=>{clock.abort(new DOMException('timer','TimeoutError'));throw cause;}}),error=>{
  assert.equal(error.code,'REMOTE_TIMEOUT');assert.match(error.message,/下载超时（20 秒）/);assert.equal(error.cause,cause);
  assert.match(remoteErrorText(error,{retained:true}),/已保留旧版本/);assert.doesNotMatch(remoteErrorText(error),/旧版本/);return true;
 });
});
test('body-read timeouts share the download budget and are also translated',async t=>{
 const clock=new AbortController();t.mock.method(AbortSignal,'timeout',()=>clock.signal);
 await assert.rejects(fetchRemote(url,1024,{transport:async()=>new Response(new ReadableStream({pull(controller){clock.abort(new DOMException('timer','TimeoutError'));controller.error(aborted());}}))}),error=>error.code==='REMOTE_TIMEOUT');
});
test('shutdown, explicit cancellation and unknown AbortError are distinct from timeouts',async t=>{
 for(const shutdown of [false,true]){
  const controller=new AbortController(),reason=shutdown?Object.assign(Error('closing'),{code:'HUB_SHUTDOWN'}):Error('cancelled');controller.abort(reason);let hits=0;
  await assert.rejects(fetchRemote(url,1024,{signal:controller.signal,transport:async()=>{hits++;throw aborted();}}),error=>{
   assert.equal(error.code,shutdown?'REMOTE_SHUTDOWN':'REMOTE_ABORTED');assert.doesNotMatch(error.message,/超时/);assert.equal(error.cause,reason);return true;
  });assert.equal(hits,0);
 }
 const clock=new AbortController(),cancel=new AbortController();t.mock.method(AbortSignal,'timeout',()=>clock.signal);
 await assert.rejects(fetchRemote(url,1024,{transport:async()=>{throw aborted();}}),error=>error.code==='REMOTE_ABORTED');
 await assert.rejects(fetchRemote(url,1024,{signal:cancel.signal,transport:async()=>{cancel.abort();clock.abort(new DOMException('timer','TimeoutError'));throw aborted();}}),error=>error.code==='REMOTE_ABORTED');
});
test('the first timeout still wins when a shutdown arrives in the same turn; relay listeners are removed',async t=>{
 const clock=new AbortController(),shutdown=new AbortController();t.mock.method(AbortSignal,'timeout',()=>clock.signal);
 let adds=0,removes=0;
 for(const signal of [clock.signal,shutdown.signal]){
  const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  t.mock.method(signal,'addEventListener',(...args)=>{adds++;return add(...args);});
  t.mock.method(signal,'removeEventListener',(...args)=>{removes++;return remove(...args);});
 }
 await assert.rejects(fetchRemote(url,1024,{signal:shutdown.signal,transport:async()=>{
  clock.abort(new DOMException('timer','TimeoutError'));shutdown.abort(Object.assign(Error('closing'),{code:'HUB_SHUTDOWN'}));throw aborted();
 }}),error=>error.code==='REMOTE_TIMEOUT');
 assert.equal(adds,2);assert.equal(removes,2);
 const live=new AbortController();let removed=0;const remove=live.signal.removeEventListener.bind(live.signal);
 t.mock.method(live.signal,'removeEventListener',(...args)=>{removed++;return remove(...args);});
 t.mock.method(AbortSignal,'timeout',()=>live.signal);
 assert.equal(new TextDecoder().decode((await fetchRemote(url,1024,{transport:async()=>new Response('ok')})).bytes),'ok');assert.equal(removed,1);
});
test('typed network causes are translated without leaking request URLs; unrelated TLS/security/HTTP errors survive',async()=>{
 const cause=Object.assign(Error('socket reset at secret URL'),{code:'ECONNRESET'});
 await assert.rejects(fetchRemote(url,1024,{transport:async()=>{throw new TypeError('fetch failed',{cause});}}),error=>{assert.equal(error.code,'REMOTE_CONNECTION');assert.equal(error.message,'下载连接中断，请稍后重试');assert.doesNotMatch(remoteErrorText(error),/secret/);return true;});
 const timeout=Object.assign(Error('socket timeout'),{code:'ETIMEDOUT'});
 await assert.rejects(fetchRemote(url,1024,{transport:async()=>{throw timeout;}}),error=>error.code==='REMOTE_TIMEOUT'&&!error.message.includes('20 秒'));
 for(const error of [Object.assign(Error('invalid certificate'),{code:'CERT_HAS_EXPIRED'}),Error('域名解析到内网或保留地址，已拒绝下载')])await assert.rejects(fetchRemote(url,1024,{transport:async()=>{throw error;}}),actual=>actual===error);
 await assert.rejects(fetchRemote(url,1024,{transport:async()=>new Response('unavailable',{status:503})}),/HTTP 503/);
});
test('legacy English messages get conservative display-only mappings without inventing reasons',()=>{
 for(const old of ['The operation was aborted','AbortError: The operation was aborted','This operation was aborted'])assert.equal(displayRemoteError(old),'下载请求被中止，请重试');
 assert.equal(displayRemoteError('The operation was aborted due to timeout'),'下载超时，请稍后重试');
 assert.equal(displayRemoteError('HTTP 403'),'HTTP 403');assert.equal(displayRemoteError('用户自己的 The operation was aborted 说明'),'用户自己的 The operation was aborted 说明');
 assert.doesNotMatch(remoteErrorText(aborted()),/旧版本/);assert.match(remoteErrorText(aborted(),{retained:true}),/已保留旧版本/);
});
test('single-module sync stores a Chinese reason, retains old bytes/identity/membership and does not claim old data on first sync',async t=>{
 let failing=false;
 const {server,base}=await listen({DATA_DIR:temporary(t),ADMIN_SECRET:'remote-test-only',DISABLE_SCHEDULER:'true'},{remoteFetch:async raw=>{
  if(failing)throw aborted();if(raw.endsWith('/new.rex'))return Response.json({title:'首次订阅',widgets:[{id:'new',url:'https://upstream.example/new.js'}]});return new Response('var WidgetMetadata={id:'+JSON.stringify(new URL(raw).pathname)+',title:"原模块",version:"1.0.0"};');
 }});t.after(()=>close(server));const cookie=await login(base,'remote-test-only'),call=(path,options={})=>api(base,path,{cookie,...options});
 async function ok(path,options){const r=await call(path,options),body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;}
 const imported=await ok('/api/admin/modules/import',{method:'POST',json:{url}}),id=imported.added[0].id,source=imported.subscription.id;
 await ok('/api/admin/collections',{method:'POST',json:{title:'原合集',slug:'keep',moduleIds:[id]}});
 const before=await ok('/api/admin/backup'),raw=await(await call('/api/modules/'+id+'.js')).text();failing=true;
 assert.equal((await call('/api/admin/subscriptions/'+source+'/sync',{method:'POST',json:{}})).status,400);
 const saved=(await ok('/api/admin/subscriptions')).find(s=>s.id===source);assert.equal(saved.last_error,'下载请求被中止，请重试；已保留旧版本');assert.equal(saved.status,'error');assert.ok(saved.next_sync_at>Date.now()+5*3600000);
 assert.equal(await(await call('/api/modules/'+id+'.js')).text(),raw);const after=await ok('/api/admin/backup');assert.deepEqual(after.meta.modules,before.meta.modules);assert.deepEqual(after.meta.collections,before.meta.collections);
 failing=false;const fresh=await ok('/api/admin/modules/import',{method:'POST',json:{url:'https://upstream.example/new.rex'}});
 // Create a collection subscription with a valid preview, then fail its first
 // download: there is no old module to promise to preserve.
 failing=true;let done=false;for(let i=0;i<5&&!done;i++)done=(await ok('/api/admin/subscriptions/'+fresh.subscription.id+'/sync',{method:'POST',json:{}})).done;assert.equal(done,true);
 const first=(await ok('/api/admin/subscriptions')).find(s=>s.id===fresh.subscription.id),items=await ok('/api/admin/subscriptions/'+fresh.subscription.id+'/items');assert.equal(first.imported,0);assert.equal(items[0].last_error,'下载请求被中止，请重试');
});
