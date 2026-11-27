import {parse} from './acorn.mjs';
export function checkSource(source,platform='capy'){
 const issues=[],warnings=[],checks=[];
 if(typeof source!=='string'||new TextEncoder().encode(source).length>512*1024)return {ok:false,issues:['源码上限 512 KiB']};
 if(source.replace(/^\uFEFF/,'').trim().startsWith('REXENC'))return {ok:false,issues:['加密源码无法检查内部代码。测试前请勿加密！'],warnings:['请使用明文测试，通过后再加密投稿。']};
 let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true});}catch(e){return {ok:false,issues:[e.message],line:e.loc?.line,column:e.loc?.column,checks:['仅解析语法，没有执行源码']};}
 checks.push('JavaScript 语法解析通过（Acorn；并非 Capy App 引擎）');
 const declaration=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='WidgetMetadata'));
 if(!declaration)issues.push('缺少顶层 WidgetMetadata 声明');
 if(platform==='capy'&&declaration?.kind!=='var')issues.push('CapyPlayer 必须使用全局 var WidgetMetadata');
 const init=declaration?.declarations.find(d=>d.id.name==='WidgetMetadata')?.init;
 const property=(node,name)=>node?.type==='ObjectExpression'?node.properties.find(p=>p.type==='Property'&&!p.computed&&(p.key.name===name||p.key.value===name))?.value:undefined;
 const literal=node=>node?.type==='Literal'?node.value:undefined;
 const funcs=new Map(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,n]));
 if(init?.type==='ObjectExpression'){
  const title=property(init,'title')||property(init,'name');if(!title)issues.push('缺少 title / name');
  const modules=property(init,'modules');
  if(!modules)issues.push('缺少 modules');
  else if(modules.type!=='ArrayExpression')warnings.push('modules 为动态表达式，需在 App 内核对');
  else {if(!modules.elements.length)issues.push('modules 不能为空');modules.elements.forEach((m,i)=>{if(m?.type!=='ObjectExpression'){warnings.push('modules['+i+'] 为动态条目，需人工核对');return;}const fn=literal(property(m,'functionName'));if(typeof fn!=='string')warnings.push('modules['+i+'].functionName 非静态字符串，需人工核对');else if(!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(fn))issues.push('非法 functionName: '+fn);else if(fn.includes('.'))warnings.push('点路径入口需在 App 内确认：'+fn);else if(!funcs.has(fn))warnings.push('未发现函数声明 '+fn+'，若为动态赋值请在 App 内确认');else if(platform==='capy'&&!funcs.get(fn).async)warnings.push(fn+' 建议声明为 async function');else checks.push('入口声明存在：'+fn);});}
 }else if(declaration)warnings.push('WidgetMetadata 动态生成，无法静态验证字段');
 warnings.push('未执行源码；不能验证返回值、网络、播放行为或安全性。');
 return {ok:issues.length===0,platform,issues,warnings,checks};
}
if(typeof self!=='undefined')self.onmessage=({data})=>{try{self.postMessage(checkSource(data.source,data.platform));}catch(e){self.postMessage({ok:false,issues:['静态解析失败：'+String(e.message).slice(0,200)]});}};
