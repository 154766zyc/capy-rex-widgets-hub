# CF 部署版（3.5.1 起，当前 3.6.0）

> 3.5.8 起只出 Cloudflare 版。3.6.0 省用量见 [CHANGELOG-v3.6.0.md](CHANGELOG-v3.6.0.md)，3.5.8 新功能见 [CHANGELOG-v3.5.8.md](CHANGELOG-v3.5.8.md)。下面是 3.5.1 做成 CF 版时的说明。

以 Docker 3.5.1 为底，做成 Cloudflare Workers 部署版。业务代码和 Docker 共用（当前都是 3.5.2），两边功能一致。各版本功能改动见 [CHANGELOG-v3.5.2.md](CHANGELOG-v3.5.2.md)、[CHANGELOG-v3.5.1.md](CHANGELOG-v3.5.1.md)。

## 新增

- 存储改为一个 SQLite 型 Durable Object（`RexHub`），不再使用 KV 和 D1，`wrangler.toml` 没有要填的编号。
- 事务和 Docker 一样：`env.ATOMIC` 对应 `ctx.storage.transaction()`，抛错或返回 ≥400 时整体回滚，D1 批量写入同样全成或全不成。
- 超过 256 KB 的值（模块文件、首页包、头像、图标、旧版留档）自动按 1 MB 分片存储（Cloudflare 每行上限 2 MB），按内容去重，读取还原原字节；没有引用的分片每 6 小时清理。
- 定时：Cron 每 5 分钟唤醒；有排队的同步任务时，Durable Object 闹钟大约每秒续跑；空闲时睡到下一个到期订阅，最长 15 分钟。
- 上传限制：恢复备份最大 100 MB（Cloudflare 限制），首页包 26 MiB，其余管理请求 32 KiB；大上传先校验登录再读取内容。
- PWA 图标随代码打包，不读取文件系统。

## 共用代码的小改动（Docker 行为不变）

- `pwa.js`：Node 下照旧读取图标文件，Cloudflare 下由入口注册打包好的图标。
- `restore-jobs.js`：去掉对 `node:sqlite`、`node:timers/promises` 的静态依赖，可接收现成的只读连接；`setImmediate` 改为 `setTimeout(…,0)`。
- `home-configs.js`：`zlib.crc32` 不存在时用内置 CRC32。
- 设置页版本说明改为「单一 SQLite 数据库 · 持久化（Docker / Cloudflare 通用）」；迁移提示去掉「Docker」字样。
- 测试新增 `REX_TEST_RUNTIME=cf`：同一套 HTTP 测试可以直接跑在 Durable Object 版上。

## 不变

数据库结构、模块/合集/首页 ID、分享名、公开地址、format 1–8 备份格式全部不变。
