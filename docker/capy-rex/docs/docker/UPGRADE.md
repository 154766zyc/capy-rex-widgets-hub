# 升级到 Docker 3.5.1

从本项目 Docker 3.5 升级到 3.5.1 不新增数据库迁移或配置；保留原数据卷、Compose、`.env`、项目/服务名及端口，更新镜像后重建容器即可。已有模块、合集及首页分享地址不变。不自动执行旧链接整理、恢复或重新分类。以下 3.5 结构迁移说明适用于从更早版本升级。

本次 3.5.1 已在 NAS 完成原位部署并发布 Docker Hub `3.5.1`/`latest`；239 项容器回归和 581 个旧公开入口验证通过，详见 [部署记录](NAS-DEPLOYMENT-v3.5.1-20261121.md)。

本包继续使用现有 `rex.sqlite`，不使用第三方的 `hub.db` / `kv.db`，无需换卷或导出再导入。保留原 Compose、项目名、服务名、端口、`.env`、管理员密码和 `/app/data` 映射；不要运行 `docker compose down -v`。

3.5 增量增加 `auto_rule_seen`、`duplicate_ignores`、`home_configs` 表及失败条目索引；在独立启动步骤幂等校验，不复用旧的 3.3/3.4 迁移标记。启动不修改模块 ID、文件字节、合集 slug、别名、成员顺序、备注或分组，不自动分类旧模块、不自动去重。首页文件仍存原 SQLite，不新增挂载或环境变量。

从已有 Docker 3.4 首次升级，默认生成 `backups/pre-v35-<摘要>.sqlite` 一致性快照后执行事务迁移，成功写入 `docker_v35` 标记；正常重启不重复快照。沿用原 `SKIP_UPGRADE_BACKUP=true` 的一次性显式退出方式，跳过快照不跳过事务校验。此处是程序行为说明，本次未操作 NAS 或创建生产备份。

规则默认关闭；首次保存和关闭后重新开启会标记当时已存在的模块，避免保存规则就改动旧库。若要整理历史模块，进入设置 → 自动分类规则 → 整理现有未分类 · 先预览，核对后确认。备份恢复的规则默认关闭自动执行，恢复模块也不作为“新模块”自动扫描。

format 7 增加可选 `meta.enhancements`，包含规则和重复忽略记录；旧备份继续可恢复。旧版可能忽略这些新增配置，不应仅替换旧镜像当作完整回滚。需要回滚时停止服务，再使用 `restore-snapshot.js` 和已验证的实际 `pre-v35` 文件恢复；恢复前当前库由工具保留在 `rollback-saved`。

有首页配置时导出 format 8，包含原文件和分享身份；本版支持恢复 format 1–8。旧 Docker/CF 版不能恢复 format 8，不能改编号强行导入。旧镜像不提供首页管理及分享路由；如已保存首页，不要把仅换旧镜像当作完整回滚。请先独立导出需保留的 `.rex`，并保存整库备份。详见 [HOME-CONFIGS.md](../../HOME-CONFIGS.md)。

2026-11-21 已在 NAS 构建并通过隔离容器测试，原位部署和 Docker Hub 发布完成。此次沿用此前不额外备份的部署方式，一次迁移显式跳过快照，正式服务不保留该开关；没有本次升级前数据库恢复点。默认快照行为仍如上，不因本次跳过而改变。不要用包内默认 Compose 覆盖 NAS 的自定义配置。

## 以下是 3.4 及更早版本的历史说明

3.3 → 3.4 不增加数据库表，不改 format 7。保留原 Compose、`.env` 和 `/app/data` 数据卷；不要删除或另建数据卷，也不要使用 `docker compose down -v`。订阅图标仅使用现有摘要和图片资产，分组移动仅更新分组字段。旧模块和合集地址继续兼容。

2026-11-19 这次 NAS 升级按用户要求**不生成备份**，一次迁移容器显式设置 `SKIP_UPGRADE_BACKUP=true` 并关闭调度，正常服务不保留临时开关。没有这次升级前的数据恢复点。下文是保留的 3.3 历史升级说明；其中「自动备份」不代表本次已经创建备份。

## 历史：升级到 3.3

## 从 3.2.1 原位升级

默认保留升级快照。仅在管理员明确接受无升级前恢复点时，可对一次迁移容器设置 `SKIP_UPGRADE_BACKUP=true`（不写入持久 Compose 配置）。它只跳过快照，不跳过校验或事务；迁移成功后正常容器无需该变量。无快照时不能按下述快照步骤回滚。不要删除既有备份。

沿用原部署目录、`.env`、Compose 项目名、服务名、镜像配置、端口、PUBLIC_URL 和数据卷，仅替换代码与 Dockerfile。不要用发行包默认 Compose 覆盖 NAS 的自定义配置；不需要新增挂载、数据库或 Cloudflare 服务。原 `SOURCE_ADDRESS_CHECK`、可信源白名单和管理员密码保持不变。

