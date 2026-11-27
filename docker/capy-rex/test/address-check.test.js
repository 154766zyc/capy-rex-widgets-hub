import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createSourcePolicy, fetchRemote, assertModuleFile } from '../remote.js';
import { createPublicFetch, createSourceLookup, publicFetch } from '../network.js';
import { createHubServer } from '../server.js';
import { listen, close, temporary, api, login } from './helpers.js';

const disabled = createSourcePolicy('', {addressCheck:false});
const source = 'http://127.0.0.1:2233';
const code = version => `WidgetMetadata={id:'compat.module',title:'Compat',version:'${version}'};`;
const json = async response => { const body=await response.json(); assert.ok(response.ok,JSON.stringify(body)); return body; };
const fakeDns = answers => (_host,_options,cb) => cb(null,answers.map(address=>({address,family:address.includes(':')?6:4})));
const resolveWith = lookup => new Promise((resolve,reject)=>lookup('fake.example',{all:true},(error,value)=>error?reject(error):resolve(value)));

async function open(t,{directory=temporary(t),config={},remoteFetch}={}) {
  const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',PUBLIC_URL:'https://hub.example',
    DISABLE_SCHEDULER:'true',...config},{remoteFetch});
  let stopped=false;
  const stop=async()=>{if(!stopped){stopped=true;await close(server);}};
  t.after(stop);
  const cookie=await login(base,'test-password');
  return {directory,base,stop,call:(path,options={})=>api(base,path,{cookie,...options})};
}
async function socketServer(t,server) {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{const finished=once(server,'close');server.close();await finished;});
  return server.address().port;
}
async function cycle(s,id) {
  for(let n=0;n<10;n++){
    const result=await json(await s.call('/api/admin/subscriptions/'+id+'/sync',{method:'POST'}));
    if(result.done)return result;
  }
  throw Error('cycle did not finish');
}

test('explicit compatibility mode permits address ranges and local names without weakening protocol or credential rules',()=>{
  assert.equal(createSourcePolicy().addressCheck,true);
  for(const raw of ['http://192.168.1.5:2233/a.js','http://198.18.55.117/a.js','http://127.0.0.1/a.js',
    'http://169.254.169.254/a.js','http://localhost/a.js','http://bridge.local/a.js','http://[::1]/a.js']){
    assert.throws(()=>createSourcePolicy().assertUrl(raw),/地址/);
    assert.equal(disabled.assertUrl(raw+'#fragment').href,new URL(raw).href);
  }
  for(const raw of ['file:///etc/passwd','ftp://example.com/a.js','http://user:password@127.0.0.1/a.js','not a url']){
    assert.throws(()=>disabled.assertUrl(raw),/URL|http\/https/);
  }
  assert.throws(()=>createSourcePolicy('',{addressCheck:'false'}),/SOURCE_ADDRESS_CHECK/);
  assert.equal(createSourcePolicy('http://192.168.1.5:2233').addressCheck,true);
});

test('compatibility mode uses actual DNS answers including Fake-IP; default instances remain protected',async()=>{
  const answers=['198.18.55.117','192.168.1.5','127.0.0.1','::1'];
  const lookup=createSourceLookup('https://fake.example/a.js',disabled,fakeDns(answers));
  assert.deepEqual((await resolveWith(lookup)).map(a=>a.address),answers);
  await assert.rejects(resolveWith(createSourceLookup('https://fake.example/a.js',createSourcePolicy(),fakeDns(answers))),/内网|保留/);
  await assert.rejects(resolveWith(createSourceLookup('https://fake.example/a.js',disabled,fakeDns([]))),/内网|保留/);
});

test('invalid address-check settings fail before SQLite changes; default cannot be disabled by a web request',async t=>{
  for(const value of ['False','0','off',false,0]){
    const directory=join(temporary(t),'untouched');
    await assert.rejects(createHubServer({DATA_DIR:directory,ADMIN_SECRET:'test-password',SOURCE_ADDRESS_CHECK:value}),/SOURCE_ADDRESS_CHECK/);
    assert.equal(existsSync(directory),false);
  }
  let hits=0;
  const s=await open(t,{remoteFetch:async()=>{hits++;return new Response(code(1));}});
  const response=await s.call('/api/admin/modules/import',{method:'POST',json:{url:source+'/a.js',SOURCE_ADDRESS_CHECK:false}});
  assert.equal(response.status,400);assert.equal(hits,0);
});

test('real HTTP transport and Hub import allow previously blocked addresses and redirects only when explicitly disabled',async t=>{
  if(process.env.REX_TEST_TRANSPORT==='memory')return t.skip('socket-free test mode');
  const downstream=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript'});res.end(code(1));});
  const downstreamPort=await socketServer(t,downstream);
  let hits=0;
  const upstream=createServer((req,res)=>{
    hits++;
    if(req.url==='/redirect'){res.writeHead(302,{Location:'http://127.0.0.1:'+downstreamPort+'/a.js'});res.end();}
    else {res.writeHead(200,{'Content-Type':'application/javascript'});res.end(code(1));}
  });
  const port=await socketServer(t,upstream),origin='http://127.0.0.1:'+port;
  await assert.rejects(publicFetch(origin+'/a.js'),/地址/);assert.equal(hits,0);
  const result=await fetchRemote(origin+'/redirect',1024,{assertUrl:disabled.assertUrl,transport:createPublicFetch(disabled)});
  assert.equal(new TextDecoder().decode(result.bytes),code(1));
  const s=await open(t,{config:{SOURCE_ADDRESS_CHECK:'false'}});
  const imported=await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:origin+'/redirect'}}));
  assert.equal(await(await s.call('/api/modules/'+imported.added[0].id+'/raw')).text(),code(1));
  assert.equal((await api(s.base,'/api/admin/modules/import',{method:'POST',json:{url:origin+'/a.js'}})).status,401);
});

