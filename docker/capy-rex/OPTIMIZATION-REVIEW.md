# Rex Widgets Hub CF 3.5.2 优化复查报告

- 基线版本：3.5.2（2026-11-21），Cloudflare Workers + Durable Object SQLite 版
- 原始树：`~/workspace/research_notes/rex-widgets-hub-cf-3.5.2/`（未动）
- 优化树：`~/workspace/research_notes/rex-widgets-hub-cf-3.5.2-opt/`（所有修改只在这里）
- 基线测试（优化树，未改动时，Node v24.22.1）：`npm test` 245 项，244 通过、0 失败、1 跳过；`npm run test:cf` 244 项，244 通过、0 失败、0 跳过
- **最终测试（优化树，全部修复后，Node v24.22.1）：`npm test` 245 项，244 通过、0 失败、1 跳过；`npm run test:cf` 244 项，244 通过、0 失败、0 跳过——与基线完全一致**
- 已改文件（仅 4 个）：`worker.js`、`filenames.js`、`backup.js`、`cf/do-storage.js`；原始树未动（`diff -r` 只差这 4 个文件 + 本报告）
- 已完成修复：FIX 2、FIX 3、FIX 4、FIX 5、FIX 6、FIX 7。已尝试后回滚：FIX 1、FIX 8（原因见各自小节）
- 打包检查（项目自带脚本 + 实装 esbuild）：40 个文件，1,099,110 字节，仅依赖 `cloudflare:workers`、`node:crypto`、`node:zlib`、`node:async_hooks`，无 Docker 运行层文件
- 写法约束：保守、不激进的语法；只改最小的；改坏测试或没有实测收益就回滚并写明原因
- **最重要的一句：本报告所有 CF 结论都来自本地模拟（`test/cf/fake-do.js`），没有部署到真实 Cloudflare 账号（VALIDATION-CF.md 自己也承认）。真机部署后请先跑 `/healthz`，再用小备份试一次恢复。**

## §1 CF 专属问题清单（先看这节）

按影响排序。每项都写明证据（文件:行）、实测情况、建议和状态。

### CF-1（高）：恢复备份的放行上限与可用上限不一致——入口放 100 MB，实际只能恢复约 20 MB

- 证据：
  - `restore-ui.js:69`：前端只拦 `file.size > 512*1024*1024`（512 MiB，Docker 的上限）。
  - `cf/hub.js:13-19`（`limitFor`）：恢复路径放行 100 MB。
  - `restore-jobs.js:65`（`submit`）：`request.json()` 之前没有任何大小判断，直接解析整份备份。
  - `CF-DEPLOY.md`：恢复时额外内存约是备份大小的 3 倍，备份 20 MB 以内稳妥，20–30 MB 可能失败，超过 30 MB 基本不行。
- 后果：30–100 MB 的备份可以正常选文件、正常上传，然后在解析/base64 解码阶段把 Durable Object 推过 128 MB 内存上限，请求失败且报错不直观。数据本身安全（恢复失败整体回滚，旧数据不变），但用户会看到一次看不懂的失败。
- 状态：**未修**。曾尝试硬上限修复（FIX 8），因与项目自己的 CF 测试冲突而回滚（见 §2）。目前仍是文档级缺口：入口放 100 MB、UI 放 512 MiB、实际 20–30 MB 以上就可能失败，且失败时报错不直观。软缓解（UI 上大于 20 MB 只警告不拦截）是后续方向，但需要 UI 知道自己在 CF 上，属于较大改动，不在这次做。
- 验证状态：代码已读实；30 MB 以上真实失败是文档说法（Node 估算，不是 Cloudflare 实测），未在真机上复现。

### CF-2（中）：`BUSY_LIMIT=64` 只计请求数，不计内存——并发大上传可能撑爆 128 MB

