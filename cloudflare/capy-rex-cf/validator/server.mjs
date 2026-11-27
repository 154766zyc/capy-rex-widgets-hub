import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const files=new Map();
const add=(url,path,type)=>files.set(url,{body:readFileSync(new URL(path,import.meta.url)),type});
add('/checker','./index.html','text/html; charset=utf-8');
for(const name of ['app.js','worker.js'])add('/checker/'+name,'./'+name,'text/javascript; charset=utf-8');
add('/checker/acorn.mjs','../nas/vendor/acorn.mjs','text/javascript; charset=utf-8');
add('/user/style.css','../nas/style.css','text/css; charset=utf-8');
for(const name of ['capy-v1-48.png','capy-v1-96.png','rex-mulberry-v1-192.png'])add('/app-icons/'+name,'../public/app-icons/'+name,'image/png');
files.set('/favicon.ico',files.get('/app-icons/capy-v1-48.png'));
files.get('/checker').body=Buffer.from(files.get('/checker').body.toString().replace('<a href="/user">公开组件</a>','').replace('<a href="/admin#developer">上传与维护</a>',''));
const csp="default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const buckets=new Map();let windowStart=Date.now(),globalCount=0;
export const server=createServer((req,res)=>{
 const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp,'Cache-Control':'no-cache'};
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD',Connection:'close'});res.end('Static checker: uploads and execution are not accepted');req.resume();return;}
 const now=Date.now();if(now-windowStart>60000){buckets.clear();globalCount=0;windowStart=now;}
 const ip=req.socket.remoteAddress,count=(buckets.get(ip)||0)+1;
 if(++globalCount>300||count>60||(!buckets.has(ip)&&buckets.size>=256)){res.writeHead(429,{...headers,'Retry-After':'60'});res.end('Too many requests');return;}buckets.set(ip,count);
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'||path==='/checker/'){res.writeHead(308,{...headers,Location:'/checker'});res.end();return;}
 const file=files.get(path);if(!file){res.writeHead(404,headers);res.end('Not found');return;}
 res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Length':file.body.length});res.end(req.method==='HEAD'?undefined:file.body);
});
server.maxConnections=16;server.headersTimeout=10000;server.requestTimeout=10000;server.keepAliveTimeout=5000;
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Static online checker listening on '+server.address().port));
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});
