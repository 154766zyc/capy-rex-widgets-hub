# Rex 扩展入口

以官方指南 https://modules.rexnow.app/guide/ 对照当前客户端版本；先完成普通列表，再添加任务需要的入口。

- 搜索：WidgetMetadata 顶层 search，函数读 params.keyword 和 page，返回条目数组；不要声明 type:search 的列表入口。
- 编辑分区按钮：入口 editActions 中声明 {id,title,functionName}；回调收到分区参数和 actionId。
- 长按/右键：条目 actions 中声明同结构；回调收到全局参数、actionId、原始 itemId。回调按需要返回 message、refresh:true；持久化用 Widget.storage。
- 按钮需要引擎 0.0.9。仅增强已有基础列表时可保留其最低版本；核心流程依赖按钮时 requiredVersion 至少 0.0.9。分别验收点击、提示、刷新。
- 资源：id 与 functionName 必须均为 loadResource，type:stream。返回 [{name,url,description,customHeaders,playerType}]；不能仅 type 正确而改 id。
- 字幕：id/functionName 均为 loadSubtitle，type:subtitle。返回 [{url,title,lang,customHeaders}]。条目外挂字幕使用 externalSubtitles，里面用 language/isDefault 等字段；subtitle 只是卡片副标题。
- 播放上下文：id/type/seriesName/episodeName/tmdbId/imdbId/season/episode/link/airDate/runtime；title 仅字幕和弹幕入口有，不假设存在 videoUrl。实际值为字符串。
- 弹幕：固定入口 id searchDanmu→getDetail→getComments，type:danmu；分别返回 {animes:[{animeId,animeTitle}]}、[{episodeId,episodeTitle,episodeNumber}]、{comments:[{p,m}]}。commentId 等于选中的 episodeId，不用数组下标。分段入口按指南核对 getCommentsWithSegmentTime 与 segmentTime。
- TMDB：type:tmdb、数字 id、movie/tv、原始图片路径；打开内置详情。附 link 才调用 loadDetail 合并数据。详情找不到时抛可读错误或 []，不返回 null。
- 音乐/听书：contentType music/audiobook 等依赖引擎 0.0.7；原生页面不等于普通视频列表。musicGenres、musicArtists、musicRadios 各按 genreId/peopleId/radioId 与 section 提供分区；分页独立。专辑或歌单 tracks 保持顺序，旧格式 episodeItems 保持 ID、季集与顺序；albumList 用 childItems。未知分区/末页返回 []。听书页面的新增字段另查当前指南，不推断音乐 API 全适用。
- i18n：词典仅翻译显示文字；不翻译 id/functionName/参数名/value/URL。增加词典无需提高最低版本，调用 Widget.i18n 需要 0.0.6；修改内容递增 version。

将这些能力转到 Capy 前逐项检查目标是否存在官方等价接口；无对应接口时报告不支持或实现经过验收的替代交互。测试页不能证明原生音乐页面、播放和缓存行为。
