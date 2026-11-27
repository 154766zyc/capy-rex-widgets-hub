# Capy/Rex 模块管理 V1.4-CF

本版以原 CF 3.6.0 的 SQLite Durable Object 为基础，保留原 CF 管理员、模块链接、合集、上传、订阅同步、备份恢复、首页配置、图标和文件管理。新增 /crypto 加解密外链。它不是 NAS 社区版的完整平移：开发者账户、投稿审核、公开 Capy 分类页与 NAS 在线检查器未接入 CF 请求路由；包内共享测试所需 nas/validator 文件不代表已上线这些功能。模块可作为文件托管，Capy 请用公开 JS 地址安装，不能把 Rex 合集协议称为 Capy 合集。

原因：社区实现依赖 Node fs、NAS 初始化/账户表和本地入口，当前 CF 入口只连接原版 DO。不是因为包大小而删功能。干运行包 gzip 约 1.3 MiB，保留原 CF 功能。无本地 Rex 加解密，外链服务会上传用户提交的内容。

## 从零部署
1. 准备 Cloudflare 账户。电脑安装受支持 Node.js（本次 Node 24）与 npm，解压到单独目录，在该目录打开终端。
2. 打开 wrangler.toml，name 是 Worker 名称，可改成自己唯一名称；保留 main、HUB、RexHub、new_sqlite_classes 和 nodejs_compat。使用全新名称，别覆盖旧服务。无需 D1/KV ID。
3. 执行 `npm install`，然后 `npx wrangler deploy --dry-run`。本包实测 Wrangler 4.168.0，可固定 `npx wrangler@4.168.0 deploy --dry-run` 复核。此步骤只打包不发布。
4. 执行 `npx wrangler login`，只在打开的浏览器里授权。不要把登录信息发送给 AI。确认自己的账户后执行 `npx wrangler deploy`。
5. 执行 `npx wrangler secret put ADMIN_PASSWORD`，按终端提示输入强密码，重新打开部署地址。首次登录后检查实际设置；不要把口令放 wrangler.toml 或源码。未配置密码前不要导入私人数据。
6. 首页管理员登录后添加模块链接或上传测试文件，创建合集，复制合集/模块公开链接，实际客户端下载验证。外链工具在 `/crypto`。
7. 在 Cloudflare 控制台 Worker 的 Settings → Domains & Routes 添加自己域名；先确保 workers.dev 地址工作。不需要修改 NAS 网关或 Lucky。
8. 更新前从管理页面导出备份，保存本地；保留旧源码包和迁移记录。新 Worker 的 DO 不自动含旧数据，使用应用导入恢复；NAS 全库 SQLite 不能直接塞入 CF。社区账号/审核记录不在此 CF 功能范围。
9. 日志用 `npx wrangler tail`，避免记录源码和凭据。DO binding 错误检查 HUB/RexHub/migrations；登录失败确认 secret 和 Cookie/HTTPS；配额错误在 Dashboard 查看用量。

## 费用和容量
2026-11-27 通过真实浏览器核查官方文档：Workers Free 100000 请求/日、10ms CPU、128MB 内存、50 子请求/次；当前文档 Worker size 表为 64MiB。不同请求类型限制以官方细节为准，不能用干运行大小证明业务 CPU 达标。
SQLite DO 免费层可用：100000 请求/日，13000 GB-s/日，读 500万行/日，写 10万行/日，合计 5GB。超过免费配额可能请求失败；自动同步、Cron、备份和全表扫描也消耗用量。Paid 包含量和超额计费不同，DO 是额外计量；本次没有开通付费。
低流量可尝试免费层，但未在用户账户测量实际 CPU；大量同步/大备份可能超出免费额度，不能保证免费层所有工作负载成功。先用小样本观察 CPU 和行数，再决定优化或是否由自己选择付费。
来源：https://developers.cloudflare.com/workers/platform/limits/ 和 https://developers.cloudflare.com/durable-objects/platform/pricing/

## 验证范围
已执行真实 Wrangler dry-run，不需要凭据，没有发布到 Cloudflare。共享回归和 fake DO 测试不是 Cloudflare 实网负载验收。部署后仍需自行检查持久化、恢复、Cron 和实际用量。完整上游参考见 CF-DEPLOY.md。

实测边界：fake DO 的约28MB恢复测试，Node 额外内存峰值约144MB；这不是 Cloudflare测量，但已经高于 Worker 128MB限额，因此不能保证该规模恢复在 CF 成功，付费也不自动提高128MB内存。请先拆分小备份并实测；大量文件/大备份优先保留 Docker。
