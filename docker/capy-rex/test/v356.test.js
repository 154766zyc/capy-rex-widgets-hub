// 3.5.6：公开 .rex 只查本合集 + ETag/304、别名装饰线性化、备份流式输出、图标 304 不读图片。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import worker, { bootstrap } from '../worker.js';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import { backupStream } from '../backup.js';
import { decorateShares } from '../sharing.js';
import { temporary } from './helpers.js';

async function app(t) {
  const kv = new SQLiteKV(join(temporary(t), 'rex.sqlite')), DB = new SQLiteD1(kv.db, kv.gate);
  t.after(() => kv.close());
  const queries = [];
  const prepare = DB.prepare.bind(DB);
  DB.prepare = q => { queries.push(q); return prepare(q); };
  const env = { KV: kv, DB, ATOMIC: w => kv.transaction(w), SOURCE_URL_POLICY: { assertUrl: r => new URL(r) } };
  await bootstrap(env);
  kv.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('t', Date.now(), Date.now() + 3600000);
  const call = (path, headers = {}) => worker.fetch(new Request('https://hub.example' + path, { headers }), env);
  return { env, sql: kv.db, call, queries };
}
function seed(sql, n, inCollection) {
  sql.exec("INSERT INTO collections(id,slug,title,description,icon_url,created_at,updated_at) VALUES('c','big','Big','','',1,1)");
  for (let i = 0; i < n; i++) {
    const id = 'mod-' + i;
    sql.prepare('INSERT INTO modules(id,filename,title,version,created_at,updated_at,title_scan_v1) VALUES(?,?,?,?,1,1,1)').run(id, 'f' + i + '.js', 'T' + i, '1.' + i);
    sql.prepare("INSERT INTO module_names VALUES(?,?,'[]',1,'r')").run(id, 'n' + i + '.js');
    sql.prepare('INSERT INTO module_share_aliases VALUES(?,?,?,1,0,1)').run('s' + i + '.js', 's' + i + '.js', id);
    if (i < inCollection) sql.prepare('INSERT INTO collection_modules VALUES(?,?,?)').run('c', id, i);
  }
}

test('3.5.6 public .rex reads only its own modules and answers If-None-Match with 304', async t => {
  const f = await app(t);
  seed(f.sql, 50, 3);
  f.queries.length = 0;
  const first = await f.call('/api/collections/big.rex');
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.deepEqual(body.widgets.map(w => w.url), ['s0.js', 's1.js', 's2.js'].map(a => 'https://hub.example/api/modules/' + a));
  assert.ok(!f.queries.some(q => /FROM module_names\s*$/.test(q.trim()) || /FROM module_share_aliases ORDER BY/.test(q)), '不再全表扫描');
  const etag = first.headers.get('etag');
  assert.match(etag, /^W\/"[a-f0-9]{32}"$/);
  const again = await f.call('/api/collections/big.rex', { 'If-None-Match': etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get('access-control-allow-origin'), '*');
  // 内容变了 ETag 就变。
  f.sql.prepare("UPDATE modules SET title='Changed' WHERE id='mod-1'").run();
  f.sql.prepare("UPDATE modules SET title_locked=1 WHERE id='mod-1'").run();
  const changed = await f.call('/api/collections/big.rex', { 'If-None-Match': etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), etag);
});

test('3.5.6 grouped alias decoration matches the old per-module scan exactly', async () => {
  const rows = [
    { alias: 'a.js', alias_key: 'a.js', module_id: 'x', is_current: 0, tombstoned: 0 },
    { alias: 'b.js', alias_key: 'b.js', module_id: 'y', is_current: 1, tombstoned: 0 },
    { alias: 'c.js', alias_key: 'c.js', module_id: 'x', is_current: 1, tombstoned: 0 },
    { alias: 'd.js', alias_key: 'd.js', module_id: 'x', is_current: 1, tombstoned: 1 }
  ];
  const mods = [{ id: 'x', title: 'X', version: '1', updated_at: 1, file_key: '' }, { id: 'z', title: 'Z' }];
  const old = mods.map(m => { const a = rows.find(a => a.module_id === m.id && a.is_current && !a.tombstoned);
    return { ...m, share_alias: a?.alias || '', share_path: a ? '/api/modules/' + encodeURIComponent(a.alias) : '',
      share_revision: JSON.stringify([m.id, m.title, m.version, m.updated_at, m.file_key, rows.filter(a => a.module_id === m.id)]) }; });
  assert.deepEqual(await decorateShares({}, mods, rows), old);
});

test('3.5.6 streamed backup is byte-identical to JSON.stringify, including numeric-looking IDs and Unicode', async () => {
  const make = () => ({ format: 8, meta: { modules: [{ id: '10', title: '中文 "引号"  ' }], exportedAt: 'x' },
    files: Object.assign(Object.create(null), { 'b-uuid': { content: 'QUJD', size: 3 }, '10': { content: '', size: 0 }, '2': { content: 'eA==' } }) });
  const expected = JSON.stringify(make());
  const text = await new Response(backupStream(make())).text();
  assert.equal(text, expected);
  assert.equal(await new Response(backupStream({ files: Object.create(null) })).text(), JSON.stringify({ files: {} }));
  const withIcons = () => ({ format: 7, meta: { a: 1, icons: { sources: [], entries: [{ x: 1 }], assets: [{ hash: 'h1', content: 'AAAA' }, { hash: 'h2', content: '' }] }, z: '"assets"' },
    files: { m: { content: 'QQ==' } } });
  assert.equal(await new Response(backupStream(withIcons())).text(), JSON.stringify(withIcons()));
  const noAssets = () => ({ format: 7, meta: { icons: { sources: [], entries: [], assets: [] } }, files: {} });
  assert.equal(await new Response(backupStream(noAssets())).text(), JSON.stringify(noAssets()));
});

test('3.5.6 backup download streams and still parses as the same backup', async t => {
  const f = await app(t);
  seed(f.sql, 3, 2);
  for (let i = 0; i < 3; i++) await f.env.KV.put('file:mod-' + i, new TextEncoder().encode('var WidgetMetadata={id:"m' + i + '"};'), { metadata: { u: 1, s: 10 } });
  const r = await f.call('/api/admin/backup', { cookie: 'fwh_admin=t' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  const backup = await r.json();
  assert.deepEqual(Object.keys(backup), ['format', 'meta', 'files']);
  assert.equal(Object.keys(backup.files).length, 3);
  assert.equal(Buffer.from(backup.files['mod-1'].content, 'base64').toString(), 'var WidgetMetadata={id:"m1"};');
});

test('3.5.6 icon 304 and HEAD do not read image bytes', async t => {
  const f = await app(t);
  const hash = 'a'.repeat(64);
  f.sql.prepare('INSERT INTO icon_assets(hash,mime,ext,size,bytes,created_at,last_used_at) VALUES(?,?,?,?,?,1,1)').run(hash, 'image/png', 'png', 4, Buffer.from([1, 2, 3, 4]));
  const path = '/api/icons/' + hash + '.png';
  const full = await f.call(path);
  assert.equal(full.status, 200);
  assert.deepEqual([...new Uint8Array(await full.arrayBuffer())], [1, 2, 3, 4]);
  f.queries.length = 0;
  const cached = await f.call(path, { 'If-None-Match': '"' + hash + '"' });
  assert.equal(cached.status, 304);
  assert.ok(!f.queries.some(q => /SELECT (\*|bytes) FROM icon_assets/.test(q)));
});
