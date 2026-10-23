const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const {stripTypeScriptTypes} = require('node:module');

const root = path.resolve(__dirname, '../../rhwp-studio/src');
const modulePaths = [
  'command/file-system-access', 'command/save-target', 'command/save-format',
  'command/save-document-format', 'core/export-content-loss',
];
const productionModules = Promise.all(modulePaths.map(async name => [
  '@/' + name, await import(pathToFileURL(path.join(root, name + '.ts')).href),
]));
// Run the complete production command module, using the real persistence/format
// helpers. Only dialogs, DOM, and the engine exporter are adapters; no WASM/app.
const commandSource = stripTypeScriptTypes(
  fs.readFileSync(path.join(root, 'command/commands/file.ts'), 'utf8'), {mode: 'transform'},
).replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
  (_, names, name) => `const {${names}} = dependencies[${JSON.stringify(name)}] || {};`)
  .replace(/\bexport /g, '');

async function fixture({format = 'hwpx', phase, errorName, noPicker = false} = {}) {
  const calls = {downloads: 0, alerts: [], clean: [], recent: [], prompts: 0, notices: [], writes: 0};
  let dirty = true, backing = 'original', fault = phase;
  const fail = stage => {
    if (fault === stage) throw errorName
      ? new DOMException('synthetic-' + stage, errorName)
      : new Error('synthetic-' + stage + '-EIO');
  };
  const makeHandle = name => ({name, async createWritable() {
    fail('create');
    let pending;
    return {async write(blob) {calls.writes++; fail('write'); pending = await blob.text();},
      async close() {fail('close'); backing = pending;}};
  }});
  const original = makeHandle('original.' + format), selected = makeHandle('copy.' + format);
  const artifact = () => ({bytes: new TextEncoder().encode('edited'), contentLoss: {
    schemaVersion: 1, outputFormat: format, count: 0, losses: [],
  }});
  const services = {
    wasm: {fileName: original.name, currentFileHandle: original, isNewDocument: false,
      requiresPasswordForSave: false, getSourceFormat: () => format,
      exportHwpWithReport: artifact, exportHwpxWithReport: artifact},
    getInputHandler: () => null,
    getContext: () => ({hasDocument: true, isDirty: dirty}),
    refreshDocumentStatus() {},
    documentState: {markClean(reason) {calls.clean.push(reason); dirty = false;}},
  };
  const dependencies = Object.fromEntries(await productionModules);
  dependencies['@/ui/save-as-dialog'] = {showSaveAs: async () => {
    calls.prompts++; return {fileName: selected.name, configurePassword: false};
  }};
  dependencies['@/ui/unsaved-changes-dialog'] = {showUnsavedChangesDialog: async () => 'save'};
  dependencies['@/recent/recent-store'] = {addRecentDoc: async entry => {calls.recent.push(entry);}};
  dependencies['@/ui/toast'] = {showToast: notice => calls.notices.push(notice)};
  const window = noPicker ? {} : {showSaveFilePicker: async () => {fail('picker'); return selected;}};
  const context = {
    dependencies, window, Blob, DOMException, Error,
    alert: message => calls.alerts.push(message),
    console: {warn() {}, error() {}}, setTimeout() {},
    URL: {createObjectURL: () => 'blob:synthetic', revokeObjectURL() {}},
    document: {createElement: () => ({click() {calls.downloads++;}})},
  };
  vm.runInNewContext(commandSource + '\nthis.commands = {saveCurrentDocument, confirmSaveBeforeReplacingDocument, fileCommands};', context);
  return {services, original, selected, calls, dirty: () => dirty, backing: () => backing,
    retry: () => {fault = undefined;},
    save: () => context.commands.saveCurrentDocument(services),
    saveAs: () => context.commands.fileCommands.find(c => c.id === 'file:save-as').execute(services),
    replace: () => context.commands.confirmSaveBeforeReplacingDocument(services)};
}

function assertUncommitted(f) {
  assert.equal(f.dirty(), true);
  assert.equal(f.services.wasm.fileName, f.original.name);
  assert.equal(f.services.wasm.currentFileHandle, f.original);
  assert.equal(f.services.wasm.requiresPasswordForSave, false);
  assert.equal(f.backing(), 'original');
  assert.deepEqual(f.calls.clean, []);
  assert.deepEqual(f.calls.recent, []);
  assert.deepEqual(f.calls.notices, []);
  assert.equal(f.calls.downloads, 0);
}

for (const format of ['hwp', 'hwpx']) {
  for (const action of ['save', 'saveAs']) {
    for (const phase of ['create', 'write', 'close']) {
      test(`${format} ${action}: ${phase} failure retains state, reports error, and permits retry`, async () => {
        const f = await fixture({format, phase});
        const result = await f[action]();
        if (action === 'save') assert.equal(result, 'failed');
        assertUncommitted(f);
        assert.equal(f.calls.alerts.length, 1);
        assert.match(f.calls.alerts[0], new RegExp('synthetic-' + phase + '-EIO'));
        assert.equal(f.calls.prompts, action === 'save' ? 0 : 1);
        f.retry();
        const retry = await f[action]();
        if (action === 'save') assert.equal(retry, 'saved');
        assert.equal(f.dirty(), false);
        assert.equal(f.backing(), 'edited');
        assert.equal(f.calls.clean.length, 1);
        assert.equal(f.services.wasm.currentFileHandle, action === 'save' ? f.original : f.selected);
        assert.equal(f.calls.downloads, 0);
      });
    }
  }
}

test('Save before replacing refuses to replace after a failed write', async () => {
  const f = await fixture({phase: 'close'});
  assert.equal(await f.replace(), false);
  assertUncommitted(f);
  assert.match(f.calls.alerts[0], /synthetic-close-EIO/);
});

test('Save As picker errors report failure without a second fallback prompt', async () => {
  const f = await fixture({phase: 'picker'});
  await f.saveAs();
  assertUncommitted(f);
  assert.equal(f.calls.prompts, 1);
  assert.match(f.calls.alerts[0], /synthetic-picker-EIO/);
});

for (const errorName of ['AbortError', 'NotAllowedError']) {
  test(`${errorName} cancellation remains silent and retains the current document`, async () => {
    const f = await fixture({phase: 'picker', errorName});
    await f.saveAs();
    assertUncommitted(f);
    assert.deepEqual(f.calls.alerts, []);
    assert.equal(f.calls.prompts, 1);
  });
}

test('a new-document picker cancellation returns cancelled without marking clean', async () => {
  const f = await fixture({phase: 'picker', errorName: 'AbortError'});
  f.services.wasm.currentFileHandle = null;
  assert.equal(await f.save(), 'cancelled');
  assert.equal(f.dirty(), true);
  assert.deepEqual(f.calls.clean, []);
  assert.deepEqual(f.calls.alerts, []);
  assert.equal(f.calls.downloads, 0);
});

test('a browser without File System Access still uses its existing download fallback', async () => {
  const f = await fixture({noPicker: true});
  f.services.wasm.currentFileHandle = null;
  assert.equal(await f.save(), 'saved');
  assert.equal(f.calls.downloads, 1);
  assert.deepEqual(f.calls.alerts, []);
});