- 证据：`cf/hub.js:12`（`BUSY_LIMIT = 64`）、`cf/hub.js:87`（超过即 503，只看 `this.queued` 计数）。每个在途请求都可持有内存：25 MB 模块上传在 `cf/do-sql.js` 的 `param()` 里会再复制一份（`toBuffer` 切片），峰值约 50 MB；64 个并发即使每个只占 2 MB 也能顶满 128 MB。
- 可能性低（单管理员的个人 Hub，不太会同时发起几十个大上传），影响高（一旦 OOM，全部在途请求一起失败）。
- 状态：**未修**。修法需要在途字节数统计，属于中等改动；当前并发测试（VALIDATION-CF.md：30 下载 + 5 上传 + 5 列表同时进行全部成功）也没有暴露问题。先记为已知风险，不动。

### CF-3（中）：分片层只处理 BLOB，不处理 TEXT——超过 2 MB 的 TEXT 值在 CF 上直接失败

- 证据：`cf/do-sql.js` 的 `param()` 只对 `ArrayBuffer`/视图做分片，字符串原样通过；`test/cf/fake-do.js:48` 强制字符串超过 2,000,000 字节即 `SQLITE_TOOBIG`。
- 已逐个核查可能变大的 TEXT 列，结果都是安全：
  - `subscription_sources.snapshot`：清单抓取上限 1 MB（`subscriptions.js:187`），`JSON.stringify` 后约 1 MB，安全。
  - `source_previews.metadata`：只是模块元数据小 JSON（`subscriptions.js:429`），安全。
  - `settings`：全是小值（UUID、`1`、布尔、自动规则小 JSON），安全。
  - `upload_jobs.plan`：上限 45 个文件，每行约 1 KB，安全。
  - `module_names.originals`：上限 1000 个别名 × 500 字，安全。
  - `legacy_json`：只存模块/合集记录本身，不含文件内容，安全。
- 唯一边缘：`duplicate_ignores.members`。校验（`backup.js:165-168`）允许最多 20000 个 id、每个最长 100 字；最坏规范 JSON 约 2,060,000 字节，刚好超过 2,000,000 上限，在 CF 上失败、Docker 上通过。实际 id 是 36 字 UUID，20000 个约 780 KB，安全。所以这是病态输入才触发的边缘，不是日常风险。
- 状态：**未修**。真要修也只是把成员数上限再按字节收紧，属于防御性改动，收益太小。

### CF-4（中）：备份导出把全部图标 base64 后塞进一个 JSON——图标缓存满 128 MB 时导出必定 OOM

- 证据：`icons.js:6`（`ICON_LIMITS.assets = 128 MB`）；`icons.js:166`（`exportIcons` 把全部图标 `SELECT *` 后逐个转 base64）；`backup.js` 的 `exportBackup` 把整份备份拼成一个 JSON 对象再 `JSON.stringify`。128 MB 图标 → 约 170 MB base64，再加一次 stringify 复制，远超 128 MB。
- 可能性低（日常图标缓存远小于 128 MB，且有清理机制），但一旦触发就没有小修办法（要流式导出，大重构）。
- 状态：**未修**。文档已写“库很大请继续用 Docker”，与该结论一致。

### CF-5（低）：导出/恢复整份放内存（约 3 倍）——文档已写明，CF 上无小修办法

- 证据：`backup.js` 的 `exportBackup` / `prepareBackup` / `restoreBackup` 全程整份在内存；`CF-DEPLOY.md` 与 `VALIDATION-CF.md` 都写了 3 倍估算和 20 MB 建议值（Node 估算，不是 Cloudflare 实测）。
- 状态：**未修**。流式 JSON 解析 + 分块写是重构，不在本次范围。

### CF-6（低）：订阅同步仍是全量重下载——集合条目没有存 ETag/Last-Modified

- 证据：`subscriptions.js` 的 `syncItem` 每次都 `fetchCapped` 全量下载再 SHA-256 对比；单模块源已有条件请求（`syncSingle`，`subscription_sources` 上有 `etag`/`last_modified` 列）。给集合条目加验证器需要 `subscription_items` 加 2 列 + 迁移 + 304 处理，是中等改动。
- 状态：**未修**。收益是每 6 小时省掉未变更模块的重复下载；风险是同步逻辑一旦写错会漏更新。先记为后续设计，不在这次改。

### CF-7（已验证无问题）：100 参数上限——代码已按 33/100 分块

