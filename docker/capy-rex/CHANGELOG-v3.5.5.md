# 3.5.5（2026-11-22，GitHub 学习优化版）

以 3.5.4 为底，参考 GitHub 和 Cloudflare 官方上的成熟做法优化，**不是上游发布的 3.5.5**。模块、合集、首页 ID、分享名、公开地址和备份格式（format 1–8）都没变，可以直接覆盖 3.5.4 部署。数据库会自动补几列（`subscription_items.etag/last_modified`、`modules.link_etag/link_last_modified`），旧库在第一次启动时补上。

## 学了什么、用在哪

| 参考来源 | 学到的做法 | 用在 Hub 的哪里 |
|---|---|---|
| sparklemuffin、rss2email（RSS 抓取器） | 每个来源存 ETag / Last-Modified，下次发 `If-None-Match` / `If-Modified-Since`，没变就回 304 | 合集订阅里的每个模块、链接模块自动刷新 |
| sparklemuffin | 服务器不给校验值时，用内容哈希兜底 | 保留原本的 SHA-256 对比（3.5.4 已有） |
| NetNewsWire 的 Bug 复盘 | 内容哈希一样时提前返回，结果漏存新的 ETag | 不管 200、304 还是内容没变，都保存最新的校验值 |
| feedparser-rs | 校验值要限制长度，防止请求头过大 | ETag 最长 1 KB、Last-Modified 最长 64 字节，超长的不存 |
| Cloudflare《Rules of Durable Objects》 | 闹钟只在有活时做该做的活，不要用秒级间隔跑重活 | 同步期间每秒的闹钟只推进队列，完整维护最多每分钟一次 |

## 修正了 CF 什么

1. **合集订阅每 6 小时全量重新下载 → 条件请求（解决 CF-6）**
   以前合集里每个模块每次同步都要整份重新下载，再算 SHA-256 比对。现在每个模块记住上游的 ETag / Last-Modified，下次同步带上；上游回 304 就直接算「未变化」，不下载、不写文件、不改模块。
   安全条件：只有合集里的标题、版本、作者、地址、最低版本都和本地一致时才发条件请求；有任何变化就走原来的完整下载，确保目录信息能更新。手动的「强制更新」也照旧完整下载。

2. **链接模块自动刷新也用条件请求**
   3.5.4 是下载后比对内容；3.5.5 先问上游有没有变，没变直接 304，连下载都省掉。手动点「刷新」仍然完整下载。

3. **同步期间闹钟太忙**
   「全部同步」时，Durable Object 闹钟每秒响一次。以前每次都会跑一整套维护：标题扫描、上传任务清理、自动分类（含整张表扫描）、过期数据清理。现在每秒那次只推进同步和图标队列，其余维护最多每分钟做一次，每 5 分钟的 Cron 照常做完整维护。这样同步时占用的 CPU 和读取行数都更少。

## 效果（按一个 200 个模块的合集估算）

- 上游没变时：每 6 小时从下载约 200 份文件，变成 200 次只回响应头的 304 请求，下载量和 SHA-256 计算几乎降到 0。
- 同步 1000 个模块（约 8 分钟）时：完整维护从约 500 次减少到约 8 次。

## CF 的限制（这一版仍然存在）

- **单次上传最大 100 MB**（Cloudflare 免费版和 Pro 版）。
- **内存 128 MB**：恢复时额外占用的内存约是备份大小的 3 倍。20 MB 以内比较稳妥，超过时会提醒，但不拦截。
- **备份导出整份放在内存里**：图标缓存接近 128 MB 时，导出会失败（CF-4/CF-5）。我也研究了 Cloudflare 官方的流式 JSON 做法和 worker-tools/json-stream，但导出要在一个事务里拿到一致的快照，改成流式就得在下载期间一直占着这个事务，会把整个 Hub 卡住，所以这次没改。
- **单次请求 CPU 默认 30 秒**（免费计划）。
- **单行 2 MB 上限**：超过 256 KB 的文件会自动分片，不影响使用。
- **不能访问内网来源**：只能用公网 HTTPS 地址。
- **条件请求要上游支持**：上游不给 ETag / Last-Modified（例如部分网盘直链）时，会退回完整下载加内容比对，和 3.5.4 一样。
- **以上 CF 结论都来自本地模拟（fake Durable Object），没有在真实的 Cloudflare 账号上验证过。** 部署后先打开 `/healthz`（应显示 `"version":"3.5.5"`），再同步一次订阅，确认显示的是「未变化」。

## 验证

- `npm test`：254 项，253 通过、0 失败、1 跳过（新增 `test/v355.test.js` 4 项）。
- `npm run test:cf`：253 项，253 通过、0 失败。
- `npm run verify:cf`：打包只用到 Cloudflare 支持的模块；打包后的冒烟测试全部通过。
- 把新测试放回 3.5.4 跑，4 项全部失败，说明测试确实测到了新行为。

## 参考链接

- https://virtualtam.github.io/sparklemuffin/developer-guide/concepts/feed-polling-caching.html
- https://github.com/skx/rss2email
- https://inessential.com/2024/08/03/netnewswire_and_conditional_get_issues.html
- https://docs.rs/crate/feedparser-rs/0.5.3/source/src/http/client.rs
- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- https://developers.cloudflare.com/workers/examples/streaming-json/
- https://github.com/worker-tools/json-stream
