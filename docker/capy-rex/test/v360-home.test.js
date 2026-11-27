// 3.6.0：适配 Rex 1.2 的 HTML 首页卡片（home-package version 2、rex-html/、内联 htmlTemplate）和首页检查报告。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {listen,close,temporary,api,login} from './helpers.js';
import {parseHomePackage,HOME_LIMITS} from '../home-configs.js';
import {checkHtml,parseDeclaration,HTML_LIMIT} from '../home-check.js';
import {homeUI} from '../home-ui.js';
import {zipEntries,homeEntries} from './fixtures/home-package.js';

const card=(decl='type=card; width=x2; height=x2',body='')=>`<!doctype html><html><head><meta name="rex-widget" content="${decl}"></head><body><div id="t"></div>${body}<script>RexWidget.onContentChanged(function(){});</script></body></html>`;
const item=(extra={})=>({style:'cover',count:0,gridSize:[2,2],id:'I1',title:'卡片',subtitle:'',iconUrl:'',functionId:'trending',params:[],widgetBundleId:'rex.tmdb',widgetId:'rex.tmdb',widgetURL:'https://assets.rexnow.tv/scripts/rex-tmdb.js',name:'Rex TMDB',...extra});
const pkg=({version=2,items=[item({htmlTemplate:'my-card.html'})],extra=[['rex-html/my-card.html',card()]]}={})=>zipEntries(homeEntries({manifest:{version},layout:[{id:'r1',title:'推荐',isActive:true,items}],extra}));

test('3.6.0 parses version 2 packages with rex-html files, inline templates and bundled scripts',()=>{
 const parsed=parseHomePackage(pkg());assert.equal(parsed.check.version,2);assert.equal(parsed.check.html_cards.length,1);
 const c=parsed.check.html_cards[0];assert.equal(c.source,'file');assert.equal(c.name,'my-card.html');assert.deepEqual(c.issues,[]);assert.equal(c.declaration.type,'card');assert.deepEqual(parsed.check.warnings,[]);
 assert.match(parsed.check.note,/不包含 Worker/);
 // Rex 1.2 备份里的写法：整段 HTML 写在 htmlTemplate 里，带 htmlTemplateSource。
 const inline=parseHomePackage(pkg({items:[item({style:'fullWidthPoster',gridSize:[-1,2.3],htmlTemplate:card('type=rail; height=288; item-ratio=9:8'),htmlTemplateSource:{version:1,id:'makka01'}})],extra:[]}));
 assert.equal(inline.check.html_cards[0].source,'inline');assert.equal(inline.check.html_cards[0].template_id,'makka01');assert.deepEqual(inline.check.html_cards[0].issues,[]);
 // version 1 仍然能用；带 HTML 卡片时提示改成 2。
 const v1=parseHomePackage(pkg({version:1}));assert.match(v1.check.warnings.join(),/version 是 1/);
 assert.throws(()=>parseHomePackage(pkg({version:3})),/version 1 或 2/);
 // 内置脚本：加密 / 明文、明文里用到的域名、file:/// 对得上。
 const scripts=parseHomePackage(pkg({items:[item({widgetURL:'file:///a.js'}),item({id:'I2',widgetURL:'file:///b.js'})],extra:[['rex-scripts/a.js',"var WidgetMetadata={};Widget.http.get('https://api.example.com/x');Widget.http.get('https://w.example.workers.dev/p')"],['rex-scripts/b.js',Buffer.concat([Buffer.from('REXENC\n'),Buffer.alloc(40,1)])]]}));
 const byName=Object.fromEntries(scripts.check.scripts.map(x=>[x.name,x]));assert.equal(byName['a.js'].encrypted,false);assert.deepEqual(byName['a.js'].hosts,['api.example.com','w.example.workers.dev']);assert.equal(byName['b.js'].encrypted,true);assert.deepEqual(byName['b.js'].hosts,[]);
 assert.deepEqual(scripts.check.warnings,[]);
});

test('3.6.0 rejects layouts that point at missing or unsafe HTML files, and reports everything else as hints',()=>{
 assert.throws(()=>parseHomePackage(pkg({extra:[]})),/rex-html\/my-card\.html 不在首页包里/);
 assert.throws(()=>parseHomePackage(pkg({items:[item({htmlTemplate:'../x.html'})],extra:[]})),/不安全/);
 assert.throws(()=>parseHomePackage(pkg({items:[item({htmlTemplate:''})],extra:[]})),/htmlTemplate 无效/);
 const big=parseHomePackage(pkg({extra:[['rex-html/my-card.html',card('type=card; width=x2; height=x2','<p>'+'x'.repeat(HTML_LIMIT)+'</p>')],['rex-html/unused.html',card()]]}));
 assert.match(big.check.html_cards[0].issues.join(),/32,768/);assert.match(big.check.warnings.join(),/没有被布局引用：unused\.html/);
 const wrong=parseHomePackage(pkg({items:[item({style:'stack',htmlTemplate:'my-card.html'})],extra:[['rex-html/my-card.html',card('type=card; width=x5; height=x2','<img src="https://x.example/a.png"><script>fetch("/a")</script>')]]}));
 const issues=wrong.check.html_cards[0].issues.join('|');assert.match(issues,/x1～x4/);assert.match(issues,/外部/);assert.match(issues,/网络请求/);assert.match(issues,/style "cover"/);
 const local=parseHomePackage(pkg({items:[item({widgetURL:'file://AAAA.js'}),item({id:'I2',widgetURL:'file:///gone.js'}),{title:'缺字段'}],extra:[]}));
 const w=local.check.warnings.join('|');assert.match(w,/本机模块/);assert.match(w,/rex-scripts\/ 里没有：.*gone\.js/);assert.match(w,/缺少必需字段/);assert.equal(local.check.local_items,1);
});

