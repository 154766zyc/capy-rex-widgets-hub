import {parse} from './vendor/acorn.mjs';
import {parseModuleMeta} from '../metadata.js';
export const normalizeUsername=v=>String(v??'').normalize('NFKC').trim();
export const usernameKey=v=>normalizeUsername(v).toLocaleLowerCase('en-US');
export const validUsername=v=>/^[\p{Script=Han}\p{Script=Latin}0-9_-]{2,40}$/u.test(v);
export function rexEnvelope(source){
 const lines=source.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines[0]!=='REXENC')return false;
 try{const h=JSON.parse(lines[1]);const b64=s=>typeof s==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(s)&&s.length%4===0;
 if(lines.length!==3||h.v!==2||h.mkv!=='rex-1'||h.alg!=='A256GCM'||!b64(h.iv)||!b64(h.kb)||!b64(lines[2])||Buffer.from(h.iv,'base64').length!==12||Buffer.from(h.kb,'base64').length!==60||Buffer.from(lines[2],'base64').length<=16)throw Error();return true;
 }catch{throw Error('REXENC v2 封装无效；请使用 Rex 官方加密工具重新生成');}
}
export function inspectSource(source,filename='module.js'){
 if(Buffer.byteLength(source)>2*1024*1024)throw Error('文件超过 2 MiB');
 if(rexEnvelope(source))return {encrypted:true,platform:'rex',metadata:{},checks:['REXENC v2 封装有效；无法验证密文真实性、元数据或运行行为']};
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
 const metadata=parseModuleMeta(filename,new TextEncoder().encode(source));
 const capy=/\b(?:Widget\.http|Widget\.loadDocument|Widget\.getPreference|media_list|timeoutSeconds)\b/.test(source);
 const rex=/\b(?:Widget\.tmdb|Widget\.storage|requiredVersion|searchable)\b/.test(source);
 const declaration=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='WidgetMetadata'));
 return {encrypted:false,platform:capy!==rex?(capy?'capy':'rex'):'unknown',metadata,checks:[declaration?'检测到 WidgetMetadata 声明':'未发现顶层 WidgetMetadata 声明',declaration&&declaration.kind!=='var'?'Capy 要求使用 var WidgetMetadata':'语法静态解析通过','未运行代码，不能保证 App 兼容性']};
}
// Deliberately bounded regular-expression subset: no groups, alternation,
// backreferences, lookarounds or unbounded/repeated quantifiers. Input <= 4096.
export function boundedRegex(pattern){
 if(typeof pattern!=='string'||!pattern||pattern.length>160||/[()|*+]/.test(pattern)||/\\[1-9bBkKpP]/.test(pattern)||/\?/.test(pattern))throw Error('正则仅支持字面量、字符类、锚点及 {n,m}（上限 32）；不允许分组、回溯或无限量词');
 if((pattern.match(/\{/g)||[]).length>1)throw Error('每条正则最多一个有限重复，避免组合回溯');
 const stripped=pattern.replace(/\{(\d+)(?:,(\d+))?\}/g,(s,a,b)=>{if(+a>32||+(b??a)>32||+(b??a)<+a)throw Error('正则重复次数不得超过 32');return '';});
 if(/[{}]/.test(stripped)||/\}\s*\{/.test(pattern))throw Error('无效的有限重复');
 return new RegExp(pattern,'iu');
}
export function suggestPlatform(rules,fields){
 const hits=rules.filter(r=>boundedRegex(r.pattern).test(String(fields[r.field]||'').slice(0,4096))).map(r=>r.platform);
 return new Set(hits).size===1?hits[0]:'unknown';
}
