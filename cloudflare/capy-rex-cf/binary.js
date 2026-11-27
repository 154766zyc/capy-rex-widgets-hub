// Strict, bounded Base64 validation without a recursive/backtracking group.
export function decodeBase64(content,maxBytes,label='文件'){
 if(typeof content!=='string'||content.length%4!==0)throw Error(label+'的 base64 编码无效');
 const padding=content.endsWith('==')?2:content.endsWith('=')?1:0,end=content.length-padding;
 if(content.length/4*3-padding>maxBytes)throw Error(label+'超过大小限制');
 if(/[^A-Za-z0-9+/]/.test(content.slice(0,end))||(padding&&end<2))throw Error(label+'的 base64 编码无效');
 return Buffer.from(content,'base64');
}
