# Docker 运行说明

## 存储

Compose 服务仍叫 `rex-hub`，本包构建镜像标签为 `rex-widgets-hub:latest`，卷键仍是 `rex-data`；这是本地构建标签，不代表已发布 Docker Hub。已有 NAS 自定义镜像／Compose 配置应沿用原值。实际 Docker 卷名通常带 Compose 项目名前缀，因此升级时必须沿用原目录或原 `-p` 项目名。

容器内唯一应用数据目录是 `/app/data`，核心文件是 `rex.sqlite`；运行时可能有 `rex.sqlite-wal` 和 `rex.sqlite-shm`。模块并非保存在宿主机 `widgets` 文件夹，而是该 SQLite 的 BLOB 表中。`kv` 只是兼容上游接口的本地表名，不是外部 KV 服务。

3.1 的图标源、图标清单和图片也保存在原 SQLite，图片为 BLOB，不需要增加文件夹映射或新数据卷。合集选中的图标固定为内容哈希地址，上游更新或移除来源不改它。

3.3 的分享别名、历史占用、来源类型及预览记录也在同一 SQLite；预览文件通过本地 KV 适配表缓存 10 分钟。无需单独映射模块文件夹，首次升级先备份再事务迁移，见 [UPGRADE.md](UPGRADE.md)。

3.5 的自动分类规则、已处理模块基线和重复忽略记录也在原 SQLite；不增加卷或宿主机目录。默认不启用自动分类。设置页可保存规则或预览历史整理，普通合集只有规则明确选择后才追加。

默认使用命名卷，不映射个人文件夹。若已有 bind mount，请沿用原映射，并保证 UID/GID 1000 可写该数据目录。不要挂载一个空目录覆盖旧数据卷。

## 配置

| 配置 | 用途 |
| --- | --- |
| `ADMIN_SECRET` | 首次登录密码；已有数据库中的改密结果优先 |
| `HOST_PORT` | 宿主机端口，默认 8080 |
| `PUBLIC_URL` | 可选，完整外部 HTTP(S) origin，不含子目录；用于公开下载/合集链接和 Cookie 协议 |
| `TRUST_PROXY` | 默认 false；只有容器只能被可信反代访问时才设 true |
| `TRUSTED_SOURCE_ORIGINS` | 默认空；允许访问私有 IPv4 的精确 HTTP(S) origin 白名单，多个值用英文逗号分隔，不含路径；如 `http://192.168.1.5:2233` |
| `SOURCE_ADDRESS_CHECK` | 3.0.2 新增；默认 true。false 关闭远程下载地址范围检查，兼容 Fake-IP，但也开放容器可达的内网/回环/特殊地址；仅信任来源时使用。其他非空值报错 |
| `PUBLIC_SECRET` | 旧环境兼容占位，不启用公共用户组登录 |

`PORT` 和 `DATA_DIR` 由镜像默认设为 8080 与 `/app/data`。修改它们时需一并检查端口、挂载和健康检查。应用以非 root 用户运行。

## 反向代理

推荐设置 `PUBLIC_URL=https://你的域名`。若启用 `TRUST_PROXY=true`，反代必须覆盖客户端传入的 `X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-For`，且应用端口不应直接暴露给不可信客户端。

直接 HTTP 局域网访问可留空 `PUBLIC_URL`，登录 Cookie 不带 Secure；HTTPS 外部 origin 会带 Secure。未信任反代时，客户端伪造的 CF/转发头不会决定限流 IP。

## 后台同步

进程内定时器取代 Cloudflare Cron，不需要宿主机定时任务。订阅清单分批处理，每批最多两个下载；未完成批次约每秒继续，完成后依据数据库中的六小时期限开始下一轮。维护任务空闲时约每分钟检查。停止容器时会取消网络下载并等候短事务完成。

「全部同步」将所有启用来源的下次同步期限设为待处理，后台持久继续；前端同时按顺序驱动队列，不一次并发全部源。「重试失败」仅下载上次失败且仍活跃的条目，不重新下载成功项或据旧清单判定下架；整份清单读取失败时应点普通「同步」。规则维护每次最多处理 200 个稳定超过 20 秒的新模块，不依赖管理网页保持打开。

图标源每天检查清单，可手动刷新；失败保留旧清单并退避。图标按选择器当前页按需下载，后端最多三个并发，缓存总额 128 MiB。图标不进入模块订阅或模块库；图标的网络访问沿用同一套管理员地址策略。详见 [ICONS.md](../../ICONS.md)。

远程抓取默认仅允许公网 HTTP(S)；3.0.1 可通过 `TRUSTED_SOURCE_ORIGINS` 精确允许可信源访问 RFC1918 私有 IPv4。导入、订阅清单成员、手动刷新和定期刷新共用策略，逐跳检查重定向，在实际连接的 DNS 回调中检查全部解析结果。回环、链路本地、fake-IP/基准测试和其他保留地址仍拒绝。请求最多 20 秒，限制响应体大小，不继承通用环境代理，也不关闭 HTTPS 证书验证。

白名单是部署配置，不是网页表单开关，恢复数据库备份也不会扩大权限。修改后需重新创建容器；仅 `docker compose restart` 不会加载新的 `.env`。完整步骤见 [TRUSTED-SOURCES.md](TRUSTED-SOURCES.md)。

上述地址限制适用于默认 `SOURCE_ADDRESS_CHECK=true`。若管理员明确设置 `false`，URL/IP/DNS 地址分类不再拦截，白名单不再是访问条件；重定向每跳仍检查 HTTP(S)/无凭据并限制次数，TLS 验证和下载大小/超时/内容验证仍保留。程序启动会记录风险警告。详见 [ADDRESS-CHECK.md](ADDRESS-CHECK.md)。

## 检查

```sh
docker compose ps
docker compose logs --tail 100 rex-hub
docker compose exec rex-hub node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>console.log(r.status,await r.text()))"
```

如果升级后界面突然空白或显示空模块库，先停止服务检查是否用了新项目名/新卷，不要再次上传全部模块、重置或删除数据卷。

普通 HTTP 请求体最多 128 MiB；仅 JSON 备份恢复接口上限为 512 MiB。当前 format 7 备份包含 base64 图片、模块和分享名历史，大库恢复应使用离线数据库快照。数据卷包含模块源码、订阅 URL 和图片，应限制备份访问权限。

当前开发机没有 Docker CLI/daemon，因此本包提供 Dockerfile/Compose，但未在本机完成真实镜像构建或容器运行。Node 24 实际 HTTP 测试结果见 VALIDATION.md。
