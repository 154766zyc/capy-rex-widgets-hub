// Widget Hub 3.5 selective port — preserves the Docker 3.4 runtime and identities.
// DB and KV are adapters over one local SQLite database, not cloud services.
// ADMIN_SECRET supplies the initial password; saved database passwords win.
// 模块直链：https://<host>/api/modules/<id>.js
// 合集订阅：https://<host>/api/collections/<slug>.rex（兼容旧.fwd)

import { subscriptionSchema, parseManifest, addSubscription, listSubscriptions,
  syncSubscription, subscriptionTick, subscriptionItems, upgradeSubscriptions, previewSource, readSourcePreview, editSource, legacySources, changeSubscriptionIcon } from './subscriptions.js';
import { uploadSchema, previewUploads, commitUpload, previousVersion, restorePrevious,
  withModuleLock, getFileKey, cleanupUploadJobs } from './uploads.js';
import {parseModuleMeta,resolveTitle,cleanTitle,generatedFilename,METADATA_SCAN_BYTES} from './metadata.js';
import {nextVersion,cleanVersion} from './versions.js';
import {syncIntervalHours,syncIntervalMs,setSyncInterval,SYNC_INTERVAL_HOURS} from './sync-interval.js';
import {backfillTitles} from './title-maintenance.js';
import {bulkManage,deleteModule,replaceMembers,validatedMembers,memberStatements} from './management.js';
import {managementUI,managementStyles} from './management-ui.js';
import { migrateDocker, migrateSources } from './migration.js';
import { fetchRemote, assertFetchableUrl as safeRemoteUrl, assertModuleFile } from './remote.js';
import { backupStream, exportBackup, restoreBackup, prepareBackup, setCollectionSlug, syncAutoAll, resetAllData, fullResetPlan, BACKUP_SCOPES } from './backup.js';
import {iconSchema,listIconSources,addIconSource,changeIconSource,deleteIconSource,refreshIconSource,
  queryIcons,cacheIcon,prepareCollectionIcon,assertStoredIcon,iconTick,iconResponse,uploadIcon,ICON_LIMITS} from './icons.js';
import {iconUI,iconStyles} from './icon-ui.js';
import {pwaResponse} from './pwa.js';
import {filenameSchema,decorateNames,decorateNamesFor,decorateNameOne,prepareName,nameStatement,namingSettings,scanNames,repairNames,
  urlFilename,modulePath,contentDisposition,downloadFilename} from './filenames.js';
import {filenameUI,filenameStyles} from './filename-ui.js';
import {scanDuplicateModules,deleteScannedDuplicate,ignoreDuplicateGroup,resolveLinkDuplicate} from './duplicates.js';
import {enhancementSchema,loadAutoRules,saveAutoRules,previewAutoRules,runAutoRules,autoRulesTick} from './auto-rules.js';
import {autoRulesUI,autoRulesStyles} from './auto-rules-ui.js';
import {enhancementsUI,enhancementsStyles} from './enhancements-ui.js';
import {restoreUI,restoreStyles} from './restore-ui.js';
import {duplicatesUI,duplicatesStyles} from './duplicates-ui.js';
import {sharingSchema,previewShare,saveShare,resolveAlias} from './sharing.js';
import {sharingUI} from './sharing-ui.js';
import {homeSchema,homeResponse,migrateHomes} from './home-configs.js';
import {fileSchema,fileResponse} from './files.js';
import {homeUI,homeStyles} from './home-ui.js';
import {filesUI,filesStyles} from './files-ui.js';
import {zipUploadUI} from './zip-upload-ui.js';

const subscriptionHelpers = env => ({ fetchCapped:(url,max,info)=>fetchCapped(url,max,env,info), fetchRemote:(url,max,options)=>fetchRemote(url,max,{...options,transport:env.REMOTE_FETCH,signal:env.SHUTDOWN_SIGNAL,assertUrl:raw=>assertFetchableUrl(raw,env)}), assertFetchableUrl:raw=>assertFetchableUrl(raw,env), nextSortOrder, parseMeta, isEncrypted, putFile, toHex });
const uploadHelpers = { parseMeta, isEncrypted, toHex, nextSortOrder };

async function importLink(env,body){
  if(!body.preview_id){
    const url=assertFetchableUrl(body.url,env);url.hash='';
    const existing=await env.DB.prepare('SELECT id,kind FROM subscription_sources WHERE url=?').bind(url.href).first();
    if(existing)return {ok:true,subscription:{...existing,existing:true,added:[]},existing:true,added:[]};
  }
  const identified=body.preview_id?body:await previewSource(env,body.url,subscriptionHelpers(env));
  return env.ATOMIC(async()=>{
    // Revalidate generation inside the publication transaction, including replacement.
    const p=await readSourcePreview(env,{...identified,url:body.url});
    const duplicate=await resolveLinkDuplicate(env,p,body,uploadHelpers);
    if(duplicate)return duplicate;
    const subscription=await addSubscription(env,p.url,body.group_id,subscriptionHelpers(env),p.buffer,{...body,preview_id:p.id,filename:body.filename||p.meta.source_filename});
    return {ok:true,subscription,existing:subscription.existing,added:await decorateNames(env,subscription.added||[])};
  });
}

var HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="darkreader-lock">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>Capy/Rex模块管理</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/app-icons/capy-v13-180.png">
<link rel="icon" type="image/png" sizes="32x32" href="/app-icons/capy-v13-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/app-icons/capy-v13-16.png">
<meta name="theme-color" content="#f2f2f6">
<meta name="application-name" content="Capy/Rex">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Capy/Rex">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
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
#groupTabs{flex-wrap:wrap;overflow-x:visible!important}
#groupTabs .ftab{max-width:100%;white-space:normal;overflow-wrap:anywhere}
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
.od-menu.portal{position:fixed;right:auto;left:0;top:0;z-index:9999;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);overflow:auto;overscroll-behavior:contain}
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
.storage-meta{flex:1;min-width:0}.storage-text{font-size:13.5px;overflow-wrap:anywhere}
.storage-bar{height:8px;border-radius:5px;background:var(--div);overflow:hidden;margin:9px 0 7px}
.storage-bar span{display:block;height:100%;width:0;background:var(--accent);border-radius:5px;transition:width .3s}
.storage-bar span.warn{background:#dc6b42}
.storage-hint{font-size:12px;line-height:1.6;color:var(--text2)}
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
.group-move-choice.pick-item{width:100%;min-height:44px;text-align:left;background:none;color:var(--text);font-family:inherit;border:0;border-bottom:1px solid var(--div)}
.group-move-choice.pick-item:last-child{border-bottom:0}
.group-move-choice:active{background:var(--card)}
.group-move-choice:disabled{opacity:.6;cursor:default}
.group-move-actions{display:flex;justify-content:flex-end;margin-top:14px}
.group-move-name{overflow-wrap:anywhere}
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
@media(max-width:460px){.dock-item{padding:10px 11px!important;gap:4px!important}.dock{gap:0}}
/* 磁吸按钮 */
.btn-mag{transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .2s!important;will-change:transform}
${managementStyles}
${autoRulesStyles}
${enhancementsStyles}
${iconStyles}
${filenameStyles}
${duplicatesStyles}
.brand-pair{display:flex;gap:10px;justify-content:center;margin-bottom:16px}.brand-pair img{width:56px;height:56px;border-radius:24%;object-fit:cover}.brand-pair.compact{margin:0;gap:5px}.brand-pair.compact img{width:28px;height:28px}.login-card h2{font-size:23px}.header-in{flex-wrap:wrap}.btn:focus-visible,a:focus-visible{outline:3px solid #007aff;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
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
<div class="login-card"><div class="brand-pair"><img src="/app-icons/capy-v1-96.png" alt="CapyPlayer"><img src="/app-icons/rex-mulberry-v1-192.png" alt="Rex"></div><h2>Capy/Rex模块管理</h2><p class="sub">帮你管理模块链接和模块，生成合集链接。</p><p class="sub">请输入管理密码继续</p><input type="password" id="pwInput" class="input" placeholder="管理密码" onkeydown="if(event.key==='Enter')login()"><button class="btn btn-primary" onclick="login()">登 录</button><p id="loginErr" class="login-err"></p></div></div>

<div id="appMain" style="display:none">
<div class="header"><div class="header-in"><a href="/admin" style="font-size:13px;color:var(--accent)">分享 / 开发者投稿</a>
<div class="brand-pair compact"><img src="/app-icons/capy-v1-48.png" alt="CapyPlayer"><img src="/app-icons/rex-mulberry-v1-192.png" alt="Rex"></div>
<div><h1 id="pageTitle">模块</h1></div>
<div class="spacer"></div>
<button class="btn-xs theme-btn" id="btnThemeToggle" onclick="toggleTheme()" title="切换主题">&#x1f313;</button>
</div></div>

<div class="main">
<div id="page-modules" class="page">
<div class="page-head"><span class="count" id="modCount">0 个模块</span><div class="actions"><span class="ios-search"><svg class="ios-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input class="ios-search-input" id="modSearch" type="search" placeholder="Search…" oninput="onModSearch()"><button class="ios-search-x" id="modSearchX" onclick="clearModSearch()" aria-label="清除搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span><button class="btn btn-sm btn-mag" onclick="showImportUrl()" style="margin-left:auto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg> 链接</button><button class="btn btn-primary btn-sm btn-mag" onclick="showUploadMods()">&#xff0b; 上传</button></div></div>
<div style="display:flex;gap:6px;align-items:flex-start"><div class="folder-tabs" id="groupTabs" style="display:flex;gap:6px;overflow-x:auto;padding:2px 4px 12px;scrollbar-width:none;flex:1;min-width:0"></div><div class="od-root" id="groupOdRoot"><button class="ftab od-trigger" onclick="toggleGroupMenu(event)" aria-haspopup="menu" aria-expanded="false" style="color:var(--accent);border-style:dashed;background:transparent;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px;vertical-align:-2px"><path d="M12 5v14M5 12h14"/></svg> 分组<svg class="od-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="m6 9 6 6 6-6"/></svg></button><div class="od-menu" role="menu"><button class="mi" role="menuitem" onclick="closeGroupMenu();showNewGroup()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><path d="M12 5v14M5 12h14"/></svg>新建分组</button><button class="mi" role="menuitem" onclick="closeGroupMenu();showGroupSort()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>管理分组</button></div></div></div><div id="modulesList"><div class="card" style="padding:10px 18px 6px"><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div><div class="skel-row"><div class="skel-ico"></div><div class="skel-tx"><div class="skel-l1"></div><div class="skel-l2"></div></div></div></div></div></div>

<div id="page-collections" class="page">
<div class="page-head collection-head"><div class="collection-segments" role="tablist" aria-label="合集内容"><button type="button" role="tab" id="moduleCollectionsTab" aria-selected="true" aria-controls="moduleCollectionsPanel" onclick="switchCollectionSection('modules')">模块合集</button><button type="button" role="tab" id="homeConfigsTab" aria-selected="false" aria-controls="homeConfigsPanel" tabindex="-1" onclick="switchCollectionSection('homes')">首页配置</button><button type="button" role="tab" id="hubFilesTab" aria-selected="false" aria-controls="hubFilesPanel" tabindex="-1" onclick="switchCollectionSection('files')">文件</button></div><button id="newModuleCollection" class="btn btn-primary btn-sm" onclick="showAddCol()">＋ 新建合集</button><button id="uploadHomeConfig" class="btn btn-primary btn-sm" hidden onclick="showUploadHome()">＋ 上传首页</button><button id="uploadHubFile" class="btn btn-primary btn-sm" hidden onclick="showUploadHubFile()">＋ 上传文件</button></div>
<div id="moduleCollectionsPanel" role="tabpanel" aria-labelledby="moduleCollectionsTab"><p class="collection-total" id="colCount"></p><div id="collectionsList"></div></div>
<div id="homeConfigsPanel" role="tabpanel" aria-labelledby="homeConfigsTab" hidden><p class="collection-total" id="homeCount"></p><div id="homeLoadStatus" role="status" aria-live="polite"></div><div id="homeConfigsList"></div></div>
<div id="hubFilesPanel" role="tabpanel" aria-labelledby="hubFilesTab" hidden><p class="collection-total" id="hubFileCount"></p><div id="hubFileStatus" role="status" aria-live="polite"></div><div id="hubFilesList"></div></div></div>

<div id="page-subscriptions" class="page">
<div class="page-head"><span class="count" id="sourceCount">订阅源</span><button class="btn btn-primary btn-sm" onclick="showImportUrl()">＋ 添加订阅</button></div>
<p style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:16px">按设置的间隔自动同步（默认每 6 小时）；上游下架不删除本地模块。</p>
<div id="subscriptionsList"></div></div>

<div id="page-settings" class="page">
<div class="set-sec">数据统计</div>
<div class="stat-box"><div class="stat"><div class="num" id="statCols">0</div><div class="lbl">合集</div></div><div class="stat"><div class="num" id="statMods">0</div><div class="lbl">模块</div></div><div class="stat"><div class="num" id="statSize">0</div><div class="lbl">总大小</div></div></div>
<div class="set-sec">自动更新</div>
<div class="set-group"><div class="set-row" style="cursor:default;flex-wrap:wrap"><div style="flex:1;min-width:150px">订阅和链接模块自动更新间隔<div class="storage-hint">间隔越长，越省 Cloudflare 额度和流量；手动「同步」「全部同步」不受影响。</div></div><select class="input" id="syncInterval" style="width:auto;min-width:110px;margin:0" onchange="saveSyncInterval(this)" aria-label="自动更新间隔"><option value="6">每 6 小时</option><option value="12">每 12 小时</option><option value="18">每 18 小时</option><option value="24">每 24 小时</option></select></div></div>
<div class="set-sec">存储用量</div>
<div class="set-group"><div class="set-row storage-row" style="cursor:default" id="storageUsage" role="group" aria-label="存储用量"><div class="storage-meta"><div class="storage-text" id="storageText">正在读取…</div><div class="storage-bar" aria-hidden="true"><span id="storageFill"></span></div><div class="storage-hint" id="storageHint"></div></div></div></div>
<div class="set-sec">排序</div>
<div class="set-group"><div class="set-row" onclick="openSortModal()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="M3 17l3 3 3-3"/><path d="M6 18V4"/></svg><div><div style="font-weight:600">调整顺序</div><div style="font-size:12px;color:var(--text2);margin-top:1px">调整模块和分组的显示顺序</div></div><span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span></div></div>
<div class="set-sec">工具</div>
<div class="set-group" id="settingsTools">
<div class="set-row" onclick="exportData()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>导出备份（全部 / 模块数据 / 首页 / 文件）</div>
<div class="set-row" onclick="importBackup()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V6"/><path d="M6 12l6-6 6 6"/><path d="M4 21h16"/></svg>恢复备份（增量合并 / 全量恢复）</div>
<div class="set-row danger" onclick="clearAllData()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>清除所有数据</div>
</div>
<div class="set-sec">修改密码</div>
<div class="set-group"><div class="set-row" style="cursor:default"><input type="password" id="pwdNew" placeholder="新密码" style="flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:14.5px;color:var(--text);font-family:inherit"><button onclick="changePassword()" style="flex-shrink:0;border:none;cursor:pointer;font-size:14px;font-weight:700;color:#fff;background:var(--accent);border-radius:10px;padding:8px 16px;font-family:inherit">修改</button></div></div>
<div class="set-sec">关于</div>
<div class="set-group"><div class="set-row" style="cursor:default"><div style="font-size:13px;color:var(--text2);line-height:1.7">Capy/Rex Widgets Hub · V1.4-CF<br>作者：芜湖<br><a href="/crypto">加密 / 解密（外链）</a><br>帮你管理模块链接和模块，生成合集链接。</div></div></div>
</div>
</div>

<div class="dock">
<button class="dock-item" data-tab="subscriptions" onclick="switchTab('subscriptions')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5a15 15 0 0115 15M4 11a9 9 0 019 9"/><circle cx="5" cy="19" r="1"/></svg></span><span class="d-label">订阅</span></button>
<button class="dock-item active" data-tab="modules" onclick="switchTab('modules')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg></span><span class="d-label">模块</span></button>
<button class="dock-item" data-tab="collections" onclick="switchTab('collections')"><span class="d-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg></span><span class="d-label">合集</span></button>
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
var state = { modules: [], collections: [], groups: [], subscriptions: [], tab: 'modules', modReplaceId: null, isAuthed: false, activeGroup: '' };

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
function showApp(){ document.getElementById('bootLoader').style.display='none'; document.getElementById('loginGate').style.display='none'; document.getElementById('appMain').style.display='block'; loadAll(); }

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
      try{ res = await Promise.all([api('/api/admin/modules'), api('/api/admin/collections'), api('/api/admin/groups'), api('/api/admin/subscriptions')]); }
      catch(e){ res=null; }
    }
    if(!res){
      document.getElementById('modulesList').innerHTML='<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22.61 16.95A5 5 0 0018 10h-1.26a8 8 0 00-7.05-6M5 5a8 8 0 004 15h9a5 5 0 001.7-.3"/><path d="M1 1l22 22"/></svg></div><p>加载失败，可能是网络问题</p><button class="ftab" onclick="loadAll()" style="margin-top:10px">重新加载</button></div>';
      return;
    }
    var mr = res[0], cr = res[1];
    if(mr && Array.isArray(mr)) state.modules = mr;
    var gr = res[2];
    if(gr && Array.isArray(gr)) state.groups = gr;
    if(cr && Array.isArray(cr)) state.collections = cr;
    if(Array.isArray(res[3])) state.subscriptions = res[3];
    try{ localStorage.setItem('fwh_cache_v1', JSON.stringify({modules:state.modules,collections:state.collections,groups:state.groups})); }catch(e){}
    switchTab(state.tab);
  })();
  try{ await _loadP; }finally{ _loadP=null; }
}

