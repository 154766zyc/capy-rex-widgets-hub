# 芜湖模块开发工作台 V2

可移植 Agent Skills 包，技能名 `wuhu-player-suite-v2`。关键词：芜湖、互转。用于 Rex↔Capy 迁移、新建与修复模块、授权源码/API 分析、封面与参数处理、CF/NAS Docker/VPS 服务、外链加解密及分层验收；不是独立播放器或通用自动解密器。

交流与更新：https://t.me/+-1t1T3kaztA5OTc9

## 安装与调用

将 ZIP 中完整 `wuhu-player-suite-v2` 目录放入宿主支持的 skills 目录，保留相对结构。Claude Code 通常使用 `~/.claude/skills`，Codex 通常使用 `~/.codex/skills`；其他宿主依其说明。重新加载后显式选择 `wuhu-player-suite-v2`，输入“芜湖”，或直接说“互转，把这份 Rex 明文改为 Capy，保留搜索和分页”。关键词发现取决于宿主，不能宣称在所有模型中自动生效。

V2 使用独立技能名，V1 文件保持原样。为避免重复触发，可在宿主选择启用 V2 或 V1；回退时停用 V2 并重新选择 V1。当前交付为可导出的待审提案，未安装、未替换原技能、未改动在线管理平台。

如通用 `wuhu-ai-pj` 同时安装且裸词“芜湖”歧义，宿主应先选模块/通用一次并沿用；显式选择优先。本包无法全局拦截命令。

## V2 增补

保留 V1 契约、Rex 扩展入口、Worker/CF/NAS/VPS、链接参数、测试发布流程和 18 项链接辅助自检。新增本地封面优先决策、能力证据等级、REXENC 静态信封检查、公开来源与实测边界。

截至 2026-11-27，Rex 官方公开 shim 和测试代理存在 `base64Data` 字节编码链，但当前指南及所检查工具未提供已证实的图片预处理钩子、`Widget.crypto` 或本地图片保存/发布 API。测试页海报只接收 HTTP(S)，不能拿 data URL 的浏览器常识推断 Rex App 支持。Capy 文档也未给出完整本地解密图片链。详细限制见 local-cover；不把文档未列出表述为所有版本绝对不支持。

REXENC 与封面 AES 是两件事。静态工具可识别 v2 信封，不会解密源码。缺少合法可用密钥与解包算法时，使用授权明文；外部解密站需先告知上传目的地和内容并获得授权。

## 文件与验证

- `SKILL.md`：流程与分支引用。
- `references/`：保留 V1 各契约与部署说明；新增 capabilities-v2、local-cover、rexenc-static、sources-v2。
- `scripts/capy-links.mjs`：保留 V1 链接/前缀辅助，只处理字符串。
- `scripts/rexenc-inspect.mjs`：Node 18+，有限大小的静态文本/JSON/Base64 识别，不执行输入、不联网、不输出密文。
- `examples/activation-demo.md`：规范场景，非真实模型会话记录。

```sh
node scripts/capy-links.mjs self-test
node scripts/rexenc-inspect.mjs self-test
node scripts/rexenc-inspect.mjs inspect ./authorized-module.js
```

不保证无损互转或所有播放器版本效果。交付验收应分别列静态、模拟、网络、浏览器与 App；本包没有完成用户 App 实机验收。
