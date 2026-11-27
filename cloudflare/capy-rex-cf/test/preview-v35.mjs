// Isolated synthetic UI fixture. No NAS, real subscriptions or user data.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createHubServer} from '../server.js';
const directory=mkdtempSync(join(tmpdir(),'rex-v35-ui-'));
const server=await createHubServer({DATA_DIR:directory,ADMIN_SECRET:'local-preview-only',DISABLE_SCHEDULER:'true'},
 {remoteFetch:async raw=>{
  const path=new URL(raw).pathname;
  if(path.endsWith('.rex'))return Response.json({title:'影像合集 · 示例订阅',widgets:[
   {id:'anime',title:'动漫聚合',url:'https://source.example/anime.js'},
   {id:'movie',title:'影视聚合',url:'https://source.example/movie.js'},
   {id:'encrypted',title:'加密测试模块',version:'1.3.2',url:'https://source.example/encrypted.js'},
   {id:'missing',title:'暂时下载失败的模块',url:'https://source.example/missing.js'}]});
  if(path.endsWith('missing.js'))return new Response('temporarily unavailable',{status:503});
  if(path.endsWith('encrypted.js'))return new Response(Buffer.from('REXENC\nsynthetic-preview-only-encrypted-bytes'));
  const name=path.includes('anime')?'动漫聚合 · 番剧与动画':path.includes('movie')?'影视聚合 · 长标题换行与分组展示测试':'音乐源 · 单模块订阅';
  const id=path.includes('duplicate')?'/anime.js':path;
  return new Response(`var WidgetMetadata={id:'${id}',title:'${name}',author:'UI测试',version:'1.2.0'};function play(){}`);
 }});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const auth=await fetch(base+'/api/admin/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'local-preview-only'})});
const cookie=auth.headers.get('set-cookie').split(';')[0];
async function api(path,body,method='POST'){
 const r=await fetch(base+path,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 const result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));return result;
}
const groups=[];for(const name of ['影视','动漫','音乐','字幕','短剧与漫剧','这是一个很长的分组名称，用来验证换行布局'])groups.push(await api('/api/admin/groups',{name}));
const s=(await api('/api/admin/modules/import',{url:'https://source.example/collection.rex'})).subscription;
while(!(await api('/api/admin/subscriptions/'+s.id+'/sync',{})).done){}
await api('/api/admin/modules/import',{url:'https://source.example/standalone.js'});
const uploadForm=new FormData();uploadForm.append('files',new File(["var WidgetMetadata={id:'local-subtitle',title:'本地上传 · 字幕助手',version:'2.1.3'};function play(){}"],'subtitle.js'));
const uploadResponse=await fetch(base+'/api/admin/modules',{method:'POST',headers:{cookie},body:uploadForm});
if(!uploadResponse.ok)throw Error(await uploadResponse.text());
const modules=await api('/api/admin/modules',null,'GET');
const anime=modules.find(m=>m.source_url?.endsWith('/anime.js')),movie=modules.find(m=>m.source_url?.endsWith('/movie.js')),standalone=modules.find(m=>m.source_url?.endsWith('/standalone.js')),local=modules.find(m=>!m.source_url);
const c=await api('/api/admin/collections',{title:'我的精选',slug:'uidemo',moduleIds:[movie.id,anime.id]});
await api('/api/admin/collections',{title:'影视片单',slug:'uidemo2',moduleIds:[movie.id]});
await api('/api/admin/modules/bulk',{action:'group',ids:[movie.id],groupId:groups[0].id});
await api('/api/admin/modules/bulk',{action:'group',ids:[anime.id],groupId:groups[1].id});
await api('/api/admin/modules/bulk',{action:'group',ids:[standalone.id],groupId:groups[2].id});
await api('/api/admin/modules/bulk',{action:'group',ids:[local.id],groupId:groups.at(-1).id});
await api('/api/admin/auto-rules',{auto:false,rules:[{kw:'动漫,动画',fields:['title','filename'],group:groups[1].id,cols:[c.id]}]},'PUT');
console.log('Synthetic preview ready:',base);
async function stop(){server.close();await server.hubClosed;rmSync(directory,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
