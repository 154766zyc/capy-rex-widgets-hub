import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteGate } from './gate.js';

// Files and metadata share one SQLite database; no host-folder JS files or KV service.
export class SQLiteKV {
  constructor(filename) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.gate = new SQLiteGate();
    this.transactionDepth = 0;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS kv_metadata (key TEXT PRIMARY KEY, metadata TEXT);
    `);
    if (!this.db.prepare('PRAGMA table_info(kv_metadata)').all().some(c => c.name === 'expires_at')) {
      this.db.exec('ALTER TABLE kv_metadata ADD COLUMN expires_at INTEGER');
    }
    this.read = this.db.prepare('SELECT value FROM kv WHERE key = ?');
    this.write = this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.remove = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.readMetadata = this.db.prepare('SELECT metadata,expires_at FROM kv_metadata WHERE key = ?');
  }

  async get(key, type = 'text') {
    return this.gate.run(() => {
    if (typeof type === 'object') type = type.type || 'text';
    const expires = this.readMetadata.get(key)?.expires_at;
    if (expires && expires <= Date.now()) return null;
    const row = this.read.get(key);
    if (!row) return null;
    const bytes = row.value;
    if (type === 'stream') return new Response(bytes).body;
    if (type === 'arrayBuffer') {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    const text = new TextDecoder().decode(bytes);
    return type === 'json' ? JSON.parse(text) : text;
    });
  }

  async put(key, value, options = {}) {
    return this.gate.run(() => {
    const bytes = typeof value === 'string' ? Buffer.from(value)
      : value instanceof ArrayBuffer ? Buffer.from(value)
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    this.write.run(key, bytes);
    const expires = options.expiration ? options.expiration * 1000 : options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
    this.db.prepare('INSERT OR REPLACE INTO kv_metadata (key, metadata, expires_at) VALUES (?, ?, ?)')
      .run(key, options.metadata ? JSON.stringify(options.metadata) : null, expires);
    });
  }

  async getWithMetadata(key, type = 'text') {
    return this.gate.run(async () => {
    const row = this.readMetadata.get(key);
    return { value: await this.get(key, type), metadata: row?.metadata ? JSON.parse(row.metadata) : null };
    });
  }

  async delete(key) {
    return this.gate.run(() => {
    this.remove.run(key);
    this.db.prepare('DELETE FROM kv_metadata WHERE key = ?').run(key);
    });
  }

  async transaction(work) {
    return this.gate.run(async () => {
    const nested = this.transactionDepth > 0, savepoint = 'kv_' + (this.transactionDepth + 1);
    this.db.exec(nested ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = await work();
      if (result instanceof Response && result.status >= 400) {
        this.db.exec(nested ? 'ROLLBACK TO ' + savepoint : 'ROLLBACK');
        if (nested) this.db.exec('RELEASE ' + savepoint);
      } else this.db.exec(nested ? 'RELEASE ' + savepoint : 'COMMIT');
      return result;
    } catch (error) {
      this.db.exec(nested ? 'ROLLBACK TO ' + savepoint : 'ROLLBACK');
      if (nested) this.db.exec('RELEASE ' + savepoint);
      throw error;
    } finally { this.transactionDepth--; }
    });
  }
  async cleanup() {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM kv WHERE key IN (SELECT key FROM kv_metadata WHERE expires_at<=?)').run(Date.now());
      this.db.prepare('DELETE FROM kv_metadata WHERE expires_at<=?').run(Date.now());
    });
  }
  close() { this.db.close(); }
}
