import {withModuleLock} from './uploads.js';

export function uniqueIds(value,max=1000){
  if(!Array.isArray(value)||value.length>max||value.some(id=>typeof id!=='string'||!id||id.length>100))
    throw new Error('模块列表无效或超过 '+max+' 项');
  return [...new Set(value)];
}
export async function memberIds(DB,id){
  return (await DB.prepare('SELECT module_id FROM collection_modules WHERE collection_id=? ORDER BY position').bind(id).all()).results.map(r=>r.module_id);
}
export function memberStatements(DB,id,ids){
  const statements=[DB.prepare('DELETE FROM collection_modules WHERE collection_id=?').bind(id)];
  // Validate again inside the transaction so a concurrent module deletion cannot
  // create a dangling reference after the preflight existence check.
  for(let i=0;i<ids.length;i+=33){
    const chunk=ids.slice(i,i+33),values=chunk.map(()=>'(?,?,?)').join(',');
    statements.push(DB.prepare('INSERT INTO collection_modules (collection_id,module_id,position) '+
      'SELECT v.column1,v.column2,v.column3 FROM (VALUES '+values+') v JOIN modules m ON m.id=v.column2')
      .bind(...chunk.flatMap((mid,k)=>[id,mid,i+k])));
  }
  return statements;
}
export async function validatedMembers(DB,ids){
  ids=uniqueIds(ids);
  for(let i=0;i<ids.length;i+=100){
    const part=ids.slice(i,i+100);
    const r=await DB.prepare('SELECT id FROM modules WHERE id IN ('+part.map(()=>'?').join(',')+')').bind(...part).all();
    if(r.results.length!==part.length)throw new Error('部分模块已不存在，请刷新后重试');
  }
  return ids;
}
export async function replaceMembers(env,id,ids,expected){
  return withModuleLock(env,'collection:'+id,async()=>{
    const collection=await env.DB.prepare('SELECT id,auto_all FROM collections WHERE id=?').bind(id).first();if(!collection)throw Error('合集不存在');if(collection.auto_all)throw Error('自动包含全部模块的合集不能手动管理模块');
    const current=await memberIds(env.DB,id);
    if(expected!==undefined&&JSON.stringify(uniqueIds(expected))!==JSON.stringify(current))
      throw Error('合集已被其他操作更新，请重新打开后再保存');
    ids=await validatedMembers(env.DB,ids);
    await env.DB.batch([...memberStatements(env.DB,id,ids),
      env.DB.prepare('UPDATE collections SET updated_at=? WHERE id=?').bind(Date.now(),id)]);
    return {ok:true,moduleIds:await memberIds(env.DB,id)};
  });
}
export async function deleteModule(env,id,beforeDelete){
  return withModuleLock(env,'module:'+id,async()=>{
    const mod=await env.DB.prepare('SELECT * FROM modules WHERE id=?').bind(id).first();
    if(!mod)return {id,ok:true,absent:true}; // A lost delete response is safe to retry.
    if(beforeDelete)await beforeDelete();
    const old=await env.DB.prepare('SELECT kv_key FROM module_previous_versions WHERE module_id=?').bind(id).first();
    // Unpublish first, atomically. A failed DB transaction must not destroy bytes.
    await env.DB.batch([
      env.DB.prepare('UPDATE module_share_aliases SET tombstoned=1,is_current=0 WHERE module_id=?').bind(id),
      env.DB.prepare('DELETE FROM module_names WHERE module_id=?').bind(id),
      env.DB.prepare('DELETE FROM collection_modules WHERE module_id=?').bind(id),
      env.DB.prepare('DELETE FROM module_previous_versions WHERE module_id=?').bind(id),
      env.DB.prepare("UPDATE subscription_items SET module_id=NULL WHERE module_id=?").bind(id),
      env.DB.prepare('DELETE FROM modules WHERE id=?').bind(id)
    ]);
    const keys=[...new Set(['file:'+id,mod.file_key,old?.kv_key].filter(Boolean))];
    for(const key of keys)try{await env.KV.delete(key);}catch(e){console.log('[delete-cleanup]',id,String(e.message||e));}
    return {id,ok:true};
  });
}
export async function bulkManage(env,body){
  const ids=uniqueIds(body.ids,body.action==='delete'?2:10);if(!ids.length)throw Error('请选择模块');
  if(!['group','append','delete'].includes(body.action))throw Error('不支持的批量操作');
  const results=[];
  if(body.action==='append'){
    if(typeof body.collectionId!=='string'||!body.collectionId||body.collectionId.length>100)throw Error('请选择合集');
    return withModuleLock(env,'collection:'+body.collectionId,async()=>{
      const collection=await env.DB.prepare('SELECT id,auto_all FROM collections WHERE id=?').bind(body.collectionId).first();if(!collection)throw Error('合集不存在');if(collection.auto_all)throw Error('自动包含全部模块的合集不能追加模块');
      const current=await memberIds(env.DB,body.collectionId),next=current.slice();
      const existing=new Set((await env.DB.prepare('SELECT id FROM modules WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results.map(r=>r.id));
      for(const id of ids){
        if(!existing.has(id))results.push({id,ok:false,error:'模块已不存在'});
        else{if(!next.includes(id))next.push(id);results.push({id,ok:true});}
      }
      if(next.length>1000)throw Error('合集最多支持 1000 个模块');
      await env.DB.batch([...memberStatements(env.DB,body.collectionId,next),
        env.DB.prepare('UPDATE collections SET updated_at=? WHERE id=?').bind(Date.now(),body.collectionId)]);
      const actual=new Set(await memberIds(env.DB,body.collectionId));
      for(const result of results)if(result.ok&&!actual.has(result.id)){result.ok=false;result.error='模块已被其他操作删除';}
      return {ok:true,results};
    });
  }
  if(body.action==='group'){
    if(typeof body.groupId!=='string'||body.groupId.length>100)throw Error('分组无效');
    if(body.groupId&&!await env.DB.prepare('SELECT id FROM groups WHERE id=?').bind(body.groupId).first())throw Error('分组不存在');
  }
  for(const id of ids){
    try{
      if(body.action==='delete')results.push(await deleteModule(env,id));
      else await withModuleLock(env,'module:'+id,async()=>{
        const r=await env.DB.prepare('UPDATE modules SET group_id=?,updated_at=? WHERE id=?').bind(body.groupId,Date.now(),id).run();
        results.push(r.meta.changes?{id,ok:true}:{id,ok:false,error:'模块已不存在'});
      });
    }catch(e){results.push({id,ok:false,error:String(e.message||e)});}
  }
  return {ok:true,results};
}
