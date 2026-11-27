// Run only against isolated local Wrangler storage. Never accepts a remote host.
import assert from 'node:assert/strict';
const base='http://localhost:8790';
const auth=await fetch(base+'/api/admin/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'local-management-test'})});
assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
async function call(path,method='GET',body,expected=200){
 const form=body instanceof FormData,r=await fetch(base+path,{method,headers:{cookie,...(body&&!form?{'content-type':'application/json'}:{})},body:body?(form?body:JSON.stringify(body)):undefined});
 const out=await r.json();assert.equal(r.status,expected,JSON.stringify(out));return out;
}
const existing=await call('/api/admin/modules');assert.equal(existing.length,0,'Use a fresh local persistence directory');
const priorGroups=await call('/api/admin/groups');
const groups=[];for(const name of ['常用','其他'])groups.push(priorGroups.find(g=>g.name===name)||await call('/api/admin/groups','POST',{name}));
const names=['Alpha (4K)','Beta','Gamma Subtitle','Delta 超长模块标题用于检查手机布局与省略显示','Encrypted'];
const fd=new FormData();names.forEach((title,i)=>fd.append('files',new File([i===4?'REXENC\nlocal-only-ciphertext':`var WidgetMetadata={id:'manage-test-${i}',title:${JSON.stringify(title)},version:'1.0.0'};`],'local-'+i+'.js')));
const preview=await call('/api/admin/modules/upload/preview','POST',fd),ids=[];
for(const row of preview.rows){const upload=new FormData();upload.append('job_id',preview.job_id);upload.append('index',row.index);upload.append('action','new');upload.append('file',fd.getAll('files')[row.index]);ids.push((await call('/api/admin/modules/upload/commit','POST',upload)).module_id);}
const empty=await call('/api/admin/collections','POST',{title:'空合集',slug:'empty'},201);
const one=await call('/api/admin/collections','POST',{title:'11122',slug:'one',moduleIds:[ids[0]]},201);
const many=await call('/api/admin/collections','POST',{title:'常用影音',slug:'many',description:'本地集成测试，不是正式模块',moduleIds:ids},201);
let r=await call('/api/admin/modules/bulk','POST',{action:'group',ids:[ids[0],ids[1],'absent'],groupId:groups[0].id});assert.deepEqual(r.results.map(x=>x.ok),[true,true,false]);
await call('/api/admin/modules/bulk','POST',{action:'append',ids:[ids[1],ids[0]],collectionId:one.id});
await call('/api/admin/modules/bulk','POST',{action:'append',ids:[ids[1],ids[0]],collectionId:one.id});
let cols=await call('/api/admin/collections');assert.deepEqual(cols.find(c=>c.id===one.id).moduleIds,[ids[0],ids[1]]);
await call('/api/admin/collections/'+one.id+'/members','PUT',{moduleIds:[ids[1],ids[0]],expectedModuleIds:[ids[0],ids[1]]});
await call('/api/admin/collections/'+one.id+'/members','PUT',{moduleIds:[],expectedModuleIds:[ids[0]]},409);
await call('/api/admin/collections/'+one.id+'/members','PUT',{moduleIds:[ids[0]],expectedModuleIds:[ids[1],ids[0]]});
assert.equal((await call('/api/collections/many.rex')).widgets[0].title,names[0]);
// Temporary extra upload checks single/bulk deletion and public-pointer cleanup.
const tmp=new FormData();tmp.append('files',new File(["var WidgetMetadata={id:'delete-test',title:'Delete test'};"],'delete-test.js'));
const p=await call('/api/admin/modules/upload/preview','POST',tmp);tmp.append('job_id',p.job_id);tmp.append('index','0');tmp.append('action','new');tmp.append('file',tmp.get('files'));
const tid=(await call('/api/admin/modules/upload/commit','POST',tmp)).module_id;
await call('/api/admin/modules/bulk','POST',{action:'append',ids:[tid],collectionId:empty.id});
await call('/api/admin/modules/bulk','POST',{action:'delete',ids:[tid]});
await call('/api/modules/'+tid+'.js','GET',undefined,404);
assert.deepEqual((await call('/api/admin/collections')).find(c=>c.id===empty.id).moduleIds,[]);
console.log(JSON.stringify({ok:true,modules:ids,groups,collections:{empty:empty.id,one:one.id,many:many.id}}));
