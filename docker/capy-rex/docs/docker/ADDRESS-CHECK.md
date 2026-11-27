# 下载地址检查开关（Docker 3.0.2）

## 针对 Fake-IP 网络的配置

在原部署目录现有 `.env` 中追加：

```dotenv
SOURCE_ADDRESS_CHECK=false
```

更新 3.0.2 的代码和 Compose 后重新构建/创建容器：

```sh
docker compose up -d --build rex-hub
docker compose logs --tail 80 rex-hub
```

保留原 `.env` 中其余值、数据卷、Compose 项目名、镜像配置、端口和 `PUBLIC_URL`；有原 `-p` 的继续沿用。不要执行 down -v。自定义 Compose 仅合并新增的 environment，不覆盖 NAS 当前端口或镜像名：

```yaml
environment:
  SOURCE_ADDRESS_CHECK: ${SOURCE_ADDRESS_CHECK:-true}
```

只执行 restart 不会加载变更后的环境。可仅检查该非敏感变量，不要打印整个容器环境：

```sh
docker compose exec -T rex-hub node -e 'console.log(process.env.SOURCE_ADDRESS_CHECK || "true (default)")'
```

## 行为

- 不填写、空值或 `true`：保持原 URL 与 DNS 地址检查；可信内网来源仍可用 TRUSTED_SOURCE_ORIGINS 精确授权。
- `false`：关闭目标地址分类，不因域名或 IP 属于内网、回环、保留范围而拒绝；使用系统 DNS 返回的地址，包括 Fake-IP。无需逐个添加合集/模块域名。
- 其他值：启动时报配置错误，在数据库创建或迁移前失败。大小写敏感，不能用 0、off 等代替。
- 仅管理员部署环境可决定；网页表单、清单字段或数据库备份不能自行更改。每个 Hub 实例独立，不能改变同进程其他实例的权限。
- 单模块导入/手动刷新/六小时后台刷新、合集清单及成员、订阅手动和后台同步、重定向使用同一个策略。TRUSTED_SOURCE_ORIGINS 可保留；关闭时白名单不是访问条件，其格式仍须合法。

## 保留的限制

仅 HTTP(S)、无 URL 内嵌账号密码；HTTPS 证书必须有效。不继承通用环境代理，也不发送后台 Cookie/密码。保留 20 秒下载超时、原响应体大小上限、最多五次重定向、清单验证与模块内容检查。模块只保存为文件字节，不执行其代码。

本开关不是“所有链接都一定成功”：连接拒绝、路由不可达、源站错误、证书错误、下载超限或无效清单仍会失败，按原逻辑保留最后有效内容。

## 风险与撤销

**关闭后，下载器能请求容器可达的内网、回环和其他特殊地址。** 不仅适用于亲自填写的 URL，也适用于上游清单成员和重定向。只向可信管理员开放后台，只使用可信订阅；这会降低 SSRF 防护边界，但不取消登录认证或开放匿名代理接口。程序启动会输出一次明确警告，不输出密码或完整配置。

将值改回 `true` 并重新创建容器即可恢复。不会删除已有模块、合集、备注或来源关系；不符合规则的后续下载失败时继续保留旧内容。

本次不修改数据库结构、模块 ID、widget ID、合集 ID/slug、历史地址别名、成员引用/排序、分组、备注或 UI。默认安全行为不变，必须由管理员显式关闭。

## 本机验证

Node 24.22.1 与 25.9.0 均通过 68 项测试；其中包括真实 HTTP 跨端口重定向/导入、关闭模式仍拒绝无效 TLS 证书、Fake-IP DNS、恢复检查后旧内容/地址保留。

在开启关闭模式的独立临时数据库中，通过 Hub HTTP 接口导入用户指定 `https://rex.example.com/api/collections/enc.rex`：返回 201，五个模块全部同步成功、失败数 0。仅下载静态字节，不执行模块，不写现有模块库；临时库随测试清理。生产 NAS 的实际部署结果应单独记录。
