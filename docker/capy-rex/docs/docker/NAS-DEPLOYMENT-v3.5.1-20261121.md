# NAS / Docker Hub：3.5.1

2026-11-21（Asia/Shanghai）完成 3.5.0-local.1 → 3.5.1 原位部署。Cloudflare 工程未修改。

## 更新内容

ZIP64 首页包兼容修复、下载异常中文提示与首次中止原因保护、手机订阅工具栏精简/排序对齐，以及「设置 → 工具 → 整理旧链接」。详见 [CHANGELOG-v3.5.1.md](../../CHANGELOG-v3.5.1.md)。没有新增数据库结构、环境变量、挂载或端口。

## NAS 状态与保留项

- 原部署目录 `/volume7/docker/rex-widgets-hub`，项目 `rex-widgets-hub`、服务 `rex-hub`、容器 `rex-widgets-hub_rex-hub_1`。
- 原卷 `rex-widgets-hub_rex-data` → `/app/data`，源 `/volume2/@docker/volumes/rex-widgets-hub_rex-data/_data`；原端口 8083 → 8080。
- `.env` SHA-256 `9e6fe529d202a8133d4a23fb2f8a956ab44e5be56add1c2a24a02d284715fcd2`，Compose `cc87fac555da923729c29abfc5299f77e59d07d0eaa68f8236240292e0218947`，更新前后完全一致。密码、PUBLIC_URL、可信源、SOURCE_ADDRESS_CHECK 和 TRUST_PROXY 保持。
- 正式容器 healthy，restart count 0；局域网和原 HTTPS 域名 `/healthz` 均通过。正常调度启用，临时启动校验使用的 DISABLE_SCHEDULER/SKIP_UPGRADE_BACKUP 不留在正式环境。

## 数据与入口验证

上线前、停服后、3.5.1 启动校验后和正式上线后，比较所有业务表规范化摘要（只忽略临时租约和图片 last_used_at），包括首页原字节、分享身份、旧版本、命名记录及设置。模块原始文件另外核对摘要；SQLite quick_check 为 ok。

| 数据 | 数量 |
| --- | ---: |
| 模块 / 合集 / 成员关系 | 138 / 4 / 100 |
| 分组 / 文件名记录 / 上一版记录 | 5 / 49 / 11 |
| 订阅源 / 条目 | 7 / 28 |
| 图标源 / 条目 / 图片资产 | 2 / 858 / 109 |
| 首页配置 | 1 |

581 个旧公开入口均 HTTP 200，模块及合集完整响应字节与升级前一致。首页当前为未分享状态，管理员鉴权导出核对原字节摘要；没有替用户开启分享。模块、合集、订阅、首页、自动分类、文件名设置、恢复状态查询通过；未登录请求拒绝，原密码可登录。没有生产上传样本、恢复、整理旧链接、改名、分类或删除操作。

未新增备份；升级前后 backups 均为空。摘要不是可恢复副本，没有本次升级前数据库恢复点。未使用 down -v，正式数据及既有镜像保留。

## 构建与回归

- linux/amd64，Node 24.21.0，最终镜像 34 个运行文件和 8 个图标与本地源码 SHA-256 全部一致，不含生产 `.env` 或 SQLite。
- 本机 Node 24.22.3、25.9.0 和最终 NAS 镜像均 239/239，0 跳过。NAS 临时测试使用合成库和 tmpfs；OpenSSL 仅补装在一次性测试容器以生成证书，不加入正式镜像。
- 四个真实首页样本在本地临时数据库上传/原样导出/format 8 恢复通过，零外部下载。界面预览覆盖手机/平板/桌面深浅色，细节见 [LOCAL-FIXES-20261121.md](LOCAL-FIXES-20261121.md)。
- 未验证 Rex 真机导入/播放或客户端缓存刷新。

## Docker Hub

- `nfhgw295/rex-widgets-hub:3.5.1`、`nfhgw295/rex-widgets-hub:latest`。
- Manifest：`sha256:78c6e1bfeff7145b67e38bc317f0ea3cb1ca498fbd320910ec902de6dd81b603`。
- Config / NAS image ID：`sha256:1dd8420120afe1548ac870654a5e1af30a1a2c78a4886666d4171e567dd69485`。
- 匿名 Registry 请求遇到 HTTP 429 拉取限额，改用本次发布的临时登录执行 Registry API 校验，两标签 manifest/config 摘要、版本及 linux/amd64 架构与 NAS 一致；未做完整匿名拉取。

发行 ZIP 为 `Rex-Widgets-Hub-docker-v3.5.1.zip`，包含源码、测试、文档和 SHA256SUMS，不含生产数据及凭据。

临时 Docker Hub 登录及凭据目录已移除，三个一次性测试容器及其匿名卷已移除，正式容器内的本轮只读校验脚本已清理。正式数据卷及既有正式镜像保留。
