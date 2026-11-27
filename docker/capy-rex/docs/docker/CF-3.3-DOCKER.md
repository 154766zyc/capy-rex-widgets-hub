# CF 3.3 → Docker 同步记录

版本：3.3.0-local.1，日期：2026-11-18。依据用户指定的 `deployment/widget-hub/CF-3.3.md` 及该目录的配套源码适配；原 Cloudflare 工程未修改。源文件摘要见 [UPSTREAM.md](UPSTREAM.md)。

## 已同步的契约

- `module_share_aliases` 保存固定名称、NFC／小写唯一键、当前／历史名称与删除占用。删除及清空只将旧名称标记为墓碑，不转给其他模块；恢复先检查所有权和当前名唯一性。
- 模块列表返回 `share_alias/share_path/share_revision`，保留 `public_path/effective_filename`。分享预览与确认接口分别为 `POST /api/admin/modules/:id/share/preview`、`PUT /api/admin/modules/:id/share`，过期确认或占用冲突返回 409。
- `/api/modules/:alias.js` 先匹配旧模块 ID，再解析别名；单次解码并校验安全文件名。返回原始 JavaScript 字节，无 HTML／重定向，支持 GET、HEAD、CORS、ETag／304。新分享名需主动确认，更新内容／标题不改名，旧路由继续有效。
- `subscription_sources` 原位增加 `kind/title_locked/revision/etag/last_modified`；旧记录默认合集，不重建模块及关系表，不自动登记旧单链接。
- `POST /api/admin/subscriptions/preview {url}` 返回识别类型、标题、文件名、内部 ID、已存在模块／来源及总数；不创建正式记录。预览通过同一 SQLite 的 KV 适配表缓存十分钟，代际失效规则与 CF 一致，不需要新增目录。
- `POST /api/admin/modules/import` 与 `POST /api/admin/subscriptions` 支持 `preview_id`，保留旧无预览调用。前端强制「识别链接 → 确认」；单模块即时入库并返回 `done:true`，合集按批继续。相同 URL 复用并保留暂停状态。
- 单模块在来源内固定使用 `remote_id='single'`，但新加密模块公开 `widget_id` 回退本地 ID，绝不发布 `single`。六小时同步按 SHA-256 判定内容，版本号不变也可更新；缺文件时不接受 304，失败保留旧文件。
- 来源列表和编辑接口增加新字段。名称锁独立于模块标题；URL 编辑要求有效预览／修订号及必要的内部 ID 变化确认，不能切换类型，活动租约期间拒绝编辑。模块 URL 在成功发布新内容后才改。
- `GET/POST /api/admin/subscriptions/legacy` 手动预览确认旧链接，每批 1–10 条；登记、映射与托管标记同事务，保留手动维护状态且不下载。
- format 7 包含分享名历史／墓碑和新来源字段，保留模块、成员顺序、图标、分组、上一版、文件名配置及自动合集。兼容 format 1–6，恢复重置修订、租约、条件请求缓存和预览代际，不含管理员密码、会话或 CF 令牌。

## Docker 保留的实现差异

仍为 Node 24 HTTP 入口、本地 SQLite D1/KV 适配、短事务写入队列和容器进程内调度；不使用 Durable Object、D1、外部 KV 或 Cloudflare Cron。完整 JSON 恢复上限 512 MiB，大库使用一致性 SQLite 快照。CF 的分文件暂存恢复接口不直接照搬到 Docker；最终校验与事务发布语义保留。

已有网络规则不变：默认检查公网地址，精确可信源白名单或显式 `SOURCE_ADDRESS_CHECK=false` 沿用原配置。备份恢复不扩大权限，手动导入／定时刷新／重定向共用规则。

额外补齐：未初始化的旧来源修订号、Unicode 别名解析、短事务内的来源租约／代际复查、内网订阅恢复的配置一致性、上一版摘要／大小校验、重复订阅记录恢复拒绝、过期预览记录清理及识别期间 URL 变化保护。

## 交付与边界

完整回归、真实旧版原位升级、跨运行时备份往返及隔离浏览器记录见 [VALIDATION.md](VALIDATION.md)。2026-11-18 已在 NAS 构建 linux/amd64 镜像、原位部署并发布 `nfhgw295/rex-widgets-hub:latest`；运行镜像与匿名 Registry 验证一致。未修改 Cloudflare 正式服务，未验证 Rex 真机。

部署须保留现有数据卷和配置；首次从 3.2.x 升级默认生成 `pre-v33` 快照。本次用户明确要求不备份，仅迁移容器临时使用 `SKIP_UPGRADE_BACKUP=true`，正常服务已恢复默认配置；没有生成快照，不能声称具有升级前恢复点。回滚不能仅换旧镜像；操作见 [UPGRADE.md](UPGRADE.md)。
