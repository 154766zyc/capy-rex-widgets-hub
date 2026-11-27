// 3.6.0：降低 Cloudflare 用量。定时维护走索引、不再整表扫描；没改数据时合集和管理列表从内存回；
// 删 0 行的清理不算写入；Cron 不重复设闹钟；存储清理每张表只扫一遍；自动更新间隔可选。
// REX_TEST_RUNTIME=cf node --import ./test/cf/register.mjs --test test/cf/cf-v360.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { temporary } from '../helpers.js';
import { fakeState } from './fake-do.js';
import { RexHub } from '../../cf/hub.js';
import { createStorage } from '../../cf/do-storage.js';

const PASSWORD = 'v360-password-123';
const code = (id, v) => `var WidgetMetadata={id:"${id}",title:"${id}",version:"${v}",modules:[]};`;

async function hubWith(t, n = 30) {
  const state = fakeState(join(temporary(t), 'rex.sqlite'));
  t.after(() => state.storage.close());
  const hub = new RexHub(state, { ADMIN_PASSWORD: PASSWORD });
  await hub.ready;
  hub.hubEnv.REMOTE_FETCH = async url => {
    const u = String(url);
    if (u.endsWith('.rex')) return new Response(JSON.stringify({ title: 'c', widgets: Array.from({ length: n }, (_, i) =>
      ({ id: 'w' + i, title: 'W' + i, version: '1', url: 'https://m.example/w' + i + '.js' })) }));
    return new Response(code(u.split('/').pop(), '1'), { headers: { etag: '"e"' } });
  };
  const call = (p, o = {}) => hub.fetch(new Request('https://hub.example' + p, o));
  const login = await call('/api/admin/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({ password: PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json' };
  const imp = await (await call('/api/admin/modules/import', { method: 'POST', headers: H, body: JSON.stringify({ url: 'https://m.example/c.rex' }) })).json();
  for (let i = 0; i < 100; i++) { const r = await (await call('/api/admin/subscriptions/' + imp.subscription.id + '/sync', { method: 'POST', headers: H, body: '{}' })).json(); if (r.done) break; }
  const all = await (await call('/api/admin/modules', { headers: H })).json();
  assert.equal(all.length, n);
  assert.equal((await call('/api/admin/collections', { method: 'POST', headers: H,
    body: JSON.stringify({ slug: 'big', title: 'Big', moduleIds: all.map(m => m.id) }) })).status, 201);
  const sql = state.storage.sql, db = state.storage.db;
  const record = async fn => {
    const log = [], orig = sql.exec;
    sql.exec = (q, ...a) => { log.push([q, a]); return orig.call(sql, q, ...a); };
    try { await fn(); } finally { sql.exec = orig; }
    return log;
  };
  return { hub, state, call, H, all, record, db, sql: hub.store.sql };
}

// 用 EXPLAIN QUERY PLAN 找整表扫描（SCAN 某张表），这就是读取行数随模块数增长的地方。
function fullScans(db, log, tables) {
  const out = [];
  for (const [q, a] of log) {
    if (!/^\s*(SELECT|UPDATE|DELETE|WITH|INSERT)/i.test(q)) continue;
    let plan; try { plan = db.prepare('EXPLAIN QUERY PLAN ' + q).all(...a.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v)); } catch { continue; }
    for (const p of plan) { const m = /^SCAN (\w+)/.exec(p.detail); if (m && tables.includes(m[1])) out.push(m[1] + ' ← ' + q.replace(/\s+/g, ' ').slice(0, 100)); }
  }
  return out;
}

test('3.6.0 定时维护（Cron 完整维护）不整表扫描模块、KV 表', async t => {
  const f = await hubWith(t);
  // 第一轮会把标题扫描补完；之后是稳定状态。
  f.hub.lastFull = 0; await f.hub.tick();
  f.hub.lastFull = 0;
  const log = await f.record(() => f.hub.tick());
  assert.deepEqual(fullScans(f.db, log, ['modules', 'kv', 'kv_metadata', 'module_names', 'collection_modules']), []);
  // 维护时用到的几个索引都在。
  const idx = f.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  for (const name of ['idx_kv_metadata_expires', 'idx_modules_link_due', 'idx_modules_created', 'idx_modules_title_scan']) assert.ok(idx.includes(name), name);
});

