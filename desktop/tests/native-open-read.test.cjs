const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const sync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {MAX_BYTES} = require('../storage.cjs');
const desktop = path.resolve(__dirname, '..');

// Execute the real native IPC handler with a selected synthetic filesystem path.
// Electron's window/dialog are stubbed; no app, GUI, or user profile is opened.
async function bootOpen({chosen, afterStat} = {}) {
  const metrics = {dialogs:0, bytesRead:0, closed:0};
  const io = {
    ...fs,
    async stat(target) {
      const stat = await fs.stat(target);
      await afterStat?.(target, stat);
      return stat;
    },
    async readFile(target) {
      const bytes = await fs.readFile(target);
      metrics.bytesRead += bytes.byteLength;
      return bytes;
    },
    async open(target, flags) {
      const handle = await fs.open(target, flags);
      return {
        async stat() {
          const stat = await handle.stat();
          await afterStat?.(target, stat);
          return stat;
        },
        async read(...args) {
          const result = await handle.read(...args);
          metrics.bytesRead += result.bytesRead;
          return result;
        },
        async close() {metrics.closed++; await handle.close();},
      };
    },
  };
  const reader = {exports:{}};
  vm.runInNewContext(sync.readFileSync(path.join(desktop, 'external-open.cjs'), 'utf8'), {
    module:reader, Buffer, Uint8Array,
    require:name => name === 'node:fs/promises' ? io :
      name.startsWith('./') ? require(path.join(desktop, name)) : require(name),
  });
  let win, shown;
  const started = new Promise(resolve => shown = resolve);
  const app = new EventEmitter(), handlers = new Map();
  Object.assign(app, {setPath(){}, getPath:() => os.tmpdir(), requestSingleInstanceLock:() => true,
    whenReady:async() => {}, quit(){}, getVersion:() => 'test', setAboutPanelOptions(){}});
  class Window extends EventEmitter {
    constructor() {
      super(); win = this; this.webContents = new EventEmitter();
      Object.assign(this.webContents, {mainFrame:{url:'http://127.0.0.1:12345/'}, send(){}, setWindowOpenHandler(){}});
    }
    isDestroyed(){return false;} async loadURL(){} show(){shown();} setDocumentEdited(){}
  }
  const electron = {app, BrowserWindow:Window, Menu:{buildFromTemplate:x => x, setApplicationMenu(){}},
    dialog:{showErrorBox:(_title, message) => {throw Error(message);},
      showOpenDialog:async() => {metrics.dialogs++; return chosen;}},
    ipcMain:{handle:(name, handler) => handlers.set(name, handler), on(){}},
    session:{defaultSession:{webRequest:{onBeforeRequest(){}}, setPermissionRequestHandler(){}, setPermissionCheckHandler(){}, on(){}}}};
  vm.runInNewContext(sync.readFileSync(path.join(desktop, 'main.cjs'), 'utf8'), {
    __dirname:desktop, process:{platform:'darwin'}, Buffer, Uint8Array,
    require:name => name === 'electron' ? electron : name === 'node:fs/promises' ? io :
      name === './external-open.cjs' ? reader.exports : name === './profile-server.cjs' ?
        {startProfileServer:async() => ({origin:'http://127.0.0.1:12345', server:{close(){}}})} :
        name.startsWith('./') ? require(path.join(desktop, name)) : require(name),
  });
  await started;
  const event = {sender:win.webContents, senderFrame:win.webContents.mainFrame};
  return {metrics, event, open:(e = event) => handlers.get('baram:open')(e)};
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geulgyeol-native-open-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  return directory;
}
const selected = target => ({canceled:false, filePaths:[target]});

for (const format of ['hwp', 'hwpx']) {
  test(`native picker returns selected .${format} bytes and basename without modifying input`, async t => {
    const directory = await fixture(t), target = path.join(directory, `합성.${format}`);
    const bytes = Buffer.alloc(65537, 71);
    await fs.writeFile(target, bytes);
    const host = await bootOpen({chosen:selected(target)});
    const file = await host.open();
    assert.equal(file.name, `합성.${format}`);
    assert.deepEqual(Buffer.from(file.data), bytes);
    assert.deepEqual(await fs.readFile(target), bytes);
    assert.equal(host.metrics.bytesRead, bytes.length);
  });
}

test('native picker cancellation returns no document and performs no read', async () => {
  const host = await bootOpen({chosen:{canceled:true}});
  assert.equal(await host.open(), null);
  assert.equal(host.metrics.bytesRead, 0);
});

test('untrusted native open requests cannot show a picker or read a file', async () => {
  const host = await bootOpen();
  await assert.rejects(host.open({...host.event, sender:{}}), /허용되지/);
  await assert.rejects(host.open({...host.event, senderFrame:{}}), /허용되지/);
  assert.equal(host.metrics.dialogs, 0);
  assert.equal(host.metrics.bytesRead, 0);
});

test('native picker rejects a directory before reading it', async t => {
  const directory = await fixture(t), host = await bootOpen({chosen:selected(directory)});
  await assert.rejects(host.open(), /일반 문서/);
  assert.equal(host.metrics.bytesRead, 0);
  assert.equal(host.metrics.closed, 1);
});

test('native picker rejects an oversized file before reading bytes', async t => {
  const directory = await fixture(t), target = path.join(directory, 'oversized.hwp');
  const handle = await fs.open(target, 'wx');
  await handle.truncate(MAX_BYTES + 1); await handle.close();
  const host = await bootOpen({chosen:selected(target)});
  await assert.rejects(host.open(), /64 MB/);
  assert.equal(host.metrics.bytesRead, 0);
});

test('native picker bounds actual reads when a selected file grows after stat', async t => {
  const directory = await fixture(t), target = path.join(directory, 'growing.hwpx');
  await fs.writeFile(target, 'synthetic');
  const host = await bootOpen({chosen:selected(target), afterStat:async file => {
    const handle = await fs.open(file, 'r+');
    await handle.truncate(MAX_BYTES + 65536); await handle.close();
  }});
  const outcome = await host.open().then(file => ({file}), error => ({error}));
  assert.match(outcome.error?.message || `native IPC returned ${outcome.file.data.byteLength} bytes`, /64 MB/);
  assert(host.metrics.bytesRead <= MAX_BYTES + 1);
  assert.equal(host.metrics.closed, 1);
  assert.equal((await fs.stat(target)).size, MAX_BYTES + 65536);
});

test('native picker read error permits a later retry after the file is created', async t => {
  const directory = await fixture(t), target = path.join(directory, 'retry.hwp');
  const host = await bootOpen({chosen:selected(target)});
  await assert.rejects(host.open(), {code:'ENOENT'});
  await fs.writeFile(target, 'synthetic retry');
  assert.equal(Buffer.from((await host.open()).data).toString(), 'synthetic retry');
  assert.equal(host.metrics.dialogs, 2);
});
