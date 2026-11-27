// Versioned, byte-safe backups. IDs, slugs and aliases are identities, not hints.
import { assertFetchableUrl } from '../../remote.js';
// A restored/deleted-and-recreated source must not reuse an in-flight epoch.
// Stay below Number.MAX_SAFE_INTEGER, leaving room for SQL generation + 1.
export function sourceGeneration() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0xfffff) * 0x100000000 + words[1];
}
export function moduleStatement(DB, module) {
  const fields = ['id', 'filename', 'widget_id', 'title', 'version', 'author', 'file_size',
    'is_encrypted', 'source_url', 'note', 'sort_order', 'group_id', 'legacy_json', 'created_at', 'updated_at'];
  return DB.prepare(`INSERT INTO modules (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${fields.slice(1).map(k => k + '=excluded.' + k).join(',')}`)
    .bind(...fields.map(key => module[key] ?? null));
}

export async function syncAutoAll(DB, newIds = null) {
  if (newIds) {
    for (const id of newIds) await DB.prepare(`INSERT OR IGNORE INTO collection_modules (collection_id,module_id,position)
      SELECT c.id, ?, COALESCE((SELECT MAX(position) + 1 FROM collection_modules WHERE collection_id = c.id), 0)
      FROM collections c WHERE c.auto_all = 1`).bind(id).run();
    return;
  }
  await DB.prepare(`INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position)
    SELECT c.id, m.id, COALESCE((SELECT MAX(position) + 1 FROM collection_modules WHERE collection_id = c.id), 0)
      + ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.sort_order, m.created_at DESC)
    FROM collections c CROSS JOIN modules m WHERE c.auto_all = 1`).run();
}

export async function setCollectionSlug(DB, id, slug) {
  const current = await DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first();
  if (!current || current.slug === slug) return;
  const row = await DB.prepare('SELECT id FROM collections WHERE slug = ?').bind(slug).first();
  const alias = await DB.prepare('SELECT collection_id FROM collection_aliases WHERE slug = ?').bind(slug).first();
  if ((row && row.id !== id) || (alias && alias.collection_id !== id)) {
    throw new Error('路径已被其他合集或历史订阅地址占用：' + slug);
  }
  await DB.batch([
    DB.prepare('DELETE FROM collection_aliases WHERE slug = ? AND collection_id = ?').bind(slug, id),
    DB.prepare('INSERT OR REPLACE INTO collection_aliases (slug, collection_id) VALUES (?, ?)').bind(current.slug, id),
    DB.prepare('UPDATE collections SET slug = ? WHERE id = ?').bind(slug, id)
  ]);
}

function identity(value, name) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\/\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('无效的' + name);
  }
  return value;
}
function recordId(value, name) {
  identity(value, name);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('无效的' + name);
  return value;
}
function legacyJSON(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效的兼容元数据');
  return value;
}
function base64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 16384) value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(value);
}

export async function exportBackup(env) {
  const { results: modules } = await env.DB.prepare('SELECT * FROM modules ORDER BY sort_order, created_at DESC').all();
  const { results: cols } = await env.DB.prepare('SELECT * FROM collections ORDER BY created_at DESC').all();
  const { results: groups } = await env.DB.prepare('SELECT * FROM groups ORDER BY position').all();
  const { results: aliases } = await env.DB.prepare('SELECT * FROM collection_aliases').all();
  const { results: sources } = await env.DB.prepare('SELECT * FROM sources').all();
  const { results: sourceItems } = await env.DB.prepare('SELECT * FROM source_items').all();
  const files = Object.create(null);
  for (const m of modules) {
    const bytes = await env.KV.get('file:' + m.id, 'arrayBuffer');
    if (!bytes) throw new Error('模块文件缺失：' + m.id + '，已中止导出');
    files[m.id] = { filename: m.filename, encoding: 'base64', content: base64(new Uint8Array(bytes)) };
  }
  const collections = [];
  for (const c of cols) {
    const { results } = await env.DB.prepare('SELECT module_id FROM collection_modules WHERE collection_id = ? ORDER BY position').bind(c.id).all();
    collections.push({ ...JSON.parse(c.legacy_json || '{}'), ...c, autoAll: !!c.auto_all, moduleIds: results.map(r => r.module_id) });
  }
  return { format: 3, meta: { modules, collections, groups, aliases, sources, sourceItems, exportedAt: new Date().toISOString() }, files };
}

