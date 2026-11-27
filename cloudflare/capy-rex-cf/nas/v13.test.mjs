import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {temporary,listen,close,api,login} from '../test/helpers.js';
import {initialize} from './init.mjs';
const code=readFileSync(new URL('../validator/worker.js',import.meta.url),'utf8').replace("'./acorn.mjs'",JSON.stringify(new URL('./vendor/acorn.mjs',import.meta.url).href));
const {checkSource}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const sample='var WidgetMetadata={id:"test.v13",title:"Example",modules:[{title:"List",functionName:"list"}]}; async function list(){return [];}';
test('V1.3 checker parses without evaluating, bounds input and separates static from runtime',()=>{
 assert.equal(checkSource(sample+'; while(true){}; throw Error("do not execute");').ok,true);
 assert.equal(checkSource('var x = {').ok,false);
 assert.equal(checkSource(sample.replace('var WidgetMetadata','const WidgetMetadata')).ok,false);
 assert.equal(checkSource('REXENC\n{}\nAAAA','rex').ok,false);
 assert.equal(checkSource('x'.repeat(512*1024+1)).ok,false);
 assert.equal(checkSource('var WidgetMetadata={title:"x",modules:[]};').ok,false);
 assert.match(checkSource(sample.replace('"list"','"list()"')).issues.join(' '),/非法/);
 assert.match(checkSource('var WidgetMetadata=makeMetadata();').warnings.join(' '),/动态/);
 assert.match(checkSource(sample.replace('"list"','"missing"')).warnings.join(' '),/未发现/);
});
test('V1.3 HTTP raw byte compatibility, missing UUID, conditional request, checker CSP and quotas',async t=>{
 const dir=temporary(t),password=randomBytes(24).toString('hex');await initialize(dir,password);
 const {server,base}=await listen({DATA_DIR:dir,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});t.after(()=>close(server));
 const cookie=await login(base,password);const body=new FormData();body.set('file',new File([sample],'example.js'));body.set('platform','capy');
 const publish=await api(base,'/api/community/publish',{cookie,method:'POST',body});assert.equal(publish.status,201);const id=(await publish.json()).module_id;
 const raw=await fetch(base+'/raw/'+id+'.js',{headers:{'Accept-Encoding':'identity'}});assert.equal(raw.status,200);assert.equal(await raw.text(),sample);assert.equal(raw.headers.get('content-encoding'),null);assert.match(raw.headers.get('cache-control'),/no-store, no-transform/);assert.equal(raw.headers.get('vary'),'Accept-Encoding');
 const old=await fetch(base+'/api/modules/'+id+'.js');assert.equal(await old.text(),sample);
 const head=await fetch(base+'/raw/'+id+'.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await fetch(base+'/raw/'+id+'.js',{headers:{'If-None-Match':head.headers.get('etag')}})).status,304);
 assert.equal((await fetch(base+'/raw/00000000-0000-0000-0000-000000000000.js')).status,404);
 assert.equal((await fetch(base+'/raw/'+id+'.js',{method:'POST'})).status,405);
 const catalog=await (await fetch(base+'/api/community/catalog')).json();const m=catalog.find(m=>m.id===id);assert.equal(m.url,base+'/raw/'+id+'.js');assert.equal(Buffer.from(m.capy.split('data=')[1],'base64url').toString(),m.url);
 for(const path of ['/checker','/checker/app.js','/checker/worker.js','/checker/acorn.mjs']){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/connect-src 'none'/);assert.doesNotMatch(r.headers.get('content-security-policy'),/sandbox/);assert.equal((await fetch(base+path,{method:'POST',body:'never execute'})).status,405);}
 assert.equal((await fetch(base+'/checker/../.env')).status,404);
 const ui=await (await fetch(base+'/user')).text();assert.match(ui,/id="search"/);assert.match(ui,/id="authorFilter"/);assert.ok(ui.indexOf('data-platform="capy"')<ui.indexOf('data-platform="rex"'));assert.match(ui,/测试前请勿加密！/);
 const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.ok(manifest.icons.every(i=>i.src.includes('capy-')));
 const favicon=Buffer.from(await (await fetch(base+'/favicon.ico')).arrayBuffer());assert.deepEqual(favicon,readFileSync(new URL('../public/app-icons/capy-v1-48.png',import.meta.url)));
});