test('compatibility mode still rejects invalid TLS certificates',async t=>{
  if(process.env.REX_TEST_TRANSPORT==='memory')return t.skip('socket-free test mode');
  const directory=temporary(t),key=join(directory,'tls-key.pem'),cert=join(directory,'tls-cert.pem');
  const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1'],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const server=createHttpsServer({key:readFileSync(key),cert:readFileSync(cert)},(_req,res)=>res.end(code(1)));
  const port=await socketServer(t,server);
  await assert.rejects(createPublicFetch(disabled)('https://127.0.0.1:'+port+'/a.js'),error=>/CERT|SIGNATURE|ALTNAME/.test(error.code));
});

test('disabled address checks retain redirect limits, credential rejection, content validation, size and cancellation limits',async()=>{
  await assert.rejects(fetchRemote(source,3,{assertUrl:disabled.assertUrl,transport:async()=>new Response('1234')}),/大小/);
  await assert.rejects(fetchRemote(source,1024,{assertUrl:disabled.assertUrl,transport:async()=>new Response(null,{status:302,headers:{location:'/loop'}})}),/重定向/);
  let hits=0;
  await assert.rejects(fetchRemote(source,1024,{assertUrl:disabled.assertUrl,transport:async()=>{hits++;return new Response(null,{status:302,headers:{location:'http://user:secret@localhost/a.js'}});}}),/http\/https/);
  assert.equal(hits,1);
  const abort=new AbortController();abort.abort(Error('cancelled'));
  await assert.rejects(fetchRemote(source,1024,{assertUrl:disabled.assertUrl,signal:abort.signal,transport:async(_url,{signal})=>{signal.throwIfAborted();}}),error=>error.code==='REMOTE_ABORTED'&&error.cause===abort.signal.reason);
  for(const raw of ['<html>error</html>','{"error":true}'])assert.throws(()=>assertModuleFile(Buffer.from(raw)),/网页|JSON/);
});

test('compatibility imports, manual refresh and scheduled subscription updates preserve IDs, aliases, order and bytes across re-enabling checks',async t=>{
  let version=1,fail=false;
  const remoteFetch=async url=>{
    if(fail)throw Error('upstream failed');
    return new Response(url.endsWith('.rex')?JSON.stringify({title:'Compat source',widgets:[{id:'remote',url:source+'/a.js'}]}):code(version));
  };
  const s=await open(t,{config:{SOURCE_ADDRESS_CHECK:'false'},remoteFetch});
  const imported=await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:source+'/a.js'}}));
  const mid=imported.added[0].id;
  await json(await s.call('/api/admin/modules?id='+mid,{method:'PATCH',json:{note:'keep note'}}));
  const col=await json(await s.call('/api/admin/collections',{method:'POST',json:{slug:'oldcompat',title:'Mine',moduleIds:[mid]}}));
  await json(await s.call('/api/admin/collections',{method:'PATCH',json:{id:col.id,slug:'compat'}}));
  const before=await json(await s.call('/api/collections/oldcompat.rex'));
  version=2;
  await json(await s.call('/api/admin/modules/'+mid+'/refresh',{method:'POST'}));
  const sub=(await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:source+'/list.rex'}}))).subscription.id;
  await cycle(s,sub);
  fail=true;
  assert.equal((await s.call('/api/admin/subscriptions/'+sub+'/sync',{method:'POST'})).status,400);
  assert.equal(await(await s.call('/api/modules/'+mid+'/raw')).text(),code(2));
  fail=false;
  await s.stop();
  const db=new DatabaseSync(join(s.directory,'rex.sqlite'));
  db.prepare('UPDATE subscription_sources SET next_sync_at=0 WHERE id=?').run(sub);db.close();
  version=3;
  const resumed=await open(t,{directory:s.directory,config:{SOURCE_ADDRESS_CHECK:'false',DISABLE_SCHEDULER:'false'},remoteFetch});
  let modules;
  for(let n=0;n<200;n++){
    modules=await json(await resumed.call('/api/admin/modules'));
    if(modules[0]?.version==='3')break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(modules.length,1);assert.equal(modules[0].id,mid);assert.equal(modules[0].version,'3');assert.equal(modules[0].note,'keep note');
  assert.deepEqual((await json(await resumed.call('/api/admin/collections'))).find(c=>c.id===col.id).moduleIds,[mid]);
  assert.equal((await json(await resumed.call('/api/collections/oldcompat.rex'))).widgets[0].url,before.widgets[0].url);
  await resumed.stop();
  const restored=await open(t,{directory:s.directory,config:{SOURCE_ADDRESS_CHECK:'true'},remoteFetch});
  assert.equal((await restored.call('/api/admin/subscriptions/'+sub+'/sync',{method:'POST'})).status,400);
  assert.equal(await(await restored.call('/api/modules/'+mid+'/raw')).text(),code(3));
  assert.equal((await json(await restored.call('/api/collections/compat.rex'))).widgets[0].url,before.widgets[0].url);
});
