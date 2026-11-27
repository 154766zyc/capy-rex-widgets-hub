// Cloudflare (Durable Object) specific checks. Run with:
//   REX_TEST_RUNTIME=cf node --import ./test/cf/register.mjs --test test/cf/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { listen, close, temporary, api, login } from '../helpers.js';
import { homePackage } from '../fixtures/home-package.js';
import { createStorage, DOKV } from '../../cf/do-storage.js';
import { fakeState } from './fake-do.js';
import { CF_VERSION } from '../../cf/hub.js';
import { RexHub } from '../../cf/hub.js';

assert.equal(process.env.REX_TEST_RUNTIME, 'cf', 'run these tests with REX_TEST_RUNTIME=cf');
const PASSWORD = 'cf-test-password';
const homeRoot = '/api/admin/home-configs';

async function app(t, directory = temporary(t), extra = {}) {
  const { server, base } = await listen({ DATA_DIR: directory, ADMIN_SECRET: PASSWORD, DISABLE_SCHEDULER: 'true', ...extra },
    { remoteFetch: async () => { throw new Error('no network in CF tests'); } });
  let closed = false;
  t.after(async () => { if (!closed) await close(server); });
  const cookie = await login(base, PASSWORD);
  const f = { server, base, directory, cookie, call: (path, o = {}) => api(base, path, { cookie, ...o }),
    async close() { closed = true; await close(server); } };
  f.ok = async (path, o) => { const r = await f.call(path, o), b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return b; };
  return f;
}
const bytesOf = async r => Buffer.from(await (await r).arrayBuffer());

test('存储：返回 ≥400 或抛错时整体回滚；内层失败不影响外层', async t => {
  const dir = temporary(t), state = fakeState(join(dir, 'x.sqlite')), s = createStorage(state.storage);
  t.after(() => state.storage.close());
  s.sql.all('CREATE TABLE t (v TEXT)');
  const ins = v => s.db.prepare('INSERT INTO t (v) VALUES (?)').bind(v).run();
  const rows = () => s.sql.all('SELECT v FROM t ORDER BY rowid').map(r => r.v);
  const r = await s.atomic(async () => { await ins('a'); return new Response('no', { status: 409 }); });
  assert.equal(r.status, 409); assert.deepEqual(rows(), []);
  await assert.rejects(s.atomic(async () => { await ins('b'); throw new Error('boom'); }), /boom/);
  assert.deepEqual(rows(), []);
  await s.atomic(async () => {
    await ins('outer');
    await s.atomic(async () => { await ins('inner'); throw new Error('inner'); }).catch(() => {});
  });
  assert.deepEqual(rows(), ['outer']);
  await assert.rejects(s.db.batch([s.db.prepare("INSERT INTO t (v) VALUES ('x')"), s.db.prepare('INSERT INTO nope VALUES (1)')]));
  assert.deepEqual(rows(), ['outer'], 'a failed D1 batch leaves nothing behind');
  const changed = await s.db.prepare("UPDATE t SET v='y' WHERE v='outer'").run();
  assert.equal(changed.meta.changes, 1);
  assert.equal((await s.db.prepare("UPDATE t SET v='z' WHERE v='missing'").run()).meta.changes, 0);
});

test('存储：超过 2 MB 的值分片存取原字节，不再引用后被清理', async t => {
  const dir = temporary(t), state = fakeState(join(dir, 'x.sqlite')), s = createStorage(state.storage);
  t.after(() => state.storage.close());
  const big = randomBytes(5 * 1024 * 1024 + 123);
  await s.kv.put('file:big', big);
  assert.deepEqual(Buffer.from(await s.kv.get('file:big', 'arrayBuffer')), big);
  assert.ok(state.storage.stats.maxValue <= 1_000_000, 'no single SQL value exceeds the chunk size');
  assert.ok(s.sql.all('SELECT COUNT(*) AS n FROM _rex_spill')[0].n >= 6);
  assert.ok(s.sql.all('SELECT COUNT(*) AS n FROM _rex_spill')[0].n >= 6);
  await s.kv.put('file:big2', big); // identical content is stored once
  assert.equal(s.sql.all('SELECT COUNT(*) AS n FROM _rex_spill_meta')[0].n, 1);
  await s.kv.delete('file:big');
  await s.atomic(async () => s.sql.collectGarbage());
  assert.equal(s.sql.all('SELECT COUNT(*) AS n FROM _rex_spill_meta')[0].n, 1, 'still referenced by file:big2');
  await s.kv.delete('file:big2');
  await s.atomic(async () => s.sql.collectGarbage());
  assert.equal(s.sql.all('SELECT COUNT(*) AS n FROM _rex_spill')[0].n, 0);
  const small = randomBytes(1000);
  await s.kv.put('small', small);
  assert.deepEqual(Buffer.from(await s.kv.get('small', 'arrayBuffer')), small);
});

