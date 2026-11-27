import { createServer } from 'node:http';
import { initialize } from './init.mjs';

// Setup is deliberately restricted to an explicitly selected local origin.
export function setupOrigin(value='http://127.0.0.1:8080') {
  const u=new URL(value),h=u.hostname;
  const privateHost=h==='localhost'||h==='127.0.0.1'||h==='[::1]'||/^10\.\d+\.\d+\.\d+$/.test(h)||/^192\.168\.\d+\.\d+$/.test(h)||/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h);
  if(!privateHost||u.protocol!=='http:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('SETUP_ORIGIN 必须为本机或局域网 HTTP origin，例如 http://192.168.1.10:8080');
  return u.origin;
}
const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capy/Rex模块管理 · 首次设置</title><h1>设置管理员密码</h1><p>请在可信本机或局域网完成初始化，再开启公网反代。密码至少 8 字符，没有默认密码。</p><form method="post" action="/setup"><label>管理员密码 <input name="password" type="password" minlength="8" maxlength="256" required autocomplete="new-password"></label><p><label>再次输入 <input name="confirm" type="password" minlength="8" maxlength="256" required autocomplete="new-password"></label></p><button>初始化平台</button></form></html>`;
export function createSetupServer(directory, config={}, onInitialized=()=>{}) {
  const allowed=setupOrigin(config.SETUP_ORIGIN||undefined);
  let busy=false,finished=false,attempts=0,windowStart=Date.now();
  const server=createServer(async(req,res)=>{
    const reply=(status,text,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",Connection:'close'});res.end(text);};
    if(req.url==='/healthz'&&req.method==='GET')return reply(200,'{"ok":true,"initialized":false}','application/json');
    if('http://'+req.headers.host!==allowed)return reply(403,'首次初始化仅允许 SETUP_ORIGIN 指定的本机/局域网地址');
    if(finished)return reply(503,'初始化已完成，服务正在重启，请稍后刷新。');
    if(req.method==='GET'&&(req.url==='/'||req.url==='/setup'))return reply(200,page,'text/html; charset=utf-8');
    if(req.method!=='POST'||req.url!=='/setup')return reply(404,'Not found');
    if(req.headers.origin!==allowed||req.headers['sec-fetch-site']==='cross-site')return reply(403,'跨站初始化已拒绝');
    if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,'仅接受网页表单');
    if(busy)return reply(409,'初始化正在进行');
    if(Date.now()-windowStart>300000){attempts=0;windowStart=Date.now();}
    if(++attempts>10)return reply(429,'请五分钟后再试');
    busy=true;
    const timer=setTimeout(()=>req.destroy(),10000);timer.unref();
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>8192)return reply(413,'请求过大');chunks.push(chunk);}
      const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const password=form.get('password');
      if(password!==form.get('confirm'))return reply(400,'两次密码不一致，请返回重试');
      if(typeof password!=='string'||password.length<8||password.length>256)return reply(400,'密码必须为 8–256 字符');
      await initialize(directory,password);finished=true;
      res.once('finish',()=>onInitialized());
      reply(200,'初始化完成。服务会自动重启，请数秒后刷新页面并登录。');
    }catch{reply(409,'初始化失败或数据库已存在。请检查数据目录权限，不要删除已有数据库。');}
    finally{clearTimeout(timer);busy=false;}
  });
  server.headersTimeout=15000;server.requestTimeout=15000;server.maxConnections=8;
  return server;
}
