import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { restoreSnapshot } from '../restore-snapshot.js';
const dir=resolve(process.env.DATA_DIR||'./data');
const source=process.argv[2];
if(!source||!process.argv.includes('--offline'))throw Error('先停止 hub，再运行 node nas/restore.mjs /app/data/backups/实际备份.sqlite --offline');
const check=new DatabaseSync(resolve(source),{readOnly:true});
try{for(const name of ['nas_users','nas_owners','nas_submissions','nas_audit'])if(!check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))throw Error('这不是含开发者数据的 NAS 完整备份');}finally{check.close();}
const saved=restoreSnapshot(dir,resolve(source),true);
const db=new DatabaseSync(resolve(dir,'rex.sqlite'));
try{db.exec('BEGIN; DELETE FROM sessions; DELETE FROM nas_sessions; COMMIT;');}finally{db.close();}
console.log('完整恢复成功，旧数据保留在：'+saved+'。所有登录会话已注销，请重新启动 hub。');