1. 设置中导出旧 format 6 JSON，保留旧代码／镜像及配置。大库另备份完整 SQLite 数据卷。
2. 停止原容器，在原目录更新本包代码（不覆盖 `.env` 与数据），然后使用原项目名执行 `docker compose up -d --build rex-hub`。
3. 首次启动先创建 `/app/data/backups/pre-v33-<摘要>.sqlite` 一致性快照，再在事务中增加分享别名表、来源预览表及来源新列。失败会回滚并停止启动；相同输入重试复用已校验快照。
4. 升级不会重建模块／合集／成员表，不自动批量创建分享名、不改旧文件名、不接管旧单链接来源。既有模块 ID、widget ID、字节、合集路径、历史路径、顺序、备注及手动维护状态保留。
5. 用原密码登录，检查旧合集和模块链接；需要时主动「分享模块」或「整理已有单链接来源」。

3.3 新导出 format 7，包含分享别名历史／墓碑与单模块来源字段；支持旧 format 1–6。CF 3.3 与 Docker 3.3 的 format 7 已用隔离测试数据往返验证，但部署网络策略仍分别生效；备份不会关闭地址检查或替换密码。

**回滚不能只换回 3.2.1 镜像**：它不认识分享别名和单模块来源。先停止服务，用 3.3 镜像内的离线工具恢复实际的升级前快照，再换回保存的旧代码／镜像及配置：

```sh
docker compose stop rex-hub
# 先核对实际快照文件名，再替换下面占位值
docker compose run --rm --no-deps rex-hub node restore-snapshot.js /app/data/backups/pre-v33-实际摘要.sqlite --offline
# 恢复你保存的 3.2.1 镜像／代码与原配置后，以原项目名启动
```

工具会把升级后数据库及 WAL/SHM 保存在 `rollback-saved`，但在线状态回到快照时间；新分享链接和升级后的改动不会在旧版继续服务。旧版必须拒绝 format 7。禁止 `docker compose down -v`。

从更早版本升级也在原库完成；根据旧版本使用 `pre-v32`、`pre-v31` 或 `pre-v3` 快照前缀。下面保留各旧版本的历史说明，出现的「本版」「待发布」及备份格式只适用于对应历史版本。

---

## 3.2 历史升级说明

3.2 新增单模块下载和独立文件名表。现阶段仅本地实现，未执行部署。未来从 3.1 原位升级时，首次启动先生成 `pre-v32-*.sqlite` 完整快照；不自动改名，不改变模块/合集身份。确认改名后，合集地址保持原样，内部模块 URL 使用带文件名的新路由，旧模块 URL 继续有效。回退需恢复升级前快照并配合旧代码。新备份 format 6，兼容恢复 format 1–5。详见 [FILENAMES.md](../../FILENAMES.md)。

以下为 3.1 历史升级说明。

## 从 3.0.x 升级到 3.1（本版）

保留原部署目录、`.env`、Compose 项目名、镜像名、端口、PUBLIC_URL 及原数据卷，仅更新程序代码、Dockerfile 并重新构建。不能用默认 Compose 或 `.env.example` 覆盖已有自定义配置。3.0.2 的 SOURCE_ADDRESS_CHECK 和可信源规则保持原设置。

首次启动在 `/app/data/backups/pre-v31-<摘要>.sqlite` 生成一致性备份，再在事务中增加三张图标表；失败回滚并停止启动。不会预先添加图标源、联网下载图片或迁移旧图标 URL。图标选择仅在管理员主动保存合集时生效。模块字节、所有 ID、路径别名、合集成员与顺序、备注、分组不改变。

**3.1 回退到 3.0.x 不能只换镜像**：旧代码不提供 `/api/icons` 图片接口。先停服务，使用 3.1 镜像里的离线工具恢复实际的 `pre-v31-*.sqlite`，再换回之前保存的镜像和代码/配置。回到快照时刻的在线状态，升级后的数据库会保存在 rollback-saved 中，但快照之后的新改动不自动合并。禁止 down -v。

```sh
docker compose stop rex-hub
# 使用当前 3.1 镜像，实际快照文件名须先从 /app/data/backups 核对
docker compose run --rm --no-deps rex-hub node restore-snapshot.js /app/data/backups/pre-v31-实际摘要.sqlite --offline
# 再恢复你自己保留的旧代码、镜像和原配置，使用原项目名启动
```

新导出备份为 format 5，包含图标资源；3.1 可以恢复旧 format 1–4。旧应用会拒绝 format 5，请保留升级前 JSON/SQLite 备份。

以下章节保留 3.0.2 及更早升级说明；其“没有新增迁移”等描述仅适用于相应旧补丁，不适用于 3.1。

## 已在使用 3.0 / 3.0.1 的用户

3.0.2 仅增加地址检查开关，不新增数据库迁移、身份或 UI 改动。保留原 `.env`、数据卷、项目名、端口和 `PUBLIC_URL`，更新代码及 Compose；需要关闭拦截时在现有 `.env` 追加 `SOURCE_ADDRESS_CHECK=false`，并将此变量传入容器 environment，再运行 `docker compose up -d --build rex-hub`。只 restart 不加载新配置。自定义 Compose 不要被发行包默认端口/镜像名覆盖，仅合并必要环境变量。

