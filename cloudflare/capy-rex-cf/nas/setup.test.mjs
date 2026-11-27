import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createSetupServer,setupOrigin } from './setup.mjs';
import { listen,close,login } from '../test/helpers.js';

test('web setup: local origin, CSRF, confirmation, concurrent one-time init, persistent admin login',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'hub-setup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let completed=0;
  const origin='http://127.0.0.1:8080',s=createSetupServer(dir,{SETUP_ORIGIN:origin},()=>completed++);
  s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>new Promise(r=>s.close(r)));
  const base='http://127.0.0.1:'+s.address().port;
  const request=(path='/',options={})=>new Promise((resolve,reject)=>{
    const body=options.body?.toString();
    const req=httpRequest(base+path,{method:options.method||'GET',headers:{Host:new URL(origin).host,...(body?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}:{}),...options.headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(body);
  });
  const password=randomBytes(6).toString('base64url');
  const post=(values,headers={})=>request('/setup',{method:'POST',headers:{Origin:origin,...headers},body:new URLSearchParams(values)});
  assert.equal((await request()).status,200);
  assert.equal((await request('/',{headers:{Host:'evil.example'}})).status,403);
  assert.equal((await post({password,confirm:password},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post({password,confirm:password},{Origin:''})).status,403);
  assert.equal((await post({password,confirm:'wrong'})).status,400);
  assert.equal((await post({password:'short',confirm:'short'})).status,400);
  assert.equal((await post({password:'x'.repeat(9000),confirm:'x'})).status,413);
  const results=await Promise.all([post({password,confirm:password}),post({password,confirm:password})]);
  assert.equal(results.filter(r=>r.status===200).length,1);
  await Promise.all(results.map(r=>r.text()));assert.equal(completed,1);
  assert.equal((await post({password,confirm:password})).status,503);
  const {server,base:hub}=await listen({DATA_DIR:dir,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});
  try{assert.ok(await login(hub,password));assert.equal((await fetch(hub+'/setup',{method:'POST'})).status,404);}finally{await close(server);}
});
test('setup rejects public host and malformed origins',()=>{
  for(const origin of ['https://example.com','http://example.com','http://8.8.8.8:8080','http://127.0.0.1/path','http://user:pass@127.0.0.1'])assert.throws(()=>setupOrigin(origin));
  assert.equal(setupOrigin('http://192.168.1.10:8080'),'http://192.168.1.10:8080');
});
