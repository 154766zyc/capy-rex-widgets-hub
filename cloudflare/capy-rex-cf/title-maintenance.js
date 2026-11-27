import {cleanTitle,resolveTitle,parseModuleMeta,METADATA_SCAN_BYTES} from './metadata.js';
import {getFileKey,withModuleLock} from './uploads.js';

// 3.6.0：title_scan_v1 只有 1（已扫）、0（未扫）、-1（要重扫）三种值；用 <1 才能走索引，
// 扫完后每次维护只读 0 行（原来 <>1 会把全部模块读一遍）。
export async function backfillTitles(env,limit=2){
  const {results:rows}=await env.DB.prepare('SELECT id FROM modules WHERE title_scan_v1<1 ORDER BY title_scan_v1,created_at,id LIMIT ?').bind(limit).all();
  let scanned=0,failed=0;
  for(const row of rows||[]){
    try{
      await withModuleLock(env,'module:'+row.id,async()=>{
        const mod=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(row.id).first();
        if(!mod||mod.title_scan_v1===1)return;
        const item=await env.DB.prepare(`SELECT title FROM subscription_items WHERE module_id=?
          AND title IS NOT NULL AND title<>'' ORDER BY active DESC,source_id LIMIT 1`).bind(mod.id).first();
        const manifestTitle=cleanTitle(item?.title)||cleanTitle(mod.manifest_title);
        let codeTitle='',metadataId=mod.metadata_id||'';
        if(!mod.is_encrypted){
          const buffer=await env.KV.get(await getFileKey(env,mod.id),'arrayBuffer');
          if(!buffer)throw new Error('模块文件缺失，保留原标题');
          const meta=parseModuleMeta(mod.filename,new Uint8Array(buffer.slice(0,METADATA_SCAN_BYTES)));
          codeTitle=cleanTitle(meta.title);metadataId=meta.id||metadataId;
        }
        // Older records have no title provenance. Preserve a distinct existing name
        // as a custom override; rescan (-1) does not re-infer a user-unlocked title.
        const old=cleanTitle(mod.title),fallback=String(mod.filename||'').replace(/\.js$/i,'');
        const inferred=mod.title_scan_v1===0 && old && ![fallback,codeTitle,manifestTitle].includes(old);
        const locked=mod.title_locked||inferred?1:0;
        const title=resolveTitle({...mod,title_locked:locked},codeTitle,manifestTitle);
        await env.DB.prepare(`UPDATE modules SET code_title=?,manifest_title=?,title=?,title_locked=?,
          metadata_id=?,title_scan_v1=1 WHERE id=?`)
          .bind(codeTitle,manifestTitle,title,locked,metadataId,mod.id).run();
        scanned++;
      });
    }catch(e){failed++;console.log('[title-scan]',row.id,String(e.message||e));}
  }
  const remaining=await env.DB.prepare('SELECT COUNT(*) AS n FROM modules WHERE title_scan_v1<1').first();
  return {ok:true,scanned,failed,remaining:remaining.n,done:remaining.n===0};
}