export async function restoreBackup(env, body, parseMeta, isEncrypted) {
  const DB = env.DB;
  if (!body || typeof body.files !== 'object' || !body.files || Array.isArray(body.files)) throw new Error('备份缺少模块文件');
  if (body.format !== undefined && ![1, 2, 3].includes(body.format)) throw new Error('不支持的备份版本');
  const { results: existingMods } = await DB.prepare('SELECT * FROM modules').all();
  const { results: existingCols } = await DB.prepare('SELECT * FROM collections').all();
  const { results: existingAliases } = await DB.prepare('SELECT * FROM collection_aliases').all();
  const oldMods = new Map(existingMods.map(m => [m.id, m]));
  const oldCols = new Map(existingCols.map(c => [c.id, c]));
  const slugOwner = new Map([...existingCols.map(c => [c.slug, c.id]), ...existingAliases.map(a => [a.slug, a.collection_id])]);
  const meta = body.meta || {};
  for (const key of ['modules', 'collections', 'groups', 'aliases', 'sources', 'sourceItems']) {
    if (meta[key] !== undefined && !Array.isArray(meta[key])) throw new Error('无效的备份字段：' + key);
  }
  const records = new Map((meta.modules || []).map(m => [m.id, m]));
  const modules = [], files = [], collections = [], groups = [], aliases = [];
  const now = Date.now();
  for (const [rawId, file] of Object.entries(body.files)) {
    const id = recordId(rawId, '模块 ID');
    if (!file || typeof file.content !== 'string' || file.error) throw new Error('模块备份不完整：' + id);
    let bytes;
    if (file.encoding === 'base64') {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw new Error('无效的 base64：' + id);
      bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
    } else {
      if (file.encoding && file.encoding !== 'text') throw new Error('未知文件编码：' + id);
      bytes = new TextEncoder().encode(file.content);
    }
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('模块超过 25 MiB：' + id);
    const old = oldMods.get(id) || {};
    const saved = records.get(id) || {};
    const filename = file.filename || saved.filename || old.filename || 'restored.js';
    const parsed = parseMeta(filename, bytes.subarray(0, 32768));
    const m = { ...old, ...saved, id, filename,
      widget_id: saved.widget_id || parsed.id || old.widget_id || id,
      title: saved.title || parsed.title || old.title || filename.replace(/\.js$/i, ''),
      version: saved.version ?? parsed.version ?? old.version ?? '',
      author: saved.author ?? parsed.author ?? old.author ?? '',
      file_size: bytes.byteLength, is_encrypted: (saved.is_encrypted ?? old.is_encrypted ?? isEncrypted(bytes)) ? 1 : 0,
      source_url: saved.source_url ?? file.source_url ?? old.source_url ?? null,
      note: saved.note ?? old.note ?? '', group_id: saved.group_id ?? old.group_id ?? '',
      sort_order: saved.sort_order ?? old.sort_order ?? modules.length,
      legacy_json: legacyJSON(saved.legacy_json || old.legacy_json || JSON.stringify(saved)),
      created_at: saved.created_at || old.created_at || now, updated_at: now };
    modules.push(m);
    files.push([id, bytes]);
    oldMods.set(id, m);
  }
  for (const saved of records.values()) if (!oldMods.has(saved.id)) throw new Error('备份缺少文件：' + saved.id);
  for (const g of meta.groups || []) {
    groups.push({ id: recordId(g.id, '分组 ID'), name: String(g.name || ''), position: Number(g.position) || 0, created_at: Number(g.created_at) || now });
  }
  const seen = new Set();
  for (const c of meta.collections || body.collections || []) {
    const id = recordId(c.id || slugOwner.get(c.slug) || crypto.randomUUID(), '合集 ID');
    if (seen.has(id)) throw new Error('备份含重复合集 ID：' + id);
    seen.add(id);
    const old = oldCols.get(id) || {};
    const slug = identity(c.slug || old.slug || id, '合集路径');
    if (slugOwner.has(slug) && slugOwner.get(slug) !== id) throw new Error('合集路径冲突，未覆盖已有地址：' + slug);
    slugOwner.set(slug, id);
    const ids = c.moduleIds?.length ? c.moduleIds : (Array.isArray(c.modules) ? c.modules.map(m => m.id) : c.moduleIds || []);
    if (!Array.isArray(ids) || ids.some(mid => !oldMods.has(mid))) throw new Error('合集引用了不存在的模块：' + slug);
    const collection = { id, slug, title: String(c.title || old.title || 'untitled'),
      description: String(c.description || ''), icon_url: String(c.icon_url || ''),
      auto_all: (c.autoAll ?? c.auto_all ?? old.auto_all) ? 1 : 0,
      legacy_json: legacyJSON(c.legacy_json || old.legacy_json || JSON.stringify(c)),
      created_at: c.created_at || old.created_at || now, updated_at: now,
      moduleIds: [...new Set(ids)] };
    collections.push(collection);
    if (old.slug && old.slug !== slug) aliases.push({ slug: old.slug, collection_id: id });
  }
  for (const a of meta.aliases || []) aliases.push({ slug: identity(a.slug, '历史路径'), collection_id: recordId(a.collection_id, '合集 ID') });
  for (const a of aliases) {
    if (!oldCols.has(a.collection_id) && !seen.has(a.collection_id)) throw new Error('历史地址对应的合集不存在：' + a.slug);
    if (slugOwner.has(a.slug) && slugOwner.get(a.slug) !== a.collection_id) throw new Error('历史路径冲突：' + a.slug);
    slugOwner.set(a.slug, a.collection_id);
  }
  const { results: currentSources } = await DB.prepare('SELECT * FROM sources').all();
  const sourceIDs = new Set(currentSources.map(s => s.id));
  const sourceURLs = new Map(currentSources.map(s => [s.url, s.id]));
  const sourceByID = new Map(currentSources.map(s => [s.id, s.url]));
  const sources = [], sourceItems = [];
  for (const s of meta.sources || []) {
    const id = recordId(s.id, '订阅源 ID'), url = assertFetchableUrl(s.url).href;
    if ((sourceURLs.has(url) && sourceURLs.get(url) !== id) || (sourceByID.has(id) && sourceByID.get(id) !== url)) throw new Error('订阅源身份冲突，已中止恢复');
    sources.push({ ...s, id, url }); sourceIDs.add(id); sourceURLs.set(url, id); sourceByID.set(id, url);
  }
  for (const item of meta.sourceItems || []) {
    if (!sourceIDs.has(item.source_id) || (item.module_id && !oldMods.has(item.module_id))) throw new Error('订阅源引用缺失');
    if (typeof item.remote_key !== 'string' || !item.remote_key || typeof item.identity !== 'string' || !item.identity) throw new Error('订阅源条目身份无效');
    sourceItems.push({ ...item, url: assertFetchableUrl(item.url).href });
  }
  // Everything has been validated before any writes. The Docker request wrapper
  // additionally encloses all of these statements AND KV puts in one transaction.
  for (const [id, bytes] of files) await env.KV.put('file:' + id, bytes, { metadata: { u: now, s: bytes.byteLength } });
  await DB.batch(modules.map(m => moduleStatement(DB, m)));
  await DB.batch(groups.map(g => DB.prepare(`INSERT INTO groups (id,name,position,created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position`).bind(g.id, g.name, g.position, g.created_at)));
  for (const c of collections) {
    await setCollectionSlug(DB, c.id, c.slug);
    await DB.prepare(`INSERT INTO collections (id,slug,title,description,icon_url,auto_all,legacy_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,
      description=excluded.description,icon_url=excluded.icon_url,auto_all=excluded.auto_all,legacy_json=excluded.legacy_json,updated_at=excluded.updated_at`)
      .bind(c.id, c.slug, c.title, c.description, c.icon_url, c.auto_all, c.legacy_json, c.created_at, now).run();
    await DB.prepare('DELETE FROM collection_modules WHERE collection_id = ?').bind(c.id).run();
    await DB.batch(c.moduleIds.map((mid, i) => DB.prepare('INSERT INTO collection_modules (collection_id,module_id,position) VALUES (?,?,?)').bind(c.id, mid, i)));
  }
  await DB.batch(aliases.map(a => DB.prepare('INSERT OR REPLACE INTO collection_aliases (slug,collection_id) VALUES (?,?)').bind(a.slug, a.collection_id)));
  for (const s of sources) {
    // Restore provenance without a surprise download: the next sync is six
    // hours away, and can be requested immediately with the manual button.
    await DB.prepare(`INSERT INTO sources (id,url,title,enabled,status,generation,last_attempt_at,last_success_at,next_sync_at,
      added_count,updated_count,unchanged_count,failed_count,removed_count,last_error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,enabled=excluded.enabled,
      status=excluded.status,generation=excluded.generation,last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,
      next_sync_at=excluded.next_sync_at,added_count=excluded.added_count,updated_count=excluded.updated_count,
      unchanged_count=excluded.unchanged_count,failed_count=excluded.failed_count,removed_count=excluded.removed_count,
      last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(s.id,s.url,String(s.title||''),s.enabled?1:0,s.enabled?'idle':'paused',sourceGeneration(),Number(s.last_attempt_at)||null,Number(s.last_success_at)||null,
        now+21600000,Number(s.added_count)||0,Number(s.updated_count)||0,Number(s.unchanged_count)||0,Number(s.failed_count)||0,
        Number(s.removed_count)||0,String(s.last_error||''),Number(s.created_at)||now,now).run();
  }
  for (const item of sourceItems) {
    const keys = ['source_id','remote_key','remote_id','identity','url','module_id','title','version','author','description','position','removed_at','last_error','last_seen_at','last_success_at'];
    await DB.prepare(`INSERT INTO source_items (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})
      ON CONFLICT(source_id,remote_key) DO UPDATE SET ${keys.slice(2).map(k=>k+'=excluded.'+k).join(',')}`)
      .bind(...keys.map(k=>item[k]??null)).run();
  }
  return { ok: true, modules: modules.length, collections: collections.length };
}