- 证据：`management.js:17-19`（33 组 × 3 参数 = 99）、`management.js:26-28`（每 100 个 id 一批）、`bulkManage` 的 id 上限 10；其余批量查询都用 `json_each(?)`（`backup.js:355`、`subscriptions.js:200`、`auto-rules.js:49`、`icons.js:122`）；`test/cf/fake-do.js:44` 在测试里强制执行该上限。
- 结论：没有超限的写法，不用改。

### CF-8（已验证无问题）：2 MB 行上限——分片层覆盖全部 BLOB 写路径

- 证据：`cf/do-sql.js:16`（`SPILL_THRESHOLD = 256 KB`）、`:17`（`CHUNK = 1 MB`）；`param()` 对所有经 `DOSql` 的 BLOB 参数分片，覆盖 `kv.value`、首页包 `bytes`、头像 `avatar_bytes`、`icon_assets.bytes`。实测（/tmp/measure-dokv.mjs，fake-do 替身）：300 KB 值写入后原字节读回，4 条 SQL；VALIDATION-CF.md 另有 6 MB 首页包与同行两份约 1 MB 内容的测试。
- TEXT 缺口只剩 CF-3 的边缘情况。

### CF-9（已验证无问题）：冷启动——本机导入 worker.js 29 ms，打包 1.1 MB

- 证据：`node -e import('./worker.js')` 在 Node v24.22.1 本机实测 29 ms；`node tools/verify-cf-bundle.mjs /tmp/esbuild-check/node_modules/esbuild` 实测 40 个文件、1,099,110 字节，仅 4 个允许的运行时依赖。模块顶层除 HTML 模板字面量外没有重活。不用改。
- 注意：29 ms 是本机 Node 的解析时间，不是 workerd 的冷启动时间；只能说明解析成本很小，不能直接当成线上冷启动数字。

### CF-10（已验证无问题）：GC 每 6 小时全表扫——2000 模块实测 1 ms

- 证据：/tmp/measure-gc.mjs（fake-do 替身）：50 / 500 / 2000 个模块，`collectGarbage()` 都是 1 ms，0 个孤儿分片。本地内存 SQLite 是下限，线上慢 10 倍也只有约 10 ms。`cf/hub.js:156` 每 6 小时跑一次，在写路径序列化里执行，不用改。

### CF-11（文档缺口，最高优先级提醒）：VALIDATION-CF.md 明确承认没有部署到真实 Cloudflare 账号

- 原文：“没有部署到真实的 Cloudflare 账号。这里不能连 Cloudflare，测试用的是本地模拟的 Durable Object，不是真实的 workerd 运行时。”
- 含义：本报告全部 CF 结论都建立在 `test/cf/fake-do.js` 这个替身执行“文档上写的 DO SQL 规则”的前提上。真实 workerd 的 2 MB 语义、CPU 计时、128 MB OOM 行为、闹钟精度都还没验证过。首次部署后请先打开 `/healthz`，再用小备份试一次恢复。另有三项文档自己列出的未验证：没拿真实旧 CF 3.5.0 备份恢复测试；免费计划 30 秒 CPU 没测过大备份恢复耗时；没用 Rex 真机测试导入和播放。

### CF-12（说明，无问题）：定时与闹钟节律与文档一致

- 证据：`wrangler.toml:29`（cron `*/5 * * * *`）；`cf/hub.js:120`（写成功后 `wake(1000)`）；`cf/hub.js:177`（忙时 1 秒闹钟，空闲最长 15 分钟）；`subscriptions.js:41`（`BATCH = 2`）。1000 模块全量同步约 500 轮、约 8 分钟是文档说法，与 `BATCH = 2` + 每秒一轮对得上。无问题，不改。
- 另：`cf/hub.js:57` 透传的 `CF_VERSION_METADATA` 在共享代码里没有任何读取处，绑定缺失也不会坏事（grep 全树仅此一处）。

### CF-DEPLOY.md 宣称对照（逐项核对代码）

