import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { SQLiteKV } from '../kv.js';
import { SQLiteD1 } from '../storage.js';
import { bootstrap, hashPassword } from '../worker.js';
import { createCommunity } from './community.mjs';

export async function initialize(directory,password){
  if(typeof password!=='string'||password.length<8||password.length>256)throw Error('密码必须为 8–256 字符');
  process.umask(0o077);mkdirSync(directory,{recursive:true,mode:0o700});
  const lock=resolve(directory,'.initialize.lock'),handle=openSync(lock,'wx',0o600);
  let kv;
  try {
    const filename=resolve(directory,'rex.sqlite');
    if(existsSync(filename))throw Error('数据库已存在，拒绝重新初始化。请通过管理员设置修改密码；恢复请使用完整数据备份。');
    kv=new SQLiteKV(filename);
    const env={KV:kv,DB:new SQLiteD1(kv.db,kv.gate),ATOMIC:work=>kv.transaction(work)};
    await env.ATOMIC(async()=>{await bootstrap(env);await createCommunity(env);await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').bind('admin_password',await hashPassword(password)).run();});
  } finally {kv?.close();closeSync(handle);unlinkSync(lock);}
}
function hidden(prompt){
  if(!stdin.isTTY||!stdout.isTTY)throw Error('请在交互终端运行（Docker 使用 -it），密码不会显示或写入命令参数');
  stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
  return new Promise((res,rej)=>{let value='';const done=(err)=>{stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');err?rej(err):res(value);};const onData=chunk=>{for(const ch of chunk){if(ch==='\u0003')return done(Error('已取消'));if(ch==='\r'||ch==='\n')return done();if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(ch>=' '&&value.length<257)value+=ch;}};stdin.on('data',onData);});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {const first=await hidden('设置管理员密码（至少 8 字符，输入隐藏）：');const second=await hidden('再次输入：');if(first!==second)throw Error('两次输入不一致');await initialize(resolve(process.env.DATA_DIR||'./data'),first);console.log('初始化完成，可以启动服务。管理员密码仅以加盐 PBKDF2 哈希保存。');}
  catch(e){console.error(e.message);process.exitCode=1;}
}
