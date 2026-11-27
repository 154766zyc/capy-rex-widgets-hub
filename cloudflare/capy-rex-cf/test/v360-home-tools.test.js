// 3.6.0：检查结果缓存与列表摘要、取消分享 / 换新链接、模块对照、本机模块换成 Hub 链接、装上 HTML 卡片。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {listen,close,temporary,api,login} from './helpers.js';
import {readHomeZip,isHomeUpload} from '../home-configs.js';
import {attachHtml} from '../home-tools.js';
import {CHECK_VERSION} from '../home-check.js';
import {zipEntries,homeEntries} from './fixtures/home-package.js';

const CF=process.env.REX_TEST_RUNTIME==='cf',root='/api/admin/home-configs';
const ok=async response=>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
async function start(t,dir=temporary(t)){
 const {server,base}=await listen({DATA_DIR:dir,ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'});
 let closed=false;t.after(async()=>{if(!closed)await close(server);});
 const cookie=await login(base,'test-password');
 const s={base,dir,call:(p,o={})=>api(base,p,{cookie,...o}),anon:(p,o={})=>api(base,p,o),async close(){closed=true;await close(server);}};
 s.ok=async(p,o)=>ok(await s.call(p,o));return s;
}
const item=(extra={})=>({style:'stack',count:0,gridSize:[2,1],id:'I'+Math.random().toString(16).slice(2),title:'项目',subtitle:'',iconUrl:'',functionId:'list',params:[],widgetBundleId:'',widgetId:'',widgetURL:'https://assets.rexnow.tv/scripts/rex-tmdb.js',name:'模块',...extra});
const card=(decl,body='')=>`<!doctype html><html><head><meta name="rex-widget" content="${decl}"></head><body>${body}</body></html>`;
const pkg=({version=1,layout,extra=[]})=>zipEntries(homeEntries({manifest:{version},layout,extra}));
async function uploadHome(s,bytes,name='home.rex'){const fd=new FormData();fd.append('file',new File([bytes],name));return (await ok(await s.call(root,{method:'POST',body:fd}))).home;}
async function uploadModule(s,name,code){
 const f=new File([code],name),fd=new FormData();fd.append('files',f);const p=await s.ok('/api/admin/modules/upload/preview',{method:'POST',body:fd});
 const c=new FormData();for(const [k,v] of Object.entries({job_id:p.job_id,index:'0',action:'new',target_id:'',mode:'temporary'}))c.append(k,v);c.append('file',f);
 return ok(await s.call('/api/admin/modules/upload/commit',{method:'POST',body:c}));
}
const homes=s=>s.ok(root);
const fileOf=async(s,id)=>readHomeZip(Buffer.from(await (await s.call(root+'/'+id+'/file')).arrayBuffer()));
const json=(entries,name)=>JSON.parse(entries.get(name).toString());

test('3.6.0 upload stores a check summary shown in the list; old rows without one say so and get it after 检查首页',{skip:CF&&'needs direct SQLite access'},async t=>{
 const s=await start(t),layout=[{id:'r',title:'推荐',isActive:true,items:[item({widgetURL:'file://AAAA.js',widgetId:'w.local'})]}];
 const home=await uploadHome(s,pkg({layout}));
 let row=(await homes(s))[0];assert.deepEqual(row.check,{check_version:CHECK_VERSION,version:1,html_cards:0,html_issues:0,scripts:0,warnings:1,local_items:1});assert.equal(home.check.local_items,1);
 assert.equal('check_json' in row,false);assert.equal('checked_hash' in row,false);
 // 模拟 3.6.0 的旧库：没有这三列，重启后自动补上。
 await s.close();const db=new DatabaseSync(join(s.dir,'rex.sqlite'));for(const c of ['check_json','check_summary','checked_hash'])db.exec('ALTER TABLE home_configs DROP COLUMN '+c);db.close();
 const again=await start(t,s.dir);row=(await homes(again))[0];assert.equal(row.check,null);assert.equal(row.revision,home.revision);
 const report=await again.ok(root+'/'+row.id+'/check');assert.equal(report.local_items,1);
 row=(await homes(again))[0];assert.equal(row.check.local_items,1);assert.equal(row.revision,home.revision,'检查不算编辑，revision 不变');
});

test('3.6.0 check results are cached by file hash and rule version',{skip:CF&&'needs direct SQLite access'},async t=>{
 const s=await start(t),home=await uploadHome(s,pkg({layout:[{id:'r',title:'r',items:[item()]}]}));await s.close();
 const db=new DatabaseSync(join(s.dir,'rex.sqlite')),cached=JSON.parse(db.prepare('SELECT check_json FROM home_configs').get().check_json);
 db.prepare('UPDATE home_configs SET check_json=?').run(JSON.stringify({...cached,warnings:['来自缓存']}));db.close();
 const again=await start(t,s.dir);assert.deepEqual((await again.ok(root+'/'+home.id+'/check')).warnings,['来自缓存']);await again.close();
 const db2=new DatabaseSync(join(s.dir,'rex.sqlite'));db2.prepare('UPDATE home_configs SET check_json=?').run(JSON.stringify({...cached,check_version:CHECK_VERSION-1,warnings:['旧规则']}));db2.close();
 const third=await start(t,s.dir);assert.deepEqual((await third.ok(root+'/'+home.id+'/check')).warnings,[],'规则版本变了要重算');
});

test('3.6.0 revoke and rotate share links; old links stop working, new ones work, revisions are enforced',async t=>{
 const s=await start(t),home=await uploadHome(s,pkg({layout:[{id:'r',title:'r',items:[item()]}]}));
 assert.equal((await s.call(root+'/'+home.id+'/share/rotate',{method:'POST',json:{revision:home.revision}})).status,400);
 assert.equal((await s.call(root+'/'+home.id+'/share/revoke',{method:'POST',json:{revision:home.revision}})).status,400);
 const first=await s.ok(root+'/'+home.id+'/share',{method:'POST',json:{revision:home.revision,accept_public:true}});assert.equal((await s.anon(first.path)).status,200);
 let row=(await homes(s))[0];assert.equal(row.shared,true);
 assert.equal((await s.call(root+'/'+home.id+'/share/rotate',{method:'POST',json:{revision:home.revision}})).status,409,'旧 revision 拒绝');
 const rotated=await s.ok(root+'/'+home.id+'/share/rotate',{method:'POST',json:{revision:row.revision}});assert.notEqual(rotated.path,first.path);
 assert.equal((await s.anon(first.path)).status,404);assert.equal((await s.anon(rotated.path)).status,200);
 row=(await homes(s))[0];assert.equal(row.share_path,rotated.path);
 await s.ok(root+'/'+home.id+'/share/revoke',{method:'POST',json:{revision:row.revision}});assert.equal((await s.anon(rotated.path)).status,404);
 row=(await homes(s))[0];assert.equal(row.shared,false);assert.equal(row.share_path,'');
 const fresh=await s.ok(root+'/'+home.id+'/share',{method:'POST',json:{revision:row.revision,accept_public:true}});assert.notEqual(fresh.path,rotated.path);assert.equal((await s.anon(fresh.path)).status,200);
 assert.equal((await s.anon(root+'/'+home.id+'/share/revoke',{method:'POST',json:{revision:row.revision}})).status,401);
});

test('3.6.0 module cross-reference and relink: local / bundled modules become Hub links; unmatched ones stay; scripts no longer used are dropped',async t=>{
 const s=await start(t);
 const a=await uploadModule(s,'a.js',"var WidgetMetadata={id:'w.a',title:'模块A',version:'1.2.0',modules:[]};");
 await uploadModule(s,'b.js',"var WidgetMetadata={id:'w.b',title:'模块B',version:'2.0.0',modules:[]};");
 const layout=[{id:'r1',title:'一',isActive:true,items:[item({widgetURL:'file://AAAA.js',widgetId:'w.a',name:'A'}),item({widgetURL:'file://CCCC.js',widgetId:'w.c',name:'C'})]},
  {id:'r2',title:'二',isActive:true,items:[item({widgetURL:'file:///b.js',widgetId:'w.b',name:'B'}),item({widgetURL:'',widgetId:'app',functionId:'watchProgress'})]}];
 const home=await uploadHome(s,pkg({version:2,layout,extra:[['rex-scripts/b.js',"var WidgetMetadata={id:'w.b'}"]]}));
 const report=await s.ok(root+'/'+home.id+'/check'),byId=Object.fromEntries(report.modules.map(m=>[m.widget_id,m]));
 assert.equal(byId['w.a'].kind,'local');assert.equal(byId['w.a'].relinkable,true);assert.equal(byId['w.a'].hub.version,'1.2.0');
 assert.equal(byId['w.b'].kind,'bundled');assert.equal(byId['w.b'].relinkable,true);assert.equal(byId['w.c'].hub,null);assert.equal(byId['w.c'].relinkable,false);
 assert.equal(byId['app'].kind,'builtin');
 // 只换 w.a：另存为新首页，原首页不动。
 const one=await s.ok(root+'/'+home.id+'/relink',{method:'POST',json:{revision:home.revision,widget_ids:['w.a']}});
 assert.equal(one.saved,'new');assert.equal(one.changed,1);assert.deepEqual(one.dropped_scripts,[]);assert.match(one.home.title,/（Hub 链接）$/);
 let entries=await fileOf(s,one.home.id),items=json(entries,'rex-layout.json').flatMap(r=>r.items);
 assert.match(items[0].widgetURL,new RegExp('^'+s.base.replace(/[.]/g,'\\.')+'/api/modules/'+a.module_id));assert.equal(items[1].widgetURL,'file://CCCC.js');assert.equal(items[2].widgetURL,'file:///b.js');
 assert.ok(entries.has('rex-scripts/b.js'));assert.equal(json(entries,'rex-manifest.json').version,2);assert.deepEqual([...entries.keys()].slice(0,3),['rex-manifest.json','rex-layout.json','rex-home.json']);
 assert.equal(json(await fileOf(s,home.id),'rex-layout.json')[0].items[0].widgetURL,'file://AAAA.js','原首页不变');
 // 全部能换的都换，覆盖当前首页：ID 和分享链接保留，不再用的内置脚本删掉。
 const share=await s.ok(root+'/'+home.id+'/share',{method:'POST',json:{revision:home.revision,accept_public:true}});
 let row=(await homes(s)).find(h=>h.id===home.id);
 const all=await s.ok(root+'/'+home.id+'/relink',{method:'POST',json:{revision:row.revision,save:'replace'}});
 assert.equal(all.saved,'replace');assert.equal(all.changed,2);assert.deepEqual(all.dropped_scripts,['b.js']);assert.deepEqual(all.skipped,[{widget_id:'w.c',items:1}]);
 entries=readHomeZip(Buffer.from(await (await s.anon(share.path)).arrayBuffer()));assert.equal(entries.has('rex-scripts/b.js'),false);
 items=json(entries,'rex-layout.json').flatMap(r=>r.items);assert.ok(items[2].widgetURL.startsWith(s.base+'/api/modules/'));
 const after=await s.ok(root+'/'+home.id+'/check');assert.equal(after.modules.find(m=>m.widget_id==='w.a').kind,'hub');
 row=(await homes(s)).find(h=>h.id===home.id);
 const nothing=await s.call(root+'/'+home.id+'/relink',{method:'POST',json:{revision:row.revision}});assert.equal(nothing.status,400);assert.match((await nothing.json()).error,/w\.c/);
 assert.equal((await s.call(root+'/'+home.id+'/relink',{method:'POST',json:{revision:'stale'}})).status,409);
 assert.equal((await s.call(root+'/'+home.id+'/relink',{method:'POST',json:{revision:row.revision,save:'other'}})).status,400);
});

test('3.6.0 attach an HTML card: style / gridSize follow the declaration, manifest becomes 2, rules from the official guide are enforced',async t=>{
 const s=await start(t);
 const layout=[{id:'r1',title:'方卡行',isActive:true,items:[item({title:'甲'}),item({title:'乙'})]},{id:'r2',title:'横滑行',isActive:true,items:[item({style:'fullWidthPoster',gridSize:[-1,2.3],title:'丙'})]}];
 const home=await uploadHome(s,pkg({layout}));
 const send=async(fields,file)=>{const fd=new FormData();for(const [k,v] of Object.entries(fields))fd.append(k,v);if(file)fd.append('file',file);return s.call(root+'/'+home.id+'/html',{method:'POST',body:fd});};
 const rev=async()=>(await homes(s)).find(h=>h.id===home.id).revision;
 const square=await ok(await send({revision:home.revision,section:'0',item:'1'},new File([card('type=card; width=x3; height=x2')],'推荐 卡.html')));
 assert.equal(square.saved,'new');assert.equal(square.style,'cover');assert.deepEqual(square.gridSize,[3,2]);assert.equal(square.filename,'推荐 卡.html');assert.equal(square.check.html_cards,1);
 let entries=await fileOf(s,square.home.id);assert.equal(json(entries,'rex-manifest.json').version,2);
 let target=json(entries,'rex-layout.json')[0].items[1];assert.equal(target.htmlTemplate,'推荐 卡.html');assert.ok(entries.get('rex-html/推荐 卡.html').toString().includes('x3'));
 // 横滑声明：这一行只有一个项目，可以；style 改成 fullWidthPoster，gridSize 宽 -1、保留原高度。
 const rail=await ok(await send({revision:await rev(),section:'1',item:'0',save:'replace'},new File([card('type=rail; height=420; item-ratio=2:3')],'rail.html')));
 assert.equal(rail.saved,'replace');assert.deepEqual(rail.gridSize,[-1,2.3]);assert.equal(rail.style,'fullWidthPoster');
 // 全宽 / 横滑放进有两个项目的行：拒绝。
 let bad=await send({revision:await rev(),section:'0',item:'0'},new File([card('type=full-width; height=420')],'x.html'));assert.equal(bad.status,400);assert.match((await bad.json()).error,/只有一个项目/);
 // 声明写错、太大、不是 html、位置不存在：拒绝。
 bad=await send({revision:await rev(),section:'0',item:'0'},new File([card('type=card; width=x9; height=x2')],'x.html'));assert.equal(bad.status,400);assert.match((await bad.json()).error,/x1～x4/);
 bad=await send({revision:await rev(),section:'0',item:'0'},new File([card('type=card; width=x2; height=x2','x'.repeat(33000))],'x.html'));assert.equal(bad.status,413);
 bad=await send({revision:await rev(),section:'0',item:'0'},new File(['x'],'x.txt'));assert.equal(bad.status,400);
 bad=await send({revision:await rev(),section:'5',item:'0'},new File([card('type=card; width=x2; height=x2')],'x.html'));assert.equal(bad.status,400);assert.match((await bad.json()).error,/找不到/);
 bad=await send({revision:'stale',section:'0',item:'0'},new File([card('type=card; width=x2; height=x2')],'x.html'));assert.equal(bad.status,409);
 // 同一行再放一张不同档位的方卡：拒绝；同档位：可以，文件名不冲突。
 entries=await fileOf(s,home.id);
 const second=attachHtml(entries,{section:1,item:0,html:card('type=rail; height=300; item-ratio=3:2'),filename:'rail.html'});assert.equal(second.filename,'rail.html','替换同一个项目时沿用原文件名');
 const withSquare=readHomeZip(attachHtml(entries,{section:0,item:0,html:card('type=card; width=x2; height=x2'),filename:'rail.html'}).bytes);
 assert.equal(json(withSquare,'rex-layout.json')[0].items[0].htmlTemplate,'rail-2.html','和别的项目的文件重名时自动加序号');
 assert.throws(()=>attachHtml(withSquare,{section:0,item:1,html:card('type=card; width=x3; height=x2'),filename:'b.html'}),/相同的宽高档位/);
 // 去掉 HTML 卡片：htmlTemplate 删掉，没人用的文件也删掉。
 const removed=await ok(await send({revision:await rev(),section:'1',item:'0',remove:'true',save:'replace'}));
 entries=await fileOf(s,home.id);assert.equal('htmlTemplate' in json(entries,'rex-layout.json')[1].items[0],false);assert.equal(entries.has('rex-html/rail.html'),false);assert.equal(removed.saved,'replace');
 assert.equal((await send({revision:await rev(),section:'1',item:'0',remove:'true'})).status,400);
});

test('3.6.0 only uploads, replacements and HTML cards accept large bodies',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 for(const [p,m] of [[root,'POST'],[root+'/'+id,'PUT'],[root+'/'+id+'/html','POST']])assert.equal(isHomeUpload(p,m),true,p);
 for(const [p,m] of [[root+'/'+id+'/share','POST'],[root+'/'+id+'/share/revoke','POST'],[root+'/'+id+'/share/rotate','POST'],[root+'/'+id+'/relink','POST'],[root+'/'+id,'PATCH'],[root+'/'+id,'DELETE'],[root,'GET'],[root+'/x/html','POST']])assert.equal(isHomeUpload(p,m),false,p);
});

test('V1.1 branding is independent from retained upstream CF version',async()=>{
 const {readFileSync}=await import('node:fs'),info=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')),pkg=info.version;
 const single=JSON.parse(readFileSync(new URL('../single-file/package.json',import.meta.url),'utf8')).version;
 const cf=readFileSync(new URL('../cf/hub.js',import.meta.url),'utf8').match(/CF_VERSION = '([^']+)'/)[1];
 const worker=readFileSync(new URL('../worker.js',import.meta.url),'utf8').match(/Capy\/Rex Widgets Hub · (V[0-9.]+)/)[1];
 const toml=readFileSync(new URL('../single-file/wrangler.toml',import.meta.url),'utf8').match(/Rex Widgets Hub ([0-9.]+)/)[1];
 // The NAS release advances independently; retained Cloudflare references keep their upstream version.
 assert.equal(worker,'V1.4'); assert.equal(pkg,'1.4.0'); assert.equal(info.name,'capy-rex'); assert.equal(info.author,'芜湖');
 assert.deepEqual([single,cf,toml],Array(3).fill(info.upstreamVersion||pkg));
});

test('3.6.0 only problems Rex always rejects block attaching; hints such as external links do not',async()=>{
 const {checkHtml}=await import('../home-check.js');
 const hint=checkHtml(card('type=card; width=x2; height=x2','<img src="https://x.example/a.png">'));assert.equal(hint.issues.length,1);assert.deepEqual(hint.blocking,[]);
 assert.equal(checkHtml(card('type=card; width=x2; height=x2','\u0000')).blocking.length,1);
 assert.equal(checkHtml('<p>no declaration</p>').blocking.length,1);
 const entries=readHomeZip(pkg({layout:[{id:'r',title:'r',items:[item()]}]}));
 assert.equal(attachHtml(entries,{section:0,item:0,html:card('type=card; width=x2; height=x2','<img src="https://x.example/a.png">'),filename:'a.html'}).style,'cover');
 assert.throws(()=>attachHtml(entries,{section:0,item:0,html:card('type=card; width=x2; height=x2','\u0000'),filename:'a.html'}),/NUL/);
});