| 宣称 | 核对结果 |
|---|---|
| 数据全在一个 DO SQLite，不用填 KV/D1 编号 | 属实：`wrangler.toml` 只有 `HUB` 绑定，无 KV/D1 |
| 恢复/覆盖失败整体回滚 | 属实：`cf/do-storage.js` 的 `atomic` → `ctx.storage.transaction()`；CF 测试覆盖回滚 |
| 免费计划可用 | 代码层面属实；计费数字本文不作断言 |
| 单次上传最大 100 MB | 属实：`cf/hub.js:13-19` |
| 内存 128 MB，备份 20 MB 以内稳妥 | 文档说法（Node 估算），未在真机验证；见 CF-1 |
| 单次请求 CPU 默认 30 秒 | `wrangler.toml:45` 的 `[limits] cpu_ms = 300000` 处于注释状态，与文档一致 |
| 不能访问内网来源 | 属实：`cf/hub.js` 的 `createSourcePolicy('', { addressCheck: true })`，空信任列表 |
| 超过 256 KB 自动分片，读出原字节 | 属实：见 CF-8 |
| 免费计划存储总量 5 GB | 文档说法，本文未验证（代码里无从验证） |
| Docker 自动分类约每分钟，CF 约每 5 分钟 | 与 cron 配置一致 |

## §2 通用性能发现与修复

### FIX 1（已尝试，已回滚）：管理页 ETag + 304

- 做法：启动时对 HTML 整页算一次 FNV-1a ETag，`/` 路由遇 `If-None-Match` 匹配返回 304，`Cache-Control: no-store` 改 `no-cache`。
- 实测收益：/tmp/verify-fix1.mjs（项目自带 harness）：首次 200 返回 283,907 字节，带 ETag 再请求返回 304、0 字节；错 ETag 仍回 200；`/index.html` 同样 304。
- 回滚原因：`npm test` 出现 2 处失败，`test/pwa.test.js:50` 明确断言首页 `cache-control` 为 `no-store`。这是项目有意测试的安全姿态（管理页外壳不进浏览器缓存），不是疏忽。单管理员页面每天只加载几次，省 284 KB 不值得改有意测试的安全头。已全部回滚，`diff -r` 确认优化树与原始树重新一致，测试恢复 244 通过、0 失败。
- 结论：不修。项目自己的 `home-configs.js:134` 也用 `no-store` + ETag + 304 的组合，但那是给会自己记 ETag 的客户端用的，浏览器对 `no-store` 不会自动复用。

### FIX 2（已完成）：公开下载路径每次 7 条 SQL，含 2 次全表扫描 → 3 条 SQL，0 次全表扫描

- 实测（/tmp/measure-download.mjs，50 个模块种子库，真实 `worker.fetch` + 记录 `DB.prepare`）：
  - 改前：`SELECT * FROM modules WHERE id = ?` + `SELECT * FROM module_names`（全表，50 行）+ `SELECT * FROM module_share_aliases ORDER BY alias_key`（全表，50 行）+ `SELECT file_key FROM modules WHERE id=?`（多余）+ `KV.getWithMetadata` 1 次（CF 路径内含 3 条 SQL）= 7 条 SQL。
  - 改后：`SELECT * FROM modules WHERE id = ?` + `SELECT * FROM module_names WHERE module_id=?` = 2 条 DB 语句；再加 FIX 3 后的 `getWithMetadata` 1 条 = 合计 3 条 SQL，0 次全表扫描。
- 改动（`filenames.js`、`worker.js`）：`decorateNames` 的单模块成形逻辑抽成 `withName(m, n)`，新增 `decorateNameOne(env, module)`（只查 `WHERE module_id=?` 的单行，不经过 `decorateShares`——下载路径只用 `effective_filename`）；两处公开下载分支 + 管理员下载 + 在线编辑四处改用 `module.file_key || 'file:'+module.id`（`autoMaintain` 的 `worker.js:1999` 那处没改：它的行只有 `id, is_encrypted` 两列，没有 `file_key`，且是后台任务每轮 8 行，不值得为此改 SELECT）。
- 等价性验证（/tmp/verify-fix2-equiv.mjs）：同一模块上新旧函数 10 个字段逐项相同；`downloadFilename` 新旧一致（`My-Title-v1.2.3.js`）；无 `module_names` 行时回退文件名一致（`plain.js`）。旧函数多带的 `share_alias`/`share_path` 下载路径不用，已读代码确认。
- 测试：`npm test` 244 通过、0 失败；`npm run test:cf` 244 通过、0 失败。