test('3.6.0 合集 .rex：没改数据时从内存回（0 次查询），维护删 0 行不清缓存，真的改了数据马上更新', async t => {
  const f = await hubWith(t);
  const first = await f.call('/api/collections/big.rex');
  assert.equal(first.status, 200); const etag = first.headers.get('etag'); assert.ok(etag);
  assert.equal((await first.json()).widgets.length, 30);
  assert.equal((await f.record(async () => assert.equal((await f.call('/api/collections/big.rex')).status, 200))).length, 0);
  // 定时维护、闹钟里的清理大多删 0 行：不算写入，缓存保留。
  f.hub.lastFull = 0; await f.hub.tick(); await f.hub.alarm();
  assert.equal((await f.record(() => f.call('/api/collections/big.rex'))).length, 0, 'maintenance must not invalidate the cache');
  // 304 和 HEAD 也从内存回。
  const log304 = await f.record(async () => {
    const r = await f.call('/api/collections/big.rex', { headers: { 'if-none-match': etag } });
    assert.equal(r.status, 304);
    const h = await f.call('/api/collections/big.rex', { method: 'HEAD' });
    assert.equal(h.status, 200); assert.equal(await h.text(), '');
  });
  assert.equal(log304.length, 0);
  // 真的写了数据：下一次重新读，内容是新的。
  f.sql.run("UPDATE collections SET title='Bigger' WHERE slug='big'");
  const fresh = await f.call('/api/collections/big.rex');
  assert.equal((await fresh.json()).title, 'Bigger');
  assert.notEqual(fresh.headers.get('etag'), etag);
  // 不存在的合集不缓存成功响应。
  assert.equal((await f.call('/api/collections/nope.rex')).status, 404);
});

test('3.6.0 管理列表缓存只给已登录的人；未登录不会拿到缓存内容', async t => {
  const f = await hubWith(t);
  assert.equal((await f.call('/api/admin/modules', { headers: f.H })).status, 200);
  assert.equal((await f.record(() => f.call('/api/admin/modules', { headers: f.H }))).length > 0, true, 'auth check still reads the session');
  const anon = await f.call('/api/admin/modules');
  assert.equal(anon.status, 401);
  assert.ok(!(await anon.text()).includes('W1'));
});

test('3.6.0 写入计数：删 0 行、改 0 行不算写入；真的改了才算', async t => {
  const state = fakeState(join(temporary(t), 'w.sqlite')); t.after(() => state.storage.close());
  const s = createStorage(state.storage).sql;
  s.run('CREATE TABLE t (k TEXT PRIMARY KEY, exp INTEGER)');
  const w0 = s.writes;
  s.run('DELETE FROM t WHERE exp<?', [Date.now()]); s.run("UPDATE t SET exp=1 WHERE k='none'");
  s.all('SELECT * FROM t'); s.get('SELECT * FROM t');
  assert.equal(s.writes, w0);
  s.run("INSERT INTO t VALUES('a',1)"); assert.equal(s.writes, w0 + 1);
  s.all("DELETE FROM t WHERE k='a' RETURNING k"); assert.equal(s.writes, w0 + 2);
  s.all("DELETE FROM t WHERE k='a' RETURNING k"); assert.equal(s.writes, w0 + 2);
  s.run('CREATE INDEX IF NOT EXISTS i ON t(exp)'); assert.equal(s.writes, w0 + 3, 'DDL is always counted');
});

test('3.6.0 存储清理：每张表只扫一遍，仍然只删没人引用的分片', async t => {
  const state = fakeState(join(temporary(t), 'gc.sqlite')); t.after(() => state.storage.close());
  const store = createStorage(state.storage), s = store.sql;
  s.run('CREATE TABLE big (id TEXT PRIMARY KEY, a BLOB, b BLOB, c TEXT, d BLOB)');
  const huge = n => new Uint8Array(3 * 1024 * 1024).fill(n).buffer;
  s.run('INSERT INTO big VALUES (?,?,?,?,?)', ['x', huge(1), null, 'c', huge(2)]);
  s.run('INSERT INTO big VALUES (?,?,?,?,?)', ['y', null, huge(3), 'c', null]);
  s.run("DELETE FROM big WHERE id='y'");
  let scans = 0; const orig = state.storage.sql.exec;
  state.storage.sql.exec = (q, ...a) => { if (/^SELECT .* FROM "big"/.test(q)) scans++; return orig.call(state.storage.sql, q, ...a); };
  const removed = s.collectGarbage();
  state.storage.sql.exec = orig;
  assert.equal(scans, 1, 'one scan per table, not one per column');
  assert.equal(removed, 1);
  const row = s.get("SELECT a, d FROM big WHERE id='x'");
  assert.equal(new Uint8Array(row.a)[10], 1); assert.equal(new Uint8Array(row.d)[10], 2);
  const w = s.writes; assert.equal(s.collectGarbage(), 0); assert.equal(s.writes, w, 'nothing removed → no write');
});

