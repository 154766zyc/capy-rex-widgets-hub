# Capy/Rex 模块管理 V1.4 Docker 部署版

## 一、项目简介

Capy/Rex 模块管理 Docker 版适合部署在 NAS、家庭服务器或 VPS 上，用于集中管理模块链接、模块文件、Rex 合集链接和公开安装页面。

主要功能包括：

- 管理员后台和首次初始化页面
- 模块链接、模块文件、合集和公开分享地址
- Capy 模块公开 JavaScript 安装地址
- Rex 合集链接管理
- 模块投稿和开发者相关管理流程
- `/user` 公开页面、`/admin` 管理页面和 `/checker` 静态检查页面
- `/crypto` 加解密工具入口，当前采用明确标注的外部服务链接
- 本地 SQLite 数据保存和 Docker 数据目录挂载
- 定时任务、备份和 NAS 本地部署能力

静态检查器在浏览器中解析提交内容，不执行提交的 JavaScript。静态检查结果不能替代播放器运行时验证。

Rex/Capy 封面加解密和模块加解密不在本地 Docker 服务中实现。涉及外部加解密服务时，应先确认服务方的数据处理方式，不要提交私有源码、账号信息或密钥。

## 二、部署包结构

解压 `capy-rex-widgets-hub-V1.4-clean.zip` 后，进入 `capy-rex/` 目录部署。

重要文件如下：

- `compose.yaml`：Docker Compose 服务定义
- `.env.example`：环境变量示例
- `Dockerfile`：应用镜像构建文件
- `server.js`：NAS 服务入口
- `data/`：运行时 SQLite 数据和应用文件目录，首次部署时创建
- `single-file/`：Cloudflare 单文件构建内容，仅在需要 CF 部署时使用

发布包不包含真实 `.env`、数据库、备份、日志、`node_modules` 和私钥文件。

## 三、运行环境

建议准备：

- Docker Engine
- Docker Compose v2
- Linux NAS、家庭服务器或 VPS
- 至少 1 GB 可用内存
- 一个可写的数据目录
- 若要使用域名，准备反向代理和 HTTPS

默认示例端口为 `8080`，Compose 使用 host 网络模式。若改用其他端口，必须同步修改 `.env`、反向代理和健康检查地址。

## 四、首次部署

### 1. 解压并进入目录

```bash
unzip capy-rex-widgets-hub-V1.4-clean.zip
cd capy-rex
```

如果压缩包解压后目录名称不同，进入同时包含 `compose.yaml` 和 `Dockerfile` 的目录即可。

### 2. 创建环境文件

```bash
cp .env.example .env
mkdir -p data
```

按实际环境编辑 `.env`：

```dotenv
PORT=8080
SETUP_ORIGIN=http://127.0.0.1:8080
PUBLIC_URL=
ALLOWED_ORIGINS=
DATA_DIR=/app/data
NAS_MODE=true
NODE_ENV=production
TRUST_PROXY=false
SOURCE_ADDRESS_CHECK=true
```

使用域名时，将 `SETUP_ORIGIN` 和 `PUBLIC_URL` 改成自己的 HTTPS 地址，并按实际跨域需求设置 `ALLOWED_ORIGINS`。不要把真实 `.env` 提交到 GitHub。

### 3. 检查 Compose 配置

```bash
docker compose config --quiet
```

如果提示缺少 `.env`，先确认当前目录存在由 `.env.example` 复制出的 `.env`。

### 4. 构建并启动

```bash
docker compose up -d --build
docker compose ps
```

查看启动日志：

```bash
docker compose logs --tail=100 hub
```

### 5. 完成初始化

浏览器打开：

```text
http://服务器地址:8080
```

按照初始化页面创建管理员账户和密码，然后检查：

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

健康检查成功后，再从 `/admin` 登录并添加一个测试模块链接，创建一个测试合集，使用公开地址完成一次下载或订阅验证。

## 五、域名和反向代理

1. 先确认 `http://服务器地址:8080/healthz` 返回成功。
2. 在反向代理中将域名转发到 `127.0.0.1:8080`。
3. 配置 HTTPS 证书。
4. 修改 `.env` 中的 `SETUP_ORIGIN`、`PUBLIC_URL` 和必要的 `ALLOWED_ORIGINS`。
5. 重启服务并重新检查登录、公开链接和合集下载。

```bash
docker compose up -d
curl -fsS https://你的域名/healthz
```

不要把管理页面直接暴露在没有 HTTPS 和强密码的公网地址上。

## 六、更新和回退

更新前先停止写入并备份 `data/`。至少保留 SQLite 数据库、WAL 文件和应用上传文件。

```bash
docker compose stop
cp -a data data.backup-$(date +%Y%m%d-%H%M%S)
docker compose up -d --build
```

更新后检查：

```bash
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

回退时使用已确认可用的旧镜像或旧源码重新启动。不要执行 `docker compose down -v`，不要删除 `data/`，不要用空数据库覆盖现有数据。

## 七、常用命令

```bash
docker compose ps
docker compose logs --tail=100 hub
docker compose restart hub
docker compose stop
docker compose up -d --build
curl -fsS http://127.0.0.1:8080/healthz
```

## 八、发布边界

本包已通过 ZIP 完整性、配置解析和既有自动化回归检查。Docker 镜像实际构建、用户自己的 NAS 权限、反向代理、域名证书和生产数据恢复需要在目标环境单独验收。

不要将真实管理员密码、Cloudflare 凭据、私有模块源码、数据库或备份提交到公开仓库。