### FIX 3（已完成）：`DOKV.getWithMetadata` 每次 3 条 SQL → 1 条 JOIN

- 实测（/tmp/measure-dokv.mjs，fake-do 替身，统计原始 `sql.exec` 调用）：
  - 改前 `getWithMetadata`：3 条——`SELECT metadata FROM kv_metadata WHERE key=?`、`SELECT expires_at FROM kv_metadata WHERE key=?`、`SELECT value FROM kv WHERE key=?`。前两条查的是同一张表的同一行。300 KB 分片值：4 条（多 1 条 `_rex_spill` 组装查询）。
  - 改后：1 条 `SELECT k.value, m.metadata, m.expires_at FROM kv k LEFT JOIN kv_metadata m ON m.key=k.key WHERE k.key=?`；300 KB 分片值 2 条（JOIN + 组装查询）。`get` 仍是 2 条，未动行为。
- 改动（`cf/do-storage.js:40-90`）：类型转换抽成 `toValue(bytes, type)` 供 `get` 与 `getWithMetadata` 共用；`getWithMetadata` 改成一条 JOIN + 同步 `gate.run`（原来是嵌套 `await this.get` 的异步 gate，改后不再嵌套）。
- 语义验证（/tmp/verify-fix3-semantics.mjs，10 项全过）：text/arrayBuffer/stream/json/对象式 type；过期 → value null 但 metadata 照常返回；无行 → 两者皆 null；无 metadata 行 → value 正常返回；300 KB 分片值往返字节正确。
- 一处已知语义差异（已确认无实际影响）：只有 kv 行缺失、metadata 行独存时，新版返回 metadata null 而旧版返回 metadata。`put`/`delete`/`cleanup` 都是成对写删，不会产生这种孤儿 metadata；且唯一调用方（两处公开下载）都在 `!kvr.value` 时直接 404，根本不读 metadata。代码注释里已写明。
- 测试：`npm test` 244 通过、0 失败；`npm run test:cf` 244 通过、0 失败。

### FIX 4（已完成）：`exportBackup` 每个模块多查一次 `file_key`

- 改动（`backup.js:84`）：`await getFileKey(env,m.id)` → `m.file_key||'file:'+m.id`；`backup.js` 里 `getFileKey` 只此一处使用，顺手删了 import。N 个模块少 N 条查询（未单独计数，与 FIX 2 同一问题，收益随模块数线性增长）。
- 测试：`npm test` 244 通过、0 失败（内有备份导出测试）。

### FIX 5（已完成）：`restoreBackup` 循环里 `existingMods.find` 是 O(n²) → O(1) 查表

- 改动（`backup.js:159-160, 302`）：循环里的 `existingMods.find(row=>row.id===m.id)` 改成 `oldById.get(m.id)`。这里有个容易踩的坑：同函数里的 `oldMods` Map 在文件循环中会被新记录覆盖（`backup.js:205` 的 `oldMods.set(id, m)`），直接用 `oldMods.get` 会拿到**新**记录，导致旧 `upload-content:` 文件删不掉而泄漏。所以另存了一份恢复前的快照 `oldById = new Map(oldMods)`（建在 `oldMods` 刚建好、还没被覆盖的位置）。
- 测试：`npm test` 244 通过、0 失败；`npm run test:cf` 244 通过、0 失败（内有恢复测试）。

### FIX 6（已完成）：恢复时上一版 `kv_key` 查询 + 删除从 2N 条 SQL 并成 2 条

- 改动（`backup.js:299-307`）：原来逐模块 `SELECT kv_key ... WHERE module_id=?` 再逐模块 `DELETE ... WHERE module_id=?`，共 2N 条；改成循环前一次 `SELECT ... WHERE module_id IN (SELECT value FROM json_each(?))` 查全，再一次 `DELETE ... WHERE module_id IN (SELECT value FROM json_each(?))` 删完。`json_each(?)` 是项目已有写法（同文件 `backup.js:355`、`subscriptions.js:200`）。删除位置不变（仍在写文件循环之前），顺序语义不变；整段恢复包在 `env.ATOMIC` 事务里，KV 删除失败时回滚行为与原来一致。
- 测试：`npm test` 244 通过、0 失败（内有恢复测试）。

