---
name: "wuhu-player-suite-v2"
description: "芜湖、互转、封面修复：Capy/Rex 模块开发、播放器本地封面能力核对、授权分析与分层验收。"
---

# 芜湖模块开发工作台 V2

1. 识别任务并启动工作台。用户仅输入去掉首尾空白的“芜湖”，或要求显示芜湖菜单时，输出 [启动菜单](references/activation.md)。若同时安装通用 wuhu-ai-pj 且裸词含义不明，先让用户选择模块工作台或通用工作台一次，并沿用会话选择；显式选择技能优先。消息已有任务时直接选择分支，沿用方向、文件、参数与交付要求。完成标准：菜单已显示，或任务已有目标平台、输入与完成判据。
2. 盘点输入与能力。读取 [契约映射](references/contracts.md) 与 [能力检查](references/capabilities-v2.md)，静态查看脚本、依赖与元数据；未知或加密输入先按 [加解密与格式](references/crypto.md) 和 [本地信封检查](references/rexenc-static.md) 识别。涉及网页/API 时读取 [分析与修复](references/analysis-repair.md)。完成标准：逐入口列出保留、改写、目标不支持、证据不足与验收方式。
3. 实施选定分支。Rex→Capy 或 Capy→Rex 按契约逐函数迁移；新建先完成最小列表，修复先重现再改最小差异。按 [Rex 扩展](references/rex-extensions.md) 处理搜索、按钮、字幕、资源、弹幕、音乐及 i18n。保持稳定 id 并递增版本，检查 functionName 对应实现。完成标准：源码与能力清单一致，缺失能力有明确说明。
4. 优先核对本地封面。涉及封面密文时先读 [本地封面决策](references/local-cover.md)，区分模块信封与图片格式；依次验证明文直链/请求头、字节获取、已知算法、图片交付接口及 App 显示。目标未指定时先查 Rex，再查 Capy。证据不足时使用 [服务部署](references/deployment.md) 的 Worker/CF/NAS/VPS 分支。安装链接与参数按 [链接与参数](references/links-params.md)，运行 `node scripts/capy-links.mjs self-test`。完成标准：选定路线有接口证据；没有把 Node/网页模拟称作播放器实测。
5. 验证并交付。依照 [验收与发布](references/testing-release.md) 分开记录静态、隔离模拟、真实 HTTP、浏览器和 App 结果；结合 [V1 来源覆盖](references/sources.md) 和 [V2 核对来源](references/sources-v2.md) 检查变化。先验收明文再处理可选外链加密。使用 [中文说明](references/README.md) 和 [启动演示](examples/activation-demo.md) 指导调用；运行 `node scripts/rexenc-inspect.mjs self-test` 检查静态识别工具。完成标准：完整源码、依赖、变更、测试范围、未测项与回退方式一起交付；包中没有凭据、上传样本、私人域名或宿主路径。
