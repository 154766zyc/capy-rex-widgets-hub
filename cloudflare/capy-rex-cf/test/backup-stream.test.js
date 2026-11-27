// 3.5.8：流式解析备份（边读边解码模块文件）的正确性：与 JSON.parse 结果一致，分块位置任意，坏输入一律拒绝。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readBackupBody} from '../backup-stream.js';
import {listen,close,temporary,api,login} from './helpers.js';

test('3.5.8 streaming backup parser matches JSON.parse for any chunking and stages each base64 module exactly once',async()=>{
function chunks(buf,size){const out=[];for(let i=0;i<buf.length;i+=size)out.push(buf.subarray(i,i+size));return out;}
async function parse(text,size){const buf=Buffer.from(text);const stream=new ReadableStream({start(c){for(const p of chunks(buf,size))c.enqueue(new Uint8Array(p));c.close();}});
 const staged=new Map();const body=await readBackupBody(stream,{stage:async(id,bytes)=>{staged.set(id,Buffer.from(bytes));return 'k:'+id;}});return {body,staged};}
const samples=['{}','[]','{"a":1}','{"a":[1,2,{"b":null}],"c":"x\\"y\\\\z\\u4e2d\\/","d":true,"e":false,"f":-1.5e3}','  {"__proto__":{"x":1}} ','"str"','123','{"k":"中文😀"}','﻿{"a":"b"}','{"a":"\\ud83d\\ude00"}'];
let n=0;
for(const s of samples)for(const size of [1,2,3,5,7,64,4096]){const r=await parse(s,size);const expected=JSON.parse(s.replace(/^﻿/,''));assert.deepEqual(r.body,expected,s+' '+size);if(s.includes('__proto__'))assert.equal(Object.getPrototypeOf(r.body),Object.prototype);n++;}
for(const s of ['{','{"a"}','{"a":}','[1,]','{"a":1,}','{} x','{"a":"\u0001"}','tru','{"a":01x}','']){for(const size of [1,3,64]){let threw=false;try{await parse(s,size);}catch(e){threw=true;}assert.ok(threw,'should fail: '+JSON.stringify(s)+' '+size);n++;}}
// random structures with base64 files
for(let round=0;round<200;round++){
 const files={};const raw={};
 for(let i=0;i<1+round%4;i++){const b=randomBytes(Math.floor(Math.random()*5000));raw['f'+i]=b;let c=b.toString('base64');if(round%3===0)c=c.replaceAll('/','\\/');files['f'+i]={filename:'f'+i+'.js',encoding:'base64',size:b.length,content:c};}
 files.t={filename:'t.js',encoding:'text',content:'var x="\\u4e2d/\\n"'};
 files.late={content:Buffer.from('late').toString('base64'),encoding:'base64'};
 const obj={format:7,files,meta:{modules:[{id:'f0',title:'标题"x'}],icons:{assets:[{content:'aGk='}]}}};
 let text=JSON.stringify(obj);if(round%3===0)text=text.replace(/"content":"([^"]*)"/g,(m,c)=>'"content":"'+c+'"');
 if(round%3===0){/* re-escape slashes for mac style */ for(const k of Object.keys(raw))text=text.replace(JSON.stringify(files[k].content),'"'+files[k].content+'"');}
 const size=1+Math.floor(Math.random()*300);
 const {body,staged}=await parse(text,size);
 for(const k of Object.keys(raw)){assert.equal(body.files[k].content,'');assert.deepEqual(staged.get(k),raw[k]);assert.equal(body.files[k].staged.size,raw[k].length);assert.equal(body.files[k].staged.key,'k:'+k);}
 assert.equal(body.files.t.content,files.t.content);assert.equal(body.files.t.staged,undefined);
 assert.equal(body.files.late.content,Buffer.from('late').toString('base64'));assert.equal(body.files.late.staged,undefined);
 const expectedNoContent=JSON.parse(text);for(const k of Object.keys(raw))expectedNoContent.files[k].content='';
 assert.deepEqual(JSON.parse(JSON.stringify(body)),expectedNoContent);n++;
}
// duplicate content: later wins
{const t='{"files":{"a":{"encoding":"base64","content":"aGk=","content":"cGxhaW4="}}}';for(const size of [1,4,100]){const {body,staged}=await parse(t,size);assert.equal(body.files.a.content,'');assert.equal(body.files.a.staged.size,5);assert.equal(staged.get('a').toString(),'plain');}n++;}
{const t='{"files":{"a":{"encoding":"base64","content":"aGk=","encoding":"text","content":"plain"}}}';for(const size of [1,4,100]){const {body}=await parse(t,size);assert.equal(body.files.a.content,'plain');assert.equal(body.files.a.staged,undefined);}n++;}
{const t='{"files":{"a":{"encoding":"base64","content":"cGw=","content":"aGk="}}}';const {body}=await parse(t,3);assert.equal(body.files.a.content,'');assert.equal(body.files.a.staged.size,2);n++;}
// bad base64
for(const c of ['a','ab=c','abc*','aGk=aGk=','====','aGk\\n']){const t='{"files":{"a":{"encoding":"base64","content":"'+c+'"}}}';let threw=false;try{await parse(t,2);}catch(e){threw=true;}assert.ok(threw,c);n++;}
assert.ok(n>300);

});

