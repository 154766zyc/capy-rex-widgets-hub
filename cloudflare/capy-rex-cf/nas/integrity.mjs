import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const db=new DatabaseSync(process.env.DATA_DIR+'/rex.sqlite',{readOnly:true});
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report={integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,tables:{}};
for(const table of ['nas_users','nas_owners','groups','collections','modules','settings']){
 const rows=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();report.tables[table]={count:rows.length,digest:digest(rows)};
}
report.modules=db.prepare('SELECT id,content_hash FROM modules ORDER BY id').all();db.close();console.log(JSON.stringify(report,null,2));
