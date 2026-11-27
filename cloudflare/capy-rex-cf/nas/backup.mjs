import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.umask(0o077);
const dir=resolve(process.env.DATA_DIR||'./data');
const folder=join(dir,'backups');mkdirSync(folder,{recursive:true,mode:0o700});
const target=join(folder,'nas-full-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.sqlite');
const source=new DatabaseSync(join(dir,'rex.sqlite'),{readOnly:true});
try {await backup(source,target);}finally{source.close();}
chmodSync(target,0o600);
const check=new DatabaseSync(target,{readOnly:true});
try {
  if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('备份完整性检查失败');
  for(const name of ['modules','settings','nas_users','nas_owners','nas_submissions','nas_audit'])if(!check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))throw Error('备份缺少表：'+name);
}finally{check.close();}
console.log('NAS 完整 SQLite 备份（含账户、待审稿、审核与原功能数据）：'+target);
