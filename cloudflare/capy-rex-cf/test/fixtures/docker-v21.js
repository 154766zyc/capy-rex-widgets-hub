// FWH Admin Lite — 作者新版 UI/API 的 Docker/SQLite 兼容升级版。
// server.js 将 DB/KV 接口接入同一个 rex.sqlite，并在启动/请求级别提供事务。
// Docker 仍使用 ADMIN_SECRET；数据库中已修改的密码优先。
// 模块直链：https://<host>/api/modules/<id>.js
// 合集订阅：https://<host>/api/collections/<slug>.rex（兼容旧.fwd)
import { moduleStatement, syncAutoAll, setCollectionSlug, exportBackup, restoreBackup } from './v21-backup.js';
import { SOURCE_SCHEMA, listSources, registerSource } from './v21-sources.js';
import { fetchRemote, assertModuleFile } from '../../remote.js';
import { SOURCE_UI } from './v21-sources-ui.js';

var HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover,user-scalable=no">
<title>Widget Hub</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<style>
/* ===== 清爽深色 · 对标 Forward 设置页 ===== */
:root{
  --text:#1c1c1e; --text2:#6e6e74; --text3:#aeaeb4;
  --accent:#6d5ef2;
  --bg:#f2f2f6;
  --card:#ffffff;
  --card-brd:rgba(0,0,0,.07);
  --field:#f4f4f6;
  --field-brd:rgba(0,0,0,.1);
  --shadow:0 2px 12px rgba(0,0,0,.06);
  --div:rgba(0,0,0,.06);
  --ico-normal:#e8e8ee; --ico-normal-fg:#55555e;
  --ico-encrypted:#f5e6c8; --ico-encrypted-fg:#8a6d2f;
  --radius:20px;
}
.dark{
  --text:#f4f4f6; --text2:#a0a0a8; --text3:#6e6e76;
  --accent:#8b7cf6;
  --bg:#131318;
  --card:rgba(255,255,255,.045);
  --card-brd:rgba(255,255,255,.09);
  --field:rgba(255,255,255,.06);
  --field-brd:rgba(255,255,255,.12);
  --shadow:0 2px 12px rgba(0,0,0,.25);
  --div:rgba(255,255,255,.07);
  --ico-normal:rgba(255,255,255,.1); --ico-normal-fg:#d8d8de;
  --ico-encrypted:rgba(217,164,65,.16); --ico-encrypted-fg:#d9a441;
}
@media(prefers-color-scheme:dark){
  :root:not(.dark):not(.light){
    --text:#f4f4f6; --text2:#a0a0a8; --text3:#6e6e76;
    --accent:#8b7cf6;
    --bg:#131318;
    --card:rgba(255,255,255,.045);
    --card-brd:rgba(255,255,255,.09);
    --field:rgba(255,255,255,.06);
    --field-brd:rgba(255,255,255,.12);
    --shadow:0 2px 12px rgba(0,0,0,.25);
    --div:rgba(255,255,255,.07);
    --ico-normal:rgba(255,255,255,.1); --ico-normal-fg:#d8d8de;
    --ico-encrypted:rgba(217,164,65,.16); --ico-encrypted-fg:#d9a441;
  }
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;
  color:var(--text); min-height:100vh; -webkit-font-smoothing:antialiased;
  background:var(--bg);
}
/* ---- 顶栏 ---- */
.header{position:sticky;top:0;z-index:20;padding:18px 20px 6px;background:var(--bg);}
.header-in{max-width:640px;margin:0 auto;display:flex;align-items:center;gap:12px}
.avatar{width:42px;height:42px;border-radius:13px;background:var(--field);border:1px solid var(--card-brd);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;color:var(--text2);font-weight:700}
.header h1{font-size:21px;font-weight:700;letter-spacing:-.3px}
.header p{font-size:12.5px;color:var(--text2);margin-top:1px;font-weight:500}
.header .spacer{flex:1}
.avatar img{filter:invert(1)}
.dark .avatar img{filter:none}
@media(prefers-color-scheme:dark){:root:not(.dark):not(.light) .avatar img{filter:none}}
.theme-btn{font-size:16px;width:38px;height:38px;border-radius:12px}
/* ---- 主体 ---- */
.main{max-width:640px;margin:0 auto;padding:6px 16px 140px;position:relative;z-index:1}
.page{display:none}
.page.active{display:block;animation:pop .25s ease}
.page-head{display:flex;justify-content:space-between;align-items:center;margin:14px 4px}
.ftab{flex-shrink:0;font-size:13px;font-weight:600;padding:8px 14px;border-radius:12px;background:var(--card);border:1px solid var(--card-brd);color:var(--text2);cursor:pointer;white-space:nowrap}
.ftab.active{background:var(--accent);border-color:transparent;color:#fff}
.ftab .cnt{font-size:11px;opacity:.7;margin-left:4px}
.folder-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.folder-tabs::-webkit-scrollbar{display:none}
.page-head .count{font-size:12.5px;color:var(--text2);font-weight:600}
.actions{display:flex;gap:8px;align-items:center;flex:1}
/* ---- 按钮 ---- */
.btn{border:1px solid var(--card-brd);cursor:pointer;font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:14px;font-family:inherit;transition:all .15s;display:inline-flex;align-items:center;gap:7px;background:var(--card);color:var(--text)}
.btn:active{transform:scale(.97)}
.btn svg{width:15px;height:15px;flex-shrink:0;opacity:.8}
.btn-primary{background:var(--accent);border-color:transparent;color:#fff}
.btn-ghost{background:transparent;border-color:transparent;color:var(--accent)}
.btn-sm{font-size:12.5px;padding:8px 13px;border-radius:12px}
.btn-xs{width:32px;height:32px;border-radius:10px;border:none;background:transparent;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--text2)}
.btn-xs.danger{color:#e11d48}
.btn-xs svg{width:15px;height:15px}
/* ---- 列表 ---- */
.row{display:flex;align-items:center;gap:13px;padding:14px 16px;background:var(--card);border:1px solid var(--card-brd);border-radius:18px;box-shadow:var(--shadow);transition:transform .15s;margin-bottom:10px}
.row:active{transform:scale(.985)}
.card>.row{background:transparent;border:none;box-shadow:none;border-radius:0;margin-bottom:0;padding:13px 2px;border-bottom:1px solid var(--div)}
.card>.row:last-child{border-bottom:none}
.card>.row:active{transform:none}
.ico-sq{width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ico-sq svg{width:20px;height:20px}
.info{flex:1;min-width:0}
.name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.2px}
.sub{font-size:12px;color:var(--text2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.badge{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:7px;flex-shrink:0}
.badge-blue{background:rgba(109,94,242,.12);color:var(--accent)}
.badge-green{background:rgba(22,163,74,.13);color:#16a34a}
.dark .badge-green{background:rgba(74,222,128,.14);color:#4ade80}
.sort-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--div);user-select:none;-webkit-user-select:none;}
.sort-row:last-child{border-bottom:none;}
.sort-row.drop-hint{border-top:2px solid var(--accent);}
.grip{flex-shrink:0;width:28px;height:32px;display:flex;align-items:center;justify-content:center;cursor:grab;color:var(--text2);opacity:.5;touch-action:none;}
.grip:active{cursor:grabbing;opacity:1;}
.grip svg{width:18px;height:18px;}
.sort-name{flex:1;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:flex-start;justify-content:center;z-index:100;padding:8vh 16px 16px;}
.modal-box{overscroll-behavior:contain;background:var(--bg);border:1px solid var(--div);border-radius:16px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.2);}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 8px;font-size:16px;font-weight:600;}
.modal-sub{font-size:12px;color:var(--text2);padding:0 18px 10px;}
.modal-foot{padding:12px 18px 18px;display:flex;justify-content:flex-end;}
.sort-scroll{overflow-y:auto;padding:0 18px 18px;-webkit-overflow-scrolling:touch;}
.badge-orange{background:rgba(217,164,65,.14);color:#c08a2d}
.dark .badge-orange{color:#d9a441}
/* origin-dropdown：菜单从触发器边缘"长"出来 */
.od-root{position:relative;display:inline-block;flex-shrink:0}
.od-chev{display:inline-flex;vertical-align:-2px;margin-left:4px}
.od-root.open .od-chev{transform:rotate(180deg)}
.od-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:0;width:max-content;padding:6px;border-radius:14px;background:var(--bg);border:1px solid var(--card-brd);box-shadow:0 14px 36px rgba(0,0,0,.35),inset 0 0 0 300px var(--bg);z-index:300;display:none}
.dark .od-menu{background:#1e1e24;box-shadow:0 14px 36px rgba(0,0,0,.35),inset 0 0 0 300px #1e1e24}
.od-menu.portal{position:fixed;right:auto;left:0;top:0;z-index:9999}
.od-root.open .od-menu{display:block;transform:translateZ(0)}
.od-menu .mi{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;font-size:14px;font-weight:500;text-align:left;border-radius:10px;cursor:pointer;color:var(--text);font-family:inherit}
.od-menu .mi:active{background:var(--field)}
.od-menu .mi svg{width:16px;height:16px;flex-shrink:0;opacity:.75}
.od-menu .mi.danger{color:#e11d48}
/* ---- 卡片 ---- */
.card{background:var(--card);border:1px solid var(--card-brd);border-radius:var(--radius);padding:20px 18px;margin-bottom:12px;box-shadow:var(--shadow)}
.card h3{font-size:15px;font-weight:700;margin-bottom:12px;letter-spacing:-.2px}
/* ---- 统计 ---- */
.stat-box{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.set-sec{font-size:13px;font-weight:600;color:var(--text2);margin:20px 4px 8px}
.set-group{background:var(--card);border-radius:16px;overflow:hidden}
.set-row{display:flex;align-items:center;gap:12px;padding:13px 16px;font-size:14.5px;cursor:pointer}
.set-row+.set-row{border-top:1px solid var(--div)}
.set-row svg.ic{width:20px;height:20px;flex-shrink:0;color:var(--text2)}
.set-row.danger,.set-row.danger svg.ic{color:#e11d48}
.set-row .chev{margin-left:auto;color:var(--text3);flex-shrink:0}
.set-row .chev svg{width:15px;height:15px;display:block}
.stat{background:var(--field);border-radius:14px;padding:12px 6px;text-align:center}
.stat .num{font-size:19px;font-weight:800;letter-spacing:-.5px;color:var(--text);white-space:nowrap}
.stat .lbl{font-size:11px;color:var(--text2);margin-top:4px;font-weight:600}
/* ---- 表单 ---- */
.input,.textarea{border:1px solid var(--field-brd);border-radius:13px;padding:12px 14px;font-size:14px;width:100%;outline:none;background:var(--field);color:var(--text);font-family:inherit;font-weight:500;transition:all .15s}
.input:focus,.textarea:focus{border-color:var(--accent)}
label.lbl{font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px;display:block;margin-top:14px}
/* ---- 工具 ---- */
/* ---- 底部 dock ---- */
.dock{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom,0px));display:flex;gap:4px;padding:8px;background:var(--card);border:1px solid var(--card-brd);border-radius:26px;box-shadow:0 12px 40px rgba(0,0,0,.16);z-index:100}
.dock-item{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 20px;border-radius:19px;cursor:pointer;border:none;background:transparent;font-family:inherit;transition:all .15s;color:var(--text3)}
.dock-item .d-icon{display:flex;align-items:center;justify-content:center}
.dock-item .d-icon svg{width:21px;height:21px}
.dock-item .d-label{font-size:10.5px;font-weight:600}
.dock-item.active{background:var(--field);color:var(--text)}
.dock-item:active{transform:scale(.94)}
/* ---- 空状态 ---- */
.empty{text-align:center;padding:64px 20px}
#bootLoader{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);z-index:999}
.boot-spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--card-brd);border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.skel-row{display:flex;align-items:center;gap:12px;padding:14px 16px}
.skel-ico{width:44px;height:44px;border-radius:12px;background:var(--field);flex-shrink:0}
.skel-tx{flex:1;min-width:0}
.skel-l1{height:14px;width:42%;border-radius:6px;background:var(--field);margin-bottom:8px}
.skel-l2{height:11px;width:68%;border-radius:6px;background:var(--field)}
.skel-ico,.skel-l1,.skel-l2{animation:skel 1.2s ease-in-out infinite}
@keyframes skel{0%,100%{opacity:.45}50%{opacity:1}}
.empty .ico{margin-bottom:12px;opacity:.45;color:var(--text2)}
.empty .ico svg{width:52px;height:52px}
.empty p{font-size:13.5px;color:var(--text2);font-weight:500}
/* ---- 弹窗 ---- */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:150;display:flex;align-items:center;justify-content:center;padding:16px}
.modal{background:var(--bg);border:1px solid var(--card-brd);border-radius:22px;padding:24px 20px;width:100%;max-width:420px;max-height:85vh;max-height:85dvh;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 64px rgba(0,0,0,.25);animation:sheetUp .25s ease}
.dark .modal{background:#1c1c22}
.modal h3{font-size:16px;font-weight:700;margin-bottom:14px}
.modal .desc{font-size:13px;color:var(--text2);margin-bottom:6px}
.modal .btn-row{display:flex;gap:10px;margin-top:20px}
.modal .btn-row .btn{flex:1;justify-content:center;padding:12px}
/* ---- Toast ---- */
.toast{position:fixed;top:calc(20px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%) translateY(-12px);background:#2c2c32;color:#fff;padding:11px 22px;border-radius:20px;font-size:13px;z-index:300;font-weight:600;opacity:0;transition:all .25s;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
/* ---- 选择列表 ---- */
.pick-list{max-height:220px;overflow-y:auto;border:1px solid var(--field-brd);border-radius:13px;margin-top:10px;background:var(--field)}
.pick-item{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;font-size:13.5px;font-weight:500;border-bottom:0.5px solid var(--div)}
.pick-item:last-child{border:none}
.pick-item.checked{background:rgba(109,94,242,.16);font-weight:600}
.pick-item.checked::after{content:"";width:20px;height:20px;border-radius:50%;flex-shrink:0;background:#6d5ef2 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 12.6l5 5L19.5 7'/%3E%3C/svg%3E") center/11px no-repeat}
/* ---- 登录 ---- */
#loginGate{min-height:100vh;display:none;align-items:center;justify-content:center;padding:24px;position:relative;z-index:1}
.login-card{width:100%;max-width:340px;text-align:center;background:var(--card);border:1px solid var(--card-brd);border-radius:28px;padding:44px 32px;box-shadow:var(--shadow)}
.login-card .logo-img{width:72px;height:72px;margin:0 auto 20px}
.login-card .logo-img img{width:100%;height:100%;object-fit:contain;filter:invert(1)}
.dark .login-card .logo-img img{filter:none}
@media(prefers-color-scheme:dark){:root:not(.dark):not(.light) .login-card .logo-img img{filter:none}}
.login-card h2{font-size:22px;font-weight:800;letter-spacing:-.5px}
.login-card p.sub{color:var(--text2);font-size:13px;margin:8px 0 28px;font-weight:500}
.login-card .input{text-align:center;margin-bottom:14px;padding:14px 16px;font-size:16px;border-radius:16px;background:var(--field)}
.login-card .btn-primary{width:100%;justify-content:center;padding:15px;font-size:16px;font-weight:700;border-radius:16px}
.login-err{color:#e11d48;font-size:13px;margin-top:12px;display:none;font-weight:600}
/* ---- 源码编辑器 ---- */
#editorOverlay{display:none;position:fixed;inset:0;z-index:600;background:var(--bg);flex-direction:column}
.ed-bar{display:flex;align-items:center;gap:10px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px));background:var(--card);border-bottom:1px solid var(--div)}
.ed-title{font-size:15px;font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-fname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--field);border:1px solid var(--field-brd);color:var(--text);border-radius:9px;padding:8px 10px;width:128px;flex-shrink:0;outline:none}
.ed-fname:focus{border-color:var(--accent)}
.ed-body{flex:1;display:flex;overflow:hidden}
.ed-gutter{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:19px;padding:12px 8px 12px 12px;text-align:right;color:var(--text3);background:var(--field);border-right:1px solid var(--div);overflow:hidden;white-space:pre;user-select:none;-webkit-user-select:none}
.ed-gutter div{will-change:transform}
#edCode{flex:1;border:none;outline:none;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:19px;padding:12px 14px 45vh 12px;background:transparent;color:var(--text);white-space:pre;overflow:auto;tab-size:2}
.ed-foot{display:flex;align-items:center;gap:8px;padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));background:var(--card);border-top:1px solid var(--div);font-size:11.5px;color:var(--text2);font-weight:600}
.ed-dot{width:8px;height:8px;border-radius:50%;background:#30d158;display:inline-block;flex-shrink:0}
.ed-dot.dirty{background:#ff9f0a}
@keyframes pop{from{opacity:0;transform:scale(.98) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes sheetUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}

/* spotlight 卡片 */
.row{position:relative}
.row::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;z-index:0;border-radius:inherit;
background:radial-gradient(380px circle at var(--mx,50%) var(--my,50%),rgba(124,108,246,.14),transparent 65%)}
.row:hover::before{opacity:1}
.row>*{position:relative;z-index:1}
/* 玻璃 dock */
.dock{background:rgba(255,255,255,.72)!important;backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);
border:1px solid rgba(0,0,0,.08)!important;box-shadow:0 12px 40px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.7)!important;border-radius:28px!important;padding:8px!important}
.dark .dock{background:rgba(22,22,30,.55)!important;border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08)!important}
.ios-search{display:inline-flex;align-items:center;height:40px;width:170px;padding:0 14px;border-radius:999px;background:#EDEDF0;border:1px solid transparent;flex-shrink:0;min-width:0}
.ios-search:focus-within{background:#E2E2E6;border-color:#C6C6CC}
.ios-search-ico{width:16px;height:16px;flex-shrink:0;margin-right:10px;color:#8E8E93}
.ios-search:focus-within .ios-search-ico{color:#1c1c1e}
.ios-search-input{flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:16px;color:#1c1c1e;font-family:inherit;padding:0}
.ios-search-input::placeholder{color:#8E8E93}
.ios-search-input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;display:none}
.ios-search-input::-webkit-search-decoration{display:none}
.ios-search-x{display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:6px;padding:0;border:none;border-radius:50%;background:#D1D1D6;color:#6e6e74;cursor:pointer;flex-shrink:0;visibility:hidden}
.ios-search-x svg{width:12px;height:12px}
.dark .ios-search{background:#0E0E0E;border-color:#1F1F1F}
.dark .ios-search:focus-within{background:#141414;border-color:#4A4A4A}
.dark .ios-search-ico{color:#525252}
.dark .ios-search:focus-within .ios-search-ico{color:#FAFAFA}
.dark .ios-search-input{color:#FAFAFA}
.dark .ios-search-input::placeholder{color:#6B6B6B}
.dark .ios-search-x{background:#141414;color:#525252}
.dock-item{flex-direction:row!important;gap:7px!important;padding:10px 18px!important;border-radius:20px!important;font-size:13.5px!important;white-space:nowrap!important;flex-shrink:0}
.dock{max-width:calc(100vw - 40px)}
.dock-item .d-label{font-size:13.5px!important}
.dock-item .d-icon svg{width:17px!important;height:17px!important}
.dock-item.active{background:linear-gradient(135deg,#7c6cf6,#5b4fe0)!important;color:#fff!important;box-shadow:0 4px 16px rgba(124,108,246,.4)}
/* 磁吸按钮 */
.btn-mag{transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .2s!important;will-change:transform}
.source-card{padding:18px;margin-bottom:14px;overflow-wrap:anywhere}
.source-head,.source-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.source-head{justify-content:space-between}.source-head strong{min-width:0;flex:1}
.source-url,.source-stats{font-size:12px;color:var(--text2);line-height:1.7;margin:8px 0;overflow-wrap:anywhere}
.source-error{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#d26041;max-height:180px;overflow:auto}
.source-card summary{cursor:pointer;font-size:12px;color:var(--text2);margin-top:14px}
.source-item{display:flex;gap:8px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--div);font-size:13px}
.source-item>span:first-child{min-width:0;flex:1}.source-item-status{font-size:11px;color:var(--text2)}
.source-item small{width:100%}.source-actions .btn{font-size:12px;padding:8px 10px}
.dock{width:max-content;max-width:calc(100vw - 24px)}
.dock-item{flex-direction:column!important;gap:3px!important;padding:8px 14px!important;min-width:56px;flex:1}
.dock-item .d-label{font-size:11px!important}
@media(max-width:360px){.dock-item{padding:8px 9px!important;min-width:50px}}
#sourceFilter{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text2);overflow-wrap:anywhere}
</style>
<script>try{var v=null;try{v=localStorage.getItem('fwh_theme')}catch(_e){}var d=document.documentElement;if(v==='dark')d.classList.add('dark');else if(v==='light')d.classList.add('light');else if(window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)d.classList.add('dark');}catch(e){try{if(matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(_e2){}}
// 磁吸按钮
document.querySelectorAll('.btn-mag').forEach(function(btn){
  var R = 70;
  document.addEventListener('pointermove', function(e){
    var r = btn.getBoundingClientRect();
    if(r.width===0) return;
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    var dx = e.clientX - cx, dy = e.clientY - cy;
    var d = Math.hypot(dx, dy);
    if(d < R && d > 0){
      var pull = (1 - d/R) * 10;
      btn.style.transform = 'translate('+(dx/d*pull)+'px,'+(dy/d*pull)+'px) scale(1.04)';
    } else {
      btn.style.transform = '';
    }
  });
  btn.addEventListener('pointerleave', function(){ btn.style.transform=''; });
});
</script>
</head>
<body>
<div id="bootLoader"><div class="boot-spin"></div></div>
<div id="loginGate">
<div class="login-card"><div class="logo-img"><img src="data:image/png;base64,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" alt=""></div><h2>Widget Hub</h2><p class="sub">请输入管理密码继续</p><input type="password" id="pwInput" class="input" placeholder="管理密码" onkeydown="if(event.key==='Enter')login()"><button class="btn btn-primary" onclick="login()">登 录</button><p id="loginErr" class="login-err"></p></div></div>

<div id="appMain" style="display:none">
<div class="header"><div class="header-in">
<div class="avatar"><img src="data:image/png;base64,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" style="width:26px;height:26px;display:block" alt=""/></div>
<div><h1 id="pageTitle">模块库</h1></div>
<div class="spacer"></div>
<button class="btn-xs theme-btn" id="btnThemeToggle" onclick="toggleTheme()" title="切换主题">&#x1f313;</button>
</div></div>

<div class="main">
<div id="page-modules" class="page">
<div class="page-head"><span class="count" id="modCount">0 个模块</span><div class="actions"><span class="ios-search"><svg class="ios-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input class="ios-search-input" id="modSearch" type="search" placeholder="Search…" oninput="onModSearch()"><button class="ios-search-x" id="modSearchX" onclick="clearModSearch()" aria-label="清除搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span><button class="btn btn-sm btn-mag" onclick="showImportUrl()" style="margin-left:auto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg> 链接</button><button class="btn btn-primary btn-sm btn-mag" onclick="showUploadMods()">&#xff0b; 上传</button></div></div>
<div id="sourceFilter"></div>
<div style="display:flex;gap:6px;align-items:flex-start"><div class="folder-tabs" id="groupTabs" style="display:flex;gap:6px;overflow-x:auto;padding:2px 4px 12px;scrollbar-width:none;flex:1;min-width:0"></div><div class="od-root" id="groupOdRoot"><button class="ftab od-trigger" onclick="toggleGroupMenu(event)" aria-haspopup="menu" aria-expanded="false" style="color:var(--accent);border-style:dashed;background:transparent;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px;vertical-align:-2px"><path d="M12 5v14M5 12h14"/></svg> 分组<svg class="od-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="m6 9 6 6 6-6"/></svg></button><div class="od-menu" role="menu"><button class="mi" role="menuitem" onclick="closeGroupMenu();showNewGroup()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><path d="M12 5v14M5 12h14"/></svg>新建分组</button><button class="mi" role="menuitem" onclick="closeGroupMenu();showGroupSort()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>管理分组</button></div></div></div><div id="modulesList"><div class="card" style="padding:10px 18px 6px"><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div></div></div></div>

<div id="page-sources" class="page">
<div class="page-head"><span class="count" id="sourceCount"></span><button class="btn btn-primary btn-sm" onclick="showAddSource()">＋ 添加订阅源</button></div>
<p class="source-stats">每 6 小时同步，也可手动刷新。上游新增只进入模块库，已下架模块保留本地版本。</p>
<p class="source-stats">后台更新不等于设备立即更新；REX 客户端有缓存时，请手动刷新合集。</p>
<div id="sourcesList"></div></div>
<div id="page-collections" class="page">
<div class="page-head"><span class="count" id="colCount"></span><div class="actions"><button class="btn btn-primary btn-sm" onclick="showAddCol()" style="margin-left:auto">&#xff0b; 新建合集</button></div></div>
<div id="collectionsList"></div></div>

<div id="page-settings" class="page">
<div class="set-sec">数据统计</div>
<div class="stat-box"><div class="stat"><div class="num" id="statCols">0</div><div class="lbl">合集</div></div><div class="stat"><div class="num" id="statMods">0</div><div class="lbl">模块</div></div><div class="stat"><div class="num" id="statSize">0</div><div class="lbl">总大小</div></div></div>
<div class="set-sec">排序</div>
<div class="set-group"><div class="set-row" onclick="openSortModal()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="M3 17l3 3 3-3"/><path d="M6 18V4"/></svg><div><div style="font-weight:600">调整顺序</div><div style="font-size:12px;color:var(--text2);margin-top:1px">调整模块和分组的显示顺序</div></div><span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span></div></div>
<div class="set-sec">工具</div>
<div class="set-group">
<div class="set-row" onclick="exportData()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>备份（模块+合集+订阅源）</div>
<div class="set-row" onclick="importBackup()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V6"/><path d="M6 12l6-6 6 6"/><path d="M4 21h16"/></svg>恢复（上传备份文件）</div>
<div class="set-row danger" onclick="clearAllData()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>清除所有数据</div>
</div>
<div class="set-sec">修改密码</div>
<div class="set-group"><div class="set-row" style="cursor:default"><input type="password" id="pwdNew" placeholder="新密码" style="flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:14.5px;color:var(--text);font-family:inherit"><button onclick="changePassword()" style="flex-shrink:0;border:none;cursor:pointer;font-size:14px;font-weight:700;color:#fff;background:var(--accent);border-radius:10px;padding:8px 16px;font-family:inherit">修改</button></div></div>
<div class="set-sec">关于</div>
<div class="set-group"><div class="set-row" style="cursor:default"><div style="font-size:13px;color:var(--text2);line-height:1.7">Widget Hub · Docker 2.1<br>本地 SQLite · 数据库持久化</div></div></div>
</div>
</div>

<div class="dock">
<button class="dock-item" data-tab="sources" onclick="switchTab('sources')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M7 12h10M12 7v10"/></svg></span><span class="d-label">订阅源</span></button>
<button class="dock-item active" data-tab="modules" onclick="switchTab('modules')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg></span><span class="d-label">模块库</span></button>
<button class="dock-item" data-tab="collections" onclick="switchTab('collections')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg></span><span class="d-label">我的合集</span></button>
<button class="dock-item" data-tab="settings" onclick="switchTab('settings')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span><span class="d-label">设置</span></button></div>
</div>

<div id="editorOverlay">
  <div class="ed-bar">
    <button class="btn-xs" onclick="closeEditor()" style="font-size:16px">&#x2715;</button>
    <span class="ed-title" id="edTitle">源码编辑</span>
    <input class="ed-fname" id="edFilename" placeholder="文件名.js">
    <button class="btn-xs" id="edSaveBtn" onclick="saveEditor()" style="font-size:16px" title="保存">&#x1f4be;</button>
  </div>
  <div class="ed-body">
    <div class="ed-gutter" id="edGutter">1</div>
    <textarea id="edCode" spellcheck="false" autocapitalize="off" autocorrect="off" wrap="off"></textarea>
  </div>
  <div class="ed-foot">
    <span class="ed-dot" id="edDot"></span>
    <span id="edState">已保存</span>
    <span style="flex:1"></span>
    <span id="edLines">1 行</span>
    <span id="edSize">0 B</span>
  </div>
</div>

<div class="toast" id="toast"></div>
<input type="file" id="replaceFileInput" accept=".js,application/javascript,text/javascript" style="position:fixed;top:-100px;left:-100px;opacity:0.01;width:1px;height:1px" onchange="doReplaceMod(this)">

<script>
var state = { modules: [], collections: [], groups: [], sources: [], sourceFilter: '', tab: 'modules', modReplaceId: null, isAuthed: false, activeGroup: '' };

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escJs(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(b){ b=b||0; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; if(b<1073741824) return (b/1048576).toFixed(1)+' MB'; return (b/1073741824).toFixed(2)+' GB'; }
function debounce(fn,ms){ var t=null; return function(){ var a=arguments,c=this; clearTimeout(t); t=setTimeout(function(){ fn.apply(c,a); },ms); }; }
function org(){ return location.origin; }
function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(function(){ t.classList.remove('show'); },2000); }

async function api(path, opts){
  opts = opts || {};
  var ctrl=null, timer=null;
  try{ ctrl=new AbortController(); }catch(e){ ctrl=null; }
  var fo = { method: opts.method || 'GET', headers: {} };
  var _to = typeof opts.timeout==='number' ? opts.timeout : (opts.body ? 120000 : 15000);
  if(ctrl){ fo.signal=ctrl.signal; timer=setTimeout(function(){ try{ctrl.abort();}catch(e){} },_to); }
  if(opts.json){ fo.headers['Content-Type']='application/json'; fo.body=JSON.stringify(opts.json); }
  if(opts.body) fo.body = opts.body;
  var r;
  try{ r = await fetch(path, fo); }
  finally{ if(timer) clearTimeout(timer); }
  if(r.status===401){ state.isAuthed=false; showLogin(); return null; }
  if(r.status===204) return {ok:true};
  return r.json().catch(function(){ return null; });
}

function showLogin(){ document.getElementById('bootLoader').style.display='none'; document.getElementById('loginGate').style.display='flex'; document.getElementById('appMain').style.display='none'; state.isAuthed=false; }
function showApp(){ document.getElementById('bootLoader').style.display='none'; document.getElementById('loginGate').style.display='none'; document.getElementById('appMain').style.display='block'; switchTab('modules'); loadAll(); }

async function checkAuth(){
  var r=null;
  try{ r = await api('/api/admin/auth'); }catch(e){ r=null; }
  if(!r){ showLogin(); return; }
  if(r.authenticated){ state.isAuthed=true; showApp(); loadAll(); } else showLogin();
}

async function login(){
  var pw = document.getElementById('pwInput').value;
  if(!pw) return;
  var r = await api('/api/admin/auth', {method:'POST',json:{password:pw}});
  if(r&&r.ok){ state.isAuthed=true; showApp(); document.getElementById('pwInput').value=''; }
  else { var e=document.getElementById('loginErr'); e.style.display='block'; e.textContent='密码错误'; }
}

var _loadP=null;
async function loadAll(){
  if(_loadP) return _loadP;
  _loadP=(async function(){
    var res=null;
    for(var i=0;i<2 && !res;i++){
      try{ res = await Promise.all([api('/api/admin/modules'), api('/api/admin/collections'), api('/api/admin/groups'), api('/api/admin/sources')]); }
      catch(e){ res=null; }
    }
    if(!res){
      document.getElementById('modulesList').innerHTML='<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22.61 16.95A5 5 0 0018 10h-1.26a8 8 0 00-7.05-6M5 5a8 8 0 004 15h9a5 5 0 001.7-.3"/><path d="M1 1l22 22"/></svg></div><p>加载失败，可能是网络问题</p><button class="ftab" onclick="loadAll()" style="margin-top:10px">重新加载</button></div>';
      return;
    }
    var mr = res[0], cr = res[1];
    if(mr && Array.isArray(mr)) state.modules = mr;
    var gr = res[2];
    if(Array.isArray(res[3])) state.sources=res[3];
    if(gr && Array.isArray(gr)) state.groups = gr;
    if(cr && Array.isArray(cr)) state.collections = cr;
    try{ localStorage.setItem('fwh_cache_v1', JSON.stringify({modules:state.modules,collections:state.collections,groups:state.groups})); }catch(e){}
    switchTab(state.tab);
  })();
  try{ await _loadP; }finally{ _loadP=null; }
}

function switchTab(tab){
  state.tab=tab;
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var pg = document.getElementById('page-'+tab); if(pg) pg.classList.add('active');
  document.querySelectorAll('.dock-item').forEach(function(el){ el.classList.toggle('active',el.dataset.tab===tab); });
  var titles={sources:'订阅源',modules:'模块库',collections:'我的合集',settings:'设置'};
  document.getElementById('pageTitle').textContent=titles[tab];

  if(tab==='sources') renderSources();
  if(tab==='modules') renderMods();
  if(tab==='collections') renderCols();
  if(tab==='settings') renderSettings();
}

// ===== MODULES =====
function renderGroupTabs(){
  var el = document.getElementById('groupTabs');
  if(!el) return;
  var h = '<div class="ftab'+(state.activeGroup===''?' active':'')+'" onclick="setGroupTab(\'\')">\u5168\u90e8<span class="cnt">'+state.modules.length+'</span></div>';
  state.groups.forEach(function(g){
    var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
    h += '<div class="ftab'+(state.activeGroup===g.id?' active':'')+'" onclick="setGroupTab(\''+g.id+'\')">'+esc(g.name)+'<span class="cnt">'+n+'</span></div>';
  });
  el.innerHTML = h;
}
function setGroupTab(id){ state.activeGroup = id; renderGroupTabs(); renderMods(); }

// ===== 分组管理 =====






function toggleGroupMenu(e){
  if(e)e.stopPropagation();
  var root=document.getElementById('groupOdRoot');
  var willOpen=!root.classList.contains('open');
  closeGroupMenu();
  closeAllRowMenus();
  if(willOpen){
    root.classList.add('open');
    root.querySelector('.od-trigger').setAttribute('aria-expanded','true');
  }
}
function closeGroupMenu(){
  var root=document.getElementById('groupOdRoot');
  if(!root||!root.classList.contains('open'))return;
  root.classList.remove('open');
  root.querySelector('.od-trigger').setAttribute('aria-expanded','false');
}
function showNewGroup(){
  showModal('新建分组',
    '<input class="input" id="newGroupName2" placeholder="分组名" style="margin-bottom:0">',
    function(close){
      var name = document.getElementById('newGroupName2').value.trim();
      if(!name){ toast('请输入分组名'); return; }
      api('/api/admin/groups',{method:'POST',json:{name:name}}).then(function(r){
        if(r&&r.ok){ toast('已创建'); close(); loadAll(); } else toast('创建失败');
      });
    });
}

function showGroupSort(){
  var h = '<div id="gmanageList">';
  state.groups.forEach(function(g){
    var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
    h += '<div class="row" style="margin-bottom:8px;padding:10px 14px;border-radius:14px">'
      + '<div class="info"><div class="name">'+esc(g.name)+'</div><div class="sub">'+n+' 个模块</div></div>'
      + '<button class="btn-xs" onclick="renameGroup(\''+g.id+'\',\''+escJs(g.name)+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>'
      + '<button class="btn-xs danger" onclick="delGroup(\''+g.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button></div>';
  });
  h += '</div>';
  showModal('管理分组', h, function(close){ close(); });
}
function refreshGroupManageList(){
  var list = document.getElementById('gmanageList');
  if(!list) return;
  var h = '';
  state.groups.forEach(function(g){
    var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
    h += '<div class="row" style="margin-bottom:8px;padding:10px 14px;border-radius:14px">'
      + '<div class="info"><div class="name">'+esc(g.name)+'</div><div class="sub">'+n+' 个模块</div></div>'
      + '<button class="btn-xs" onclick="renameGroup(\''+g.id+'\',\''+escJs(g.name)+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>'
      + '<button class="btn-xs danger" onclick="delGroup(\''+g.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button></div>';
  });
  list.innerHTML = h;
}
var _gsortDrag = null;
function gsortTouchStart(e){ if(e.touches.length!==1) return; e.preventDefault(); gsortInit(e, true); }
function gsortMouseDown(e){ e.preventDefault(); gsortInit(e, false); }
function gsortInit(e, isTouch){
  var grip = e.currentTarget;
  var row = grip.closest('.gsort-row');
  var list = row.parentElement;
  var cy = isTouch ? e.touches[0].clientY : e.clientY;
  _gsortDrag = { gid: row.dataset.gid, startY: cy, row: row, list: list,
    rows: Array.prototype.slice.call(list.querySelectorAll('.gsort-row')),
    moved: false, isTouch: isTouch };
  if(isTouch){
    document.addEventListener('touchmove', gsortTouchMove, {passive:false});
    document.addEventListener('touchend', gsortTouchEnd);
  } else {
    document.addEventListener('mousemove', gsortMouseMove);
    document.addEventListener('mouseup', gsortMouseUp);
  }
}
function gsortMouseMove(e){ gsortDragMove(e.clientY); }
function gsortTouchMove(e){ if(!_gsortDrag||!_gsortDrag.isTouch||e.touches.length!==1) return; e.preventDefault(); gsortDragMove(e.touches[0].clientY); }
function gsortDragMove(cy){
  var d = _gsortDrag; if(!d) return;
  var dy = cy - d.startY;
  if(!d.moved && Math.abs(dy) < 8) return;
  d.moved = true;
  d.row.style.transform = 'translateY('+dy+'px)';
  d.row.style.position = 'relative'; d.row.style.zIndex = '50'; d.row.style.opacity = '0.92';
  var others = d.rows.filter(function(r){ return r !== d.row; });
  var rh = d.row.offsetHeight, curTop = d.row.offsetTop + dy, ti = 0;
  for(var i=0;i<others.length;i++){
    if(curTop + rh/2 > others[i].offsetTop + others[i].offsetHeight/2) ti = i+1;
  }
  d.targetIdx = ti;
  others.forEach(function(r){
    var oi = d.rows.indexOf(r), fi = d.rows.indexOf(d.row), sh = 0;
    if(fi < ti){ if(oi > fi && oi <= ti) sh = -(rh+8); }
    else { if(oi >= ti && oi < fi) sh = rh+8; }
    r.style.transform = sh ? 'translateY('+sh+'px)' : '';
    r.style.transition = 'transform .15s';
  });
}
function gsortEnd(){
  var d = _gsortDrag; _gsortDrag = null;
  if(!d) return;
  document.removeEventListener('mousemove', gsortMouseMove);
  document.removeEventListener('mouseup', gsortMouseUp);
  document.removeEventListener('touchmove', gsortTouchMove);
  document.removeEventListener('touchend', gsortTouchEnd);
  if(!d.moved) return;
  var ids = d.rows.map(function(r){ return r.dataset.gid; });
  var from = ids.indexOf(d.gid);
  ids.splice(from,1);
  var to = Math.max(0, Math.min(d.targetIdx==null?ids.length:d.targetIdx, ids.length));
  ids.splice(to,0,d.gid);
  var map = {};
  state.groups.forEach(function(g){ map[g.id]=g; });
  state.groups = ids.map(function(id){ return map[id]; }).filter(Boolean);
  renderGroupTabs();
  if(_sortMode==='grp') renderGroupSortInModal();
}

function gsortMouseUp(){ gsortEnd(); }
function gsortTouchEnd(){ gsortEnd(); }


var _modSearchDebounced = debounce(function(){ renderMods(); },120);
function onModSearch(){ toggleSearchX(); _modSearchDebounced(); }
function toggleSearchX(){ var i=document.getElementById('modSearch'),x=document.getElementById('modSearchX'); if(i&&x) x.style.visibility=i.value?'visible':'hidden'; }
function clearModSearch(){ var i=document.getElementById('modSearch'); if(!i) return; i.value=''; i.blur(); renderMods(); toggleSearchX(); }
function onPickSearch(el){ var x=document.getElementById('pickSearchX'); if(x) x.style.visibility=el.value?'visible':'hidden'; try{window._pickSearch(el.value);}catch(e){} }
function clearPickSearch(){ var i=document.getElementById('pickModSearch'); if(!i) return; i.value=''; i.blur(); window._pickSearch(''); var x=document.getElementById('pickSearchX'); if(x) x.style.visibility='hidden'; }
function renderMods(){
  closeAllRowMenus();
  renderSourceFilter();
  var q = (document.getElementById('modSearch').value || '').toLowerCase().trim();
  renderGroupTabs();
  var ms = state.modules.filter(function(m){
    if(state.activeGroup && m.group_id!==state.activeGroup) return false;
    if(state.sourceFilter){var s=state.sources.find(function(s){return s.id===state.sourceFilter;});if(s&&!(s.items||[]).some(function(i){return i.module_id===m.id;}))return false;}
    if (!q) return true;
    return ((m.title || '') + ' ' + (m.filename || '') + ' ' + (m.note || '') + ' ' + (m.author || '')).toLowerCase().indexOf(q) >= 0;
  });
  document.getElementById('modCount').style.display = 'none';
  if(!ms.length){ document.getElementById('modulesList').innerHTML='<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg></div><p>'+(q ? '没有匹配的模块' : '暂无模块')+'</p></div>'; return; }
  var h='<div class="card" style="padding:10px 18px 6px">';
  ms.forEach(function(m){
    var ib=m.is_encrypted?'var(--ico-encrypted)':'var(--ico-normal)';
    var ie=m.is_encrypted?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8.5 10.5V7.8a3.5 3.5 0 017 0v2.7"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 7L3.5 12l5 5"/><path d="M15.5 7l5 5-5 5"/><path d="M13.2 5.5l-2.4 13"/></svg>';
    h+='<div class="row" data-mid="'+m.id+'"><div class="ico-sq" style="background:'+ib+';color:'+(m.is_encrypted?'var(--ico-encrypted-fg)':'var(--ico-normal-fg)')+'">'+ie+'</div><div class="info"><div class="name">'+esc(m.title||m.filename)+'</div><div class="sub">'+esc(m.filename)+' · '+fmt(m.file_size)+(m.note?'<br>'+esc(m.note):'')+'</div></div>'+
      (m.is_removed?'<span class="badge badge-orange">已下架</span>':'')+
      (m.is_encrypted?'<span class="badge '+(m.source_url?'badge-green':'badge-orange')+'">加密</span>':'')+
      (m.version?'<span class="badge '+(m.source_url?'badge-green':'badge-blue')+'">'+esc(m.version)+'</span>':'')+

      '<div class="od-root row-od"><button class="btn-xs" aria-label="更多操作" onclick="toggleMenu(event,\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h8"/><path d="M18 7h2"/><path d="M4 17h2"/><path d="M12 17h8"/><circle cx="15" cy="7" r="2.6" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="2.6" fill="currentColor" stroke="none"/></svg></button>'+
      '<div class="od-menu" id="menu-'+m.id+'">'+
      (state.activeGroup?'':'<button class="mi" onclick="showMoveToGroup(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V5h5v4h9v11H5z"/></svg> 添加到分组</button>')+
      (state.activeGroup&&m.group_id?'<button class="mi" onclick="setModuleGroup(\''+m.id+'\',\'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg> 移出分组</button>':'')+
      (state.activeGroup?'':'<button class="mi" onclick="editMeta(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 编辑信息</button>')+
      (state.activeGroup?'':'<button class="mi" onclick="openEditor(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg> 编辑源码</button>')+
      '<button class="mi" onclick="copyModLink(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg> 复制链接</button>'+
      (state.activeGroup?'':'<button class="mi" onclick="promptReplace(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V6"/><path d="M6 12l6-6 6 6"/><path d="M4 21h16"/></svg> 替换文件</button>')+
      (m.source_url?'<button class="mi" onclick="refreshMod(\''+m.id+'\')" style="color:#16a34a"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.6-6.4"/><path d="M21 3v6h-6"/></svg> 刷新</button>':'')+
      (state.activeGroup?'':'<button class="mi danger" onclick="promptDeleteMod(\''+m.id+'\',\''+escJs(m.title||m.filename)+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg> 删除</button>')+'</div></div></div>';
  });
  h+='</div>';
  document.getElementById('modulesList').innerHTML=h;

}

(function(){
  var list = document.getElementById('modulesList');
  if(!list || list._spot) return;
  list._spot = true;
  list.addEventListener('pointermove', function(e){
    var card = e.target && e.target.closest ? e.target.closest('.row') : null;
    if(!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX-r.left)+'px');
    card.style.setProperty('--my', (e.clientY-r.top)+'px');
  }, {passive:true});
})();
function renameGroup(id, oldName){
  showModal('重命名分组', '<label>分组名</label><input class="input" id="renameGroupName" value="'+esc(oldName)+'">', function(close){
    var name = document.getElementById('renameGroupName').value.trim();
    if(!name){ toast('请输入名称'); return; }
    api('/api/admin/groups',{method:'PATCH',json:{id:id,name:name}}).then(function(r){
      if(r&&r.ok){ toast('已重命名'); close(); loadAll().then(function(){ refreshGroupManageList(); }); } else toast('失败');
    });
  });
}
function delGroup(id){
  showConfirm('删除该分组？组内模块不受影响', function(ok){
    if(!ok) return;
    api('/api/admin/groups?id='+id,{method:'DELETE'}).then(function(r){
      if(r&&r.ok){ toast('已删除'); loadAll().then(function(){ refreshGroupManageList(); }); } else toast('删除失败');
    });
  });
}
function setModuleGroup(mid, gid){
  api('/api/admin/modules/group',{method:'POST',json:{moduleId:mid,groupId:gid}}).then(function(r){
    if(r&&r.ok){ toast(gid?'添加成功':'已移出分组'); loadAll(); } else toast('失败');
  });
}
function showMoveToGroup(mid){
  var h = '<div class="pick-list">';
  state.groups.forEach(function(g){
    h += '<div class="pick-item" data-gid="'+g.id+'" onclick="pickGroup(this,\''+mid+'\')"><span style="flex:1">'+esc(g.name)+'</span></div>';
  });
  h += '</div>';
  var o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML='<div class="modal"><h3>添加到分组</h3>'+h+'</div>';
  document.body.appendChild(o);
  o.addEventListener('click',function(e){if(e.target===o)o.remove();});
  window._groupModal=o;
}
function pickGroup(el, mid){
  var gid = el.dataset.gid || '';
  if(window._groupModal){ window._groupModal.remove(); window._groupModal=null; }
  setModuleGroup(mid, gid);
}

// upload handled by direct input overlay

function openSortModal(){
  var m = document.getElementById('sortModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sortModal';
    m.className = 'modal-mask';
    m.innerHTML = '<div class="modal-box"><div class="modal-head"><span>排序</span></div><div class="modal-sub">按住 ≡ 拖动排序，点保存生效</div><div style="display:flex;gap:6px;padding:0 18px 10px"><div class="ftab active" id="sortModeMod" onclick="setSortMode(\'mod\')">模块排序</div><div class="ftab" id="sortModeGrp" onclick="setSortMode(\'grp\')">分组排序</div></div><div id="sortTabs" style="display:flex;gap:6px;overflow-x:auto;padding:2px 18px 12px;scrollbar-width:none;flex-shrink:0"></div><div id="sortList" class="sort-scroll"></div><div class="modal-foot" style="gap:8px"><button class="btn" onclick="closeSortModal()">取消</button><button class="btn btn-primary" onclick="saveSortOrder()">保存排序</button></div></div>';
    m.addEventListener('click', function(e){ if (e.target === m) closeSortModal(); });
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
  syncScrollLock();
  setSortMode('mod');
  renderSortList();
}
function closeSortModal(){
  if (_sortDirty && !confirm('排序尚未保存，确定关闭吗？')) return;
  _sortDirty = false;
  document.getElementById('sortModal').style.display = 'none';
  syncScrollLock();
}
var _sortDrag = null;
var _sortGroup = '';
var _sortMode = 'mod';
function setSortMode(m){
  _sortMode = m;
  var mm = document.getElementById('sortModeMod');
  var gm = document.getElementById('sortModeGrp');
  if(mm) mm.className = 'ftab' + (m==='mod'?' active':'');
  if(gm) gm.className = 'ftab' + (m==='grp'?' active':'');
  var st = document.getElementById('sortTabs');
  if(st) st.style.display = m==='mod' ? 'flex' : 'none';
  renderSortList();
}
function renderGroupSortInModal(){
  var el = document.getElementById('sortList');
  if(!el) return;
  var h = '';
  state.groups.forEach(function(g){
    var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
    h += '<div class="gsort-row" data-gid="'+g.id+'" style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--card-brd)">'
      + '<span ontouchstart="gsortTouchStart(event)" onmousedown="gsortMouseDown(event)" style="display:flex;align-items:center;cursor:grab;color:var(--text2);opacity:.5;touch-action:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg></span>'
      + '<span style="flex:1;font-size:15px">'+esc(g.name)+'</span>'
      + '<span style="font-size:12px;color:var(--text3)">'+n+' 个</span></div>';
  });
  el.innerHTML = h;
}
function renderSortList(){
  var el = document.getElementById('sortList');
  if (!el) return;
  if(_sortMode==='grp'){ renderGroupSortInModal(); return; }
  // 渲染 tab
  var tabs = document.getElementById('sortTabs');
  if(tabs){
    var h = '<div class="ftab'+(_sortGroup===''?' active':'')+'" onclick="setSortGroup(\'\')">全部<span class="cnt">'+state.modules.length+'</span></div>';
    state.groups.forEach(function(g){
      var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
      h += '<div class="ftab'+(_sortGroup===g.id?' active':'')+'" onclick="setSortGroup(\''+g.id+'\')">'+esc(g.name)+'<span class="cnt">'+n+'</span></div>';
    });
    tabs.innerHTML = h;
  }
  var h2 = '';
  function sortRow(m){
    return '<div class="sort-row" data-mid="'+m.id+'">'
      + '<span class="grip" ontouchstart="sortTouchStart(event)" onmousedown="sortMouseDown(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg></span>'
      + '<span class="sort-name">'+esc(m.title||m.filename)+'</span>'
      + (m.is_encrypted?'<span class="badge '+(m.source_url?'badge-green':'badge-orange')+'" style="flex-shrink:0">\u52a0\u5bc6</span>':'')
      + '</div>';
  }
  var list = state.modules.filter(function(m){
    if(_sortGroup && m.group_id!==_sortGroup) return false;
    return true;
  });
  list.forEach(function(m){ h2 += sortRow(m); });
  if(!list.length) h2 = '<div style="text-align:center;color:var(--text3);padding:30px;font-size:13px">该分组暂无模块</div>';
  el.innerHTML = h2;
}
function setSortGroup(id){ _sortGroup = id; renderSortList(); }
function sortDragInit(e, isTouch){
  var clientY = isTouch ? e.touches[0].clientY : e.clientY;
  var grip = e.currentTarget;
  var row = grip.closest('.sort-row');
  var list = document.getElementById('sortList');
  _sortDrag = { mid: row.dataset.mid, startY: clientY, row: row, list: list,
    rows: Array.prototype.slice.call(list.querySelectorAll('.sort-row')),
    moved: false, isTouch: isTouch };
  if (isTouch) {
    document.addEventListener('touchmove', sortTouchMove, {passive:false});
    document.addEventListener('touchend', sortTouchEnd);
    document.addEventListener('touchcancel', sortTouchEnd);
  } else {
    document.addEventListener('mousemove', sortMouseMove);
    document.addEventListener('mouseup', sortMouseUp);
  }
}
function sortMouseDown(e){ e.preventDefault(); sortDragInit(e, false); }
function sortTouchStart(e){ if(e.touches.length!==1) return; e.preventDefault(); sortDragInit(e, true); }
function sortDragMove(clientY){
  var d = _sortDrag; if (!d) return;
  var dy = clientY - d.startY;
  if (!d.moved && Math.abs(dy) < 6) return;
  if (!d.moved) {
    d.moved = true;
    d.row.style.position = 'relative'; d.row.style.zIndex = '50';
    d.row.style.background = 'var(--bg)';
    d.row.style.boxShadow = '0 4px 16px rgba(0,0,0,.18)';
    d.row.style.borderRadius = '10px';
  }
  d.row.style.transform = 'translateY('+dy+'px)';
  var others = d.rows.filter(function(r){ return r !== d.row; });
  var rh = d.row.offsetHeight, curTop = d.row.offsetTop + dy, ti = 0;
  for (var i=0;i<others.length;i++){
    if (curTop + rh/2 > others[i].offsetTop + others[i].offsetHeight/2) ti = i+1;
  }
  d.targetIdx = ti;
  others.forEach(function(r){ r.classList.remove('drop-hint'); });
  if (others[ti]) others[ti].classList.add('drop-hint');
}
function sortMouseMove(e){ sortDragMove(e.clientY); }
function sortTouchMove(e){
  if (!_sortDrag || !_sortDrag.isTouch || e.touches.length!==1) return;
  e.preventDefault();
  sortDragMove(e.touches[0].clientY);
}
function sortDragEnd(){
  var d = _sortDrag; _sortDrag = null;
  if (!d) return;
  document.removeEventListener('mousemove', sortMouseMove);
  document.removeEventListener('mouseup', sortMouseUp);
  document.removeEventListener('touchmove', sortTouchMove);
  document.removeEventListener('touchend', sortTouchEnd);
  document.removeEventListener('touchcancel', sortTouchEnd);
  d.row.style.cssText = '';
  d.list.querySelectorAll('.drop-hint').forEach(function(r){ r.classList.remove('drop-hint'); });
  if (!d.moved) return;
  var ms = state.modules;
  var from = ms.findIndex(function(m){ return String(m.id)===String(d.mid); });
  if (from < 0) return;
  var item = ms.splice(from,1)[0];
  var to = Math.max(0, Math.min(d.targetIdx==null?ms.length:d.targetIdx, ms.length));
  ms.splice(to,0,item);
  renderSortList();
  renderMods();
  _sortDirty = true;
}
function sortMouseUp(){ sortDragEnd(); }
function sortTouchEnd(){ sortDragEnd(); }
var _sortDirty = false;
async function saveSortOrder(){
  if(_sortMode==='grp'){
    var gids = state.groups.map(function(g){ return g.id; });
    try {
      var gr = await api('/api/admin/groups/reorder', {method:'POST', json:{ids:gids}});
      if(gr && gr.ok){ _sortDirty=false; toast('分组排序已保存'); closeSortModal(); }
      else toast('保存失败');
    } catch(e){ toast('保存异常'); }
    return;
  }
  var ids = state.modules.map(function(m){ return m.id; });
  try {
    var r = await api('/api/admin/modules/reorder', { method: 'POST', json: { ids: ids } });
    if (r && r.ok) {
      _sortDirty = false;
      toast('排序已保存');
      closeSortModal();
    } else {
      toast('保存失败: ' + JSON.stringify(r).slice(0,100));
    }
  } catch(e) {
    toast('保存异常: ' + String(e).slice(0,100));
  }
}
function showUploadMods(){
  showModal('上传模块',
    '<label>选择文件</label><input type="file" id="uploadFiles" multiple accept=".js,application/javascript,text/javascript" class="input" style="padding:8px">'+
    '<label>分组</label><select class="input" id="uploadGroup">'+groupOptions('')+'</select>',
    async function(close){
      var input = document.getElementById('uploadFiles');
      if(!input.files.length){ toast('请先选择文件'); return; }
      var gid = document.getElementById('uploadGroup').value;
      var fd = new FormData();
      for(var i=0;i<input.files.length;i++) fd.append('files',input.files[i]);
      if(gid) fd.append('group_id', gid);
      var r = await api('/api/admin/modules',{method:'POST',body:fd});
      if(r&&r.ok){ toast('已上传 '+(r.added?r.added.length:input.files.length)+' 个模块'); close(); loadAll(); }
      else toast('上传失败');
    });
}

function copyModLink(id){ copyText(org()+'/api/modules/'+id+'.js'); }

// ===== 源码在线编辑 =====
var ed = { id:null, filename:'', orig:'', dirty:false, saving:false, warn:'' };

async function openEditor(id){
  var m = state.modules.find(function(x){ return x.id===id; });
  if(!m) return;
  toast('正在加载源码…');
  try{
    var r = await fetch('/api/admin/modules/'+id+'/source', {credentials:'same-origin'});
    if(r.status===401){ state.isAuthed=false; showLogin(); return; }
    if(!r.ok){ var e=await r.json().catch(function(){return null;}); toast(e&&e.error?e.error:'读取失败'); return; }
    var d = await r.json();
    ed.id = id; ed.filename = d.filename || m.filename || 'module.js';
    ed.orig = d.content || ''; ed.dirty = false;
    document.getElementById('edTitle').textContent = m.title || m.filename || '模块';
    document.getElementById('edFilename').value = ed.filename;
    var ta = document.getElementById('edCode');
    ta.value = ed.orig;
    // 超大文件关掉行号，避免卡顿
    ed.gutterOff = (ed.orig.length > 120000);
    document.getElementById('edGutter').style.display = ed.gutterOff ? 'none' : 'block';
    document.getElementById('editorOverlay').style.display = 'flex';
    edSyncState(); updateGutter(); scrollGutter();
    ta.focus();
  }catch(err){ toast('读取失败：'+err.message); }
}

function closeEditor(force){
  if(ed.dirty && !force){
    showConfirm('源码还没保存，确定放弃修改？', function(ok){ if(ok) closeEditor(true); });
    return;
  }
  document.getElementById('editorOverlay').style.display='none';
  ed.dirty=false; ed.id=null; ed.orig='';
}

function edApplyWarn(){
  var warn = '';
  try{
    var meta = parseMetaFromText(ed.filename, document.getElementById('edCode').value);
    warn = meta._warn || '';
  }catch(e){}
  document.getElementById('edState').textContent = (ed.dirty?'未保存':'已保存') + (warn ? ' · '+warn : '');
}

function edSyncState(){
  var ta = document.getElementById('edCode');
  var len = ta.value.length;
  document.getElementById('edLines').textContent = (ta.value.split('\n').length) + ' 行';
  document.getElementById('edSize').textContent = fmt(len);
  var dot = document.getElementById('edDot');
  dot.className = 'ed-dot' + (ed.dirty?' dirty':'');
  edApplyWarn();
  var b = document.getElementById('edSaveBtn');
  b.textContent = ed.saving ? '⏳' : '💾';
}

function updateGutter(){
  if(ed.gutterOff) return;
  var ta = document.getElementById('edCode');
  var n = ta.value.split('\n').length;
  var g = document.getElementById('edGutter');
  if(g.childElementCount !== n){
    var html = '';
    for(var i=1;i<=n;i++) html += '<div>'+i+'</div>';
    g.innerHTML = html;
  }
  scrollGutter();
}

function scrollGutter(){
  if(ed.gutterOff) return;
  var ta = document.getElementById('edCode');
  document.getElementById('edGutter').scrollTop = ta.scrollTop;
}

// 从源码文本里解析 WidgetMetadata（与后端 parseMeta 同规则）
function parseMetaFromText(fn, text){
  var head = text.slice(0, 32768);
  var meta = {};
  var m = head.match(/\/\*[\s\S]*?WidgetMetadata\s*\{/) || head.match(/WidgetMetadata\s*=\s*\{/);
  if(!m) return meta;
  var depth = 1, i = m.index + m[0].length, start = i;
  while(i < head.length && depth > 0){
    if(head[i]==='{') depth++;
    else if(head[i]==='}') depth--;
    i++;
  }
  var body = head.slice(start, i-1);
  var pairs = body.match(/["']?(\w+)["']?\s*:\s*"([^"]*)"/g) || [];
  pairs.forEach(function(x){ var kv = x.match(/["']?(\w+)["']?\s*:\s*"([^"]*)"/); if(kv && !meta[kv[1]]) meta[kv[1]] = kv[2]; });
  if(!meta.id) meta._warn = '未解析到 WidgetMetadata.id';
  return meta;
}

async function saveEditor(){
  if(!ed.id || ed.saving) return;
  var code = document.getElementById('edCode').value;
  var name = document.getElementById('edFilename').value.trim() || ed.filename;
  if(!/\.js$/i.test(name)) { toast('文件名需要 .js 结尾'); return; }
  ed.saving = true; edSyncState();
  try{
    var fd = new FormData();
    fd.append('name', name);
    fd.append('code', code);
    var r = await fetch('/api/admin/modules/'+ed.id+'/source', {method:'PUT', body:fd, credentials:'same-origin'});
    var d = await r.json().catch(function(){ return null; });
    if(r.ok && d && d.ok){
      ed.orig = code; ed.filename = name; ed.dirty = false;
      toast('已保存');
      loadAll();
      // 同步模块池里的文件名/元信息
      var mx = state.modules.find(function(x){ return x.id===ed.id; });
      if(mx && d.module){ mx.filename = d.module.filename; mx.title = d.module.title; mx.version = d.module.version; }
    } else {
      toast(d && d.error ? d.error : '保存失败');
    }
  }catch(err){ toast('保存失败：'+err.message); }
  ed.saving = false; edSyncState();
}

var portalMenu = null, portalBtn = null, portalHome = null;
function placePortalMenu(){
  if(!portalMenu || !portalBtn) return;
  var br = portalBtn.getBoundingClientRect();
  var mw = portalMenu.offsetWidth, mh = portalMenu.offsetHeight;
  var left = br.right - mw;
  if(left < 8) left = 8;
  if(left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
  var top;
  if(br.bottom + 8 + mh <= window.innerHeight - 8) top = br.bottom + 8;
  else top = br.top - 8 - mh;
  if(top < 8) top = 8;
  portalMenu.style.left = left + 'px';
  portalMenu.style.top = top + 'px';
  portalMenu.style.visibility = 'visible';
}
function toggleMenu(e, id) {
  e.stopPropagation();
  var d = document.getElementById('menu-' + id);
  var root = e.currentTarget.closest('.od-root');
  var wasOpen = root.classList.contains('open');
  closeAllRowMenus();
  closeGroupMenu();
  if (wasOpen) return;
  root.classList.add('open');
  portalMenu = d; portalBtn = e.currentTarget; portalHome = root;
  document.body.appendChild(d);
  d.classList.add('portal');
  d.style.display = 'block';
  d.style.visibility = 'hidden';
  placePortalMenu();
  window.addEventListener('scroll', placePortalMenu, true);
  window.addEventListener('resize', placePortalMenu);
}
function closeAllRowMenus(){
  document.querySelectorAll('.od-root.row-od.open').forEach(function(w){w.classList.remove('open');});
  if(portalMenu){
    portalMenu.classList.remove('portal');
    portalMenu.style.display = '';
    portalMenu.style.visibility = '';
    portalMenu.style.left = '';
    portalMenu.style.top = '';
    if(portalHome) portalHome.appendChild(portalMenu);
    portalMenu = null; portalBtn = null; portalHome = null;
    window.removeEventListener('scroll', placePortalMenu, true);
    window.removeEventListener('resize', placePortalMenu);
  }
}
document.addEventListener('click', function() {
  closeAllRowMenus();
  closeGroupMenu();
});
document.addEventListener('keydown', function(e) {
  if(e.key==='Escape'){ closeAllRowMenus(); closeGroupMenu(); }
});
function copyText(t){ navigator.clipboard.writeText(t).then(function(){ toast('已复制'); }).catch(function(){ toast('复制失败'); }); }

function promptReplace(id){ state.modReplaceId=id; document.getElementById('replaceFileInput').click(); }
async function refreshMod(id){ var r=await api('/api/admin/modules/'+id+'/refresh',{method:'POST'}); if(r&&r.ok){ toast('已刷新'); loadAll(); } else toast(r?r.error:'刷新失败'); }
function editMeta(id){
  var m = state.modules.find(function(x){ return x.id===id; });
  if(!m) return;
  showModal('编辑模块信息 — '+esc(m.title||m.filename),
    '<label>标题</label><input class="input" id="metaTitle" value="'+esc(m.title||'')+'">'+
    '<label>版本</label><input class="input" id="metaVersion" value="'+esc(m.version||'')+'">'+
    '<label>作者</label><input class="input" id="metaAuthor" value="'+esc(m.author||'')+'">'+
    '<label>备注</label><textarea class="textarea" id="metaNote" rows="2">'+esc(m.note||'')+'</textarea>',
    async function(close){
      var title = document.getElementById('metaTitle').value.trim();
      var version = document.getElementById('metaVersion').value.trim();
      var author = document.getElementById('metaAuthor').value.trim();
      var note = document.getElementById('metaNote').value.trim();
      var r = await api('/api/admin/modules?id='+id, {method:'PATCH', json:{title:title, version:version, author:author, note:note}});
      if(r&&r.ok){ m.title=title; m.version=version; m.author=author; m.note=note; toast('已保存'); close(); renderMods(); } else toast('保存失败');
    });
}
async function doReplaceMod(input){
  var id=state.modReplaceId; state.modReplaceId=null;
  if(!input.files.length) return;
  var fd=new FormData(); fd.append('file',input.files[0]);
  var r=await api('/api/admin/modules?id='+id,{method:'PUT',body:fd});
  if(r&&r.ok){ toast('已替换'); loadAll(); } else toast('替换失败');
  input.value='';
}

function groupOptions(sel){
  var h = '<option value="">全部</option>';
  state.groups.forEach(function(g){
    h += '<option value="'+g.id+'"'+(sel===g.id?' selected':'')+'>'+esc(g.name)+'</option>';
  });
  return h;
}
function showImportUrl(){
  showModal('从链接导入',
    '<label>模块或合集 URL</label><input class="input" id="importUrl" placeholder="https://…/widget.js 或 collection.rex">'+
    '<p class="source-stats">合集将保存为订阅源，每 6 小时同步；不自动创建或修改我的合集。</p><label>单模块文件名（可选）</label><input class="input" id="importFilename" placeholder="自动从 URL 提取">'+
    '<label>分组</label><select class="input" id="importGroup">'+groupOptions('')+'</select>',
    async function(close){
      var url = document.getElementById('importUrl').value.trim();
      if(!url){ toast('请输入 URL'); return; }
      var filename = document.getElementById('importFilename').value.trim();
      var gid = document.getElementById('importGroup').value;
      var r = await api('/api/admin/modules/import', {method:'POST', json:{url:url, filename:filename, group_id:gid}});
      if(r&&r.ok){ toast(r.kind==='source'?'已添加订阅源，后台开始同步':'已导入模块'); close(); if(r.kind==='source')state.tab='sources'; loadAll(); } else toast(r?r.error:'导入失败');
    });
}

function promptDeleteMod(id, name){
  showConfirm('确定删除 "'+name+'"？', function(ok){
    if (!ok) return;
    api('/api/admin/modules?id='+id,{method:'DELETE'}).then(function(r){
      if(r&&r.ok){ toast('已删除'); loadAll(); } else toast('删除失败');
    });
  });
}

// ===== COLLECTIONS =====
function renderCols(){
  var cs = state.collections;
  document.getElementById('colCount').textContent='共 '+cs.length+' 个合集';
  if(!cs.length){ document.getElementById('collectionsList').innerHTML='<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z"/></svg></div><p>暂无合集</p></div>'; return; }
  var h='';
  cs.forEach(function(c){
    var n = (c.moduleIds||[]).length;
    h+='<div class="card" style="padding-bottom:12px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px"><div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">';
    if(c.icon_url) h+='<img src="'+esc(c.icon_url)+'" style="width:40px;height:40px;border-radius:12px;object-fit:cover" onerror="this.remove()">';
    h+='<div style="min-width:0"><div style="font-size:16px;font-weight:600">'+esc(c.title)+'</div><div style="font-size:12px;color:var(--text2);margin-top:3px">'+n+' 个模块'+(c.autoAll?' · 自动加入新增模块':'')+(c.description?' · '+esc(c.description):'')+'</div></div></div>'+
      '<div style="display:flex;gap:2px"><button class="btn-xs" onclick="copyText(\''+org()+'/api/collections/'+encodeURIComponent(c.slug)+'.rex\')" title="复制订阅链接"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button><button class="btn-xs" onclick="showEditCol(\''+c.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button><button class="btn-xs danger" onclick="promptDeleteCol(\''+c.id+'\',\''+escJs(c.title)+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button></div></div>'+
      '<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="showPickMods(\''+c.id+'\')">+ 添加模块</button></div></div>';
  });
  document.getElementById('collectionsList').innerHTML=h;
}
function showAddCol(){
  showModal('新建合集',
    '<div style="display:flex;gap:10px"><div style="flex:1"><label>标题</label><input class="input" id="colTitle" placeholder="合集名称"></div>'+
    '<div style="flex:1"><label>路径</label><input class="input" id="colSlug" placeholder="mysub"></div></div>'+
    '<label>描述</label><input class="input" id="colDesc" placeholder="可选">'+
    '<label>图标 URL</label><input class="input" id="colIcon" placeholder="可选，https://...">',
    function(close){
      var slug=document.getElementById('colSlug').value.trim();
      var title=document.getElementById('colTitle').value.trim();
      if(!/^[A-Za-z0-9]+$/.test(slug)){ toast('路径只能填英文字母和数字'); return; }
      if(!title){ toast('请输入标题'); return; }
      api('/api/admin/collections',{method:'POST',json:{slug:slug,title:title,description:document.getElementById('colDesc').value.trim(),icon_url:document.getElementById('colIcon').value.trim()}}).then(function(r){
        if(r&&r.ok){ toast('合集已创建'); close(); loadAll(); } else toast('创建失败：'+((r&&r.error)||''));
      });
    });
}

function showEditCol(id){
  var col = state.collections.find(function(c){ return c.id===id; });
  if(!col) return;
  showModal('编辑合集',
    '<div style="display:flex;gap:10px"><div style="flex:1"><label>标题</label><input class="input" id="colTitle" value="'+esc(col.title)+'"></div>'+
    '<div style="flex:1"><label>路径</label><input class="input" id="colSlug" value="'+esc(col.slug)+'"></div></div>'+
    '<label>描述</label><input class="input" id="colDesc" value="'+esc(col.description||'')+'">'+
    '<label>图标 URL</label><input class="input" id="colIcon" value="'+esc(col.icon_url||'')+'">'+
    '<label><input type="checkbox" id="colAutoAll"'+(col.autoAll?' checked':'')+'> 自动加入全部模块</label>'+
    '<p style="font-size:12px;color:var(--text2)">修改路径后，旧订阅地址仍然有效。</p>',
    function(close){
      var slug=document.getElementById('colSlug').value.trim();
      var title=document.getElementById('colTitle').value.trim();
      if(slug!==col.slug && !/^[A-Za-z0-9]+$/.test(slug)){ toast('新路径只能填英文字母和数字；旧路径可保持不变'); return; }
      if(!title){ toast('请输入标题'); return; }
      api('/api/admin/collections',{method:'PATCH',json:{id:id,slug:slug,title:title,autoAll:document.getElementById('colAutoAll').checked,description:document.getElementById('colDesc').value.trim(),icon_url:document.getElementById('colIcon').value.trim()}}).then(function(r){
        if(r&&r.ok){ toast('已更新'); close(); loadAll(); } else toast('更新失败：'+((r&&r.error)||''));
      });
    });
}

function showPickMods(colId){
  var col = state.collections.find(function(c){ return c.id===colId; });
  if(!col) return;
  if(!state.modules.length){ toast('请先上传模块'); return; }
  var modIds = col.moduleIds || [];
  var pickTab = '', pickQ = '';

  function pickRow(m){
    var ck = modIds.indexOf(m.id)>=0 ? ' checked' : '';
    var encBadge = m.is_encrypted ? '<span class="badge '+(m.source_url?'badge-green':'badge-orange')+'" style="flex-shrink:0">加密</span>' : '';
    return '<div class="pick-item'+ck+'" data-mid="'+m.id+'" onclick="window._pickToggle(this)"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(m.title||m.filename)+'</span>'+encBadge+'<span style="font-size:11px;color:var(--text3);flex-shrink:0">'+fmt(m.file_size)+'</span></div>';
  }
  function filteredList(){
    return state.modules.filter(function(m){
      if(pickTab && m.group_id!==pickTab) return false;
      if(pickQ && ((m.title||'')+' '+(m.filename||'')).toLowerCase().indexOf(pickQ)<0) return false;
      return true;
    });
  }
  function renderPickBody(){
    var listEl = document.getElementById('pickModList');
    if(!listEl) return;
    var list = filteredList(), h = '';
    // 全部平铺，tab 已经负责分组过滤
    list.forEach(function(m){ h += pickRow(m); });
    if(!list.length) h = '<div style="text-align:center;color:var(--text3);padding:30px;font-size:13px">没有匹配的模块</div>';
    listEl.innerHTML = h;
    // 恢复已选状态（切换 tab/搜索后）
    var cur = {};
    (col._pickSel || modIds).forEach(function(id){ cur[id]=1; });
    listEl.querySelectorAll('.pick-item').forEach(function(el){
      if(cur[el.dataset.mid]) el.classList.add('checked');
    });
    updatePickCount();
  }
  function renderPickTabs(){
    var tabs = document.getElementById('pickModTabs');
    if(!tabs) return;
    var h = '<div class="ftab'+(pickTab===''?' active':'')+'" data-ptab="" style="font-size:12px;padding:7px 12px">全部<span class="cnt">'+state.modules.length+'</span></div>';
    state.groups.forEach(function(g){
      var n = state.modules.filter(function(m){return m.group_id===g.id}).length;
      h += '<div class="ftab'+(pickTab===g.id?' active':'')+'" data-ptab="'+g.id+'" style="font-size:12px;padding:7px 12px">'+esc(g.name)+'<span class="cnt">'+n+'</span></div>';
    });
    tabs.innerHTML = h;
    tabs.querySelectorAll('.ftab').forEach(function(t){
      t.onclick = function(){ pickTab = t.dataset.ptab; renderPickTabs(); renderPickBody(); toggleSelectAllBtn(); };
    });
  }
  function toggleSelectAllBtn(){
    var el = document.getElementById('pickSelectAllRow');
    if(el) el.style.display = pickTab ? 'flex' : 'none';
  }
  function updatePickCount(){
    var n = (col._pickSel || []).length;
    var e = document.getElementById('pickSelCount');
    if(e) e.textContent = n;
  }
  function syncSel(){
    var sel = [];
    document.querySelectorAll('#pickModList .pick-item.checked').forEach(function(el){ sel.push(el.dataset.mid); });
    // 合并：保留不在当前列表中的已选项
    var visible = {};
    filteredList().forEach(function(m){ visible[m.id]=1; });
    var keep = (col._pickSel||[]).filter(function(id){ return !visible[id]; });
    col._pickSel = keep.concat(sel.filter(function(id){ return keep.indexOf(id)<0; }));
    updatePickCount();
  }
  window._pickSearch = function(v){ syncSel(); pickQ = (v||'').toLowerCase().trim(); renderPickBody(); };
  window._pickSelectAll = function(sel){
    var listEl = document.getElementById('pickModList');
    if(!listEl) return;
    listEl.querySelectorAll('.pick-item').forEach(function(el){ el.classList.toggle('checked', sel); });
    syncSel(); renderPickBody();
  };
  window._pickToggle = function(el){ el.classList.toggle('checked'); syncSel(); };

  var body = ''
    + '<span class="ios-search" style="width:100%;margin:8px 0 10px"><svg class="ios-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input class="ios-search-input" id="pickModSearch" type="text" placeholder="Search…" oninput="onPickSearch(this)"><button class="ios-search-x" id="pickSearchX" onclick="clearPickSearch()" aria-label="清除搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>'
    + '<div id="pickModTabs" class="folder-tabs" style="padding:0 0 10px"></div>'
    + '<div id="pickSelectAllRow" style="display:none;margin-bottom:8px;align-items:center">'
    + '<span style="font-size:12px;color:var(--text2)">已选 <b id="pickSelCount">0</b> 个</span><span style="flex:1"></span>'
    + '<button onclick="window._pickSelectAll(true)" style="background:none;border:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 8px;font-family:inherit">全选本组</button>'
    + '<button onclick="window._pickSelectAll(false)" style="background:none;border:none;color:var(--text2);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 8px;font-family:inherit">全不选</button></div>'
    + '<div class="pick-list" id="pickModList" style="max-height:40vh;overflow-y:auto"></div>';
  col._pickSel = modIds.slice();
  showModal('挑选模块 — '+esc(col.title), body, function(close){
    syncSel();
    var ids = col._pickSel;
    api('/api/admin/collections',{method:'PATCH',json:{id:colId,moduleIds:ids}}).then(function(r){
      col._pickSel = null;
      if(r&&r.ok){ col.moduleIds = ids; toast('已更新'); close(); loadAll(); } else toast('更新失败');
    });
  });
  renderPickTabs(); renderPickBody(); toggleSelectAllBtn(); updatePickCount();
}


function promptDeleteCol(id, name){
  showConfirm('确定删除合集 "'+name+'"？（模块文件不受影响）', function(ok){
    if (!ok) return;
    api('/api/admin/collections?id='+id,{method:'DELETE'}).then(function(r){
      if(r&&r.ok){ toast('已删除'); loadAll(); } else toast('删除失败');
    });
  });
}

// ===== SETTINGS =====
function renderSettings(){var tm=0,ts=0;state.modules.forEach(function(m){tm++;ts+=m.file_size||0;});
  document.getElementById('statCols').textContent=state.collections.length;
  document.getElementById('statMods').textContent=tm;
  document.getElementById('statSize').textContent=fmt(ts);
}

function getThemePref(){try{return localStorage.getItem('fwh_theme')||'auto';}catch(e){return 'auto';}}
function sysIsDark(){try{return window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches;}catch(e){return false;}}
function applyThemeClass(){var pref=getThemePref(),root=document.documentElement;root.classList.remove('dark');root.classList.remove('light');if(pref==='dark')root.classList.add('dark');else if(pref==='light')root.classList.add('light');else if(sysIsDark())root.classList.add('dark');}
function toggleTheme(){var pref=getThemePref();var next=pref==='dark'?'light':(pref==='light'?'auto':'dark');try{localStorage.setItem('fwh_theme',next);}catch(e){}applyThemeClass();updateThemeIcon();}
function updateThemeIcon(){var btn=document.getElementById('btnThemeToggle');if(!btn)return;var pref=getThemePref();btn.textContent=pref==='dark'?'\u{1F319}':(pref==='light'?'\u2600\uFE0F':'\u{1F313}');}
try{var _mq=window.matchMedia?matchMedia('(prefers-color-scheme:dark)'):null;if(_mq){var _onSys=function(){if(getThemePref()==='auto'){applyThemeClass();updateThemeIcon();}};if(_mq.addEventListener)_mq.addEventListener('change',_onSys);else if(_mq.addListener)_mq.addListener(_onSys);}}catch(e){}

function exportData(){
  showPrompt('导出备份', 'fwh-backup-' + new Date().toISOString().slice(0,10), async function(filename) {
    if (!filename) return;
    try {
      var r = await fetch(org()+'/api/admin/backup', {credentials:'same-origin'});
      if(!r.ok){ toast('导出失败，未生成不完整备份'); return; }
      var blob = await r.blob();
      var link = URL.createObjectURL(blob), a = document.createElement('a');
      a.href=link; a.download=filename+'.json'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(link); }, 1000);
      toast('已导出，模块 ID、订阅路径和加密文件完整保留');
    } catch(e){ toast('导出失败：'+e.message); }
  });
}
function importBackup(){
  var input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=async function(){
    if(!input.files.length) return;
    try{
      var data=JSON.parse(await input.files[0].text());
      if(!data.files){ toast('无效的备份文件'); return; }
      if(!await showConfirmAsync('将按原 ID 恢复模块、合集和订阅源，保留订阅地址。相同 ID 的内容将被覆盖；路径或来源身份冲突会中止恢复。确认？')) return;
      var r=await api('/api/admin/backup/restore',{method:'POST',json:data});
      if(r&&r.ok){ toast('已恢复 '+r.modules+' 个模块、'+r.collections+' 个合集'); loadAll(); }
      else toast((r&&r.error)||'恢复失败');
    }catch(e){ toast('恢复失败：'+e.message); }
  };
  input.click();
}

async function changePassword(){
  var pwd = document.getElementById('pwdNew').value.trim();
  if (!pwd) { toast('请输入密码'); return; }
  if (pwd.length < 8) { toast('密码至少 8 位'); return; }
  var r = await api('/api/admin/change-password', {method:'POST', json:{password:pwd}});
  if (r && r.ok) { toast('密码已修改，下次登录生效'); document.getElementById('pwdNew').value = ''; }
  else toast(r ? r.error : '修改失败');
}


function clearAllData(){
  showConfirm('确定清除所有模块、合集和订阅源？此操作不可撤销！', function(ok){
    if (!ok) return;
    showConfirm('再次确认：将删除所有数据', function(ok2){
      if (!ok2) return;
      api('/api/admin/reset',{method:'POST'}).then(function(r){
        if(r && r.ok){ toast('已清除'); state.modules=[]; state.collections=[]; state.groups=[]; loadAll(); }
        else toast((r&&r.error)||'清除失败');
      });
    });
  });
}

// ===== MODAL =====
function showModal(t,b,oc){
  var o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML='<div class="modal"><h3>'+t+'</h3><div class="desc"></div>'+b+'<div class="btn-row"><button class="btn" id="mc">取消</button><button class="btn btn-primary" id="mC">确认</button></div></div>';
  document.body.appendChild(o);
  function cl(){o.remove();}
  o.addEventListener('click',function(e){if(e.target===o)cl();});
  o.querySelector('#mc').addEventListener('click',cl);
  o.querySelector('#mC').addEventListener('click',function(){oc(cl);});
}

function showConfirm(msg, onOk) {
  var o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML='<div class="modal"><h3>确认</h3><p style="margin:8px 0;line-height:1.5">'+msg+'</p><div class="btn-row"><button class="btn" id="mc">取消</button><button class="btn btn-primary" id="mC">确认</button></div></div>';
  document.body.appendChild(o);
  var done = false;
  function cl(r){ if(done)return; done=true; o.remove(); onOk(r); }
  o.addEventListener('click',function(e){if(e.target===o)cl(false);});
  o.querySelector('#mc').addEventListener('click',function(){cl(false);});
  o.querySelector('#mC').addEventListener('click',function(){cl(true);});
}
function showConfirmAsync(msg) {
  return new Promise(function(resolve) { showConfirm(msg, resolve); });
}

var _scrLockY = 0, _scrLocked = false;
function _anyModalOpen(){
  if (document.querySelector('.modal-overlay')) return true;
  var ms = document.querySelectorAll('.modal-mask');
  for (var i = 0; i < ms.length; i++) { if (ms[i].style.display && ms[i].style.display !== 'none') return true; }
  return false;
}
function syncScrollLock(){
  var open = _anyModalOpen();
  if (open && !_scrLocked) {
    _scrLocked = true;
    _scrLockY = window.scrollY || 0;
    var b = document.body.style;
    b.position = 'fixed'; b.top = (-_scrLockY) + 'px'; b.left = '0'; b.right = '0'; b.overflow = 'hidden';
  } else if (!open && _scrLocked) {
    _scrLocked = false;
    var b2 = document.body.style;
    b2.position = ''; b2.top = ''; b2.left = ''; b2.right = ''; b2.overflow = '';
    window.scrollTo(0, _scrLockY);
  }
}
new MutationObserver(syncScrollLock).observe(document.body, { childList: true });

function showPrompt(title, def, cb) {
  var o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML='<div class="modal"><h3>'+title+'</h3><input class="input" id="promptInput" value="'+esc(def)+'" style="margin:8px 0"><div class="btn-row"><button class="btn" id="mc">取消</button><button class="btn btn-primary" id="mC">确认</button></div></div>';
  document.body.appendChild(o);
  var done = false;
  function cl(v){ if(done)return; done=true; o.remove(); cb(v); }
  o.addEventListener('click',function(e){if(e.target===o)cl(null);});
  o.querySelector('#mc').addEventListener('click',function(){cl(null);});
  o.querySelector('#mC').addEventListener('click',function(){cl(o.querySelector('#promptInput').value);});
}


(function(){
  try{
    var c=JSON.parse(localStorage.getItem('fwh_cache_v1')||'null');
    if(c && Array.isArray(c.modules) && c.modules.length){
      state.modules=c.modules; state.collections=c.collections||[]; state.groups=c.groups||[];
    }
  }catch(e){}
})();
${SOURCE_UI}
checkAuth();
</script>
</body>
</html>`;


const MAX_FILE_BYTES   = 25 * 1024 * 1024; // KV 单值上限
const MAX_SOURCE_BYTES = 3 * 1024 * 1024;  // 在线编辑器允许的最大源码
const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 从 URL 导入时的响应体上限
const PBKDF2_ITER      = 100000;
// 单次上传文件数上限。每个文件占 1 次 KV put 子请求，再叠加 nextSortOrder / DB.batch
// 与引导期往返，都是 1 次；免费版单请求子请求上限 50，取 45 留余量。
const MAX_UPLOAD_FILES = 45;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS modules (
     id TEXT PRIMARY KEY,
     filename TEXT NOT NULL,
     widget_id TEXT,
     title TEXT,
     version TEXT,
     author TEXT,
     file_size INTEGER DEFAULT 0,
     is_encrypted INTEGER DEFAULT 0,
     source_url TEXT,
     note TEXT,
     group_id TEXT DEFAULT '',
     sort_order INTEGER DEFAULT 0,
     legacy_json TEXT DEFAULT '{}',
     created_at INTEGER,
     updated_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS groups (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     position INTEGER DEFAULT 0,
     created_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_groups_position ON groups(position)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_sort ON modules(sort_order, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_group ON modules(group_id)`,
  `CREATE TABLE IF NOT EXISTS collections (
     id TEXT PRIMARY KEY,
     slug TEXT UNIQUE NOT NULL,
     title TEXT NOT NULL,
     description TEXT DEFAULT '',
     icon_url TEXT DEFAULT '',
     auto_all INTEGER DEFAULT 0,
     legacy_json TEXT DEFAULT '{}',
     created_at INTEGER,
     updated_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_collections_created ON collections(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS collection_modules (
     collection_id TEXT NOT NULL,
     module_id TEXT NOT NULL,
     position INTEGER DEFAULT 0,
     PRIMARY KEY (collection_id, module_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cm_collection ON collection_modules(collection_id, position)`,
  `CREATE TABLE IF NOT EXISTS collection_aliases (
     slug TEXT PRIMARY KEY,
     collection_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     created_at INTEGER,
     expires_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT
   )`
];

async function ensureSchema(env) {
  await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql)));
  await env.DB.batch(SOURCE_SCHEMA.map(sql => env.DB.prepare(sql)));
  for (const sql of [
    "ALTER TABLE modules ADD COLUMN group_id TEXT DEFAULT ''",
    "ALTER TABLE modules ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE modules ADD COLUMN legacy_json TEXT DEFAULT '{}'",
    "ALTER TABLE collections ADD COLUMN auto_all INTEGER DEFAULT 0",
    "ALTER TABLE collections ADD COLUMN legacy_json TEXT DEFAULT '{}'"
  ]) {
    try { await env.DB.prepare(sql).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
}

const BOOT = new WeakMap();
export async function bootstrap(env) {
  if (!BOOT.has(env.DB)) {
    const ready = (async () => {
      await ensureSchema(env);
      // Never mark a failed/partial migration as complete.
      await migrateLegacyKV(env);
      await migrateSortOrder(env.DB);
      if (!env.PRESERVE_LEGACY_ENCRYPTION) await autoMaintain(env, env.DB);
    })();
    BOOT.set(env.DB, ready);
  }
  try { await BOOT.get(env.DB); }
  catch (e) { BOOT.delete(env.DB); throw e; }
}

async function migrateLegacyKV(env) {
  const flag = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('migrated_v1').first();
  if (flag) return { skipped: true };

  const legacyMods = await env.KV.get('modules', 'json') || [];
  const legacyCols = await env.KV.get('collections', 'json') || [];
  if (!Array.isArray(legacyMods) || !Array.isArray(legacyCols)) throw new Error('旧数据格式异常，已停止迁移');
  const modules = new Map(legacyMods.filter(m => m && m.id).map(m => [m.id, m]));
  // Earlier backups may embed the module records in a collection.
  for (const c of legacyCols) {
    for (const m of (Array.isArray(c.modules) ? c.modules : [])) if (m?.id && !modules.has(m.id)) modules.set(m.id, m);
  }

  const stmts = [];
  let modCount = 0, colCount = 0, linkCount = 0;

  {
    for (const m of modules.values()) {
      const file = await env.KV.get('file:' + m.id, 'arrayBuffer');
      if (!file) throw new Error('旧模块缺少文件：' + m.id + '；原数据库未改动');
      // Match the old subscription fallback exactly (including its 2 KiB
      // parser), so an upgrade cannot silently change the client's widget ID.
      const parsed = !m.is_encrypted ? parseMeta(m.filename || '', new Uint8Array(file.slice(0, 2048)), true) : {};
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO modules
           (id, filename, widget_id, title, version, author, file_size, is_encrypted, source_url, note, sort_order, group_id, legacy_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        m.id, m.filename || '', (!m.widget_id || m.widget_id === m.id) ? (parsed.id || m.id) : m.widget_id, m.title || '', m.version || '',
        m.author || '', file.byteLength, m.is_encrypted ? 1 : 0,
        m.source_url || null, m.note || '',
        modCount, m.group_id || '', JSON.stringify(m),
        m.created_at || Date.now(), m.updated_at || Date.now()
      ));
      modCount++;
    }
  }

  if (Array.isArray(legacyCols)) {
    for (const c of legacyCols) {
      if (!c || !c.id) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO collections (id, slug, title, description, icon_url, auto_all, legacy_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(c.id, c.slug || c.id, c.title || 'untitled', c.description || '',
             c.icon_url || '', c.autoAll ? 1 : 0, JSON.stringify(c), c.created_at || Date.now(), c.updated_at || Date.now()));
      colCount++;
      const ids = c.moduleIds?.length ? c.moduleIds : (Array.isArray(c.modules) ? c.modules.map(x => x.id) : []);
      ids.forEach((mid, i) => {
        if (!mid) return;
        stmts.push(env.DB.prepare(
          'INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position) VALUES (?,?,?)'
        ).bind(c.id, mid, i));
        linkCount++;
      });
    }
  }

  const oldPassword = await env.KV.get('admin_password');
  if (oldPassword) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .bind('admin_password', 'legacy-sha256$' + oldPassword));
  for (const key of ['settings', 'subscribers']) {
    const value = await env.KV.get(key);
    if (value) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('legacy_' + key, value));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind('migrated_v1', String(Date.now())).run();

  return { skipped: false, modules: modCount, collections: colCount, links: linkCount };
}


// ===== 登录限流 =====
const LOGIN_STORES = new WeakMap();
const LOGIN_WINDOW = 300000;
const LOGIN_MAX_TRY = 5;
const LOGIN_MAP_CAP = 5000;
function loginStore(DB) {
  if (!LOGIN_STORES.has(DB)) LOGIN_STORES.set(DB, new Map());
  return LOGIN_STORES.get(DB);
}
function _loginAllowed(ip, DB) {
  const _loginAttempts = loginStore(DB);
  const now = Date.now();
  if (_loginAttempts.size > LOGIN_MAP_CAP) {
    for (const [k, v] of _loginAttempts) { if (now > v.resetAt) _loginAttempts.delete(k); }
    if (_loginAttempts.size > LOGIN_MAP_CAP) _loginAttempts.clear();
  }
  const rec = _loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) { _loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW }); return true; }
  rec.count++;
  return rec.count <= LOGIN_MAX_TRY;
}


const ENC_HEURISTIC_V = '2';
async function nextSortOrder(DB){
  try{
    const r = await DB.prepare('SELECT COALESCE(MIN(sort_order), 0) - 1 AS m FROM modules').first();
    const v = r ? Number(r.m) : -1;
    return Number.isFinite(v) ? v : -1;
  }catch(e){ return -1; }
}

async function migrateSortOrder(DB) {
  const flag = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('sort_order_v1').first();
  if (!flag) {
    const { results } = await DB.prepare('SELECT id FROM modules WHERE sort_order IS NULL ORDER BY created_at DESC').all();
    const list = results || [];
    for (let i = 0; i < list.length; i += 100) {
      await DB.batch(list.slice(i, i + 100).map((r, k) =>
        DB.prepare('UPDATE modules SET sort_order = ? WHERE id = ?').bind(i + k, r.id)));
    }
    await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('sort_order_v1', String(Date.now())).run();
  }
}

const MAINT_READY = new WeakSet();
const MAINT_BATCH = 8;
const MAINT_MAX_BYTES = 1024 * 1024;
const ENC_FLAG_KEY = 'enc_heuristic_v';
const ENC_CURSOR_KEY = 'enc_scan_cursor';
async function autoMaintain(env, DB) {
  if (MAINT_READY.has(DB)) return;
  MAINT_READY.add(DB);
  const flag = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(ENC_FLAG_KEY).first();
  if (flag && flag.value === ENC_HEURISTIC_V) return;

  // 每轮只扫一批、按 id 游标推进，扫完一轮才落最终标记。
  // 只取 1 MB 以内的模块：判定只需文件头 32 字节，而 KV 不支持按范围读，
  // 大文件整块读会顶到 isolate 的 128 MB 内存上限，也会瞬间打满子请求配额。
  const cur = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(ENC_CURSOR_KEY).first();
  const after = cur && cur.value ? String(cur.value) : '';
  const { results } = await DB.prepare(
    'SELECT id, is_encrypted FROM modules WHERE id > ? AND file_size <= ? ORDER BY id LIMIT ?'
  ).bind(after, MAINT_MAX_BYTES, MAINT_BATCH).all();
  const list = results || [];

  if (!list.length) {
    await DB.batch([
      DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(ENC_CURSOR_KEY, ''),
      DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(ENC_FLAG_KEY, ENC_HEURISTIC_V)
    ]);
    return;
  }

  const bufs = await Promise.all(list.map(r =>
    env.KV.get('file:' + r.id, 'arrayBuffer').catch(() => null)));
  const stmts = [];
  list.forEach((r, k) => {
    const buf = bufs[k];
    if (!buf) return;
    const enc = isEncrypted(new Uint8Array(buf));
    if (Number(r.is_encrypted) === enc) return;
    stmts.push(DB.prepare('UPDATE modules SET is_encrypted = ?, updated_at = ? WHERE id = ?')
      .bind(enc, Date.now(), r.id));
  });
  stmts.push(DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind(ENC_CURSOR_KEY, list[list.length - 1].id));
  await DB.batch(stmts);
}

// ===== KV 文件读写 =====
function putFile(env, id, buf, updatedAt) {
  const size = typeof buf.byteLength === 'number' ? buf.byteLength : (buf.length || 0);
  return env.KV.put('file:' + id, buf, { metadata: { u: updatedAt || Date.now(), s: size } });
}

// ===== 密码哈希（PBKDF2-SHA256） =====
function toHex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) {
  const a = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function pbkdf2Hex(password, saltU8, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltU8, iterations: iter, hash: 'SHA-256' }, key, 256);
  return toHex(new Uint8Array(bits));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2Hex(password, salt, PBKDF2_ITER);
  return 'pbkdf2$' + PBKDF2_ITER + '$' + toHex(salt) + '$' + h;
}
async function verifyPassword(password, stored, envPassword) {
  if (typeof password !== 'string') return false;
  if (stored && stored.startsWith('legacy-sha256$')) {
    return safeEqualHex(await sha256(password), stored.slice('legacy-sha256$'.length));
  }
  if (stored && stored.indexOf('pbkdf2$') === 0) {
    const p = stored.split('$');
    if (p.length !== 4) return false;
    const iter = parseInt(p[1], 10) || PBKDF2_ITER;
    const h = await pbkdf2Hex(password, hexToBytes(p[2]), iter);
    return safeEqualHex(h, p[3]);
  }
  const expected = await sha256(stored || envPassword || '');
  return safeEqualHex(await sha256(password), expected);
}

// ===== 外部 URL 抓取 =====
const MAX_REDIRECTS = 5;
function isBlockedHost(hostname) {
  let h = String(hostname || '').toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  // IPv6 字面量一律拒绝：覆盖 [::1]、[::ffff:127.0.0.1] 等写法
  if (h.indexOf(':') >= 0) return true;
  // 纯数字主机：十进制 / 八进制 / 十六进制形式的 IP（如 2130706433、0177.0.0.1）
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  if (/^0\d/.test(m[1]) || /^0\d/.test(m[2]) || /^0\d/.test(m[3]) || /^0\d/.test(m[4])) return true;
  const a = +m[1], b = +m[2];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
function assertFetchableUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('URL 格式不合法'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('只支持 http/https');
  if (isBlockedHost(u.hostname)) throw new Error('不允许的地址');
  return u;
}
async function fetchCapped(rawUrl, maxBytes, transport = globalThis.fetch) {
  const file = await fetchRemote(rawUrl, maxBytes, { transport });
  assertModuleFile(file.bytes, file.contentType);
  return file.bytes.buffer;
}

// ===== 响应工具 =====
function htmlHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy': "default-src 'self'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!env.ALLOW_HTTP && url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    const cookieSecure = !env.ALLOW_HTTP || url.protocol === 'https:' ? '; Secure' : '';


    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (!env.DB) {
      return json({ error: '未绑定 D1：请在 Worker 的 Settings → Bindings 添加 D1 Database，变量名填 DB' }, 500);
    }

    if (!env.KV) {
      return json({ error: '未绑定 KV：请在 Worker 的 Settings → Bindings 添加 KV Namespace，变量名填 KV' }, 500);
    }

    try {
      await bootstrap(env);
    } catch (e) {
      return json({ error: '数据库初始化失败：' + String((e && e.message) || e) }, 500);
    }

    const DB = env.DB;

    try {


    async function adminPasswordRow() {
      return await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_password').first();
    }

    async function verifyAuth(r) {
      const m = (r.headers.get('Cookie') || '').match(/fwh_admin=([^;]+)/);
      if (!m) return false;
      const row = await DB.prepare('SELECT expires_at FROM sessions WHERE token = ?').bind(m[1]).first();
      if (!row) return false;
      if (Number(row.expires_at) < Date.now()) {
        await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1]).run();
        return false;
      }
      return true;
    }


    async function getModules() {
      const { results } = await DB.prepare(`SELECT m.*,
        (SELECT COUNT(*) FROM source_items i WHERE i.module_id=m.id) AS source_count,
        CASE WHEN EXISTS(SELECT 1 FROM source_items i WHERE i.module_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM source_items i WHERE i.module_id=m.id AND i.removed_at IS NULL) THEN 1 ELSE 0 END AS is_removed,
        (SELECT GROUP_CONCAT(DISTINCT s.title) FROM sources s JOIN source_items i ON i.source_id=s.id WHERE i.module_id=m.id) AS source_names
        FROM modules m ORDER BY sort_order ASC, created_at DESC`).all();
      return (results || []).map(r => ({ ...JSON.parse(r.legacy_json || '{}'), ...r, is_encrypted: Number(r.is_encrypted) || 0 }));
    }
    async function getModule(id) {
      const r = await DB.prepare('SELECT * FROM modules WHERE id = ?').bind(id).first();
      return r ? { ...r, is_encrypted: Number(r.is_encrypted) || 0 } : null;
    }
    async function getCollections() {
      const { results: cols } = await DB.prepare('SELECT * FROM collections ORDER BY created_at DESC').all();
      const { results: links } = await DB.prepare(
        'SELECT collection_id, module_id FROM collection_modules ORDER BY collection_id, position'
      ).all();
      const map = {};
      for (const l of (links || [])) {
        (map[l.collection_id] = map[l.collection_id] || []).push(l.module_id);
      }
      return (cols || []).map(c => ({ ...JSON.parse(c.legacy_json || '{}'), ...c, autoAll: !!c.auto_all, moduleIds: map[c.id] || [] }));
    }

    async function ensureUniqueSlug(base, excludeId) {
      let slug = base, n = 2;
      while (true) {
        const hit = await DB.prepare('SELECT id FROM collections WHERE slug = ?').bind(slug).first();
        const taken = hit && (!excludeId || hit.id !== excludeId);
        const alias = taken ? null
          : await DB.prepare('SELECT collection_id FROM collection_aliases WHERE slug = ?').bind(slug).first();
        if (!taken && (!alias || alias.collection_id === excludeId)) return slug;
        slug = base + '-' + n++;
      }
    }
    async function findCollectionBySlug(rawSlug) {
      const candidates = [];
      try {
        const decoded = decodeURIComponent(rawSlug);
        if (decoded !== rawSlug) candidates.push(decoded);
      } catch (e) {  }
      candidates.push(rawSlug);
      for (const s of candidates) {
        const row = await DB.prepare('SELECT * FROM collections WHERE slug = ?').bind(s).first();
        if (row) return row;
      }

      for (const s of candidates) {
        const a = await DB.prepare('SELECT collection_id FROM collection_aliases WHERE slug = ?').bind(s).first();
        if (a) {
          const row = await DB.prepare('SELECT * FROM collections WHERE id = ?').bind(a.collection_id).first();
          if (row) return row;
        }
      }
      return null;
    }
    async function setCollectionModules(colId, ids) {
      if (!Array.isArray(ids)) throw new Error('moduleIds must be an array');
      const list = ids.filter(Boolean);
      for (const id of list) if (!await getModule(id)) throw new Error('合集引用不存在的模块：' + id);
      await DB.prepare('DELETE FROM collection_modules WHERE collection_id = ?').bind(colId).run();
      for (let i = 0; i < list.length; i += 100) {
        await DB.batch(list.slice(i, i + 100).map((mid, k) =>
          DB.prepare('INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position) VALUES (?,?,?)')
            .bind(colId, mid, i + k)));
      }
    }


    if (path === '/api/admin/auth') {
      if (method === 'GET') {
        return json({ enabled: !!(env.ADMIN_PASSWORD || await adminPasswordRow()), authenticated: await verifyAuth(request) });
      }
      if (method === 'POST') {
        const _ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!_loginAllowed(_ip, DB)) return json({ error: '尝试次数过多，请 5 分钟后再试' }, 429);
        const { password } = await request.json().catch(() => ({}));
        if (!password) return json({ error: '密码不能为空' }, 400);
        const prow = await adminPasswordRow();
        const stored = (prow && prow.value) ? prow.value : '';
        if (!(await verifyPassword(password, stored, env.ADMIN_PASSWORD))) {
          return json({ error: '密码错误' }, 401);
        }
        if (!stored || stored.indexOf('pbkdf2$') !== 0) {
          try {
            await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
              .bind('admin_password', await hashPassword(password)).run();
          } catch (e) {}
        }
        const token = genId() + genId().replace(/-/g, '');
        const now = Date.now(), exp = now + 86400000 * 7;
        await DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
        await DB.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)')
          .bind(token, now, exp).run();
        if (stored.startsWith('legacy-sha256$')) {
          await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
            .bind('admin_password', await hashPassword(password)).run();
        }
        loginStore(DB).delete(_ip);
        return json({ ok: true }, 200, {
          'Set-Cookie': 'fwh_admin=' + token + '; Path=/; HttpOnly' + cookieSecure + '; SameSite=Strict; Max-Age=' + (86400 * 7)
        });
      }
    }


    if (path === '/api/admin/migrate') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const flag = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('migrated_v1').first();
      if (method === 'GET') {
        const { results } = await DB.prepare('SELECT COUNT(*) AS n FROM modules').all();
        return json({
          migrated: !!flag,
          migratedAt: flag ? Number(flag.value) : null,
          modulesInD1: (results && results[0] && results[0].n) || 0
        });
      }
      if (method === 'POST') {
        return json({ ok: true, report: { skipped: true, message: '启动时已完成迁移，无需重复导入旧数据' } });
      }
    }

    if (path === '/api/admin/backup' && method === 'GET') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      return json(await exportBackup(env), 200, { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="fwh-backup.json"' });
    }
    if (path === '/api/admin/backup/restore' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      try {
        return json(await restoreBackup(env, await request.json(), parseMeta, isEncrypted));
      } catch (e) { return json({ error: e.message }, 400); }
    }


    if (path === '/api/admin/sources') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method === 'GET') return json(await listSources(DB));
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try { return json(await registerSource(DB, body.url, body.title), 201); }
        catch (e) { return json({ error: e.message }, 400); }
      }
      const id = url.searchParams.get('id');
      const source = await DB.prepare('SELECT * FROM sources WHERE id=?').bind(id || '').first();
      if (!source) return json({ error: '订阅源不存在' }, 404);
      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        if (body.enabled === undefined) return json({ error: 'enabled required' }, 400);
        await DB.prepare("UPDATE sources SET enabled=?,status=?,generation=generation+1,next_sync_at=0,updated_at=? WHERE id=?")
          .bind(body.enabled ? 1 : 0, body.enabled ? 'queued' : 'paused', Date.now(), id).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        // Detach only; preserve module files, IDs and all personal collections.
        const { results: linked } = await DB.prepare('SELECT DISTINCT module_id FROM source_items WHERE source_id=? AND module_id IS NOT NULL').bind(id).all();
        await DB.prepare('DELETE FROM source_items WHERE source_id=?').bind(id).run();
        await DB.prepare('DELETE FROM sources WHERE id=?').bind(id).run();
        for (const item of linked) {
          const remaining = await DB.prepare('SELECT url FROM source_items WHERE module_id=? ORDER BY removed_at LIMIT 1').bind(item.module_id).first();
          // Keep the last download URL as provenance, not an active schedule.
          // Re-adding the same source/URL can then reuse its existing module ID.
          await DB.prepare('UPDATE modules SET source_url=COALESCE(?,source_url) WHERE id=?').bind(remaining?.url || null, item.module_id).run();
        }
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    }
    const sourceRefresh = path.match(/^\/api\/admin\/sources\/([^/]+)\/refresh$/);
    if (sourceRefresh) {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const source = await DB.prepare('SELECT * FROM sources WHERE id=?').bind(sourceRefresh[1]).first();
      if (!source) return json({ error: '订阅源不存在' }, 404);
      if (source.status === 'syncing' || source.status === 'queued') return json({ ok: true, queued: true }, 202);
      await DB.prepare("UPDATE sources SET enabled=1,status='queued',generation=generation+1,next_sync_at=0 WHERE id=?").bind(source.id).run();
      return json({ ok: true, queued: true }, 202);
    }

    if (path === '/api/admin/modules/import') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await request.json().catch(() => ({}));
      if (!body.url) return json({ error: 'url required' }, 400);
      const now = Date.now();
      let filename = body.filename || '';
      try {
        // Known collection URLs queue background sync immediately. Other URLs
        // are detected by their body rather than being saved as a fake .js file.
        if (/\.(?:rex|fwd)$/i.test(new URL(body.url).pathname)) {
          return json(await registerSource(DB, body.url), 201);
        }
        if (!filename) {
          const u = assertFetchableUrl(body.url);
          filename = u.pathname.split('/').pop() || 'import.js';
        }
        if (!/\.js$/i.test(filename)) filename += '.js';
        const file = await fetchRemote(body.url, MAX_IMPORT_BYTES, { transport: env.REMOTE_FETCH || globalThis.fetch });
        const buf = file.bytes.buffer;
        let manifest;
        try { manifest = JSON.parse(new TextDecoder().decode(file.bytes)); } catch {}
        if (manifest && Array.isArray(manifest.widgets)) return json(await registerSource(DB, body.url, manifest.title), 201);
        assertModuleFile(file.bytes, file.contentType);
        const result = await saveUploadedModule(env, filename, new Uint8Array(buf), {
          source_url: body.url, group_id: body.group_id
        });
        await syncAutoAll(DB, result.existing ? [] : [result.module.id]);
        return json({ ok: true, added: result.existing ? [] : [result.module],
          updated: result.existing ? [result.module] : [] }, 201);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 400);
      }
    }


    const sourceMatch = path.match(/^\/api\/admin\/modules\/([^\/]+)\/source$/);
    if (sourceMatch) {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const sid = sourceMatch[1];
      const mod = await getModule(sid);
      if (!mod) return json({ error: 'Not found' }, 404);

      if (method === 'GET') {
        if (mod.is_encrypted) return json({ error: '该模块是加密文件，无法在线编辑' }, 400);
        const buf = await env.KV.get('file:' + sid, 'arrayBuffer');
        if (!buf) return json({ error: 'File not found' }, 404);
        return json({
          ok: true, id: sid, filename: mod.filename,
          content: new TextDecoder().decode(buf),
          size: buf.byteLength, source_url: mod.source_url || null
        });
      }

      if (method === 'PUT' || method === 'POST') {
        let name = '', code = '';
        const ctype = request.headers.get('Content-Type') || '';
        if (ctype.indexOf('application/json') >= 0) {
          const body = await request.json().catch(() => ({}));
          name = String(body.name || body.filename || '');
          code = typeof body.code === 'string' ? body.code : (typeof body.content === 'string' ? body.content : '');
        } else {
          const fd = await request.formData();
          name = String(fd.get('name') || fd.get('filename') || '');
          code = String(fd.get('code') || '');
        }
        if (!code.trim()) return json({ error: '内容不能为空' }, 400);


        code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (new TextEncoder().encode(code).byteLength > MAX_SOURCE_BYTES) return json({ error: '源码超过 3 MB，请改用上传方式' }, 413);
        const filename = (name || mod.filename || 'module.js').replace(/[\/\\]/g, '_').trim();
        if (!/\.js$/i.test(filename)) return json({ error: '文件名需要 .js 结尾' }, 400);

        const buf = new TextEncoder().encode(code);
        const head = new Uint8Array(buf.slice(0, 32768));
        const meta = parseMeta(filename, head);
        const title = meta.title || filename.replace(/\.js$/, '');
        const now = Date.now();
        const enc = isEncrypted(head);
        await putFile(env, sid, buf, now);
        await DB.prepare(
          `UPDATE modules SET filename = ?, widget_id = ?, title = ?, version = ?, author = ?,
             file_size = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`
        ).bind(
          filename, meta.id || mod.widget_id || mod.id, title, meta.version || '', meta.author || '',
          buf.byteLength, enc, now, sid
        ).run();
        return json({
          ok: true,
          module: {
            id: sid, filename, widget_id: meta.id || mod.widget_id || mod.id, title,
            version: meta.version || '', author: meta.author || '',
            file_size: buf.byteLength, is_encrypted: enc,
            source_url: mod.source_url || null,
            created_at: mod.created_at, updated_at: now
          }
        });
      }
      return json({ error: 'Method not allowed' }, 405);
    }


    if (path === '/api/admin/modules') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);

      if (method === 'GET') return json(await getModules());

      if (method === 'POST') {
        let files, gid;
        if ((request.headers.get('content-type') || '').includes('application/json')) {
          const body = await request.json();
          if (!body.title || typeof body.code !== 'string' || !body.code.trim()) return json({ error: '请输入模块名称和代码' }, 400);
          files = [new File([body.code], String(body.title).replace(/[^\w\u4e00-\u9fa5.\-]+/g, '_') + '.js')];
          gid = body.group_id;
        } else {
          const fd = await request.formData();
          files = fd.getAll('files').filter(f => f instanceof File && f.name);
          gid = fd.has('group_id') ? String(fd.get('group_id')) : undefined;
        }
        if (!files.length || files.length > MAX_UPLOAD_FILES) return json({ error: '单次请上传 1–45 个 .js 文件' }, 400);
        if (files.some(f => !/\.js$/i.test(f.name) || f.size > MAX_FILE_BYTES)) return json({ error: '只接受不超过 25 MiB 的 .js 文件，未写入任何文件' }, 400);
        const added = [], updated = [];
        for (const file of files) {
          const result = await saveUploadedModule(env, file.name, new Uint8Array(await file.arrayBuffer()), { group_id: gid });
          (result.existing ? updated : added).push(result.module);
        }
        await syncAutoAll(DB, added.map(m => m.id));
        return json({ ok: true, id: (added[0] || updated[0])?.id, added, updated }, 201);
      }

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const id = url.searchParams.get('id') || body.id;
        if (!id) return json({ error: 'id required' }, 400);
        const mod = await getModule(id);
        if (!mod) return json({ error: 'Not found' }, 404);
        const title = pickStr(body.title, mod.title, 200);
        const version = pickStr(body.version, mod.version, 64);
        const author = pickStr(body.author, mod.author, 120);
        const note = pickStr(body.note, mod.note, 1000);
        const enc = body.is_encrypted === undefined
          ? (Number(mod.is_encrypted) || 0)
          : (body.is_encrypted ? 1 : 0);
        await DB.prepare(
          `UPDATE modules SET title = ?, version = ?, author = ?, note = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`
        ).bind(title, version, author, note, enc, Date.now(), id).run();
        return json({ ok: true });
      }

      if (method === 'PUT') {
        const id = url.searchParams.get('id');
        const mod = await getModule(id);
        if (!mod) return json({ error: 'Not found' }, 404);
        const fd = await request.formData();
        const file = fd.get('file');
        if (!(file instanceof File) || !file.name) return json({ error: 'No file' }, 400);
        if (!/\.js$/i.test(file.name)) return json({ error: '只接受 .js 文件' }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ error: '文件超过 25 MB' }, 413);
        const buf = await file.arrayBuffer();
        const meta = parseMeta(file.name, new Uint8Array(buf.slice(0, 32768)));
        await putFile(env, id, buf, Date.now());
        await DB.prepare(
          `UPDATE modules SET filename = ?, widget_id = ?, title = ?, version = ?, author = ?,
             file_size = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`
        ).bind(
          file.name, meta.id || mod.widget_id || mod.id,
          meta.title || file.name.replace(/\.js$/, ''),
          meta.version || '', meta.author || '',
          buf.byteLength, isEncrypted(new Uint8Array(buf)), Date.now(), id
        ).run();
        return json({ ok: true });
      }

      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!await getModule(id)) return json({ error: 'Not found' }, 404);
        await env.KV.delete('file:' + id);
        await DB.batch([
          DB.prepare('DELETE FROM modules WHERE id = ?').bind(id),
          DB.prepare('DELETE FROM collection_modules WHERE module_id = ?').bind(id),
          DB.prepare("UPDATE source_items SET module_id=NULL,last_error='模块被本地删除，下次同步可重新导入' WHERE module_id=?").bind(id)
        ]);
        return json({ ok: true });
      }
    }


    const refreshMatch = path.match(/^\/api\/admin\/modules\/([^\/]+)\/refresh$/);
    if (refreshMatch && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const modId = refreshMatch[1];
      const mod = await getModule(modId);
      if (!mod) return json({ error: 'Not found' }, 404);
      if (!mod.source_url) return json({ error: 'No source URL' }, 400);
      const source = await DB.prepare('SELECT source_id FROM source_items WHERE module_id=? LIMIT 1').bind(modId).first();
      if (source) {
        await DB.prepare("UPDATE sources SET enabled=1,status='queued',generation=generation+1,next_sync_at=0 WHERE id=? AND status NOT IN ('syncing','queued')").bind(source.source_id).run();
        return json({ ok: true, queued: true }, 202);
      }
      try {
        await refreshModuleFromSource(env, mod);
        return json({ ok: true });
      } catch (e) {
        const msg = String((e && e.message) || e);
        return json({ error: msg.indexOf('Failed to fetch') === 0 ? msg : 'Refresh failed: ' + msg }, 400);
      }
    }


    if (path === '/api/admin/reset' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const { results } = await DB.prepare('SELECT id FROM modules').all();
      const ids = (results || []).map(r => r.id);
      for (let i = 0; i < ids.length; i += 20) {
        await Promise.all(ids.slice(i, i + 20).map(id => env.KV.delete('file:' + id).catch(() => null)));
      }
      await DB.batch([
        DB.prepare('DELETE FROM source_items'),
        DB.prepare('DELETE FROM sources'),
        DB.prepare('DELETE FROM modules'),
        DB.prepare('DELETE FROM collection_modules'),
        DB.prepare('DELETE FROM collection_aliases'),
        DB.prepare('DELETE FROM collections'),
        DB.prepare('DELETE FROM groups')
      ]);
      return json({ ok: true, removed: ids.length });
    }

    if (path === '/api/admin/change-password' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json().catch(() => ({}));
      if (!body.password || String(body.password).length < 8) return json({ error: '密码至少 8 位' }, 400);
      await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind('admin_password', await hashPassword(String(body.password))).run();

      const me = (request.headers.get('Cookie') || '').match(/fwh_admin=([^;]+)/);
      await DB.prepare('DELETE FROM sessions WHERE token != ?').bind(me ? me[1] : '').run();
      return json({ ok: true });
    }

    if (path === '/api/admin/modules/reorder' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json().catch(() => ({}));
      const ids = body.ids || [];
      if (!Array.isArray(ids)) return json({ error: 'ids must be array' }, 400);
      const now = Date.now();
      for (let i = 0; i < ids.length; i += 100) {
        await DB.batch(ids.slice(i, i + 100).map((id, k) =>
          DB.prepare('UPDATE modules SET sort_order = ?, updated_at = ? WHERE id = ?').bind(i + k, now, id)));
      }
      return json({ ok: true, count: ids.length });
    }

    if (path === '/api/admin/groups') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method === 'GET') {
        const r = await DB.prepare('SELECT * FROM groups ORDER BY position, created_at').all();
        return json(r.results || []);
      }
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const name = (body.name || '').trim();
        if (!name) return json({ error: 'name required' }, 400);
        const id = genId();
        const maxPos = await DB.prepare('SELECT MAX(position) AS mp FROM groups').first();
        await DB.prepare('INSERT INTO groups (id, name, position, created_at) VALUES (?,?,?,?)')
          .bind(id, name, ((maxPos && maxPos.mp) || 0) + 1, Date.now()).run();
        return json({ ok: true, id });
      }
      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const id = body.id;
        if (!id) return json({ error: 'id required' }, 400);
        const name = String(body.name || '').trim();
        if (!name) return json({ error: 'name required' }, 400);
        await DB.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, id).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        const id = new URL(request.url).searchParams.get('id');
        if (!id) return json({ error: 'id required' }, 400);
        await DB.batch([
          DB.prepare('UPDATE modules SET group_id = ? WHERE group_id = ?').bind('', id),
          DB.prepare('DELETE FROM groups WHERE id = ?').bind(id)
        ]);
        return json({ ok: true });
      }
    }

    if (path === '/api/admin/groups/reorder' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json().catch(() => ({}));
      const ids = body.ids || [];
      if (!Array.isArray(ids)) return json({ error: 'ids must be array' }, 400);
      for (let i = 0; i < ids.length; i += 100) {
        await DB.batch(ids.slice(i, i + 100).map((id, k) =>
          DB.prepare('UPDATE groups SET position = ? WHERE id = ?').bind(i + k, id)));
      }
      return json({ ok: true, count: ids.length });
    }

    if (path === '/api/admin/modules/group' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json().catch(() => ({}));
      const moduleId = body.moduleId, groupId = body.groupId || '';
      if (!moduleId) return json({ error: 'moduleId required' }, 400);
      await DB.prepare('UPDATE modules SET group_id = ?, updated_at = ? WHERE id = ?')
        .bind(groupId, Date.now(), moduleId).run();
      return json({ ok: true });
    }


    if (path === '/api/admin/collections') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);

      if (method === 'GET') return json(await getCollections());

      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const title = (body.title || '').trim();
        if (!title) return json({ error: 'title required' }, 400);
        const slugInput = (body.slug || genId().replace(/-/g, '')).trim();
        if (!/^[A-Za-z0-9]+$/.test(slugInput)) return json({ error: '路径只能是英文字母和数字' }, 400);
        const now = Date.now();
        const id = genId();
        const desc = pickStr(body.description, '', 2000);
        const icon = pickStr(body.icon_url, '', 500);
        let slug = await ensureUniqueSlug(slugInput);
        for (let attempt = 0; ; attempt++) {
          try {
            await DB.prepare(
              `INSERT INTO collections (id, slug, title, description, icon_url, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)`
            ).bind(id, slug, pickStr(title, '', 200), desc, icon, now, now).run();
            break;
          } catch (e) {
            // 并发建同名路径时 UNIQUE 会撞，重新取一个可用 slug 再试
            if (attempt >= 2 || !/UNIQUE/i.test(String((e && e.message) || e))) throw e;
            slug = await ensureUniqueSlug(slugInput);
          }
        }
        if (Array.isArray(body.moduleIds) && body.moduleIds.length) {
          await setCollectionModules(id, body.moduleIds);
        }
        if (body.autoAll) {
          await DB.prepare('UPDATE collections SET auto_all = 1 WHERE id = ?').bind(id).run();
          await syncAutoAll(DB);
        }
        return json({ ok: true, id, slug }, 201);
      }

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const col = await DB.prepare('SELECT * FROM collections WHERE id = ?').bind(body.id).first();
        if (!col) return json({ error: 'Not found' }, 404);
        let slug = col.slug;
        if (body.slug !== undefined) {
          const s = String(body.slug).trim();
          if (s !== col.slug && !/^[A-Za-z0-9]+$/.test(s)) return json({ error: '新路径只能是英文字母和数字；旧路径可保持不变' }, 400);
          if (s && s !== col.slug) slug = s;
        }
        try {
          await setCollectionSlug(DB, col.id, slug);
          await DB.prepare(
            `UPDATE collections SET slug = ?, title = ?, description = ?, icon_url = ?, updated_at = ? WHERE id = ?`
          ).bind(
            slug,
            pickStr(body.title, col.title, 200),
            pickStr(body.description, col.description, 2000),
            pickStr(body.icon_url, col.icon_url, 500),
            Date.now(), body.id
          ).run();
        } catch (e) {
          if (/UNIQUE|占用/i.test(String((e && e.message) || e))) return json({ error: '该路径已被占用或属于历史订阅地址，请换一个' }, 409);
          throw e;
        }
        if (body.moduleIds !== undefined) {
          await setCollectionModules(body.id, body.moduleIds);
        }
        if (body.autoAll !== undefined) await DB.prepare('UPDATE collections SET auto_all = ? WHERE id = ?').bind(body.autoAll ? 1 : 0, col.id).run();
        if (body.autoAll === true && !col.auto_all) await syncAutoAll(DB);
        return json({ ok: true });
      }

      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        const col = await DB.prepare('SELECT id FROM collections WHERE id = ?').bind(id).first();
        if (!col) return json({ error: 'Not found' }, 404);
        await DB.batch([
          DB.prepare('DELETE FROM collections WHERE id = ?').bind(id),
          DB.prepare('DELETE FROM collection_modules WHERE collection_id = ?').bind(id),
          DB.prepare('DELETE FROM collection_aliases WHERE collection_id = ?').bind(id)
        ]);
        return json({ ok: true });
      }
    }


    const fwdMatch = path.match(/^\/api\/collections\/([^\/]+?)(?:\/(?:fwd|rex)|\.(?:fwd|rex))?$/);
    if (fwdMatch) {
      const col = await findCollectionBySlug(fwdMatch[1]);
      if (!col) return json({ error: 'Not found' }, 404);

      const { results: rows } = await DB.prepare(
        `SELECT m.*, cm.position AS _pos FROM collection_modules cm
           JOIN modules m ON m.id = cm.module_id
         WHERE cm.collection_id = ? ORDER BY cm.position`
      ).bind(col.id).all();

      const widgets = (rows || []).map((m) => {
        const wtitle = m.title || m.filename;
        const t = wtitle;
        return {
          id: m.widget_id || m.id,
          title: t,
          description: m.note || '',
          requiredVersion: '0.0.1',
          version: m.version || '1.0.0',
          author: m.author || '',
          url: url.origin + '/api/modules/' + m.id + '/raw'
        };
      });

      return pubJson({
        title: col.title,
        description: col.description || '',
        icon: col.icon_url || '',
        widgets: widgets
      }, 200, { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' });
    }


    const rawMatch = path.match(/^\/api\/modules\/([^\/]+?)(?:\.js|\/raw)?$/);
    if (rawMatch) {
      const kvr = await env.KV.getWithMetadata('file:' + rawMatch[1], 'stream');
      if (!kvr || !kvr.value) return json({ error: 'File not found' }, 404);
      const meta = kvr.metadata || {};
      const etag = meta.u ? 'W/"' + meta.u + '"' : null;
      const h = {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600'
      };
      if (etag) h.ETag = etag;
      if (etag && request.headers.get('If-None-Match') === etag) {
        return new Response(null, { status: 304, headers: h });
      }
      return new Response(kvr.value, { headers: h });
    }


    const directMatch = path.match(/^\/([a-f0-9-]{36})(?:\.js)?$/);
    if (directMatch) {
      const kvr = await env.KV.getWithMetadata('file:' + directMatch[1], 'stream');
      if (kvr && kvr.value) {
        const meta = kvr.metadata || {};
        const h = {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600'
        };
        if (meta.u) h.ETag = 'W/"' + meta.u + '"';
        return new Response(kvr.value, { headers: h });
      }
    }

    if (path.startsWith('/api/')) {
      return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    // 只有首页返回界面；其余路径按 404 处理，避免任意路径都回一页 200 HTML
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: htmlHeaders() });
    }
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    } catch (err) {
      const rid = Date.now().toString(36);
      console.error('[fatal][' + rid + ']', (err && err.stack) || err);
      return json({ error: 'Internal error', ref: rid }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRefreshLinkModules(env));
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } });
}
function pickStr(v, fallback, max) {
  if (typeof v !== 'string') return fallback;
  return max && v.length > max ? v.slice(0, max) : v;
}

