// Smoke-test the BUNDLED Cloudflare build (what wrangler uploads) end to end:
// node --import ./test/cf/register.mjs tools/smoke-cf-bundle.mjs <esbuild-package-path>
// Runs the bundle with navigator.userAgent = 'Cloudflare-Workers', so icons come
// from the bundled data and nothing reads the package folder at runtime.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fakeState } from '../test/cf/fake-do.js';
import { zipEntries, homeEntries } from '../test/fixtures/home-package.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const esbuild = await import(pathToFileURL(createRequire(import.meta.url).resolve(process.argv[2] || 'esbuild')).href);
const dir = mkdtempSync(join(tmpdir(), 'rex-cf-smoke-'));
try {
  const out = await esbuild.build({ entryPoints: [root + 'cf/index.js'], bundle: true, format: 'esm', platform: 'neutral',
    write: false, loader: { '.png': 'binary', '.ico': 'binary', '.html':'text' }, external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' });
  writeFileSync(join(dir, 'worker.mjs'), out.outputFiles[0].contents);
  Uint8Array.fromBase64 ||= s => new Uint8Array(Buffer.from(s, 'base64')); // esbuild helper on older Node
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true });
  const mod = await import(pathToFileURL(join(dir, 'worker.mjs')).href);
  const state = fakeState(join(dir, 'rex.sqlite')), env = { ADMIN_PASSWORD: 'smoke-password' };
  const hub = new mod.RexHub(state, env);
  env.HUB = { idFromName: n => n, get: () => hub };
  const call = (p, o = {}) => mod.default.fetch(new Request('https://hub.example' + p, o), env);
  assert.deepEqual(await (await call('/healthz')).json(), { ok: true, version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).upstreamVersion, runtime: 'cloudflare-durable-object' });
  const icon = await call('/app-icons/rex-mulberry-v1-192.png');
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.equal(new Uint8Array(await icon.arrayBuffer())[1], 0x50);
  assert.equal((await call('/favicon.ico')).status, 200);
  assert.equal((await call('/manifest.webmanifest')).status, 200);
  assert.match(await (await call('/')).text(), /Rex/);
  const login = await call('/api/admin/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ password: 'smoke-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /Secure/);
  const created = await call('/api/admin/collections', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie.split(';')[0] }, body: JSON.stringify({ slug: 'smoke', title: 'Smoke', moduleIds: [] }) });
  assert.equal(created.status, 201);
  assert.equal((await (await call('/api/collections/smoke.rex')).json()).title, 'Smoke');
  // 3.5.8：存储用量、文件栏目（上传 → 分享 → 公开下载）、只导出首页的部分备份。
  const auth = { cookie: cookie.split(';')[0] };
  const usage = await (await call('/api/admin/storage', { headers: auth })).json();
  assert.equal(usage.limit, 1024 ** 3); assert.ok(usage.used > 0);
  const form = new FormData(); form.append('file', new File([new TextEncoder().encode('冒烟测试')], 'smoke.txt'));
  const uploaded = await (await call('/api/admin/files', { method: 'POST', headers: auth, body: form })).json();
  assert.equal(uploaded.file.kind, 'txt');
  const listed = (await (await call('/api/admin/files', { headers: auth })).json()).files[0];
  const shared = await (await call('/api/admin/files/' + listed.id + '/share', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ revision: listed.revision, accept_public: true }) })).json();
  const pub = await call(shared.path);
  assert.equal(await pub.text(), '冒烟测试'); assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  const homesOnly = await (await call('/api/admin/backup?scope=homes', { headers: auth })).json();
  assert.equal(homesOnly.scope, 'homes'); assert.deepEqual(homesOnly.files, {});
  const filesOnly = await (await call('/api/admin/backup?scope=files', { headers: auth })).json();
  assert.equal(Buffer.from(filesOnly.meta.hubFiles[0].content, 'base64').toString(), '冒烟测试');
  // 3.6.0：带 HTML 卡片的 version 2 首页包能上传，检查报告能读出卡片。
  const html = '<!doctype html><html><head><meta name="rex-widget" content="type=rail; height=420; item-ratio=2:3"></head><body></body></html>';
  const v2 = zipEntries(homeEntries({ manifest: { version: 2 }, layout: [{ id: 'r', title: '横滑', isActive: true, items: [{ style: 'fullWidthPoster', count: 0, gridSize: [-1, 2.3], id: 'i', title: '横滑', subtitle: '', iconUrl: '', functionId: 'trending', params: [], widgetBundleId: 'rex.tmdb', widgetId: 'rex.tmdb', widgetURL: 'https://assets.rexnow.tv/scripts/rex-tmdb.js', name: 'Rex TMDB', htmlTemplate: 'rail.html' }] }], extra: [['rex-html/rail.html', html]] }));
  const homeForm = new FormData(); homeForm.append('file', new File([v2], 'v2.rex'));
  const home = await (await call('/api/admin/home-configs', { method: 'POST', headers: auth, body: homeForm })).json();
  assert.deepEqual(home.check, { version: 2, html_cards: 1, html_issues: 0, scripts: 0, warnings: 0 });
  const report = await (await call('/api/admin/home-configs/' + home.home.id + '/check', { headers: auth })).json();
  assert.equal(report.html_cards[0].declaration.type, 'rail');
  // 3.6.0：列表摘要、换新分享链接、装上方卡（另存新首页）。
  const listedHome = (await (await call('/api/admin/home-configs', { headers: auth })).json())[0];
  assert.equal(listedHome.check.html_cards, 1);
  const shareJson = { ...auth, 'content-type': 'application/json' };
  const firstShare = await (await call('/api/admin/home-configs/' + listedHome.id + '/share', { method: 'POST', headers: shareJson, body: JSON.stringify({ revision: listedHome.revision, accept_public: true }) })).json();
  const sharedHome = (await (await call('/api/admin/home-configs', { headers: auth })).json())[0];
  const rotated = await (await call('/api/admin/home-configs/' + listedHome.id + '/share/rotate', { method: 'POST', headers: shareJson, body: JSON.stringify({ revision: sharedHome.revision }) })).json();
  assert.equal((await call(firstShare.path)).status, 404); assert.equal((await call(rotated.path)).status, 200);
  const rotatedHome = (await (await call('/api/admin/home-configs', { headers: auth })).json())[0];
  const htmlForm = new FormData(); htmlForm.append('revision', rotatedHome.revision); htmlForm.append('section', '0'); htmlForm.append('item', '0');
  htmlForm.append('file', new File(['<meta name="rex-widget" content="type=rail; height=300; item-ratio=3:2">'], 'b.html'));
  const attached = await (await call('/api/admin/home-configs/' + listedHome.id + '/html', { method: 'POST', headers: auth, body: htmlForm })).json();
  assert.equal(attached.saved, 'new'); assert.equal(attached.check.html_cards, 1);
  const jobs = [];
  await mod.default.scheduled({}, env, { waitUntil: p => jobs.push(p) });
  await Promise.all(jobs);
  assert.ok(state.storage.alarm > Date.now());
  await hub.alarm();
  // 3.6.0：图标 / manifest / 预检不进 Durable Object；边缘缓存默认关，打开后公开 GET 走 PublicCache 且不带 Cookie。
  let doCalls = 0; const countingEnv = { ...env, HUB: { idFromName: n => n, get: () => { doCalls++; return hub; } } };
  const entry = (p, o = {}, e = countingEnv, ctx) => mod.default.fetch(new Request('https://hub.example' + p, o), e, ctx);
  assert.equal((await entry('/app-icons/rex-mulberry-v1-512.png')).status, 200);
  assert.equal((await entry('/manifest.webmanifest')).status, 200);
  assert.equal((await entry('/favicon.ico')).status, 200);
  const pre = await entry('/api/collections/smoke.rex', { method: 'OPTIONS' });
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(doCalls, 0, 'static files and preflight must not reach the Durable Object');
  const seen = []; const exportsCtx = { exports: { PublicCache: { fetch: async req => { seen.push(req); return hub.fetch(req); } } } };
  await entry('/api/collections/smoke.rex', { headers: auth }, countingEnv, exportsCtx);
  assert.equal(seen.length, 0, 'edge cache stays off unless EDGE_CACHE=1');
  const edgeEnv = { ...countingEnv, EDGE_CACHE: '1' };
  const viaEdge = await entry('/api/collections/smoke.rex', { headers: auth }, edgeEnv, exportsCtx);
  assert.equal((await viaEdge.json()).title, 'Smoke');
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.get('cookie'), null, 'cached requests never carry the cookie');
  await entry('/api/admin/modules', { headers: auth }, edgeEnv, exportsCtx);
  assert.equal(seen.length, 1, 'admin requests never go through the edge cache');
  const broken = { exports: { PublicCache: { fetch: async () => { throw new Error('cache not configured'); } } } };
  assert.equal((await entry('/api/collections/smoke.rex', {}, edgeEnv, broken)).status, 200, 'falls back to the Durable Object');
  state.storage.close();
  console.log('通过：打包后的 CF 版——健康检查、PWA 图标、页面、登录（Secure Cookie）、建合集、公开 .rex、存储用量、文件栏目分享、部分备份、v2 首页包（HTML 卡片）检查、换新分享链接、装上 HTML 卡片、Cron 和闹钟、静态文件不进 DO、可选边缘缓存');
} finally { rmSync(dir, { recursive: true, force: true }); }