test('6 MB 首页包：上传、原字节导出、重启后仍在、删除后清理', async t => {
  const f = await app(t);
  const raw = homePackage({ extra: [['assets/big.bin', randomBytes(6 * 1024 * 1024)]] }, { stored: true });
  assert.ok(raw.length > 6 * 1024 * 1024);
  const form = new FormData(); form.append('file', new File([raw], 'big.rex'));
  const created = await f.call(homeRoot, { method: 'POST', body: form }), body = await created.json();
  assert.equal(created.status, 201, JSON.stringify(body));
  assert.deepEqual(await bytesOf(f.call(homeRoot + '/' + body.home.id + '/file')), raw);
  assert.ok(f.server.state.storage.stats.maxValue <= 1_000_000);
  await f.close();
  const next = await app(t, f.directory);
  const rows = await next.ok(homeRoot);
  assert.equal(rows.length, 1);
  assert.deepEqual(await bytesOf(next.call(homeRoot + '/' + rows[0].id + '/file')), raw);
  const backup = await next.ok('/api/admin/backup');
  assert.equal(backup.format, 8);
  await next.ok(homeRoot + '/' + rows[0].id, { method: 'DELETE', json: { revision: rows[0].revision } });
  const hub = next.server.hub;
  await hub.store.atomic(async () => hub.store.sql.collectGarbage());
  assert.equal(hub.store.sql.all('SELECT COUNT(*) AS n FROM _rex_spill')[0].n, 0);
  // The backup taken before deletion restores the large package again.
  await next.ok('/api/admin/backup/restore', { method: 'POST', json: backup });
  const restored = await next.ok(homeRoot);
  assert.deepEqual(await bytesOf(next.call(homeRoot + '/' + restored[0].id + '/file')), raw);
});

test('恢复写入期间可查询进度，提交前不会显示完成', async t => {
  const f = await app(t), original = DOKV.prototype.put;
  let release, entered;
  const hold = new Promise(r => { release = r; }), reached = new Promise(r => { entered = r; });
  DOKV.prototype.put = async function (key, ...rest) { if (key === 'file:stable') { entered(); await hold; } return original.call(this, key, ...rest); };
  t.after(() => { release(); DOKV.prototype.put = original; });
  const root = '/api/admin/backup/restore/jobs', id = crypto.randomUUID();
  await f.ok(root, { method: 'POST', json: { id } });
  const content = Buffer.from('REXENC\nsynthetic');
  const { createHash } = await import('node:crypto');
  const backup = { format: 7, files: { stable: { filename: 'stable.js', encoding: 'base64', content: content.toString('base64'),
    hash: createHash('sha256').update(content).digest('hex'), size: content.length } },
    meta: { modules: [{ id: 'stable', filename: 'stable.js', title: 'T', is_encrypted: 1 }], collections: [], shareAliases: [], names: [],
      filenameSettings: { auto_clean: true }, icons: { sources: [], entries: [], assets: [] } } };
  await f.ok(root + '/' + id, { method: 'PUT', body: JSON.stringify(backup), headers: { 'Content-Type': 'application/json' } });
  await Promise.race([reached, delay(2000).then(async () => { throw new Error('publication not reached: ' + JSON.stringify(await f.ok(root + '/' + id))); })]);
  const polled = await f.ok(root + '/' + id);
  assert.equal(polled.job.status, 'writing');
  release(); DOKV.prototype.put = original;
  for (let i = 0; i < 200; i++) { const { job } = await f.ok(root + '/' + id); if (job.status === 'done') return; await delay(5); }
  assert.fail('restore did not finish');
});

