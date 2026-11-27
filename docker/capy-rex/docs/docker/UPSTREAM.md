# 上游输入记录

## 3.5 选择性移植输入（2026-11-20）

底座是本地冻结 `Rex-Widgets-Hub-docker-v3.4`（3.4.0-local.1），未修改原目录。参考用户提供的 `Rex-Widgets-Hub Docker 版 3.5.0.zip`，其 SHA-256 为 `54e69a4f93d5736708cdddbb903ab65e6404447863218af1555e8a6ca6149222`。

借鉴模块标签、订阅操作、自动分类和重复导入选择的设计，重新适配原单 SQLite 架构。没有导入第三方 Docker 存储运行层、公开资源内存缓存、全量恢复架构或自动去重删除。CF 源码与线上服务均未修改。具体功能、安全边界和验证见 CHANGELOG-v3.5.md、VALIDATION.md。

## 3.3 同步输入（2026-11-18）

来源为用户指定的本地 `/Users/wangruoning1/Documents/hongguo-cloudflare-worker/deployment/widget-hub/CF-3.3.md` 及同目录源码。未修改该源目录，未读取私有升级快照或正式数据库。以下仅标识本地输入，不代表联网核验或部署。

```text
7c8ee059cfe20e8319a26281a42c7d1739bbc3fb06a1551a6a97476bde8fdcf0  CF-3.3.md
7c90a68e78af24d85739761157efc08a80ef219a24d42141b1c4f115a67a731f  worker.js
43d50065b0ff22f1f4f314069ba967052099020350973e549df39509b69258c0  subscriptions.js
3a86445f47d60222b80c50c3b4fedec127b35e5e9d5c0728c58a5ae0859389a9  sharing.js
f87ed7bd0ad60f7699a0889bce08480064c74fc7dc597e5eb397d0779dcd402e  sharing-ui.js
b20b92dd4e4436833800b88d383e103bc04973ae12cd2fb87900d5874a696cbb  backup.js
b02ed291e27583c527dcb1165851014989e751b59cb4d817ec5c70f8ff5829bb  filenames.js
caec162f44e3748dec774ba7d3d77766f0f55e5277ad469b1cdf4a9fddbc3c0f  management.js
3d35bb89370529ceabe73c2e0e33cf35a34657e2a48c03c8afba6e2fbc19ec55  management-ui.js
bed3f9ee5ca6880c9000151e406e62ff32d546fb0df78b90a04346cc7f13b735  uploads.js
59942f326541c49f7f96521c4726a935eb64ef125aa0e8e288f8d8ae40e533bb  metadata.js
```

同步范围与 Docker 保留差异见 [CF-3.3-DOCKER.md](CF-3.3-DOCKER.md)。以下为此前版本的历史输入记录，不作为 3.3 输入摘要。

## 历史输入

本轮依据用户指定的本地 hongguo-cloudflare-worker/deployment/widget-hub 最新文件适配，未修改该源目录；没有从生产站点下载或部署。SHA-256 如下，用于识别本次输入快照（不是宣称互联网上的最新版本）。

```text
99b9086402b6e87910204e094f7f00b88535a23f08369a4787b2812eca7630d0  worker.js
8e8c1c01fc1901e93923645ff9e42b41b4c5029f63ab5dd64904a60b29379de5  subscriptions.js
46c8b2fd3d02f5a22730ec0e40d8dadaee1f7df85a56a0e3ea01dc82bdcdf36f  uploads.js
59942f326541c49f7f96521c4726a935eb64ef125aa0e8e288f8d8ae40e533bb  metadata.js
7b091b85c3fba12704de06230caf960525b8143663a3c887be33b70f8961c92b  title-maintenance.js
d431a072fc8a1ef1db5495763d2da61fdc85fb44d03a8fb36af72416b0da6bcd  management.js
d09dcd30476ccecc9d2c7ae7ae0bded1e823af70db4203cbd35c389d177eed0e  management-ui.js
e98fa13bdecd8de7818db190b34d5f89e3cf778b514c6d3c7670078ea2e28e49  MANAGEMENT.md
14ccd19241a24edb9952048d130700bee57cd3d936f47da768779aafe77d93d4  SUBSCRIPTIONS.md
dd9e740dcf7dd567962276ef12600c110a30ab3ca07cd64d93445f29b6495eae  UPLOADS.md
c3a7a8341fd70c2714b90fbc303a5a91ef02c108f88aeedd524fcba4649d1bb6  TITLES.md
```

Docker 适配主要增量：Node HTTP 入口、本地 SQLite D1/KV 适配、短事务门控、旧 Docker 数据/订阅迁移、历史地址别名、二进制安全备份与离线回滚、进程内调度、公网抓取校验，以及小屏布局修复。
