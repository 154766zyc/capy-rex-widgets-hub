import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import worker from '../worker.js';
import legacyWorker from './fixtures/legacy-worker.js';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import { createHubServer } from '../server.js';
import { restoreSnapshot } from '../restore-snapshot.js';
import { listen, close, api, login, temporary } from './helpers.js';

const stable = 'http://stable.example.test';
const code = 'WidgetMetadata = { id: "old.widget", title: "原模块 (A)", version: "1.2.3", author: "Author" };\n// 原内容';
const encrypted = new Uint8Array([0xae, 0, 0xfe, 255, 32, 13, 10, 123]);

async function seedLegacy(directory) {
  const kv = new SQLiteKV(join(directory, 'rex.sqlite'));
  const env = { REX_KV: kv, ADMIN_SECRET: 'initial-password', PUBLIC_SECRET: 'public-password', ALLOW_HTTP: true };
  const ip = crypto.randomUUID();
  let cookie;
  async function request(path, { method = 'GET', json, body, auth = true } = {}) {
    const headers = new Headers({ 'CF-Connecting-IP': ip });
    if (auth && cookie) headers.set('Cookie', cookie);
    if (json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(json); }
    return legacyWorker.fetch(new Request(stable + path, { method, headers, body }), env);
  }
  cookie = (await request('/api/admin/auth', { method: 'POST', json: { password: env.ADMIN_SECRET } })).headers.get('set-cookie').split(';')[0];
  const form = new FormData();
  form.append('files', new File([code], 'old.js'));
  form.append('files', new File([encrypted], 'encrypted.js'));
  const added = await (await request('/api/admin/modules', { method: 'POST', body: form })).json();
  const mods = added.added;
  assert.equal(mods.length, 2);
  for (const title of ['中文合集', 'LegacyAuto', 'special-path']) {
    const response = await request('/api/admin/collections', { method: 'POST', json: { title, moduleIds: mods.map(m => m.id), autoAll: title === 'LegacyAuto' } });
    assert.equal(response.status, 201);
  }
  // Preserve non-UI metadata and original encoded / Unicode / hyphenated paths.
  const cols = await kv.get('collections', 'json');
  cols[0].slug = '中文 合集-v1';
  cols[1].slug = 'auto-v1';
  cols[2].slug = 'legacy-v1';
  cols[2].owner = 'pub'; cols[2].official = false;
  await kv.put('collections', JSON.stringify(cols));
  await request('/api/admin/subscribers', { method: 'POST', json: { password: 'subscriber-pw', quota: 3, label: 'old user' } });
  await request('/api/settings', { method: 'PUT', json: { defaultTheme: 'dark' } });
  await request('/api/admin/change-password', { method: 'POST', json: { password: 'changed-password' } });
  const snapshots = [];
  for (const col of cols) {
    for (const suffix of ['', '.rex', '.fwd', '/rex', '/fwd']) {
      const path = '/api/collections/' + encodeURIComponent(col.slug) + suffix;
      const response = await request(path);
      assert.equal(response.status, 200);
      snapshots.push([path, await response.json()]);
    }
  }
  const oldPassword = await kv.get('admin_password');
  const subscribers = await kv.get('subscribers');
  // Precisely reproduce the original Docker database schema (no metadata table).
  kv.db.exec('DROP TABLE kv_metadata');
  kv.close();
  return { mods, cols, snapshots, oldPassword, subscribers };
}

test('v1 SQLite upgrades in place: exact module bytes, all legacy URLs, passwords, metadata, backup and restart', async (t) => {
  const directory = temporary(t);
  const old = await seedLegacy(directory);
  let { server, base } = await listen({ DATA_DIR: directory, ADMIN_SECRET: 'initial-password', PUBLIC_URL: stable });
  t.after(async () => { if (server) await close(server); });
  assert.equal((await api(base, '/api/admin/auth', { method: 'POST', json: { password: 'initial-password' } })).status, 401);
  let cookie = await login(base, 'changed-password');
  const mods = await (await api(base, '/api/admin/modules', { cookie })).json();
  assert.deepEqual(mods.map(m => m.id), old.mods.map(m => m.id));
  for (const [path, expected] of old.snapshots) assert.deepEqual(await (await api(base, path)).json(), expected, path);
  for (const [i, mod] of old.mods.entries()) {
    const bytes = i ? encrypted : new TextEncoder().encode(code);
    for (const path of [`/api/modules/${mod.id}/raw`, `/api/modules/${mod.id}`, `/${mod.id}`, `/${mod.id}.js`, `/api/modules/${mod.id}.js`]) {
      const response = await api(base, path);
      assert.equal(response.status, 200, path);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes, path);
    }
    assert.equal(mods.find(m => m.id === mod.id).is_encrypted, old.mods[i].is_encrypted ? 1 : 0);
  }
  const collections = await (await api(base, '/api/admin/collections', { cookie })).json();
  assert.equal(collections.find(c => c.id === old.cols[2].id).owner, 'pub');
  const backups = readdirSync(join(directory, 'backups'));
  assert.equal(backups.length, 1);
  const snapshot = new DatabaseSync(join(directory, 'backups', backups[0]));
  assert.equal(new TextDecoder().decode(snapshot.prepare('SELECT value FROM kv WHERE key = ?').get('admin_password').value), old.oldPassword);
  assert.equal(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='modules'").get(), undefined);
  snapshot.close();
  const inspect = new DatabaseSync(join(directory, 'rex.sqlite'));
  assert.equal(new TextDecoder().decode(inspect.prepare('SELECT value FROM kv WHERE key=?').get('subscribers').value), old.subscribers);
  assert.match(inspect.prepare('SELECT value FROM settings WHERE key=?').get('admin_password').value, /^pbkdf2\$/);
  inspect.close();
  // Existing Unicode/hyphen paths must still be editable without changing them.
  assert.equal((await api(base, '/api/admin/collections', { cookie, method: 'PATCH', json: { id: old.cols[0].id, slug: old.cols[0].slug, description: 'updated' } })).status, 200);
  await close(server); server = null;
  ({ server, base } = await listen({ DATA_DIR: directory, PUBLIC_URL: stable }));
  cookie = await login(base, 'changed-password');
  assert.equal((await (await api(base, '/api/admin/modules', { cookie })).json()).length, 2);
  assert.equal(readdirSync(join(directory, 'backups')).length, 1);
  assert.equal((await (await api(base, old.snapshots[1][0])).json()).widgets.length, 2);
});

