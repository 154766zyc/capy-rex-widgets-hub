import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseModuleMeta,resolveTitle,titleSource,generatedFilename,METADATA_SCAN_BYTES} from './metadata.js';

test('title resolution, locked overrides, empty values and filename fallback',()=>{
  const mod={filename:'123av-stream 1.1.0.js',title:'saved',code_title:'code',manifest_title:'manifest'};
  assert.equal(resolveTitle(mod),'code');
  assert.equal(resolveTitle({...mod,title_locked:1}),'saved');
  assert.equal(resolveTitle(mod,'','manifest'),'manifest');
  assert.equal(resolveTitle(mod,'',''),'saved');
  assert.equal(resolveTitle({filename:mod.filename}),'123av-stream 1.1.0');
  assert.equal(resolveTitle({...mod,code_title:'  ',manifest_title:' ',title:' '}),'123av-stream 1.1.0');
  assert.equal(titleSource(mod),'模块代码中的 title');
  assert.equal(titleSource({...mod,title_locked:1}),'自定义标题（已锁定）');
  assert.equal(titleSource({...mod,code_title:''}),'订阅清单标题');
  assert.equal(generatedFilename({id:'uuid',filename:'uuid.js',generated_filename:1}),true);
  assert.equal(generatedFilename({id:'uuid',filename:'uuid.js',generated_filename:0}),false);
  assert.equal(generatedFilename({id:'uuid',filename:'real.js',generated_filename:1}),false);
});

test('filename-derived titles use the accepted name and retain filename provenance without stripping explicit titles',()=>{
  const mod={filename:'REX_影视.js',effective_filename:'影视.js',title:'REX_影视',code_title:'',manifest_title:''};
  assert.equal(resolveTitle(mod),'影视');assert.equal(titleSource(mod),'文件名');
  assert.equal(resolveTitle({...mod,title:'影视'}),'影视');assert.equal(titleSource({...mod,title:'影视'}),'文件名');
  assert.equal(resolveTitle({...mod,title:'',effective_filename:'自定义文件名.js'}),'自定义文件名');
  assert.equal(resolveTitle({...mod,effective_filename:'REX_影视.js'}),'REX_影视');
  assert.equal(resolveTitle({...mod,code_title:'Rex 官方片单'}),'Rex 官方片单');
  assert.equal(resolveTitle({...mod,manifest_title:'REX 订阅名称'}),'REX 订阅名称');
  assert.equal(resolveTitle({...mod,title_locked:1}),'REX_影视');
  assert.equal(resolveTitle({...mod,title:'我的 Rex 模块'}),'我的 Rex 模块');
  assert.equal(titleSource({...mod,title:'我的 Rex 模块'}),'已保存标题');
});

test('static title parser reads literal fields, ignores nested fields, methods and dynamic expressions',()=>{
  const text=`// WidgetMetadata = {title: 'comment'}
    const fake = "WidgetMetadata = {title: 'string'}";
    const pattern = /const WidgetMetadata = {title: 'regex'}/;
    var WidgetMetadata = {
      nested: { title: 'wrong', modules:[{id:'nested'}] },
      method(){return {title:'method'}},
      title: '中文 (4K) [测试] <x>', id: "actual-id", version: \`1.2.3\`,
      author: 'A' + 'B', requiredVersion: '0.0.9',
      modules: [{title:'nested after'}]
    }; throw new Error('must not execute');`;
  assert.deepEqual(parseModuleMeta('x.js',text),{
    title:'中文 (4K) [测试] <x>',id:'actual-id',version:'1.2.3',requiredVersion:'0.0.9'
  });
  assert.deepEqual(parseModuleMeta('x.js',"WidgetMetadata={title: getTitle(), version:'1', author:`${dynamic}`};"),{version:'1'});
  assert.deepEqual(parseModuleMeta('x.js','WidgetMetadata={title:"A\\u4e2d\\x42",id:\'i\\\'d\'}'),{title:'A中B',id:"i'd"});
});

test('metadata scan is bounded, supports headers beyond 32KiB, and never reads REXENC payloads',()=>{
  const text='/*'+'x'.repeat(40000)+'*/\nWidgetMetadata={title:"beyond 32KiB"};';
  assert.equal(parseModuleMeta('x.js',text).title,'beyond 32KiB');
  assert.deepEqual(parseModuleMeta('x.js','/*'+'x'.repeat(METADATA_SCAN_BYTES)+'*/WidgetMetadata={title:"late"}'),{});
  assert.deepEqual(parseModuleMeta('x.js','REXENC\n{"v":1}\nWidgetMetadata={id:"fake",title:"fake"};'),{});
  assert.deepEqual(parseModuleMeta('x.js','\uFEFFREXENC\r\n{"v":1}\nWidgetMetadata={title:"fake"};'),{});
});
