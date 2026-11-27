# 链接、代理前缀与自定义参数

Capy Widget 安装 data 编码公开脚本 URL，资源安装 data 编码服务器配置 JSON；UTF-8 转 Base64URL，+→-、/→_、去掉末尾 =。解码必须恢复原输入，包括 Unicode、查询和片段。资源 serverType/host 为字符串、port 数字、https 布尔，可选 path/username；分享链接不包含真实密码。空入口分别为 com.feifeiduck.capyplayer://add-widget 与 add-resource。

使用随包辅助工具（宿主 Node 18+，不是播放器内 API）：
```sh
node scripts/capy-links.mjs self-test
node scripts/capy-links.mjs widget 'https://example.com/widget.js?version=1#main'
node scripts/capy-links.mjs proxy 'https://example.com/images/' 'https://cdn.example.com/poster.jpg'
```
widget 工具仅检查 URL 形状并编码，不访问网络，不能证明 URL 公开可达或 App 已安装。上线前检查实际 URL 返回脚本而非登录页；本地 NAS 路径不能当发布 URL。资源 JSON 按上面的字段独立编码并回环验证，当前辅助工具不生成资源配置。

代理基础 URL 保留完整路径，仅去尾斜杠，再拼 `/cover?url=` 与 encodeURIComponent(原图)。例如基础 /images 得 /images/cover，不用 new URL('/cover', base) 截掉前缀。拒绝带查询/片段的基础配置，不悄悄回退原加密图；源图查询/片段在编码中完整保留。辅助工具不做 DNS、来源 allowlist 或 SSRF 检查，不能替代服务端安全验证。

自定义参数：先列出名称、类型、默认值、枚举及覆盖来源，按两个客户端各自合并规则验证。未知业务值当不透明字符串保存，不能把枚举内部值擅自翻译或把所有 custom 参数都当 URL。loadDetail 仅收到 link；要携带非敏感配置，可定义有版本的专用片段/不透明载荷，编码前保留原链接，解析时限定字段、长度、类型和允许源站。发送 HTTP 前分离本地载荷，保持原 URL 查询含义；含原片段的 URL 应整体放进载荷，避免拼接覆盖。Base64URL 不提供机密性，不携带密码、Cookie、token。不得依赖上次列表调用的全局变量。
