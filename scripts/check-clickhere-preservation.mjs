// Existing WASM + actual field dialogs/commands/InputHandler methods/CommandHistory.
// DOM, cursor geometry, paint and platform events are adapters; real GUI/IME are unverified.
// A known engine reference-loss case is asserted and reported separately from passing cases.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, out, commandSource] = process.argv.slice(2);
const expectPreserved = process.env.CLICKHERE_EXPECT_PRESERVED === '1';
assert(engine && out);
fs.mkdirSync(out, {
    recursive: true
});
const sha = (b)=>crypto.createHash('sha256').update(b).digest('hex');
const read = (f)=>fs.readFileSync(f, 'utf8');
const load = async (s)=>import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, {
        mode: 'transform'
    }).replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
const method = (s, n)=>{
    let a = -1;
    for (const p of [
        '  ',
        '  private '
    ]){
        a = s.indexOf(p + n + '(');
        if (a >= 0) break;
    }
    assert(a >= 0, n);
    const b = s.indexOf('\n  }\n', a);
    assert(b > a, n);
    return s.slice(a, b + 4) + '\n';
};
const source = {
    command: read(commandSource ?? 'rhwp-studio/src/engine/command.ts'),
    history: read('rhwp-studio/src/engine/history.ts'),
    bridge: read('rhwp-studio/src/core/wasm-bridge.ts'),
    input: read('rhwp-studio/src/engine/input-handler.ts'),
    text: read('rhwp-studio/src/engine/input-handler-text.ts'),
    insert: read('rhwp-studio/src/command/commands/insert.ts'),
    edit: read('rhwp-studio/src/command/commands/edit.ts'),
    insertDialog: read('rhwp-studio/src/ui/field-insert-dialog.ts'),
    editDialog: read('rhwp-studio/src/ui/field-edit-dialog.ts')
};
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + source.command);
globalThis.__clickCommands = commands;
const { CommandHistory } = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__clickCommands;\n' + source.history);
const localResult = read('rhwp-studio/src/core/local-text-replace-result.ts');
let bs = localResult + '\n' + source.bridge.slice(source.bridge.indexOf('function parseDeferredFocusedCellCursorGeometry('), source.bridge.indexOf('export type DeferredPaginationStatus')) + '\nexport class BridgeProbe{doc;constructor(d){this.doc=d;}\n';
for (const n of [
    'getTextRange',
    'getParagraphLength',
    'getParagraphCount',
    'insertText',
    'replaceBodyTextLocal',
    'deleteText',
    'getCharPropertiesAt',
    'applyCharFormat',
    'getParaPropertiesAt',
    'applyParaFormat',
    'saveSnapshot',
    'restoreSnapshot',
    'discardSnapshot',
    'getFieldList',
    'getFieldInfoAt',
    'getFieldValue',
    'setFieldValue',
    'getClickHereProps',
    'updateClickHereProps',
    'insertClickHereField',
    'removeFieldAt',
    'setActiveField',
    'clearActiveField',
    'copySelection',
    'pasteInternal',
    'getCursorRect',
    'insertTextInCell',
    'insertTextInCellDeferredPagination',
    'insertTextInCellByPath',
    'deleteTextInCell',
    'deleteTextInCellByPath',
    'applyCharFormatInCell',
    'applyCharFormatInCellByPath'
])bs += method(source.bridge, n);
const { BridgeProbe } = await load(bs + '}');
class ElementAdapter {
    constructor(tag){
        this.tagName = tag;
        this.style = {};
        this.children = [];
        this.value = '';
        this.className = '';
    }
    appendChild(e) {
        this.children.push(e);
        return e;
    }
    focus() {}
    select() {}
    querySelector() {
        return null;
    }
}
globalThis.document = {
    createElement: (tag)=>new ElementAdapter(tag),
    createTextNode: (text)=>({
            textContent: text
        })
};
globalThis.requestAnimationFrame = (fn)=>{
    fn();
    return 1;
};
const modal = 'class ModalDialog{constructor(){this.dialog={querySelector:()=>null};}show(){globalThis.__clickDialog=this;this.createBody();}hide(){}}\n';
const dialogs = await load(modal + source.editDialog + '\n' + source.insertDialog);
globalThis.__clickDialogs = dialogs;
const { insertCommands } = await load('const {FieldInsertDialog}=globalThis.__clickDialogs;\n' + source.insert);
const { editCommands } = await load(read('rhwp-studio/src/command/format-paste-availability.ts') + '\nconst {FieldEditDialog}=globalThis.__clickDialogs;\n' + source.edit);
let hs = 'const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS}=globalThis.__clickCommands;\nexport class HandlerProbe{\n';
for (const n of [
    'getCursorPosition',
    'executeOperation',
    'getFieldInfo',
    'removeCurrentField',
    'prepareClickHereInputPosition',
    'isClickHereGuidePosition',
    'refreshClickHereAfterFirstInput',
    'updateFieldMarkers',
    'getClickHereBoundaryRects',
    'fieldBoundaryKey',
    'markCurrentFieldStartOutside',
    'markCurrentFieldEndOutside',
    'isAtExitedFieldStart',
    'isAtExitedFieldEnd',
    'isExitedFieldStartPosition',
    'isOperationAllowedInEditMode',
    'isSameTextContainer',
    'getFormFieldInfoAt',
    'isEditableFormFieldPosition',
    'canEditCurrentFormField',
    'canInsertTextInFormMode',
    'canDeleteTextInFormMode',
    'canDeleteSelectionInFormMode',
    'moveToAdjacentFormField',
    'formFieldPosition',
    'formFieldSortKey',
    'compareFormFieldKeys',
    'handleUndo',
    'handleRedo',
    'restoreEditContextAfterHistory',
    'resetDerivedStateAfterHistoryJump',
    'restoreSelectionAfterUndo',
    'restoreSelectionAfterRedo'
])hs += method(source.input, n);
const { HandlerProbe } = await load(hs + '}');
const from = source.text.indexOf('export function onInput('), to = source.text.indexOf('\nexport function insertTextAtRaw', from);
assert(from >= 0 && to > from);
const { onInput } = await load('const {InsertTextCommand}=globalThis.__clickCommands;\n' + source.text.slice(from, to));
const bytes = fs.readFileSync(path.join(engine, 'rhwp_bg.wasm'));
const { initSync, HwpDocument } = await import(pathToFileURL(path.resolve(engine, 'rhwp.js')));
initSync({
    module: bytes
});
const parsed = (s)=>JSON.parse(s), count = (s)=>[
        ...s
    ].length;