test('3.5.8 restore job streams modules into temporary storage and leaves no staged copies after success or failure',async t=>{
 const directory=temporary(t);const {server,base}=await listen({DATA_DIR:directory,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'});
 t.after(()=>close(server));const cookie=await login(base,'test-password');const call=(p,o={})=>api(base,p,{cookie,...o});
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const bytes=Buffer.concat([Buffer.from('REXENC\n'),randomBytes(300000)]);
 const make=(hash=sha(bytes))=>({format:7,files:{big:{filename:'big.js',encoding:'base64',size:bytes.length,hash,content:bytes.toString('base64').replaceAll('/','\\/')}},meta:{modules:[{id:'big',filename:'big.js',title:'Big',is_encrypted:1}],collections:[],shareAliases:[],names:[],filenameSettings:{auto_clean:true},icons:{sources:[],entries:[],assets:[]}}});
 const staged=()=>{const db=new DatabaseSync(join(directory,'rex.sqlite'));try{return db.prepare("SELECT COUNT(*) n FROM kv WHERE key LIKE 'restore-stage:%'").get().n;}finally{db.close();}};
 // Mac 风格（/ 写成 \/）的 JSON 文本，不经过 JSON.stringify 的转义。
 const text=b=>JSON.stringify(b).replaceAll('\\\\/','\\/');
 const ok=await call('/api/admin/backup/restore',{method:'POST',body:text(make()),headers:{'Content-Type':'application/json'}});
 assert.equal(ok.status,200,await ok.clone().text());assert.equal(sha(Buffer.from(await (await call('/api/modules/big.js')).arrayBuffer())),sha(bytes));
 assert.equal(staged(),0);
 const bad=await call('/api/admin/backup/restore',{method:'POST',body:text(make('0'.repeat(64))),headers:{'Content-Type':'application/json'}});
 assert.equal(bad.status,400);assert.match((await bad.json()).error,/摘要不匹配/);assert.equal(staged(),0);
 const broken=await call('/api/admin/backup/restore',{method:'POST',body:'{"format":7,"files":{"x":{"encoding":"base64","content":"aGk*"}}}',headers:{'Content-Type':'application/json'}});
 assert.equal(broken.status,400);assert.match((await broken.json()).error,/base64/);assert.equal(staged(),0);
 const notJson=await call('/api/admin/backup/restore',{method:'POST',body:'{"format":',headers:{'Content-Type':'application/json'}});
 assert.equal(notJson.status,400);assert.match((await notJson.json()).error,/JSON/);
});
