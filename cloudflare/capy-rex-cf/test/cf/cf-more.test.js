// More Cloudflare-specific checks: alarm-driven sync, eviction mid-sync,
// Docker ⇄ CF backup round trips, concurrency, and a large restore.
// Run with: REX_TEST_RUNTIME=cf node --import ./test/cf/register.mjs --test test/cf/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { listen, close, temporary, api, login } from '../helpers.js';
import { createHubServer } from '../../server.js';
import { homePackage } from '../fixtures/home-package.js';

assert.equal(process.env.REX_TEST_RUNTIME, 'cf');
const PASSWORD = 'cf-more-password', origin = 'https://modules.example';
const code = (id, version) => `WidgetMetadata = {id:'${id}',title:'模块 ${id}',version:'${version}',author:'Bolinxxlin'};\nfunction load(){return [];}`;
const sha = b => createHash('sha256').update(b).digest('hex');

function remote(state) {
  return async url => {
    const u = new URL(url);
    if (u.pathname === '/collection.rex') {
      return new Response(JSON.stringify({ title: '测试订阅', widgets: Array.from({ length: state.count }, (_, i) =>
        ({ id: 'm' + i, url: origin + '/m' + i + '.js', title: '模块 m' + i, version: String(state.version) })) }));
    }
    const m = u.pathname.match(/^\/(m\d+)\.js$/);
    if (m) { state.hits++; return new Response(code(m[1], state.version)); }
    return new Response('not found', { status: 404 });
  };
}

async function cfApp(t, directory = temporary(t), state) {
  const { server, base } = await listen({ DATA_DIR: directory, ADMIN_SECRET: PASSWORD, DISABLE_SCHEDULER: 'true' },
    { remoteFetch: state ? remote(state) : async () => { throw new Error('offline'); } });
  let closed = false;
  t.after(async () => { if (!closed) await close(server); });
  const cookie = await login(base, PASSWORD);
  const f = { server, base, directory, hub: server.hub, storage: server.state.storage,
    call: (p, o = {}) => api(base, p, { cookie, ...o }), async close() { closed = true; await close(server); } };
  f.ok = async (p, o) => { const r = await f.call(p, o), b = await r.json(); assert.ok(r.ok, p + ' ' + JSON.stringify(b)); return b; };
  // Drive the Durable Object alarm like Cloudflare would, until no work is due.
  f.runAlarms = async (max = 300) => {
    for (let i = 0; i < max; i++) {
      await f.hub.alarm();
      if (f.storage.alarm - Date.now() > 2000) return i + 1;
    }
    throw new Error('alarm loop did not settle');
  };
  return f;
}

