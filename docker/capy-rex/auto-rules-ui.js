export const autoRulesStyles=String.raw`
.ar-rules{max-height:51dvh;overflow:auto;overscroll-behavior:contain;margin:10px 0}
.ar-rule{border:1px solid var(--div);border-radius:12px;padding:12px;margin:8px 0;background:var(--field)}
.ar-head,.ar-fields,.ar-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ar-head strong{margin-right:auto;font-size:13px}.ar-head button{padding:5px 9px}
.ar-rule .input{margin:5px 0}.ar-rule label{font-size:12px}.ar-fields label{display:flex;align-items:center;gap:5px;margin:5px 0}
.ar-auto{display:flex;align-items:flex-start;gap:8px;font-size:13px;margin:10px 0;line-height:1.5}.ar-auto input{margin-top:3px}
.ar-cols{display:flex;flex-wrap:wrap;gap:5px}.ar-cols button[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.ar-foot button{flex:1}.ar-error{color:var(--hub-bad);font-size:12px;margin:5px 0;overflow-wrap:anywhere}
.ar-preview{max-height:45dvh;overflow:auto;overscroll-behavior:contain}.ar-preview li{font-size:12px;line-height:1.6;padding:8px 0;border-bottom:1px solid var(--div);overflow-wrap:anywhere;list-style:none}
`;
export const autoRulesUI=String.raw`
(function(){
 var tools=document.getElementById('settingsTools');if(!tools)return;
 var open=document.createElement('button');open.type='button';open.className='set-row hub-tool-row';open.id='openAutoRules';open.setAttribute('aria-haspopup','dialog');
 open.innerHTML='<svg class="hub-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h6M6 9v7a2 2 0 0 0 2 2h7"/></svg><span class="hub-tool-meta"><strong>自动分类规则</strong><small>按关键词分组，追加指定合集</small></span><span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></span>';
 tools.prepend(open);
 async function request(path,options){var r=await api('/api/admin/auto-rules'+path,options);if(!r||r.error)throw Error(r&&r.error||'请求未确认');return r;}
 open.onclick=async function(){
  open.disabled=true;try{edit(await request(''));}catch(e){toast(e.message);}finally{open.disabled=false;}
 };
 function edit(config){
  var draft=JSON.parse(JSON.stringify(config)),busy=false;
  var groups=state.groups,cols=state.collections.filter(function(c){return !c.autoAll;});
  showModal('自动分类规则','<p class="hub-help">关键词用逗号分隔，忽略大小写，命中任意关键词即可。按顺序使用首条命中规则。分组只处理未分类；合集仅追加，不删除或重排。</p><label class="ar-auto"><input type="checkbox" id="arAuto" '+(draft.auto?'checked':'')+'>新模块自动整理（后台运行，首次保存不整理旧模块）</label><div class="ar-rules"></div><div class="ar-foot"><button type="button" class="btn btn-sm" id="arAdd">＋ 添加规则</button><button type="button" class="btn btn-sm" id="arPreview">整理现有未分类 · 先预览</button></div><p class="ar-error" role="alert"></p>',async function(close){if(busy)return;try{await save();toast('规则已保存');close();}catch(e){error(e.message);}});
  var overlay=document.querySelector('.modal-overlay:last-child'),list=overlay.querySelector('.ar-rules');
  var panel=overlay.querySelector('.modal');panel.setAttribute('aria-label','自动分类规则');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');overlay.querySelector('#mC').textContent='保存';
  function blank(){return {kw:'',fields:['title','filename'],group:'',cols:[]};}
  function error(value){overlay.querySelector('.ar-error').textContent=value||'';}
  function collect(){list.querySelectorAll('.ar-rule').forEach(function(card,i){draft.rules[i].kw=card.querySelector('.ar-keyword').value;draft.rules[i].group=card.querySelector('select').value;draft.rules[i].fields=Array.from(card.querySelectorAll('[data-field]:checked')).map(function(x){return x.dataset.field;});});draft.auto=overlay.querySelector('#arAuto').checked;}
  function draw(){
   list.innerHTML=draft.rules.map(function(r,i){return '<section class="ar-rule" data-i="'+i+'"><div class="ar-head"><strong>规则 '+(i+1)+'</strong><button class="btn btn-sm" data-action="up" '+(!i?'disabled':'')+' aria-label="上移规则">↑</button><button class="btn btn-sm" data-action="down" '+(i===draft.rules.length-1?'disabled':'')+' aria-label="下移规则">↓</button><button class="btn btn-sm hub-danger" data-action="delete">删除</button></div><label>关键词<input class="input ar-keyword" maxlength="500" value="'+esc(r.kw)+'" placeholder="例如：短剧, 动漫"></label><div class="ar-fields">'+[['title','标题'],['filename','文件名'],['author','作者'],['sub','订阅源']].map(function(f){return '<label><input type="checkbox" data-field="'+f[0]+'" '+(r.fields.includes(f[0])?'checked':'')+'>'+f[1]+'</label>';}).join('')+'</div><label>目标分组<select class="input"><option value="">不分组</option>'+groups.map(function(g){return '<option value="'+esc(g.id)+'" '+(g.id===r.group?'selected':'')+'>'+esc(g.name)+'</option>';}).join('')+'</select></label><label>加入手动合集（可多选）</label><div class="ar-cols">'+cols.map(function(c){return '<button type="button" class="btn btn-sm" data-col="'+esc(c.id)+'" aria-pressed="'+r.cols.includes(c.id)+'">'+esc(c.title)+'</button>';}).join('')+'</div></section>';}).join('')||'<p class="hub-help">暂无规则。点击添加规则开始。</p>';
  }
  list.onclick=function(e){var b=e.target.closest('button'),card=b&&b.closest('.ar-rule');if(!card||busy)return;collect();var i=Number(card.dataset.i),r=draft.rules[i],act=b.dataset.action;
   if(b.dataset.col){var n=r.cols.indexOf(b.dataset.col);if(n<0)r.cols.push(b.dataset.col);else r.cols.splice(n,1);b.setAttribute('aria-pressed',String(n<0));return;}
   if(act==='delete')draft.rules.splice(i,1);else{var j=i+(act==='up'?-1:1);if(j>=0&&j<draft.rules.length){var tmp=r;draft.rules[i]=draft.rules[j];draft.rules[j]=tmp;}}draw();
  };
  overlay.querySelector('#arAdd').onclick=function(){if(busy)return;collect();if(draft.rules.length>=100){error('最多 100 条规则');return;}draft.rules.push(blank());draw();list.scrollTop=list.scrollHeight;};
  async function save(){
   collect();error('');busy=true;overlay.querySelectorAll('button,input,select').forEach(function(x){x.disabled=true;});
   try{return await request('',{method:'PUT',json:{auto:draft.auto,rules:draft.rules}});}
   finally{busy=false;overlay.querySelectorAll('button,input,select').forEach(function(x){x.disabled=false;});draw();}
  }
  overlay.querySelector('#arPreview').onclick=async function(){
   if(busy)return;try{await save();var p=await request('/preview',{method:'POST',json:{}});preview(p);}catch(e){error(e.message);}
  };
  function preview(p){
   var groupNames=new Map(p.groups.map(function(g){return [g.id,g.name];})),colNames=new Map(p.collections.map(function(c){return [c.id,c.title];}));
   showModal('确认整理现有未分类模块','<p class="hub-help">已检查 '+p.checked+' 个未分类模块（每次最多 2000 个），将更改 '+p.changes.length+' 个。只移动下列模块并追加指定合集，不删除模块，不改变备注和已有顺序。</p><ul class="ar-preview">'+p.changes.map(function(c){return '<li><strong>'+esc(c.title)+'</strong><br>'+esc((c.group?'分组：'+groupNames.get(c.group)+'；':'')+(c.collections.length?'加入合集：'+c.collections.map(function(id){return colNames.get(id);}).join('、'):''))+'</li>';}).join('')+'</ul><p class="ar-error" role="alert"></p>',async function(close){
    var dialog=document.querySelector('.modal-overlay:last-child'),button=dialog.querySelector('#mC');button.disabled=true;
    try{var r=await request('/run',{method:'POST',json:{token:p.token}});close();toast('分组 '+r.grouped+' 个，加入合集 '+r.added+' 次');await loadAll();}catch(e){dialog.querySelector('.ar-error').textContent=e.message;button.disabled=false;}
   });
   var panel=document.querySelector('.modal-overlay:last-child');panel.querySelector('#mC').textContent='确认整理';panel.querySelector('#mC').disabled=!p.changes.length;
  }
  draw();
 }
})();
`;