async function loadSyncInterval(){
  var el=document.getElementById('syncInterval');if(!el)return;
  try{var r=await api('/api/admin/sync-interval');if(r&&r.ok){el.value=String(r.hours);el.dataset.saved=String(r.hours);}}catch(e){}
}
async function saveSyncInterval(el){
  var hours=Number(el.value),prev=el.dataset.saved||'6';el.disabled=true;
  try{var r=await api('/api/admin/sync-interval',{method:'PUT',json:{hours:hours}});if(!r||!r.ok)throw new Error(r?r.error:'请重新登录');el.dataset.saved=String(r.hours);toast('已改为每 '+r.hours+' 小时自动更新');}
  catch(e){el.value=prev;toast('保存失败：'+e.message);}
  finally{el.disabled=false;}
}
async function loadStorageUsage(){
  var text=document.getElementById('storageText'),fill=document.getElementById('storageFill'),hint=document.getElementById('storageHint');if(!text)return;
  try{
    var r=await api('/api/admin/storage');if(!r||!r.ok)throw new Error(r?r.error:'读取失败');
    if(!r.limit){text.textContent='已用 '+fmt(r.used);fill.style.width='0';hint.textContent=r.note||'';return;}
    var pct=Math.min(100,r.used/r.limit*100);
    text.textContent='已用 '+fmt(r.used)+' / '+fmt(r.limit)+(r.plan==='free'?'（免费计划）':'')+' · '+pct.toFixed(pct<10?1:0)+'%';
    fill.style.width=pct.toFixed(1)+'%';fill.className=pct>=80?'warn':'';
    hint.textContent=pct>=80?'存储快满了：可以删除不用的模块、首页或文件，或导出备份后清理。':'模块、首页、图标和文件都算在内。付费计划每个对象上限 10 GB。';
  }catch(e){text.textContent='暂时无法读取存储用量';fill.style.width='0';hint.textContent=e.message;}
}
function switchTab(tab){
  state.tab=tab;
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var pg = document.getElementById('page-'+tab); if(pg) pg.classList.add('active');
  document.querySelectorAll('.dock-item').forEach(function(el){ el.classList.toggle('active',el.dataset.tab===tab); });
  var titles={modules:'模块',collections:'合集',settings:'设置',subscriptions:'订阅源'};
  document.getElementById('pageTitle').textContent=titles[tab];

  if(tab==='modules') renderMods();
  if(tab==='collections') renderCols();
  if(tab==='settings') { renderSettings(); loadStorageUsage(); loadSyncInterval(); }
  if(tab==='subscriptions') renderSubscriptions();
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
function moduleSubtitle(m){
  var parts=[];if(!m.hide_filename||m.named_url)parts.push(m.effective_filename||m.filename);parts.push(fmt(m.file_size));
  if(m.subscription_title)parts.push('订阅：'+m.subscription_title);
  var text=parts.filter(Boolean).map(esc).join(' · ');
  if(m.note)text+='<br>'+esc(m.note);
  if(m.upstream_active===0)text+='<br>上游已下架，保留本地';
  if(m.manual_override)text+='<br>手动维护 · 自动更新已暂停';
  return text;
}
function renderMods(){
  closeAllRowMenus();
  var q = (document.getElementById('modSearch').value || '').toLowerCase().trim();
  renderGroupTabs();
  var groupedView=state.activeGroup&&state.activeGroup!=='__none__';
  var ms = state.modules.filter(function(m){
    if(state.activeGroup==='__none__'?!!m.group_id:(groupedView&&m.group_id!==state.activeGroup)) return false;
    if (!q) return true;
    return ((m.title || '') + ' ' + (m.filename || '') + ' ' + (m.effective_filename||'')+' '+(m.note || '') + ' ' + (m.author || '')).toLowerCase().indexOf(q) >= 0;
  });
  document.getElementById('modCount').style.display = 'none';
  if(!ms.length){ document.getElementById('modulesList').innerHTML='<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg></div><p>'+(q ? '没有匹配的模块' : '暂无模块')+'</p></div>'; return; }
  var h='<div class="card" style="padding:10px 18px 6px">';
  ms.forEach(function(m){
    var ib=m.is_encrypted?'var(--ico-encrypted)':'var(--ico-normal)';
    var ie=m.is_encrypted?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8.5 10.5V7.8a3.5 3.5 0 017 0v2.7"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 7L3.5 12l5 5"/><path d="M15.5 7l5 5-5 5"/><path d="M13.2 5.5l-2.4 13"/></svg>';
    h+='<div class="row" data-mid="'+m.id+'"><div class="ico-sq" style="background:'+ib+';color:'+(m.is_encrypted?'var(--ico-encrypted-fg)':'var(--ico-normal-fg)')+'">'+ie+'</div><div class="info"><div class="name">'+esc(m.title||m.filename)+'</div><div class="sub">'+moduleSubtitle(m)+'</div></div>'+
      (m.is_encrypted?'<span class="badge '+(m.source_url?'badge-green':'badge-orange')+'">加密</span>':'')+
      (m.version?'<span class="badge '+(m.source_url?'badge-green':'badge-blue')+'">'+esc(m.version)+'</span>':'')+

      '<div class="od-root row-od"><button class="btn-xs" aria-label="更多操作" onclick="toggleMenu(event,\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h8"/><path d="M18 7h2"/><path d="M4 17h2"/><path d="M12 17h8"/><circle cx="15" cy="7" r="2.6" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="2.6" fill="currentColor" stroke="none"/></svg></button>'+
      '<div class="od-menu" id="menu-'+m.id+'">'+
      (m.group_id?'<button class="mi" onclick="setModuleGroup(\''+m.id+'\',\'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg> 移出分组</button>':'')+
      '<button class="mi" onclick="showMoveToGroup(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V5h5v4h9v11H5z"/></svg> '+(m.group_id?'移入其他分组':'添加到分组')+'</button>'+
      '<button class="mi" onclick="editMeta(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 编辑信息</button>'+
      '<button class="mi" onclick="openEditor(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg> 编辑源码</button>'+
      '<button class="mi" onclick="copyModLink(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg> 复制链接</button>'+
      '<button class="mi" onclick="promptReplace(\''+m.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V6"/><path d="M6 12l6-6 6 6"/><path d="M4 21h16"/></svg> 替换文件</button>'+
      (m.source_url?'<button class="mi" onclick="refreshMod(\''+m.id+'\')" style="color:#16a34a"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.6-6.4"/><path d="M21 3v6h-6"/></svg> 刷新</button>':'')+
      '<button class="mi" onclick="showPreviousVersion(\''+m.id+'\')"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 2.6 6.4M3 12V6m0 6h6m3-5v5l3 2"/></svg> 恢复上一版</button>'+
      '<button class="mi" onclick="showShareModule(\''+m.id+'\')"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/></svg> 分享模块</button>'+
      '<button class="mi" onclick="showModuleInfo(\''+m.id+'\')"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg> 模块信息</button>'+
      '<button class="mi" onclick="downloadModule(\''+m.id+'\',this)"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg> 下载模块</button>'+
      (m.source_url?'<button class="mi" onclick="setModuleMaintenance(\''+m.id+'\','+(m.manual_override?'false':'true')+')"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(m.manual_override?'<path d="m9 5 11 7-11 7z"/>':'<path d="M9 5v14m6-14v14"/>')+'</svg> '+(m.manual_override?'恢复自动更新':'转为手动维护')+'</button>':'')+
      '<button class="mi danger" onclick="promptDeleteMod(\''+m.id+'\',\''+escJs(m.title||m.filename)+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg> 删除</button></div></div></div>';
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
async function writeModuleGroup(mid,gid){
  var r=await api('/api/admin/modules/group',{method:'POST',json:{moduleId:mid,groupId:gid}}),item=r&&r.results&&r.results[0];
  if(!r||!r.ok||!item||!item.ok)throw Error((item&&item.error)||(r&&r.error)||'更新分组失败');
}
async function setModuleGroup(mid,gid){
  try{await writeModuleGroup(mid,gid);toast('已移至未分类');await loadAll();}catch(e){if(state.isAuthed)toast(e.message);}
}
function showMoveToGroup(mid){
  var mod=state.modules.find(function(m){return m.id===mid;});if(!mod)return;
  var heading=mod.group_id?'移入其他分组':'添加到分组',previous=document.activeElement;
  var o=document.createElement('div');o.className='modal-overlay group-move-overlay';
  o.innerHTML='<div class="modal hub-dialog" role="dialog" aria-modal="true" aria-label="'+heading+'"><h3>'+heading+'</h3><p class="hub-help group-move-name"></p><div class="pick-list group-move-list"></div><p class="hub-error group-move-error" role="alert" hidden></p><div class="group-move-actions"><button type="button" class="btn group-move-cancel">取消</button></div></div>';
  o.querySelector('.group-move-name').textContent=mod.title||mod.filename;
  document.body.appendChild(o);
  var busy=false,list=o.querySelector('.group-move-list'),error=o.querySelector('.group-move-error'),cancel=o.querySelector('.group-move-cancel');
  function close(){if(busy)return;o.remove();if(previous&&previous.isConnected)previous.focus();}
  function lock(value){busy=value;o.querySelectorAll('button').forEach(function(b){b.disabled=value;});}
  function render(){
    var groups=state.groups.filter(function(g){return g.id!==mod.group_id;});list.replaceChildren();list.hidden=!groups.length;
    if(!groups.length){error.hidden=false;error.textContent=mod.group_id?'没有其他分组，请先创建新分组。':'还没有分组，请先创建分组。';}
    groups.forEach(function(g){
      var b=document.createElement('button');b.type='button';b.className='pick-item group-move-choice';b.textContent=g.name;list.append(b);
      b.onclick=async function(){
        if(busy)return;lock(true);error.hidden=true;
        try{
          await writeModuleGroup(mid,g.id);lock(false);close();toast('已移入「'+g.name+'」');await loadAll();
        }catch(e){
          lock(false);if(!state.isAuthed){close();return;}if(!o.isConnected)return;
          error.textContent=e.message;error.hidden=false;
          if(e.message==='分组不存在'){await loadAll();if(o.isConnected){render();(list.querySelector('button')||cancel).focus();}}
          else b.focus();
        }
      };
    });
  }
  cancel.onclick=close;o.onclick=function(e){if(e.target===o)close();};
  o.onkeydown=function(e){
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'&&!busy){
      var first=list.querySelector('button')||cancel;
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();cancel.focus();}
      else if(!e.shiftKey&&document.activeElement===cancel){e.preventDefault();first.focus();}
    }
  };
  render();(list.querySelector('button')||cancel).focus();
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
  var busy=false;
  showModal('上传模块',
    '<label>选择文件</label><input type="file" id="uploadFiles" multiple accept=".js,.zip,application/javascript,text/javascript,application/zip" class="input" style="padding:8px">'+
    '<p style="font-size:12px;color:var(--text2);line-height:1.7">先预览，再确认上传。可以直接选 .zip，会自动取出里面的 .js（跳过其它文件）。优先按模块 ID、其次完整文件名匹配；加密文件仅按文件名匹配。同名但 ID 不同或多个匹配将提示冲突。最多 45 个模块，总计 50 MB。</p>'+
    '<label>新增模块的分组（已有模块不移动）</label><select class="input" id="uploadGroup">'+groupOptions('')+'</select><p id="uploadStartStatus" style="font-size:12px;color:var(--text2)"></p>',
    async function(close){
      if(busy)return;
      var input = document.getElementById('uploadFiles');
      if(!input.files.length){ toast('请先选择文件'); return; }
      var gid = document.getElementById('uploadGroup').value;
      busy=true;var status=document.getElementById('uploadStartStatus');status.textContent='正在检查文件并匹配模块…';
      try{
        var picked=Array.from(input.files),expanded=picked;
        if(picked.some(function(f){return /\.zip$/i.test(f.name);})){status.textContent='正在解压 zip…';var unpacked=await hubExpandUploads(picked);expanded=unpacked.files;if(unpacked.notes.length)toast(unpacked.notes.join('；'));status.textContent='正在检查文件并匹配模块…';}
        await beginUploadPreview(expanded,gid,'',close);
      }
      catch(e){if(status.isConnected)status.textContent=e.message;toast(e.message);}
      finally{busy=false;}
    });
  document.querySelector('.modal-overlay:last-child #mC').textContent='检查并预览';
}

async function beginUploadPreview(files,gid,targetId,closePrevious){
  var fd=new FormData();files.forEach(function(f){fd.append('files',f);});
  if(gid)fd.append('group_id',gid);if(targetId)fd.append('target_id',targetId);
  var r=await api('/api/admin/modules/upload/preview',{method:'POST',body:fd,timeout:120000});
  if(!r||!r.ok)throw new Error(r?r.error:'检查失败');
  if(closePrevious)closePrevious();
  var labels={new:'新增',replace:'替换',identical:'内容相同，将跳过文件写入',conflict:'需要选择',invalid:'不可上传'};
  var h='<p style="font-size:12px;line-height:1.7;color:var(--text2)">替换会保留模块链接、合集引用、排序、分组和备注；上一版保留 7 天。提交前会再次校验，预览有效期 1 小时。旧模块没有内容指纹时，会在提交时检查并跳过相同内容。</p><div style="max-height:48vh;overflow:auto">';
  r.rows.forEach(function(row){
    h+='<div style="padding:12px 0;border-bottom:1px solid var(--card-brd)"><strong>'+esc(row.filename)+'</strong><p style="font-size:12px;color:var(--text2);line-height:1.7">'+esc(labels[row.kind])+(row.matched_by?' · '+esc(row.matched_by):'')+(row.target?'<br>目标：'+esc(row.target.title||row.target.filename):'')+(row.reason?'<br>'+esc(row.reason):'')+'</p>';
    var options='<option value="skip">跳过此文件</option>';
    if(row.kind!=='invalid'){
      if(row.kind==='new'||(row.kind==='conflict'&&!row.candidates.length&&!row.target))options+='<option value="new" '+(row.kind==='new'?'selected':'')+'>新增模块</option>';
      var candidates=row.candidates.slice();if(row.target&&!candidates.some(function(c){return c.id===row.target.id;}))candidates.push(row.target);
      candidates.forEach(function(c){options+='<option value="replace:'+esc(c.id)+'" '+((row.kind==='replace'||row.kind==='identical')&&row.target&&c.id===row.target.id?'selected':'')+'>替换：'+esc(c.title||c.filename)+' · '+esc(c.id.slice(0,8))+'</option>';});
    }
    h+='<select class="input" id="uploadChoice-'+row.index+'" '+(row.kind==='invalid'?'disabled':'')+'>'+options+'</select>';
    if(row.kind!=='invalid')h+='<label>导入后的文件名（可修改）</label><input class="input" id="uploadFilename-'+row.index+'" value="'+esc(row.effective_filename)+'" maxlength="153"><p style="font-size:12px;color:var(--text2)">原始名称保留用于匹配更新；同名模块自动加编号，不会合并。</p>';
    if(row.kind!=='invalid')h+='<label>版本号（可选）</label><input class="input" id="uploadVersion-'+row.index+'" maxlength="64" inputmode="decimal" placeholder="'+esc(row.version?'留空＝用代码里的 '+row.version:(row.is_encrypted?'留空＝内容变了自动按日期递增':'留空＝保留原版本号'))+'">';
    if((row.target&&row.target.subscribed)||row.candidates.some(function(c){return c.subscribed;})){
      h+='<p style="font-size:12px;color:#b76a21;line-height:1.7">该目标有自动更新来源。临时替换可能被下一次同步覆盖；手动维护只暂停此模块，不影响整个订阅。之后可在模块菜单恢复自动更新。</p><select class="input" id="uploadMode-'+row.index+'"><option value="">请选择更新方式</option><option value="temporary">临时替换，继续自动更新</option><option value="manual" '+(row.target&&row.target.manual?'selected':'')+'>转为手动维护，不再自动覆盖</option></select>';
    }
    h+='<p id="uploadResult-'+row.index+'" style="font-size:12px;white-space:pre-wrap"></p></div>';
  });
  h+='</div><p id="uploadBatchStatus" style="font-size:12px;color:var(--text2)"></p>';
  h+='<p class="batch-progress">显示逐文件进度。请勿关闭页面；成功项目会保留，未完成项需重新检查后继续。</p>';
  var busy=false,completed={},renew=false;
  showModal('上传预览',h,async function(close){
    if(busy)return;
    if(renew){
      busy=true;var remaining=files.filter(function(_,index){return !completed[index];});
      overlay.querySelector('#mC').disabled=true;overlay.querySelector('#mc').disabled=true;
      try{await beginUploadPreview(remaining,gid,targetId,close);}catch(e){toast(e.message);}finally{busy=false;if(overlay.isConnected){overlay.querySelector('#mC').disabled=false;overlay.querySelector('#mc').disabled=false;}}return;
    }
    if(r.rows.every(function(row){return completed[row.index];})){close();return;}
    var actions=[];
    for(var row of r.rows){
      if(completed[row.index])continue;
      var value=document.getElementById('uploadChoice-'+row.index).value;
      var modeEl=document.getElementById('uploadMode-'+row.index),mode=modeEl?modeEl.value:'';
      var selected=value.indexOf('replace:')===0?value.slice(8):'';
      var target=[row.target].concat(row.candidates).filter(Boolean).find(function(c){return c.id===selected;});
      if(target&&target.subscribed&&!mode){toast('请为 '+row.filename+' 选择更新方式');return;}
      var nameEl=document.getElementById('uploadFilename-'+row.index);
      var verEl=document.getElementById('uploadVersion-'+row.index),ver=verEl?verEl.value.trim():'';
      if(ver&&(ver.length>64||!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(ver))){toast(row.filename+'：版本号只能包含数字、字母和 . _ -');return;}
      actions.push({row:row,action:selected?'replace':value,target:selected,mode:mode,filename:nameEl?nameEl.value.trim():'',version:ver});
    }
    var duplicate={};
    for(var a of actions){if(a.target){if(duplicate[a.target]){toast('多个文件选择了同一个目标，请只保留一个');return;}duplicate[a.target]=true;}}
    busy=true;var button=overlay.querySelector('#mC');button.disabled=true;overlay.querySelector('#mc').disabled=true;
    overlay.querySelectorAll('select,input').forEach(function(el){el.disabled=true;});
    var counts={added:0,replaced:0,unchanged:0,skipped:0,failed:0};
    try{
      for(var a of actions){
        var line=document.getElementById('uploadResult-'+a.row.index);
        document.getElementById('uploadBatchStatus').textContent='正在处理 '+(actions.indexOf(a)+1)+' / '+actions.length+'：'+a.row.filename;
        line.style.color='';
        if(a.action==='skip'){line.textContent='已跳过';completed[a.row.index]=true;counts.skipped++;continue;}
        line.textContent='正在提交…';
        try{
          var body=new FormData();body.append('job_id',r.job_id);body.append('index',a.row.index);body.append('action',a.action);
          body.append('target_id',a.target);body.append('mode',a.mode);body.append('file',files[a.row.index]);
          body.append('filename',a.filename);if(a.version)body.append('version',a.version);
          var result=await api('/api/admin/modules/upload/commit',{method:'POST',body:body,timeout:120000});
          if(!result||!result.ok)throw new Error(result?result.error:'请求失败，可重试；已完成项目不会重复写入');
          counts[result.status]=(counts[result.status]||0)+1;completed[a.row.index]=true;
          line.textContent=({added:'已新增',replaced:'已替换，可从模块菜单恢复上一版',unchanged:'内容相同，已跳过文件写入'})[result.status]||result.status;
          if(result.effective_filename){line.textContent+=' · 文件名：'+result.effective_filename;document.getElementById('uploadFilename-'+a.row.index).value=result.effective_filename;}
        }catch(e){counts.failed++;line.textContent='失败：'+e.message;line.style.color='#dc6b42';
          if(/过期|预览后|刚刚|重新预览|已有匹配|文件已变更|目标.*不存在/.test(e.message))renew=true;
        }
      }
      var msg='新增 '+counts.added+' · 替换 '+counts.replaced+' · 未变化 '+counts.unchanged+' · 跳过 '+counts.skipped+' · 失败 '+counts.failed;
      document.getElementById('uploadBatchStatus').textContent='本轮：'+msg+'。已完成 '+Object.keys(completed).length+' / '+r.rows.length;toast(msg);await loadAll();
      button.textContent=counts.failed?(renew?'重新检查未完成项目':'仅重试失败项目'):'完成';
    }finally{busy=false;button.disabled=false;overlay.querySelector('#mc').disabled=false;
      r.rows.forEach(function(row){var choice=overlay.querySelector('#uploadChoice-'+row.index),mode=overlay.querySelector('#uploadMode-'+row.index),name=overlay.querySelector('#uploadFilename-'+row.index);choice.disabled=!!completed[row.index]||row.kind==='invalid';if(mode)mode.disabled=!!completed[row.index];if(name)name.disabled=!!completed[row.index];});
    }
  });
  var overlay=document.querySelector('.modal-overlay:last-child');overlay.querySelector('#mC').textContent='确认上传';
  r.rows.forEach(function(row){var choice=overlay.querySelector('#uploadChoice-'+row.index);choice.addEventListener('change',function(){var id=choice.value.indexOf('replace:')===0?choice.value.slice(8):'',target=[row.target].concat(row.candidates).filter(Boolean).find(function(c){return c.id===id;}),input=overlay.querySelector('#uploadFilename-'+row.index);if(input)input.value=target?(target.effective_filename||target.filename):row.effective_filename;});});
  overlay.addEventListener('click',function(e){if(busy&&e.target===overlay){e.stopImmediatePropagation();e.preventDefault();}},true);
}

async function showPreviousVersion(id){
  try{
    var r=await api('/api/admin/modules/'+id+'/previous-version');
    if(!r||!r.ok)throw new Error(r?r.error:'读取备份失败');
    if(!r.previous){toast('暂无可恢复的上一版，上传替换后会保留 7 天');return;}
    var p=r.previous,m=p.metadata;
    showModal('恢复上一版','<p style="font-size:13px;line-height:1.8">文件：'+esc(m.filename)+'<br>版本：'+esc(m.version||'未知')+'<br>备份时间：'+esc(new Date(p.created_at).toLocaleString())+'<br>有效期至：'+esc(new Date(p.expires_at).toLocaleString())+'<br>恢复不改变合集、备注或更新方式。如果仍开启自动更新，后续可能再次被上游覆盖。</p>',async function(close){
      try{var res=await api('/api/admin/modules/'+id+'/previous-version',{method:'POST',json:{created_at:p.created_at}});if(!res||!res.ok)throw new Error(res?res.error:'恢复失败');close();toast('已恢复上一版，当前版本也已备份');await loadAll();}catch(e){toast(e.message);}
    });
  }catch(e){toast(e.message);}
}
async function setModuleMaintenance(id,manual){
  showConfirm(manual?'将此模块转为手动维护？只停止此模块的自动更新。':'恢复此模块的自动更新？手动版本可能被上游覆盖。',async function(ok){
    if(!ok)return;
    try{var r=await api('/api/admin/modules/'+id+'/maintenance',{method:'PATCH',json:{manual:manual}});if(!r||!r.ok)throw new Error(r?r.error:'操作失败');toast(manual?'已转为手动维护':'已恢复自动更新');await loadAll();}catch(e){toast(e.message);}
  });
}

function copyModLink(id){ var m=state.modules.find(function(m){return m.id===id;});copyText(org()+(m&&(m.share_path||m.public_path)||'/api/modules/'+id+'.js')); }

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

// 编辑器即时提示；以服务端静态解析结果为准。
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
// Clipboard: HTTP (e.g. NAS http://IP:8083) has no navigator.clipboard, and iOS Safari
// refuses writes that happen after an await. Fall back to execCommand, then to a
// dialog where the link can be long-pressed and copied by hand.
function copyFallback(t){
  var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');
  a.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(a);a.focus();a.select();try{a.setSelectionRange(0,t.length);}catch(e){}
  var ok=false;try{ok=document.execCommand('copy');}catch(e){}a.remove();return ok;
}
function showCopyManual(t){
  var o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML='<div class="modal"><h3>手动复制</h3><p style="margin:8px 0;line-height:1.5">浏览器不允许自动复制，请长按下面的链接全选后复制。</p><textarea readonly rows="3" style="width:100%;box-sizing:border-box;font-size:16px;padding:8px;border-radius:10px;border:1px solid var(--border,#ccc);background:transparent;color:inherit"></textarea><div class="btn-row"><button class="btn btn-primary" id="mC">关闭</button></div></div>';
  var box=o.querySelector('textarea');box.value=t;document.body.appendChild(o);
  function cl(){o.remove();}
  o.addEventListener('click',function(e){if(e.target===o)cl();});o.querySelector('#mC').addEventListener('click',cl);
  box.addEventListener('focus',function(){box.select();});setTimeout(function(){try{box.focus();box.select();}catch(e){}},50);
}
function copyText(t){
  t=String(t);
  if(navigator.clipboard&&navigator.clipboard.writeText&&window.isSecureContext){
    return navigator.clipboard.writeText(t).then(function(){ toast('已复制'); },function(){ if(copyFallback(t))toast('已复制'); else showCopyManual(t); });
  }
  if(copyFallback(t))toast('已复制'); else showCopyManual(t);
  return Promise.resolve();
}
// Start the clipboard write inside the tap, before the text is known (iOS Safari).
function copyTextLater(promise){
  if(navigator.clipboard&&navigator.clipboard.write&&window.isSecureContext&&typeof ClipboardItem==='function'){
    try{
      var blob=promise.then(function(t){return new Blob([String(t)],{type:'text/plain'});});
      return navigator.clipboard.write([new ClipboardItem({'text/plain':blob})]).then(function(){ toast('已复制'); },function(){ return promise.then(function(t){return copyText(t);}); });
    }catch(e){}
  }
  return promise.then(function(t){return copyText(t);});
}

function promptReplace(id){ state.modReplaceId=id; document.getElementById('replaceFileInput').click(); }
async function refreshMod(id){ var r=await api('/api/admin/modules/'+id+'/refresh',{method:'POST'}); if(r&&r.ok){ toast('已刷新'); loadAll(); } else toast(r?r.error:'刷新失败'); }
function editMeta(id){
  var m = state.modules.find(function(x){ return x.id===id; });
  if(!m) return;
  showModal('编辑模块信息 — '+esc(m.title||m.filename),
    '<label>标题</label><input class="input" id="metaTitle" value="'+esc(m.title||'')+'">'+
    '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="metaTitleLock" '+(m.title_locked?'checked':'')+'>锁定自定义标题，更新不覆盖</label>'+
    '<p style="font-size:12px;color:var(--text2);line-height:1.7">未锁定时：模块代码 title → 订阅清单标题 → 已保存标题 → 文件名。修改标题会自动勾选锁定。</p>'+
    '<label>版本</label><input class="input" id="metaVersion" value="'+esc(m.version||'')+'">'+
    '<label>作者</label><input class="input" id="metaAuthor" value="'+esc(m.author||'')+'">'+
    '<label>备注</label><textarea class="textarea" id="metaNote" rows="2">'+esc(m.note||'')+'</textarea>',
    async function(close){
      var title = document.getElementById('metaTitle').value.trim();
      var version = document.getElementById('metaVersion').value.trim();
      var author = document.getElementById('metaAuthor').value.trim();
      var note = document.getElementById('metaNote').value.trim();
      var locked=document.getElementById('metaTitleLock').checked;
      var r = await api('/api/admin/modules?id='+id, {method:'PATCH', json:{title:title,title_locked:locked, version:version, author:author, note:note}});
      if(r&&r.ok){toast('已保存');close();await loadAll();}else toast(r?r.error:'保存失败');
    });
  document.getElementById('metaTitle').addEventListener('input',function(){document.getElementById('metaTitleLock').checked=true;});
}
function showModuleInfo(id){
  var m=state.modules.find(function(x){return x.id===id;});if(!m)return;
  var fields=[['显示标题',m.title],['标题来源',m.title_source],['代码 title',m.code_title||'不可读取或未提供'],
    ['订阅清单标题',m.manifest_title||'无'],['原始文件名',m.filename],['对外文件名',m.effective_filename||m.filename],['本地编号',m.id],
    ['代码内部 ID',m.metadata_id||'未读取到（不从加密内容猜测）'],['合集提供的模块标识',m.widget_id],
    ['订阅来源',m.subscription_title||'无'],['源地址',m.source_url||'无']];
  var h='<div style="max-height:55vh;overflow:auto;overflow-wrap:anywhere">';
  fields.forEach(function(f){h+='<div style="padding:8px 0;border-bottom:1px solid var(--card-brd)"><div style="font-size:12px;color:var(--text2)">'+esc(f[0])+'</div><div style="margin-top:3px;font-size:13px">'+esc(String(f[1]||''))+'</div></div>';});
  h+='<button class="btn btn-sm" style="margin-top:14px" onclick="copyModLink(\''+id+'\')">复制模块链接</button></div>';
  showModal('模块信息',h,function(close){close();});
}
async function doReplaceMod(input){
  var id=state.modReplaceId; state.modReplaceId=null;
  if(!input.files.length) return;
  try{await beginUploadPreview([input.files[0]],'',id);}catch(e){toast(e.message);}
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
  var busy=false;
  showModal('从链接导入模块 / 订阅合集',
    '<label>模块或合集 URL</label><input class="input" id="importUrl" placeholder="https://.../collection.rex 或 widget.js">'+
    '<p style="font-size:12px;color:var(--text2);line-height:1.7">自动识别合集，展开模块并按设置的间隔自动同步（默认 6 小时）。已有模块不重复导入；上游新增模块只进入模块库，除非你的合集启用了“自动包含全部模块”。</p>'+
    '<label>文件名（仅单个模块，可选）</label><input class="input" id="importFilename" placeholder="自动从 URL 提取">'+
    '<label>导入后的文件名（单模块，可修改）</label><input class="input" id="importEffectiveFilename" placeholder="填写 URL 后预览"><p class="icon-help" id="importNamePreview">合集内模块按同一清理规则自动命名。</p>'+
    '<label>新模块分组（已存在模块不移动）</label><select class="input" id="importGroup">'+groupOptions('')+'</select><p id="importProgress" style="font-size:12px;color:var(--text2)"></p>',
    async function(close){
      if(busy) return;
      var url = document.getElementById('importUrl').value.trim();
      if(!url){ toast('请输入 URL'); return; }
      var filename = document.getElementById('importFilename').value.trim();
      var gid = document.getElementById('importGroup').value;
      busy=true;
      var progress=document.getElementById('importProgress'); progress.textContent='正在读取链接…';
      try{
        var identified=await api('/api/admin/subscriptions/preview',{method:'POST',json:{url:url}});
        if(!identified||identified.error)throw Error(identified?identified.error:'链接识别失败');
        var used=document.getElementById('importEffectiveFilename'),effective=used.dataset.edited==='true'?used.value.trim():'';
        var decision=await chooseLinkDuplicate(identified);if(decision===null){progress.textContent='已取消导入';return;}
        var r = await api('/api/admin/modules/import', {method:'POST', timeout:120000, json:Object.assign({url:url, preview_id:identified.preview_id, filename:filename, effective_filename:effective, group_id:gid},decision)});
        if(!r||!r.ok) throw new Error(r?r.error:'导入失败');
        close();
        if(r.subscription){ state.tab='subscriptions'; await loadAll(); await syncSource(r.subscription.id); }
        else { toast('已导入'); await loadAll(); }
      }catch(e){ if(progress.isConnected)progress.textContent=e.message; toast(e.message); }
      finally{busy=false;}
    });
  var overlay=document.querySelector('.modal-overlay:last-child'),stamp=0,used=overlay.querySelector('#importEffectiveFilename');
  used.oninput=function(){used.dataset.edited='true';};
  var previewName=debounce(async function(){var n=++stamp,raw=overlay.querySelector('#importUrl').value.trim(),status=overlay.querySelector('#importNamePreview');if(!raw)return;
    try{var r=await api('/api/admin/subscriptions/preview',{method:'POST',json:{url:raw}});if(n!==stamp||!overlay.isConnected)return;if(!r||r.error)throw Error(r?r.error:'预览失败');if(used.dataset.edited!=='true'&&r.kind==='module')used.value=r.filename||'';status.textContent=r.kind==='collection'?'识别为合集 · '+r.total+' 个模块 · '+r.title:'识别为单模块 · '+r.title+(r.existing_module?' · 将更新已有模块':'');}catch(e){if(n===stamp)status.textContent=e.message;}},500);
  overlay.querySelector('#importUrl').addEventListener('input',previewName);overlay.querySelector('#importFilename').addEventListener('input',previewName);
}

var sourceSyncing={};
function sourceTime(t){ return t ? new Date(t).toLocaleString() : '尚未同步'; }
function renderSubscriptions(){
  var labels={idle:'待同步',syncing:'同步中',ok:'同步成功',partial:'部分失败',error:'同步失败'};
  document.getElementById('sourceCount').textContent='共 '+state.subscriptions.length+' 个订阅源';
  var h='';
  state.subscriptions.forEach(function(s){
    var sum=s.summary||{},busy=sourceSyncing[s.id];
    h+='<div class="card" style="padding:18px;overflow-wrap:anywhere"><div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(s.title)+'</strong><span style="font-size:12px;color:var(--text2)">'+(s.kind==='module'?'单模块订阅 · ':'合集订阅 · ')+(!s.enabled?'已暂停':(labels[s.status]||s.status))+'</span></div>'+
      '<div style="font-size:12px;color:var(--text2);margin:8px 0">'+esc(s.url)+'</div>'+
      '<div style="font-size:13px;line-height:1.8">已导入 '+s.imported+' / '+s.total+' 个 · 上游下架 '+s.removed+' 个<br>上次完成：'+esc(sourceTime(s.last_finished_at))+'<br>最近一轮：新增 '+(sum.added||0)+' · 更新 '+(sum.updated||0)+' · 未变化 '+(sum.unchanged||0)+' · 手动保留 '+(sum.manual||0)+' · 失败 '+(sum.failed||0)+'</div>'+
      (s.last_error?'<p style="color:#dc6b42;font-size:12px">'+esc(s.last_error)+'</p>':'')+
      '<p style="font-size:12px;color:var(--text2)" id="syncProgress-'+s.id+'">'+(busy?'正在同步…':s.status==='syncing'?'分批处理中，可点击继续同步；关闭页面后后台仍会继续':s.enabled?'下次检查：'+esc(sourceTime(s.next_sync_at)):'已暂停自动更新')+'</p>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm" onclick="showSourceItems(\''+s.id+'\')">查看模块</button><button class="btn btn-sm" onclick="editSubscription(\''+s.id+'\')">编辑</button>'+
      '<button class="btn btn-sm" '+(!s.enabled||busy?'disabled':'')+' onclick="syncSource(\''+s.id+'\')">'+(busy?'同步中…':s.status==='syncing'?'继续同步':'立即同步')+'</button>'+
      '<button class="btn btn-sm" onclick="toggleSource(\''+s.id+'\','+(!s.enabled?1:0)+')">'+(s.enabled?'暂停':'恢复')+'</button>'+
      '<button class="btn btn-sm" onclick="removeSource(\''+s.id+'\')">取消订阅</button></div></div>';
  });
  document.getElementById('subscriptionsList').innerHTML=h||'<div class="empty"><p>暂无订阅源，可添加合集或单模块链接</p></div>';
}
async function syncSource(id,action){
  if(sourceSyncing[id]) return;
  sourceSyncing[id]=true; renderSubscriptions();
  try{
    var done=false;
    while(!done){
      var r=await api('/api/admin/subscriptions/'+id+'/sync',{method:'POST',timeout:120000,json:{action:action||'continue'}});action='continue';
      if(!r||!r.ok) throw new Error(r?r.error:'同步连接失败，后台稍后会继续');
      done=r.done;
      var p=document.getElementById('syncProgress-'+id); if(p)p.textContent='已处理 '+r.processed+' / '+r.total+' 个模块';
    }
    toast(r.summary&&r.summary.failed?'同步完成，部分失败，请查看详情':'订阅同步完成');
    return r;
  }catch(e){toast(e.message);}
  finally{delete sourceSyncing[id]; await loadAll();}
}
async function toggleSource(id,enabled){
  try{var r=await api('/api/admin/subscriptions/'+id,{method:'PATCH',json:{enabled:enabled}}); if(!r||!r.ok)throw new Error(r?r.error:'操作失败'); await loadAll();}catch(e){toast(e.message);}
}
function removeSource(id){
  showConfirm('取消订阅？模块、分享链接和个人合集都会保留，只停止此来源的更新；其他启用的来源仍可能更新同一模块。',async function(ok){
    if(!ok)return;
    try{var r=await api('/api/admin/subscriptions/'+id,{method:'DELETE'}); if(!r||!r.ok)throw new Error(r?r.error:'操作失败'); await loadAll();}catch(e){toast(e.message);}
  });
}
async function showSourceItems(id){
  try{
    var rows=await api('/api/admin/subscriptions/'+id+'/items'); if(!Array.isArray(rows))throw new Error('加载失败');
    var h='<p style="font-size:12px;color:var(--text2)">已导入模块可在“合集 → 管理模块”中加入自己的合集。下架模块及旧版本均保留。</p><div style="max-height:55vh;overflow:auto">';
    rows.forEach(function(i){h+='<div style="padding:10px 0;border-bottom:1px solid var(--card-brd)"><strong>'+esc(i.local_title||i.title||i.remote_id)+'</strong><div style="font-size:12px;color:var(--text2);line-height:1.8">'+(!i.active?'上游已下架':i.module_id?'已导入 · '+esc(i.local_version||i.version||''):'未导入')+(i.last_error?'<br><span style="color:#dc6b42">'+esc(i.last_error)+'</span>':'')+'</div></div>';});
    showModal('订阅模块',h+'</div>',function(close){close();});
  }catch(e){toast(e.message);}
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
    h+='<div style="min-width:0"><div style="font-size:16px;font-weight:600">'+esc(c.title)+'</div><div style="font-size:12px;color:var(--text2);margin-top:3px">'+n+' 个模块'+(c.description?' · '+esc(c.description):'')+'</div></div></div>'+
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
    '<label>图标 URL</label><input class="input" id="colIcon" value="'+esc(col.icon_url||'')+'">',
    function(close){
      var slug=document.getElementById('colSlug').value.trim();
      var title=document.getElementById('colTitle').value.trim();
      if(!/^[A-Za-z0-9]+$/.test(slug)){ toast('路径只能填英文字母和数字'); return; }
      if(!title){ toast('请输入标题'); return; }
      api('/api/admin/collections',{method:'PATCH',json:{id:id,slug:slug,title:title,description:document.getElementById('colDesc').value.trim(),icon_url:document.getElementById('colIcon').value.trim()}}).then(function(r){
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
  var day=new Date().toISOString().slice(0,10);
  showModal('导出备份','<label>导出范围</label><select class="input" id="exportScope"><option value="all">全部（模块、合集、订阅、图标、首页、文件）</option><option value="core">只导出模块数据（不含首页和文件）</option><option value="homes">只导出首页配置</option><option value="files">只导出文件栏目</option></select><label>文件名</label><input class="input" id="exportName" value="fwh-backup-'+day+'" maxlength="120"><p style="font-size:12px;color:var(--text2);line-height:1.7">备份很大（接近 100 MB）时，可以分成「模块数据」「首页配置」「文件栏目」三份导出，再分别恢复。</p>',async function(close){
    var overlay=document.querySelector('.modal-overlay:last-child');
    var scope=overlay.querySelector('#exportScope').value,filename=overlay.querySelector('#exportName').value.trim();
    if(!filename){toast('请输入文件名');return;}
    var button=overlay.querySelector('#mC');if(button.disabled)return;button.disabled=true;button.textContent='正在导出…';
    try {
      var r = await fetch(org()+'/api/admin/backup?scope='+encodeURIComponent(scope), {credentials:'same-origin'});
      if(!r.ok){ toast('导出失败，未生成不完整备份'); return; }
      var blob = await r.blob();
      var link = URL.createObjectURL(blob), a = document.createElement('a');
      a.href=link; a.download=filename.replace(/\.json$/i,'')+({all:'',core:'-模块数据',homes:'-首页',files:'-文件'}[scope]||'')+'.json'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(link); }, 1000);
      close();
      toast(scope==='homes'?'已导出首页配置':scope==='files'?'已导出文件栏目':'已导出，模块 ID、订阅路径和加密文件完整保留');
    } catch(e){ toast('导出失败：'+e.message); }
    finally{ if(button.isConnected){button.disabled=false;button.textContent='导出';} }
  });
  var mC=document.querySelector('.modal-overlay:last-child #mC');if(mC)mC.textContent='导出';
}
function importBackup(){
  toast('恢复工具尚未加载，请刷新页面后重试');
}

async function changePassword(){
  var pwd = document.getElementById('pwdNew').value.trim();
  if (!pwd) { toast('请输入密码'); return; }
  if (pwd.length < 4) { toast('密码至少 4 位'); return; }
  var r = await api('/api/admin/change-password', {method:'POST', json:{password:pwd}});
  if (r && r.ok) { toast('密码已修改，下次登录生效'); document.getElementById('pwdNew').value = ''; }
  else toast(r ? r.error : '修改失败');
}


function clearAllData(){
  showConfirm('确定清除所有模块和合集？此操作不可撤销！', function(ok){
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
checkAuth();
</script>
<script>${zipUploadUI}</script>
<script>${managementUI}</script>
<script>${filenameUI}</script>
<script>${duplicatesUI}</script>
<script>${autoRulesUI}</script>
<script>${enhancementsUI}</script>
<script>${sharingUI}</script>
<script>${iconUI}</script>
<style>${restoreStyles}</style><script>${restoreUI}</script>
<style>${homeStyles}${filesStyles}</style><script>${filesUI}</script><script>${homeUI}</script>
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
   )`,
  ...subscriptionSchema,
  ...uploadSchema
];

const SCHEMA_READY = new WeakSet();
async function ensureSchema(env) {
  if (SCHEMA_READY.has(env.DB)) return;
  // Avoid re-running all DDL on every cold start (notably minute cron invocations).
  let installed = null;
  try {
    installed = await env.DB.prepare("SELECT value FROM settings WHERE key='schema_titles_v4'").first();
  } catch (e) { if (!String(e.message).includes('no such table')) throw e; }
  if (installed?.value === '1') { await ensureCostIndexes(env); SCHEMA_READY.add(env.DB); return; }
  await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql)));
  const columns = await env.DB.prepare('PRAGMA table_info(modules)').all();
  const names = new Set((columns.results || []).map(c => c.name));
  for (const definition of ["group_id TEXT DEFAULT ''", "sort_order INTEGER DEFAULT 0",
    "content_hash TEXT DEFAULT ''", "required_version TEXT DEFAULT '0.0.1'", "source_managed INTEGER DEFAULT 0",
    "manual_override INTEGER DEFAULT 0", "file_key TEXT DEFAULT ''", "metadata_id TEXT DEFAULT ''",
    "code_title TEXT DEFAULT ''", "manifest_title TEXT DEFAULT ''", "title_locked INTEGER DEFAULT 0",
    "generated_filename INTEGER DEFAULT 0", "title_scan_v1 INTEGER DEFAULT 0", "link_checked_at INTEGER DEFAULT 0",
    "link_etag TEXT DEFAULT ''", "link_last_modified TEXT DEFAULT ''"]) {
    if (names.has(definition.split(' ')[0])) continue;
    try { await env.DB.prepare('ALTER TABLE modules ADD COLUMN ' + definition).run(); }
    catch (e) { if (!String(e.message).includes('duplicate column')) throw e; }
  }
  // backfillTitles 每轮 cron 都查 title_scan_v1<>1（扫完后也一样），没有索引就是全表扫。
  // 注意：不能放进上面的 SCHEMA 数组——列是后面循环才补的，放前面会因列不存在而失败。
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_modules_title_scan ON modules(title_scan_v1, created_at, id)').run();
  await env.DB.prepare(`UPDATE modules SET generated_filename=1 WHERE filename=id||'.js'
    AND EXISTS (SELECT 1 FROM subscription_items i WHERE i.module_id=modules.id)`).run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('schema_titles_v4','1')").run();
  await ensureCostIndexes(env);
  SCHEMA_READY.add(env.DB);
}

// 3.6.0：省用量用的索引。旧站已经有 schema_titles_v4 标记、不会再跑上面的建表流程，所以单独用一个标记，
// 升级上来的站第一次打开时也会补上。
// 链接模块自动刷新只读「单链接模块」里到点的那几个；自动分类用 created_at 判断有没有新模块。
// 表达式必须和 autoRefreshLinkModules 里的查询逐字一致，SQLite 才会用这个索引。
async function ensureCostIndexes(env) {
  const done = await env.DB.prepare("SELECT value FROM settings WHERE key='schema_cost_v360'").first();
  if (done?.value === '1') return;
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_modules_title_scan ON modules(title_scan_v1, created_at, id)').run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_modules_link_due ON modules(MAX(updated_at,COALESCE(link_checked_at,0)))
    WHERE source_url IS NOT NULL AND source_url != '' AND source_managed=0 AND manual_override=0`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_modules_created ON modules(created_at)').run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('schema_cost_v360','1')").run();
}

const BOOT = new WeakMap();
export async function bootstrap(env) {
  if (!BOOT.has(env.DB)) BOOT.set(env.DB,(async()=>{
    await migrateDocker(env);
    await ensureSchema(env);
    await env.DB.batch(iconSchema.map(sql=>env.DB.prepare(sql)));
    await env.DB.batch(filenameSchema.map(sql=>env.DB.prepare(sql)));
    await migrateSources(env);
    await env.DB.batch(sharingSchema.map(sql=>env.DB.prepare(sql)));
    await upgradeSubscriptions(env);
    // Independent, idempotent 3.5 migration: never gated by the old 3.3/3.4 flag.
    await env.DB.batch(enhancementSchema.map(sql=>env.DB.prepare(sql)));
    await env.DB.batch(homeSchema.map(sql=>env.DB.prepare(sql)));
    await migrateHomes(env);
    await env.DB.batch(fileSchema.map(sql=>env.DB.prepare(sql)));
  })());
  try { await BOOT.get(env.DB); } catch(e) { BOOT.delete(env.DB); throw e; }
}

let LEGACY_READY = false;
async function migrateLegacyKV(env) {
  if (LEGACY_READY) return { skipped: true };
  const flag = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('migrated_v1').first();
  if (flag) { LEGACY_READY = true; return { skipped: true }; }

  let legacyMods = null, legacyCols = null;
  try {
    legacyMods = await env.KV.get('modules', 'json');
    legacyCols = await env.KV.get('collections', 'json');
  } catch (e) {  }

  const stmts = [];
  let modCount = 0, colCount = 0, linkCount = 0;

  if (Array.isArray(legacyMods)) {
    for (const m of legacyMods) {
      if (!m || !m.id) continue;
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO modules
           (id, filename, widget_id, title, version, author, file_size, is_encrypted, source_url, note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        m.id, m.filename || '', m.widget_id || m.id, m.title || '', m.version || '',
        m.author || '', m.file_size || 0, m.is_encrypted ? 1 : 0,
        m.source_url || null, m.note || '',
        m.created_at || Date.now(), m.updated_at || Date.now()
      ));
      modCount++;
    }
  }

  if (Array.isArray(legacyCols)) {
    for (const c of legacyCols) {
      if (!c || !c.id) continue;
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO collections (id, slug, title, description, icon_url, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(c.id, c.slug || c.id, c.title || 'untitled', c.description || '',
             c.icon_url || '', c.created_at || Date.now(), c.updated_at || Date.now()));
      colCount++;
      const ids = c.moduleIds || (Array.isArray(c.modules) ? c.modules.map(x => x.id) : []);
      ids.forEach((mid, i) => {
        if (!mid) return;
        stmts.push(env.DB.prepare(
          'INSERT OR IGNORE INTO collection_modules (collection_id, module_id, position) VALUES (?,?,?)'
        ).bind(c.id, mid, i));
        linkCount++;
      });
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind('migrated_v1', String(Date.now())).run();

  LEGACY_READY = true;
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
    // Bound memory without erasing every active lockout.
    while(_loginAttempts.size>LOGIN_MAP_CAP)_loginAttempts.delete(_loginAttempts.keys().next().value);
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

let SORT_READY = false;
async function migrateSortOrder(DB) {
  if (SORT_READY) return;
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
  SORT_READY = true;
}

let MAINT_READY = false;
const MAINT_BATCH = 8;
const MAINT_MAX_BYTES = 1024 * 1024;
const ENC_FLAG_KEY = 'enc_heuristic_v';
const ENC_CURSOR_KEY = 'enc_scan_cursor';
async function autoMaintain(env, DB) {
  if (MAINT_READY) return;
  MAINT_READY = true;
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
    getFileKey(env,r.id).then(key=>env.KV.get(key,'arrayBuffer')).catch(() => null)));
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
  if (stored && stored.indexOf('pbkdf2$') === 0) {
    const p = stored.split('$');
    if (p.length !== 4) return false;
    const iter = parseInt(p[1], 10) || PBKDF2_ITER;
    const h = await pbkdf2Hex(password, hexToBytes(p[2]), iter);
    return safeEqualHex(h, p[3]);
  }
  if (stored?.startsWith('legacy-sha256$')) return safeEqualHex(await sha256(password), stored.slice(14));
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
function assertFetchableUrl(raw, env) { return env?.SOURCE_URL_POLICY?.assertUrl(raw) || safeRemoteUrl(raw); }
async function fetchCapped(rawUrl, maxBytes, env, info) {
  const file=await fetchRemote(rawUrl,maxBytes,{transport:env?.REMOTE_FETCH||globalThis.fetch,signal:env?.SHUTDOWN_SIGNAL,
    assertUrl:raw=>assertFetchableUrl(raw,env)});
  if(info)Object.assign(info,file);
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
    'Content-Security-Policy': "default-src 'self'; manifest-src 'self'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const appResource = pwaResponse(request);
    if (appResource) return appResource;

    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie, If-None-Match',
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
    const cookieSecure = url.protocol === 'https:' ? '; Secure' : '';

    try {

    if(path.startsWith('/api/icons/')){
      if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
      return iconResponse(env,path,request);
    }
    if(path==='/api/admin/icon-sources'||path.startsWith('/api/admin/icon-sources/')||path==='/api/admin/icons'||path.startsWith('/api/admin/icons/')){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      try{
        if(path==='/api/admin/icon-sources'){
          if(method==='GET')return json(await listIconSources(env));
          if(method==='POST')return json(await addIconSource(env,await request.json()),201);
        }
        const source=path.match(/^\/api\/admin\/icon-sources\/([A-Za-z0-9-]+)(\/refresh)?$/);
        if(source){if(source[2]&&method==='POST')return json({ok:true,...await refreshIconSource(env,source[1])});
          if(!source[2]&&method==='PATCH')return json(await changeIconSource(env,source[1],await request.json()));
          if(!source[2]&&method==='DELETE')return json(await deleteIconSource(env,source[1]));}
        if(path==='/api/admin/icons'&&method==='GET')return json(await queryIcons(env,url.searchParams));
        if(path==='/api/admin/icons/upload'&&method==='POST'){
          const form=await request.formData().catch(()=>null),file=form?.get('file');
          if(!file||typeof file.arrayBuffer!=='function')throw Error('请选择图片');
          if(file.size>ICON_LIMITS.image)throw Error('图片超过 2 MiB');
          return json({ok:true,...await uploadIcon(env,new Uint8Array(await file.arrayBuffer()),file.type||'')});
        }
        const entry=path.match(/^\/api\/admin\/icons\/([a-f0-9]{64})\/cache$/);
        if(entry&&method==='POST')return json({ok:true,...await cacheIcon(env,entry[1])});
        return json({error:'Method not allowed'},405);
      }catch(error){return json({error:error.message},400);}
    }


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
      const { results } = await DB.prepare(`SELECT m.*,s.subscription_title,s.upstream_active,s.subscription_collection,s.subscription_module
        FROM modules m LEFT JOIN (SELECT i.module_id,MIN(s.title) AS subscription_title,MAX(i.active) AS upstream_active,
          MAX(CASE WHEN s.kind='collection' THEN 1 ELSE 0 END) AS subscription_collection,
          MAX(CASE WHEN s.kind='module' THEN 1 ELSE 0 END) AS subscription_module
          FROM subscription_items i JOIN subscription_sources s ON s.id=i.source_id GROUP BY i.module_id) s ON s.module_id=m.id
        ORDER BY m.sort_order ASC,m.created_at DESC`).all();
      return decorateNames(env,(results || []).map(r => ({ ...r,
        hide_filename:generatedFilename(r),is_encrypted: Number(r.is_encrypted) || 0 })));
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
      return (cols || []).map(c => ({ ...JSON.parse(c.legacy_json || '{}'), ...c, autoAll:!!c.auto_all, moduleIds: map[c.id] || [] }));
    }

    async function ensureUniqueSlug(base, excludeId) {
      let slug = base, n = 2;
      while (true) {
        const hit = await DB.prepare('SELECT id FROM collections WHERE slug = ?').bind(slug).first();
        const taken = hit && (!excludeId || hit.id !== excludeId);
        const alias = taken ? null
          : await DB.prepare('SELECT 1 AS x FROM collection_aliases WHERE slug = ?').bind(slug).first();
        if (!taken && !alias) return slug;
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
      return replaceMembers(env,colId,ids);
    }


    if(path.startsWith('/api/admin/home-configs')||path.startsWith('/api/home-configs/'))return await homeResponse(env,request,verifyAuth);
    if(path.startsWith('/api/admin/files')||path.startsWith('/api/files/'))return await fileResponse(env,request,verifyAuth);

    if (path === '/api/admin/auth') {
      if (method === 'GET') {
        return json({ enabled: !!(env.ADMIN_PASSWORD || await adminPasswordRow()), authenticated: await verifyAuth(request) });
      }
      if (method === 'POST') {
        const _ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!_loginAllowed(_ip, DB)) return json({ error: '尝试次数过多，请 5 分钟后再试' }, 429);
        const { password,username } = await request.json().catch(() => ({}));
        const adminName=env.NAS_MODE&&(await DB.prepare("SELECT value FROM settings WHERE key='nas_admin_username'").first())?.value;
        if(adminName&&String(username||'').normalize('NFKC').trim()!==adminName)return json({error:'用户名或密码错误'},401);
        if (!password) return json({ error: '密码不能为空' }, 400);
        const prow = await adminPasswordRow();
        const stored = (prow && prow.value) ? prow.value : '';
        let passed = await verifyPassword(password, stored, env.ADMIN_PASSWORD), rotated = false;
        // 忘记密码时可以在 Cloudflare 改 ADMIN_PASSWORD 机密来重置：
        // 只有机密真的换过（与上次登录时记下的指纹不同）才接受新机密，旧机密不会因此复活。
        const envFp = env.ADMIN_PASSWORD ? await sha256(env.ADMIN_PASSWORD) : '';
        const fpRow = envFp ? await DB.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_env_fp').first() : null;
        if (!passed && envFp && fpRow && fpRow.value !== envFp && safeEqualHex(await sha256(password), envFp)) {
          passed = true; rotated = true;
        }
        if (!passed) {
          return json({ error: '密码错误' }, 401);
        }
        if (!stored || stored.indexOf('pbkdf2$') !== 0 || rotated) {
          try {
            await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
              .bind('admin_password', await hashPassword(password)).run();
          } catch (e) {}
        }
        if (envFp && (!fpRow || rotated)) {
          try { await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('admin_env_fp', envFp).run(); } catch (e) {}
        }
        if (rotated) await DB.prepare('DELETE FROM sessions').run();
        const token = genId() + genId().replace(/-/g, '');
        const now = Date.now(), exp = now + 86400000 * 7;
        await DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
        await DB.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)')
          .bind(token, now, exp).run();
        loginStore(DB).delete(_ip);
        return json({ ok: true }, 200, {
          'Set-Cookie': 'fwh_admin=' + token + '; Path=/; HttpOnly' + cookieSecure + '; SameSite=Strict; Max-Age=' + (86400 * 7)
        });
      }
    }


    if (path === '/api/admin/backup') {
      if (!await verifyAuth(request)) return json({error:'Unauthorized'},401);
      if (method !== 'GET') return json({error:'Method not allowed'},405);
      const scope=url.searchParams.get('scope')||'all';
      if(!BACKUP_SCOPES.includes(scope))return json({error:'无效的导出范围'},400);
      const backup=await env.ATOMIC(()=>exportBackup(env,{scope}));
      return new Response(backupStream(backup),{headers:{'Content-Type':'application/json; charset=utf-8'}});
    }
    if (path === '/api/admin/backup/restore') {
      if (!await verifyAuth(request)) return json({error:'Unauthorized'},401);
      if (method !== 'POST') return json({error:'Method not allowed'},405);
      const body=await request.json().catch(()=>null);
      if(!body||typeof body!=='object')return json({error:'备份文件不是有效的 JSON'},400);
      const full=url.searchParams.get('mode')==='full';
      try { const prepared=await prepareBackup(body,parseMeta,isEncrypted);return json(await env.ATOMIC(async()=>{if(full)await resetAllData(env,fullResetPlan(body));return {...await restoreBackup(env,body,parseMeta,isEncrypted,prepared),mode:full?'full':'merge'};})); }
      catch(e) { return json({error:e.message},400); }
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

        const report = { skipped:true, message:'已原位迁移，不重新导入历史留档' };
        return json({ ok: true, report });
      }
    }


    if(path==='/api/admin/modules/bulk'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='POST')return json({error:'Method not allowed'},405);
      try{return json(await bulkManage(env,await request.json()));}
      catch(e){return json({error:String(e.message||e)},400);}
    }
    const membersMatch=path.match(/^\/api\/admin\/collections\/([^/]+)\/members$/);
    if(membersMatch){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='PUT')return json({error:'Method not allowed'},405);
      try{const body=await request.json();if(!Array.isArray(body.expectedModuleIds))throw Error('请重新打开合集管理窗口');
        return json(await replaceMembers(env,membersMatch[1],body.moduleIds,body.expectedModuleIds));}
      catch(e){return json({error:String(e.message||e)},409);}
    }
    if(path==='/api/admin/modules/scan-titles'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='POST')return json({error:'Method not allowed'},405);
      return json(await backfillTitles(env,2));
    }
    if(path==='/api/admin/filename-preview'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='POST')return json({error:'Method not allowed'},405);
      try{const body=await request.json(),u=assertFetchableUrl(body.url,env);
        if(/\.(rex|fwd)$/i.test(u.pathname))return json({ok:true,collection:true,suggested:''});
        let original=String(body.filename||urlFilename(u.href,'import.js'));if(!/\.js$/i.test(original))original+='.js';
        const id=toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(u.href))));
        const n=await prepareName(env,id,original);return json({ok:true,original,suggested:n.filename});
      }catch(e){return json({error:String(e.message||e)},400);}
    }
    if(path==='/api/admin/sync-interval'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method==='GET')return json({ok:true,hours:await syncIntervalHours(env),options:SYNC_INTERVAL_HOURS});
      if(method!=='PUT')return json({error:'Method not allowed'},405);
      try{const body=await request.json();return json(await env.ATOMIC(()=>setSyncInterval(env,Number(body?.hours))));}
      catch(e){return json({error:String(e.message||e)},400);}
    }
    if(path==='/api/admin/filename-settings'||path==='/api/admin/modules/filenames'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      try{
        if(path.endsWith('filename-settings')){
          if(method==='GET')return json(await namingSettings(env));
          if(method!=='PATCH')return json({error:'Method not allowed'},405);
          const body=await request.json();if(typeof body.auto_clean!=='boolean')throw Error('配置无效');
          await DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('filename_auto_clean',?)").bind(String(body.auto_clean)).run();
          return json({ok:true,...await namingSettings(env)});
        }
        if(method==='GET')return env.ATOMIC(async()=>json(await scanNames(env)));
        if(method==='POST')return json(await repairNames(env,(await request.json()).rows));
        return json({error:'Method not allowed'},405);
      }catch(e){return json({error:String(e.message||e)},409);}
    }
    if(path==='/api/admin/auto-rules'||path==='/api/admin/auto-rules/preview'||path==='/api/admin/auto-rules/run'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      try{
        if(path.endsWith('/preview')&&method==='POST')return json(await previewAutoRules(env));
        if(path.endsWith('/run')&&method==='POST')return json(await runAutoRules(env,await request.json()));
        if(path==='/api/admin/auto-rules'&&method==='GET')return json(await loadAutoRules(env));
        if(path==='/api/admin/auto-rules'&&method==='PUT')return json(await saveAutoRules(env,await request.json()));
        return json({error:'Method not allowed'},405);
      }catch(e){return json({error:e.message},409);}
    }
    if(path==='/api/admin/modules/duplicates'||path==='/api/admin/modules/duplicates/delete'||path==='/api/admin/modules/duplicates/ignore'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      const ignoring=path.endsWith('/ignore'),deleting=path.endsWith('/delete')||ignoring;
      if(method!==(deleting?'POST':'GET'))return json({error:'Method not allowed'},405);
      try{
        const body=deleting?await request.json():null;
        const work=()=>ignoring?ignoreDuplicateGroup(env,body):deleting?deleteScannedDuplicate(env,body):scanDuplicateModules(env);
        return json(await env.ATOMIC(work),200,{'Cache-Control':'no-store'});
      }catch(e){return json({error:String(e.message||e)},deleting?409:500,{'Cache-Control':'no-store'});}
    }
    const downloadMatch=path.match(/^\/api\/admin\/modules\/([^/]+)\/download$/);
    if(downloadMatch){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='GET')return json({error:'Method not allowed'},405);
      return env.ATOMIC(async()=>{
        const mod=await getModule(downloadMatch[1]);if(!mod)return json({error:'模块不存在'},404);
        const bytes=await env.KV.get(mod.file_key||'file:'+mod.id,'arrayBuffer');
        if(!bytes)return json({error:'模块文件缺失，无法下载'},404);
        const m=await decorateNameOne(env,mod);
        return new Response(bytes,{headers:{'Content-Type':'application/javascript; charset=utf-8',
          'Content-Disposition':contentDisposition(downloadFilename(m),true),'Content-Length':String(bytes.byteLength),
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      });
    }
    if (path === '/api/admin/modules/upload/preview' || path === '/api/admin/modules/upload/commit') {
      if (!await verifyAuth(request)) return json({error:'Unauthorized'},401);
      if (method!=='POST') return json({error:'Method not allowed'},405);
      try {
        if (Number(request.headers.get('Content-Length')||0)>51*1024*1024) throw new Error('一批上传总大小不能超过 50 MB');
        const fd=await request.formData();
        if(path.endsWith('/preview')) {
          const files=fd.getAll('files').filter(f=>f instanceof File && f.name);
          return json(await previewUploads(env,files,String(fd.get('group_id')||''),uploadHelpers,String(fd.get('target_id')||'')));
        }
        return json(await commitUpload(env,{job_id:String(fd.get('job_id')||''),index:Number(fd.get('index')),
          action:String(fd.get('action')||''),target_id:String(fd.get('target_id')||''),
          filename:fd.has('filename')?String(fd.get('filename')):undefined,
          mode:String(fd.get('mode')||''),version:fd.has('version')?String(fd.get('version')):'',file:fd.get('file')},uploadHelpers));
      }catch(e){return json({error:String(e.message||e)},400);}
    }
    const versionMatch=path.match(/^\/api\/admin\/modules\/([^/]+)\/(previous-version|maintenance)$/);
    if(versionMatch){
      if (!await verifyAuth(request)) return json({error:'Unauthorized'},401);
      const id=versionMatch[1];
      try{
        if(versionMatch[2]==='previous-version'){
          if(method==='GET')return json({ok:true,previous:await previousVersion(env,id)});
          if(method==='POST'){
            const body=await request.json();return json(await restorePrevious(env,id,body.created_at));
          }
        }else if(method==='PATCH'){
          const body=await request.json();
          return json(await withModuleLock(env,'module:'+id,async()=>{
            const m=await getModule(id);if(!m)throw new Error('模块不存在');
            await DB.prepare('UPDATE modules SET manual_override=? WHERE id=?').bind(body.manual?1:0,id).run();
            if(!body.manual) await DB.prepare(`UPDATE subscription_sources SET next_sync_at=0 WHERE id IN
              (SELECT source_id FROM subscription_items WHERE module_id=?)`).bind(id).run();
            return {ok:true};
          }));
        }
        return json({error:'Method not allowed'},405);
      }catch(e){return json({error:String(e.message||e)},400);}
    }

    const shareMatch=path.match(/^\/api\/admin\/modules\/([^/]+)\/share(?:\/(preview))?$/);
    if(shareMatch){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(!((shareMatch[2]&&method==='POST')||(!shareMatch[2]&&method==='PUT')))return json({error:'Method not allowed'},405);
      try{const body=await request.json();return await env.ATOMIC(async()=>json(shareMatch[2]?await previewShare(env,shareMatch[1],body.alias):await saveShare(env,shareMatch[1],body)));}
      catch(e){return json({error:e.message},409);}
    }
    if(path==='/api/admin/subscriptions/preview'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(method!=='POST')return json({error:'Method not allowed'},405);
      try{const body=await request.json();return json(await previewSource(env,body.url,subscriptionHelpers(env)));}catch(e){return json({error:e.message},400);}
    }
    if(path==='/api/admin/subscriptions/legacy'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(!['GET','POST'].includes(method))return json({error:'Method not allowed'},405);
      try{const body=method==='POST'?await request.json():null;return await env.ATOMIC(async()=>json(await legacySources(env,body)));}catch(e){return json({error:e.message},409);}
    }
    if(path==='/api/admin/storage'&&method==='GET'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      if(typeof env.STORAGE_USAGE!=='function')return json({ok:true,used:0,limit:0,note:'当前运行环境不提供存储用量'});
      const usage=env.STORAGE_USAGE();
      return json({ok:true,used:usage.used,limit:usage.limit,plan:usage.plan||''});
    }
    if(path==='/api/admin/subscriptions/sync-failed'&&method==='POST'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      // 3.5.8：只把出错或部分失败的来源排进队列；部分失败的合集只重下失败的模块。
      const {results:failed}=await DB.prepare(FAILED_SOURCES_SQL).bind(Date.now()).all();
      const ids=(failed||[]).map(s=>s.id);
      if(ids.length)await DB.prepare('UPDATE subscription_sources SET next_sync_at=0 WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run();
      return json({ok:true,queued:ids.length,sources:(failed||[]).map(s=>({id:s.id,retry:s.status==='partial'&&s.kind!=='module'}))});
    }
    if(path==='/api/admin/subscriptions/sync-all'&&method==='POST'){
      if(!await verifyAuth(request))return json({error:'Unauthorized'},401);
      const queued=await DB.prepare('UPDATE subscription_sources SET next_sync_at=0 WHERE enabled=1').run();
      return json({ok:true,queued:queued.meta.changes});
    }
    if (path === '/api/admin/subscriptions') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method === 'GET') return json(await listSubscriptions(env));
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try {
          return json(await importLink(env,body));
        } catch(e) { return json({error:String(e.message||e),...(e.candidates?{candidates:e.candidates,duplicate_token:e.duplicate_token}:{})},e.status||400); }
      }
      return json({error:'Method not allowed'},405);
    }
    const subscriptionMatch = path.match(/^\/api\/admin\/subscriptions\/([^/]+)(?:\/(sync|items|icon))?$/);
    if (subscriptionMatch) {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const id=subscriptionMatch[1], operation=subscriptionMatch[2];
      if (operation==='items' && method==='GET') return json(await subscriptionItems(env,id));
      if (operation==='sync' && method==='POST') {
        try { const body=await request.json().catch(()=>({}));return json(await syncSubscription(env,id,body.action==='retry'?'retry':'continue',subscriptionHelpers(env))); }
        catch(e) { return json({error:String(e.message||e)},400); }
      }
      const source=await DB.prepare('SELECT * FROM subscription_sources WHERE id=?').bind(id).first();
      if (!source) return json({error:'Not found'},404);
      if(operation==='icon'){
        if(method!=='PATCH')return json({error:'Method not allowed'},405);
        try{return json(await changeSubscriptionIcon(env,source,(await request.json())||{}));}
        catch(e){return json({error:e.message},e.message.includes('已变化')||e.message.includes('已取消')?409:400);}
      }
      if (!operation && method==='PATCH') {
        const body=await request.json().catch(()=>({}));
        if(body.url!==undefined||body.title!==undefined){try{return await env.ATOMIC(async()=>{const current=await DB.prepare('SELECT * FROM subscription_sources WHERE id=?').bind(id).first();if(!current||current.lease_until>Date.now())throw Error('订阅正在同步或已取消，请稍后操作');return json(await editSource(env,current,body,subscriptionHelpers(env)));});}catch(e){return json({error:e.message},409);}}
        await DB.prepare("UPDATE subscription_sources SET enabled=?,next_sync_at=0,lease_until=0,lease_token='',revision=? WHERE id=?")
          .bind(body.enabled?1:0,crypto.randomUUID(),id).run();
        return json({ok:true});
      }
      if (!operation && method==='DELETE') {
        await DB.batch([
          DB.prepare('DELETE FROM subscription_items WHERE source_id=?').bind(id),
          DB.prepare('DELETE FROM subscription_sources WHERE id=?').bind(id)
        ]);
        return json({ok:true});
      }
      return json({error:'Method not allowed'},405);
    }

    if (path === '/api/admin/modules/import') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await request.json().catch(() => ({}));
      if (!body.url) return json({ error: 'url required' }, 400);
      try {
        return json(await importLink(env,body),201);
      } catch (e) {
        return json({ error: String((e && e.message) || e),...(e.candidates?{candidates:e.candidates,duplicate_token:e.duplicate_token}:{}) }, e.status||400);
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
        const buf = await env.KV.get(mod.file_key||'file:'+sid, 'arrayBuffer');
        if (!buf) return json({ error: 'File not found' }, 404);
        return json({
          ok: true, id: sid, filename: mod.filename,
          content: new TextDecoder().decode(buf),
          size: buf.byteLength, source_url: mod.source_url || null
        });
      }

      if (method === 'PUT' || method === 'POST') {
        return await withModuleLock(env,'module:'+sid,async()=>{
        const mod=await getModule(sid);
        if(!mod)return json({error:'Not found'},404);
        let name = '', code = '';
        const ctype = request.headers.get('Content-Type') || '';
        if (ctype.indexOf('application/json') >= 0) {
          const body = await request.json().catch(() => ({}));
          name = String(body.name || body.filename || '');
          code = typeof body.code === 'string' ? body.code : '';
        } else {
          const fd = await request.formData();
          name = String(fd.get('name') || fd.get('filename') || '');
          code = String(fd.get('code') || '');
        }
        if (!code.trim()) return json({ error: '内容不能为空' }, 400);


        code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (code.length > MAX_SOURCE_BYTES) return json({ error: '源码超过 3 MB，请改用上传方式' }, 413);
        const filename = (name || mod.filename || 'module.js').replace(/[\/\\]/g, '_').trim();
        if (!/\.js$/i.test(filename)) return json({ error: '文件名需要 .js 结尾' }, 400);

        const buf = new TextEncoder().encode(code);
        const head = new Uint8Array(buf.slice(0, METADATA_SCAN_BYTES));
        const meta = parseMeta(filename, head);
        const title = resolveTitle({...mod,filename},meta.title,mod.manifest_title);
        const now = Date.now();
        const enc = isEncrypted(head);
        await putFile(env, sid, buf, now);
        await DB.prepare(
          `UPDATE modules SET filename = ?, widget_id = ?, metadata_id = ?, title = ?, version = ?, author = ?,
             file_size = ?, is_encrypted = ?, updated_at = ?, content_hash = '', file_key='',code_title=?,title_scan_v1=1,
             generated_filename=0 WHERE id = ?`
        ).bind(
          filename, meta.id || mod.widget_id || mod.id, meta.id || '', title, meta.version || '', meta.author || '',
          buf.byteLength, enc, now,cleanTitle(meta.title), sid
        ).run();
        const naming=await prepareName(env,sid,mod.filename,{existing:true});
        naming.originals=JSON.stringify([...new Set([...JSON.parse(naming.originals),filename])]);
        await nameStatement(env,naming).run();
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
        });
      }
      return json({ error: 'Method not allowed' }, 405);
    }


    if (path === '/api/admin/modules') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);

      if (method === 'GET') return json(await getModules());

      if (method === 'POST') {
        // Compatibility for the backup importer, which already asks for confirmation.
        const fd=await request.formData();
        const files=fd.getAll('files').filter(f=>f instanceof File && f.name);
        if(files.length!==1)return json({error:'批量上传请使用新版上传预览'},428);
        try{
          const preview=await previewUploads(env,files,String(fd.get('group_id')||''),uploadHelpers);
          const row=preview.rows[0];
          if(row.kind==='invalid'||row.kind==='conflict'||row.target?.subscribed)
            return json({error:row.reason||'该模块需要选择替换目标或自动更新方式，请使用上传预览'},409);
          const result=await commitUpload(env,{job_id:preview.job_id,index:0,
            action:row.target?'replace':'new',target_id:row.target?.id,file:files[0]},uploadHelpers);
          return json({...result,added:result.status==='added'?[{id:result.module_id}]:[],replaced:result.status==='replaced'?[{id:result.module_id}]:[]});
        }catch(e){return json({error:String(e.message||e)},400);}
      }

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'id required' }, 400);
        return await withModuleLock(env,'module:'+id,async()=>{
        const mod = await getModule(id);
        if (!mod) return json({ error: 'Not found' }, 404);
        const requestedTitle=cleanTitle(pickStr(body.title,mod.title,500));
        const locked=body.title_locked===undefined?(body.title!==undefined?1:mod.title_locked):(body.title_locked?1:0);
        if(locked&&!requestedTitle)return json({error:'锁定标题不能为空'},400);
        const title=resolveTitle({...mod,title:requestedTitle,title_locked:locked});
        const version = pickStr(body.version, mod.version, 64);
        const author = pickStr(body.author, mod.author, 120);
        const note = pickStr(body.note, mod.note, 1000);
        const enc = body.is_encrypted === undefined
          ? (Number(mod.is_encrypted) || 0)
          : (body.is_encrypted ? 1 : 0);
        await DB.prepare(
          `UPDATE modules SET title = ?, version = ?, author = ?, note = ?, is_encrypted = ?, updated_at = ?,title_locked=?,
            title_scan_v1=CASE WHEN title_scan_v1=0 THEN -1 ELSE title_scan_v1 END WHERE id = ?`
        ).bind(title, version, author, note, enc, Date.now(),locked, id).run();
        return json({ ok: true });
        });
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
        const preview=await previewUploads(env,[file],'',uploadHelpers,id);
        try{return json(await commitUpload(env,{job_id:preview.job_id,index:0,action:'replace',target_id:id,
          mode:String(fd.get('mode')||''),file},uploadHelpers));}
        catch(e){return json({error:String(e.message||e)},400);}
      }

      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if(!id)return json({error:'id required'},400);
        return json(await deleteModule(env,id));
      }
    }


    const refreshMatch = path.match(/^\/api\/admin\/modules\/([^\/]+)\/refresh$/);
    if (refreshMatch && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      const modId = refreshMatch[1];
      const mod = await getModule(modId);
      if (!mod) return json({ error: 'Not found' }, 404);
      if (!mod.source_url) return json({ error: 'No source URL' }, 400);
      if (mod.source_managed) {
        const source=await DB.prepare("SELECT s.id FROM subscription_sources s JOIN subscription_items i ON i.source_id=s.id WHERE i.module_id=? AND s.kind='module' AND s.enabled=1 ORDER BY s.created_at LIMIT 1").bind(mod.id).first();
        if(!source)return json({error:'此模块由订阅管理，请在“订阅”页检查来源并点击“立即同步”'},400);
        try{return json(await syncSubscription(env,source.id,'continue',subscriptionHelpers(env)));}
        catch(e){return json({error:String(e.message||e)},400);}
      }
      try {
        await refreshModuleFromSource(env, mod, true);
        return json({ ok: true });
      } catch (e) {
        const msg = String((e && e.message) || e);
        return json({ error: msg.indexOf('Failed to fetch') === 0 ? msg : 'Refresh failed: ' + msg }, 400);
      }
    }


    if (path === '/api/admin/reset' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      return env.ATOMIC(async()=>json({ ok: true, ...await resetAllData(env) }));
    }

    if (path === '/api/admin/change-password' && method === 'POST') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);
      if(env.NAS_MODE)return json({error:'请在 /admin 账号设置中验证当前密码后修改'},400);
      const body = await request.json().catch(() => ({}));
      if (!body.password || String(body.password).length < 8 || String(body.password).length>256) return json({ error: '密码必须为 8–256 字符' }, 400);
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
      try{return json(await bulkManage(env,{action:'group',ids:body.moduleIds||[body.moduleId],groupId:body.groupId||''}));}
      catch(e){return json({error:String(e.message||e)},400);}
    }


    if (path === '/api/admin/collections') {
      if (!await verifyAuth(request)) return json({ error: 'Unauthorized' }, 401);

      if (method === 'GET') return json(await getCollections());

      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const title = (body.title || '').trim();
        if (!title) return json({ error: 'title required' }, 400);
        const slugInput = (body.slug || '').trim();
        if (!slugInput) return json({ error: '路径必填' }, 400);
        if (!/^[A-Za-z0-9]+$/.test(slugInput)) return json({ error: '路径只能是英文字母和数字' }, 400);
        const now = Date.now();
        const id = genId();
        const desc = pickStr(body.description, '', 2000);
        let iconChoice;try{iconChoice=await prepareCollectionIcon(env,body,null);}catch(error){return json({error:error.message},400);}
        const icon = iconChoice?.url || '';
        const initialIds=body.moduleIds===undefined?[]:await validatedMembers(DB,body.moduleIds);
        let slug = await ensureUniqueSlug(slugInput);
        await env.ATOMIC(async()=>{await assertStoredIcon(env,icon);for (let attempt = 0; ; attempt++) {
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
        if (initialIds.length) {
          await setCollectionModules(id, initialIds);
        }
        });
        return json({ ok: true, id, slug }, 201);
      }

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const before=await DB.prepare('SELECT * FROM collections WHERE id=?').bind(body.id).first();
        if(!before)return json({error:'Not found'},404);
        // Download BEFORE the SQLite publication lock; never hold a transaction over I/O.
        let iconChoice;try{iconChoice=await prepareCollectionIcon(env,body,before);}catch(error){return json({error:error.message},400);}
        return await withModuleLock(env,'collection:'+body.id,async()=>{
        const col = await DB.prepare('SELECT * FROM collections WHERE id = ?').bind(body.id).first();
        if (!col) return json({ error: 'Not found' }, 404);
        let slug = col.slug;
        if (body.slug !== undefined) {
          const s = String(body.slug).trim();
          if (s && s !== col.slug && !/^[A-Za-z0-9]+$/.test(s)) return json({ error: '路径只能是英文字母和数字' }, 400);
          if (s && s !== col.slug) slug = s;
        }
        const ids=body.moduleIds===undefined?null:await validatedMembers(DB,body.moduleIds);
        try {
          const update=DB.prepare(
            `UPDATE collections SET slug = ?, title = ?, description = ?, icon_url = ?, updated_at = ? WHERE id = ?`
          ).bind(
            slug,
            pickStr(body.title, col.title, 200),
            pickStr(body.description, col.description, 2000),
            iconChoice?iconChoice.url:col.icon_url,
            Date.now(), body.id
          );
          await env.ATOMIC(async()=>{
            if(iconChoice)await assertStoredIcon(env,iconChoice.url);
            await setCollectionSlug(DB,body.id,slug);
            if(body.autoAll!==undefined) await DB.prepare('UPDATE collections SET auto_all=? WHERE id=?').bind(body.autoAll?1:0,body.id).run();
            await DB.batch([update,...(ids?memberStatements(DB,body.id,ids):[])]);
            if(body.autoAll)await syncAutoAll(DB);
          });
        } catch (e) {
          if (/UNIQUE|占用/i.test(String((e && e.message) || e))) return json({ error: '该路径已被占用，请换一个' }, 409);
          throw e;
        }
        return json({ ok: true });
        });
      }

      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        return await withModuleLock(env,'collection:'+id,async()=>{
        const col = await DB.prepare('SELECT id FROM collections WHERE id = ?').bind(id).first();
        if (!col) return json({ error: 'Not found' }, 404);
        await DB.batch([
          DB.prepare('DELETE FROM collections WHERE id = ?').bind(id),
          DB.prepare('DELETE FROM collection_modules WHERE collection_id = ?').bind(id),
          DB.prepare('DELETE FROM collection_aliases WHERE collection_id = ?').bind(id)
        ]);
        return json({ ok: true });
        });
      }
    }


    const fwdMatch = path.match(/^\/api\/collections\/([^\/]+?)(?:\/(?:fwd|rex)|\.(?:fwd|rex))?$/);
    if (fwdMatch) {
      const col = await findCollectionBySlug(fwdMatch[1]);
      if (!col) return json({ error: 'Not found' }, 404);

      const { results: rows } = await DB.prepare(
        `SELECT m.*, cm.position AS _pos FROM collection_modules cm
           JOIN modules m ON m.id = cm.module_id
         WHERE cm.collection_id = ? ${env.NAS_MODE ? "AND NOT EXISTS (SELECT 1 FROM nas_owners no WHERE no.module_id=m.id AND no.platform='capy')" : ''} ORDER BY cm.position`
      ).bind(col.id).all();

      // 3.5.6：只查合集里这些模块的文件名和分享别名，不再每次扫全表。
      const widgets = (await decorateNamesFor(env,rows || [])).map((m) => {
        const t = resolveTitle(m);
        return {
          id: m.widget_id || m.id,
          title: t,
          description: m.note || '',
          requiredVersion: m.required_version || '0.0.1',
          version: m.version || '1.0.0',
          author: m.author || '',
          url: url.origin + (m.share_path||modulePath(m))
        };
      });

      // 3.5.6：订阅内容算一个 ETag；Rex 带回同一个 ETag 就回 304，不再传整份 JSON。
      const payload = JSON.stringify({
        title: col.title,
        description: col.description || '',
        icon: col.icon_url?.startsWith('/api/icons/') ? url.origin+col.icon_url : col.icon_url || '',
        widgets: widgets
      });
      const digest = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))).slice(0, 32);
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300', ETag: 'W/"' + digest + '"' };
      const sent = request.headers.get('If-None-Match') || '';
      if (sent.split(',').some(tag => tag.trim() === headers.ETag || tag.trim() === '*')) return new Response(null, { status: 304, headers });
      return new Response(method === 'HEAD' ? null : payload, { status: 200, headers });
    }


    const namedMatch=path.match(/^\/api\/modules\/([^/]+)\/file\/[^/]+\.js$/i);
    const compatibilityRaw=env.NAS_MODE&&/^\/raw\/([a-f0-9-]{36})\.js$/i.exec(path);
    const rawMatch = compatibilityRaw || namedMatch || path.match(/^\/api\/modules\/([^\/]+?)(?:\.js|\/raw)?$/);
    if (rawMatch) {
      if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
      let module=await getModule(rawMatch[1]),alias=null;
      if(!module&&!compatibilityRaw&&!namedMatch&&!path.endsWith('/raw')){
        alias=await resolveAlias(env,path.slice('/api/modules/'.length));
        if(alias)module=await getModule(alias.module_id);
      }
      if(!module)return json({error:'Not found'},404);
      const named=await decorateNameOne(env,module);
      const kvr = await env.KV.getWithMetadata(module.file_key||'file:'+module.id, 'stream');
      if (!kvr || !kvr.value) return json({ error: 'File not found' }, 404);
      const meta = kvr.metadata || {};
      const etag = meta.u ? 'W/"' + meta.u + '"' : null;
      const h = {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Disposition':contentDisposition(alias?.alias||named.effective_filename),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': compatibilityRaw?'no-store, no-transform':'public, max-age=300, stale-while-revalidate=600, no-transform',
        'Vary':'Accept-Encoding'
      };
      if (etag) h.ETag = etag;
      if (etag && request.headers.get('If-None-Match') === etag) {
        try { await kvr.value.cancel?.(); } catch (e) {}
        return new Response(null, { status: 304, headers: h });
      }
      return new Response(method==='HEAD'?null:kvr.value, { headers: h });
    }


    const directMatch = path.match(/^\/([a-f0-9-]{36})(?:\.js)?$/);
    if (directMatch) {
      if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
      const mod=await getModule(directMatch[1]);if(!mod)return json({error:'Not found'},404);
      const m=await decorateNameOne(env,mod);
      const kvr = await env.KV.getWithMetadata(mod.file_key||'file:'+mod.id, 'stream');
      if (kvr && kvr.value) {
        const meta = kvr.metadata || {};
        const h = {
          'Content-Disposition':contentDisposition(m.effective_filename),
          'Content-Type': 'application/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600'
        };
        if (meta.u) h.ETag = 'W/"' + meta.u + '"';
        // 与 /api/modules/ 下载一致：客户端带回同一个 ETag 时回 304，不再传整份文件。
        if (h.ETag && request.headers.get('If-None-Match') === h.ETag) {
          try { await kvr.value.cancel?.(); } catch (e) {}
          return new Response(null, { status: 304, headers: h });
        }
        return new Response(method==='HEAD'?null:kvr.value, { headers: h });
      }
    }

    if (path.startsWith('/api/')) {
      return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    // 只有首页返回界面；其余路径按 404 处理，避免任意路径都回一页 200 HTML
    if (path === '/' || path === '/index.html' || (env.NAS_MODE && path === '/admin/manage')) {
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
    ctx.waitUntil((async () => {
      await bootstrap(env);
      // light：CF 版「全部同步」期间每秒续跑的闹钟只推进同步队列，其余维护最多每分钟做一次。
      if (event?.light) {
        await subscriptionTick(env,subscriptionHelpers(env));
        await iconTick(env);
        return;
      }
      await backfillTitles(env,2);
      await cleanupUploadJobs(env);
      const syncing=await subscriptionTick(env,subscriptionHelpers(env));
      if (!syncing) await autoRefreshLinkModules(env);
      await iconTick(env);
      await autoRulesTick(env);
    })());
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

function parseMeta(fn, head) {
  return parseModuleMeta(fn,head);
}
function isEncrypted(buf) {
  // 唯一标准：首行固定为 REXENC 标记
  let head;
  try {
    head = new TextDecoder('utf-8').decode(buf.slice(0, 32));
  } catch (e) { return 0; }
  return head.split('\n')[0].replace(/^\uFEFF/, '').trim() === 'REXENC' ? 1 : 0;
}

// 3.5.8：失败来源 = 已启用，且上次结果是部分失败/出错，或留有错误信息；正在同步中的不算。
const FAILED_SOURCES_SQL="SELECT id,status,kind FROM subscription_sources WHERE enabled=1 AND lease_until<? AND (status IN ('partial','error') OR (status!='syncing' AND COALESCE(last_error,'')!='')) ORDER BY created_at";
async function refreshModuleFromSource(env, original, force=false) {
  const epoch=env.CONTENT_EPOCH||0;
  // 3.5.5：自动刷新带上次的 ETag/Last-Modified 发条件请求，上游没变就回 304，不再整份下载。手动刷新照旧完整下载。
  const headers={};
  if(!force&&original.content_hash){
    if(original.link_etag)headers['If-None-Match']=original.link_etag;
    if(original.link_last_modified)headers['If-Modified-Since']=original.link_last_modified;
  }
  const file=await fetchRemote(original.source_url,MAX_FILE_BYTES,{transport:env?.REMOTE_FETCH||globalThis.fetch,signal:env?.SHUTDOWN_SIGNAL,
    assertUrl:raw=>assertFetchableUrl(raw,env),headers,allowNotModified:Object.keys(headers).length>0});
  // 超长的校验值不存（参考 feedparser-rs 的 1 KB / 64 字节上限）。
  const pick=(value,max)=>value&&value.length<=max?value:'';
  const etag=pick(file.etag||original.link_etag,1024),lastModified=pick(file.lastModified||original.link_last_modified,64);
  const saveValidators=()=>env.DB.prepare('UPDATE modules SET link_etag=?,link_last_modified=? WHERE id=? AND updated_at=? AND file_key=?')
    .bind(etag,lastModified,original.id,original.updated_at,original.file_key).run();
  if(file.status===304){await saveValidators();return;}
  const buf=file.bytes.buffer;
  assertModuleFile(new Uint8Array(buf));
  return withModuleLock(env,'module:'+original.id,async()=>{
    const mod=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(original.id).first();
    if(!mod || epoch!==(env.CONTENT_EPOCH||0) || mod.updated_at!==original.updated_at || mod.file_key!==original.file_key ||
      mod.source_url!==original.source_url || (!force&&mod.manual_override))return;
    const hash=toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)));
    // 内容没变就不重写：省一次整份写入，ETag 也保持不变，客户端可继续拿 304。
    if(!force&&mod.content_hash&&mod.content_hash===hash){await saveValidators();return;}
    const head=new Uint8Array(buf.slice(0,METADATA_SCAN_BYTES));
    const encrypted=isEncrypted(new Uint8Array(buf)),meta=encrypted?{}:parseMeta(mod.filename,head),now=Date.now();
    await putFile(env,mod.id,buf,now);
    // 3.5.8：加密模块内容变化时自动生成日期版本号，作者保留原值（读不到）。
    const version=encrypted?nextVersion({prev:mod.version||'',encrypted,changed:!!mod.content_hash&&mod.content_hash!==hash}):(meta.version||'');
    await env.DB.prepare(`UPDATE modules SET title=?,version=?,author=?,file_size=?,is_encrypted=?,updated_at=?,
      file_key='',content_hash=?,code_title=?,metadata_id=?,title_scan_v1=1,link_etag=?,link_last_modified=? WHERE id=?`)
      .bind(resolveTitle(mod,meta.title,mod.manifest_title),version,encrypted?(mod.author||''):(meta.author||''),buf.byteLength,encrypted,now,
        hash,cleanTitle(meta.title),meta.id||mod.metadata_id||'',etag,lastModified,mod.id).run();
    if(mod.file_key?.startsWith('upload-content:'))await env.KV.delete(mod.file_key);
  });
}

export { parseMeta, isEncrypted };
export function getHTML(){return HTML;}

const REFRESH_BATCH = 4;
const REFRESH_CONC  = 4;
async function autoRefreshLinkModules(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM modules WHERE source_url IS NOT NULL AND source_url != '' AND source_managed=0 AND manual_override=0 AND MAX(updated_at,COALESCE(link_checked_at,0))<? ORDER BY MAX(updated_at,COALESCE(link_checked_at,0)) ASC LIMIT ?"
    ).bind(Date.now()-await syncIntervalMs(env),REFRESH_BATCH).all();
    const list = results || [];
    // 先记下本轮检查时间：下载失败的模块也要等一个更新间隔（默认 6 小时）再试，不会一直排在队首挡住其它模块。
    if (list.length) await env.DB.prepare('UPDATE modules SET link_checked_at=? WHERE id IN (SELECT value FROM json_each(?))')
      .bind(Date.now(), JSON.stringify(list.map(m => m.id))).run();
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

// NAS runtime: reuse the upstream password and static metadata helpers.
export { hashPassword, verifyPassword };
