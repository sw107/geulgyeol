const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('host keeps new document inert until initialization completes and restores on error',async()=>{
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',showModal(){this.open=true;}});return elements.get(id);};
 let complete;let focusCount=0;let calls=0;
 const host={state:()=>({dirty:false,fileName:'old.hwp'}),newDocument:()=>{calls++;return new Promise(r=>complete=r);},focus:()=>focusCount++};
 const frame={contentWindow:{baramHost:host},addEventListener(){}};
 get('editor').querySelector=()=>frame;
 const script=fs.readFileSync(require.resolve('../web/baram.js'),'utf8').replace(/^import .*;$/gm,'');
 await vm.runInNewContext('(async()=>{'+script+'})()',{
  document:{getElementById:get},window:{addEventListener(){}},location:{href:'http://localhost/',origin:'http://localhost'},URL,
  createStudio:async()=>({}),observeComposition(){},confirm:()=>true,
 });
 const pending=get('new').onclick();
 assert.equal(get('editor').inert,true);assert.equal(get('new').disabled,true);
 await get('new').onclick();assert.equal(calls,1);assert.equal(focusCount,0);
 complete({dirty:false,fileName:'new.hwp'});await pending;
 assert.equal(get('editor').inert,false);assert.equal(get('filename').textContent,'new.hwp');assert.equal(focusCount,1);
 host.newDocument=async()=>{throw Error('initialization failed');};
 await get('new').onclick();assert.equal(get('editor').inert,false);assert.equal(get('error-dialog').open,true);assert.equal(focusCount,1);
 get('error-dialog').onclose();assert.equal(focusCount,2);
});
test('completed open preserves authoritative dirty state instead of clearing it',async()=>{
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{showModal(){},textContent:''});return elements.get(id);};
 let state={dirty:false,fileName:'old.hwp'};const reported=[];
 const frame={contentWindow:{baramHost:{state:()=>state}},addEventListener(){}};get('editor').querySelector=()=>frame;
 const script=fs.readFileSync(require.resolve('../web/baram.js'),'utf8').replace(/^import .*;$/gm,'');
 await vm.runInNewContext('(async()=>{'+script+'})()',{
  document:{getElementById:get},window:{addEventListener(){},baram:{open:async()=>({data:new Uint8Array([1]),name:'opened.hwp'}),setDirty:v=>reported.push(v),onAction(){}}},
  location:{href:'http://localhost/'},URL,Uint8Array,observeComposition(){},confirm:()=>true,
  createStudio:async()=>({loadFile:async()=>{state={dirty:true,fileName:'opened.hwp'};return {pageCount:1};}}),
 });
 await get('open').onclick();assert.equal(reported.at(-1),true);assert.equal(get('filename').textContent,'opened.hwp · 수정됨');
});
