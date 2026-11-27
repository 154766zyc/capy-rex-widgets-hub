# Capy/Rex 模块管理 V1.4 Cloudflare 部署版

## 一、项目简介

Capy/Rex 模块管理 Cloudflare 版运行在 Cloudflare Workers 和 SQLite Durable Object 上，适合没有常驻 NAS 服务、希望使用 Cloudflare 边缘网络托管管理页面和公开模块链接的场景。

主要功能包括：

- Cloudflare Worker 管理页面和管理员登录
- 模块链接、模块文件、合集和公开分享地址
- Capy 模块公开 JavaScript 地址管理
- Rex 合集链接管理
- 订阅同步、定时任务和 Durable Object SQLite 持久化
- 首页配置、图标和文件管理
- 备份导出与恢复
- `/crypto` 加解密外链入口

Cloudflare 版使用 SQLite Durable Object，不需要填写 D1 或 KV 编号。它不是 NAS 社区版的完整平移，开发者账户、投稿审核、公开 Capy 分类页和 NAS 在线检查器没有接入 Cloudflare 请求路由。包内的 NAS/validator 文件属于共享源码和测试内容，不代表这些功能已部署到 Worker。

当前没有本地 Rex 或 Capy 图片加解密能力。`/crypto` 中的外部服务可能接收提交内容，请勿上传私有源码、账号、密钥或其他敏感数据。

## 二、推荐部署方式

解压 `capy-rex-V1.4-CF-clean.zip` 后，优先进入 `capy-rex-cf/single-file/` 目录。

该目录只需要三个文件：

- `index.js`：完整 Worker 单文件构建
- `wrangler.toml`：Worker 名称、Durable Object 和迁移配置
- `package.json`：Wrangler 部署依赖

完整源码目录 `cf/`、`tools/` 和测试目录用于开发、检查和重新构建。首次部署不需要修改 `index.js`。

## 三、运行环境

准备以下内容：

- Cloudflare 账户
- Workers 权限
- Node.js 22 或更高版本
- npm
- 可访问 Cloudflare 和 npm 的网络
- 一个唯一的 Worker 名称

本包已使用 Wrangler 4.168.0 做过构建验证。为获得一致结果，可固定该版本。

## 四、首次部署

### 1. 解压并进入单文件目录

```bash
unzip capy-rex-V1.4-CF-clean.zip
cd capy-rex-cf/single-file
```

确认当前目录存在三个文件：

```bash
ls
```

Windows 可以使用：

```bat
dir
```

### 2. 设置 Worker 名称

打开 `wrangler.toml`，按需要修改：

```toml
name = "rex-widgets-hub"
```

名称必须在你的 Cloudflare 账户中可用。部署到已有 Worker 时，升级阶段必须保留原 Worker 名称。更换名称会创建新的 Worker 和新的 Durable Object 数据空间。

不需要填写 D1 ID、KV ID 或 Durable Object ID。配置中的 `HUB`、`RexHub` 和 `[[migrations]]` 需要保留。

### 3. 安装 Wrangler

```bash
npm install
```

也可以不安装到全局，直接使用固定版本：

```bash
npx wrangler@4.168.0 --version
```

### 4. 登录 Cloudflare

```bash
npx wrangler@4.168.0 login
```

浏览器打开授权页面后，登录准备部署的 Cloudflare 账户并允许授权。不要把 API Token、登录信息或密码复制给其他人或写入源码。

### 5. 先做 Dry Run

```bash
npx wrangler@4.168.0 deploy --dry-run
```

Dry Run 只进行打包和配置检查，不发布 Worker。确认没有绑定、迁移或构建错误后再继续。

### 6. 正式部署

```bash
npx wrangler@4.168.0 deploy
```

命令完成后记录 Cloudflare 输出的 `workers.dev` 地址。

### 7. 设置管理员密码

```bash
npx wrangler@4.168.0 secret put ADMIN_PASSWORD
```

终端提示输入时直接输入强密码。输入过程不显示字符是正常现象。不要将密码写入 `wrangler.toml`、`package.json` 或任何 Markdown 文件。

### 8. 首次验收

浏览器打开 Worker 地址，完成以下检查：

1. 打开 `/healthz`，确认返回成功状态。
2. 打开管理页面并使用管理员密码登录。
3. 添加一个测试模块链接。
4. 创建一个测试合集并复制公开链接。
5. 用浏览器或播放器客户端访问公开模块地址。
6. 检查 `/crypto` 页面是否能正常打开。
7. 观察定时任务和 Durable Object 日志。

查看实时日志：

```bash
npx wrangler@4.168.0 tail
```

日志中不要主动打印源码、凭据或备份内容。

## 五、绑定自定义域名

1. 先确认 `workers.dev` 地址可用。
2. 打开 Cloudflare 控制台的 Workers 与 Pages。
3. 进入当前 Worker 的 Domains & Routes。
4. 添加自己的域名或路由。
5. 使用 HTTPS 访问管理页面和公开模块链接。
6. 重新验证登录、合集、文件下载和订阅地址。

不需要修改 NAS 网关、Lucky 或 Docker 反向代理。

## 六、备份和迁移

更新或迁移前，从管理页面导出完整备份并保存到本地安全位置。

在新 Worker 中：

1. 部署完成并设置 `ADMIN_PASSWORD`。
2. 登录管理页面。
3. 进入备份恢复功能。
4. 先使用小备份做恢复测试。
5. 确认模块、合集、首页配置和公开链接正确后，再恢复完整数据。

NAS 的整库 SQLite 文件不能直接作为 Cloudflare Durable Object 数据导入。Cloudflare Worker 的数据和 NAS 社区版账号、审核数据相互独立。

## 七、升级和回退

升级时进入同一个 `single-file` 目录，保留 `wrangler.toml` 中的原 Worker 名称：

```bash
npx wrangler@4.168.0 deploy --dry-run
npx wrangler@4.168.0 deploy
```

升级后检查 `/healthz`、管理员登录、模块公开地址、合集地址和备份恢复。

不要通过修改 `name` 来覆盖旧站，也不要在没有备份的情况下删除旧 Worker 或 Durable Object 数据。

## 八、容量和限制

Cloudflare 免费额度、Workers CPU、内存、Durable Object 请求和数据库读写额度会随账户计划及官方规则变化。大文件、大备份、高频同步和全表操作可能触及额度或单次请求限制。

已知边界如下：

- 大备份恢复应拆分为小批次并先做实测。
- 免费层不能保证所有高负载工作流稳定运行。
- 公开模块托管和 Rex 合集链接适合小型或中低流量使用。
- 大量文件和大规模备份优先使用 Docker/NAS 版本。
- 本地测试和 fake Durable Object 测试不能替代真实 Cloudflare 账户验收。

## 九、常用命令

```bash
npx wrangler@4.168.0 login
npx wrangler@4.168.0 deploy --dry-run
npx wrangler@4.168.0 deploy
npx wrangler@4.168.0 secret put ADMIN_PASSWORD
npx wrangler@4.168.0 tail
```

## 十、发布边界

本包已通过 ZIP 完整性、Wrangler 配置解析、Worker bundle 检查和既有自动化验证。没有使用用户账户进行实际 Cloudflare 发布，因此真实账户中的域名、额度、Durable Object 持久化、定时任务和备份恢复仍需部署后验收。

公开发布包不包含 Cloudflare 凭据、管理员密码、真实数据库或运行时备份。