async function dockerApp(t, directory = temporary(t)) {
  const server = await createHubServer({ DATA_DIR: directory, ADMIN_SECRET: PASSWORD, DISABLE_SCHEDULER: 'true' },
    { remoteFetch: async () => { throw new Error('offline'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { const c = once(server, 'close'); server.close(); await c; await server.hubClosed; });
  const cookie = await login(base, PASSWORD);
  const f = { base, call: (p, o = {}) => api(base, p, { cookie, ...o }) };
  f.ok = async (p, o) => { const r = await f.call(p, o), b = await r.json(); assert.ok(r.ok, p + ' ' + JSON.stringify(b)); return b; };
  return f;
}

async function upload(f, text, name) {
  const file = new File([text], name), fd = new FormData(); fd.append('files', file);
  const plan = await f.ok('/api/admin/modules/upload/preview', { method: 'POST', body: fd });
  const commit = new FormData();
  for (const [k, v] of Object.entries({ job_id: plan.job_id, index: '0', action: 'new', target_id: '', mode: '' })) commit.append(k, v);
  commit.append('file', file);
  return f.ok('/api/admin/modules/upload/commit', { method: 'POST', body: commit });
}
const bytesOf = async r => Buffer.from(await (await r).arrayBuffer());

test('「全部同步」在没有打开页面时由闹钟跑完 40 个模块，结束后不再每秒唤醒', async t => {
  const state = { count: 40, version: 1, hits: 0 };
  const f = await cfApp(t, undefined, state);
  const added = await f.ok('/api/admin/modules/import', { method: 'POST', json: { url: origin + '/collection.rex' } });
  const sourceId = added.subscription.id;
  await f.runAlarms();
  let modules = await f.ok('/api/admin/modules');
  assert.equal(modules.length, 40);
  state.version = 2; state.hits = 0;
  await f.ok('/api/admin/subscriptions/sync-all', { method: 'POST', json: {} });
  assert.ok(f.storage.alarm - Date.now() <= 1500, '同步排队后 1 秒内唤醒');
  const rounds = await f.runAlarms();
  modules = await f.ok('/api/admin/modules');
  assert.equal(modules.length, 40);
  assert.ok(modules.every(m => m.version === '2'), '全部更新到 2');
  assert.equal(state.hits, 40, '每个模块只下载一次');
  assert.ok(rounds > 1, '分多批完成（' + rounds + ' 轮）');
  t.diagnostic('闹钟轮数=' + rounds);
  assert.ok(f.storage.alarm - Date.now() > 4000, '完成后闹钟退回空闲间隔');
  const subs = await f.ok('/api/admin/subscriptions');
  const row = (Array.isArray(subs) ? subs : subs.sources || subs.subscriptions || []).find(s => s.id === sourceId);
  assert.ok(row && row.status !== 'syncing', JSON.stringify(row));
});

test('同步跑到一半 Durable Object 被回收，重启后从中断处继续，不重复也不丢模块', async t => {
  const state = { count: 30, version: 1, hits: 0 };
  const f = await cfApp(t, undefined, state);
  await f.ok('/api/admin/modules/import', { method: 'POST', json: { url: origin + '/collection.rex' } });
  await f.runAlarms();
  state.version = 3; state.hits = 0;
  await f.ok('/api/admin/subscriptions/sync-all', { method: 'POST', json: {} });
  await f.hub.alarm(); await f.hub.alarm();
  const partial = state.hits;
  assert.ok(partial > 0 && partial < 30, '中断时只完成一部分（' + partial + '）');
  t.diagnostic('中断前已下载=' + partial);
  await f.close();
  const next = await cfApp(t, f.directory, state);
  await next.runAlarms();
  const modules = await next.ok('/api/admin/modules');
  assert.equal(modules.length, 30);
  assert.ok(modules.every(m => m.version === '3'));
  assert.ok(state.hits >= 30 && state.hits <= 30 + 8, '最多重做被打断的一批（下载 ' + state.hits + ' 次）');
  t.diagnostic('总下载=' + state.hits);
});

test('Docker → CF → Docker 备份互通：模块字节、ID、合集、首页包（含头像）全部一致', async t => {
  const dk = await dockerApp(t);
  const big = 'REXENC\n' + randomBytes(3 * 1024 * 1024).toString('base64');
  const a = await upload(dk, big, 'big-encrypted.js');
  const b = await upload(dk, code('plain', '5'), 'plain.js');
  const moduleIds = [a, b].map(r => r.module_id || r.id || r.module?.id);
  assert.ok(moduleIds.every(Boolean), JSON.stringify([a, b]).slice(0, 300));
  await dk.ok('/api/admin/collections', { method: 'POST', json: { title: '互通合集', slug: 'roundtrip', moduleIds } });
  const home = homePackage({ extra: [['assets/big.bin', randomBytes(1_500_000)]] }, { stored: true });
  const form = new FormData(); form.append('file', new File([home], 'home.rex'));
  assert.equal((await dk.call('/api/admin/home-configs', { method: 'POST', body: form })).status, 201);
  const fromDocker = await dk.ok('/api/admin/backup');
  assert.equal(fromDocker.format, 8);

  const cf = await cfApp(t);
  await cf.ok('/api/admin/backup/restore', { method: 'POST', json: fromDocker });
  const cfModules = await cf.ok('/api/admin/modules');
  assert.deepEqual(cfModules.map(m => m.id).sort(), [...moduleIds].sort());
  assert.equal(sha(await bytesOf(cf.call('/api/modules/' + moduleIds[0] + '.js'))), sha(Buffer.from(big)));
  const rex = await (await api(cf.base, '/api/collections/roundtrip.rex')).json();
  assert.equal(rex.widgets.length, 2);
  const homes = await cf.ok('/api/admin/home-configs');
  assert.deepEqual(await bytesOf(cf.call('/api/admin/home-configs/' + homes[0].id + '/file')), home);
  assert.ok(homes[0].avatar_url, '头像保留');

  const fromCf = await cf.ok('/api/admin/backup');
  assert.equal(fromCf.format, 8);
  const dk2 = await dockerApp(t);
  await dk2.ok('/api/admin/backup/restore', { method: 'POST', json: fromCf });
  assert.equal(sha(await bytesOf(dk2.call('/api/modules/' + moduleIds[0] + '.js'))), sha(Buffer.from(big)));
  const homes2 = await dk2.ok('/api/admin/home-configs');
  assert.deepEqual(await bytesOf(dk2.call('/api/admin/home-configs/' + homes2[0].id + '/file')), home);
  assert.deepEqual(Object.keys(fromCf.files).sort(), Object.keys(fromDocker.files).sort());
});

test('并发：30 个公开下载 + 5 个上传 + 列表同时进行，不卡死、全部成功', async t => {
  const f = await cfApp(t);
  const first = await upload(f, code('seed', '1'), 'seed.js');
  const id = first.module_id || first.id || first.module?.id;
  const jobs = [
    ...Array.from({ length: 30 }, () => api(f.base, '/api/modules/' + id + '.js').then(r => r.status)),
    ...Array.from({ length: 5 }, (_, i) => upload(f, code('c' + i, '1'), 'c' + i + '.js').then(() => 200)),
    ...Array.from({ length: 5 }, () => f.call('/api/admin/modules').then(r => r.status)),
  ];
  const statuses = await Promise.race([Promise.all(jobs), new Promise((_, rej) => setTimeout(() => rej(new Error('卡死')), 20000))]);
  assert.ok(statuses.every(s => s === 200), JSON.stringify(statuses));
  assert.equal((await f.ok('/api/admin/modules')).length, 6);
});

test('大备份恢复（约 30 MB）：记录耗时和内存，恢复后字节一致', async t => {
  const f = await cfApp(t);
  const files = {}, modules = [];
  for (let i = 0; i < 10; i++) {
    const buf = Buffer.from('REXENC\n' + randomBytes(1_650_000).toString('base64'));
    files['big' + i] = { filename: 'big' + i + '.js', encoding: 'base64', content: buf.toString('base64'), hash: sha(buf), size: buf.length };
    modules.push({ id: 'big' + i, filename: 'big' + i + '.js', title: '大模块 ' + i, is_encrypted: 1 });
  }
  const backup = { format: 7, files, meta: { modules, collections: [], shareAliases: [], names: [], filenameSettings: { auto_clean: true }, icons: { sources: [], entries: [], assets: [] } } };
  const body = JSON.stringify(backup);
  let peak = 0;
  const sample = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed + m.arrayBuffers); }, 5);
  const before = process.memoryUsage(), started = Date.now();
  const r = await f.call('/api/admin/backup/restore', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  const elapsed = Date.now() - started;
  clearInterval(sample);
  assert.equal(r.status, 200, await r.text());
  const base = before.heapUsed + before.arrayBuffers;
  console.log(`[大备份] 备份 ${(body.length / 1048576).toFixed(1)} MB，恢复 ${elapsed} ms，额外内存峰值约 ${((peak - base) / 1048576).toFixed(0)} MB（Node 估算，非 Cloudflare 实测）`);
  assert.equal(sha(await bytesOf(f.call('/api/modules/big7.js'))), files.big7.hash);
  t.diagnostic(`size=${(body.length / 1048576).toFixed(1)}MB elapsed=${elapsed}ms peakExtra=${((peak - base) / 1048576).toFixed(0)}MB`);
});

test('大库导出备份（约 28 MB）：记录耗时和内存', async t => {
  const f = await cfApp(t);
  const files = {}, modules = [];
  for (let i = 0; i < 10; i++) {
    const buf = Buffer.from('REXENC\n' + randomBytes(1_650_000).toString('base64'));
    files['e' + i] = { filename: 'e' + i + '.js', encoding: 'base64', content: buf.toString('base64'), hash: sha(buf), size: buf.length };
    modules.push({ id: 'e' + i, filename: 'e' + i + '.js', title: 'E' + i, is_encrypted: 1 });
  }
  await f.ok('/api/admin/backup/restore', { method: 'POST', json: { format: 7, files, meta: { modules, collections: [], shareAliases: [], names: [], filenameSettings: { auto_clean: true }, icons: { sources: [], entries: [], assets: [] } } } });
  global.gc?.();
  let peak = 0;
  const sample = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed + m.arrayBuffers); }, 5);
  const before = process.memoryUsage(), started = Date.now();
  const r = await f.call('/api/admin/backup');
  const text = await r.text();
  clearInterval(sample);
  assert.equal(r.status, 200);
  const out = JSON.parse(text);
  assert.equal(Object.keys(out.files).length, 10);
  t.diagnostic(`导出 ${(text.length / 1048576).toFixed(1)}MB 用时 ${Date.now() - started}ms 额外内存峰值约 ${((peak - before.heapUsed - before.arrayBuffers) / 1048576).toFixed(0)}MB`);
});
