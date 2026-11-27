// 3.5.4：链接模块自动刷新不再被失败模块卡住、内容不变不重写、直链 304、机密重置密码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import worker, { bootstrap } from '../worker.js';
import { firstMatch } from '../auto-rules.js';
import { temporary } from './helpers.js';

const HOUR = 3600000;
const body = n => `var WidgetMetadata={id:'link-${n}',title:'Link ${n}',version:'1.0.${n}'};`;
const sha = text => createHash('sha256').update(text).digest('hex');

async function makeEnv(t, fetchImpl, extra = {}) {
  const kv = new SQLiteKV(join(temporary(t), 'rex.sqlite'));
  t.after(() => kv.db.close());
  const env = { KV: kv, DB: new SQLiteD1(kv.db, kv.gate), ATOMIC: work => kv.transaction(work),
    REMOTE_FETCH: fetchImpl, SOURCE_URL_POLICY: { assertUrl: raw => new URL(raw) }, ...extra };
  await kv.transaction(() => bootstrap(env));
  return env;
}
async function tick(env) {
  let job; await worker.scheduled({}, env, { waitUntil: p => { job = p; } }); await job;
}
async function addLink(env, id, url, updatedAt, content) {
  await env.DB.prepare(`INSERT INTO modules(id,filename,title,source_url,created_at,updated_at,content_hash,title_scan_v1)
    VALUES(?,?,?,?,?,?,?,1)`).bind(id, id + '.js', id, url, updatedAt, updatedAt, content ? sha(content) : '').run();
  if (content) await env.KV.put('file:' + id, new TextEncoder().encode(content), { metadata: { u: updatedAt, s: content.length } });
}

test('3.5.4 failing link modules back off instead of starving the rest of the refresh queue', async t => {
  const hits = [];
  const env = await makeEnv(t, async url => {
    hits.push(url);
    if (url.includes('/bad')) return new Response('nope', { status: 500 });
    return new Response(body(9), { headers: { 'content-type': 'application/javascript' } });
  });
  const old = Date.now() - 30 * HOUR;
  for (let i = 0; i < 4; i++) await addLink(env, 'bad' + i, 'https://up.example/bad' + i + '.js', old - i);
  await addLink(env, 'good', 'https://up.example/good.js', old + 1000);
  await tick(env);
  assert.equal(hits.filter(u => u.includes('/bad')).length, 4);
  assert.equal(hits.some(u => u.includes('/good')), false, '同一轮只处理 4 个');
  await tick(env);
  assert.ok(hits.some(u => u.includes('/good')), '失败的模块 6 小时内不再排在队首，第二轮轮到 good');
  assert.equal(hits.filter(u => u.includes('/bad')).length, 4, '失败的模块不会每 5 分钟重试');
  const good = await env.DB.prepare('SELECT version,content_hash FROM modules WHERE id=?').bind('good').first();
  assert.equal(good.version, '1.0.9');
  assert.equal(good.content_hash, sha(body(9)));
});

test('3.5.4 unchanged link content is not rewritten, so ETag and updated_at stay stable', async t => {
  const env = await makeEnv(t, async () => new Response(body(1)));
  const old = Date.now() - 30 * HOUR;
  await addLink(env, 'same', 'https://up.example/same.js', old, body(1));
  await tick(env);
  const row = await env.DB.prepare('SELECT updated_at,link_checked_at FROM modules WHERE id=?').bind('same').first();
  assert.equal(row.updated_at, old);
  assert.ok(row.link_checked_at > old);
  const meta = (await env.KV.getWithMetadata('file:same', 'text')).metadata;
  assert.equal(meta.u, old);
});

test('3.5.4 direct /<id>.js download answers If-None-Match with 304', async t => {
  const env = await makeEnv(t, async () => new Response(''), { ADMIN_PASSWORD: 'secret-one-1' });
  const id = '11111111-2222-3333-4444-555555555555', when = Date.now();
  await addLink(env, id, '', when, body(2));
  const first = await worker.fetch(new Request('https://hub.example/' + id + '.js'), env, {});
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const again = await worker.fetch(new Request('https://hub.example/' + id + '.js', { headers: { 'If-None-Match': etag } }), env, {});
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
});

test('3.5.4 changing the ADMIN_PASSWORD secret resets a forgotten password; the old secret never comes back', async t => {
  const env = await makeEnv(t, async () => new Response(''), { ADMIN_PASSWORD: 'secret-one-1' });
  const login = (password, ip) => worker.fetch(new Request('https://hub.example/api/admin/auth', { method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ password }) }), env, {});
  const first = await login('secret-one-1', '198.51.100.1');
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  // 在管理页改了密码以后，机密没换，机密不能再登录。
  const changed = await worker.fetch(new Request('https://hub.example/api/admin/change-password', { method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify({ password: 'ui-password-9' }) }), env, {});
  assert.equal(changed.status, 200);
  assert.equal((await login('secret-one-1', '198.51.100.2')).status, 401);
  assert.equal((await login('ui-password-9', '198.51.100.3')).status, 200);
  // 忘记密码：在 Cloudflare 换机密，新机密生效，并退出旧会话。
  env.ADMIN_PASSWORD = 'secret-two-2';
  assert.equal((await login('ui-password-wrong', '198.51.100.4')).status, 401);
  assert.equal((await login('secret-two-2', '198.51.100.5')).status, 200);
  const authed = await worker.fetch(new Request('https://hub.example/api/admin/auth', { headers: { Cookie: cookie } }), env, {});
  assert.equal((await authed.json()).authenticated, false);
  assert.equal((await login('ui-password-9', '198.51.100.6')).status, 401);
  assert.equal((await login('secret-two-2', '198.51.100.7')).status, 200);
});

test('3.5.4 auto-rule matching keeps its semantics with cached keywords', () => {
  const rules = [{ kw: '短剧, 动漫', fields: ['title'] }, { kw: 'Bolin', fields: ['author', 'sub'] }];
  assert.equal(firstMatch(rules, { title: '热门动漫合集' }), rules[0]);
  assert.equal(firstMatch(rules, { title: 'x', author: 'bolinxxlin' }), rules[1]);
  assert.equal(firstMatch(rules, { title: 'x', sub: 'BOLIN 订阅' }), rules[1]);
  assert.equal(firstMatch(rules, { title: '电影', author: 'other' }), null);
});