test('3.6.0 自动更新间隔：默认 6 小时，可改 12/18/24，改了重排下次同步；乱填拒绝', async t => {
  const f = await hubWith(t, 3);
  assert.deepEqual(await (await f.call('/api/admin/sync-interval', { headers: f.H })).json(), { ok: true, hours: 6, options: [6, 12, 18, 24] });
  assert.equal((await f.call('/api/admin/sync-interval')).status, 401);
  const bad = await f.call('/api/admin/sync-interval', { method: 'PUT', headers: f.H, body: JSON.stringify({ hours: 7 }) });
  assert.equal(bad.status, 400);
  const before = f.db.prepare('SELECT next_sync_at, last_finished_at FROM subscription_sources').get();
  const ok = await (await f.call('/api/admin/sync-interval', { method: 'PUT', headers: f.H, body: JSON.stringify({ hours: 18 }) })).json();
  assert.equal(ok.hours, 18);
  const after = f.db.prepare('SELECT next_sync_at, last_finished_at FROM subscription_sources').get();
  assert.ok(Math.abs(after.next_sync_at - (after.last_finished_at + 18 * 3600e3)) < 5000, JSON.stringify({ before, after }));
  assert.equal((await (await f.call('/api/admin/sync-interval', { headers: f.H })).json()).hours, 18);
  const page = await (await f.call('/', { headers: f.H })).text();
  assert.match(page, /id="syncInterval"/);
});

test('3.6.0 自动分类：没有新模块时不再扫描全部模块；有新模块时照常处理', async t => {
  const f = await hubWith(t, 5);
  const cfg = await f.call('/api/admin/auto-rules', { method: 'PUT', headers: f.H,
    body: JSON.stringify({ auto: false, rules: [] }) });
  assert.equal(cfg.status, 200, await cfg.clone().text());
  // 20 秒内新建的模块先不处理（这期间也不记住「没变化」），把测试模块的创建时间往前拨。
  f.sql.run('UPDATE modules SET created_at=created_at-60000');
  f.hub.lastFull = 0; await f.hub.tick();
  f.hub.lastFull = 0;
  const log = await f.record(() => f.hub.tick());
  const ruleScans = log.filter(([q]) => /auto_rule_seen/.test(q));
  assert.equal(ruleScans.length, 0, 'unchanged: auto rules skipped');
  // 新模块进来：下一轮照常处理（20 秒内的新模块先不处理，这里把它的创建时间往前拨）。
  f.sql.run(`INSERT INTO modules(id,filename,title,created_at,updated_at) VALUES('fresh','fresh.js','Fresh',?,?)`, [Date.now() - 60000, Date.now() - 60000]);
  f.hub.lastFull = 0;
  const log2 = await f.record(() => f.hub.tick());
  assert.ok(log2.some(([q]) => /auto_rule_seen/.test(q)), 'new module → auto rules run');
  assert.ok(f.db.prepare("SELECT 1 FROM auto_rule_seen WHERE module_id='fresh'").get());
});

test('3.6.0 Cron 不重复写闹钟；闹钟回调里一定重设', async t => {
  const f = await hubWith(t, 2);
  await f.hub.alarm();
  const storage = f.state.storage, set = storage.alarm;
  assert.ok(set > Date.now());
  let writes = 0; const orig = storage.setAlarm.bind(storage);
  storage.setAlarm = async at => { writes++; return orig(at); };
  for (let i = 0; i < 3; i++) { f.hub.lastFull = 0; await f.hub.tick(); }
  assert.equal(writes, 0);
  await f.hub.alarm();
  assert.equal(writes, 1, 'the alarm that just fired is consumed, so it must be set again');
  storage.setAlarm = orig;
});

test('3.6.0 从旧版升级：已有 schema 标记的数据库第一次打开时也补上省用量索引', async t => {
  const file = join(temporary(t), 'old.sqlite');
  const first = fakeState(file); const h1 = new RexHub(first, { ADMIN_PASSWORD: PASSWORD }); await h1.ready;
  // 模拟 3.5.8 的数据库：有 schema_titles_v4 标记，但没有 3.6.0 的索引和标记。
  const db1 = first.storage.db;
  db1.exec("DROP INDEX IF EXISTS idx_modules_link_due; DROP INDEX IF EXISTS idx_modules_created; DELETE FROM settings WHERE key='schema_cost_v360'");
  assert.equal(db1.prepare("SELECT value FROM settings WHERE key='schema_titles_v4'").get().value, '1');
  first.storage.close();
  const second = fakeState(file); t.after(() => second.storage.close());
  const h2 = new RexHub(second, { ADMIN_PASSWORD: PASSWORD }); await h2.ready;
  await h2.fetch(new Request('https://hub.example/healthz'));
  const idx = second.storage.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  for (const name of ['idx_modules_link_due', 'idx_modules_created', 'idx_kv_metadata_expires']) assert.ok(idx.includes(name), name);
});
