// A strict local imitation of a SQLite-backed Durable Object's ctx/storage,
// built on node:sqlite. It enforces the Cloudflare rules the adapter must cope
// with, so tests fail here instead of on the real platform:
//   - no BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE statements in sql.exec
//   - at most 100 bound parameters
//   - bindings limited to string/number/null/ArrayBuffer
//   - a single string/BLOB binding must stay under 2 MB
//   - BLOBs are returned as ArrayBuffer
// It is a test double, not workerd: real-platform behaviour still needs a live deploy.
import { DatabaseSync } from 'node:sqlite';

const FORBIDDEN = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/im;
const MAX_VALUE = 2_000_000;

class Cursor {
  constructor(rows) { this.rows = rows; }
  [Symbol.iterator]() { return this.rows[Symbol.iterator](); }
  toArray() { return this.rows; }
  one() {
    if (this.rows.length !== 1) throw new Error('Expected exactly one result from SQL query, but got ' + this.rows.length);
    return this.rows[0];
  }
}

function convert(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v;
  }
  return out;
}

export class FakeStorage {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.depth = 0;
    this.seq = 0;
    this.alarm = null;
    this.stats = { maxParams: 0, maxValue: 0, transactions: 0, rollbacks: 0 };
    const self = this;
    this.sql = {
      // 与 Cloudflare 一致：数据库当前占用的字节数。
      get databaseSize() {
        const pages = self.db.prepare('PRAGMA page_count').get().page_count;
        const size = self.db.prepare('PRAGMA page_size').get().page_size;
        return pages * size;
      },
      exec(query, ...bindings) {
        if (FORBIDDEN.test(query)) throw new Error('Durable Object SQL: transaction statements are not allowed: ' + query.slice(0, 40));
        if (bindings.length > 100) throw new Error('Durable Object SQL: too many SQL variables (' + bindings.length + ')');
        self.stats.maxParams = Math.max(self.stats.maxParams, bindings.length);
        const args = bindings.map(v => {
          if (v === null || typeof v === 'string' || typeof v === 'number') {
            if (typeof v === 'string' && v.length > MAX_VALUE) throw new Error('SQLITE_TOOBIG: string or blob too big');
            return v;
          }
          if (v instanceof ArrayBuffer) {
            if (v.byteLength > MAX_VALUE) throw new Error('SQLITE_TOOBIG: string or blob too big');
            self.stats.maxValue = Math.max(self.stats.maxValue, v.byteLength);
            return new Uint8Array(v);
          }
          throw new TypeError('Durable Object SQL: unsupported binding type ' + Object.prototype.toString.call(v));
        });
        // A row is limited to 2 MB in total, not just each value.
        const total = args.reduce((n, v) => n + (v instanceof Uint8Array ? v.byteLength : typeof v === 'string' ? Buffer.byteLength(v) : 8), 0);
        if (/^\s*(INSERT|UPDATE|REPLACE)\b/i.test(query) && total > MAX_VALUE) throw new Error('SQLITE_TOOBIG: row too big');
        // Multiple statements without bindings: execute all, return nothing.
        if (!args.length && /;\s*\S/.test(query.trim().replace(/;\s*$/, ''))) { self.db.exec(query); return new Cursor([]); }
        const statement = self.db.prepare(query);
        const isRead = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(query) || /\bRETURNING\b/i.test(query);
        if (isRead) return new Cursor(statement.all(...args).map(convert));
        statement.run(...args);
        return new Cursor([]);
      },
    };
  }

  async transaction(work) {
    const name = 'fake_sp_' + (++this.seq);
    this.db.exec('SAVEPOINT ' + name);
    this.depth++; this.stats.transactions++;
    try {
      const result = await work({ rollback: () => { throw new Error('rollback'); } });
      this.db.exec('RELEASE ' + name);
      return result;
    } catch (error) {
      this.stats.rollbacks++;
      this.db.exec('ROLLBACK TO ' + name);
      this.db.exec('RELEASE ' + name);
      throw error;
    } finally { this.depth--; }
  }

  transactionSync(work) {
    const name = 'fake_sp_' + (++this.seq);
    this.db.exec('SAVEPOINT ' + name);
    try { const r = work(); this.db.exec('RELEASE ' + name); return r; }
    catch (e) { this.db.exec('ROLLBACK TO ' + name); this.db.exec('RELEASE ' + name); throw e; }
  }

  async getAlarm() { return this.alarm; }
  async setAlarm(at) { this.alarm = Number(at); this.onAlarm?.(this.alarm); }
  async deleteAlarm() { this.alarm = null; }
  close() { this.db.close(); }
}

export function fakeState(filename) {
  const storage = new FakeStorage(filename);
  const pending = new Set();
  return {
    storage, pending,
    id: { toString: () => 'hub' },
    blockConcurrencyWhile: work => work(),
    waitUntil: promise => { pending.add(promise); promise.finally?.(() => pending.delete(promise)); },
  };
}
