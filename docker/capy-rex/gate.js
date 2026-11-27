import { AsyncLocalStorage } from 'node:async_hooks';

// Short SQLite commits are serialized. Network downloads never hold this gate.
export class SQLiteGate {
  context = new AsyncLocalStorage();
  pending = Promise.resolve();
  run(work) {
    if (this.context.getStore() === this) return Promise.resolve().then(work);
    const result = this.pending.then(() => this.context.run(this, work));
    this.pending = result.then(() => {}, () => {});
    return result;
  }
}
