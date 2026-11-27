import { moduleStatement, syncAutoAll, sourceGeneration } from './v21-backup.js';
import { assertFetchableUrl, fetchRemote, assertModuleFile } from '../../remote.js';

export const SYNC_INTERVAL = 6 * 60 * 60 * 1000;
export const SOURCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'queued', generation INTEGER DEFAULT 0,
    last_attempt_at INTEGER, last_success_at INTEGER, next_sync_at INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER DEFAULT 0, updated_count INTEGER DEFAULT 0, unchanged_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0, removed_count INTEGER DEFAULT 0, last_error TEXT DEFAULT '',
    created_at INTEGER, updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS source_items (
    source_id TEXT NOT NULL, remote_key TEXT NOT NULL, remote_id TEXT DEFAULT '', identity TEXT NOT NULL,
    url TEXT NOT NULL, module_id TEXT, title TEXT DEFAULT '', version TEXT DEFAULT '', author TEXT DEFAULT '',
    description TEXT DEFAULT '', position INTEGER DEFAULT 0, removed_at INTEGER, last_error TEXT DEFAULT '',
    last_seen_at INTEGER, last_success_at INTEGER, PRIMARY KEY (source_id, remote_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_source_items_module ON source_items(module_id)',
  'CREATE INDEX IF NOT EXISTS idx_source_items_identity ON source_items(identity)',
  'CREATE INDEX IF NOT EXISTS idx_source_items_url ON source_items(url)'
];

export async function listSources(DB) {
  const { results: sources } = await DB.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  const { results: items } = await DB.prepare('SELECT * FROM source_items ORDER BY source_id, position').all();
  return sources.map(s => ({ ...s, interval_hours: 6, items: items.filter(i => i.source_id === s.id) }));
}

export async function registerSource(DB, raw, title = '') {
  const url = assertFetchableUrl(raw).href;
  const existing = await DB.prepare('SELECT * FROM sources WHERE url = ?').bind(url).first();
  if (existing) {
    if (!['queued', 'syncing'].includes(existing.status)) await DB.prepare("UPDATE sources SET enabled=1,status='queued',next_sync_at=0,generation=generation+1 WHERE id=?").bind(existing.id).run();
    return { ok: true, kind: 'source', id: existing.id, existing: true };
  }
  const count = await DB.prepare('SELECT COUNT(*) AS n FROM sources').first();
  if (count.n >= 100) throw new Error('最多保存 100 个订阅源');
  const id = crypto.randomUUID(), now = Date.now();
  await DB.prepare('INSERT INTO sources (id,url,title,generation,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, url, String(title || '').slice(0, 200), sourceGeneration(), now, now).run();
  return { ok: true, kind: 'source', id };
}

export function parseManifest(bytes, base) {
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('订阅源不是有效的 JSON 合集，原模块状态未改变'); }
  if (!manifest || !Array.isArray(manifest.widgets)) throw new Error('订阅源缺少 widgets 数组，原模块状态未改变');
  if (manifest.widgets.length > 500) throw new Error('单个订阅源最多 500 个模块');
  const seen = new Set(), origin = new URL(base).origin;
  const items = manifest.widgets.map((w, position) => {
    if (!w || typeof w.url !== 'string' || !w.url.trim()) throw new Error('合集含无效模块地址，已中止同步');
    const url = assertFetchableUrl(new URL(w.url, base).href).href;
    const remoteId = typeof w.id === 'string' ? w.id.trim().slice(0, 500) : '';
    const key = remoteId ? 'id:' + remoteId : 'url:' + url;
    if (seen.has(key)) throw new Error('合集含重复模块 ID，已中止同步');
    seen.add(key);
    return { key, identity: remoteId ? origin + '\n' + remoteId : url, remoteId, url, position,
      title: String(w.title || '').slice(0, 200), version: String(w.version || '').slice(0, 64),
      author: String(w.author || '').slice(0, 120), description: String(w.description || '').slice(0, 2000) };
  });
  return { title: String(manifest.title || '').slice(0, 200), items };
}

async function recordItem(DB, source, item, moduleId, error, now, success) {
  await DB.prepare(`INSERT INTO source_items
    (source_id,remote_key,remote_id,identity,url,module_id,title,version,author,description,position,removed_at,last_error,last_seen_at,last_success_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(source_id,remote_key) DO UPDATE SET
    remote_id=excluded.remote_id,identity=excluded.identity,url=excluded.url,module_id=COALESCE(excluded.module_id,source_items.module_id),
    title=excluded.title,version=excluded.version,author=excluded.author,description=excluded.description,
    position=excluded.position,removed_at=NULL,last_error=excluded.last_error,last_seen_at=excluded.last_seen_at,
    last_success_at=COALESCE(excluded.last_success_at,source_items.last_success_at)`)
    .bind(source.id, item.key, item.remoteId, item.identity, item.url, moduleId, item.title, item.version, item.author,
      item.description, item.position, error, now, success ? now : null).run();
}

async function findModule(DB, sourceId, item) {
  // Stable ID within this subscription wins over a changed URL. Across sources,
  // share by exact URL or ID scoped to its provider. Never use a display name.
  for (const [sql, args] of [
    ['SELECT DISTINCT m.* FROM modules m JOIN source_items i ON i.module_id=m.id WHERE i.source_id=? AND i.remote_key=?', [sourceId, item.key]],
    ['SELECT DISTINCT m.* FROM modules m JOIN source_items i ON i.module_id=m.id WHERE i.url=? OR i.identity=?', [item.url, item.identity]],
    ['SELECT * FROM modules WHERE source_url=?', [item.url]]
  ]) {
    const { results } = await DB.prepare(sql).bind(...args).all();
    if (results.length > 1) throw new Error('来源身份冲突，请先检查重复模块；未覆盖本地文件');
    if (results.length) return results[0];
  }
  return null;
}

async function updateItem(env, source, item, bytes, now, helpers) {
  const DB = env.DB, old = await findModule(DB, source.id, item);
  const meta = helpers.parseMeta('', bytes.subarray(0, 32768));
  const id = old?.id || crypto.randomUUID();
  const filename = old?.filename || (new URL(item.url).pathname.split('/').pop() || id).replace(/[^\w.\-]/g, '_').replace(/(?:\.js)?$/i, '.js');
  const module = { ...old, id, filename, widget_id: old?.widget_id || item.remoteId || meta.id || id,
    title: item.title || meta.title || old?.title || filename.replace(/\.js$/i, ''),
    version: item.version || meta.version || old?.version || '', author: item.author || meta.author || old?.author || '',
    file_size: bytes.byteLength, is_encrypted: helpers.isEncrypted(bytes), source_url: item.url,
    note: old?.note || '', sort_order: old?.sort_order ?? (await DB.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM modules').first()).n,
    group_id: old?.group_id || '', legacy_json: old?.legacy_json || '{}', created_at: old?.created_at || now, updated_at: now };
  const previous = old ? new Uint8Array(await env.KV.get('file:' + old.id, 'arrayBuffer') || new ArrayBuffer(0)) : null;
  const changed = !previous || previous.length !== bytes.length || previous.some((v, i) => v !== bytes[i]) ||
    ['title', 'version', 'author', 'source_url', 'is_encrypted'].some(k => old[k] !== module[k]);
  if (changed) {
    await env.KV.put('file:' + id, bytes, { metadata: { u: now, s: bytes.byteLength } });
    await moduleStatement(DB, module).run();
  }
  // Only explicitly enabled legacy autoAll collections opt in. Normal personal
  // collections are never touched by a source's additions/reordering/removals.
  if (!old) await syncAutoAll(DB, [id]);
  await recordItem(DB, source, item, id, '', now, true);
  return old ? (changed ? 'updated' : 'unchanged') : 'added';
}

// Network work occurs OUTSIDE SQLite transactions. Each downloaded file is
// committed using the server's serial transaction queue and latest local notes.
export function createSourceSynchronizer(env, { write, parseMeta, isEncrypted,
  fetchFile = (url,max,options) => fetchRemote(url,max,{ ...options, transport:env.REMOTE_FETCH || globalThis.fetch }), now = Date.now }) {
  const abort = new AbortController();
  let active = null, stopped = false;
  async function current(source) {
    if (stopped) return false;
    const row = await env.DB.prepare('SELECT enabled,generation FROM sources WHERE id=?').bind(source.id).first();
    return row?.enabled && row.generation === source.generation;
  }
  async function guarded(source, fn) {
    if (stopped) return;
    return write(async () => { if (await current(source)) return fn(); });
  }
  async function sync(source) {
    const start = now();
    const counts = { added: 0, updated: 0, unchanged: 0, failed: 0, removed: 0 };
    const errors = [];
    let manifest;
    try {
      const file = await fetchFile(source.url, 1024 * 1024, { signal: abort.signal });
      // Scope identity to the originally subscribed provider, even after CDN redirects.
      manifest = parseManifest(file.bytes, file.url || source.url);
      for (const item of manifest.items) if (item.remoteId) item.identity = new URL(source.url).origin + '\n' + item.remoteId;
    } catch (error) {
      await guarded(source, () => env.DB.prepare(`UPDATE sources SET status='error',last_error=?,failed_count=1,
        next_sync_at=?,updated_at=? WHERE id=?`).bind(String(error.message).slice(0, 2000), start + SYNC_INTERVAL, now(), source.id).run());
      return;
    }
    for (const item of manifest.items) {
      if (stopped || !await write(() => current(source))) return;
      try {
        const file = await fetchFile(item.url, 25 * 1024 * 1024, { signal: abort.signal });
        assertModuleFile(file.bytes, file.contentType);
        const result = await guarded(source, () => updateItem(env, source, item, file.bytes, now(), { parseMeta, isEncrypted }));
        if (!result) return;
        counts[result]++;
      } catch (error) {
        counts.failed++;
        const message = (item.title || item.remoteId || item.url) + '：' + error.message;
        errors.push(message);
        await guarded(source, async () => {
          const existing = await findModule(env.DB, source.id, item).catch(() => null);
          await recordItem(env.DB, source, item, existing?.id || null, String(error.message).slice(0, 1000), now(), false);
        });
      }
    }
    await guarded(source, async () => {
      const keys = new Set(manifest.items.map(i => i.key));
      const { results } = await env.DB.prepare('SELECT remote_key FROM source_items WHERE source_id=? AND removed_at IS NULL').bind(source.id).all();
      for (const item of results) if (!keys.has(item.remote_key)) {
        await env.DB.prepare('UPDATE source_items SET removed_at=?,last_error=? WHERE source_id=? AND remote_key=?')
          .bind(now(), '', source.id, item.remote_key).run(); counts.removed++;
      }
      await env.DB.prepare(`UPDATE sources SET title=?,status=?,last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,
        next_sync_at=?,added_count=?,updated_count=?,unchanged_count=?,failed_count=?,removed_count=?,last_error=?,updated_at=? WHERE id=?`)
        .bind(source.title || manifest.title || '未命名订阅源', counts.failed ? 'partial' : 'success', counts.failed, now(),
          now() + SYNC_INTERVAL, counts.added, counts.updated, counts.unchanged, counts.failed, counts.removed,
          errors.slice(0, 20).join('\n').slice(0, 4000), now(), source.id).run();
    });
  }
  async function work() {
    const due = await write(async () => {
      if (stopped) return [];
      return (await env.DB.prepare('SELECT * FROM sources WHERE enabled=1 AND next_sync_at<=? ORDER BY next_sync_at LIMIT 100').bind(now()).all()).results;
    });
    for (const source of due) {
      if (stopped) break;
      const claimed = await guarded(source, async () => {
        await env.DB.prepare(`UPDATE sources SET status='syncing',last_attempt_at=?,added_count=0,updated_count=0,
          unchanged_count=0,failed_count=0,removed_count=0,last_error='' WHERE id=?`).bind(now(), source.id).run();
        return true;
      });
      if (!claimed) continue;
      try { await sync(source); }
      catch (error) { await guarded(source, () => env.DB.prepare("UPDATE sources SET status='error',last_error=?,next_sync_at=? WHERE id=?").bind(String(error.message).slice(0, 2000), now() + SYNC_INTERVAL, source.id).run()); }
    }
  }
  function kick() {
    if (stopped) return Promise.resolve();
    if (!active) active = work().catch(error => console.error('[sources]', error.message)).finally(() => { active = null; });
    return active;
  }
  return { kick, get busy() { return !!active; }, stop() { stopped = true; abort.abort(); return active || Promise.resolve(); } };
}