test('migration failure is fail-closed and rolls back schema/data, keeping a recoverable pre-upgrade snapshot', async (t) => {
  const directory = temporary(t), filename = join(directory, 'rex.sqlite');
  const kv = new SQLiteKV(filename);
  const original = JSON.stringify([{ id: 'missing-file', filename: 'lost.js' }]);
  await kv.put('modules', original);
  kv.close();
  await assert.rejects(createHubServer({ DATA_DIR: directory, ADMIN_SECRET: 'password' }), /缺少文件/);
  await assert.rejects(createHubServer({ DATA_DIR: directory, ADMIN_SECRET: 'password' }), /缺少文件/);
  const db = new DatabaseSync(filename);
  assert.equal(new TextDecoder().decode(db.prepare('SELECT value FROM kv WHERE key=?').get('modules').value), original);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='settings'").get(), undefined);
  db.close();
  assert.equal(readdirSync(join(directory, 'backups')).length, 1);
});

test('explicit backup opt-out migrates without snapshots and normal restart does not create one', async (t) => {
  const directory = temporary(t), old = await seedLegacy(directory);
  let current = await listen({ DATA_DIR: directory, SKIP_UPGRADE_BACKUP: 'true', DISABLE_SCHEDULER: 'true', PUBLIC_URL: stable });
  t.after(async () => { if (current) await close(current.server); });
  assert.equal(existsSync(join(directory, 'backups')), false);
  for (const [path, expected] of old.snapshots) assert.deepEqual(await (await api(current.base, path)).json(), expected);
  await close(current.server); current = null;
  current = await listen({ DATA_DIR: directory, DISABLE_SCHEDULER: 'true', PUBLIC_URL: stable });
  assert.equal(existsSync(join(directory, 'backups')), false);
  for (const [path, expected] of old.snapshots) assert.deepEqual(await (await api(current.base, path)).json(), expected);
});

test('backup opt-out validates before database creation and migration failure still rolls back', async (t) => {
  const directory = temporary(t), filename = join(directory, 'rex.sqlite');
  await assert.rejects(createHubServer({ DATA_DIR: directory, SKIP_UPGRADE_BACKUP: 'yes' }), /SKIP_UPGRADE_BACKUP/);
  assert.equal(existsSync(filename), false);
  const kv = new SQLiteKV(filename), original = JSON.stringify([{ id: 'missing-file', filename: 'lost.js' }]);
  await kv.put('modules', original); kv.close();
  await assert.rejects(createHubServer({ DATA_DIR: directory, ADMIN_SECRET: 'password', SKIP_UPGRADE_BACKUP: 'true' }), /缺少文件/);
  const db = new DatabaseSync(filename);
  assert.equal(new TextDecoder().decode(db.prepare('SELECT value FROM kv WHERE key=?').get('modules').value), original);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='settings'").get(), undefined);
  db.close();
  assert.equal(existsSync(join(directory, 'backups')), false);
});

test('legacy fallback widget IDs and filename titles do not change under the newer metadata parser', async (t) => {
  const directory = temporary(t), kv = new SQLiteKV(join(directory, 'rex.sqlite'));
  const sources = [
    'WidgetMetadata = {"id": "quoted.id", "title": "Quoted"};',
    '//'.padEnd(3000, 'x') + '\nWidgetMetadata = { id: "late.id" };',
    'WidgetMetadata = { id: "early.id" };'
  ];
  const mods = sources.map((source, i) => ({ id: crypto.randomUUID(), filename: 'fallback' + i + '.js', title: '', version: '', author: '', is_encrypted: false }));
  await kv.put('modules', JSON.stringify(mods));
  for (const [i, m] of mods.entries()) await kv.put('file:' + m.id, sources[i]);
  await kv.put('collections', JSON.stringify([{ id: 'fallback-col', title: 'Fallback', slug: 'fallback', moduleIds: mods.map(m => m.id) }]));
  const expected = await (await legacyWorker.fetch(new Request(stable + '/api/collections/fallback.rex'), { REX_KV: kv, ADMIN_SECRET: 'password', ALLOW_HTTP: true })).json();
  kv.close();
  const { server, base } = await listen({ DATA_DIR: directory, ADMIN_SECRET: 'password', PUBLIC_URL: stable });
  t.after(() => close(server));
  assert.deepEqual(await (await api(base, '/api/collections/fallback.rex')).json(), expected);
});
