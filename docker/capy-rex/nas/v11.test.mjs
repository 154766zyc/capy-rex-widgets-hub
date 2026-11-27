import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request} from 'node:http';
import {initialize} from './init.mjs';
import {temporary,listen,close} from '../test/helpers.js';
const secret=()=>randomBytes(6).toString('base64url');
const primary='https://capy.example',alias='https://alias.example',lan='http://192.0.2.10:8080';
test('V1.1 real HTTP: explicit origins, eight-character credentials, routes, CSP and roles',async t=>{
 const dir=temporary(t),adminPassword=secret();assert.equal(adminPassword.length,8);
 await assert.rejects(()=>initialize(dir,secret().slice(0,7)),/8/);
 await initialize(dir,adminPassword);
 const {server,base}=await listen({DATA_DIR:dir,NAS_MODE:'true',DISABLE_SCHEDULER:'true',PUBLIC_URL:primary,ALLOWED_ORIGINS:alias+','+lan});
 t.after(()=>close(server));
 function call(path,{origin=primary,host=new URL(origin).host,method='GET',json,cookie,headers={}}={}){
  return new Promise((resolve,reject)=>{
   const body=json===undefined?null:JSON.stringify(json);
   const r=request(base+path,{method,headers:{Host:host,Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...headers}},res=>{const chunks=[];res.on('data',v=>chunks.push(v));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});r.on('error',reject);r.end(body);
  });
 }
 const post=(path,json,options={})=>call(path,{method:'POST',json,...options});
 let admin,dev,devId;const devPassword=secret();
 await t.test('old entrances redirect and public page excludes workspace at render time',async()=>{
  for(const p of ['/','/index.html','/community','/community/']){const r=await call(p);assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/user');}
  const user=await call('/user');assert.equal(user.status,200);assert.match(await user.text(),/data-view="public"/);assert.match(user.headers.get('content-security-policy'),/img-src 'self'/);
  const page=await call('/admin');assert.match(await page.text(),/data-view="workspace"/);assert.doesNotMatch(page.headers.get('content-security-policy'),/sandbox/);
  assert.equal((await call('/admin/manage')).headers.get('location'),'/admin');
  for(const [path,type] of [['/user/app.js','text/javascript'],['/user/style.css','text/css'],['/community/app.js','text/javascript'],['/app-icons/capy-v1-48.png','image/png'],['/app-icons/rex-mulberry-v1-192.png','image/png']]){const r=await call(path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(type));}
 });
 await t.test('HTTPS admin login accepts only matching configured origin; LAN remains usable',async()=>{
  for(const origin of [primary,alias,lan]){const r=await post('/api/admin/auth',{password:adminPassword},{origin});assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly/);assert.equal(c.includes('; Secure'),origin.startsWith('https:'));admin=c.split(';')[0];}
  assert.equal((await post('/api/admin/auth',{password:adminPassword},{origin:'https://evil.example',host:'capy.example'})).status,403);
  assert.equal((await post('/api/admin/auth',{password:adminPassword},{origin:alias,host:'capy.example'})).status,403);
  assert.equal((await post('/api/admin/auth',{}, {host:'evil.example',headers:{'X-Forwarded-Host':'capy.example','X-Forwarded-Proto':'https'}})).status,421);
  assert.equal((await post('/api/admin/auth',{}, {headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const ui=await call('/admin/manage',{cookie:admin});assert.equal(ui.status,200);assert.doesNotMatch(ui.headers.get('content-security-policy'),/sandbox/);assert.match(await ui.text(),/Widgets Hub · V1.4/);
 });
 await t.test('developer create, reset, own password and administrator password enforce 8–256',async()=>{
  assert.equal((await post('/api/community/users',{username:'short',password:secret().slice(0,7)},{cookie:admin})).status,400);
  const created=await post('/api/community/users',{username:'testdev',password:devPassword},{cookie:admin});assert.equal(created.status,201);devId=(await created.json()).id;
  const login=await post('/api/community/login',{username:'testdev',password:devPassword});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);dev=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/community/users',{cookie:dev})).status,403);
  assert.equal((await call('/api/admin/modules',{cookie:dev})).status,401);
  assert.equal((await call('/admin/manage',{cookie:dev})).status,303);
  assert.equal((await post('/api/community/password',{current:devPassword,password:secret().slice(0,7)},{cookie:dev})).status,400);
  const next=secret();assert.equal((await post('/api/community/password',{current:devPassword,password:next},{cookie:dev})).status,200);
  assert.equal((await call('/api/community/mine',{cookie:dev})).status,401);
  assert.equal((await post('/api/community/login',{username:'testdev',password:next})).status,200);
  assert.equal((await call('/api/community/users/'+devId,{method:'PATCH',cookie:admin,json:{password:secret().slice(0,7)}})).status,400);
  assert.equal((await call('/api/community/users/'+devId,{method:'PATCH',cookie:admin,json:{password:secret()}})).status,200);
  assert.equal((await post('/api/admin/change-password',{password:secret().slice(0,7)},{cookie:admin})).status,400);
  const newAdmin=secret();assert.equal((await post('/api/community/admin-account',{username:'管理员',current:adminPassword,password:newAdmin},{cookie:admin})).status,200);
  assert.equal((await post('/api/admin/auth',{username:'管理员',password:newAdmin})).status,200);
 });
});
