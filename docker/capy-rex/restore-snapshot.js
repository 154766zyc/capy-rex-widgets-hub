import { constants, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Offline recovery only: preserve the entire current database (including WAL)
// in a new directory before installing a verified standalone upgrade snapshot.
export function restoreSnapshot(directory, source, offline) {
  if (!offline) throw new Error('先停止应用，并提供 --offline；禁止在运行中的数据库上恢复');
  directory = realpathSync(directory);
  source = realpathSync(source);
  const backups = realpathSync(join(directory, 'backups'));
  if (!source.startsWith(backups + sep) || !source.endsWith('.sqlite')) throw new Error('只允许恢复本数据目录 backups 内的 .sqlite 快照');
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    if (Object.values(check.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error('快照完整性检查失败');
    if (!check.prepare("SELECT name FROM sqlite_master WHERE name='kv' AND type='table'").get()) throw new Error('快照不是本项目数据库');
  } finally { check.close(); }
  const token = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const staged = join(directory, '.restore-' + token + '.sqlite');
  copyFileSync(source, staged, constants.COPYFILE_EXCL);
  const saved = join(directory, 'rollback-saved', token);
  mkdirSync(saved, { recursive: true, mode: 0o700 });
  const moved = [];
  try {
    for (const name of ['rex.sqlite', 'rex.sqlite-wal', 'rex.sqlite-shm']) {
      if (existsSync(join(directory, name))) {
        renameSync(join(directory, name), join(saved, name));
        moved.push(name);
      }
    }
    renameSync(staged, join(directory, 'rex.sqlite'));
  } catch (error) {
    for (const name of moved.reverse()) renameSync(join(saved, name), join(directory, name));
    throw error;
  }
  return saved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.argv[2];
  if (!source) throw new Error('用法：node restore-snapshot.js /app/data/backups/实际快照.sqlite --offline');
  const saved = restoreSnapshot(resolve(process.env.DATA_DIR || './data'), resolve(source), process.argv.includes('--offline'));
  console.log('已恢复快照。恢复前数据库完整保留在：' + saved);
  console.log('请确认使用目标版本镜像后，再启动应用。');
}
