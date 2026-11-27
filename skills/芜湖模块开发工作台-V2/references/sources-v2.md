# V2 来源与核对基线

核对日期：2026-11-27。下列是可重查的公开来源；页面更新后应重新验证，不视为永久契约。

| 来源 | 本次核对范围 | 支撑结论 |
|---|---|---|
| https://modules.rexnow.app/guide/ | 在线全文：运行时 API、图片字段、资源/字幕、音乐、操作、参数 | 现有契约；未列完整本地图片解密 API |
| https://modules.rexnow.app/skill/ | 在线说明 | 官方工具是模拟环境，App 需要单独验收 |
| https://modules.rexnow.app/skill/rex-modules.zip | 只读内存解包，检查 guide、shim、host、proxy | shim 中 base64Data；代理将字节编码 Base64；未发现 Widget.crypto 或图像保存接口 |
| https://modules.rexnow.app/app.mjs?v=3 | 只读公开脚本，posterURL 函数 | 测试页只允许 HTTP(S) 海报地址 |
| https://capyplayer.feifeiduck.cn/zh/dev/widget/widgetdev | 在线全文，内置 API 与图片字段 | DOM/http/storage/fetch polyfill；未列完整本地图片解密链 |
| https://rexnow.tv/encrypt/encrypt.js?v=c63d2969 | 只读公开 JS，validateEnvelope 和提交逻辑 | v2 结构校验；源码通过 POST 发服务端加密 |
| https://rex-decrypt.pages.dev/ | 在线页面和内联 JS，只读未提交 | 表单 POST 外部服务端解密，页面未给本地密钥 |

官方 Rex ZIP SHA-256：`a56edee4c9e649d9234adbf6da83adc52219e9e79929dfd6a74776a73b85cd82`。这是当次下载标识，不是发布者签名。

检索范围不等于整个客户端源码。没有读取原生客户端私有资料，没有 App 实机测试；不将未找到的接口宣称为永远不存在。通用 web_search 当时无可用提供者，已使用已知官方 URL、官方 ZIP 和公开页面引用继续核对。最初部分普通 HTTP 读取 403，后以公开浏览器 User-Agent 和 web_fetch 成功读取；没有绕过登录或上传输入。

V1 来源表保留在 sources.md，作为上一版融合记录。V2 重新核对 capy-skill、capy-widget-validation、rex-skill 及 guide、skill-creator 与 V1 全部 Markdown；本次没有重新宣称读取整套 Alice/PJ。V2 新增推广是用户指定交流链接，与原作者背书无关。
