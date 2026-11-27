# Rex Widgets Hub CF 版优化说明（3.5.4 → 3.5.6）

本文汇总从 3.5.3 起连续三轮的优化，只针对 **Cloudflare 版**（Workers + 一个 SQLite 型 Durable Object）。共用代码改动后 Docker 侧的测试也都通过，但这里不写 Docker。

- 3.5.4：代码审查后修 Bug（详见 [CHANGELOG-v3.5.4.md](CHANGELOG-v3.5.4.md)）
- 3.5.5：参考 GitHub 上的成熟做法，改用条件请求（详见 [CHANGELOG-v3.5.5.md](CHANGELOG-v3.5.5.md)）
- 3.5.6：针对热点路径和内存做优化（本文第 3 节）

模块、合集、首页 ID、分享名、公开地址、备份格式（format 1–8）全部不变，可以直接覆盖部署。

> 所有数字都是在本机 Node 22 + 本地 SQLite 上测得，测试数据是 2000 个模块、一个 300 个模块的合集，用来对比新旧版本。这些不是 Cloudflare 线上的实测数字；线上的绝对值会不同，但改善的比例应该相近。

---

## 1. 3.5.4：审查修复

| # | 问题 | 类型 | 修法 |
|---|---|---|---|
| 1 | 链接模块自动刷新会被 4 个坏源卡死：失败的模块不记录时间，一直排在队首 | Bug | 新增 `link_checked_at`，每次检查前先记下时间，失败的模块也要等 6 小时再试 |
| 2 | 链接模块内容没变也每 6 小时整份重写，ETag 也跟着变 | 优化 | 先比对 SHA-256，内容一样就不写 |
| 3 | 直链 `/<id>.js` 不支持 304 | 优化 | 与 `/api/modules/` 一致，支持 `If-None-Match` |
| 4 | 第一次登录后，改 `ADMIN_PASSWORD` 机密就无法重置密码 | Bug | 换了新机密就能登录重置；旧机密不会因此复活；旧会话全部退出 |
| 5 | 旧恢复接口收到坏 JSON 时报 500 | Bug | 改为 400，并显示「备份文件不是有效的 JSON」 |
| 6 | CF 上恢复 30–100 MB 的备份会失败，事先没有任何提示 | 体验 | 选中超过 20 MB 的备份时提醒（只提醒，不拦截） |
| 7 | 自动分类规则匹配是 O(模块数 × 订阅条目数) | 优化 | 订阅标题按模块预先分组，关键词缓存 |

## 2. 3.5.5：条件请求（参考 GitHub 上的做法）

| 参考 | 学到的 | 用在 |
|---|---|---|
| sparklemuffin、rss2email | 存 ETag / Last-Modified，下次发 `If-None-Match` / `If-Modified-Since`，没变回 304 | 合集订阅里的每个模块、链接模块自动刷新 |
| NetNewsWire 的 Bug 复盘 | 内容哈希相同时提前返回，结果漏存新的校验值 | 200、304、内容没变三种情况都保存最新校验值 |
| feedparser-rs | 校验值限制长度 | ETag ≤ 1 KB，Last-Modified ≤ 64 字节 |
| Cloudflare《Rules of Durable Objects》 | 闹钟只在有活时做该做的活 | 同步期间每秒的闹钟只推进队列，完整维护每分钟最多一次 |

效果：一个 200 个模块的合集，上游没变时，每次同步从下载约 200 份文件，变成 200 个几乎没有数据的 304 回应；同步 1000 个模块时，完整维护从约 500 次减少到约 8 次。

安全条件：只有合集里的标题、版本、作者、地址、最低版本都和本地一致时才发条件请求，否则仍完整下载，保证目录信息能更新。

## 3. 3.5.6：热点路径与内存

### 3.1 公开订阅 `/api/collections/<slug>.rex`：只查本合集，并支持 ETag/304

这是 Rex 客户端访问最频繁的接口。以前每次请求都把全站的文件名表和分享别名表整张读出来，即使合集只有几个模块。

