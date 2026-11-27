// Read literal metadata without executing module code. Ignore nested object fields,
// comments and dynamic expressions rather than guessing their runtime values.
export const cleanTitle = value => typeof value === 'string' ? value.trim().slice(0,500) : '';
export const METADATA_SCAN_BYTES=256*1024;
const filenameStem = value => String(value||'').replace(/\.js$/i,'');
function savedTitle(mod) {
  const title=cleanTitle(mod.title);
  // A stored filename fallback is not a user-authored title. Prefer the accepted
  // playback name only in this case; never strip text from explicit titles.
  return title && title!==filenameStem(mod.filename) && title!==filenameStem(mod.effective_filename) ? title : '';
}
export function resolveTitle(mod, codeTitle=mod.code_title, manifestTitle=mod.manifest_title) {
  if(mod.title_locked && cleanTitle(mod.title))return cleanTitle(mod.title);
  return cleanTitle(codeTitle)||cleanTitle(manifestTitle)||savedTitle(mod)||
    filenameStem(mod.effective_filename||mod.filename)||'未命名模块';
}
export function generatedFilename(mod) {
  return !!mod.generated_filename && mod.filename===mod.id+'.js';
}
export function titleSource(mod) {
  if(mod.title_locked&&cleanTitle(mod.title))return '自定义标题（已锁定）';
  if(cleanTitle(mod.code_title))return '模块代码中的 title';
  if(cleanTitle(mod.manifest_title))return '订阅清单标题';
  if(savedTitle(mod))return '已保存标题';
  return '文件名';
}

function* tokens(source) {
  let i=0,previous=null;
  while(i<source.length){
    const c=source[i];
    if(/\s/.test(c)){i++;continue;}
    if(source.startsWith('//',i)){i=source.indexOf('\n',i+2);if(i<0)return;continue;}
    if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)return;i=end+2;continue;}
    // A regular-expression body can contain metadata-looking text. Skip the
    // entire literal (including character classes), never inspect its contents.
    if(c==='/'&&(!previous||/^[=(:,;!&|?{\[]$/.test(previous.value)||
      (previous.type==='word'&&['return','throw','case','yield','void','delete','typeof'].includes(previous.value)))){
      let inClass=false,closed=false;i++;
      while(i<source.length){const ch=source[i++];if(ch==='\\'){i++;continue;}
        if(ch==='\n'||ch==='\r')break;
        if(ch==='[')inClass=true;else if(ch===']')inClass=false;
        else if(ch==='/'&&!inClass){closed=true;break;}}
      if(!closed)return;
      while(/[a-z]/i.test(source[i]||'')&&i<source.length)i++;
      previous={type:'dynamic',value:''};yield previous;continue;
    }
    if(c==='"'||c==="'"||c==='`'){
      const quote=c;let value='',dynamic=false,closed=false;i++;
      while(i<source.length){
        let ch=source[i++];
        if(ch===quote){closed=true;break;}
        if(quote==='`'&&ch==='$'&&source[i]==='{')dynamic=true;
        if(ch==='\\'){
          ch=source[i++];
          const escapes={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
          if(ch==='u'||ch==='x'){
            const braced=ch==='u'&&source[i]==='{';
            const end=braced?source.indexOf('}',i+1):i+(ch==='u'?4:2);
            const hex=source.slice(i+(braced?1:0),end);
            if(end<0||!(/^[0-9a-f]+$/i.test(hex))||Number.parseInt(hex,16)>0x10ffff){dynamic=true;continue;}
            value+=String.fromCodePoint(Number.parseInt(hex,16));i=end+(braced?1:0);continue;
          }
          if(ch==='\n')continue;
          if(ch==='\r'){if(source[i]==='\n')i++;continue;}
          value+=escapes[ch]??ch??'';
        }else value+=ch;
      }
      previous={type:closed&&!dynamic?'string':'dynamic',value};yield previous;continue;
    }
    const word=/^[A-Za-z_$][\w$]*/.exec(source.slice(i,i+256));
    if(word){i+=word[0].length;previous={type:'word',value:word[0]};yield previous;continue;}
    i++;previous={type:'punct',value:c};yield previous;
  }
}

export function parseModuleMeta(filename,bytes) {
  const source=typeof bytes==='string'?bytes.slice(0,METADATA_SCAN_BYTES):new TextDecoder().decode(bytes.slice(0,METADATA_SCAN_BYTES));
  if(source.split('\n',1)[0].replace(/^\uFEFF/,'').trim()==='REXENC')return {};
  const iterator=tokens(source);let token;
  const next=()=>iterator.next().value;
  while((token=next())){
    if(token.type!=='word'||token.value!=='WidgetMetadata')continue;
    let start=next();
    if(start?.value==='=')start=next();
    if(start?.value!=='{')continue;
    const meta={};let depth=1,property=[];
    const save=()=>{
      const [key,colon,value]=property;
      if(property.length===3&&['word','string'].includes(key.type)&&colon.value===':'&&value.type==='string'&&
        ['id','title','version','author','requiredVersion'].includes(key.value))meta[key.value]=value.value;
      property=[];
    };
    while((token=next())&&depth){
      if(depth===1&&token.type==='punct'&&(token.value===','||token.value==='}')){
        save();if(token.value==='}')depth--;continue;}
      // Four tokens are enough to prove an expression is not a single literal.
      if(property.length<4)property.push(token);
      if(token.type!=='punct')continue;
      if(['{','[','('].includes(token.value))depth++;
      if(['}',']',')'].includes(token.value))depth--;
    }
    return meta;
  }
  return {};
}
