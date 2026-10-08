// Candidate WASM, actual WasmBridge/InputHandler/SnapshotCommand/CommandHistory.
// Cursor/refresh adapters are not real GUI or physical IME verification.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [pkg, manifestFile, out] = process.argv.slice(2);
assert(pkg && manifestFile && out);
fs.mkdirSync(out, {recursive:true});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const bytes = fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument} = await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));
initSync({module:bytes});
const load = async s => import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'')).toString('base64'));
const method = (s,n) => {
    const start=s.indexOf('  '+n+'('); assert(start>=0,n);
    return s.slice(start,s.indexOf('\n  }\n',start)+4)+'\n';
};
const source=Object.fromEntries(Object.entries({bridge:'core/wasm-bridge.ts',input:'engine/input-handler.ts',command:'engine/command.ts',history:'engine/history.ts'}).map(([k,v])=>[k,fs.readFileSync('rhwp-studio/src/'+v,'utf8')]));
globalThis.__namedCellCommands=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+source.command);
const {CommandHistory}=await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__namedCellCommands;\n'+source.history);
let bridge='export class Bridge {doc; constructor(doc){this.doc=doc;}\n';
for(const n of ['setFieldValue','setFieldValueByName','saveSnapshot','restoreSnapshot','discardSnapshot'])bridge+=method(source.bridge,n);
const {Bridge}=await load(bridge+'}');
const {Handler}=await load('const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__namedCellCommands;\nexport class Handler{\n'+method(source.input,'executeOperation')+'}');
const pathAt=(c,cell,para)=>c.path.map((v,i)=>({controlIndex:v[0],cellIndex:i===c.path.length-1?cell:v[1],cellParaIndex:i===c.path.length-1?para:v[2]}));
const model=(d,c)=>{
    const controls=JSON.parse(d.getControls());
    return {fields:JSON.parse(d.getFieldList()),styles:JSON.parse(d.getStyleList()),controls,
        body:Array.from({length:d.getParagraphCount(0)},(_,p)=>{const text=d.getTextRange(0,p,0,100000);return {text,para:JSON.parse(d.getParaPropertiesAt(0,p)),chars:[...text].map((_,i)=>JSON.parse(d.getCharPropertiesAt(0,p,i)))};}),
        cells:Array.from({length:c.merged?3:4},(_,cell)=>{const first=JSON.stringify(pathAt(c,cell,0));return {own:JSON.parse(d.getCellOwnPropertiesByPath(0,c.parent,first)),paras:Array.from({length:d.getCellParagraphCountByPath(0,c.parent,first)},(_,p)=>{const at=JSON.stringify(pathAt(c,cell,p)),text=d.getTextInCellByPath(0,c.parent,at,0,100000);return {text,para:JSON.parse(d.getCellParaPropertiesAtByPath(0,c.parent,at)),chars:[...text].map((_,i)=>JSON.parse(d.getCellCharPropertiesAtByPath(0,c.parent,at,i)))};})};}),
        notes:controls.filter(x=>x.list===0&&x.ctrlId==='fn').map(x=>JSON.parse(d.getFootnoteInfo(0,x.para,x.controlIndex)))};
};
const exports=(d,label)=>Object.fromEntries(['Hwp','Hwpx'].map(f=>{const e=d['export'+f+'WithReport']();try{const b=Buffer.from(e.takeBytes()),file=path.resolve(out,label+'.'+f.toLowerCase());fs.writeFileSync(file,b);return [f,{b,file,report:JSON.parse(e.contentLoss())}];}finally{e.free();}}));
const build=(d,c)=>{
    const wasm=new Bridge(d),history=new CommandHistory(),ih=new Handler();let pos={sectionIndex:0,paragraphIndex:c.parent,charOffset:0};
    Object.assign(ih,{wasm,history,pendingFootnoteComposition:false,cursor:{getPosition:()=>pos,moveTo:p=>{pos=p;},resetPreferredX:()=>{}},isOperationAllowedInEditMode:()=>true,caretLayoutReveal:{requestFor:()=>{}},refreshAfterOperation:()=>{},pastedFieldEndOutsidePending:false});
    const edit=(name,value,byId=false)=>ih.executeOperation({kind:'snapshot',operationType:'namedCellValue',operation:w=>{const selected=JSON.parse(d.getFieldList()).find(f=>f.name===name);const result=byId?w.setFieldValue(selected.fieldId,value):w.setFieldValueByName(name,value);assert.equal(result.ok,true);return pos;}});
    return {wasm,history,ih,edit};
};
let accepted=0,rejected=0,reopens=0,undos=0,redos=0,collisions=0;
const rows=[],savedManifest=[],fixtureNormalization=[];
for(const [i,c] of JSON.parse(fs.readFileSync(manifestFile)).entries()) {
    let d=new HwpDocument(fs.readFileSync(c.file));let h;
    try {
        if(c.kind==='normal') {
            const beforeNormalization=model(d,c),seed=d.exportHwpx();d.free();d=new HwpDocument(seed);const afterNormalization=model(d,c),differences=[];
            const diff=(a,b,key)=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k of Object.keys(a))diff(a[k],b[k],key+'.'+k);}else differences.push({key,before:a,after:b});};
            diff(beforeNormalization,afterNormalization,'model');assert(differences.every(x=>/\.(fillType|patternColor|patternType)$/.test(x.key)));fixtureNormalization.push({input:c.file,differences});
            h=build(d,c);
            for(const [j,value] of ['새🙂𐐀값','','短🙂'].entries()) {
                const before=model(d,c);h.edit('target',value,j%2===1);const after=model(d,c);assert.equal(after.cells[0].paras[0].text,value);
                assert.deepEqual(after.body,before.body);assert.deepEqual(after.cells.slice(1),before.cells.slice(1));assert.deepEqual(after.cells[0].paras.slice(1),before.cells[0].paras.slice(1));assert.deepEqual(after.notes,before.notes);assert.deepEqual(after.styles,before.styles);assert.deepEqual(after.controls,before.controls);
                assert.deepEqual(after.cells[0].paras[0].para,before.cells[0].paras[0].para);
                assert.deepEqual(after.fields.filter(x=>x.name!=='target'),before.fields.filter(x=>x.name!=='target'));
                const field=after.fields.find(x=>x.name==='target');assert.equal(field.startCharIdx,0);assert.equal(field.endCharIdx,[...value].length);
                h.history.undo(h.wasm);undos++;assert.deepEqual(model(d,c),before);h.history.redo(h.wasm);redos++;assert.deepEqual(model(d,c),after);
                for(const v of Object.values(exports(d,`normal-${i}-${j}`))){assert.equal(v.report.count,0);const r=new HwpDocument(v.b);try{assert.deepEqual(model(r,c),after);savedManifest.push({input:c.file,file:v.file,parent:c.parent,path:c.path,value});reopens++;}finally{r.free();}}
                accepted++;
            }
            // Existing by-name contract: repeated cell names choose the first owner.
            const paths=JSON.stringify([pathAt(c,1,0)]);assert.equal(JSON.parse(d.applyCellOwnPropertiesByPaths(0,c.parent,paths,JSON.stringify({fieldName:'target'}))).ok,true);
            const neighbor=model(d,c).cells[1];h.edit('target','첫번째🙂');assert.deepEqual(model(d,c).cells[1],neighbor);h.history.undo(h.wasm);undos++;h.history.redo(h.wasm);redos++;collisions++;
            if(c.depth>1) {
                // An ancestor's synthetic ID can equal a distinct nested owner's.
                const ancestor=[{controlIndex:c.path[0][0],cellIndex:0,cellParaIndex:0}];
                assert.equal(JSON.parse(d.applyCellOwnPropertiesByPaths(0,c.parent,JSON.stringify([ancestor]),JSON.stringify({fieldName:'outer-owner'}))).ok,true);
                const before=model(d,c),savedBefore=exports(d,`duplicate-id-${i}-before`);
                assert.throws(()=>h.edit('target','wrong',true),/중복/);assert.deepEqual(model(d,c),before);
                const savedAfter=exports(d,`duplicate-id-${i}-after`);for(const f of ['Hwp','Hwpx'])assert(savedAfter[f].b.equals(savedBefore[f].b));rejected++;collisions++;
            }
        } else {
            h=build(d,c);
            const cell=JSON.parse(d.getFieldList()).find(f=>f.cellField&&f.name==='target');assert.equal(cell.startCharIdx,0);assert.equal(cell.endCharIdx,[...cell.value].length);
            for(const [j,value] of ['새🙂𐐀',''].entries()) {
                const before=model(d,c),events=d.getEventLog(),info=d.getDocumentInfo(),savedBefore=exports(d,`reject-${i}-${j}-before`);
                assert.throws(()=>h.edit('target',value));assert(!h.history.canUndo());assert.deepEqual(model(d,c),before);assert.equal(d.getEventLog(),events);assert.equal(d.getDocumentInfo(),info);
                assert.throws(()=>h.edit('target',value,true));assert(!h.history.canUndo());assert.deepEqual(model(d,c),before);
                const savedAfter=exports(d,`reject-${i}-${j}-after`);for(const f of ['Hwp','Hwpx'])assert(savedAfter[f].b.equals(savedBefore[f].b),'entire saved document byte unchanged');
                rejected+=2;
            }
            if(c.kind==='inner-field') {
                // Explicit inner name is a different target and remains editable.
                const before=model(d,c);h.edit('inner','내부🙂');const after=model(d,c);assert.equal(after.fields.find(x=>x.name==='inner').value,'내부🙂');assert.equal(after.cells[0].own.fieldName,'target');
                h.history.undo(h.wasm);undos++;assert.deepEqual(model(d,c),before);h.history.redo(h.wasm);redos++;assert.deepEqual(model(d,c),after);
                // A rejected whole-cell edit must retain an existing redo entry.
                h.history.undo(h.wasm);undos++;assert(h.history.canRedo());assert.throws(()=>h.edit('target','bad'));assert(h.history.canRedo());assert.deepEqual(model(d,c),before);h.history.redo(h.wasm);redos++;assert.deepEqual(model(d,c),after);rejected++;
                for(const v of Object.values(exports(d,`inner-${i}`))){assert.equal(v.report.count,0);const r=new HwpDocument(v.b);try{assert.deepEqual(model(r,c),after);savedManifest.push({input:c.file,file:v.file,parent:c.parent,path:c.path,innerValue:'내부🙂'});reopens++;}finally{r.free();}}
                accepted++;
            }
        }
        rows.push({kind:c.kind,input:c.file,depth:c.depth,merged:c.merged});
    } finally {h?.history.clear(h.wasm);d.free();}
}
const proof={candidateWasmSHA256:sha(bytes),accepted,rejected,reopens,undos,redos,collisions,rows,fixtureNormalization,sourceSHA256:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),actualWasmBridge:true,actualInputHandlerExecuteOperation:true,actualSnapshotCommandAndHistory:true,GUIVerified:false,physicalIMEVerified:false};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(savedManifest,null,2)+'\n');console.log(JSON.stringify({...proof,rows:undefined,fixtureNormalization:undefined}));
