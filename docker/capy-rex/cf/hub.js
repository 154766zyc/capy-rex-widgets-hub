// The whole Hub runs inside ONE SQLite-backed Durable Object ("hub").
// It plays the role of Docker's server.js: one storage connection, one env,
// serialized commits, restore jobs and the background scheduler.
import { DurableObject } from 'cloudflare:workers';
import worker, { bootstrap, parseMeta, isEncrypted } from '../worker.js';
import { createRestoreJobs, restoreRoute, RESTORE_ROOT } from '../restore-jobs.js';
import { createSourcePolicy } from '../remote.js';
import { createStorage } from './do-storage.js';
import { isHomeUpload } from '../home-configs.js';

export const CF_VERSION = '3.6.0';
const GC_INTERVAL = 6 * 60 * 60 * 1000;
const BUSY_LIMIT = 64;
const FULL_INTERVAL = 60 * 1000;
// 3.6.0：没有到点的工作时，闹钟最多睡 1 小时（原来 15 分钟），Cron 只当保底。
const IDLE_WAIT = 60 * 60 * 1000;

// 3.6.0：读多写少的 GET 结果放在内存里。数据库只要有任何写入（DOSql.writes 变化）就整体作废，
// 所以不会返回旧数据。公开的合集订阅（.rex）人人可读；管理页列表要先确认已登录。
// Rex 每次刷新订阅、管理页每次打开，原来都要把合集 / 全部模块重读一遍。
const CACHE_MAX_ENTRIES = 64, CACHE_MAX_BYTES = 16 * 1024 * 1024;
const PUBLIC_CACHE = /^\/api\/collections\/[^/]+$/;
const ADMIN_CACHE = new Set(['/api/admin/modules', '/api/admin/collections', '/api/admin/groups']);
const etagMatches = (sent, etag) => !!etag && String(sent || '').split(',').some(tag => tag.trim() === etag || tag.trim() === '*');
class ResponseCache {
  constructor(sql) { this.sql = sql; this.entries = new Map(); this.bytes = 0; this.seq = -1; this.hits = 0; this.misses = 0; }
  sync() { if (this.seq !== this.sql.writes) { this.entries.clear(); this.bytes = 0; this.seq = this.sql.writes; } }
  get(key) {
    this.sync();
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); this.hits++; } else this.misses++;
    return entry;
  }
  put(key, entry, seq) {
    this.sync();
    if (seq !== this.seq || entry.body.byteLength > CACHE_MAX_BYTES / 4) return;
    this.entries.set(key, entry); this.bytes += entry.body.byteLength;
    for (const [k, v] of this.entries) {
      if (this.entries.size <= CACHE_MAX_ENTRIES && this.bytes <= CACHE_MAX_BYTES) break;
      this.entries.delete(k); this.bytes -= v.body.byteLength;
    }
  }
  reply(entry, request) {
    const headers = new Headers(entry.headers);
    if (etagMatches(request.headers.get('If-None-Match'), headers.get('ETag'))) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : entry.body.slice(), { status: entry.status, headers });
  }
}

function limitFor(path, method) {
  const restoring = restoreRoute(path);
  const largeRestore = restoring && (method === 'PUT' || path === RESTORE_ROOT);
  const homeAdmin = path.startsWith('/api/admin/home-configs');
  // 3.6.0：只有上传、替换、装 HTML 卡片收大请求体；分享开关、换链接、换模块链接只收小 JSON。
  const homeUpload = isHomeUpload(path, method);
  // 3.5.8：文件栏目上传（单个文件 25 MiB）。
  const fileAdmin = path.startsWith('/api/admin/files');
  const fileUpload = (path === '/api/admin/files' && method === 'POST') || (/^\/api\/admin\/files\/[a-f0-9-]{36}$/.test(path) && method === 'PUT');
  // Cloudflare itself rejects request bodies above 100 MB (Free/Pro plans).
  return largeRestore ? 100 * 1024 * 1024 : (homeUpload || fileUpload) ? 26 * 1024 * 1024
    : (restoring || homeAdmin || fileAdmin) ? 32768 : 100 * 1024 * 1024;
}

