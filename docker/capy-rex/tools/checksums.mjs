// Regenerate release integrity metadata after deterministic icon builds.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const skipped=new Set(['.git','.env','.dev.vars','.wrangler','.DS_Store','data','node_modules','SHA256SUMS']);
function walk(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(skipped.has(entry.name)||entry.isSymbolicLink())return [];
    const path=join(directory,entry.name);
    return entry.isDirectory()?walk(path):[path];
  });
}
writeFileSync(join(root,'SHA256SUMS'),walk(root).sort().map(path=>
  createHash('sha256').update(readFileSync(path)).digest('hex')+'  '+relative(root,path)).join('\n')+'\n');