function pubJson(data, status = 200, extraHeaders = {}) {
  return json(data, status, { 'Access-Control-Allow-Origin': '*', ...extraHeaders });
}
async function sha256(t) {
  const d = new TextEncoder().encode(t);
  const h = await crypto.subtle.digest('SHA-256', d);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function genId() { return crypto.randomUUID(); }

async function saveUploadedModule(env, filename, bytes, options = {}) {
  const DB = env.DB;
  const meta = parseMeta(filename, bytes.subarray(0, 32768));
  let matches = [];
  for (const [field, value] of [['source_url', options.source_url], ['widget_id', meta.id], ['filename', filename]]) {
    if (!value) continue;
    const { results } = await DB.prepare('SELECT * FROM modules WHERE ' + field + ' = ?').bind(value).all();
    if (results.length > 1) throw new Error('存在多个同名或同标识模块，请使用「替换文件」明确选择目标');
    if (results.length) { matches = results; break; }
  }
  const old = matches[0];
  const id = old?.id || genId(), now = Date.now();
  const mod = { ...old, id, filename,
    widget_id: meta.id || old?.widget_id || id, title: meta.title || old?.title || filename.replace(/\.js$/i, ''),
    version: meta.version || '', author: meta.author || '', file_size: bytes.byteLength,
    is_encrypted: isEncrypted(bytes), source_url: options.source_url ?? old?.source_url ?? null,
    note: old?.note || '', group_id: options.group_id ?? old?.group_id ?? '',
    sort_order: old?.sort_order ?? await nextSortOrder(DB), legacy_json: old?.legacy_json || '{}',
    created_at: old?.created_at || now, updated_at: now };
  await putFile(env, id, bytes, now);
  await moduleStatement(DB, mod).run();
  return { module: mod, existing: !!old };
}

export function parseMeta(fn, head, legacy = false) {
  const t = new TextDecoder().decode(head);
  const meta = {};
  const m = t.match(/\/\*[\s\S]*?WidgetMetadata\s*\{/) || t.match(/WidgetMetadata\s*=\s*\{/);
  if (m) {
    let depth = 1;
    const start = m.index + m[0].length;
    let i = start;
    while (i < t.length && depth > 0) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}') depth--;
      i++;
    }
    const body = t.slice(start, i - 1);
    const expression = legacy ? /(\w+)\s*:\s*"([^"]*)"/g : /["']?(\w+)["']?\s*:\s*"([^"]*)"/g;
    const pairs = body.match(expression);
    if (pairs) pairs.forEach(x => { const kv = x.match(legacy ? /(\w+)\s*:\s*"([^"]*)"/ : /["']?(\w+)["']?\s*:\s*"([^"]*)"/); if (kv && !meta[kv[1]]) meta[kv[1]] = kv[2]; });
  }
  return meta;
}
export function isEncrypted(buf) {
  // 唯一标准：首行固定为 REXENC 标记
  let head;
  try {
    head = new TextDecoder('utf-8', { fatal: true }).decode(buf.slice(0, 32));
  } catch (e) { return 0; }
  return head.split('\n')[0].replace(/^\uFEFF/, '').trim() === 'REXENC' ? 1 : 0;
}