### FIX 7（已完成）：`title_scan_v1` 加索引，cron 每轮全表扫 → 走覆盖索引

- 改动（`worker.js:1819, 1834-1836, 1839`）：新增 `CREATE INDEX IF NOT EXISTS idx_modules_title_scan ON modules(title_scan_v1, created_at, id)`。两处细节：
  - 不能放进 `SCHEMA` 数组：列是 `ensureSchema` 后面循环才补的（`worker.js:1825-1832`），放前面会在新库上因列不存在而失败，并导致整个 schema 事务回滚。所以索引建在补列循环之后。
  - 必须升 schema 标记：`schema_titles_v1` → `schema_titles_v2`（只在 `worker.js:1819` 读、`1839` 写两处出现）。否则已部署过的库因标记已是 `1` 而提前返回，永远拿不到索引。升标记后旧库重跑一次 `ensureSchema`（全部 `IF NOT EXISTS` + 跳过已有列 + 幂等的 UPDATE），安全。
- 验证（/tmp/verify-fix7.mjs）：新库索引存在；`EXPLAIN QUERY PLAN` 两条查询都走 `SCAN modules USING COVERING INDEX idx_modules_title_scan`（COUNT 是纯索引计数；SELECT 仍需临时 B 树排 `ORDER BY`，因 `<>1` 跨多个值，但只读索引条目不读表）；只有 v1 标记的旧库重跑 `bootstrap` 后索引存在、v2 标记为 `1`。
- 背景：`backfillTitles(env,2)` 在 `scheduled`（`worker.js:2986`）每轮 cron 都跑，扫完后 `COUNT(*)` 仍每 5 分钟全表扫一次；索引后该 COUNT 只读索引。
- 测试：`npm test` 244 通过、0 失败；`npm run test:cf` 244 通过、0 失败。

### FIX 8（已尝试，已回滚）：恢复提交前按声明长度提前拒绝超大备份

- 做法：在 `restore-jobs.js` 的 `submit()` 里 `request.json()` 之前，若 `env.CF_RUNTIME` 且 `content-length > 20 MB`，直接 413 并提示用 Docker 版恢复或拆小备份；同时在 `cf/hub.js` 的 `hubEnv` 里加 `CF_RUNTIME: true` 标记（比用 `CF_VERSION_METADATA` 绑定判断更明确，且 CF 测试替身里也会生效）。
- 双向验证通过（/tmp/verify-fix8-cf.mjs、/tmp/verify-fix8-docker.mjs）：CF 上 21 MB → 413 + 明确提示，小备份仍走正常 400 流程；Docker 上 21 MB → 400（无效 JSON 的正常流程），不拦截。
- 回滚原因：`npm run test:cf` 出现 2 处失败——`test/cf/cf-more.test.js:166`（约 30 MB 大备份恢复，期望 200）与 `:189`（约 28 MB 大库导出后恢复 round-trip，期望 200）。项目自己的 CF 测试有意覆盖 28–30 MB 恢复（在 Node 替身里内存充足，能成功）；而文档对 20–30 MB 的说法是“可能失败”，是灰区不是硬线。20 MB 硬上限等于用测试数据之外的武断数字去否定项目自己的测试意图。已全部回滚，两个文件与原始树逐字节一致，`test:cf` 恢复 244 通过、0 失败。
- 结论：不修。CF-1 仍是开放问题（见 §1）。

### 静态发现（只读过代码，未实测，暂不修）

- `getModules()`（`worker.js:2178`）无分页、无上限，全表返回。这是管理端列表页，UI 本来就要全量在前端渲染，分页要改 UI，风险大于收益。不修。
- `scanNames` O(n²)（`filenames.js`：每模块调 `prepareName`，每次全表扫 `module_names` + `modules` + 设置项）：管理端工具，不是热路径。不修。
- `repairNames` 同上，但每批上限 20 行。不修。
- `listSubscriptions` 每源 2 个相关子查询：源数量小，不修。
- `collectGarbage()` 全表扫：已实测 2000 模块 1 ms（见 CF-10），不修。
- `prepareName` 在同步里每条目重复全表扫：与 CF-6 同一问题，要修需重构同步循环，不在这次做。