async function readCapped(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

const jsonReply = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export class RexHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = createStorage(ctx.storage);
    this.responseCache = new ResponseCache(this.store.sql);
    this.queued = 0;
    this.scheduling = null;
    this.lastGc = 0;
    this.lastFull = 0;
    const policy = createSourcePolicy('', { addressCheck: true });
    // One long-lived env object, like Docker: CONTENT_EPOCH and caches live on it.
    this.hubEnv = {
      KV: this.store.kv, DB: this.store.db, ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      REMOTE_FETCH: (url, init) => fetch(url, init), SOURCE_URL_POLICY: policy,
      ATOMIC: work => this.store.atomic(work), CF_VERSION_METADATA: env.CF_VERSION_METADATA,
      // 3.5.8：订阅每轮处理 6 个模块（同时下载仍是 2 个）。
      SYNC_BATCH: 6,
      // 3.5.8：存储用量。免费计划每个 Durable Object 最多 1 GB。
      STORAGE_USAGE: () => ({ used: Number(ctx.storage.sql.databaseSize) || 0, limit: 1024 ** 3, plan: 'free' }),
    };
    this.ready = ctx.blockConcurrencyWhile(() => this.init());
  }

  async init() {
    const { db, atomic, sql } = this.store, env = this.hubEnv;
    await atomic(async () => {
      await bootstrap(env);
      await db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').bind('cf_do_v35', String(Date.now())).run();
      // A restarted object owns no leases or module locks from the previous instance.
      await db.prepare("UPDATE subscription_sources SET lease_until=0,lease_token='' WHERE lease_until<>0").run();
      await db.prepare('DELETE FROM module_write_locks').run();
      await db.prepare("UPDATE icon_sources SET lease_until=0,lease_token='' WHERE lease_until<>0").run();
    });
    // Status polling reads without queueing behind a restore's write gate.
    const reader = { prepare: query => ({ get: (...args) => sql.get(query, args) }), close() {} };
    this.restoreJobs = await createRestoreJobs(env, reader, { parseMeta, isEncrypted });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const env = this.hubEnv, restoreJobs = this.restoreJobs;
    try {
      if (path === '/healthz' && method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return jsonReply({ ok: true, version: CF_VERSION, runtime: 'cloudflare-durable-object' });
      }
      if (this.queued >= BUSY_LIMIT && !path.startsWith(RESTORE_ROOT + '/jobs/')) {
        return new Response('Server busy', { status: 503, headers: { 'Retry-After': '5' } });
      }
      if ((method === 'GET' || method === 'HEAD') && (PUBLIC_CACHE.test(path) || ADMIN_CACHE.has(path))) {
        const admin = ADMIN_CACHE.has(path);
        if (!admin || restoreJobs.authenticated(request.headers)) return await this.cached(request, url, admin);
      }
      const restoring = restoreRoute(path), homeAdmin = path.startsWith('/api/admin/home-configs') || path.startsWith('/api/admin/files');
      // Same rule as Docker: large admin uploads need a session before the body is read.
      if ((restoring || homeAdmin) && !restoreJobs.authenticated(request.headers)) {
        await request.body?.cancel().catch(() => {});
        return jsonReply({ error: 'Unauthorized' }, 401, { Connection: 'close' });
      }
      const limit = limitFor(path, method), declared = request.headers.get('content-length');
      let forwarded = request;
      if (!['GET', 'HEAD'].includes(method)) {
        if (declared !== null && /^\d+$/.test(declared) && Number(declared) <= limit) {
          // Length known and within the limit: pass the body through untouched
          // (no extra in-memory copy — Durable Objects only have 128 MB).
        } else {
          const body = await readCapped(request, limit);
          if (!body) {
            await restoreJobs.failedUpload(path, new Error('请求超过 Cloudflare 上传限制')).catch(() => {});
            return new Response('Request body exceeds limit', { status: 413, headers: { Connection: 'close' } });
          }
          forwarded = new Request(request.url, { method, headers: request.headers, ...(body.length ? { body } : {}) });
        }
      }
      this.queued++;
      let response;
      try {
        const ctx = { waitUntil: promise => this.ctx.waitUntil(promise), passThroughOnException() {} };
        response = restoring ? await restoreJobs.handle(forwarded)
          : ['GET', 'HEAD'].includes(method) ? await this.store.gate.run(() => worker.fetch(forwarded, env, ctx))
          : await worker.fetch(forwarded, env, ctx);
      } finally { this.queued--; }
      // A write may have queued subscription work ("全部同步"): start it promptly.
      if (!['GET', 'HEAD'].includes(method) && response.ok) await this.wake(1000);
      return response;
    } catch (error) {
      await restoreJobs?.failedUpload(path, error).catch(() => {});
      console.error('Request failed:', error?.stack || error);
      return jsonReply({ error: 'Internal server error' }, 500);
    }
  }

  // 命中就直接回内存里的结果；没命中就照常算一次（去掉 If-None-Match，拿到完整内容才好缓存），
  // 算的过程中数据库有写入就不缓存。
  async cached(request, url, admin) {
    const key = (admin ? 'a ' : 'p ') + url.href, cache = this.responseCache;
    const hit = cache.get(key);
    if (hit) return cache.reply(hit, request);
    const seq = this.store.sql.writes, headers = new Headers(request.headers);
    headers.delete('If-None-Match');
    const ctx = { waitUntil: promise => this.ctx.waitUntil(promise), passThroughOnException() {} };
    this.queued++;
    let response;
    try { response = await this.store.gate.run(() => worker.fetch(new Request(request.url, { method: 'GET', headers }), this.hubEnv, ctx)); }
    finally { this.queued--; }
    if (response.status !== 200) return request.method === 'HEAD' ? new Response(null, response) : response;
    const entry = { status: 200, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer()) };
    cache.put(key, entry, seq);
    return cache.reply(entry, request);
  }

  async wake(delay) {
    const at = Date.now() + delay, current = await this.ctx.storage.getAlarm();
    if (!current || current > at) await this.ctx.storage.setAlarm(at);
  }

  // Cron entry point (RPC from the Worker): make sure maintenance keeps running.
  async tick() {
    await this.ready;
    await this.runMaintenance(true);
    await this.planNext();
    return { ok: true };
  }

  async alarm() {
    await this.ready;
    try { await this.runMaintenance(); }
    finally { await this.planNext(true); }
  }

  // 参考 Cloudflare《Rules of Durable Objects》：闹钟只在有活时做该做的活。
  // 同步期间闹钟每秒响一次，只推进同步/图标队列；标题扫描、自动分类、链接刷新等完整维护最多每分钟一次，Cron 每次都做。
  async runMaintenance(full = false) {
    if (this.scheduling) return this.scheduling;
    const env = this.hubEnv, now = Date.now();
    const light = !full && now - this.lastFull < FULL_INTERVAL;
    if (!light) this.lastFull = now;
    this.scheduling = (async () => {
      const jobs = [];
      await worker.scheduled({ cron: 'durable-object', light }, env, { waitUntil: p => jobs.push(p) });
      await Promise.all(jobs);
      if (light) return;
      await this.store.kv.cleanup();
      if (Date.now() - this.lastGc > GC_INTERVAL) {
        await this.store.atomic(async () => { this.store.sql.collectGarbage(); });
        this.lastGc = Date.now();
      }
    })().catch(error => console.error('Scheduler:', error?.message || error))
      .finally(() => { this.scheduling = null; });
    return this.scheduling;
  }

  // Queued/batched subscription work continues about once per second, like
  // Docker's timer; otherwise sleep until the next due source (max 1 hour since 3.6.0).
  async planNext(fromAlarm = false) {
    const now = Date.now(), DB = this.hubEnv.DB;
    const busy = await DB.prepare(`SELECT 1 FROM subscription_sources WHERE enabled=1 AND lease_until<?
      AND (status='syncing' OR next_sync_at<=?) LIMIT 1`).bind(now, now).first()
      || await DB.prepare('SELECT 1 FROM icon_sources WHERE enabled=1 AND next_sync_at<=? AND lease_until<? LIMIT 1').bind(now, now).first();
    if (busy) return this.ctx.storage.setAlarm(now + 1000);
    const next = await DB.prepare(`SELECT MIN(t) AS t FROM (
      SELECT MIN(next_sync_at) AS t FROM subscription_sources WHERE enabled=1
      UNION ALL SELECT MIN(next_sync_at) FROM icon_sources WHERE enabled=1)`).first('t');
    // No enabled source at all: just sleep the full interval (cron still wakes us).
    const wait = next == null ? IDLE_WAIT : Math.min(IDLE_WAIT, Math.max(5000, Number(next) - now));
    // 3.6.0：每次 setAlarm 都算 1 行写入。Cron 每 5 分钟都会走到这里；已经有一个更早（或差不多时间）的闹钟就不重设，
    // 它响的时候会重新算下一次。只有需要提前（有源更早到期）或者没有闹钟时才写。
    // 闹钟回调里刚响过的那个闹钟已经用掉了，一定要重设。
    const target = now + wait, current = fromAlarm ? null : await this.ctx.storage.getAlarm();
    if (current && current > now && current <= target + 60 * 1000) return;
    return this.ctx.storage.setAlarm(target);
  }
}