let reopens = 0, undos = 0, redos = 0, rejections = 0;
const rows = [];
let knownFailure, formatFailure, fixtureNormalization;
const cellRegressions = [];
const model = (d)=>{
    const fields = parsed(d.getFieldList());
    assert.equal(new Set(fields.map((f)=>f.fieldId)).size, fields.length, 'unique IDs');
    for (const f of fields){
        assert(f.startCharIdx <= f.endCharIdx);
        assert.equal(d.getTextRange(0, f.location.paraIndex, f.startCharIdx, f.endCharIdx - f.startCharIdx), f.value, 'anchor/value');
    }
    return {
        paragraphs: Array.from({
            length: d.getParagraphCount(0)
        }, (_, p)=>{
            const text = d.getTextRange(0, p, 0, 100000);
            return {
                text,
                para: parsed(d.getParaPropertiesAt(0, p)),
                chars: [
                    ...text
                ].map((_, i)=>parsed(d.getCharPropertiesAt(0, p, i)))
            };
        }),
        fields: fields.map((f)=>({
                ...f,
                props: parsed(d.getClickHereProps(f.fieldId))
            })),
        controls: parsed(d.getControls())
    };
};
const noteContents = d=>parsed(d.getControls()).filter(c=>c.list===0 && (c.ctrlId==='fn' || c.ctrlId==='en')).map(c=>({para:c.para,kind:c.ctrlId,info:parsed(d.getFootnoteInfo(0,c.para,c.controlIndex))}));
const checkReopen = (d, label)=>{
    const before = model(d), notes = noteContents(d);
    for (const format of [
        'Hwp',
        'Hwpx'
    ]){
        const e = d['export' + format + 'WithReport']();
        try {
            assert.equal(parsed(e.contentLoss()).count, 0);
            const b = e.takeBytes();
            fs.writeFileSync(path.join(out, label + '.' + format.toLowerCase()), b);
            const r = new HwpDocument(b);
            try {
                assert.deepEqual(model(r), before, label + ' ' + format + ' reopen');
                assert.deepEqual(noteContents(r), notes, label + ' note number/body');
                reopens++;
            } finally{
                r.free();
            }
        } finally{
            e.free();
        }
    }
};
const make = ()=>{
    let d = HwpDocument.createEmpty();
    d.createBlankDocument();
    d.insertText(0, 0, 0, '앞뒤');
    d.splitParagraph(0, 0, 2);
    d.insertText(0, 1, 0, '이동대상끝');
    d.splitParagraph(0, 1, 6);
    d.insertText(0, 2, 0, '참조문단끝');
    d.applyCharFormat(0, 0, 0, 1, JSON.stringify({
        italic: true,
        textColor: '#123456'
    }));
    d.applyCharFormat(0, 1, 0, 6, JSON.stringify({
        underline: true
    }));
    d.applyParaFormat(0, 1, JSON.stringify({
        alignment: 'right'
    }));
    d.applyStyle(0, 2, 1);
    d.applyCharFormat(0, 2, 0, 6, JSON.stringify({
        bold: true
    }));
    assert.equal(parsed(d.insertFootnote(0, 2, 2)).ok, true);
    const initial = model(d), seed = d.exportHwpx();
    d.free();
    d = new HwpDocument(seed);
    if (!fixtureNormalization) {
        const normalized = model(d), differences = [];
        const diff = (a, b, key)=>{
            if (JSON.stringify(a) === JSON.stringify(b)) return;
            if (a && b && typeof a === 'object' && typeof b === 'object') {
                assert.deepEqual(Object.keys(a), Object.keys(b));
                for (const k of Object.keys(a))diff(a[k], b[k], key + '.' + k);
            } else differences.push({
                key,
                before: a,
                after: b
            });
        };
        diff(initial, normalized, 'model');
        assert(differences.length > 0);
        assert(differences.every((x)=>/\.(fillType|patternColor|patternType)$/.test(x.key)));
        fixtureNormalization = {
            fieldCount: initial.fields.length,
            differences,
            reason: 'Field-free default blank BorderFill metadata differs on HWPX roundtrip; normalize once before field comparisons'
        };
    }
    const wasm = new BridgeProbe(d), history = new CommandHistory(), ih = new HandlerProbe();
    let pos = {
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1
    };
    const cursor = {
        getPosition: ()=>({
                ...pos
            }),
        moveTo: (p)=>{
            pos = {
                ...p
            };
        },
        getRect: ()=>null,
        resetPreferredX () {},
        clearSelection () {},
        hasSelection: ()=>false,
        getSelectionOrdered: ()=>null,
        isInHeaderFooter: ()=>false,
        isInFootnote: ()=>false,
        isInPictureObjectSelection: ()=>false,
        isInTableObjectSelection: ()=>false,
        exitBlockSelectionMode () {},
        exitCellSelectionMode () {},
        updateRect () {}
    };
    const marker = {
        isVisible: false,
        hide () {
            this.isVisible = false;
        },
        show () {
            this.isVisible = true;
        }
    };
    Object.assign(ih, {
        wasm,
        history,
        cursor,
        editMode: 'edit',
        active: true,
        isComposing: false,
        _isIOS: false,
        textarea: {
            value: ''
        },
        fieldMarker: marker,
        viewportManager: {
            getZoom: ()=>1
        },
        eventBus: {
            emit () {}
        },
        caretLayoutReveal: {
            requestFor () {}
        },
        prepareTextMutationBeforeCursor: ()=>false,
        advancePendingCharShapeAnchor () {},
        refreshAfterOperation () {
            this.updateCaret();
        },
        updateCaret () {
            this.updateFieldMarkers();
        },
        afterEdit () {
            this.updateCaret();
        },
        focus () {},
        focusTextarea () {},
        clearPendingFootnoteCharShape () {},
        flushDeferredPaginationIfNeeded () {},
        clearTableResizeRuntimeCache () {},
        getPendingCharShape: ()=>({
                bold: true
            })
    });
    const services = {
        getInputHandler: ()=>ih,
        wasm,
        eventBus: ih.eventBus
    };
    const insert = (props)=>{
        insertCommands.find((c)=>c.id === 'insert:field').execute(services);
        const dialog = globalThis.__clickDialog;
        fill(dialog, props);
        dialog.onConfirm();
        return wasm.getFieldList().at(-1).fieldId;
    };
    const edit = (id, props)=>{
        const f = wasm.getFieldList().find((f)=>f.fieldId === id);
        cursor.moveTo({
            sectionIndex: 0,
            paragraphIndex: f.location.paraIndex,
            charOffset: f.startCharIdx
        });
        editCommands.find((c)=>c.id === 'field:edit').execute(services);
        fill(globalThis.__clickDialog, props);
        globalThis.__clickDialog.onConfirm();
    };
    const input = (text)=>{
        ih.textarea.value = text;
        onInput.call(ih);
    };
    return {
        d,
        wasm,
        history,
        ih,
        cursor,
        insert,
        edit,
        input,
        close () {
            history.clear(wasm);
            d.free();
        }
    };
};
function fill(dialog, props) {
    for (const key of [
        'guide',
        'memo',
        'name'
    ])dialog[key + 'Input'].value = props[key];
    dialog.editableCheckbox.checked = props.editable;
}
function roundtrip(s, before, label) {
    const after = model(s.d), afterCursor = s.cursor.getPosition();
    s.ih.handleUndo();
    assert.deepEqual(model(s.d), before, label + ' undo');
    undos++;
    s.ih.handleRedo();
    assert.deepEqual(model(s.d), after, label + ' redo');
    assert.deepEqual(s.cursor.getPosition(), afterCursor, label + ' redo cursor');
    redos++;
    checkReopen(s.d, label);
    rows.push({
        label,
        fields: after.fields,
        paragraphs: after.paragraphs.map((p)=>({
                text: p.text,
                para: p.para,
                chars: p.chars
            }))
    });
}
const s = make();
try {
    checkReopen(s.d, '00-field-free-baseline');
    const sentinel = model(s.d).paragraphs[2], reference = model(s.d).controls;
    for (const c of [
        insertCommands.find((c)=>c.id === 'insert:field'),
        ...editCommands.filter((c)=>c.id.startsWith('field:'))
    ]){
        assert.equal(c.canExecute({
            hasDocument: true,
            isFormMode: true,
            inField: true
        }), false);
        rejections++;
    }
    let before = model(s.d);
    const id = s.insert({
        guide: '입력🙂',
        memo: '메모"\n끝',
        name: '담당자',
        editable: true
    });
    assert.equal(s.d.getTextRange(0, 0, 0, 100), '앞뒤');
    roundtrip(s, before, '01-create-empty');
    before = model(s.d);
    s.edit(id, {
        guide: '새안내',
        memo: '새 메모 & < >',
        name: '새이름',
        editable: false
    });
    assert.equal(s.wasm.getFieldList()[0].value, '');
    roundtrip(s, before, '02-edit-empty');
    before = model(s.d);
    s.edit(id, {
        guide: '값안내🙂',
        memo: '편집메모',
        name: '작성란',
        editable: true
    });
    roundtrip(s, before, '03-unlock');
    before = model(s.d);
    const preFirstInput = before;
    s.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1
    });
    s.ih.fieldEndExitKey = null;
    s.ih.updateCaret();
    s.input('🙂');
    assert.equal(s.cursor.getPosition().charOffset, 2);
    assert.equal(s.wasm.getFieldList()[0].value, '🙂');
    assert.equal(s.wasm.getCharPropertiesAt(0, 0, 2).bold, false, 'neighbor format');
    roundtrip(s, before, '04-first-emoji');
    before = model(s.d);
    s.ih.updateCaret();
    s.input('다');
    assert.equal(s.wasm.getFieldList()[0].value, '🙂다');
    assert.equal(s.cursor.getPosition().charOffset, 3);
    const combined = model(s.d), combinedPos = s.cursor.getPosition(), merged = s.history.peekUndoTop().text === '🙂다';
    s.ih.handleUndo();
    assert.deepEqual(model(s.d), merged ? preFirstInput : before);
    undos++;
    s.ih.handleRedo();
    assert.deepEqual(model(s.d), combined);
    assert.deepEqual(s.cursor.getPosition(), combinedPos);
    redos++;
    checkReopen(s.d, '05-continued-input');
    rows.push({
        label: '05-continued-input',
        merged,
        fields: combined.fields
    });
    before = model(s.d);
    s.edit(id, {
        guide: '작성후안내',
        memo: '내용보존\n메모',
        name: '작성후',
        editable: false
    });
    assert.equal(s.wasm.getFieldList()[0].value, '🙂다');
    roundtrip(s, before, '06-edit-filled');
    before = model(s.d);
    s.ih.editMode = 'form';
    const cursorBefore = s.cursor.getPosition();
    s.input('거절');
    assert.deepEqual(model(s.d), before);
    assert.deepEqual(s.cursor.getPosition(), cursorBefore);
    rejections++;
    s.ih.executeOperation({
        kind: 'snapshot',
        operationType: 'blocked',
        operation: ()=>{
            throw Error('must not execute');
        }
    });
    assert.deepEqual(model(s.d), before);
    rejections++;
    s.ih.editMode = 'edit';
    before = model(s.d);
    const f = s.wasm.getFieldList()[0], originalChars = before.paragraphs[0].chars.slice(f.startCharIdx, f.endCharIdx);
    s.ih.executeOperation({
        kind: 'snapshot',
        operationType: 'moveFieldViaClipboard',
        operation: (w)=>{
            w.copySelection(0, 0, f.startCharIdx, 0, f.endCharIdx);
            assert.equal(w.removeFieldAt({
                sectionIndex: 0,
                paragraphIndex: 0,
                charOffset: f.startCharIdx
            }).ok, true);
            const result = parsed(w.pasteInternal(0, 1, 2));
            assert.equal(result.ok, true);
            assert.equal(result.containsField, true);
            return {
                sectionIndex: 0,
                paragraphIndex: 1,
                charOffset: result.charOffset
            };
        }
    });
    const moved = s.wasm.getFieldList()[0];
    assert.equal(moved.fieldId, id);
    assert.deepEqual(s.wasm.getClickHereProps(id), before.fields[0].props);
    assert.equal(moved.value, '🙂다');
    assert.deepEqual(model(s.d).paragraphs[1].chars.slice(2, 4), originalChars);
    assert.deepEqual(model(s.d).paragraphs[0].chars, before.paragraphs[0].chars.filter((_, i)=>i < f.startCharIdx || i >= f.endCharIdx));
    roundtrip(s, before, '07-move-filled');
    before = model(s.d);
    s.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 1,
        charOffset: 2
    });
    s.ih.removeCurrentField();
    assert.equal(s.wasm.getFieldList().length, 0);
    assert.equal(s.d.getTextRange(0, 1, 0, 100), '이동대상끝');
    roundtrip(s, before, '08-remove-filled');
    assert.deepEqual(model(s.d).paragraphs[2], sentinel, 'other style/direct formatting');
    assert.deepEqual(model(s.d).controls, reference, 'footnote reference');
    before = model(s.d);
    for (const run of [
        ()=>s.wasm.updateClickHereProps(999, 'x', 'x', 'x', true),
        ()=>s.wasm.setFieldValue(999, 'x'),
        ()=>s.wasm.removeFieldAt({
                sectionIndex: 0,
                paragraphIndex: 0,
                charOffset: 999
            })
    ]){
        let refused = false;
        try {
            refused = run().ok === false;
        } catch (error) {
            assert.match(String(error), /필드 ID 999 없음/);
            refused = true;
        }
        assert.equal(refused, true);
        assert.deepEqual(model(s.d), before);
        rejections++;
    }
    for (const kind of [
        'insert',
        'edit'
    ])for (const [key, len] of [
        [
            'name',
            251
        ],
        [
            'guide',
            251
        ],
        [
            'memo',
            1001
        ]
    ]){
        const Dialog = kind === 'insert' ? dialogs.FieldInsertDialog : dialogs.FieldEditDialog;
        const dialog = new Dialog();
        if (kind === 'edit') dialog.showWith({
            guide: 'a',
            memo: 'b',
            name: 'c',
            editable: true
        });
        else dialog.show();
        let called = false;
        dialog.onApply = ()=>{
            called = true;
        };
        dialog[key + 'Input'].value = 'x'.repeat(len);
        assert.equal(dialog.onConfirm(), false);
        assert.equal(called, false);
        assert.deepEqual(model(s.d), before);
        rejections++;
    }
} finally{
    s.close();
}
// Negative evidence: field insertion loses the existing footnote position before saving.
const k = make();
try {
    const beforeInsert = model(k.d), beforeControlPositions = parsed(k.d.getControlTextPositions(0, 2));
    k.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 2,
        charOffset: 1
    });
    k.insert({
        guide: '안내2',
        memo: '메모2',
        name: '각주옆란',
        editable: true
    });
    const before = model(k.d), afterControlPositions = parsed(k.d.getControlTextPositions(0, 2));
    assert.deepEqual(beforeControlPositions, [2]);
    assert.deepEqual(afterControlPositions, expectPreserved ? [1, 2] : [1, 1]);
    if (expectPreserved) assert.deepEqual(before.paragraphs, beforeInsert.paragraphs);
    const outputs = {};
    for (const format of [
        'Hwp',
        'Hwpx'
    ]){
        const e = k.d['export' + format + 'WithReport']();
        try {
            const report = parsed(e.contentLoss()), b = e.takeBytes();
            fs.writeFileSync(path.join(out, 'known-field-footnote.' + format.toLowerCase()), b);
            const r = new HwpDocument(b);
            try {
                const after = model(r);
                outputs[format] = {
                    report,
                    after,
                    controlPositions: parsed(r.getControlTextPositions(0, 2))
                };
                assert.equal(report.count, 0);
                if (expectPreserved || format === 'Hwp') {
                    assert.deepEqual(after, before);
                } else {
                    const expected = structuredClone(before);
                    for (const f of expected.fields){
                        f.startCharIdx += 4;
                        f.endCharIdx += 4;
                        f.startPos += 4;
                        f.endPos += 4;
                    }
                    for (const c of expected.controls.filter((c)=>c.para === 2))c.pos += 4;
                    assert.deepEqual(after, expected, 'known exact anchor drift');
                }
            } finally{
                r.free();
            }
        } finally{
            e.free();
        }
    }
    knownFailure = {
        status: expectPreserved ? 'preserved' : 'reproduced-unfixed',
        kind: 'Field insertion loses existing inline footnote position; HWPX serialization further shifts anchors',
        beforeInsert,
        beforeControlPositions,
        afterControlPositions,
        before,
        outputs,
        buildHeld: expectPreserved ? null : 'Baseline recorded before the separately authorized engine build'
    };
} finally{
    k.close();
}
// Negative evidence: control-unit rebuilding does not remap existing char-shape boundaries.
const q = make();
try {
    q.d.insertText(0,0,2,'가나');
    q.d.applyCharFormat(0,0,1,2,JSON.stringify({italic:true}));
    q.d.applyCharFormat(0,0,2,3,JSON.stringify({bold:true}));
    const before=model(q.d);
    assert.equal(before.paragraphs[0].chars[1].italic,true);
    assert.equal(before.paragraphs[0].chars[2].bold,true);
    q.cursor.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:1});
    q.insert({guide:'서식란',memo:'memo',name:'format',editable:true});
    const after=model(q.d);
    assert.equal(after.paragraphs[0].text,before.paragraphs[0].text);
    assert.equal(after.paragraphs[0].chars[1].italic,expectPreserved);
    assert.equal(after.paragraphs[0].chars[2].bold,expectPreserved);
    if (expectPreserved) assert.deepEqual(after.paragraphs,before.paragraphs);
    q.ih.handleUndo();assert.deepEqual(model(q.d),before);
    q.ih.handleRedo();assert.deepEqual(model(q.d),after);
    const outputs={};
    for(const format of ['Hwp','Hwpx']){
        const e=q.d['export'+format+'WithReport']();
        try {
            const report=parsed(e.contentLoss()),b=e.takeBytes();
            fs.writeFileSync(path.join(out,'known-field-format.'+format.toLowerCase()),b);
            const r=new HwpDocument(b);
            try {outputs[format]={report,after:model(r)};assert.equal(report.count,0);assert.deepEqual(outputs[format].after,after);}
            finally {r.free();}
        } finally {e.free();}
    }
    formatFailure={status:expectPreserved?'preserved':'reproduced-unfixed',kind:'Existing italic/bold ranges lost on field insertion',before,after,outputs,snapshotUndoRedoRestoresExactStates:true};
} finally {q.close();}
// The repaired candidate additionally checks multiple fields around two same-paragraph notes.
const complexRows=[];
if (expectPreserved) {
    const a=make();
    try {
        const note=parsed(a.d.insertFootnote(0,2,4));
        assert.equal(note.ok,true);
        for (const c of parsed(a.d.getControls()).filter(c=>c.list===0 && c.para===2 && c.ctrlId==='fn')) {
            assert.equal(parsed(a.d.insertTextInFootnote(0,2,c.controlIndex,0,2,'각주🙂본문')).ok,true);
        }
        const baseline=model(a.d), notes=noteContents(a.d), ids=[];
        for (const at of [1,2,5]) {
            const before=model(a.d);
            a.cursor.moveTo({sectionIndex:0,paragraphIndex:2,charOffset:at});
            ids.push(a.insert({guide:'안내🙂',memo:'복수 메모',name:'field'+ids.length,editable:true}));
            assert.deepEqual(model(a.d).paragraphs,baseline.paragraphs);
            assert.deepEqual(noteContents(a.d),notes);
            roundtrip(a,before,'complex-insert-'+ids.length);
        }
        for (const id of ids) {
            const before=model(a.d);
            a.ih.executeOperation({kind:'snapshot',operationType:'complexValue',operation:w=>{
                assert.equal(w.setFieldValue(id,'값🙂').ok,true);return a.cursor.getPosition();
            }});
            const f=a.wasm.getFieldList().find(f=>f.fieldId===id);
            assert.equal(f.endPos-f.startPos,3,'public UTF-16 value length');
            assert.deepEqual(noteContents(a.d),notes);
            roundtrip(a,before,'complex-value-'+id);
        }
        for (const id of ids) {
            const before=model(a.d), f=a.wasm.getFieldList().find(f=>f.fieldId===id);
            a.cursor.moveTo({sectionIndex:0,paragraphIndex:2,charOffset:f.startCharIdx});
            a.ih.removeCurrentField();
            assert.deepEqual(noteContents(a.d),notes);
            roundtrip(a,before,'complex-remove-'+id);
        }
        assert.deepEqual(model(a.d),baseline,'all original formatting/reference anchors restored');
        complexRows.push({fields:3,notes:2,undoRedoPairs:9,reopens:18,numberAndBodyPreserved:true});
    } finally {a.close();}
}
// Form navigation fields use separate paragraphs from the sentinel footnote.
const n = make();
try {
    n.d.splitParagraph(0, 1, 6);
    n.d.insertText(0, 2, 0, '빈란끝');
    const ids = [];
    for(let p = 0; p < 3; p++){
        n.cursor.moveTo({
            sectionIndex: 0,
            paragraphIndex: p,
            charOffset: 1
        });
        ids.push(n.insert({
            guide: '안내' + p,
            memo: '메모' + p,
            name: '란' + p,
            editable: p !== 1
        }));
    }
    const before = model(n.d);
    n.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1
    });
    assert.equal(n.ih.moveToAdjacentFormField(1), false);
    n.ih.editMode = 'form';
    for (const [delta, expected] of [
        [
            1,
            2
        ],
        [
            1,
            0
        ],
        [
            -1,
            2
        ]
    ]){
        assert.equal(n.ih.moveToAdjacentFormField(delta), true);
        assert.equal(n.cursor.getPosition().paragraphIndex, expected);
        assert.deepEqual(model(n.d), before);
    }
    checkReopen(n.d, '09-form-navigation');
    n.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1
    });
    n.ih.updateCaret();
    n.input('값🙂');
    assert.equal(n.wasm.getFieldList()[0].value, '값🙂');
    assert.equal(n.cursor.getPosition().charOffset, 3);
    checkReopen(n.d, '10-form-input');
    n.ih.editMode = 'edit';
    n.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 2,
        charOffset: 1
    });
    const emptyBefore = model(n.d);
    n.ih.removeCurrentField();
    assert.equal(n.wasm.getFieldList().length, 2);
    roundtrip(n, emptyBefore, '11-remove-empty');
} finally{
    n.close();
}
for (const [i, text] of [
    '🙂',
    '𐐀',
    '가🙂나',
    '👩‍💻'
].entries()){
    const u = make();
    try {
        u.insert({
            guide: '입력',
            memo: 'm',
            name: 'unicode' + i,
            editable: true
        });
        const before = model(u.d);
        u.ih.fieldEndExitKey = null;
        u.ih.updateCaret();
        u.input(text);
        assert.equal(u.cursor.getPosition().charOffset, 1 + count(text));
        assert.equal(u.wasm.getFieldList()[0].value, text);
        assert.equal(u.wasm.getCharPropertiesAt(0, 0, 1 + count(text)).bold, false);
        roundtrip(u, before, 'unicode-' + i);
    } finally{
        u.close();
    }
}
// setFieldValue is a public API operation, wrapped in existing snapshot history.
const v = make();
try {
    const id = v.insert({
        guide: 'api',
        memo: 'api memo',
        name: 'api name',
        editable: true
    });
    let before = model(v.d);
    v.ih.executeOperation({
        kind: 'snapshot',
        operationType: 'setFieldValueApi',
        operation: (w)=>{
            assert.equal(w.setFieldValue(id, '값𐐀끝').ok, true);
            return v.cursor.getPosition();
        }
    });
    assert.equal(v.wasm.getFieldList()[0].value, '값𐐀끝');
    assert.equal(v.d.getTextRange(0, 0, 0, 100), '앞값𐐀끝뒤');
    assert.deepEqual(model(v.d).paragraphs[2], before.paragraphs[2]);
    roundtrip(v, before, 'api-set-value');
    before = model(v.d);
    v.ih.executeOperation({
        kind: 'snapshot',
        operationType: 'clearFieldValueApi',
        operation: (w)=>{
            assert.equal(w.setFieldValue(id, '').ok, true);
            return v.cursor.getPosition();
        }
    });
    assert.equal(v.wasm.getFieldList()[0].value, '');
    assert.equal(v.d.getTextRange(0, 0, 0, 100), '앞뒤');
    roundtrip(v, before, 'api-clear-value');
} finally{
    v.close();
}
for (const text of [
    '🙂',
    '𐐀',
    '가🙂나',
    '👩‍💻'
]){
    const a = new commands.InsertTextCommand({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1
    }, text, 1000), b = new commands.InsertTextCommand({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1 + count(text)
    }, '끝', 1100), gap = new commands.InsertTextCommand({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 1 + text.length
    }, '끝', 1100);
    assert(a.mergeWith(b));
    if (text.length !== count(text)) assert.equal(a.mergeWith(gap), null);
}
// Optional explicit cached fixture manifest: shared command regression, not cell-field UI.
if (process.env.CLICKHERE_CELL_FIXTURES) {
    const fixtures = JSON.parse(read(process.env.CLICKHERE_CELL_FIXTURES)).fixtures.filter((f)=>!f.equations && f.file.endsWith('.hwpx'));
    assert(fixtures.length > 0);
    for (const f of fixtures){
        const d = new HwpDocument(fs.readFileSync(f.file));
        try {
            const wasm = new BridgeProbe(d), j = JSON.stringify(f.path), pos = {
                sectionIndex: 0,
                paragraphIndex: f.path.at(-1).cellParaIndex,
                parentParaIndex: f.parent,
                controlIndex: f.path[0].controlIndex,
                cellIndex: f.path[0].cellIndex,
                cellParaIndex: f.path.at(-1).cellParaIndex,
                cellPath: f.path,
                charOffset: 1
            }, before = d.getTextInCellByPath(0, f.parent, j, 0, 100000), beforeProps = [
                ...before
            ].map((_, i)=>parsed(d.getCellCharPropertiesAtByPath(0, f.parent, j, i))), beforePara = parsed(d.getCellParaPropertiesAtByPath(0, f.parent, j)), neighbor = beforeProps[1], command = new commands.InsertTextCommand(pos, '🙂', 1000, {
                bold: true
            });
            const after = command.execute(wasm);
            assert.equal(after.charOffset, 2);
            assert.equal(d.getTextInCellByPath(0, f.parent, j, 0, 100000), [
                ...before
            ].slice(0, 1).join('') + '🙂' + [
                ...before
            ].slice(1).join(''));
            assert.deepEqual(parsed(d.getCellCharPropertiesAtByPath(0, f.parent, j, 2)), neighbor);
            assert.deepEqual(parsed(d.getCellParaPropertiesAtByPath(0, f.parent, j)), beforePara);
            command.undo(wasm);
            assert.equal(d.getTextInCellByPath(0, f.parent, j, 0, 100000), before);
            assert.deepEqual([
                ...before
            ].map((_, i)=>parsed(d.getCellCharPropertiesAtByPath(0, f.parent, j, i))), beforeProps);
            cellRegressions.push({
                file: f.file,
                sha256: sha(fs.readFileSync(f.file)),
                depth: f.depth,
                merged: f.merged
            });
        } finally{
            d.free();
        }
    }
}
const proof = {
    runtime: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        electron: process.versions.electron
    },
    wasmSha256: sha(bytes),
    sourceSha256: Object.fromEntries(Object.entries(source).map(([k, v])=>[
            k,
            sha(v)
        ])),
    counts: {
        reopens,
        undos,
        redos,
        rejections,
        cellRegressions: cellRegressions.length
    },
    rows,
    cellRegressions,
    complexRows,
    fixtureNormalization,
    knownFailure,
    formatFailure,
    limitations: [
        'DOM/cursor geometry/render are adapters; real Mac GUI/physical IME not tested',
        expectPreserved ? 'Preservation checked only in supported plain body scenarios; complex ownership remains bounded' : 'Field insertion drops mixed existing char formatting and same-paragraph footnote position; HWPX adds anchor drift; unresolved',
        'Body ClickHere only; nested fields/field merging not certified',
        'Clipboard move uses supported API wrapped in actual snapshot/history, not platform clipboard GUI',
        'Linux and packaging not run; existing apps/WASM preserved'
    ]
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({
    checksPassed: true,
    featureComplete: false,
    knownFailures: expectPreserved ? 0 : 2,
    ...proof.counts,
    wasmSha256: proof.wasmSha256
}));
