// 3.5.5：合集条目与链接模块的条件请求（ETag / Last-Modified → 304），以及 CF 闹钟的轻量续跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import worker, { bootstrap } from '../worker.js';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import { createSourcePolicy } from '../remote.js';
import { temporary } from './helpers.js';

const code = v => `var WidgetMetadata={id:'cond',title:'Cond',version:'${v}'};function play(){}`;

async function app(t) {
  const kv = new SQLiteKV(join(temporary(t), 'rex.sqlite')), DB = new SQLiteD1(kv.db, kv.gate);
  t.after(() => kv.close());
  const env = { KV: kv, DB, ATOMIC: work => kv.transaction(work), SOURCE_URL_POLICY: createSourcePolicy(),
    REMOTE_FETCH: (...args) => globalThis.fetch(...args) };
  await bootstrap(env);
  kv.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test', Date.now(), Date.now() + 3600000);
  const call = (path, { method = 'GET', json } = {}) => worker.fetch(new Request('https://hub.example' + path, { method,
    headers: { cookie: 'fwh_admin=test', ...(json ? { 'content-type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined }), env);
  const ok = async (path, opts) => { const r = await call(path, opts), b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return b; };
  return { env, sql: kv.db, ok };
}

test('3.5.5 collection items are revalidated with If-None-Match / If-Modified-Since and 304 skips the download', async t => {
  const f = await app(t);
  let version = '1', etag = '"v1"';
  const log = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const h = new Headers(init.headers || {});
    if (url.endsWith('/c.json')) return new Response(JSON.stringify({ title: 'Cond', widgets: [{ id: 'cond', url: 'https://source.example/a.js', title: 'Cond' }] }),
      { headers: { 'content-type': 'application/json' } });
    log.push({ inm: h.get('if-none-match'), ims: h.get('if-modified-since') });
    if (h.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(code(version), { headers: { etag, 'last-modified': 'Sun, 22 Nov 2026 05:00:00 GMT', 'content-type': 'application/javascript' } });
  });
  const added = await f.ok('/api/admin/modules/import', { method: 'POST', json: { url: 'https://source.example/c.json' } });
  const sid = added.subscription.id;
  const sync = async () => { let r; do r = await f.ok('/api/admin/subscriptions/' + sid + '/sync', { method: 'POST' }); while (!r.done); return r; };
  await sync();
  const item = () => f.sql.prepare('SELECT * FROM subscription_items WHERE source_id=?').get(sid);
  assert.equal(item().etag, '"v1"');
  assert.equal(item().last_modified, 'Sun, 22 Nov 2026 05:00:00 GMT');
  const mod = f.sql.prepare('SELECT * FROM modules WHERE id=?').get(item().module_id);
  // 第二次同步：带校验值，上游回 304。
  const second = await sync();
  assert.equal(second.summary.unchanged, 1);
  const last = log.at(-1);
  assert.equal(last.inm, '"v1"');
  assert.equal(last.ims, 'Sun, 22 Nov 2026 05:00:00 GMT');
  assert.equal(f.sql.prepare('SELECT updated_at FROM modules WHERE id=?').get(mod.id).updated_at, mod.updated_at);
  // 上游更新：ETag 变了，正常下载新版本并保存新的校验值。
  version = '2'; etag = '"v2"';
  const third = await sync();
  assert.equal(third.summary.updated, 1);
  assert.equal(f.sql.prepare('SELECT version FROM modules WHERE id=?').get(mod.id).version, '2');
  assert.equal(item().etag, '"v2"');
});

test('3.5.5 a manifest title change bypasses revalidation so catalog metadata still updates', async t => {
  const f = await app(t);
  let title = 'Cond';
  const log = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const h = new Headers(init.headers || {});
    if (url.endsWith('/c.json')) return new Response(JSON.stringify({ title: 'C', widgets: [{ id: 'cond', url: 'https://source.example/a.js', title }] }));
    log.push(h.get('if-none-match'));
    return new Response(code('1'), { headers: { etag: '"same"' } });
  });
  const sid = (await f.ok('/api/admin/modules/import', { method: 'POST', json: { url: 'https://source.example/c.json' } })).subscription.id;
  let r; do r = await f.ok('/api/admin/subscriptions/' + sid + '/sync', { method: 'POST' }); while (!r.done);
  assert.equal(log.at(-1), null, '导入后还没有校验值');
  do r = await f.ok('/api/admin/subscriptions/' + sid + '/sync', { method: 'POST' }); while (!r.done);
  assert.equal(log.at(-1), '"same"', '元数据没变时发条件请求');
  title = 'Renamed upstream';
  do r = await f.ok('/api/admin/subscriptions/' + sid + '/sync', { method: 'POST' }); while (!r.done);
  assert.equal(log.at(-1), null, '元数据变了就不发条件请求');
  const row = f.sql.prepare('SELECT m.manifest_title FROM modules m JOIN subscription_items i ON i.module_id=m.id WHERE i.source_id=?').get(sid);
  assert.equal(row.manifest_title, 'Renamed upstream');
});

test('3.5.5 link-module auto refresh sends validators and treats 304 as unchanged', async t => {
  const kv = new SQLiteKV(join(temporary(t), 'rex.sqlite'));
  t.after(() => kv.close());
  const seen = [];
  const env = { KV: kv, DB: new SQLiteD1(kv.db, kv.gate), ATOMIC: work => kv.transaction(work), SOURCE_URL_POLICY: { assertUrl: raw => new URL(raw) },
    REMOTE_FETCH: async (url, init = {}) => {
      const h = new Headers(init.headers || {});
      seen.push(h.get('if-none-match'));
      if (h.get('if-none-match') === '"L1"') return new Response(null, { status: 304, headers: { etag: '"L1"' } });
      return new Response(code('5'), { headers: { etag: '"L1"' } });
    } };
  await kv.transaction(() => bootstrap(env));
  const old = Date.now() - 30 * 3600000;
  kv.db.prepare(`INSERT INTO modules(id,filename,title,source_url,created_at,updated_at,content_hash,title_scan_v1) VALUES('lk','lk.js','lk','https://up.example/lk.js',?,?,'',1)`).run(old, old);
  const tick = async () => { let job; await worker.scheduled({}, env, { waitUntil: p => { job = p; } }); await job; };
  await tick();
  const first = kv.db.prepare('SELECT * FROM modules WHERE id=?').get('lk');
  assert.equal(first.version, '5');
  assert.equal(first.link_etag, '"L1"');
  assert.equal(seen.at(-1), null, '第一次没有校验值');
  kv.db.prepare('UPDATE modules SET link_checked_at=0,updated_at=? WHERE id=?').run(old, 'lk');
  const before = kv.db.prepare('SELECT updated_at FROM modules WHERE id=?').get('lk').updated_at;
  await tick();
  assert.equal(seen.at(-1), '"L1"');
  assert.equal(kv.db.prepare('SELECT updated_at FROM modules WHERE id=?').get('lk').updated_at, before, '304 不改模块');
});

test('3.5.5 light scheduled runs only advance queues', async t => {
  const kv = new SQLiteKV(join(temporary(t), 'rex.sqlite'));
  t.after(() => kv.close());
  let fetched = 0;
  const env = { KV: kv, DB: new SQLiteD1(kv.db, kv.gate), ATOMIC: work => kv.transaction(work), SOURCE_URL_POLICY: { assertUrl: raw => new URL(raw) },
    REMOTE_FETCH: async () => { fetched++; return new Response(code('1')); } };
  await kv.transaction(() => bootstrap(env));
  const old = Date.now() - 30 * 3600000;
  kv.db.prepare(`INSERT INTO modules(id,filename,title,source_url,created_at,updated_at,content_hash,title_scan_v1) VALUES('lk','lk.js','lk','https://up.example/lk.js',?,?,'',1)`).run(old, old);
  let job; await worker.scheduled({ light: true }, env, { waitUntil: p => { job = p; } }); await job;
  assert.equal(fetched, 0, '轻量续跑不做链接刷新');
  await worker.scheduled({}, env, { waitUntil: p => { job = p; } }); await job;
  assert.equal(fetched, 1);
});
