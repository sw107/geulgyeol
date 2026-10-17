// No Electron process or document files: actual desktop host with gated adapters.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reopenedHostReady} from './check-electron-cell-numbering-continuation.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function host({cancel=false,fail=false,earlyEpoch=false}={}) {
  const elements=new Map(),get=id=>{
    if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:'',value:'hwp',open:false,showModal(){this.open=true;}});
    return elements.get(id);
  };
  const started=deferred(),gate=deferred(),saves=[];
  let state={dirty:true,fileName:'same.hwp',documentEpoch:1,changeSeq:1};
  const fileHost={state:()=>({...state}),export:()=>new Uint8Array([1]),setFileActions(){},focus(){},
    completeSavedSnapshot:async name=>{state={...state,dirty:false,fileName:name};return {ok:true};},
    loadDocument:async()=>{
      if(earlyEpoch)state={...state,documentEpoch:2,changeSeq:0};
      started.resolve();await gate.promise;
      if(fail)throw Error('controlled load failure');
      state={...state,documentEpoch:2,changeSeq:0};return {pageCount:3};
    },
  };
  const frame={contentWindow:{baramHost:fileHost},addEventListener(){}};
  get('editor').querySelector=()=>frame;
  const context={document:{getElementById:get},window:{addEventListener(){},baram:{
    onAction(){},setDirty(){},save:async(_bytes,_name,format)=>{saves.push(format);return {name:'same.hwp',size:1};},
    open:async()=>cancel?null:{data:new Uint8Array([1]),name:'same.hwp'},
  }},location:{href:'http://127.0.0.1/',origin:'http://127.0.0.1'},URL,Uint8Array,
    createStudio:async()=>({getDocumentState:async()=>({...state})}),observeComposition(){},confirm:()=>true};
  const source=fs.readFileSync(new URL('../desktop/web/baram.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
  await vm.runInNewContext('(async()=>{'+source+'})()',context);
  const ready=vm.runInNewContext('('+reopenedHostReady.toString()+')',context);
  await get('save').onclick();assert.deepEqual(saves,['hwp']);
  return {get,ready:()=>ready({name:'same.hwp',beforeEpoch:1}),started,gate,saves,state:()=>state};
}

for(const earlyEpoch of [false,true])test(`same-name reopen waits for commit and host settlement (early epoch=${earlyEpoch})`,async()=>{
  const h=await host({earlyEpoch});
  // The previous filename/button predicate already passes before Open starts.
  assert(!h.get('save').disabled && h.get('filename').textContent==='same.hwp');
  assert.equal(h.ready(),false);
  const opening=h.get('open').onclick();await h.started.promise;
  assert.equal(h.get('save').disabled,true);assert.equal(h.ready(),false);
  await h.get('save').onclick();assert.deepEqual(h.saves,['hwp'],'busy host rejects an early second save');
  h.gate.resolve();await opening;assert.equal(h.ready(),true);
  h.get('format').value='hwpx';await h.get('save').onclick();
  assert.deepEqual(h.saves,['hwp','hwpx'],'the next format is selected after host reset');
});

test('cancelled Open never satisfies the reopen gate',async()=>{
  const h=await host({cancel:true});await h.get('open').onclick();
  assert.equal(h.get('save').disabled,false);assert.equal(h.state().documentEpoch,1);assert.equal(h.ready(),false);
});

test('failed load remains rejected even if its epoch was published early',async()=>{
  const h=await host({fail:true,earlyEpoch:true}),opening=h.get('open').onclick();await h.started.promise;
  assert.equal(h.ready(),false);h.gate.resolve();await opening;
  assert.equal(h.state().documentEpoch,2);assert.equal(h.get('save').disabled,false);
  assert.equal(h.get('error-dialog').open,true);assert.equal(h.ready(),false);
});
