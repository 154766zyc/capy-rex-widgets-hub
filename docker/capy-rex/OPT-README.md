# Rex Widgets Hub CF 3.5.3 — 优化版

这是 3.5.3，以 3.5.2 为底的优化版（不是上游发布的 3.5.3）。
原始 3.5.2 在 `../rex-widgets-hub-cf-3.5.2/`，未动；所有修改只在这里。
完整复查报告（含 CF 专属问题清单、每项修复的前后实测、故意未修的项）在
`OPTIMIZATION-REVIEW.md`。

## 改了什么（共 4 个文件，都是最小改动）

1. **公开下载每次 7 条 SQL → 3 条，0 次全表扫描**（`worker.js`、`filenames.js`）
   - 新增 `decorateNameOne(env, module)`：只查 `module_names` 单行，不扫全表、不拉分享别名。
   - 下载处理改用行里已有的 `file_key`，不再多查一次 `getFileKey`。
   - 实测：50 模块库，单次下载 DB 语句 4 条 → 2 条（另 `getWithMetadata` 3 条 → 1 条）。
2. **`DOKV.getWithMetadata` 3 条 SQL → 1 条 JOIN**（`cf/do-storage.js`）
   - 一条 `LEFT JOIN` 一次拿全 value + metadata + expires_at；过期语义不变。
   - 实测：小值 3 条 → 1 条；300 KB 分片值 4 条 → 2 条；10 项边界语义检查全过。
3. **备份导出、恢复少做重复查询**（`backup.js`）
   - 导出每模块省一次 `file_key` 查询；恢复循环 `find` 改 O(1) 查表（注意：用的不是 `oldMods`，它会被新记录覆盖，另存了 `oldById` 快照）；
     恢复时上一版 `kv_key` 查询 + 删除从 2N 条并成 2 条（`json_each(?)` 批量写法）。
4. **`title_scan_v1` 加索引**（`worker.js`）
   - `idx_modules_title_scan ON modules(title_scan_v1, created_at, id)`；schema 标记 `v1` → `v2`，
     旧库重跑一次 `ensureSchema` 即可拿到索引。`EXPLAIN QUERY PLAN` 确认两条 cron 查询都走覆盖索引。

## 试过、已回滚（不要重新加）

- 管理页 ETag + 304：`test/pwa.test.js:50` 明确断言首页 `no-store`，是有意测试的安全姿态；单管理员页面省 284 KB 不值得改，已回滚。
- 恢复备份超 20 MB 直接 413：项目自己的 CF 测试（`test/cf/cf-more.test.js:166` 约 30 MB、`189` 约 28 MB）
  有意覆盖大备份恢复；文档对 20–30 MB 的说法是“可能失败”不是硬线。已回滚。

## 验证结果（Node v24.22.1，本机）

- `npm test`：245 项，244 通过、0 失败、1 跳过（与基线一致）
- `npm run test:cf`：244 项，244 通过、0 失败、0 跳过（与基线一致）
- `node tools/verify-cf-bundle.mjs`：40 个文件、1,099,110 字节，仅 4 个允许的运行时依赖
- 每次修复都先跑 /tmp 下的计数/等价性/语义脚本，再跑全套测试；改坏测试的都已回滚。

## 部署前请做的事（还没验证，不能直接当正式版用）

1. 用**新 Worker 名**部署这份代码，先不要覆盖旧站。
2. 打开 `/healthz`，应回 `{"ok":true,"version":"3.5.2","runtime":"cloudflare-durable-object"}`。
3. 用小备份试一次恢复；大备份仍以 20 MB 为限（超过可能失败，见报告 §1 CF-1）。
4. 公开下载一次模块、打开一次管理页、跑一次订阅同步，确认无异常。
5. 本地测试用的是 `test/cf/fake-do.js` 模拟，不是真实 workerd；线上行为以部署后实测为准。
