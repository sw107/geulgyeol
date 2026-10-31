import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {DocumentDirtyState} from '../src/core/document-dirty-state.ts';

const root = new URL('../src/', import.meta.url);
const modules = Object.fromEntries(await Promise.all([
  'command/file-system-access', 'command/save-target', 'command/save-format',
  'command/save-document-format', 'core/export-content-loss', 'core/hml-save-capability',
].map(async name => ['@/' + name, await import(new URL(name + '.ts', root))])));
// Execute the complete production save module and real persistence helpers.
// Only the UI, browser and byte exporter are synthetic in-memory adapters.
const source = stripTypeScriptTypes(fs.readFileSync(new URL('command/commands/file.ts', root), 'utf8'),
  {mode: 'transform'})
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, name) => `const {${names}} = dependencies[${JSON.stringify(name)}] || {};`)
  .replace(/\bexport /g, '');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
};

function fixture({format = 'hwpx', noPicker = false, pauseDialog = false, password = false} = {}) {
  const closing = deferred(), closeGate = deferred(), dialogOpened = deferred(), dialogGate = deferred();
  let pauseClose = true, content = 'snapshot A', written, exports = 0, saveAsPrompts = 0;
  const calls = {alerts: [], recent: [], downloads: [], dirtyEvents: []};
  const state = new DocumentDirtyState({emit: (name, detail) => calls.dirtyEvents.push({name, ...detail})});
  state.markDirty('initial edit');
  const makeHandle = name => ({name, async createWritable() {
    let pending;
    return {async write(blob) {pending = await blob.text();}, async close() {
      if (pauseClose) {closing.resolve(); await closeGate.promise;}
      written = pending;
    }};
  }});
  const original = makeHandle('original.' + format), selected = makeHandle('copy.' + format);
  const artifact = () => {exports++; return {bytes: new TextEncoder().encode(content), contentLoss: {
    schemaVersion: 1, outputFormat: format, count: 0, losses: [],
  }};};
  const services = {
    wasm: {fileName: original.name, currentFileHandle: noPicker ? null : original,
      documentGeneration: 1, isNewDocument: noPicker, requiresPasswordForSave: password,
      getSourceFormat: () => format, exportHwpWithReport: artifact, exportHwpxWithReport: artifact,
      getHmlOpenMetadata: () => ({hmlSavable: false, saveBlockers: []}), hasHmlExportCapability: () => false,
      exportHwpWithPasswordAndReport: artifact, exportHwpxWithPasswordAndReport: artifact},
    documentState: state, getInputHandler: () => null,
    getContext: () => ({hasDocument: true, isDirty: state.isDirty()}), refreshDocumentStatus() {},
  };
  const dependencies = {...modules,
    '@/ui/save-as-dialog': {showSaveAs: async () => {
      saveAsPrompts++;
      if (pauseDialog === true || (pauseDialog === 'second-save-as' && saveAsPrompts === 2)) {
        dialogOpened.resolve(); await dialogGate.promise;
      }
      return {fileName: selected.name, configurePassword: false};
    }},
    '@/ui/hwp-password-dialog': {showHwpSavePasswordDialog: async () => {
      if (pauseDialog) {dialogOpened.resolve(); await dialogGate.promise;}
      return 'synthetic password';
    }},
    '@/ui/unsaved-changes-dialog': {showUnsavedChangesDialog: async () => 'save'},
    '@/ui/hml-save-format-dialog': {showHmlSaveFormatDialog: async () => {
      dialogOpened.resolve(); await dialogGate.promise; return 'hwpx';
    }},
    '@/recent/recent-store': {addRecentDoc: async entry => {calls.recent.push(entry);}},
    '@/ui/toast': {showToast() {}},
  };
  const context = {dependencies, Blob, DOMException, Error,
    window: noPicker ? {} : {showSaveFilePicker: async () => selected},
    alert: message => calls.alerts.push(message), console: {warn() {}, error() {}}, setTimeout() {},
    URL: {createObjectURL: blob => {calls.downloads.push(blob); return 'blob:synthetic';}, revokeObjectURL() {}},
    document: {createElement: () => ({click() {}})},
  };
  vm.runInNewContext(source + '\nthis.api = {saveCurrentDocument, confirmSaveBeforeReplacingDocument, fileCommands};', context);
  return {services, state, calls, original, selected,
    save: () => context.api.saveCurrentDocument(services),
    saveAs: () => context.api.fileCommands.find(c => c.id === 'file:save-as').execute(services),
    replace: () => context.api.confirmSaveBeforeReplacingDocument(services),
    closing: closing.promise, dialogOpened: dialogOpened.promise,
    releaseWrite() {pauseClose = false; closeGate.resolve();}, releaseDialog: dialogGate.resolve,
    written: () => written, exports: () => exports, saveAsPrompts: () => saveAsPrompts,
    edit() {content = 'snapshot A + later 한글😀'; state.markDirty('later edit');},
    replaceDocument({dirty = true} = {}) {
      services.wasm.documentGeneration++;
      services.wasm.fileName = 'replacement.' + format;
      services.wasm.currentFileHandle = makeHandle(services.wasm.fileName);
      services.wasm.requiresPasswordForSave = true;
      content = 'replacement content';
      state.markClean('document-initialized');
      if (dirty) state.markDirty('new document edit');
    },
  };
}

