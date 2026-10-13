const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function load(){
 const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/command/print-surface.ts'),'utf8');
 const exports={};const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/export /g,'')+'\nObject.assign(exports,{waitForPrintSurfaceReady,PrintSurfaceClosedError});';
 vm.runInNewContext(code,{exports,AbortController,Promise,Error});return exports;
}
function surface({fonts=Promise.resolve(),deliverFrames=true}={}){
 const timers=new Set(),frames=new Map(),events=[];let id=0;
 const hostWindow={setInterval(fn){const t=setInterval(fn,1);timers.add(t);return t;},clearInterval(t){clearInterval(t);timers.delete(t);},setTimeout(fn,ms){const t=setTimeout(fn,ms);timers.add(t);return t;},clearTimeout(t){clearTimeout(t);timers.delete(t);}};
 const window={closed:false,requestAnimationFrame(fn){const key=++id;frames.set(key,fn);if(deliverFrames)setImmediate(()=>{if(frames.delete(key)){events.push('frame');fn();}});return key;},cancelAnimationFrame(key){frames.delete(key);}};
 const document={fonts:{ready:fonts},documentElement:{getBoundingClientRect(){events.push('layout');return {};}}};
 return {surface:{window,document},hostWindow,timers,frames,events};
}
test('readiness waits for fonts and two paints before measuring, then removes owner timers',async()=>{
 const api=load(),s=surface();await api.waitForPrintSurfaceReady(s.surface,{hostWindow:s.hostWindow,timeoutMs:1000});
 assert.deepEqual(s.events,['frame','frame','layout']);assert.equal(s.timers.size,0);assert.equal(s.frames.size,0);
});
test('closing a child with a discarded paint callback rejects and cancels that callback',async()=>{
 const api=load(),s=surface({deliverFrames:false});const pending=api.waitForPrintSurfaceReady(s.surface,{hostWindow:s.hostWindow,timeoutMs:1000});
 const rejection=assert.rejects(pending,e=>e instanceof api.PrintSurfaceClosedError);
 await new Promise(setImmediate);assert.equal(s.frames.size,1);s.surface.window.closed=true;await rejection;
 assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);assert.deepEqual(s.events,[]);
});
test('closing while fonts never resolve also releases readiness and all owner timers',async()=>{
 const api=load(),s=surface({fonts:new Promise(()=>{})});const pending=api.waitForPrintSurfaceReady(s.surface,{hostWindow:s.hostWindow,timeoutMs:1000});
 const rejection=assert.rejects(pending,e=>e instanceof api.PrintSurfaceClosedError);s.surface.window.closed=true;await rejection;
 assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);assert.deepEqual(s.events,[]);
});
test('an open child with stalled readiness times out and removes the pending callback',async()=>{
 const api=load(),s=surface({deliverFrames:false});await assert.rejects(api.waitForPrintSurfaceReady(s.surface,{hostWindow:s.hostWindow,timeoutMs:10}),/준비 시간이 초과/);
 assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);assert.deepEqual(s.events,[]);
});
