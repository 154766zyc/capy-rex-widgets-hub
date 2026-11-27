# Capy/Rex Widgets Hub

一个围绕 Capy 与 Rex 模块管理、部署和开发协作整理的项目仓库，包含 Docker/NAS 部署版、Cloudflare Workers 部署版，以及两套可独立安装的 AI 技能包。

> 公开发布前请先确认仓库可见性、项目授权和上游素材使用范围。本仓库没有附加未经确认的开源许可证。

## 项目内容

| 目录 | 内容 | 快速入口 |
|---|---|---|
| [`docker/capy-rex/`](docker/capy-rex/) | Docker/NAS 服务端源码、Compose、环境变量示例、静态检查器和测试 | [部署说明](docs/Docker部署说明.md) |
| [`cloudflare/capy-rex-cf/`](cloudflare/capy-rex-cf/) | Cloudflare Worker 源码、Durable Object SQLite、配置和测试 | [部署说明](docs/Cloudflare部署说明.md) |
| [`skills/芜湖模块开发工作台-V2/`](skills/芜湖模块开发工作台-V2/) | Capy/Rex 模块开发、互转、分析和验收的 Agent Skill | [安装说明](docs/模块开发工作台V2.md) |
| [`skills/芜湖ai通用PJ-V1/`](skills/芜湖ai通用PJ-V1/) | 通用编程、调试、静态分析、研究和技能工程 Agent Skill | [安装说明](docs/通用PJ技能.md) |
| [`docs/`](docs/) | 中文总介绍、部署指南、技能说明及发布审计 | [项目总介绍](docs/项目总介绍.md) |

## 选择部署方式

- 想把服务和数据放在自己的 NAS、家庭服务器或 VPS 上，使用 `docker/capy-rex/`。
- 想将公开管理入口部署到 Cloudflare Workers，使用 `cloudflare/capy-rex-cf/`。
- 两种部署版本的功能范围并不完全相同，请阅读各自说明后再选择。

## Docker/NAS 快速开始

进入 `docker/capy-rex/`：

```bash
cp .env.example .env
mkdir -p data
docker compose config --quiet
docker compose up -d --build
```

首次启动后打开 `http://服务器地址:8080` 完成初始化，再检查 `http://服务器地址:8080/healthz`。使用域名时先按部署说明设置 `SETUP_ORIGIN`、`PUBLIC_URL`、HTTPS 和反向代理。

## Cloudflare 快速开始

进入 `cloudflare/capy-rex-cf/single-file/`，先按需修改 `wrangler.toml` 中的 Worker 名称，再运行：

```bash
npm install
npx wrangler@4.168.0 login
npx wrangler@4.168.0 deploy --dry-run
npx wrangler@4.168.0 deploy
npx wrangler@4.168.0 secret put ADMIN_PASSWORD
```

Wrangler 会在浏览器中引导账户授权。管理员密码通过交互提示设置，不要写入仓库文件。实际发布前请阅读 Cloudflare 部署说明，尤其是 Worker 名称、Durable Object 数据和旧站迁移部分。

## 源码与技能包

每个部署目录都保留可读源码、配置和相关测试。Cloudflare 单文件部署入口位于 `cloudflare/capy-rex-cf/single-file/`。完整 Worker 源码及打包工具位于 `cloudflare/capy-rex-cf/`。

技能包可以直接从对应目录安装，也可以使用仓库发布页面提供的 ZIP。安装方式依赖宿主产品对 Agent Skills 的支持情况，详见 `docs/` 下的技能说明。

## 功能边界与验证状态

- 静态检查器解析模块内容，不执行提交的 JavaScript。静态检查不能替代播放器 App 的运行测试。
- 本地 Rex/Capy 封面解密能力没有得到充分证实。相关工具入口使用外部服务时，服务方可能收到提交内容。
- REXENC v2 可进行静态结构识别。本项目没有执行未知加密模块，也没有暴力尝试隐藏密钥。
- 清洁包的自动化回归、配置解析、Worker bundle 和 ZIP 完整性检查结果见 [审计报告](docs/审计报告.md)。
- 本次整理未执行 Docker 镜像实际构建、Cloudflare 账户实际部署或播放器 App 实机验收。

## GitHub Desktop 发布

1. 将本目录作为本地仓库添加到 GitHub Desktop。若 Desktop 未识别为仓库，使用 **File → Add Local Repository** 或 **File → New Repository**，仓库路径选择本目录并保留现有文件。
2. 检查变更列表和 `.gitignore`，确认没有 `.env`、运行数据库、备份、日志、私钥或个人数据。
3. 在 GitHub Desktop 输入首个提交摘要，例如 `Initial clean source release`，点击 **Commit to main**。
4. 点击 **Publish repository**，设置仓库名称、简介和 Public/Private 可见性，再确认发布。
5. 发布后从 GitHub 页面克隆一次仓库，验证 README 链接和部署目录可用。

仓库当前没有远程地址，也没有自动发布动作。选择 Public 会将提交内容公开给所有人，请在点击发布前自行核对仓库可见性及项目授权。

## 目录索引

```text
capy-rex-widgets-hub-github/
├── README.md
├── .gitignore
├── docker/
│   └── capy-rex/                 Docker/NAS 源码与 Compose
├── cloudflare/
│   └── capy-rex-cf/              Worker 源码、配置、测试与单文件部署包
├── skills/
│   ├── 芜湖模块开发工作台-V2/    Capy/Rex 专项 Agent Skill
│   └── 芜湖ai通用PJ-V1/          通用 AI 工作台 Agent Skill
└── docs/                         中文说明、总介绍和审计报告
```