for (const format of ['hwp', 'hwpx']) {
  for (const action of ['save', 'saveAs']) {
    test(`${format} ${action}: completing an older document's write preserves the replacement`, async () => {
      const f = fixture({format});
      const saving = f[action]();
      await f.closing;
      f.replaceDocument();
      const handle = f.services.wasm.currentFileHandle;
      f.releaseWrite();
      const result = await saving;
      assert.equal(f.written(), 'snapshot A');
      assert.equal(f.services.wasm.fileName, 'replacement.' + format);
      assert.equal(f.services.wasm.currentFileHandle, handle);
      assert.equal(f.services.wasm.requiresPasswordForSave, true);
      assert.equal(f.state.isDirty(), true);
      assert.deepEqual(f.calls.recent, []);
      if (action === 'save') assert.equal(result, 'changed');
    });
  }
}

test('save before document replacement refuses to discard edits made during the write', async () => {
  const f = fixture();
  const replacing = f.replace();
  await f.closing;
  f.edit();
  f.releaseWrite();
  assert.equal(await replacing, false);
  assert.equal(f.state.isDirty(), true);
  assert.equal(f.written(), 'snapshot A');
});

test('a clean replacement is protected even when its edit revision equals the saved revision', async () => {
  const f = fixture();
  const saving = f.save();
  await f.closing;
  f.replaceDocument({dirty: false});
  f.releaseWrite();
  assert.equal(await saving, 'changed');
  assert.equal(f.state.isDirty(), false);
  assert.equal(f.services.wasm.fileName, 'replacement.hwpx');
  assert.equal(f.services.wasm.requiresPasswordForSave, true);
});

for (const action of ['save', 'saveAs']) {
  test(`${action}: an unchanged document is marked clean after its write`, async () => {
    const f = fixture();
    const saving = f[action]();
    await f.closing;
    f.releaseWrite();
    const result = await saving;
    if (action === 'save') assert.equal(result, 'saved');
    assert.equal(f.state.isDirty(), false);
    assert.equal(f.written(), 'snapshot A');
    assert.equal(f.calls.recent.length, 1);
  });
}

for (const action of ['save', 'saveAs']) {
  test(`${action}: replacing the document during HML format choice aborts before any export or save options`, async () => {
    const f = fixture({format: 'hml'});
    const saving = f[action]();
    await f.dialogOpened;
    f.replaceDocument(); f.releaseDialog();
    const result = await saving;
    if (action === 'save') assert.equal(result, 'changed');
    assert.equal(f.exports(), 0);
    assert.equal(f.saveAsPrompts(), 0);
    assert.equal(f.services.wasm.fileName, 'replacement.hml');
    assert.equal(f.state.isDirty(), true);
    assert.deepEqual(f.calls.alerts, []);
  });
}