此模式允许访问容器可达的内网/回环/特殊地址，仅订阅可信源；不关闭 TLS 验证或下载限制。详情见 [ADDRESS-CHECK.md](ADDRESS-CHECK.md)。旧白名单可保留；检查关闭时无需逐个登记域名。回退到 3.0 / 3.0.1 可保留数据库换回对应旧镜像，旧版本不会识别此开关。下文数据库快照恢复仅用于回退到 1.x/2.x。

## 已在使用 3.0 的用户

本次是可信内网源白名单补丁，没有新增数据库迁移，也不重建模块、合集或来源身份。保留原 `.env`、数据卷、Compose 项目名和 `PUBLIC_URL`，备份后更新代码及 `compose.yaml`，在现有 `.env` 中按需追加：

```dotenv
TRUSTED_SOURCE_ORIGINS=http://192.168.1.5:2233
```

然后执行下方的构建启动命令。不要用 `.env.example` 覆盖原 `.env`，也不要删除数据卷。3.0.1 继续包含 3.0 的 UI 调整。若只从 3.0.1 回退到 3.0，本补丁不改变数据库格式，可保留原数据库换回旧镜像；内网源会恢复为禁止下载，已有模块仍可使用。下文的数据库快照恢复仅适用于回滚到 1.x/2.x。

## 升级前

1. 在“设置”导出一份 JSON 备份，并保留旧代码包与 `.env`。大库请在停止服务后完整备份原数据目录或数据卷。
2. 记录原 Compose 项目名、数据卷名、外部域名和端口。可用 `docker compose ls`、`docker compose config --volumes`、`docker volume ls` 查看；不要把含密码的完整配置公开。
3. 如果旧镜像使用默认名称，可先给它另加标签：

```sh
docker image tag rex-widgets-hub:local rex-widgets-hub:before-v3
docker compose stop rex-hub
```

## 更新与启动

在**原部署目录**更新本包代码和 `compose.yaml`，保留原 `.env` 和任何数据目录。Compose 服务、镜像名和 `rex-data` 卷键保持原样。如果以前显式使用 `-p`，以下命令也必须使用同一项目名。

```sh
docker compose up -d --build rex-hub
docker compose logs --tail 80 rex-hub
```

不要执行 `down -v`，不要删除 SQLite 文件，不要把空数据目录替换到原卷上。只改部署目录名称也可能导致 Compose 使用一个新的空卷。

第一次启动会先生成 `/app/data/backups/pre-v3-<摘要>.sqlite` 一致性快照，再在同一 SQLite 事务里迁移；失败会回滚、停止启动，原快照仍在。同一份旧数据重复启动复用已校验快照，不重复塞满磁盘。已有正常 3.0 标记后不会再次执行旧库迁移。

## 保留和变化

- Docker 1.x 的 KV 模块/合集迁到 SQL；Docker 2.0/2.1 的 SQL 模块/合集原位保留；2.1 的旧 `sources/source_items` 迁入新订阅表，不生成新模块 ID。
- 模块原始字节、加密标志、旧 widget ID、模块 ID、合集 ID/slug、历史别名、备注、分组、排序和来源关联保留。
- `.rex`、`.fwd`、无后缀、`/rex`、`/fwd` 合集入口和旧模块 `/raw`、`.js` 等入口继续有效。改合集路径会保留旧地址别名；占用其他合集或别名的路径会拒绝。
- 原有自动全量合集 `autoAll` 保留自动追加；普通自选合集不会随订阅新增而改变成员。
- 旧模块标题初始锁定，防止新解析器改变现有显示；需要时可在管理界面解锁。旧单 JS 链接初始保持手动维护，避免升级即覆盖；恢复自动维护后会进入定期刷新。旧订阅按原启用状态迁移。
- 旧管理员密码仍可登录，登录后升级哈希。旧公共用户/配置记录保留为兼容数据，但当前上游没有旧公共用户管理入口。

验证时先打开旧合集地址，再下载几个旧模块核对。保持原 `PUBLIC_URL`/域名可保留绝对链接的 origin。数据库迁移本身不能替换 DNS、证书或客户端缓存。

## 回滚

旧代码不应直接读取已经更新并写入新文件指针的 3.0 数据库；要同时回滚镜像与数据库。

先停止服务，查明实际快照文件名：

```sh
docker compose stop rex-hub
docker compose run --rm --no-deps rex-hub node -e "console.log(require('node:fs').readdirSync('/app/data/backups').join('\n'))"
```

使用 **3.0 镜像**中的离线恢复工具，将下面占位文件名换为实际文件名：

```sh
docker compose run --rm --no-deps rex-hub node restore-snapshot.js /app/data/backups/pre-v3-实际摘要.sqlite --offline
docker image tag rex-widgets-hub:before-v3 rex-widgets-hub:local
docker compose up -d --no-build rex-hub
```

离线工具先验证 SQLite，再把当前库及 WAL/SHM 移到 `/app/data/rollback-saved/<时间戳>/`，不会删除升级后的数据。回滚后的在线库回到快照时刻，升级后新增记录不会自动合并，但仍保存在 rollback-saved 供后续恢复。恢复工具不允许选择数据目录 backups 之外的任意路径。
