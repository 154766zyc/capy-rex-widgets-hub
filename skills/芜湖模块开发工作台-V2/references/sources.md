# 来源与功能覆盖

维护本包时按下表核对受影响分支；来源以技能名和其内部相对路径标识，不依赖原机器目录。对外只说明确实读取与融合的部分，不声称吸收完整安全套件。

| 来源 | 读取范围 | 融合到本包 |
|---|---|---|
| alice-skill-suite | SKILL.md；aliceskill/SKILL.md；alice-reverse/SKILL.md；alice-assist/SKILL.md | 按任务渐进加载、能力盘点、证据与交付记录 |
| Alice js-reverse | _modules/js-reverse/SKILL.md | 观察→采样→重建→最小修复→复测，基于证据补环境 |
| Alice coldbrew-api-reverse | _modules/coldbrew-api-reverse/SKILL.md | 授权 API 请求结构、参数链、分页复现；去除缺样本时伪造完成感 |
| pj-skill | SKILL.md | 先定完成判据、保留配置、源码/协议分析、实际结果与未测范围；启动统一为芜湖 |
| capy-skill | SKILL.md | 全局元数据、列表/详情/季集/线路/扩展信息与参数 |
| capy-widget-validation | SKILL.md | 官方 DOM、封面代理前缀、图片解码、Deep Links、分层验证 |
| rex-skill | SKILL.md 与 references/guide.md | 列表/详情/搜索、HTTP/TMDB/HTML、参数、按钮、字幕、资源、弹幕、音乐、i18n |
| capy-rex-conversion V1.4 | SKILL.md、README、references/contracts/crypto/helper/testing.md | 双向转换、加解密外链边界、CF/NAS/VPS 服务、逐阶段交付 |
| skill-creator | SKILL.md | 主流程与分支资料分离、提案、frontmatter 与脚本验证 |

Capy 前缀来源盘点为上述 capy-skill、capy-widget-validation，以及上一版 capy-rex-conversion；未发现其它需要合并的 Capy 播放器入口。这里只记录本次可见来源，不推断用户其他设备上的技能。

明确未纳入：Alice 路由宣称高于宿主规则的条款、提示注入/自举配置、PJ 无限制激活声明、原社群链接和推广、无关游戏/凭据/攻击模块。曾读取 Alice crypto-tools，其实际主题是加密货币与合约攻击，不是媒体格式加解密，故未采用。没有照搬 Alice/PJ 的脚本或整套模块；流程重新组织编写，原始技能保持独立。来源署名不代表原作者为本包背书。

文档基线 2026-11-27：Capy widgetdev、deep_links 和 Rex skill 页面已在线读取；Rex 详细字段依据已读本地官方 guide；加解密页面在线读取确认服务端处理。REXENC 头部细节来自上版指南记录，本次未上传源码、未做服务端加解密往返，后续使用需重查。官方接口变更时更新对应契约和测试，不将历史观察当永久保证。