- 改成只查这个合集里的模块（`json_each`），并给 `module_share_aliases(module_id)` 加了索引。
- 返回内容算一个 ETag（SHA-256 前 32 位）。Rex 带回同一个 ETag 时回 304，不传正文。

| 指标（2000 模块库，合集含 300 模块） | 3.5.5 | 3.5.6 |
|---|---|---|
| 每次读取的行数 | 4301 | **901**（-79%） |
| 耗时 | 19–22 ms | **9–11 ms** |
| 内容没变时 | 每次都传整份 JSON | **304，无正文，约 5 ms** |

Durable Object SQLite 按读取的行数计费，这个接口每天被调用的次数最多，所以这一项省得最多。

### 3.2 分享别名装饰：O(模块数 × 别名数) → O(模块数 + 别名数)

`decorateShares` 以前对每个模块都扫一遍全部别名（`find` 和 `filter`），现在先按模块分组再查表，输出与旧版逐字段一致（有专门的等价测试）。

| 指标 | 3.5.5 | 3.5.6 |
|---|---|---|
| 管理页模块列表（2000 模块 + 2000 别名） | 73–79 ms | **41–42 ms**（约 -45%） |

管理列表请求越多、模块越多，省下的 CPU 时间越多，也就越不容易碰到免费计划 30 秒的 CPU 上限。

### 3.3 备份导出改为流式输出（缓解 CF-4 / CF-5）

以前的流程：把整份备份对象 `JSON.stringify` 成一个大字符串，再一次性返回；图标图片也是一次全部读出、全部转 base64。内存里同时存在「所有 base64 字符串」和「一整份 JSON 字符串」两大份。

现在：

1. 模块文件和图标图片逐个序列化、逐个输出，写完就丢掉。
2. 图标图片一张一张从数据库读出再编码，不再一次 `SELECT *` 全部读进来。
3. base64 改用 `Buffer` 直接编码，不再先拼一份同样大小的二进制字符串。
4. 输出与 `JSON.stringify(备份)` **逐字节一致**（测试覆盖了数字形式的 ID、中文、转义字符、有图标和没图标的情况），旧版也能正常恢复。

| 测试备份 | 3.5.5 峰值内存 | 3.5.6 峰值内存 | 导出时额外占用 |
|---|---|---|---|
| 40 MB（60 个模块） | 287 MB | **146 MB** | 230 → 89 MB（-61%） |
| 80 MB（60 个模块 + 30 MB 图标） | 440 MB | **196 MB** | 352 → 108 MB（-69%） |

对 CF 版的意义：Durable Object 只有 128 MB 内存，以前导出大约 20 MB 的库就会接近上限；现在额外占用大约是备份大小的 1.3–2.2 倍（以前约 4.4–5.8 倍），能导出的库大了好几倍。图标缓存满 128 MB 时仍然导出不了（见第 5 节）。

### 3.4 图标 304 和 HEAD 不再读图片

`/api/icons/<hash>.png` 以前不管回 304 还是 HEAD，都先 `SELECT *`，把整张图片（可能是分片的大 BLOB）读出来。现在先只读 `mime` 和 `size`，只有真的要返回图片时才读字节。

### 3.5 试过但撤回的优化

| 尝试 | 结果 | 处理 |
|---|---|---|
| 恢复时解码一个文件就释放它的 base64 原文 | 40 MB 备份恢复的峰值都是 300 MB，没有改善：峰值出现在解析整份 JSON 的那一步 | 已撤回，代码与 3.5.5 一致 |
| 流式导出时边读数据库边输出 | 导出需要一致的快照，会在下载期间一直占着事务，把整个 Hub 卡住 | 没做，仍在事务里取数据，取完再流式输出 |

## 4. 修正了 CF 什么（3.5.4–3.5.6 汇总）

