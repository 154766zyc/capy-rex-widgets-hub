# 能力检查与迁移损失

每次任务按“源入口→目标接口→改写内容→支持状态→验证层级”填表。状态用：官方契约、公开测试实现、仅模拟验证、App 实测、未证实；目标没有文档依据时标为未证实，不能只改字段。

| 能力 | 实施检查 | 完成证据 |
|---|---|---|
| 列表/搜索 | Rex 顶层 search；Capy 依据实际模块入口与参数实现搜索交互，不能假设顶层 search 自动识别 | 每入口首/次页、关键词/空结果 |
| 分类/人物 | Capy category→分类参数透传；Rex person 是人物而非通用分类替身 | 点击分类后的参数；人物详情 |
| 详情与 TMDB | loadDetail 仅 link；Rex TMDB 内置详情与附 link 合并；Capy type:link | 新运行环境下详情与参数可恢复 |
| 季集/多线路 | Rex episodeItems 的 season/episode；Capy seasons/episodes 的 seasonNumber/episodeNumber；电影线路不可冒充分集 | 顺序、稳定 ID、默认线路、实际播放 |
| 资源/字幕 | Rex loadResource/loadSubtitle 固定 id/functionName；区分字幕 lang 与条目 externalSubtitles.language | 正确上下文、header、线路及字幕 |
| 弹幕 | Rex 三段入口和分段请求；没有目标等价接口时单列损失 | 搜索→分集→commentId 与时间 |
| 音乐/听书 | contentType、原生分区、tracks/episodeItems、childItems；不能由普通列表推断原生页面兼容 | 原生页与曲序、跨入口稳定 ID |
| 操作/i18n | Rex editActions/actions 需版本依据；展示翻译不修改内部值 | 回调参数、提示、刷新和持久化 |
| 扩展详情 | Capy tags/credits/recommendations/relatedVideos 数量与回退；Rex 按其实际字段重组 | 缺省/非空覆盖、人物与推荐点击 |
| HTTP/DOM | 状态处理不同；Rex Cheerio 与 Capy 文档 ID API 分离 | HTTP 失败和解析异常均可见，文档释放 |
| 参数/存储 | 平台合并优先级不同，隐藏参数及空串不可丢；存储不是图像文件系统 | 保存后新实例与详情独立调用 |
| 图片 | 明文头→字节→算法→交付→App；参见 local-cover | 每一环有来源与对应验证 |
| 发布 | 源码信封不影响封面算法；Docker/CF 分别构建与测试 | 本地/dry-run/线上范围明确 |

不要删除 V1 能力以换取“全绿”。不能映射的能力保留清单并解释替代交互及损失。发布前用 contracts.md、rex-extensions.md、deployment.md 和 testing-release.md 逐项复核。
