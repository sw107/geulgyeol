const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createExternalOpenQueue, readDocumentFile} = require('../external-open.cjs');
const {MAX_BYTES} = require('../storage.cjs');
const desktop = path.resolve(__dirname, '..');
const sourceRoot = process.env.GEULGYEOL_EXTERNAL_OPEN_BASELINE || desktop;
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
const tick = () => new Promise(r => setImmediate(r));
async function until(fn) {for (let i = 0; i < 100; i++) {if (fn()) return; await tick();} assert.fail('operation did not settle');}

async function bootMain() {
  const app = new EventEmitter(), ready = deferred(), shown = deferred(), handlers = new Map(), errors = [];
  Object.assign(app, {setPath(){}, getPath:() => os.tmpdir(), requestSingleInstanceLock:() => true,
    whenReady:() => ready.promise, quit(){}, getVersion:() => 'test', setAboutPanelOptions(){}});
  let win;
  class Window extends EventEmitter {
    constructor() {super(); win = this; this.webContents = new EventEmitter(); Object.assign(this.webContents,
      {mainFrame:{url:'http://127.0.0.1:12345/'}, send(){},setWindowOpenHandler(){}});}
    isDestroyed(){return false;} show(){shown.resolve();} async loadURL(){} setDocumentEdited(){}
  }
  const electron = {app, BrowserWindow:Window, Menu:{buildFromTemplate:x => x, setApplicationMenu(){}},
    dialog:{showErrorBox:(...args) => errors.push(args)}, ipcMain:{handle:(k,v) => handlers.set(k,v), on(){}},
    session:{defaultSession:{webRequest:{onBeforeRequest(){}}, setPermissionRequestHandler(){}, setPermissionCheckHandler(){}, on(){}}}};
  vm.runInNewContext(sync.readFileSync(path.join(sourceRoot,'main.cjs'),'utf8'), {
    require:name => name === 'electron' ? electron : name === './profile-server.cjs' ?
      {startProfileServer:async() => ({origin:'http://127.0.0.1:12345',server:{close(){}}})} :
      name.startsWith('./') ? require(path.join(desktop,name)) : require(name),
    __dirname:desktop, process:{platform:'darwin'}, Buffer, Uint8Array,
  });
  return {app, errors, handlers, async start(){ready.resolve(); await shown.promise;},
    event:() => ({sender:win.webContents,senderFrame:win.webContents.mainFrame})};
}

test('main retains pre-ready macOS open-file requests; trusted IPC consumes only queued files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'geulgyeol-external-open-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const target = path.join(dir,'합성.HWPX'); await fs.writeFile(target,'synthetic requested bytes');
  const host = await bootMain(); let prevented = false;
  host.app.emit('open-file',{preventDefault(){prevented=true;}},target);
  assert(prevented,'macOS open-file must be handled before ready');
  await host.start(); const take = host.handlers.get('baram:take-open-file');
  assert.throws(() => take({...host.event(),sender:{}}), /허용되지/);
  assert.throws(() => take({...host.event(),senderFrame:{}}), /허용되지/);
  const file = await take(host.event(), '/not-an-authorized-path.hwp');
  assert.equal(file.name,'합성.HWPX'); assert.equal(Buffer.from(file.data).toString(),'synthetic requested bytes');
  assert.equal(await take(host.event()),null); assert.deepEqual(host.errors,[]);
});

test('queue preserves order, rejects overlapping reads and recovers from read failure', async () => {
  const gate = deferred(); let notifications = 0;
  const queue = createExternalOpenQueue(() => notifications++, async target => {
    if (target.endsWith('first.hwp')) return gate.promise;
    if (target.endsWith('missing.hwpx')) throw Error('ENOENT');
    return {name:path.basename(target)};
  });
  for (const name of ['first.hwp','missing.hwpx','last.HWPX']) queue.enqueue('/synthetic/'+name);
  const first = queue.take(); await assert.rejects(queue.take(),/읽고/);
  gate.resolve({name:'first.hwp'}); assert.equal((await first).name,'first.hwp');
  await assert.rejects(queue.take(),/ENOENT/); assert.equal((await queue.take()).name,'last.HWPX');
  assert.equal(await queue.take(),null); assert.equal(notifications,3);
});

test('queue validates native paths and bounds pending requests without silently discarding them', async () => {
  const queue = createExternalOpenQueue(() => {}, async target => ({name:path.basename(target)}));
  for (const invalid of [null,42,'relative.hwp','https://example.com/a.hwp','/tmp/a.pdf']) assert.throws(() => queue.enqueue(invalid));
  for (let i=0;i<32;i++) queue.enqueue(`/synthetic/${i}.hwp`);
  assert.throws(() => queue.enqueue('/synthetic/overflow.hwp'),/너무 많/);
  for (let i=0;i<32;i++) assert.equal((await queue.take()).name,`${i}.hwp`);
});

