// Cloudflare Durable Object SQLite adapter.
//
// The shared Hub code was written against node:sqlite (Docker) and the small
// D1 surface. A Durable Object's SQLite differs in four ways that matter here:
//   1. no BEGIN/SAVEPOINT statements: transactions go through ctx.storage.transaction();
//   2. a single string/BLOB/row is limited to about 2 MB;
//   3. BLOBs come back as ArrayBuffer instead of Uint8Array;
//   4. cursors report no changes()/last_insert_rowid() metadata.
// This layer hides those differences so the shared code runs unchanged.
import { createHash } from 'node:crypto';

// BLOB parameters above this size are stored as content-addressed chunks and the
// row keeps a short marker. Reads transparently reassemble the original bytes.
// The 2 MB limit is per ROW, and a row can hold several BLOBs (a home package
// plus its avatar), so spill well below it.
export const SPILL_THRESHOLD = 256 * 1024;
const CHUNK = 1_000_000;
const MAGIC = 'REXSPILL\u0000v1:';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const MARKER_MAX = 160;

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}
const toBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function markerOf(bytes) {
  if (bytes.byteLength > MARKER_MAX || bytes.byteLength < MAGIC_BYTES.length) return null;
  for (let i = 0; i < MAGIC_BYTES.length; i++) if (bytes[i] !== MAGIC_BYTES[i]) return null;
  const [hash, size] = new TextDecoder().decode(bytes.subarray(MAGIC_BYTES.length)).split(':');
  return /^[0-9a-f]{64}$/.test(hash) && /^\d+$/.test(size) ? { hash, size: Number(size) } : null;
}

const DML = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const READ_ONLY = /^\s*(SELECT|PRAGMA\s+\w+\s*(\(|$)|WITH|EXPLAIN)/i;

export class DOSql {
  constructor(sql) {
    // 3.6.0：写入计数。任何写入都会让内存里缓存的读取结果作废（见 hub.js 的响应缓存）。
    this.writes = 0;
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS _rex_spill (hash TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY (hash, idx));
      CREATE TABLE IF NOT EXISTS _rex_spill_meta (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
  }

  param(value) {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    const bytes = toBytes(value);
    if (!bytes) return value;
    if (bytes.byteLength <= SPILL_THRESHOLD) return toBuffer(bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!this.sql.exec('SELECT 1 FROM _rex_spill_meta WHERE hash=?', hash).toArray().length) {
      for (let i = 0, idx = 0; i < bytes.byteLength; i += CHUNK, idx++) {
        this.sql.exec('INSERT OR REPLACE INTO _rex_spill (hash,idx,data) VALUES (?,?,?)', hash, idx,
          toBuffer(bytes.subarray(i, i + CHUNK)));
      }
      this.sql.exec('INSERT INTO _rex_spill_meta (hash,size,created_at) VALUES (?,?,?)', hash, bytes.byteLength, Date.now());
    }
    return toBuffer(new TextEncoder().encode(MAGIC + hash + ':' + bytes.byteLength));
  }

  value(value) {
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return value;
    const bytes = toBytes(value), marker = markerOf(bytes);
    if (!marker) return new Uint8Array(bytes);
    const out = new Uint8Array(marker.size);
    let offset = 0;
    for (const row of this.sql.exec('SELECT data FROM _rex_spill WHERE hash=? ORDER BY idx', marker.hash)) {
      const part = toBytes(row.data);
      out.set(part, offset); offset += part.byteLength;
    }
    if (offset !== marker.size) throw new Error('存储分片缺失或损坏：' + marker.hash.slice(0, 12));
    return out;
  }

  row(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) out[key] = this.value(value);
    return out;
  }

  // 3.6.0：只有真的改了行才算一次写入。定时维护里大量 DELETE … WHERE expires_at<? 通常删 0 行，
  // 以前也算写入，结果内存里的响应缓存每 5 分钟被清一次，等于没缓存。
  // INSERT/UPDATE/DELETE/REPLACE 看 changes()；建表、建索引等其他语句一律算写入（保守）。
  noteWrite(query) {
    if (READ_ONLY.test(query) && !/\bRETURNING\b/i.test(query)) return;
    if (!DML.test(query)) { this.writes++; return; }
    const c = Number(this.sql.exec('SELECT changes() AS c').one().c);
    if (c > 0) this.writes++;
  }

  all(query, params = []) {
    const rows = this.sql.exec(query, ...params.map(v => this.param(v))).toArray().map(row => this.row(row));
    this.noteWrite(query);
    return rows;
  }

  get(query, params = []) {
    const cursor = this.sql.exec(query, ...params.map(v => this.param(v)));
    if (READ_ONLY.test(query) && !/\bRETURNING\b/i.test(query)) {
      for (const row of cursor) return this.row(row); // 只取第一行，不把剩下的行读完（读多少算多少钱）
      return undefined;
    }
    let out;
    for (const row of cursor) { if (out === undefined) out = this.row(row); }
    this.noteWrite(query);
    return out;
  }

  run(query, params = []) {
    const cursor = this.sql.exec(query, ...params.map(v => this.param(v)));
    for (const _ of cursor) { /* drain RETURNING rows */ }
    const meta = this.sql.exec('SELECT changes() AS c, last_insert_rowid() AS r').one();
    const changes = Number(meta.c);
    if (!DML.test(query) || changes > 0) this.writes++;
    return { changes, lastInsertRowid: Number(meta.r) };
  }

  // Remove chunks no row references any more. Called from scheduled maintenance
  // inside the serialized write path, so it never races a half-written row.
  collectGarbage() {
    const stored = this.sql.exec('SELECT hash FROM _rex_spill_meta').toArray().map(r => r.hash);
    if (!stored.length) return 0;
    const used = new Set();
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '_rex_spill%'").toArray();
    // 3.6.0：每张表只扫一遍（以前是每一列各扫一遍整张表，modules 有几十列，GC 一次就读几万行）。
    const magic = "X'" + Array.from(MAGIC_BYTES, b => b.toString(16).padStart(2, '0')).join('') + "'";
    for (const { name } of tables) {
      const table = '"' + name.replace(/"/g, '""') + '"';
      const cols = this.sql.exec('PRAGMA table_info(' + table + ')').toArray()
        .map(c => '"' + c.name.replace(/"/g, '""') + '"');
      if (!cols.length) continue;
      const hit = c => `(typeof(${c})='blob' AND length(${c})<=${MARKER_MAX} AND substr(${c},1,${MAGIC_BYTES.length})=${magic})`;
      const pick = cols.map((c, i) => `CASE WHEN ${hit(c)} THEN ${c} END AS v${i}`).join(',');
      for (const row of this.sql.exec(`SELECT ${pick} FROM ${table} WHERE ${cols.map(hit).join(' OR ')}`)) {
        for (const v of Object.values(row)) { if (v == null) continue; const m = markerOf(toBytes(v)); if (m) used.add(m.hash); }
      }
    }
    let removed = 0;
    for (const hash of stored) {
      if (used.has(hash)) continue;
      this.sql.exec('DELETE FROM _rex_spill WHERE hash=?', hash);
      this.sql.exec('DELETE FROM _rex_spill_meta WHERE hash=?', hash);
      removed++;
    }
    if (removed) this.writes++;
    return removed;
  }
}
