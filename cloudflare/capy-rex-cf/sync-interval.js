// 3.6.0：订阅和单链接模块的自动更新间隔，设置页可选 6 / 12 / 18 / 24 小时，默认 6 小时。
// 间隔越长，同步读写和抓取别人链接的流量越少；手动「同步」「全部同步」不受影响。
export const SYNC_INTERVAL_HOURS = [6, 12, 18, 24];
const KEY = 'sync_interval_hours';

export async function syncIntervalHours(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(KEY).first();
  const hours = Number(row?.value);
  return SYNC_INTERVAL_HOURS.includes(hours) ? hours : 6;
}
export async function syncIntervalMs(env) { return (await syncIntervalHours(env)) * 60 * 60 * 1000; }

// 改间隔后，按「上次完成时间 + 新间隔」重排还在等待的来源：改短的会提前，改长的会延后。正在同步的不动。
export async function setSyncInterval(env, hours) {
  if (!SYNC_INTERVAL_HOURS.includes(hours)) throw Error('自动更新间隔只能选 6、12、18 或 24 小时');
  const ms = hours * 60 * 60 * 1000, now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').bind(KEY, String(hours)),
    env.DB.prepare(`UPDATE subscription_sources SET next_sync_at=MAX(COALESCE(NULLIF(last_finished_at,0),?)+?,?)
      WHERE status!='syncing' AND next_sync_at>0`).bind(now, ms, now),
  ]);
  return { ok: true, hours, options: SYNC_INTERVAL_HOURS };
}