test('file reader rejects oversized files/directories, closes handles and leaves input bytes intact', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'geulgyeol-open-read-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'input.hwp'), bytes=Buffer.alloc(65537,71); await fs.writeFile(file,bytes);
  assert.deepEqual(Buffer.from((await readDocumentFile(file)).data),bytes);
  assert.deepEqual(await fs.readFile(file),bytes);
  const large=path.join(dir,'large.hwp'), h=await fs.open(large,'wx'); await h.truncate(MAX_BYTES+1); await h.close();
  await assert.rejects(readDocumentFile(large),/64 MB/); await assert.rejects(readDocumentFile(dir),/일반 문서/);
  await fs.unlink(large); await assert.rejects(readDocumentFile(large),/ENOENT/);
});

async function bootUI({startup, take, choice, save} = {}) {
  const elements = new Map(), get = id => {
    if (!elements.has(id)) elements.set(id,{disabled:true,open:false,textContent:'',value:'hwpx',
      showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}});
    return elements.get(id);
  };
  let state={dirty:false,fileName:'old.hwp',documentEpoch:1,changeSeq:0}, action, reads=0, prompts=0;
  const queue=[], loaded=[], expectedVersions=[];
  const host={ready:() => startup?.promise, state:() => ({...state}), setFileActions(){}, focus(){},
    export:() => new Uint8Array([1]), completeSavedSnapshot:async(name,expected) => {
      if (state.documentEpoch!==expected.documentEpoch || state.changeSeq!==expected.changeSeq) return {ok:false};
      state={...state,dirty:false,fileName:name}; return {ok:true};
    }, loadDocument:async(data,name,expected) => {
      assert.equal(expected.documentEpoch,state.documentEpoch); assert.equal(expected.changeSeq,state.changeSeq);
      if (name==='invalid.hwp') throw Error('invalid synthetic document');
      loaded.push(name); expectedVersions.push({...expected});
      state={dirty:false,fileName:name,documentEpoch:state.documentEpoch+1,changeSeq:0}; return {pageCount:1};
    }};
  get('editor').querySelector=() => ({contentWindow:{baramHost:host},addEventListener(){}});
  const baram={onAction:fn => action=fn,setDirty(){},
    takeOpenFile:async() => {reads++;return take ? take() : queue.shift() || null;},
    confirmUnsaved:async() => {prompts++;return choice ? choice() : 'cancel';},
    save:async() => save ? save() : null};
  const starting=vm.runInNewContext('(async()=>{'+sync.readFileSync(path.join(sourceRoot,'web/baram.js'),'utf8').replace(/^import .*;$/gm,'')+'})()',{
    document:{getElementById:get},window:{addEventListener(){},baram},URL,Uint8Array,
    location:{href:'http://127.0.0.1/',origin:'http://127.0.0.1'},observeComposition(){},
    createStudio:async() => ({getDocumentState:async() => ({...state})}),
  });
  await tick(); if (!startup) await starting;
  return {get, starting, loaded, expectedVersions, reads:() => reads,prompts:() => prompts,
    notify(){action('open-external');},
    enqueue(name){queue.push({name,data:new Uint8Array([1])});action('open-external');},
    edit(){state={...state,dirty:true,changeSeq:state.changeSeq+1};},state:() => state};
}

test('renderer waits for startup and processes duplicate notifications once', async () => {
  const startup=deferred(), ui=await bootUI({startup}); ui.enqueue('start.hwpx');
  ui.notify(); ui.notify();
  assert.equal(ui.reads(),0); startup.resolve(); await ui.starting;
  await until(() => ui.loaded.length===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.loaded,['start.hwpx']); assert.equal(ui.state().dirty,false);
});

test('cancelled external open preserves the dirty document and does not retry that request', async () => {
  const ui=await bootUI(); await until(() => !ui.get('save').disabled);
  ui.edit(); const before={...ui.state()}; ui.enqueue('cancel.hwpx');
  await until(() => ui.prompts()===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.state(),before); assert.deepEqual(ui.loaded,[]); await tick(); assert.equal(ui.prompts(),1);
});

test('external open waits for pending save; then prompts once about unsaved later edits', async () => {
  const gate=deferred(), ui=await bootUI({save:() => gate.promise,choice:() => 'discard'});
  await until(() => !ui.get('save').disabled); ui.edit(); const pending=ui.get('save').onclick(); await tick();
  ui.enqueue('after-save.hwpx'); ui.edit(); assert.deepEqual(ui.loaded,[]);
  gate.resolve({name:'saved.hwpx',size:1}); await pending;
  await until(() => ui.loaded.length===1 && !ui.get('save').disabled);
  assert.equal(ui.prompts(),1); assert.deepEqual(ui.loaded,['after-save.hwpx']); assert.equal(ui.expectedVersions[0].changeSeq,2);
});