- 链接模块自动刷新不再被坏源卡死；内容没变不重写，并改用条件请求。
- 合集订阅每个模块改用条件请求，上游没变回 304（解决 CF-6）。
- 同步期间每秒的闹钟只推进队列，不再每秒跑一整套维护。
- 公开 `.rex` 接口每次读取的行数减少约 79%，并支持 ETag/304。
- 管理列表的别名处理变成线性，2000 模块时耗时约减半。
- 备份导出的额外内存减少 61–69%（CF-4/CF-5 大幅缓解）。
- 图标 304/HEAD 不读图片字节；直链 `/<id>.js` 支持 304。
- 忘记密码可以用新的 `ADMIN_PASSWORD` 机密重置；旧恢复接口收到坏 JSON 时返回 400。

## 5. CF 的限制（仍然存在）

- **单次上传最大 100 MB**（Cloudflare 免费版和 Pro 版）。
- **内存 128 MB**：
  - 恢复时额外占用约为备份大小的 3 倍，20 MB 以内比较稳妥，超过时会提醒；这一侧这次没能改善（见 3.5）。
  - 导出已改成流式，额外占用约为备份大小的 1.3–2.2 倍；图标缓存接近 128 MB 时仍会失败。
- **单次请求 CPU 默认 30 秒**（免费计划）；付费计划可以打开 `wrangler.toml` 里的 `[limits] cpu_ms`。
- **单行 2 MB 上限**：超过 256 KB 的文件会自动分片，不影响使用。
- **并发上限只按请求数计算（64），不按内存计算**：同时进行多个大上传仍可能把内存撑满（CF-2）。
- **不能访问内网来源**：只能用公网 HTTPS 地址。
- **条件请求要上游支持**：上游不给 ETag / Last-Modified 时，会退回完整下载加内容比对。
- **以上数字都来自本地模拟，没有在真实的 Cloudflare 账号上验证过。** 部署方法（在电脑上用 wrangler，见 [CF-DEPLOY.md](CF-DEPLOY.md)）：进入 `single-file` 文件夹，执行 `npx wrangler login`、`npx wrangler deploy`、`npx wrangler secret put ADMIN_PASSWORD`。部署后建议依次检查：
  1. 打开 `/healthz`，应显示 `"version":"3.5.6"`。
  2. 打开一次订阅 `.rex`，再刷新一次，第二次应该是 304。
  3. 导出一次备份，再用一份小备份试一次恢复。

## 6. 验证

| 项目 | 结果 |
|---|---|
| `npm test` | 259 项：258 通过、0 失败、1 跳过 |
| `npm run test:cf` | 258 项：258 通过、0 失败 |
| `npm run verify:cf` | 40 个文件，1,110,486 字节，只用到 Cloudflare 支持的模块；冒烟测试通过 |
| 新增测试 | `test/v354.test.js`（5 项）、`test/v355.test.js`（4 项）、`test/v356.test.js`（5 项） |
| 回归验证 | 每一轮的新测试放回上一版都会失败（自动分类等价性测试除外，它只检查结果不变） |
| 输出一致性 | 3.5.5 和 3.5.6 用同一份数据：`.rex` 正文和管理列表 JSON 的 SHA-256 完全相同 |

## 7. 参考

- Cloudflare《Rules of Durable Objects》：https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Cloudflare《Access Durable Objects Storage》（索引与读取行数）：https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Cloudflare Streams API / Stream large JSON：https://developers.cloudflare.com/workers/runtime-apis/streams/ 、https://developers.cloudflare.com/workers/examples/streaming-json/
- worker-tools/json-stream：https://github.com/worker-tools/json-stream
- sparklemuffin 订阅轮询与缓存：https://virtualtam.github.io/sparklemuffin/developer-guide/concepts/feed-polling-caching.html
- rss2email：https://github.com/skx/rss2email
- NetNewsWire 条件请求的 Bug：https://inessential.com/2024/08/03/netnewswire_and_conditional_get_issues.html
- feedparser-rs：https://docs.rs/crate/feedparser-rs/0.5.3/source/src/http/client.rs
