// Actual WASM + bridge/export/desktop controller/IPC/storage, with DOM/dialog adapters.
// No Electron window or physical keyboard claim. node SCRIPT PKG MANIFEST FRESH_OUT baseline|fixed
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire,stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';
const [pkg,manifest,out,mode,baselineBridge]=process.argv.slice(2),fixed=mode==='fixed';assert(fixed||mode==='baseline');assert(fixed||baselineBridge,'baseline requires the original bridge source');fs.mkdirSync(out);const sha=b=>createHash('sha256').update(b).digest('hex');
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'')).toString('base64'));
const method=(s,n)=>{let a=-1;for(const pre of ['  ','  private ']){a=s.indexOf(pre+n+'(');if(a>=0)break;}assert(a>=0,n);return s.slice(a,s.indexOf('\n  }\n',a)+4)+'\n';};
const loss=await load(fs.readFileSync('rhwp-studio/src/core/export-content-loss.ts','utf8'));globalThis.__guardLoss=loss;
const bs=fs.readFileSync(fixed?'rhwp-studio/src/core/wasm-bridge.ts':baselineBridge,'utf8');
const bridgeStart=bs.indexOf('export class WasmBridge');assert(bridgeStart>=0);const bridgeClass=bs.slice(bridgeStart);
const {Bridge}=await load('const {runReportedExport}=globalThis.__guardLoss;export class Bridge {doc;documentWritesLocked=false;requiresPasswordForSave=false;constructor(d){this.doc=d;}\n'+[...(fixed?['prepareHwpExport']:[]),'exportHwp','exportHwpWithReport','exportHwpWithPassword','exportHwpWithPasswordAndReport','exportHwpx','exportHwpxWithReport'].map(n=>method(bridgeClass,n)).join('')+'}');
const main=fs.readFileSync('rhwp-studio/src/main.ts','utf8'),a=main.indexOf('  export: (format: string) => {');assert(a>=0);const hostSource=main.slice(a+'  export: '.length,main.indexOf('\n  },',a)+4);
const {hostExport}=await load('export function hostExport(wasm){return ('+hostSource+');}');
const {CommandHistory}=await load('const NO_TEXT_MUTATION_EFFECTS=Object.freeze({kind:"none"});\n'+fs.readFileSync('rhwp-studio/src/engine/history.ts','utf8'));
const {DocumentWriteFence}=await load(fs.readFileSync('rhwp-studio/src/core/document-write-fence.ts','utf8'));
const require=createRequire(import.meta.url),{bootHost,uiController}=require('./check-host-save.cjs'),storage=require('../desktop/storage.cjs');
const walk=n=>[n,...(n.children??[]).flatMap(walk)],frames=d=>Array.from({length:d.pageCount()},(_,p)=>({info:JSON.parse(d.getPageInfo(p)),text:sha(d.getPageRenderTree(p))}));
const state=d=>({hwpx:sha(d.exportHwpx()),frames:frames(d)}),fixtures=JSON.parse(fs.readFileSync(manifest)),rows=[];let rawRejections=0,bridgeRejections=0,hostRejections=0,reopens=0,historyChecks=0;
const ctl=fixtures.find(f=>f.case==='both-control'),sentDoc=new M.HwpDocument(fs.readFileSync(ctl.path)),sentinel=sentDoc.exportHwp();sentDoc.free();
if(fixed){const incompatible=new Bridge({});let hooks=0;incompatible.onBeforeExport=()=>hooks++;assert.throws(()=>incompatible.exportHwp(),/HWPX/);assert.equal(hooks,0);}
if(fixed){const d=new M.HwpDocument(fs.readFileSync(ctl.path)),fence=new DocumentWriteFence(),guarded=fence.guard(d),bridge=new Bridge(guarded);let hooks=0;Object.defineProperty(bridge,'documentWritesLocked',{get:()=>fence.isLocked});bridge.onBeforeExport=()=>hooks++;fence.lock();assert(bridge.exportHwpWithReport().bytes.length);assert.equal(hooks,0);assert.throws(()=>guarded.insertText(0,0,0,'X'),/닫는 중/);d.free();}
for(const f of fixtures){
 const input=fs.readFileSync(f.path);assert.equal(sha(input),f.sha256);const d=new M.HwpDocument(input);try{
  const before=state(d),cold=new M.HwpDocument(d.exportHwpx());assert.deepEqual(frames(cold),frames(d));cold.free();reopens++;
  if(f.case.endsWith('-owner-changed')){
   const master=JSON.parse(d.getPageRenderTree(1)).children.filter(n=>n.type==='MasterPage').flatMap(walk).filter(n=>n.type==='TextRun').map(n=>n.text??'').join('');
   assert.match(master,/AFTER_0/,'earlier owner edit carries to later odd page in HWPX');
  }
  if(f.rejectHwp){
   const methods=[['exportHwp'],['exportHwpWithReport'],['exportHwpWithPassword','qa-pass'],['exportHwpWithPasswordAndReport','qa-pass']];
   for(const [api,...args] of methods){
    const n=new M.HwpDocument(input),file=path.join(out,f.case+'-'+api+'.hwp');fs.writeFileSync(file,sentinel,{flag:'wx'});const initial=state(n);let error;
    try{const value=n[api](...args);const bytes=value instanceof Uint8Array?value:loss.consumeWasmDocumentExport(value).bytes;fs.writeFileSync(file,bytes);}catch(e){error=String(e);}
    if(fixed){assert.match(error,/단일 짝수 바탕쪽/);assert.match(error,/HWPX/);assert.equal(sha(fs.readFileSync(file)),sha(sentinel));assert.deepEqual(state(n),initial);rawRejections++;}
    else assert.equal(error,undefined);n.free();rows.push({case:f.case,api,error:error??null,fileUnchanged:sha(fs.readFileSync(file))===sha(sentinel)});
   }
   const fence=new DocumentWriteFence(),bridge=new Bridge(fixed?fence.guard(d):d);Object.defineProperty(bridge,'documentWritesLocked',{get:()=>fence.isLocked});let hooks=0;bridge.onBeforeExport=()=>{hooks++;d.setCaretPosition(0,0,1);};
   if(fixed){fence.lock();assert.equal(typeof d.validateHwpMasterPageExport,'function');for(const [api,...args] of methods){assert.throws(()=>bridge[api](...args),e=>String(e).includes('HWPX'));assert.deepEqual(state(d),before);bridgeRejections++;}assert.equal(hooks,0);fence.unlock();}
   const history=new CommandHistory(),pos={sectionIndex:0,paragraphIndex:0,charOffset:0};let snapBefore,snapAfter;
   const cmd={type:'guard-test-edit',execute(){snapBefore=d.saveSnapshot();d.insertText(0,0,d.getParagraphLength(0,0),'EDIT');snapAfter=d.saveSnapshot();return pos;},undo(){d.restoreSnapshot(snapBefore);return pos;},redo(){d.restoreSnapshot(snapAfter);return pos;},mergeWith(){return null;},snapshotResourceCount(){return 2;},discard(){d.discardSnapshot(snapBefore);d.discardSnapshot(snapAfter);}};
   history.execute(cmd,bridge);const edited=state(d),undo=history.undoStack.slice(),redo=history.redoStack.slice();hooks=0;
   const dir=path.join(out,f.case+'-host');fs.mkdirSync(dir);const target=path.join(dir,'existing.hwp'),recover=path.join(dir,'saved.hwpx');fs.writeFileSync(target,sentinel);let dialogs=0,writes=0;
   const host=await bootHost(require.resolve('../desktop/main.cjs'),{...storage,atomicWrite:async(...a)=>{writes++;return storage.atomicWrite(...a);}},async options=>{dialogs++;return {canceled:false,filePath:options.defaultPath.endsWith('.hwpx')?recover:target};});
   const ui=await uiController((data,name,format)=>host.save(host.event,{data,name,format}),hostExport(bridge));ui.get('format').value='hwp';await ui.get('save').onclick();
   if(fixed){assert.equal(writes,0);assert.equal(dialogs,0);assert.equal(hooks,0);assert.equal(sha(fs.readFileSync(target)),sha(sentinel));assert.deepEqual(fs.readdirSync(dir),['existing.hwp']);assert.equal(ui.reported.at(-1),true);assert.deepEqual(ui.notified,[]);assert.match(ui.get('error-text').textContent,/HWPX/);assert.deepEqual(state(d),edited);assert.deepEqual(history.undoStack,undo);assert.deepEqual(history.redoStack,redo);hostRejections++;
    ui.get('error-dialog').open=false;ui.get('format').value='hwpx';await ui.get('save').onclick();assert.equal(writes,1);assert.equal(ui.reported.at(-1),false);assert.equal(sha(fs.readFileSync(target)),sha(sentinel));const reopened=new M.HwpDocument(fs.readFileSync(recover));assert.deepEqual(frames(reopened),frames(d));reopened.free();reopens++;
   }else{assert.equal(writes,1);assert.equal(ui.reported.at(-1),false);}
   if(fixed){history.undo(bridge);assert.deepEqual(frames(d),before.frames);history.redo(bridge);assert.deepEqual(frames(d),edited.frames);historyChecks+=2;}history.clear(bridge);
  }else{
   const h=new M.HwpDocument(d.exportHwp());assert.deepEqual(frames(h),frames(d));const h2=new M.HwpDocument(h.exportHwp()),x=new M.HwpDocument(h.exportHwpx());assert.deepEqual(frames(h2),frames(d));assert.deepEqual(frames(x),frames(d));h.free();h2.free();x.free();reopens+=3;
  }
  rows.push({case:f.case,rejectHwp:f.rejectHwp,directHwpxPreserved:true});
 }finally{d.free();}
}
const pairNames=[['two-odd-even-restart3','two-odd-both-restart3'],['one-even','one-both-same-payload']],pairs=[];
for(const [e,b] of pairNames){const x=new M.HwpDocument(fs.readFileSync(fixtures.find(f=>f.case===e).path)),y=new M.HwpDocument(fs.readFileSync(fixtures.find(f=>f.case===b).path));try{if(fixed){assert.throws(()=>x.exportHwp(),v=>String(v).includes('HWPX'));assert(y.exportHwp().length);}else assert.equal(sha(x.exportHwp()),sha(y.exportHwp()));pairs.push({even:e,both:b,baselineCollision:!fixed,blockedEven:fixed});}finally{x.free();y.free();}}
const proof={mode,engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),cases:fixtures.length,rawRejections,bridgeRejections,hostRejections,historyChecks,reopens,pairs,rows,GUIVerified:false,scope:'Source bridge/host/controller/IPC/storage with DOM/native-dialog adapters; actual app QA pending.'};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...proof,rows:undefined}));