test('edit during native confirmation invalidates external discard approval', async () => {
  const gate=deferred(),ui=await bootUI({choice:() => gate.promise});
  await until(() => !ui.get('save').disabled); ui.edit(); ui.enqueue('stale.hwpx');
  await until(() => ui.prompts()===1); ui.edit(); gate.resolve('discard');
  await until(() => ui.get('error-dialog').open);
  assert.deepEqual(ui.loaded,[]); assert.equal(ui.state().dirty,true); assert.equal(ui.state().changeSeq,2);
  assert.match(ui.get('error-text').textContent,/변경/);
});

test('save-before-open cancellation preserves current document', async () => {
  const ui=await bootUI({choice:() => 'save'}); await until(() => !ui.get('save').disabled);
  ui.edit(); ui.enqueue('not-opened.hwpx'); await until(() => ui.prompts()===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.loaded,[]); assert.equal(ui.state().dirty,true); assert.match(ui.get('status').textContent,/취소/);
});

test('failed open pauses queued replacements until error dismissal', async () => {
  const ui=await bootUI(); await until(() => !ui.get('save').disabled);
  ui.enqueue('invalid.hwp'); ui.enqueue('next.hwpx'); await until(() => ui.get('error-dialog').open);
  assert.deepEqual(ui.loaded,[]); assert.equal(ui.state().fileName,'old.hwp'); await tick();
  ui.get('error-dialog').close(); await until(() => ui.loaded.length===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.loaded,['next.hwpx']);
});

test('help dialog pauses external opens until it closes', async () => {
  const ui=await bootUI(); await until(() => !ui.get('save').disabled);
  ui.get('about-dialog').showModal(); ui.enqueue('after-help.hwp'); await tick(); assert.deepEqual(ui.loaded,[]);
  ui.get('about-dialog').close(); await until(() => ui.loaded.length===1);
  assert.deepEqual(ui.loaded,['after-help.hwp']);
});

test('notification arriving during an empty IPC read is not lost', async () => {
  const gate=deferred(); let calls=0;
  const ui=await bootUI({take:async() => ++calls===1 ? gate.promise : calls===2 ? {name:'raced.hwp',data:new Uint8Array([1])} : null});
  ui.notify(); gate.resolve(null); await until(() => ui.loaded.length===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.loaded,['raced.hwp']); assert.equal(calls,3);
});

test('an empty queue does not add a busy IPC read after unrelated saves', async () => {
  const ui=await bootUI(); await until(() => !ui.get('save').disabled); const reads=ui.reads();
  ui.edit(); await ui.get('save').onclick(); assert.equal(ui.reads(),reads); assert.equal(ui.get('save').disabled,false);
});

test('read failure pauses until error dismissal, then consumes the next request', async () => {
  let calls=0;
  const ui=await bootUI({take:async() => {if(++calls===1)throw Error('ENOENT synthetic');return calls===2 ? {name:'after-read-error.hwp',data:new Uint8Array([1])} : null;}});
  await until(() => ui.get('error-dialog').open); assert.equal(calls,1);
  ui.get('error-dialog').close(); await until(() => ui.loaded.length===1 && !ui.get('save').disabled);
  assert.deepEqual(ui.loaded,['after-read-error.hwp']);
});

test('bounded reader rejects growth after stat and closes the opened handle', async () => {
  let closed=0,read=0;const module={exports:{}};
  vm.runInNewContext(sync.readFileSync(path.join(desktop,'external-open.cjs'),'utf8'),{
    module,Buffer,Uint8Array,require:name => name==='node:fs/promises' ? {open:async() => ({
      stat:async() => ({isFile:() => true,size:1}),
      read:async(buffer) => {read+=buffer.length;return {bytesRead:buffer.length};},close:async() => closed++,
    })} : name.startsWith('./') ? require(path.join(desktop,name)) : require(name),
  });
  await assert.rejects(module.exports.readDocumentFile('/synthetic/growing.hwp'),/64 MB/);
  assert.equal(read,MAX_BYTES+1); assert.equal(closed,1);
});

test('preload exposes a path-free dequeue call on the dedicated IPC channel', async () => {
  let exposed;const calls=[];
  vm.runInNewContext(sync.readFileSync(path.join(sourceRoot,'preload.cjs'),'utf8'),{
    require:() => ({contextBridge:{exposeInMainWorld:(_name,api) => exposed=api},
      ipcRenderer:{invoke:(...args) => calls.push(args)}}),
  });
  exposed.takeOpenFile('/not-authorized.hwp'); assert.deepEqual(calls,[['baram:take-open-file']]);
});
