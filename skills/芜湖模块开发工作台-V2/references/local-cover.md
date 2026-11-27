# 本地封面优先：按证据选择

## 查验顺序

1. 分开识别模块源码信封与图片密文。模块叫“无需worker”只能作为线索；没有明文或 App 行为证据不能推出实现。
2. 先确认原图能否直接作为正常 JPEG/PNG/GIF/WebP 获取，或仅缺合法请求头。Rex 指南说明条目 `customHeaders` 用于播放和加载图片；此类问题先修请求，不加解密器。Capy 按目标字段实际文档核对，不能由相关视频 customHeaders 推断全部封面透传。
3. 对确有图片密文的任务，记录来源、模式、key 编码、IV、padding/tag、封装与输出格式。合法可用算法/密钥缺失则记为待提供，不能用猜测的 AES-CBC 或来源文件名替代。
4. 为播放器本地路线逐项确认：原始字节可无损获取→有正确解密实现→有原生图像钩子或被客户端接受的交付方式→列表/详情均能显示→缓存与重载可用。先核对 Rex，后核对 Capy，明确目标平台时只实现其实际支持路线。
5. 若以上链路有文档与实机证据，用小型自制非敏感图片验证正确密钥、错误密钥、坏密文、缓存失效及并发；明确合成图片验证不等于源站成功。若仅 Node/mock 成功，标为纯算法或模拟证据，不能写“播放器无需 Worker 已通过”。
6. 缺失图片消费接口时沿用 deployment.md 的辅助服务，让服务返回正常图片 HTTP(S) URL。记录额外部署需求及本地路线待补的具体证据；不要虚构 `Widget.image.save`、`Widget.crypto.decrypt` 或元数据钩子。

## 2026-11-27 当前证据基线

| 能力 | Rex | Capy |
|---|---|---|
| 普通封面 | 指南列 posterPath/coverUrl/backdropPath；customHeaders 用于图片 | 文档列 posterUrl/backdropUrl 及别名 |
| 字节获取 | 官方下载 ZIP 的 shim 传 `base64Data`，proxy/core 将响应字节转 Base64；属公开测试实现证据 | 文档给 data:any，未承诺任意二进制无损语义 |
| decodable:false | request 支持此选项；测试代理中它只关闭 JSON 解析，仍按文本解码，不能当 ArrayBuffer 开关 | 无对应已核对二进制选项 |
| Widget.crypto | 当前指南、公开 shim 未发现；不能推断私有客户端实现 | 当前 widgetdev 未列出 |
| 图片预处理钩子 | 未发现已文档化 imageProcessors/imageProcessor 注册和返回契约 | 当前 widgetdev 未列出 |
| Base64/data URL 显示 | 测试页 app.mjs 的 posterURL 仅允许 HTTP(S)，原生 App 未验证 | 未有文档或实机证据 |
| 缓存/保存图片 | storage/sharedCache 是值存储；未证实输出本地文件 URL 的 API | storage 有同步/异步值存储；不等于图像文件接口 |
| Web Crypto/Buffer | 不能从 Node 或网页环境推断 Rex 沙箱存在 | fetch polyfill 不证明 crypto.subtle/Blob/arrayBuffer 存在 |

可依据公开源码核对的候选请求写法为 `Widget.http.request({url: authorizedURL, method: 'GET', base64Data: true})`，返回对象仍遵循 HTTP 的 data/statusCode。此处是公开 shim/代理层证据，不是经 App 实测的兼容保证，也不完成解密或显示。只在目标版本核实后加入实际模块。

尚无完整已证实的播放器本地图片解密链，故本版本不提供带假宿主 API 的 AES 模块，也不把纯 Node PNG 加解密实验包装成 Rex/Capy 成果。需要新的官方接口文档、可审阅明文实现或用户目标版本实机证据才能提升结论。

## 迁移检查

记录输入 URL 与必要头的作用域；不要把来源凭据塞入分享链接。列表封面、详情封面、背景、分集缩略图分别验收。代理地址保留路径前缀；解密失败显式报错或显示可识别占位，不把密文 URL 静默当成功结果。缓存键应区分来源/格式/算法版本，私密响应不得公共缓存。Rex 的二进制候选实现不能直接复制到 Capy。
