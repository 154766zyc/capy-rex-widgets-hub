// KV and D1 surfaces used by the shared Hub code, backed by ONE Durable Object
// SQLite database — the Cloudflare twin of Docker's kv.js + storage.js.
// Every SQL statement runs through the same re-entrant gate, and env.ATOMIC
// maps to ctx.storage.transaction(): a thrown error or a >=400 Response rolls
// back everything written inside it, exactly like Docker's BEGIN/SAVEPOINT.
import { SQLiteGate } from '../gate.js';
import { DOSql } from './do-sql.js';

class Rollback extends Error {
  constructor(response) { super('rollback'); this.response = response; }
}

export function createStorage(storage) {
  const sql = new DOSql(storage.sql);
  const gate = new SQLiteGate();
  let depth = 0;

  // storage.transaction() nests (savepoints) inside an open transaction.
  async function atomic(work) {
    return gate.run(async () => {
      depth++;
      try {
        return await storage.transaction(async () => {
          const result = await work();
          if (result instanceof Response && result.status >= 400) throw new Rollback(result);
          return result;
        });
      } catch (error) {
        if (error instanceof Rollback) return error.response;
        throw error;
      } finally { depth--; }
    });
  }

  const kv = new DOKV(sql, gate, atomic);
  const db = new DOD1(sql, gate, atomic);
  return { sql, gate, kv, db, atomic, get depth() { return depth; } };
}

// 与 get() 同一套类型转换，供 getWithMetadata 共用。
function toValue(bytes, type) {
  if (type === 'stream') return new Response(bytes).body;
  if (type === 'arrayBuffer') return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const text = new TextDecoder().decode(bytes);
  return type === 'json' ? JSON.parse(text) : text;
}

export class DOKV {
  constructor(sql, gate, atomic) {
    this.sql = sql; this.gate = gate; this.atomic = atomic;
    sql.all(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL)`);
    sql.all(`CREATE TABLE IF NOT EXISTS kv_metadata (key TEXT PRIMARY KEY, metadata TEXT)`);
    if (!sql.all('PRAGMA table_info(kv_metadata)').some(c => c.name === 'expires_at')) {
      sql.all('ALTER TABLE kv_metadata ADD COLUMN expires_at INTEGER');
    }
    // 3.6.0：过期清理只读已过期的记录（原来每次维护都扫一遍全部存储记录）。
    sql.all('CREATE INDEX IF NOT EXISTS idx_kv_metadata_expires ON kv_metadata(expires_at) WHERE expires_at IS NOT NULL');
  }
  async get(key, type = 'text') {
    return this.gate.run(() => {
      if (typeof type === 'object') type = type.type || 'text';
      const expires = this.sql.get('SELECT expires_at FROM kv_metadata WHERE key=?', [key])?.expires_at;
      if (expires && expires <= Date.now()) return null;
      const row = this.sql.get('SELECT value FROM kv WHERE key=?', [key]);
      if (!row) return null;
      return toValue(row.value, type);
    });
  }
  async put(key, value, options = {}) {
    return this.gate.run(() => {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      this.sql.run('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, bytes]);
      const expires = options.expiration ? options.expiration * 1000
        : options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
      this.sql.run('INSERT OR REPLACE INTO kv_metadata (key,metadata,expires_at) VALUES (?,?,?)',
        [key, options.metadata ? JSON.stringify(options.metadata) : null, expires]);
    });
  }
  async getWithMetadata(key, type = 'text') {
    return this.gate.run(() => {
      if (typeof type === 'object') type = type.type || 'text';
      // 原来是 3 条 SQL：metadata、expires、value 各查一次，其中前两条是同一行。
      // 一条 JOIN 一次拿全。语义与原来一致：过期时 value 为 null 但 metadata 照常返回；
      // 无行时两者皆 null。注：只有 kv 行缺失、metadata 行独存时与原来不同（原来会返回
      // metadata），但 put/delete/cleanup 都成对写删，不会产生这种孤儿 metadata。
      const row = this.sql.get('SELECT k.value AS value, m.metadata AS metadata, m.expires_at AS expires_at FROM kv k LEFT JOIN kv_metadata m ON m.key=k.key WHERE k.key=?', [key]);
      if (!row) return { value: null, metadata: null };
      const metadata = row.metadata ? JSON.parse(row.metadata) : null;
      if (row.expires_at && row.expires_at <= Date.now()) return { value: null, metadata };
      return { value: toValue(row.value, type), metadata };
    });
  }
  async delete(key) {
    return this.gate.run(() => {
      this.sql.run('DELETE FROM kv WHERE key=?', [key]);
      this.sql.run('DELETE FROM kv_metadata WHERE key=?', [key]);
    });
  }
  async cleanup() {
    return this.atomic(() => {
      const now = Date.now();
      this.sql.run('DELETE FROM kv WHERE key IN (SELECT key FROM kv_metadata WHERE expires_at<=?)', [now]);
      this.sql.run('DELETE FROM kv_metadata WHERE expires_at<=?', [now]);
    });
  }
}

export class DOD1 {
  constructor(sql, gate, atomic) { this.sql = sql; this.gate = gate; this.atomic = atomic; }
  prepare(query) {
    const sql = this.sql, run = work => this.gate.run(work);
    class Statement {
      constructor(args = []) { this.args = args; }
      bind(...args) { return new Statement(args); }
      first(column) {
        return run(() => {
          const row = sql.get(query, this.args);
          return row ? (column ? row[column] : row) : null;
        });
      }
      all() { return run(() => ({ success: true, results: sql.all(query, this.args), meta: {} })); }
      raw() { return run(() => sql.all(query, this.args).map(row => Object.values(row))); }
      run() {
        return run(() => {
          const result = sql.run(query, this.args);
          return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        });
      }
    }
    return new Statement();
  }
  // D1 batches are all-or-nothing; keep that with a (nested) storage transaction.
  async batch(statements) {
    return this.atomic(async () => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    });
  }
  async exec(query) { return this.gate.run(() => { this.sql.all(query); return { count: 1 }; }); }
}