## §3 参考来源（每个修复取了什么模式）

- **ETag / 304 条件请求**：Cloudflare 官方 Changelog 的 Workers Cache `invalidate()` 示例（`const etag = '"${product.revision}"'`，`If-None-Match` 匹配即 304）；R2 静态资源教程同款写法；项目内 `home-configs.js:134` 的 `download()` 已有同样模式。FIX 1 取了这个模式，但因测试的安全断言回滚（见上）。
- **DO SQLite 按行计费、全表扫描最贵**：inkibra.com《Every row SQLite reads is on the bill》（2026-11-02，DO 按读取行数计费，无索引的查询读全表）；arc0.me《The 1-Minute Sensor Problem: Cursors or Bust》（游标 + 复合索引把每小时 82,000 行读降到约 70 行）；Cloudflare D1 文档《Use indexes》（用 `EXPLAIN QUERY PLAN` 验证走索引）。FIX 2、FIX 7 取了“单行点查 + 索引”模式。
- **Cache API / 缓存优先**：Claude Code 技能 `cloudflare-expert`（personamanagmentlayer/pcl）的 `caches.default` cache-first 模式；isitalive ADR-006（Cache API 检查约 0.5 ms CPU）。本项目管理页是 `no-store` 有意为之，Cache API 不适用，记在这里说明“学过，但不适合”。
- **AI 语法与约定**：上述 Cloudflare 官方示例与 `cloudflare-expert` 技能是 AI 时代的参考实现；本项目自己的写法是更直接的依据——`home-configs.js` 的 ETag 做法、`subscriptions.js` 与 `icons.js` 已有的 `json_each(?)` 批量写法、`management.js` 已有的 33/100 分块写法。所有修复都译成项目自己的写法：小函数、早返回、`const` + 模板字符串，不引入外来风格。

## §4 阅读范围

- 全文读过：`README.md`、`CF-DEPLOY.md`、`CHANGELOG-v3.5.2.md`、`VALIDATION-CF.md`、`SUBSCRIPTIONS.md`、`RESTORE.md`、`HOME-CONFIGS.md`、`worker.js` 服务端部分（1–60、1740–3072 行）、`filenames.js`、`sharing.js`、`subscriptions.js`、`uploads.js`、`remote.js`、`backup.js`、`home-configs.js`、`restore-jobs.js`、`gate.js`、`cf/do-sql.js`、`cf/do-storage.js`、`cf/index.js`、`cf/hub.js` 全文。
- 结构性读过（函数清单 + 关键路径，未逐行）：`worker.js` 内联管理页 UI（56–1741 行，复制相关函数按 CHANGELOG-v3.5.2 理解）。
- 还没读：`icons.js`（只查了存储与导出相关行）、`management.js`（只读了批量相关 1–90 行）、`duplicates.js`、`auto-rules.js`、`title-maintenance.js`（只读了 `backfillTitles`）、`metadata.js`、`migration.js`、`storage.js`/`kv.js`/`server.js`（Docker 层，只读了测试搭建所需部分）、`test/` 各文件（只按测试结果引用，未逐行审）。
- 按“读透”要求：没读完的模块不碰；上面“待实施”的修复只涉及已全文读过的函数。

## §5 待用户真机 / 部署验证（本报告无法代替）

- 首次部署到真实 Cloudflare 账号：`/healthz` 应回 `{"ok":true,"version":"3.5.2","runtime":"cloudflare-durable-object"}`，再用小备份试一次恢复（VALIDATION-CF.md 原话）。
- 优化树不是 3.5.3：改完后仍是 3.5.2 优化版，部署前请用新 Worker 名验证，确认无误再切域名（CF-DEPLOY.md 的建议）。
- FIX 2 / FIX 3 上线后：公开下载一次模块、打开一次管理页、跑一次订阅同步，确认无异常；大备份恢复仍以 20 MB 为限。
- 本报告的测试数字全部来自本机 Node v24.22.1 + fake-do 替身，不是线上实测。