test('「全部同步」1 秒内唤醒；空闲时不频繁唤醒', async t => {
  const f = await app(t);
  const hub = f.server.hub, storage = f.server.state.storage;
  await storage.setAlarm(Date.now() + 10 * 60 * 1000);
  const before = Date.now();
  await f.ok('/api/admin/subscriptions/sync-all', { method: 'POST', json: {} });
  assert.ok(storage.alarm - before <= 1500, 'alarm pulled forward');
  await hub.alarm();
  assert.ok(storage.alarm - Date.now() > 59 * 60 * 1000, 'no sources: sleep the full hour (3.6.0), not every few seconds');
  assert.ok(storage.alarm - Date.now() <= 60 * 60 * 1000 + 50);
  // Cron 每 5 分钟调一次 tick：已有更早的闹钟时不再重设（每次 setAlarm 算 1 行写入）。
  const set = storage.alarm; let writes = 0; const orig = storage.setAlarm.bind(storage);
  storage.setAlarm = async at => { writes++; return orig(at); };
  await hub.tick(); await hub.tick();
  storage.setAlarm = orig;
  assert.equal(writes, 0, 'cron tick must not rewrite an alarm that is already early enough');
  assert.equal(storage.alarm, set);
  const health = await (await api(f.base, '/healthz')).json();
  assert.deepEqual(health, { ok: true, version: CF_VERSION, runtime: 'cloudflare-durable-object' });
});

test('定时维护：闹钟和 Cron 都能正常运行', async t => {
  const dir = temporary(t), state = fakeState(join(dir, 'rex.sqlite'));
  const hub = new RexHub(state, { ADMIN_PASSWORD: PASSWORD });
  t.after(() => state.storage.close());
  await hub.ready;
  assert.deepEqual(await hub.tick(), { ok: true });
  await hub.alarm();
  assert.ok(state.storage.alarm > Date.now());
  assert.equal(state.storage.stats.maxParams <= 100, true);
});

test('超过上传限制或未登录的大上传在读取前拒绝', async t => {
  const f = await app(t);
  const r = await api(f.base, homeRoot, { method: 'POST', body: 'x' });
  assert.equal(r.status, 401, 'no session: refused before reading');
  const big = await f.call(homeRoot, { method: 'POST', body: Buffer.alloc(27 * 1024 * 1024), headers: { 'Content-Type': 'application/octet-stream' } });
  assert.equal(big.status, 413);
});

test('登录、加密模块源码保护、拒绝内网导入、ETag、删除都正常', async t => {
  const f = await app(t);
  assert.equal((await api(f.base, '/api/admin/modules')).status, 401);
  const file = new File(['REXENC\nprivate payload'], 'encrypted.js'), fd = new FormData(); fd.append('files', file);
  const plan = await f.ok('/api/admin/modules/upload/preview', { method: 'POST', body: fd });
  const commit = new FormData();
  for (const [k, v] of Object.entries({ job_id: plan.job_id, index: '0', action: 'new', target_id: '', mode: '' })) commit.append(k, v);
  commit.append('file', file);
  await f.ok('/api/admin/modules/upload/commit', { method: 'POST', body: commit });
  const modules = await f.ok('/api/admin/modules');
  assert.equal(modules.length, 1);
  const id = modules[0].id;
  assert.equal((await f.call('/api/admin/modules/' + id + '/source')).status, 400);
  assert.equal((await f.call('/api/admin/modules/import', { method: 'POST', json: { url: 'http://127.0.0.1/private' } })).status, 400);
  const raw = await f.call('/api/modules/' + id + '.js'), etag = raw.headers.get('etag');
  assert.ok(etag);
  assert.equal((await f.call('/api/modules/' + id + '.js', { headers: { 'If-None-Match': etag } })).status, 304);
  await f.ok('/api/admin/modules?id=' + id, { method: 'DELETE' });
  assert.equal((await f.call('/api/modules/' + id + '.js')).status, 404);
});

test('同一行两个约 1 MB 的内容（首页包 + 头像）不超过 2 MB 行上限', async t => {
  const dir = temporary(t), state = fakeState(join(dir, 'x.sqlite')), s = createStorage(state.storage);
  t.after(() => state.storage.close());
  s.sql.all('CREATE TABLE h (id TEXT, bytes BLOB, avatar BLOB)');
  const a = randomBytes(1_000_000), b = randomBytes(1_000_000);
  await s.db.prepare('INSERT INTO h VALUES (?,?,?)').bind('x', a, b).run();
  const row = await s.db.prepare('SELECT * FROM h').first();
  assert.deepEqual(Buffer.from(row.bytes), a);
  assert.deepEqual(Buffer.from(row.avatar), b);
});