async function refreshModuleFromSource(env, mod) {
  const buf = await fetchCapped(mod.source_url, MAX_FILE_BYTES, env.REMOTE_FETCH || globalThis.fetch);
  const head = new Uint8Array(buf.slice(0, 32768));
  const meta = parseMeta(mod.filename, head);
  const encrypted = isEncrypted(head);
  const now = Date.now();
  await putFile(env, mod.id, buf, now);
  await env.DB.prepare(
    `UPDATE modules SET title = ?, version = ?, author = ?, file_size = ?,
       is_encrypted = ?, updated_at = ? WHERE id = ?`
  ).bind(
    encrypted ? mod.title : (meta.title || mod.title),
    encrypted ? mod.version : (meta.version || ''), encrypted ? mod.author : (meta.author || ''),
    buf.byteLength, encrypted, now, mod.id
  ).run();
}

const REFRESH_BATCH = 40;
const REFRESH_CONC  = 4;
async function autoRefreshLinkModules(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM modules WHERE source_url IS NOT NULL AND source_url != '' ORDER BY updated_at ASC LIMIT ?"
    ).bind(REFRESH_BATCH).all();
    const list = results || [];
    let ok = 0, fail = 0, i = 0;
    async function worker() {
      while (i < list.length) {
        const mod = list[i++];
        try { await refreshModuleFromSource(env, mod); ok++; }
        catch (e) {
          fail++;
          console.log('[auto-refresh] failed: ' + (mod.filename || mod.id) + ' - ' + String((e && e.message) || e));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONC, list.length) }, worker));
    console.log('[auto-refresh] done: ok=' + ok + ' fail=' + fail + ' total=' + list.length);
  } catch (e) {
    console.log('[auto-refresh] fatal: ' + String((e && e.message) || e));
  }
}