test('3.6.0 declaration and HTML checks follow the official limits',()=>{
 assert.deepEqual(parseDeclaration('type=card; width=x3; height=x2; background=glass').issues,[]);
 assert.deepEqual(parseDeclaration('type=full-width; height=420').issues,[]);assert.match(parseDeclaration('type=full-width; height=40').issues.join(),/96～960/);
 assert.deepEqual(parseDeclaration('type=rail; height=144; item-ratio=5:2').issues,[]);assert.match(parseDeclaration('type=rail; height=144; item-ratio=4:1').issues.join(),/1:3～3:1/);
 assert.match(parseDeclaration('type=card; width=x2; height=x2; background=wood').issues.join(),/glass/);assert.match(parseDeclaration('').issues.join(),/缺少 type/);
 assert.match(checkHtml('<html></html>').issues.join(),/缺少/);assert.match(checkHtml(card()+card()).issues.join(),/重复/);assert.deepEqual(checkHtml(card()).issues,[]);
});

test('3.6.0 allows more than 32 entries within the same size limits',()=>{
 assert.equal(HOME_LIMITS.entries,256);
 const extra=Array.from({length:40},(_,i)=>['rex-html/c'+i+'.html',card()]),items=extra.map((_,i)=>item({id:'I'+i,htmlTemplate:'c'+i+'.html'}));
 assert.equal(parseHomePackage(pkg({items,extra})).check.html_cards.length,40);
});

test('3.6.0 upload returns a check summary and the check endpoint returns the full report',async t=>{
 const {server,base}=await listen({DATA_DIR:temporary(t),ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'});t.after(()=>close(server));
 const cookie=await login(base,'test-password'),root='/api/admin/home-configs';
 const fd=new FormData();fd.append('file',new File([pkg({items:[item({htmlTemplate:'my-card.html'}),item({id:'I2',widgetURL:'file://B.js'})]})],'html.rex'));
 const r=await api(base,root,{cookie,method:'POST',body:fd}),body=await r.json();assert.equal(r.status,201,JSON.stringify(body));
 assert.deepEqual(body.check,{version:2,html_cards:1,html_issues:0,scripts:0,warnings:1});
 const report=await (await api(base,root+'/'+body.home.id+'/check',{cookie})).json();assert.equal(report.ok,true);assert.equal(report.html_cards[0].name,'my-card.html');assert.equal(report.local_items,1);assert.ok(report.links.some(x=>x.host==='assets.rexnow.tv'));
 assert.equal((await api(base,root+'/'+body.home.id+'/check')).status,401);
 const bad=new FormData();bad.append('file',new File([pkg({extra:[]})],'bad.rex'));const no=await api(base,root,{cookie,method:'POST',body:bad});assert.equal(no.status,400);assert.match((await no.json()).error,/不在首页包里/);
});

test('3.6.0 home menu offers 检查首页 and renders the report as escaped text',async()=>{
 assert.match(homeUI,/'检查首页'/);assert.match(homeUI,/class="home-check"/);assert.match(homeUI,/var text=checkLines\(r\)/);assert.match(homeUI,/esc\(text\)/);assert.match(homeUI,/esc\(home\.title\),'<pre/);
 new vm.Script(homeUI);
});

test('3.6.0 shapes seen in a real Rex 1.2.1 backup: rail card with a pixel gridSize and no htmlTemplateSource, portraitImage rows',()=>{
 // 实际备份里：横滑卡 gridSize 写成 [-1, 420]（直接写高度）、没有 htmlTemplateSource；还有新样式 portraitImage。都不能误报。
 const rail=item({style:'fullWidthPoster',gridSize:[-1,420],htmlTemplate:card('type=rail; height=420; item-ratio=2:3')});
 const portrait=item({id:'I2',style:'portraitImage',gridSize:[2,3]});
 const parsed=parseHomePackage(pkg({items:[rail,portrait],extra:[]}));
 const c=parsed.check.html_cards[0];
 assert.equal(c.source,'inline');assert.equal(c.template_id||'','');assert.deepEqual(c.issues,[]);
 assert.deepEqual(parsed.check.warnings,[]);
 // 同一张卡被几行共用（同一个 htmlTemplateSource id）也照常通过。
 const shared=[1,2,3].map(i=>item({id:'S'+i,style:'fullWidthPoster',gridSize:[-1,2.3],htmlTemplate:card('type=rail; height=190; item-ratio=11:20'),htmlTemplateSource:{id:'shared06',version:1}}));
 const many=parseHomePackage(pkg({items:shared,extra:[]}));
 assert.equal(many.check.html_cards.length,3);assert.ok(many.check.html_cards.every(x=>x.issues.length===0&&x.template_id==='shared06'&&x.template_version===1));
 assert.ok(homeUI.includes('行共用'),'report shows how many rows share a template');
});
