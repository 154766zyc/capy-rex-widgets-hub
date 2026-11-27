# Capy / Rex 运行时契约

修改涉及的字段前核对官方来源；无法联网时标明采用随包基线与待核对项：
- Capy 开发：https://capyplayer.feifeiduck.cn/zh/dev/widget/widgetdev
- Capy 链接：https://capyplayer.feifeiduck.cn/zh/dev/widget/deep_links
- Rex 指南：https://modules.rexnow.app/guide/
- Rex 技能：https://modules.rexnow.app/skill/

| 语义 | Capy | Rex |
|---|---|---|
| 元数据 | 全局 var WidgetMetadata；title、非空 modules；显式稳定 id | 全局 var WidgetMetadata；id/title/version/requiredVersion/modules |
| 入口 | 推荐 media_list；category 另返分类数组；全局 async 函数 | 缺省 video；person/stream/subtitle/danmu 等独立契约 |
| 文本参数 | type:string、label、defaultValue | type:input、title、value 字符串 |
| 枚举 | enum/enumeration，enumOptions | enumeration；选项 value 字符串 |
| 页码 | page 从 1 开始，offset/count 按声明注入 | page 字符串；startPage 可为整数 0；计算前 Number |
| HTTP | {ok,status,data,headers}；检查 ok 和数据类型 | {data,statusCode,headers}；非 2xx 抛异常，catch 处理 |
| TMDB | Widget.tmdb.get 直接返回数据体 | 同样直接返回数据体，不加 .data |
| HTML | Widget.dom.parse/select/text/attr/remove | Widget.html.load 返回 Cheerio 查询器 |
| 自有详情条目 | type:link + link；字符串唯一 id、title | type:url + link；id 字符串或整数、type |
| 详情入口 | loadDetail(link 字符串) | loadDetail(link 字符串)，无 params 对象 |
| 直播放 | videoUrl 优先于 link | videoUrl，具体资源入口另行映射 |
| 剧集 | mediaType:tv + seasons/episodes；seasonNumber/episodeNumber | episodeItems；season/episode，保留顺序和 ID |
| 电影多线路 | playSources；不可伪装 episodeItems | 依据 loadResource 等实际能力重建，不机械照搬 |
| 海报/背景 | posterUrl/backdropUrl | TMDB posterPath/backdropPath 保留原始路径；自有 coverUrl 等 |
| 推荐/剧照 | recommendations、backdropUrl | relatedItems、backdropPaths |

Capy DOM：parse 得文档 ID，select(docId, selector) 得节点数组。节点含 text/html/outerHtml/attributes（兼容 attrs）。需要子树查询时重新 parse outerHtml，用 finally 释放所有文档；不能调用 Rex 的链式 find/text。仅为空列表时返回 []；解析 API 不存在、HTTP/结构异常应显式报错。

Capy 元数据模块推荐 timeoutSeconds、retryCount、cacheDuration。globalParams 默认→入口同名配置→运行参数，后者覆盖前者。列表返回数组，详情可返回对象；详情顶层数组代表同一影片多线路，不能拿来表示分集。seasons/episodes 显式 tv。扩展详情 tags/credits/recommendations/relatedVideos 只填原有区块；人物要 name，推荐要 title 及 link/videoUrl/playSources；空数组可触发客户端默认回退。

Rex 参数优先级不同：调用参数起步，保存的全局参数覆盖同名值（包含空串），再按全局和入口声明补缺省值。隐藏参数不补默认但显式保存值可传入。language/timezone/userId/configId 需声明相应类型才注入。不要以 Capy 的合并顺序模拟 Rex。

Rex 模块没有 fetch/require/浏览器 DOM/URLSearchParams；Capy 当前官方文档列有 fetch polyfill，迁移时优先使用 Widget.http 以统一请求层。不要宣称两端都没有 fetch。Rex request 才支持 timeout/decodable 选项，快捷方法会忽略；3xx 在禁用重定向时也会抛错。模块不依赖上次调用的全局变量；storage/sharedCache 按平台签名逐项核对。

迁移先列能力矩阵：Capy category/扩展详情、Rex 原生音乐页/操作菜单/弹幕/资源/字幕并非一一对应。目标无契约时保留明确限制或提出替代交互，不承诺无损自动互转。
