// 3.5.8：上传模块时可以选 .zip，在浏览器里取出里面的 .js 再走原来的预览 / 确认流程。
// 只读取 .js 文件；跳过文件夹、__MACOSX 和隐藏文件；不支持加密 zip 和 ZIP64。
export const zipUploadUI=String.raw`
var HUB_ZIP_LIMITS={zip:50*1024*1024,files:45,expanded:50*1024*1024};
function hubZipName(name){var n=String(name||'').replace(/\\/g,'/');var parts=n.split('/');return parts[parts.length-1];}
function hubZipSkipped(path){var n=String(path||'').replace(/\\/g,'/');return /(^|\/)__MACOSX\//.test(n)||n.split('/').some(function(p){return p.charAt(0)==='.';})||/\/$/.test(n);}
// 文件名：标了 UTF-8 的按 UTF-8；没标的先试 UTF-8，再试 GBK（Windows 中文压缩软件常用），都不行按 Latin-1。
function hubZipPath(bytes,flags){
 var tries=(flags&0x800)?['utf-8']:['utf-8','gbk'];
 for(var i=0;i<tries.length;i++){try{return new TextDecoder(tries[i],{fatal:true}).decode(bytes);}catch(e){}}
 var s='';for(var k=0;k<bytes.length;k++)s+=String.fromCharCode(bytes[k]);return s;
}
async function hubInflateRaw(bytes){
 if(typeof DecompressionStream!=='function')throw new Error('这个浏览器不支持解压 zip，请先解压后上传 .js 文件');
 var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function hubReadZipModules(file){
 if(file.size>HUB_ZIP_LIMITS.zip)throw new Error(file.name+'：zip 超过 50 MB');
 var buf=new Uint8Array(await file.arrayBuffer()),view=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
 if(buf.length<22||view.getUint32(0,true)!==0x04034b50&&view.getUint32(0,true)!==0x06054b50)throw new Error(file.name+'：不是有效的 zip 文件');
 var end=-1;for(var i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){end=i;break;}}
 if(end<0)throw new Error(file.name+'：zip 目录损坏');
 var count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(count===0xffff||start===0xffffffff)throw new Error(file.name+'：不支持 ZIP64，请重新压缩或直接上传 .js');
 if(start+size>end)throw new Error(file.name+'：zip 目录损坏');
 var out=[],skipped=0,total=0,p=start;
 for(var k=0;k<count;k++){
  if(p+46>end||view.getUint32(p,true)!==0x02014b50)throw new Error(file.name+'：zip 目录损坏');
  var flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),packed=view.getUint32(p+20,true),length=view.getUint32(p+24,true);
  var n=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),offset=view.getUint32(p+42,true);
  var path=hubZipPath(buf.subarray(p+46,p+46+n),flags);p+=46+n+extra+comment;
  if(hubZipSkipped(path)||!/\.js$/i.test(path)){skipped++;continue;}
  if(flags&1)throw new Error(file.name+'：不支持加密的 zip');
  if(method!==0&&method!==8)throw new Error(file.name+'：'+path+' 使用了不支持的压缩方式');
  if(offset+30>buf.length||view.getUint32(offset,true)!==0x04034b50)throw new Error(file.name+'：zip 数据损坏');
  var data=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
  if(data+packed>buf.length)throw new Error(file.name+'：zip 数据损坏');
  total+=length;if(total>HUB_ZIP_LIMITS.expanded)throw new Error(file.name+'：解压后超过 50 MB，请分批上传');
  var raw=buf.subarray(data,data+packed),bytes=method===0?raw.slice():await hubInflateRaw(raw);
  if(bytes.length!==length)throw new Error(file.name+'：'+path+' 解压后大小不一致');
  out.push(new File([bytes],hubZipName(path),{type:'application/javascript'}));
 }
 return {files:out,skipped:skipped};
}
// 把选中的文件展开：.zip 取出里面的 .js，其它文件原样保留。
async function hubExpandUploads(list){
 var files=[],notes=[];
 for(var i=0;i<list.length;i++){
  var f=list[i];
  if(/\.zip$/i.test(f.name)){var r=await hubReadZipModules(f);if(!r.files.length)throw new Error(f.name+'：里面没有 .js 模块');files=files.concat(r.files);notes.push(f.name+'：取出 '+r.files.length+' 个 .js'+(r.skipped?'，跳过 '+r.skipped+' 个其它文件':''));}
  else files.push(f);
 }
 if(files.length>HUB_ZIP_LIMITS.files)throw new Error('一共 '+files.length+' 个模块，超过每批 45 个，请分批上传');
 return {files:files,notes:notes};
}
`;
