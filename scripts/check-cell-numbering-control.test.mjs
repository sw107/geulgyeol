// Worker threads and temporary control files only; no Electron/GUI process.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {publishControl,assertCleanHostAudit} from './check-electron-cell-numbering-continuation.mjs';

const bootstrap=fs.readFileSync(new URL('./electron-document-lifecycle-bootstrap.cjs',import.meta.url),'utf8');
const declaration=bootstrap.match(/^const control = .*;$/m)?.[0];
assert(declaration,'actual bootstrap control reader');
const readerSource=declaration+'\ncontrol';
function folder(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-control-unit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;
}

test('actual bootstrap reader reproduces truncation and accepts atomic replacement',t=>{
  const dir=folder(t),file=path.join(dir,'control.json');
  const read=vm.runInNewContext(readerSource,{fs,path,q:dir});
  publishControl(file,{id:'old'});assert.equal(read().id,'old');
  const fd=fs.openSync(file,'w');
  try {assert.throws(()=>read(),/Unexpected end of JSON input/);fs.writeFileSync(fd,'{"id":"direct"}\n');}
  finally {fs.closeSync(fd);}
  publishControl(file,{id:'complete',menu:'실행 취소'});
  assert.equal(read().id,'complete');assert.equal(read().menu,'실행 취소');
  assert.deepEqual(fs.readdirSync(dir),['control.json']);
});

test('concurrent actual bootstrap reads never observe partial control JSON',async t=>{
  const dir=folder(t),file=path.join(dir,'control.json'),stop=new SharedArrayBuffer(4);
  const plan=seq=>({id:'plan-'+seq,seq,padding:String(seq).padStart(4,'0').repeat(8192)});
  publishControl(file,plan(0));
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
    const read=vm.runInNewContext(workerData.source,{fs,path,q:workerData.dir});
    const stop=new Int32Array(workerData.stop);let reads=0;const seen=new Set();
    try {
      const consume=()=>{const p=read();if(p.id!=='plan-'+p.seq||p.padding!==String(p.seq).padStart(4,'0').repeat(8192))throw Error('torn plan');reads++;seen.add(p.seq);};
      consume();parentPort.postMessage('ready');
      do {consume();}while(!Atomics.load(stop,0));
      consume(); // The final published plan is visible even after delayed scheduling.
      parentPort.postMessage({reads,versions:seen.size});
    }catch(error){parentPort.postMessage({error:String(error),reads});}
  `,{eval:true,workerData:{source:readerSource,dir,stop}});
  t.after(async()=>{Atomics.store(new Int32Array(stop),0,1);await worker.terminate();});
  const [ready]=await once(worker,'message');assert.equal(ready,'ready');
  const completion=once(worker,'message');
  for(let i=1;i<=250;i++)publishControl(file,plan(i));
  Atomics.store(new Int32Array(stop),0,1);
  const [result]=await completion;assert.equal(result.error,undefined);assert(result.reads>0);assert(result.versions>1);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).seq,250);
  assert.deepEqual(fs.readdirSync(dir),['control.json']);
});

test('serialization failure preserves the previously published plan',t=>{
  const dir=folder(t),file=path.join(dir,'control.json');publishControl(file,{id:'keep'});
  const before=fs.readFileSync(file);const circular={};circular.self=circular;
  assert.throws(()=>publishControl(file,circular),/circular/i);
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(dir),['control.json']);
});

test('host and caught control errors reject otherwise successful renderer results',()=>{
  const clean=JSON.stringify({kind:'bootstrap'})+'\n'+JSON.stringify({kind:'will-quit'})+'\n';
  assert.deepEqual(assertCleanHostAudit(clean),{records:2,hostErrorCount:0,controlErrorCount:0,verifiedAfterExit:true});
  for(const kind of ['host-error','control-error']) {
    const bad=clean+JSON.stringify({kind,title:'A JavaScript error occurred in the main process',message:'SyntaxError: Unexpected end of JSON input'})+'\n';
    assert.throws(()=>assertCleanHostAudit(bad),/Unexpected end of JSON input/);
  }
  assert.throws(()=>assertCleanHostAudit(''),/audit is missing/);
  assert.throws(()=>assertCleanHostAudit(clean+'{"kind":'),SyntaxError);
});
