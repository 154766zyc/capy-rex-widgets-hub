// 3.5.8：版本号工具。
// Rex 只在版本号变大时更新模块；加密模块 Hub 读不到内部版本号，内容变化时用日期版本号自动递增。
const STAMP = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/;

// 北京时间（UTC+8，无夏令时）的日期 YYYY.MM.DD。
export function shanghaiDay(now = Date.now()) {
  const d = new Date(now + 8 * 3600000);
  return d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0');
}

// 生成下一个日期版本号 YYYY.MM.DD.N：同一天递增 N，新的一天从 1 开始。
// 旧版本号是更晚的日期（时钟回拨）时沿用旧日期继续递增，保证只增不减。
export function stampVersion(prev, now = Date.now()) {
  const today = shanghaiDay(now);
  const m = STAMP.exec(String(prev || '').trim());
  if (m) {
    const day = m[1] + '.' + m[2] + '.' + m[3];
    if (day >= today) return day + '.' + (Number(m[4]) + 1);
  }
  return today + '.1';
}

// 管理员手填的版本号：最多 64 个字符，只允许数字、字母和 . _ -。空字符串表示不指定。
export function cleanVersion(value) {
  if (value === undefined || value === null) return '';
  const v = String(value).trim();
  if (!v) return '';
  if (v.length > 64 || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(v)) throw new Error('版本号只能包含数字、字母和 . _ -，最多 64 个字符');
  return v;
}

// 加密模块内容变化、又没有任何来源提供版本号时，算出应该写入的版本号。
// explicit：管理员手填；fromFile：代码/合集里的版本号；prev：数据库里的旧版本号。
export function nextVersion({ explicit = '', fromFile = '', prev = '', encrypted = false, changed = false, now = Date.now() }) {
  if (explicit) return explicit;
  if (fromFile) return fromFile;
  if (encrypted && changed) return stampVersion(prev, now);
  return prev || '';
}
