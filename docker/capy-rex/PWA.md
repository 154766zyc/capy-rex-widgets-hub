# PWA 图标适配（3.1.0-pwa.1）

基于原版 3.1.0，使用用户提供的 Rex Mulberry 原图生成，不重绘、不改业务数据。

- 普通 PWA：192 / 512 PNG。
- Android：独立不透明 maskable 图标，主体保留在中心 80% 直径安全圆内。
- iPhone / iPad：180 PNG，补齐透明圆角背景，由系统裁圆角。
- 浏览器：16 / 32 PNG 和多尺寸 favicon.ico。
- `/manifest.webmanifest` 声明 standalone；启动地址及 scope 均为 `/`，无订阅 token 或管理凭据。
- 仅图标 URL 长缓存，manifest 每次重新校验，首页仍 no-store；没有新增 Service Worker，不离线缓存后台或 API。
- 使用有效 HTTPS 域名安装；局域网 HTTP 页面不保证能作为 PWA 安装。
- 已添加到主屏幕的旧图标可能不会立即刷新，可移除旧快捷方式，再从 HTTPS 首页重新添加。移除快捷方式不删除 NAS 数据。

生成工具：`python3 tools/make-app-icons.py /absolute/path/to/original.png`（需 Pillow）。

图标规范参考：https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons
