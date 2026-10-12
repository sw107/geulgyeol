import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {finishOwnedQA,waitForOwnedQAExit} from '../electron-qa-exit.mjs';
function child(code) {return spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','inherit']});}
function ready(p) {return new Promise((resolve,reject)=>{p.stdout.once('data',resolve);p.once('error',reject);});}
test('SIGTERM fallback waits for a delayed exit, rather than reporting null immediately',async()=>{
 const p=child("process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),100));console.log('ready');setInterval(()=>{},1000)");await ready(p);
 const start=Date.now(),r=await finishOwnedQA(p,{requestClose:()=>{},allowTerminate:true,closeTimeoutMs:10,terminationTimeoutMs:2000});
 assert(Date.now()-start>=100);assert(r.exitConfirmed);assert.equal(r.exitCode,0);assert(r.terminationRequested);assert(!r.terminationUnconfirmed);assert(!r.normalQuit);
});
test('a deadline without an exit stays explicitly unconfirmed; no implicit kill',async()=>{
 const p=child("console.log('ready');setTimeout(()=>process.exit(0),200)");await ready(p);
 const r=await finishOwnedQA(p,{requestClose:()=>{},closeTimeoutMs:10});assert(r.terminationUnconfirmed);assert(!r.terminationRequested);assert.equal(r.exitCode,null);
 const eventual=await waitForOwnedQAExit(p,2000);assert(eventual.exitConfirmed);assert.equal(eventual.exitCode,0);
});
test('normal exit is confirmed and signals retain their own outcome',async()=>{
 const p=child("console.log('ready');setInterval(()=>{},1000)");await ready(p);
 const r=await finishOwnedQA(p,{requestClose:()=>p.kill('SIGTERM'),closeTimeoutMs:2000});assert(r.exitConfirmed);assert.equal(r.exitCode,null);assert.equal(r.signalCode,'SIGTERM');assert(!r.normalQuit);
});
