// 3.5.8：只同步失败、增量/全量恢复、替换时填版本号、加密模块自动版本号、zip 上传、.fwd 转换、
// 图标上传、文件栏目、存储用量、恢复省内存、订阅批量、部分备份导出。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {listen,close,temporary,api,login} from './helpers.js';
import {stampVersion,cleanVersion,nextVersion,shanghaiDay} from '../versions.js';
import {fwdToRex,storedZip,macJson} from '../fwd.js';
import {readHomeZip,parseHomePackage} from '../home-configs.js';
import {detectKind,fileName,FILE_LIMITS} from '../files.js';
import {prepareBackup,backupParts,backupStream} from '../backup.js';
import {zipUploadUI} from '../zip-upload-ui.js';
import {enhancementsUI} from '../enhancements-ui.js';
import {restoreUI} from '../restore-ui.js';
import {getHTML,parseMeta,isEncrypted} from '../worker.js';
import {zipEntries,homePackage,avatar} from './fixtures/home-package.js';

const CF=process.env.REX_TEST_RUNTIME==='cf';
const sha=b=>createHash('sha256').update(b).digest('hex');
const code=(id,v='1.0.0',body='a')=>`var WidgetMetadata={id:'${id}',title:'${id}',version:'${v}',modules:[]};function f(){return '${body}';}`;
const enc=s=>Buffer.concat([Buffer.from('REXENC\n'),Buffer.from('payload:'+s)]);
const ok=async response=>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
async function start(t,dependencies={}){
 const {server,base}=await listen({DATA_DIR:temporary(t),ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'},dependencies);
 let closed=false;t.after(async()=>{if(!closed)await close(server);});
 const cookie=await login(base,'test-password');
 const s={base,call:(p,o={})=>api(base,p,{cookie,...o}),anon:(p,o={})=>api(base,p,o),async close(){closed=true;await close(server);}};
 s.ok=async(p,o)=>ok(await s.call(p,o));
 return s;
}
async function preview(s,file,target=''){
 const fd=new FormData();fd.append('files',file);if(target)fd.append('target_id',target);
 return s.ok('/api/admin/modules/upload/preview',{method:'POST',body:fd});
}
async function commit(s,p,file,{version,action}={}){
 const row=p.rows[0],fd=new FormData();
 for(const [k,v] of Object.entries({job_id:p.job_id,index:'0',action:action||(row.target?'replace':'new'),target_id:row.target?.id||'',mode:'temporary'}))fd.append(k,v);
 if(version!==undefined)fd.append('version',version);fd.append('file',file);
 return s.call('/api/admin/modules/upload/commit',{method:'POST',body:fd});
}
async function upload(s,name,bytes,options={}){const f=new File([bytes],name),p=await preview(s,f,options.target||'');return ok(await commit(s,p,f,options));}
const modules=s=>s.ok('/api/admin/modules');
const mod=async(s,id)=>(await modules(s)).find(m=>m.id===id);
const backup=(s,scope)=>s.ok('/api/admin/backup'+(scope?'?scope='+scope:''));
async function restore(s,body,mode){return s.call('/api/admin/backup/restore'+(mode?'?mode='+mode:''),{method:'POST',json:body});}

// ===== #4 版本号工具 =====
test('3.5.8 stampVersion: Beijing day, same-day increment, new day resets, clock skew never goes backwards',()=>{
 const t0=Date.UTC(2026,10,22,16,30);// 北京时间 2026-11-23 00:30
 assert.equal(shanghaiDay(t0),'2026.11.23');assert.equal(shanghaiDay(Date.UTC(2026,10,22,15,59)),'2026.11.22');
 assert.equal(stampVersion('',t0),'2026.11.23.1');assert.equal(stampVersion('1.0.0',t0),'2026.11.23.1');
 assert.equal(stampVersion('2026.11.23.1',t0),'2026.11.23.2');assert.equal(stampVersion('2026.11.23.9',t0),'2026.11.23.10');
 assert.equal(stampVersion('2026.11.22.7',t0),'2026.11.23.1');
 assert.equal(stampVersion('2026.11.24.3',t0),'2026.11.24.4');
 for(const v of ['1.2.3','v2026.11.23.1',' 2026.11.23.1 '])assert.match(stampVersion(v,t0),/^2026\.11\.2[34]\.\d+$/);
 assert.equal(cleanVersion(' 1.2.3 '),'1.2.3');assert.equal(cleanVersion(''),'');assert.equal(cleanVersion(undefined),'');
 for(const bad of ['1 2','<b>','.1','x'.repeat(65),'1/2'])assert.throws(()=>cleanVersion(bad),/版本号/);
 assert.equal(nextVersion({explicit:'9',fromFile:'2',prev:'1',encrypted:true,changed:true}),'9');
 assert.equal(nextVersion({fromFile:'2',prev:'1',encrypted:true,changed:true}),'2');
 assert.equal(nextVersion({prev:'1',encrypted:false,changed:true}),'1');
 assert.equal(nextVersion({prev:'1',encrypted:true,changed:false}),'1');
 assert.match(nextVersion({prev:'1',encrypted:true,changed:true}),/^\d{4}\.\d{2}\.\d{2}\.1$/);
});

// ===== #3 #4 上传替换 =====
test('3.5.8 replacing an encrypted module stamps a date version; a typed version wins; bad versions are rejected before writing',async t=>{
 const s=await start(t),today=shanghaiDay();
 const added=await upload(s,'secret.js',enc('one'));assert.equal((await mod(s,added.module_id)).version,'');
 const first=await upload(s,'secret.js',enc('two'),{target:added.module_id});assert.equal(first.status,'replaced');
 assert.equal((await mod(s,added.module_id)).version,today+'.1');
 await upload(s,'secret.js',enc('three'),{target:added.module_id});assert.equal((await mod(s,added.module_id)).version,today+'.2');
 await upload(s,'secret.js',enc('four'),{target:added.module_id,version:'5.0.0'});assert.equal((await mod(s,added.module_id)).version,'5.0.0');
 // 内容相同：不自动改版本；手填才改。
 const same=await upload(s,'secret.js',enc('four'),{target:added.module_id});assert.equal(same.status,'unchanged');assert.equal((await mod(s,added.module_id)).version,'5.0.0');
 await upload(s,'secret.js',enc('four'),{target:added.module_id,version:'5.0.1'});assert.equal((await mod(s,added.module_id)).version,'5.0.1');
 const f=new File([enc('five')],'secret.js'),p=await preview(s,f,added.module_id),bad=await commit(s,p,f,{version:'1 2'});
 assert.equal(bad.status,400);assert.match((await bad.json()).error,/版本号/);
 const after=await mod(s,added.module_id);assert.equal(after.version,'5.0.1');assert.equal(after.content_hash,sha(enc('four')));
 // 明文模块：代码里的版本号优先于自动版本；没有版本号时保留原值。
 const plain=await upload(s,'plain.js',code('plain','1.0.0'));
 await upload(s,'plain.js',code('plain','1.1.0','b'),{target:plain.module_id});assert.equal((await mod(s,plain.module_id)).version,'1.1.0');
 await upload(s,'plain.js',code('plain','1.1.0','c'),{target:plain.module_id,version:'2.0.0'});assert.equal((await mod(s,plain.module_id)).version,'2.0.0');
 // 界面：每行有版本号输入，提交时带上 version。
 const html=getHTML();assert.match(html,/id="uploadVersion-'\+row\.index\+'"/);assert.match(html,/body\.append\('version',a\.version\)/);
});

test('3.5.8 encrypted subscription content change without an upstream version gets a date version; unchanged bytes keep it',async t=>{
 let bytes=enc('v1'),version='';
 const s=await start(t,{remoteFetch:async url=>new Response(url.endsWith('.rex')?JSON.stringify({title:'S',widgets:[{id:'x',title:'X',version,url:'https://m.example/x.js'}]}):bytes)});
 const source=(await s.ok('/api/admin/modules/import',{method:'POST',json:{url:'https://m.example/c.rex'}})).subscription.id;
 const sync=async()=>{for(let i=0;i<5;i++)if((await s.ok('/api/admin/subscriptions/'+source+'/sync',{method:'POST'})).done)return;throw Error('sync incomplete');};
 await sync();const id=(await modules(s))[0].id;assert.equal((await mod(s,id)).version,'');
 await sync();assert.equal((await mod(s,id)).version,'');
 bytes=enc('v2');await sync();assert.equal((await mod(s,id)).version,shanghaiDay()+'.1');
 bytes=enc('v3');await sync();assert.equal((await mod(s,id)).version,shanghaiDay()+'.2');
 version='7.0.0';bytes=enc('v4');await sync();assert.equal((await mod(s,id)).version,'7.0.0');
});

// ===== #1 只同步失败 =====
test('3.5.8 sync-failed queues only partial/error sources and tells the page which ones to retry',async t=>{
 let broken=true;
 const s=await start(t,{remoteFetch:async url=>{
  if(url.endsWith('good.rex'))return new Response(JSON.stringify({title:'Good',widgets:[{id:'g',url:'https://m.example/g.js'}]}));
  if(url.endsWith('half.rex'))return new Response(JSON.stringify({title:'Half',widgets:[{id:'a',url:'https://m.example/a.js'},{id:'b',url:'https://m.example/b.js'}]}));
  if(url.endsWith('b.js')&&broken)return new Response('nope',{status:500});
  return new Response(code(url.split('/').pop().replace('.js','')));
 }});
 const add=async url=>(await s.ok('/api/admin/modules/import',{method:'POST',json:{url}})).subscription.id;
 const good=await add('https://m.example/good.rex'),half=await add('https://m.example/half.rex');
 const sync=async(id,action)=>{for(let i=0;i<6;i++){const r=await s.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST',json:{action:action||'continue'}});action='continue';if(r.done)return r;}throw Error('sync incomplete');};
 await sync(good);const partial=await sync(half);assert.equal(partial.summary.failed,1);
 const list=await s.ok('/api/admin/subscriptions');assert.equal(list.find(x=>x.id===half).status,'partial');assert.equal(list.find(x=>x.id===good).status,'ok');
 const queued=await s.ok('/api/admin/subscriptions/sync-failed',{method:'POST',json:{}});
 assert.equal(queued.queued,1);assert.deepEqual(queued.sources,[{id:half,retry:true}]);
 broken=false;const retried=await sync(half,'retry');assert.equal(retried.summary.failed,0);assert.equal(retried.total,1);
 const again=await s.ok('/api/admin/subscriptions/sync-failed',{method:'POST',json:{}});assert.equal(again.queued,0);
 assert.equal((await s.anon('/api/admin/subscriptions/sync-failed',{method:'POST',json:{}})).status,401);
});

test('3.5.8 sync-failed button shows the failed count, retries partial sources and plain-syncs errored ones',async()=>{
 class El{constructor(){this.children=[];this.attributes={};this.textContent='';}setAttribute(k,v){this.attributes[k]=v;}append(...n){for(const x of n){this.children.push(x);x.parent=this;}}prepend(x){this.children.unshift(x);x.parent=this;}after(x){const c=this.parent.children;c.splice(c.indexOf(this)+1,0,x);x.parent=this.parent;}querySelector(sel){if(sel==='select')return this.select??=new El();return null;}querySelectorAll(){return [];}}
 const box=new El(),calls=[],synced=[];
 const sources=[{id:'ok',enabled:1,status:'ok'},{id:'p',enabled:1,status:'partial',summary:{failed:2}},{id:'e',enabled:1,status:'error',last_error:'x'},{id:'off',enabled:0,status:'error'}];
 const ctx={state:{subscriptions:sources,groups:[],modules:[],collections:[],tab:'subscriptions'},document:{getElementById:id=>id==='subscriptionsList'?box:null,createElement:()=>new El()},
  renderMods(){},renderSubscriptions(){box.children=[];},sourceSyncing:{},localStorage:{getItem:()=>null,setItem(){}},
  api:async(path)=>{calls.push(path);return {ok:true,queued:2,sources:[{id:'p',retry:true},{id:'e',retry:false}]};},
  syncSource:async(id,action)=>{synced.push([id,action]);return {summary:{failed:0}};}};
 vm.createContext(ctx);vm.runInContext(enhancementsUI,ctx);ctx.renderSubscriptions();
 const bar=box.children[0],button=bar.children.find(b=>b.className.includes('hub-sync-failed'));
 assert.ok(button);assert.equal(button.textContent,'只同步失败（2）');
 await button.onclick();assert.deepEqual(calls,['/api/admin/subscriptions/sync-failed']);assert.deepEqual(synced,[['p','retry'],['e',undefined]]);
 assert.match(box.children[1].textContent,/2 个已恢复/);
 ctx.state.subscriptions=[{id:'ok',enabled:1,status:'ok'}];ctx.renderSubscriptions();assert.ok(!box.children[0].children.some(b=>String(b.className).includes('hub-sync-failed')));
});

// ===== #12 部分导出 + #2 增量/全量 =====
async function seedHub(s){
 const a=await upload(s,'a.js',code('a'));const b=await upload(s,'b.js',code('b'));
 await s.ok('/api/admin/collections',{method:'POST',json:{slug:'mine',title:'Mine',moduleIds:[a.module_id]}});
 const fd=new FormData();fd.append('file',new File([homePackage()],'home.rex'));const home=await s.ok('/api/admin/home-configs',{method:'POST',body:fd});
 const ff=new FormData();ff.append('file',new File([Buffer.from('%PDF-1.4\n%test\n')],'guide.pdf'));const file=await s.ok('/api/admin/files',{method:'POST',body:ff});
 return {a:a.module_id,b:b.module_id,home:home.home.id,file:file.file.id};
}
test('3.5.8 partial export: all / core / homes / files carry exactly their parts and are validated on restore',async t=>{
 const s=await start(t),ids=await seedHub(s);
 const all=await backup(s);assert.deepEqual(all.meta.parts,['core','homes','files']);assert.equal(all.format,8);assert.equal(all.meta.homeConfigs.length,1);assert.equal(all.meta.hubFiles.length,1);
 assert.equal(Buffer.from(all.meta.hubFiles[0].content,'base64').toString(),'%PDF-1.4\n%test\n');assert.equal(Object.keys(all.files).length,2);
 const core=await backup(s,'core');assert.equal(core.scope,'core');assert.deepEqual(core.meta.parts,['core']);assert.equal(core.format,7);
 assert.equal(core.meta.homeConfigs,undefined);assert.equal(core.meta.hubFiles,undefined);assert.equal(Object.keys(core.files).length,2);
 const homes=await backup(s,'homes');assert.deepEqual(Object.keys(homes).sort(),['files','format','meta','scope']);assert.equal(homes.scope,'homes');assert.deepEqual(homes.files,{});assert.equal(homes.meta.homeConfigs[0].id,ids.home);assert.equal(homes.meta.modules,undefined);
 const files=await backup(s,'files');assert.equal(files.scope,'files');assert.deepEqual(files.files,{});assert.equal(files.meta.hubFiles[0].id,ids.file);assert.equal(files.meta.hubFiles[0].hash,sha(Buffer.from('%PDF-1.4\n%test\n')));
 assert.equal((await s.call('/api/admin/backup?scope=nope')).status,400);
 assert.deepEqual(backupParts(all),{core:true,homes:true,files:true});assert.deepEqual(backupParts(core),{core:true,homes:false,files:false});
 assert.deepEqual(backupParts({format:7,files:{},meta:{}}),{core:true,homes:false,files:false});
 assert.deepEqual(backupParts({format:8,files:{},meta:{homeConfigs:[]}}),{core:true,homes:true,files:false});
 // 范围与内容不一致的备份被拒绝。
 for(const body of [{...homes,files:{x:{content:''}}},{...homes,meta:{...homes.meta,parts:['core']}},{...core,meta:{...core.meta,homeConfigs:[]}},{...files,scope:'other'},{...files,meta:{parts:['files']}}]){
  const r=await restore(s,body);assert.equal(r.status,400,JSON.stringify((await r.json())));
 }
});

test('3.5.8 merge restore keeps extra data; full restore makes the backed-up parts match the backup exactly',async t=>{
 const s=await start(t),ids=await seedHub(s),all=await backup(s);
 const extra=await upload(s,'extra.js',code('extra'));
 const fd=new FormData();fd.append('file',new File([homePackage({title:'第二个'})],'h2.rex'));const home2=(await s.ok('/api/admin/home-configs',{method:'POST',body:fd})).home.id;
 const ff=new FormData();ff.append('file',new File([Buffer.from('hello')],'note.txt'));const file2=(await s.ok('/api/admin/files',{method:'POST',body:ff})).file.id;
 const merged=await ok(await restore(s,all));assert.equal(merged.mode,'merge');
 assert.ok(await mod(s,extra.module_id));assert.equal((await s.ok('/api/admin/home-configs')).length,2);assert.equal((await s.ok('/api/admin/files')).files.length,2);
 const full=await ok(await restore(s,all,'full'));assert.equal(full.mode,'full');
 assert.deepEqual((await modules(s)).map(m=>m.id).sort(),[ids.a,ids.b].sort());
 assert.deepEqual((await s.ok('/api/admin/home-configs')).map(h=>h.id),[ids.home]);
 assert.deepEqual((await s.ok('/api/admin/files')).files.map(f=>f.id),[ids.file]);
 assert.ok(!home2||true);assert.ok(file2);
 // 只含首页的备份做全量恢复：只清空首页，模块和文件不动。
 const homesOnly=await backup(s,'homes');
 await upload(s,'extra2.js',code('extra2'));const fd3=new FormData();fd3.append('file',new File([homePackage({title:'第三个'})],'h3.rex'));await s.ok('/api/admin/home-configs',{method:'POST',body:fd3});
 const r=await ok(await restore(s,homesOnly,'full'));assert.equal(r.scope,'homes');assert.equal(r.home_configs,1);
 assert.equal((await s.ok('/api/admin/home-configs')).length,1);assert.equal((await modules(s)).length,3);assert.equal((await s.ok('/api/admin/files')).files.length,1);
 // 没有 parts 的旧备份（没有首页）做全量恢复不会清空现有首页。
 const old=await backup(s,'core');delete old.scope;delete old.meta.parts;
 await ok(await restore(s,old,'full'));assert.equal((await s.ok('/api/admin/home-configs')).length,1);assert.equal((await s.ok('/api/admin/files')).files.length,1);
 // 全量恢复失败时整体回滚：坏备份不会先把数据清掉。
 const broken={...all,meta:{...all.meta,collections:[{id:'c1',slug:'mine',title:'x',moduleIds:['missing']}]}};
 const before=(await modules(s)).length,bad=await restore(s,broken,'full');assert.equal(bad.status,400);assert.equal((await modules(s)).length,before);
});

test('3.5.8 restore jobs accept merge/full, reject unknown modes and report the mode in the result',async t=>{
 const s=await start(t),ids=await seedHub(s),all=await backup(s,'core');
 await upload(s,'extra.js',code('extra'));
 const id='0f8e4d8c-8f7d-4d55-9a11-'+Date.now().toString(16).padStart(12,'0').slice(-12);
 assert.equal((await s.call('/api/admin/backup/restore/jobs',{method:'POST',json:{id,mode:'wipe'}})).status,400);
 const job=await s.ok('/api/admin/backup/restore/jobs',{method:'POST',json:{id,mode:'full'}});assert.equal(job.job.mode,'full');
 await s.call('/api/admin/backup/restore/jobs/'+id,{method:'PUT',json:all});
 let state;for(let i=0;i<100;i++){state=(await s.ok('/api/admin/backup/restore/jobs/'+id)).job;if(['done','failed','interrupted'].includes(state.status))break;await new Promise(r=>setTimeout(r,30));}
 assert.equal(state.status,'done',JSON.stringify(state));assert.equal(state.result.mode,'full');
 assert.deepEqual((await modules(s)).map(m=>m.id).sort(),[ids.a,ids.b].sort());
 // 「模块数据」备份做全量恢复：首页和文件保留。
 assert.equal((await s.ok('/api/admin/home-configs')).length,1);assert.equal((await s.ok('/api/admin/files')).files.length,1);
 // 界面：恢复方式单选，全量需要二次确认，任务带上 mode。
 assert.match(restoreUI,/name="restoreMode" value="merge" checked/);assert.match(restoreUI,/value="full"/);assert.match(restoreUI,/json:\{id:id,mode:mode\}/);assert.match(restoreUI,/showConfirmAsync\('全量恢复/);
 assert.doesNotMatch(restoreUI,/Docker/);
});

// ===== #10 恢复省内存 =====
test('3.5.8 restore keeps only digests after validation and releases each file text right after writing it',async t=>{
 const content=Buffer.from(code('m')).toString('base64');
 const body={format:1,files:{m:{filename:'m.js',encoding:'base64',content}},meta:{modules:[{id:'m'}]}};
 const prepared=await prepareBackup(body,parseMeta,isEncrypted);
 const entry=prepared.files.get('m');assert.equal(entry.bytes,undefined);assert.equal(entry.size,Buffer.from(code('m')).length);assert.equal(entry.hash,sha(Buffer.from(code('m'))));
 const s=await start(t);const r=await ok(await restore(s,body));assert.equal(r.modules,1);
 assert.equal(await (await s.call('/api/modules/m.js')).text(),code('m'));
 // 写入时再解码：校验后被改动的内容会被发现（大小不一致）。
 const tampered={format:1,files:{m:{filename:'m.js',encoding:'base64',content}},meta:{modules:[{id:'m'}]}};
 const p2=await prepareBackup(tampered,parseMeta,isEncrypted);tampered.files.m.content=Buffer.from(code('m')+'//x').toString('base64');
 const {restoreBackup}=await import('../backup.js');
 await assert.rejects(()=>restoreBackup({DB:{prepare:()=>({all:async()=>({results:[]}),first:async()=>null,run:async()=>({}),bind(){return this;}}),batch:async()=>[]},KV:{put:async()=>{},delete:async()=>{}}},tampered,parseMeta,isEncrypted,p2),/校验后发生变化|模块/);
});

// ===== #9 存储用量 =====
test('3.5.8 storage usage endpoint reports database size against the 1 GB free-plan limit on Cloudflare',async t=>{
 const s=await start(t);await upload(s,'big.js',code('big','1',('x').repeat(300000)));
 const r=await s.ok('/api/admin/storage');
 if(CF){assert.equal(r.limit,1024**3);assert.equal(r.plan,'free');assert.ok(r.used>300000,String(r.used));}
 else{assert.equal(r.limit,0);assert.match(r.note,/不提供/);}
 assert.equal((await s.anon('/api/admin/storage')).status,401);
 const html=getHTML();assert.match(html,/id="storageText"/);assert.match(html,/loadStorageUsage\(\)/);assert.match(html,/存储快满了/);
});

// ===== #8 文件栏目 =====
const pdf=Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n'),zip=zipEntries([['readme.txt','hi']]);
test('3.5.8 file type detection: only real PDF / UTF-8 txt / zip, extension must match the content',()=>{
 assert.equal(detectKind('a.pdf',pdf),'pdf');assert.equal(detectKind('A.PDF',Buffer.concat([Buffer.from('\n '),pdf])),'pdf');
 assert.equal(detectKind('a.txt',Buffer.from('中文 text\n')),'txt');assert.equal(detectKind('a.zip',zip),'zip');
 for(const [name,bytes,re] of [['a.pdf',Buffer.from('<html>%PDF-'),/PDF/],['a.zip',pdf,/zip/],['a.txt',Buffer.from([0x66,0,0x67]),/二进制/],['a.txt',Buffer.from([0xff,0xfe,0x41]),/UTF-8/],
  ['a.html',Buffer.from('<html>'),/只支持/],['a.svg',Buffer.from('<svg/>'),/只支持/],['a.js',Buffer.from('x'),/只支持/],['a.txt',Buffer.alloc(0),/为空/]])assert.throws(()=>detectKind(name,bytes),re,name);
 assert.throws(()=>detectKind('a.pdf',Buffer.alloc(FILE_LIMITS.file+1,0x25)),/25 MiB/);
 assert.equal(fileName(' 说明.pdf ','pdf'),'说明.pdf');for(const bad of ['a/b.pdf','..','x.txt',''])assert.throws(()=>fileName(bad,'pdf'));
});

test('3.5.8 files section: upload, dedupe, safe public serving, share/unshare, rename, replace, delete',async t=>{
 const s=await start(t),root='/api/admin/files';
 const send=(name,bytes,extra={},path=root,method='POST')=>{const fd=new FormData();fd.append('file',new File([bytes],name));for(const [k,v] of Object.entries(extra))fd.append(k,v);return s.call(path,{method,body:fd});};
 const p=await ok(await send('使用说明.pdf',pdf,{note:'给朋友看'}));assert.equal(p.file.kind,'pdf');assert.equal(p.file.note,'给朋友看');assert.equal(p.file.shared,false);
 const txt=await ok(await send('a.txt',Buffer.from('<script>alert(1)</script>')));const z=await ok(await send('pack.zip',zip));
 assert.equal((await send('dup.pdf',pdf)).status,409);
 for(const [n,b] of [['x.html',Buffer.from('<html>')],['x.pdf',Buffer.from('nope')],['x.svg',Buffer.from('<svg/>')]])assert.equal((await send(n,b)).status,400,n);
 const list=await s.ok(root);assert.equal(list.files.length,3);assert.equal(list.total,pdf.length+txt.file.size+zip.length);assert.equal(list.limits.count,200);
 assert.equal((await s.anon(root)).status,401);
 // 管理员打开：PDF inline，zip 附件。
 const view=await s.call(root+'/'+p.file.id+'/download');assert.equal(view.headers.get('content-type'),'application/pdf');assert.match(view.headers.get('content-disposition'),/^inline/);assert.deepEqual(Buffer.from(await view.arrayBuffer()),pdf);
 assert.match((await s.call(root+'/'+z.file.id+'/download')).headers.get('content-disposition'),/^attachment/);
 // 分享需要确认；公开链接安全响应头。
 const fresh=(await s.ok(root)).files.find(f=>f.id===txt.file.id);
 assert.equal((await s.call(root+'/'+fresh.id+'/share',{method:'POST',json:{revision:fresh.revision}})).status,409);
 const shared=await s.ok(root+'/'+fresh.id+'/share',{method:'POST',json:{revision:fresh.revision,accept_public:true}});
 assert.match(shared.path,/^\/api\/files\/[a-f0-9]{64}\/a\.txt$/);
 const pub=await s.anon(shared.path);assert.equal(pub.status,200);assert.equal(pub.headers.get('content-type'),'text/plain; charset=utf-8');
 assert.equal(pub.headers.get('x-content-type-options'),'nosniff');assert.match(pub.headers.get('content-security-policy'),/sandbox/);assert.equal(pub.headers.get('access-control-allow-origin'),'*');
 assert.match(pub.headers.get('content-disposition'),/^inline/);assert.equal(await pub.text(),'<script>alert(1)</script>');
 assert.match((await s.anon(shared.path+'?download=1')).headers.get('content-disposition'),/^attachment/);
 assert.equal((await s.anon(shared.path,{headers:{'If-None-Match':pub.headers.get('etag')}})).status,304);
 assert.equal((await s.anon(shared.path,{method:'HEAD'})).status,200);
 assert.equal((await s.anon(shared.path.replace(/\/a\.txt$/,''))).status,200);
 assert.equal((await s.anon('/api/files/'+'0'.repeat(64))).status,404);assert.equal((await s.anon(shared.path,{method:'DELETE'})).status,405);
 // 改名必须保留扩展名；旧 revision 被拒绝。
 let row=(await s.ok(root)).files.find(f=>f.id===fresh.id);
 assert.equal((await s.call(root+'/'+row.id,{method:'PATCH',json:{name:'b.pdf',revision:row.revision}})).status,400);
 await s.ok(root+'/'+row.id,{method:'PATCH',json:{name:'说明.txt',note:'n',revision:row.revision}});
 assert.equal((await s.call(root+'/'+row.id,{method:'PATCH',json:{name:'c.txt',revision:row.revision}})).status,409);
 // 替换内容：分享链接不变，指向新内容。
 row=(await s.ok(root)).files.find(f=>f.id===fresh.id);
 await ok(await send('new.txt',Buffer.from('新内容'),{revision:row.revision},root+'/'+row.id,'PUT'));
 const now=(await s.ok(root)).files.find(f=>f.id===fresh.id);assert.equal(now.name,'说明.txt');assert.equal(now.share_path.split('/')[3],shared.path.split('/')[3]);
 assert.equal(await (await s.anon(now.share_path)).text(),'新内容');
 // 取消分享：旧链接失效。
 await s.ok(root+'/'+now.id+'/unshare',{method:'POST',json:{revision:now.revision}});assert.equal((await s.anon(now.share_path)).status,404);
 const gone=(await s.ok(root)).files.find(f=>f.id===fresh.id);await s.ok(root+'/'+gone.id,{method:'DELETE',json:{revision:gone.revision}});
 assert.equal((await s.ok(root)).files.length,2);
 // 清除所有数据也清空文件栏目。
 await s.ok('/api/admin/reset',{method:'POST'});assert.equal((await s.ok(root)).files.length,0);
 const html=getHTML();assert.match(html,/id="hubFilesTab"/);assert.match(html,/id="uploadHubFile"/);assert.match(html,/accept="'\+ACCEPT\+'"/);
});

test('3.5.8 files backup streams file contents one by one and round-trips byte-exactly',async t=>{
 const s=await start(t),root='/api/admin/files';
 const fd=new FormData();fd.append('file',new File([pdf],'a.pdf'));const a=(await s.ok(root,{method:'POST',body:fd})).file;
 const share=await s.ok(root+'/'+a.id+'/share',{method:'POST',json:{revision:(await s.ok(root)).files[0].revision,accept_public:true}});
 const saved=await backup(s,'files');await s.ok('/api/admin/reset',{method:'POST'});
 const r=await ok(await restore(s,saved));assert.equal(r.hub_files,1);
 const back=(await s.ok(root)).files[0];assert.equal(back.id,a.id);assert.equal(back.share_path,share.path);assert.deepEqual(Buffer.from(await (await s.anon(share.path)).arrayBuffer()),pdf);
 // 损坏的文件备份被拒绝。
 const bad=structuredClone(saved);bad.meta.hubFiles[0].content=Buffer.from('%PDF-x').toString('base64');assert.equal((await restore(s,bad)).status,400);
 // backupStream 按需读取文件内容，输出可解析且内容完整。
 let loads=0;const fake={format:8,scope:'files',meta:{parts:['files'],hubFiles:[{id:'1',name:'a.pdf'},{id:'2',name:'b.pdf'}]},files:{}};
 Object.defineProperty(fake,'loadHubFile',{value:async row=>{loads++;return {...row,content:'X'+row.id};}});
 const text=await new Response(backupStream(fake)).text();assert.equal(loads,2);assert.deepEqual(JSON.parse(text).meta.hubFiles.map(f=>f.content),['X1','X2']);
});

// ===== #7 图标上传 =====
test('3.5.8 icon image upload stores a validated PNG/JPEG/WebP and returns a local /api/icons URL',async t=>{
 const s=await start(t);const fd=new FormData();fd.append('file',new File([avatar],'logo.png',{type:'image/png'}));
 const r=await s.ok('/api/admin/icons/upload',{method:'POST',body:fd});assert.match(r.url,/^\/api\/icons\/[a-f0-9]{64}\.png$/);assert.equal(r.hash,sha(avatar));
 const img=await s.anon(r.url);assert.equal(img.status,200);assert.deepEqual(Buffer.from(await img.arrayBuffer()),avatar);
 const col=await s.ok('/api/admin/collections',{method:'POST',json:{slug:'iconic',title:'I',moduleIds:[],icon_url:r.url}});assert.ok(col);
 for(const [name,bytes,type] of [['x.svg',Buffer.from('<svg/>'),'image/svg+xml'],['x.png',Buffer.from('not png'),'image/png'],['x.png',avatar,'image/jpeg']]){
  const bad=new FormData();bad.append('file',new File([bytes],name,{type}));assert.equal((await s.call('/api/admin/icons/upload',{method:'POST',body:bad})).status,400,name);
 }
 const none=await s.call('/api/admin/icons/upload',{method:'POST',body:new FormData()});assert.equal(none.status,400);
 assert.equal((await s.anon('/api/admin/icons/upload',{method:'POST',body:fd})).status,401);
 const html=getHTML();assert.match(html,/data-role="upload">上传图片/);assert.match(html,/\/api\/admin\/icons\/upload/);
});

// ===== #6 .fwd → .rex =====
const fwdLayout=[{id:'s1',title:'推荐',isActive:true,items:[{style:'banner',count:0,gridSize:[-1,3],id:'i1',title:'热门',subtitle:'',iconUrl:'',functionId:'trending',params:[{key:'time_window',value:'day'}],widgetBundleId:'',widgetId:'rex.tmdb',widgetURL:'https://assets.example/a/b.js',name:''},{id:'i2',title:'缺字段'}]},{id:'s2',title:'分区',isActive:true,items:[]}];
test('3.5.8 Forward .fwd converts to a Mac-format Rex home package with rows unchanged and missing item fields filled',()=>{
 const fwd=zipEntries([['widgets.json',JSON.stringify(fwdLayout)],['home.json',JSON.stringify({title:'我的 Forward',avatar:'custom',avatarData:avatar.toString('base64')})]]);
 const out=fwdToRex(fwd,'我的.fwd');assert.equal(out.filename,'我的.rex');assert.equal(out.avatar,'avatar-22');assert.equal(out.filled,11);assert.deepEqual(JSON.parse(readHomeZip(out.bytes).get('rex-layout.json'))[0].items[1].gridSize,[-1,2]);
 const entries=readHomeZip(out.bytes);assert.deepEqual([...entries.keys()],['rex-manifest.json','rex-layout.json','rex-home.json']);
 const homeText=entries.get('rex-home.json').toString();assert.match(homeText,/^\{"avatar":"avatar-22","avatarData":"[^"]+","isIndependent":false,"title":"我的 Forward"\}$/);
 assert.match(entries.get('rex-layout.json').toString(),/https:\\\/\\\/assets\.example\\\/a\\\/b\.js/);
 const layout=JSON.parse(entries.get('rex-layout.json'));assert.deepEqual(layout[0].items[0],fwdLayout[0].items[0]);assert.deepEqual(layout[1],fwdLayout[1]);
 assert.deepEqual(Object.keys(layout[0].items[1]).length,13);assert.deepEqual(layout[0].items[1].params,[]);
 assert.equal(entries.get('rex-manifest.json').toString(),'{"format":"video.fika.rex.home-package","version":1}');
 const parsed=parseHomePackage(out.bytes,out.filename);assert.equal(parsed.package_title,'我的 Forward');assert.equal(parsed.sections,2);assert.ok(parsed.avatar);
 // 非 PNG 头像改用内置头像；没有名称时用文件名。
 const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0x11,0,0xff,0xd9]);
 const jpg=fwdToRex(zipEntries([['widgets.json','[]'],['home.json',JSON.stringify({avatarData:jpeg.toString('base64')})]]),'旧首页.fwd');
 assert.equal(JSON.parse(readHomeZip(jpg.bytes).get('rex-home.json')).avatar,'avatar-8');assert.equal(JSON.parse(readHomeZip(jpg.bytes).get('rex-home.json')).title,'旧首页');
 assert.equal(readHomeZip(jpg.bytes).get('rex-home.json').toString(),'{"avatar":"avatar-8","isIndependent":false,"title":"旧首页"}');
 for(const bad of [zipEntries([['home.json','{}']]),zipEntries([['widgets.json','{}'],['home.json','{}']]),zipEntries([['dir/widgets.json','[]'],['dir/home.json','{}']]),Buffer.from('not zip')])assert.throws(()=>fwdToRex(bad));
 assert.equal(macJson({u:'a/b'}),'{"u":"a\\/b"}');
 // 自己写的 zip 能被首页解析器完整读出。
 const zipped=storedZip([['a.txt',Buffer.from('x')]]);assert.equal(readHomeZip(zipped).get('a.txt').toString(),'x');
});

test('3.5.8 uploading a .fwd home saves the converted .rex and says so; replacing with .fwd keeps the share link',async t=>{
 const s=await start(t),root='/api/admin/home-configs';
 const fwd=zipEntries([['widgets.json',JSON.stringify(fwdLayout)],['home.json',JSON.stringify({title:'FWD 首页'})]]);
 const fd=new FormData();fd.append('file',new File([fwd],'forward.fwd'));const r=await s.call(root,{method:'POST',body:fd}),body=await r.json();
 assert.equal(r.status,201,JSON.stringify(body));assert.equal(body.converted_from,'fwd');assert.equal(body.home.filename,'forward.rex');assert.equal(body.home.title,'FWD 首页');
 const file=Buffer.from(await (await s.call(root+'/'+body.home.id+'/file')).arrayBuffer());assert.deepEqual([...readHomeZip(file).keys()],['rex-manifest.json','rex-layout.json','rex-home.json']);
 let row=(await s.ok(root))[0];const share=await s.ok(root+'/'+row.id+'/share',{method:'POST',json:{revision:row.revision,accept_public:true}});row=(await s.ok(root))[0];
 const again=new FormData();again.append('file',new File([zipEntries([['widgets.json','[]'],['home.json','{"title":"新"}']])],'b.fwd'));again.append('revision',row.revision);
 const put=await s.ok(root+'/'+row.id,{method:'PUT',body:again});assert.equal(put.converted_from,'fwd');
 assert.equal((await s.anon(share.path)).status,200);
 const bad=new FormData();bad.append('file',new File([Buffer.from('x')],'c.fwd'));assert.equal((await s.call(root,{method:'POST',body:bad})).status,400);
 const html=getHTML();assert.match(html,/accept=".rex,.fwd"/);
});

// ===== #5 zip 上传模块（浏览器端解压） =====
function zipCtx(){const ctx={Blob,Response,DecompressionStream,TextDecoder,DataView,Uint8Array,File,Error,String};vm.createContext(ctx);vm.runInContext(zipUploadUI,ctx);return ctx;}
test('3.5.8 module zip upload extracts only .js files (stored and deflated), skips folders, __MACOSX and hidden files',async()=>{
 const ctx=zipCtx();
 const z=zipEntries([['mods/a.js',code('a')],['b.js',code('b')],['__MACOSX/._a.js','junk'],['__MACOSX/mods/a2.js',code('a2')],['.hidden.js','x'],['mods/.c.js','x'],['readme.txt','x'],['dir/','']]);
 const stored=zipEntries([['c.js',code('c')]],{stored:true});
 const r=await ctx.hubExpandUploads([new File([z],'pack.zip'),new File([stored],'one.zip'),new File([code('d')],'d.js')]);
 assert.deepEqual(Array.from(r.files,f=>f.name),['a.js','b.js','c.js','d.js']);assert.equal(await r.files[0].text(),code('a'));assert.equal(await r.files[2].text(),code('c'));
 assert.match(r.notes[0],/取出 2 个 \.js，跳过 6 个其它文件/);
 await assert.rejects(()=>ctx.hubExpandUploads([new File([zipEntries([['x.txt','x']])],'empty.zip')]),/没有 \.js/);
 await assert.rejects(()=>ctx.hubExpandUploads([new File([Buffer.from('not a zip at all, sorry')],'bad.zip')]),/不是有效的 zip/);
 const enc=Buffer.from(zipEntries([['e.js','x']],{stored:true}));enc.writeUInt16LE(0x801,6);enc.writeUInt16LE(0x801,enc.indexOf(Buffer.from([0x50,0x4b,1,2]))+8);
 await assert.rejects(()=>ctx.hubExpandUploads([new File([enc],'enc.zip')]),/加密/);
 const many=zipEntries(Array.from({length:46},(_,i)=>['m'+i+'.js',code('m'+i)]),{stored:true});
 await assert.rejects(()=>ctx.hubExpandUploads([new File([many],'many.zip')]),/45/);
 // Windows 中文压缩软件：文件名是 GBK、没有 UTF-8 标记。
 const gbk=Buffer.from(zipEntries([['ABCD.js',code('g')]],{stored:true}));
 for(let at=gbk.indexOf('ABCD');at>=0;at=gbk.indexOf('ABCD',at+1))Buffer.from([0xc4,0xa3,0xbf,0xe9]).copy(gbk,at);
 gbk.writeUInt16LE(0,6);gbk.writeUInt16LE(0,gbk.indexOf(Buffer.from([0x50,0x4b,1,2]))+8);
 assert.equal((await ctx.hubExpandUploads([new File([gbk],'cn.zip')])).files[0].name,'模块.js');
 const html=getHTML();assert.match(html,/accept="\.js,\.zip,/);assert.match(html,/hubExpandUploads\(picked\)/);
 assert.ok(deflateRawSync);
});

// ===== #11 订阅批量 =====
test('3.5.8 subscription batches: Cloudflare processes 6 modules per request (2 downloads at a time), Docker keeps 2',async t=>{
 let active=0,peak=0;
 const widgets=Array.from({length:8},(_,i)=>({id:'w'+i,url:'https://m.example/w'+i+'.js'}));
 const s=await start(t,{remoteFetch:async url=>{if(url.endsWith('.rex'))return new Response(JSON.stringify({title:'B',widgets}));active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return new Response(code(url.split('/').pop().replace('.js','')));}});
 const id=(await s.ok('/api/admin/modules/import',{method:'POST',json:{url:'https://m.example/b.rex'}})).subscription.id;
 const first=await s.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});
 const step=first.done?first:await s.ok('/api/admin/subscriptions/'+id+'/sync',{method:'POST'});
 assert.equal(step.processed,CF?6:2);assert.ok(peak<=2,String(peak));
});

test('3.5.8 full restore keeps share links of modules in the backup and retires links of modules not in it',async t=>{
 const s=await start(t);
 const share=async(id,alias)=>{const p=await s.ok('/api/admin/modules/'+id+'/share/preview',{method:'POST',json:{alias}});return s.ok('/api/admin/modules/'+id+'/share',{method:'PUT',json:{alias:p.alias,revision:p.revision}});};
 const a=await upload(s,'a.js',code('a'));await share(a.module_id,'keep-me.js');
 const saved=await backup(s);
 const b=await upload(s,'b.js',code('b'));await share(b.module_id,'drop-me.js');
 assert.equal((await s.anon('/api/modules/keep-me.js')).status,200);assert.equal((await s.anon('/api/modules/drop-me.js')).status,200);
 const r=await ok(await restore(s,saved,'full'));assert.equal(r.mode,'full');
 assert.equal(await (await s.anon('/api/modules/keep-me.js')).text(),code('a'));
 assert.equal((await s.anon('/api/modules/drop-me.js')).status,404);
 // 被作废的分享名不能再被其他模块占用（与清除数据时一致）。
 const c=await upload(s,'c.js',code('c'));const p=await s.ok('/api/admin/modules/'+c.module_id+'/share/preview',{method:'POST',json:{alias:'drop-me.js'}});assert.notEqual(p.alias,'drop-me.js');
 // 同一份备份再做一次全量恢复也成功（幂等）。
 await ok(await restore(s,saved,'full'));assert.equal(await (await s.anon('/api/modules/keep-me.js')).text(),code('a'));
});
