import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// The small D1 surface used by the Worker, backed by the SAME connection as KV.
// Savepoints allow batches to participate in startup/request-wide transactions.
export class SQLiteD1 {
  constructor(db, gate) { this.db = db; this.gate = gate; this.sequence = 0; }
  prepare(sql) {
    const db = this.db, execute = work => this.gate ? this.gate.run(work) : work();
    class Statement {
      constructor(args = []) { this.args = args; }
      bind(...args) { return new Statement(args); }
      first(column) {
        return execute(() => {
        const row = db.prepare(sql).get(...this.args);
        return row ? (column ? row[column] : { ...row }) : null;
        });
      }
      all() { return execute(() => ({ success: true, results: db.prepare(sql).all(...this.args).map(row => ({ ...row })) })); }
      run() {
        return execute(() => {
        const result = db.prepare(sql).run(...this.args);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        });
      }
    }
    return new Statement();
  }
  async batch(statements) {
    if (this.gate && this.gate.context.getStore() !== this.gate) return this.gate.run(() => this.batch(statements));
    const name = 'd1_' + this.sequence++;
    this.db.exec('SAVEPOINT ' + name);
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('RELEASE ' + name);
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK TO ' + name);
      this.db.exec('RELEASE ' + name);
      throw error;
    }
  }
}

function legacyDigest(db) {
  const digest = createHash('sha256');
  for (const row of db.prepare('SELECT key, value FROM kv ORDER BY key').iterate()) {
    const key = Buffer.from(row.key);
    digest.update(String(key.length) + ':'); digest.update(key);
    digest.update(String(row.value.byteLength) + ':'); digest.update(row.value);
  }
  return digest.digest('hex');
}

function databaseDigest(db) {
  const digest = createHash('sha256');
  for (const { name, sql } of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    digest.update(JSON.stringify([name,sql]));
    for (const row of db.prepare('SELECT * FROM "' + name.replace(/"/g,'""') + '" ORDER BY rowid').iterate()) {
      for (const [key,value] of Object.entries(row)) {
        digest.update(key);
        if (value instanceof Uint8Array) { digest.update('blob:' + value.byteLength + ':'); digest.update(value); }
        else digest.update(JSON.stringify(value));
      }
    }
  }
  return digest.digest('hex');
}

export function upgradeBackup(kv, directory, { marker = 'docker_v2', prefix = 'pre-v2', full = false } = {}) {
  const hasSettings = kv.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get();
  const upgraded = hasSettings && kv.db.prepare('SELECT value FROM settings WHERE key = ?').get(marker);
  // A v2 database can have SQL settings/collections even with an empty KV table.
  if (upgraded || (!full && !kv.db.prepare('SELECT 1 FROM kv LIMIT 1').get())) return null;
  const folder = join(directory, 'backups');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const hash = full ? databaseDigest : legacyDigest;
  const digest = hash(kv.db);
  const filename = join(folder, prefix + '-' + digest + '.sqlite');
  // A failed migration may be restarted by Docker. Reuse the verified snapshot
  // of the same legacy records instead of filling the disk with retry copies.
  if (existsSync(filename)) {
    const snapshot = new DatabaseSync(filename, { readOnly: true });
    try {
      if (Object.values(snapshot.prepare('PRAGMA quick_check').get())[0] !== 'ok' || hash(snapshot) !== digest) {
        throw new Error('已有升级备份校验失败，已停止迁移');
      }
    } finally { snapshot.close(); }
    return filename;
  }
  // SQLite produces a consistent standalone snapshot, including committed WAL data.
  kv.db.prepare('VACUUM INTO ?').run(filename);
  chmodSync(filename, 0o600);
  return filename;
}