test('dirty revisions advance for repeated edits without duplicate dirty transition events', () => {
  const f = fixture(), first = f.state.revision;
  f.edit(); f.edit();
  assert.equal(f.state.revision, first + 2);
  assert.equal(f.calls.dirtyEvents.length, 1);
  f.state.markClean('saved');
  assert.equal(f.state.revision, first + 2);
  f.edit();
  assert.equal(f.state.revision, first + 3);
  assert.deepEqual(f.calls.dirtyEvents.map(e => e.dirty), [true, false, true]);
});

for (const action of ['save', 'saveAs']) {
  test(`${action}: editing during the download name prompt retains dirty`, async () => {
    const f = fixture({noPicker: true, pauseDialog: action === 'saveAs' ? 'second-save-as' : true});
    const saving = f[action]();
    await f.dialogOpened;
    f.edit(); f.releaseDialog();
    const result = await saving;
    if (action === 'save') assert.equal(result, 'changed');
    assert.equal(f.state.isDirty(), true);
    assert.equal(f.calls.downloads.length, 1);
    assert.equal(await f.calls.downloads[0].text(), 'snapshot A');
  });
  test(`${action}: replacing the document during download naming does not download or rename it`, async () => {
    const f = fixture({noPicker: true, pauseDialog: action === 'saveAs' ? 'second-save-as' : true});
    const saving = f[action]();
    await f.dialogOpened;
    f.replaceDocument();
    const handle = f.services.wasm.currentFileHandle;
    f.releaseDialog();
    const result = await saving;
    if (action === 'save') assert.equal(result, 'changed');
    assert.equal(f.services.wasm.fileName, 'replacement.hwpx');
    assert.equal(f.services.wasm.currentFileHandle, handle);
    assert.equal(f.services.wasm.requiresPasswordForSave, true);
    assert.equal(f.state.isDirty(), true);
    assert.equal(f.calls.downloads.length, 0);
  });
}

for (const action of ['save', 'saveAs']) {
  test(`${action}: replacing the document during the first options/password prompt aborts before export`, async () => {
    const f = fixture({pauseDialog: true, password: action === 'save'});
    const saving = f[action]();
    await f.dialogOpened;
    f.replaceDocument(); f.releaseDialog();
    const result = await saving;
    if (action === 'save') assert.equal(result, 'changed');
    assert.equal(f.exports(), 0);
    assert.equal(f.written(), undefined);
    assert.equal(f.state.isDirty(), true);
    assert.equal(f.services.wasm.fileName, 'replacement.hwpx');
    assert.equal(f.services.wasm.requiresPasswordForSave, true);
    assert.deepEqual(f.calls.alerts, []);
  });
}

for (const format of ['hwp', 'hwpx']) {
  for (const action of ['save', 'saveAs']) {
    test(`${format} ${action}: edits during write remain dirty and retry saves the later content`, async () => {
      const f = fixture({format});
      const saving = f[action]();
      await f.closing;
      f.edit();
      f.releaseWrite();
      const result = await saving;
      assert.equal(f.written(), 'snapshot A', 'the completed write contains the exported snapshot only');
      assert.equal(f.state.isDirty(), true, 'later edits have not been written');
      if (action === 'save') assert.equal(result, 'changed');
      assert.equal(f.services.wasm.currentFileHandle, action === 'save' ? f.original : f.selected);
      assert.deepEqual(f.calls.alerts, []);
      assert.equal(await f.save(), 'saved');
      assert.equal(f.written(), 'snapshot A + later 한글😀');
      assert.equal(f.state.isDirty(), false);
    });
  }
}
