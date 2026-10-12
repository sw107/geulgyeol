const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {startSerialPoll}=require('../electron-qa-serial-poll.cjs');
function clock(){const callbacks=[],canceled=[];return {callbacks,canceled,schedule:fn=>{callbacks.push(fn);return callbacks.length-1;},cancel:id=>canceled.push(id)};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('slow task schedules only after completion and ignores overlapping/stale ticks',async()=>{
 const c=clock(),d=deferred();let calls=0;
 const poll=startSerialPoll(async()=>{calls++;await d.promise;},{...c,onError:e=>{throw e;}});
 const pending=c.callbacks[0]();await c.callbacks[0]();await c.callbacks[0]();assert.equal(calls,1);assert.equal(c.callbacks.length,1);
 d.resolve();await pending;assert.equal(c.callbacks.length,2);await c.callbacks[0]();assert.equal(calls,1);
 poll.stop();await c.callbacks[1]();assert.equal(calls,1);assert.deepEqual(c.canceled,[1]);
});
test('stop during a pending task prevents rescheduling',async()=>{
 const c=clock(),d=deferred();let stoppedObserved=false;
 const poll=startSerialPoll(async isStopped=>{await d.promise;stoppedObserved=isStopped();},{...c,onError:e=>{throw e;}});
 const pending=c.callbacks[0]();poll.stop();d.resolve();await pending;assert(stoppedObserved);assert.equal(c.callbacks.length,1);
});
test('task rejection reports once and stops polling',async()=>{
 const c=clock(),error=new Error('delayed lookup rejected'),reports=[];
 startSerialPoll(async()=>{throw error;},{...c,onError:e=>reports.push(e)});
 await c.callbacks[0]();await c.callbacks[0]();assert.deepEqual(reports,[error]);assert.equal(c.callbacks.length,1);
});
async function driver({proofFailure=false,failureRecordFailure=false}={}){
 const c=clock(),query=deferred(),files=new Map(),attempts=[],logs=[];let polling=false,rendererQueries=0;
 const app=new EventEmitter();Object.assign(app,{setPath(){},setName(){},commandLine:{appendSwitch(){}},whenReady:()=>Promise.resolve(),quit(){if(this.quitCount)return;this.quitCount=1;this.emit('will-quit');},quitCount:0});
 const phase='/synthetic-qa',key=f=>path.basename(f),state=JSON.stringify({ready:true,synthetic:true});
 const fakeFS={existsSync:f=>files.has(key(f)),mkdirSync(){},readFileSync:f=>{assert(files.has(key(f)),key(f));return files.get(key(f));},writeFileSync(f,bytes,options){const name=key(f);attempts.push(name);if((name==='os-proof.json'&&proofFailure)||(name==='failure.json'&&failureRecordFailure)){const e=new Error('EEXIST synthetic '+name+' write');e.code='EEXIST';throw e;}if(options?.flag==='wx'&&files.has(name)){const e=new Error('EEXIST '+name);e.code='EEXIST';throw e;}files.set(name,Buffer.from(bytes));}};
 class Window{constructor(){this.webContents=new EventEmitter();Object.assign(this.webContents,{loadFile:async()=>{},executeJavaScript:async code=>{if(code.startsWith('Boolean('))return true;if(code.startsWith('JSON.stringify(')){if(polling){rendererQueries++;return query.promise;}return state;}},printToPDF:async()=>Buffer.from('%PDF-synthetic-only'),getURL:()=> 'file:///synthetic-qa/controls.html'});}loadFile(){return Promise.resolve();}getTitle(){return 'Synthetic QA';}}
 files.set('controls.html',Buffer.from('synthetic'));
 const context={require:name=>name==='electron'?{app,BrowserWindow:Window}:name==='node:fs'?fakeFS:name==='./electron-qa-serial-poll.cjs'?{startSerialPoll:(task,options)=>startSerialPoll(task,{...options,...c})}:require(name),process:{env:{GEULGYEOL_PRINT_ISOLATION_DIR:phase},versions:{test:'VM-only'}},Buffer,setTimeout,clearTimeout,Date,console:{log:m=>logs.push(String(m)),error:(...m)=>logs.push(m.map(String).join(' '))}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../check-electron-pdf-font-isolation.cjs'),'utf8'),context);
 await flush();assert(files.has('ready.json'));
 files.set('os-saved.json',Buffer.from(JSON.stringify({nativeDialogObserved:true,PDFSaveMenuInvoked:true,OSSavePanelObserved:true,SaveButtonInvoked:true,noPrinterOutput:true})));
 files.set('os-native-controls.pdf',Buffer.from('%PDF-synthetic-only'));files.set('native-called.json',Buffer.from('{}'));polling=true;
 return {c,query,files,attempts,logs,app,state,rendererQueries:()=>rendererQueries};
}
test('final driver performs one renderer query and one completion write under overlapping ticks',async()=>{
 const d=await driver(),pending=d.c.callbacks[0]();await d.c.callbacks[0]();await d.c.callbacks[0]();assert.equal(d.rendererQueries(),1);assert(!d.files.has('os-proof.json'));
 d.query.resolve(d.state);await pending;assert.equal(d.attempts.filter(x=>x==='os-proof.json').length,1);assert(d.files.has('os-proof.json'));
 await d.c.callbacks[1]();assert.equal(d.rendererQueries(),1);assert.equal(d.attempts.filter(x=>x==='os-proof.json').length,1);d.app.quit();
});
test('final driver captures proof-write failure and quits once without retrying the completion',async()=>{
 const d=await driver({proofFailure:true}),pending=d.c.callbacks[0]();await d.c.callbacks[0]();d.query.resolve(d.state);await pending;await d.c.callbacks[0]();
 assert.equal(d.attempts.filter(x=>x==='os-proof.json').length,1);assert(!d.files.has('os-proof.json'));assert.match(JSON.parse(d.files.get('failure.json')).error,/EEXIST/);assert.equal(d.app.quitCount,1);assert.equal(d.c.callbacks.length,1);
});
test('final driver captures async renderer rejection through the shared failure path',async()=>{
 const d=await driver(),pending=d.c.callbacks[0]();d.query.reject(new Error('slow renderer query failed'));await pending;
 assert.match(JSON.parse(d.files.get('failure.json')).error,/slow renderer/);assert.equal(d.app.quitCount,1);assert(!d.files.has('os-proof.json'));
});
test('failure-record write error still quits and does not escape the polling callback',async()=>{
 const d=await driver({proofFailure:true,failureRecordFailure:true}),pending=d.c.callbacks[0]();d.query.resolve(d.state);await pending;
 assert.equal(d.app.quitCount,1);assert(!d.files.has('os-proof.json'));assert(d.logs.some(x=>x.includes('failure record could not be written')));assert.match(JSON.parse(d.files.get('will-quit.json')).error,/os-proof/);
});
test('normal quit during slow renderer lookup prevents a late proof write',async()=>{
 const d=await driver(),pending=d.c.callbacks[0]();d.app.quit();d.query.resolve(d.state);await pending;
 assert(!d.files.has('os-proof.json'));assert(!d.files.has('failure.json'));assert.equal(d.c.callbacks.length,1);
});
