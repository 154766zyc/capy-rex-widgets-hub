const SOURCE_SCHEMA = [
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


const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS modules (
     id TEXT PRIMARY KEY,
     filename TEXT NOT NULL,
     widget_id TEXT,
     title TEXT,
     version TEXT,
     author TEXT,
     file_size INTEGER DEFAULT 0,
     is_encrypted INTEGER DEFAULT 0,
     source_url TEXT,
     note TEXT,
     group_id TEXT DEFAULT '',
     sort_order INTEGER DEFAULT 0,
     legacy_json TEXT DEFAULT '{}',
     created_at INTEGER,
     updated_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS groups (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     position INTEGER DEFAULT 0,
     created_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_groups_position ON groups(position)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_sort ON modules(sort_order, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_group ON modules(group_id)`,
  `CREATE TABLE IF NOT EXISTS collections (
     id TEXT PRIMARY KEY,
     slug TEXT UNIQUE NOT NULL,
     title TEXT NOT NULL,
     description TEXT DEFAULT '',
     icon_url TEXT DEFAULT '',
     auto_all INTEGER DEFAULT 0,
     legacy_json TEXT DEFAULT '{}',
     created_at INTEGER,
     updated_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_collections_created ON collections(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS collection_modules (
     collection_id TEXT NOT NULL,
     module_id TEXT NOT NULL,
     position INTEGER DEFAULT 0,
     PRIMARY KEY (collection_id, module_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cm_collection ON collection_modules(collection_id, position)`,
  `CREATE TABLE IF NOT EXISTS collection_aliases (
     slug TEXT PRIMARY KEY,
     collection_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     created_at INTEGER,
     expires_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT
   )`
];

async function ensureSchema(env) {
  await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql)));
  await env.DB.batch(SOURCE_SCHEMA.map(sql => env.DB.prepare(sql)));
  for (const sql of [
    "ALTER TABLE modules ADD COLUMN group_id TEXT DEFAULT ''",
    "ALTER TABLE modules ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE modules ADD COLUMN legacy_json TEXT DEFAULT '{}'",
    "ALTER TABLE collections ADD COLUMN auto_all INTEGER DEFAULT 0",
    "ALTER TABLE collections ADD COLUMN legacy_json TEXT DEFAULT '{}'"
  ]) {
    try { await env.DB.prepare(sql).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
}


async function migrateLegacyKV(env) {
  const flag = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('migrated_v1').first();
  if (flag) return { skipped: true };

  const legacyMods = await env.KV.get('modules', 'json') || [];
  const legacyCols = await env.KV.get('collections', 'json') || [];
  if (!Array.isArray(legacyMods) || !Array.isArray(legacyCols)) throw new Error('旧数据格式异常，已停止迁移');
  const modules = new Map(legacyMods.filter(m => m && m.id).map(m => [m.id, m]));
  // Earlier backups may embed the module records in a collection.
  for (const c of legacyCols) {
    for (const m of (Array.isArray(c.modules) ? c.modules : [])) if (m?.id && !modules.has(m.id)) modules.set(m.id, m);
  }

  const stmts = [];
  let modCount = 0, colCount = 0, linkCount = 0;

  {
    for (const m of modules.values()) {
      const file = await env.KV.get('file:' + m.id, 'arrayBuffer');
      if (!file) throw new Error('旧模块缺少文件：' + m.id + '；原数据库未改动');
      // Match the old subscription fallback exactly (including its 2 KiB
      // parser), so an upgrade cannot silently change the client's widget ID.
      const parsed = !m.is_encrypted ? parseMeta(m.filename || '', new Uint8Array(file.slice(0, 2048)), true) : {};
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO modules
           (id, filename, widget_id, title, version, author, file_size, is_encrypted, source_url, note, sort_order, group_id, legacy_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        m.id, m.filename || '', (!m.widget_id || m.widget_id === m.id) ? (parsed.id || m.id) : m.widget_id, m.title || '', m.version || '',
        m.author || '', file.byteLength, m.is_encrypted ? 1 : 0,
        m.source_url || null, m.note || '',
        modCount, m.group_id || '', JSON.stringify(m),
        m.created_at || Date.now(), m.updated_at || Date.now()
      ));
      modCount++;
    }
  }

  if (Array.isArray(legacyCols)) {
    for (const c of legacyCols) {
      if (!c || !c.id) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO collections (id, slug, title, description, icon_url, auto_all, legacy_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(c.id, c.slug || c.id, c.title || 'untitled', c.description || '',
             c.icon_url || '', c.autoAll ? 1 : 0, JSON.stringify(c), c.created_at || Date.now(), c.updated_at || Date.now()));
      colCount++;
      const ids = c.moduleIds?.length ? c.moduleIds : (Array.isArray(c.modules) ? c.modules.map(x => x.id) : []);
      ids.forEach((mid, i) => {
        if (!mid) return;
        stmts.push(env.DB.prepare(
          'INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position) VALUES (?,?,?)'
        ).bind(c.id, mid, i));
        linkCount++;
      });
    }
  }

  const oldPassword = await env.KV.get('admin_password');
  if (oldPassword) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .bind('admin_password', 'legacy-sha256$' + oldPassword));
  for (const key of ['settings', 'subscribers']) {
    const value = await env.KV.get(key);
    if (value) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('legacy_' + key, value));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind('migrated_v1', String(Date.now())).run();

  return { skipped: false, modules: modCount, collections: colCount, links: linkCount };
}



async function migrateSortOrder(DB) {
  const flag = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('sort_order_v1').first();
  if (!flag) {
    const { results } = await DB.prepare('SELECT id FROM modules WHERE sort_order IS NULL ORDER BY created_at DESC').all();
    const list = results || [];
    for (let i = 0; i < list.length; i += 100) {
      await DB.batch(list.slice(i, i + 100).map((r, k) =>
        DB.prepare('UPDATE modules SET sort_order = ? WHERE id = ?').bind(i + k, r.id)));
    }
    await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('sort_order_v1', String(Date.now())).run();
  }
}


function parseMeta(fn, head, legacy = false) {
  const t = new TextDecoder().decode(head);
  const meta = {};
  const m = t.match(/\/\*[\s\S]*?WidgetMetadata\s*\{/) || t.match(/WidgetMetadata\s*=\s*\{/);
  if (m) {
    let depth = 1;
    const start = m.index + m[0].length;
    let i = start;
    while (i < t.length && depth > 0) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}') depth--;
      i++;
    }
    const body = t.slice(start, i - 1);
    const expression = legacy ? /(\w+)\s*:\s*"([^"]*)"/g : /["']?(\w+)["']?\s*:\s*"([^"]*)"/g;
    const pairs = body.match(expression);
    if (pairs) pairs.forEach(x => { const kv = x.match(legacy ? /(\w+)\s*:\s*"([^"]*)"/ : /["']?(\w+)["']?\s*:\s*"([^"]*)"/); if (kv && !meta[kv[1]]) meta[kv[1]] = kv[2]; });
  }
  return meta;
}

export async function migrateDocker(env) {
 await ensureSchema(env);
 await migrateLegacyKV(env);
 await migrateSortOrder(env.DB);
}

// One-time bridge from Docker 2.x. Never re-import the archive tables after reset.
export async function migrateSources(env) {
  const DB=env.DB;
  if(await DB.prepare("SELECT value FROM settings WHERE key='docker_v3_sources'").first())return;
  const {results:sources}=await DB.prepare('SELECT * FROM sources').all();
  for(const s of sources){
    const collision=await DB.prepare('SELECT id,url FROM subscription_sources WHERE id=? OR url=?').bind(s.id,s.url).first();
    if(collision && (collision.id!==s.id || collision.url!==s.url))throw new Error('订阅源迁移身份冲突：'+s.id);
    const summary=JSON.stringify({added:s.added_count||0,updated:s.updated_count||0,unchanged:s.unchanged_count||0,
      failed:s.failed_count||0,removed:s.removed_count||0,manual:0});
    await DB.prepare(`INSERT OR IGNORE INTO subscription_sources
      (id,url,title,enabled,status,next_sync_at,last_started_at,last_finished_at,last_error,summary,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(s.id,s.url,s.title||'未命名订阅',s.enabled?1:0,
        s.enabled?(s.status==='syncing'?'idle':s.status):'paused',s.status==='syncing'?0:s.next_sync_at||0,
        s.last_attempt_at||0,s.last_success_at||0,s.last_error||'',summary,s.created_at||Date.now()).run();
    const {results:items}=await DB.prepare('SELECT * FROM source_items WHERE source_id=? ORDER BY position').bind(s.id).all();
    for(const i of items){
      const remote=i.remote_id || (i.remote_key?.startsWith('id:')?i.remote_key.slice(3):i.url);
      await DB.prepare(`INSERT INTO subscription_items
        (source_id,remote_id,module_id,url,title,version,author,description,required_version,active,last_error)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(s.id,remote,i.module_id,i.url,i.title||'',i.version||'',
          i.author||'',i.description||'','0.0.1',i.removed_at?0:1,i.last_error||'').run();
      if(i.module_id)await DB.prepare('UPDATE modules SET source_managed=1,manifest_title=? WHERE id=?')
        .bind(i.title||'',i.module_id).run();
    }
  }
  // Upgrading must not suddenly refresh formerly manual single-link imports or
  // rewrite their displayed titles. New imports use the new upstream defaults.
  await DB.prepare(`UPDATE modules SET manual_override=CASE WHEN source_managed=0 AND source_url IS NOT NULL
    AND source_url<>'' THEN 1 ELSE manual_override END,
    title=CASE WHEN COALESCE(title,'')='' THEN filename ELSE title END,
    title_scan_v1=1,title_locked=1`).run();
  await DB.prepare(`CREATE TRIGGER IF NOT EXISTS docker_auto_all_insert AFTER INSERT ON modules BEGIN
    INSERT OR IGNORE INTO collection_modules(collection_id,module_id,position)
    SELECT c.id,NEW.id,COALESCE((SELECT MAX(position)+1 FROM collection_modules WHERE collection_id=c.id),0)
    FROM collections c WHERE c.auto_all=1; END`).run();
  await DB.prepare("INSERT INTO settings(key,value) VALUES('docker_v3_sources','1')").run();
}
