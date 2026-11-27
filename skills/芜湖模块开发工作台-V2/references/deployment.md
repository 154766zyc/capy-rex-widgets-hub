# Worker、NAS Docker、VPS 部署

先选择用途：普通图片代理、已知格式图片解密或 API 适配。复用目标平台维护中的运行时和库；只在已知算法与依赖可验证时实现专用转换。以下是实施指南，不是已部署的服务或现成通用解密器。

1. 读取授权样本状态/头/字节，先识别 JPEG/PNG/GIF/WebP 明文，再查已知密文格式。既允许明文也允许已知格式；未知字节报错。用真实解码器验证，不能把 magic bytes 检查当图片解码。
2. 约定 /healthz 与 /cover?url=。若挂在 /images，明确转发层是否剥前缀，测试外部 /images/cover。保留原配置、稳定接口及回退版本；不要为了代理覆盖已有站点路由。
3. 安全与输出：HTTPS 源站严格 allowlist；拒绝 URL 用户信息、回环/私网/链路本地/保留 IP。能做 DNS 检查的服务器检查解析结果并对每个重定向重新校验；Worker 无可靠 DNS 检查时只允许受控源站并拒绝重定向。限时、限流、限大小、限并发，源站专用 Referer 只发给所需 host，不转发用户凭据。CORS 指定实际来源，公开无凭据图片才考虑 *；私密响应 no-store。缓存键包含源 URL 与变体，错误不缓存成图片；Content-Type 来自已验证输出，加 nosniff。
4. CF Worker：独立工程包含 worker 入口、package.json、锁文件和 wrangler 配置示例；检查当前 Wrangler/Node 要求与 Cloudflare 官方限制。先 `npx wrangler deploy --dry-run`，再在用户授权账户用平台登录；secret 用平台安全输入。已有明确部署授权则部署并验收，否则先交付可审阅工程和 dry-run 结果。不要默认引入 DO/D1/KV；确有持久化需求才声明 bindings、迁移和备份。Web Crypto 与 Node crypto/Buffer 签名不同，HTML/WASM 依赖必须完成打包验证。
5. NAS Docker：独立 Node HTTP 入口适配 Request/Response 与字节流；Worker export default.fetch 不能直接当 Node 服务。工程交付 Dockerfile、compose、锁文件、无秘密的配置模板、说明；采用受支持非 root 运行镜像、明确端口/volume/UID、资源上限及日志轮转。实际有这些文件时再给构建启动命令；新安装测试与重启持久化都要记录。
6. VPS：优先复用同一容器及版本；先检查现有 TLS/反代配置再合并路由。域名、端口、数据路径由部署环境输入，包内只放 example.com 等占位，不硬编码作者主机。
7. 验收真实图片接口：状态、Content-Type、字节与解码；覆盖明文、已知密文、错误密钥、上游失败、超时、超限、重定向和路径前缀。只有实际地址验证后才能写“线上通过”；首页/healthz 200 不证明封面功能。

CF 官方核对入口：https://developers.cloudflare.com/workers/ 与 https://developers.cloudflare.com/workers/platform/limits/ 。选择有状态服务时再查对应产品定价/限制，不能承诺无限免费。
