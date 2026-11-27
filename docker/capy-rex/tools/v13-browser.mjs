import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {initialize} from '../nas/init.mjs';
import {createHubServer} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const output=process.env.EVIDENCE_DIR||'验证证据/V1.3';mkdirSync(output,{recursive:true});
const dir=mkdtempSync(join(tmpdir(),'hub-v13-browser-')),password=randomBytes(32).toString('base64url');
await initialize(dir,password);
const server=await createHubServer({DATA_DIR:dir,NAS_MODE:'true',DISABLE_SCHEDULER:'true'});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const auth=await fetch(base+'/api/admin/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
for(const [platform,title,author]of [['capy','电影资料库','作者甲'],['capy','每日精选','作者乙'],['rex','Rex 测试片单','作者甲']]){const body=new FormData();const code=platform==='capy'?`var WidgetMetadata={id:${JSON.stringify(title)},title:${JSON.stringify(title)},modules:[{title:"List",functionName:"list"}]};async function list(){return [];}`:`REXENC\n${JSON.stringify({v:2,mkv:'rex-1',alg:'A256GCM',iv:randomBytes(12).toString('base64'),kb:randomBytes(60).toString('base64')})}\n${randomBytes(32).toString('base64')}`;body.set('file',new File([code],platform+'-'+author+'-example.js'));body.set('platform',platform);body.set('title',title);body.set('author_group',author);const r=await fetch(base+'/api/community/publish',{method:'POST',headers:{Cookie:cookie},body});assert.equal(r.status,201,await r.text());}
let browser;const errors=[],report={};
function memory(){const rows=execFileSync('ps',['-eo','pid=,ppid=,rss=,args='],{encoding:'utf8'}).trim().split('\n').map(l=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);return m&&{pid:+m[1],ppid:+m[2],rss:+m[3],cmd:m[4]};}).filter(Boolean);const roots=rows.filter(r=>r.cmd.startsWith(process.env.CHROMIUM_PATH)&&r.cmd.includes('--remote-debugging-pipe')).map(r=>r.pid);const ids=new Set(roots);for(let n=0;n<8;n++)for(const r of rows)if(ids.has(r.ppid))ids.add(r.pid);let pss=0,coverage=0;for(const id of ids)try{pss+=Number(readFileSync('/proc/'+id+'/smaps_rollup','utf8').match(/^Pss:\s+(\d+)/m)[1]);coverage++;}catch{}return {processes:ids.size,rssMiB:Math.round(rows.filter(r=>ids.has(r.pid)).reduce((s,r)=>s+r.rss,0)/1024),pssMiB:Math.round(pss/1024),pssReadableProcesses:coverage,scope:'temporary sandboxed headless Chromium process tree; no desktop streaming service'};}
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,chromiumSandbox:true,timeout:20000});report.browser=await browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));report.idleMemory=memory();
 await page.goto(base+'/user');await page.locator('#catalog .card').nth(2).waitFor();
 await page.locator('#search').fill('电影');assert.equal(await page.locator('#catalog .card').count(),1);
 await page.locator('#search').fill('作者甲');assert.equal(await page.locator('#catalog .card').count(),2);
 await page.locator('[data-platform="capy"]').click();assert.equal(await page.locator('#catalog .card').count(),1);
 await page.locator('#clearSearch').click();await page.locator('#authorFilter').selectOption('作者乙');assert.equal(await page.locator('#catalog .card').count(),1);
 await page.locator('#clearSearch').click();report.searchAndFilters=true;
 const capy=page.locator('a.install-link[href^="com.feifeiduck"]');const href=await capy.first().getAttribute('href');const raw=Buffer.from(new URL(href).searchParams.get('data'),'base64url').toString();assert.match(href,/^com\.feifeiduck\.capyplayer:\/\/add-widget\?data=/);assert.match(raw,/\/raw\/[\w-]+\.js$/);assert.equal(await page.locator('a.install-link[href^="https://rexnow.tv"] img').count(),1);report.installHref={scheme:new URL(href).protocol,rawPath:new URL(raw).pathname,decodedMatches:true};
 await page.screenshot({path:join(output,'staging-public-desktop.png'),fullPage:true});
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#catalog .card').first().getByRole('button',{name:'复制公开链接'}).click();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/^http:\/\/127\.0\.0\.1:\d+\/(raw|api\/modules)\/[\w-]+\.js$/);report.clipboardHTTPSorOriginRaw=true;
 await page.goto(base+'/admin');await page.locator('#login').waitFor({state:'visible'});await page.selectOption('#login select','admin');await page.fill('#login input[name=password]',password);await page.locator('#login button').click();await page.locator('#developer').waitFor({state:'visible'});await page.screenshot({path:join(output,'staging-admin-workspace.png'),fullPage:true});
 await page.goto(base+'/admin/manage');await page.locator('#modulesList .row').first().waitFor();await page.screenshot({path:join(output,'staging-admin-manage.png'),fullPage:true});report.adminRendered=true;const editorId=await page.locator('#modulesList .row[data-mid]').first().getAttribute('data-mid');await page.evaluate(id=>openEditor(id),editorId);await page.locator('#editorOverlay').waitFor({state:'visible'});assert.equal(await page.locator('#edTitle img').count(),1);assert.match(await page.locator('#edCheckerEntry').innerText(),/测试前请勿加密/);await page.screenshot({path:join(output,'staging-admin-editor.png'),fullPage:true});await page.evaluate(()=>closeEditor(true));report.editorIconAndChecker=true;
 await page.goto(base+'/checker');const code='var WidgetMetadata={title:"Fixture",modules:[{title:"List",functionName:"list"}]};async function list(){return [];} while(true){}; throw Error("must never run");';await page.fill('#code',code);await page.click('#check');await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('"ok": true'));report.staticNoExecution=true;
 await page.screenshot({path:join(output,'staging-checker-desktop.png'),fullPage:true});
 await page.reload();await page.setInputFiles('#file',{name:'invalid.js',mimeType:'text/javascript',buffer:Buffer.from('var broken={')});await page.waitForFunction(()=>document.querySelector('#code').value==='var broken={');await page.click('#check');await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('"ok": false'));report.fileInputAndSyntaxError=true;
 report.taskMemory=memory();report.font=await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily);
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/user');await page.locator('#catalog .card').nth(2).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,'staging-public-mobile.png'),fullPage:true});report.mobileNoOverflow=true;
 assert.deepEqual(errors,[]);report.pageErrors=errors;report.ok=true;console.log(JSON.stringify(report,null,2));writeFileSync(join(output,'browser-staging.json'),JSON.stringify(report,null,2));
}finally{await browser?.close();server.close();server.closeAllConnections();await server.hubClosed;rmSync(dir,{recursive:true,force:true});}
