// Fresh generated WASM plus the actual FindDialog, Bridge methods and SnapshotCommand.
// DOM/cursor services are mocked; this is not a Mac GUI test.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';import {stripTypeScriptTypes} from 'node:module';
const [engineDir,fixturesDir,out,filter]=process.argv.slice(2);assert(engineDir&&fixturesDir&&out,'ENGINE_DIR FIXTURES_DIR OUTPUT_DIR');fs.mkdirSync(out,{recursive:true});
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(engineDir,'rhwp.js')));const bytes=fs.readFileSync(path.resolve(engineDir,'rhwp_bg.wasm'));initSync({module:bytes});
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const bridgeSource=fs.readFileSync(path.join(root,'rhwp-studio/src/core/wasm-bridge.ts'),'utf8');
let source=bridgeSource.slice(bridgeSource.indexOf('function parseDeferredFocusedCellCursorGeometry('),bridgeSource.indexOf('export type DeferredPaginationStatus'));
source+='class BridgeProbe {doc;constructor(doc){this.doc=doc;}\n';
for(const name of ['searchText','searchAllText','replaceText','replaceOne','replaceAll','replaceTextInCellDeferredPagination','saveSnapshot','restoreSnapshot','discardSnapshot']) {
 const a=bridgeSource.indexOf('  '+name+'(');assert(a>=0,name);source+=bridgeSource.slice(a,bridgeSource.indexOf('\n  }',a)+4)+'\n';
}
source+='}\nexport {BridgeProbe};';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'')).toString('base64'));
const {BridgeProbe}=await load(source);const {SnapshotCommand}=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'),'utf8'));
const {FindDialog}=await load(fs.readFileSync(path.join(root,'rhwp-studio/src/ui/find-dialog.ts'),'utf8'));
const fixtures=JSON.parse(fs.readFileSync(path.join(fixturesDir,'manifest.json'))).filter(c=>c.id.endsWith('-a0')&&(filter!=='--ascii-only'||c.id.includes('-c3-')));
const text=(d,c)=>c.kind===0?d.getTextRange(0,c.parent,0,10000):c.kind===1?d.getTextInCell(0,c.parent,c.control,0,0,0,10000):d.getTextInCellByPath(0,c.parent,JSON.stringify(c.kind===2?[{controlIndex:c.control,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]:[{controlIndex:c.control,cellIndex:0,cellParaIndex:0}]),0,10000);
const svgs=d=>Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));let cases=0,ui=0,history=0,noMatch=0;const rows=[];const historySvgDifferences=[];const renderTrace=[];let deferredCellCalls=0,fullCellFallbackDeletes=0;
function persist(d,c,mode,stage,expected){
 renderTrace.push({id:c.id,mode,stage,sha256:crypto.createHash('sha256').update(JSON.stringify(svgs(d))).digest('hex')});
 for(const format of ['Hwp','Hwpx']){const exported=d['export'+format+'WithReport']();try{assert.equal(JSON.parse(exported.contentLoss()).count,0);const data=exported.takeBytes();const file=path.join(out,c.id+'-'+mode+'-'+stage+'.'+format.toLowerCase());fs.writeFileSync(file,data);const r=new HwpDocument(data);try{assert.equal(text(r,c),expected);}finally{r.free();}rows.push({file,case:c,expected});}finally{exported.free();}}
}
for(const base of fixtures)for(const [variant,replacement] of ['Q','','한😀글','긴😀치환문자열123'].entries())for(const mode of base.kind<=1?['ui-one','ui-all']:['bridge-all']){
 const c={...base,id:base.id+'-r'+variant,replacement,expectedOne:base.expectedOne.replaceAll('Q',replacement),expectedAll:base.expectedAll.replaceAll('Q',replacement)};
 const d=new HwpDocument(fs.readFileSync(c.input));
 const deferred=d.replaceTextInCellDeferredPagination.bind(d),fullDelete=d.deleteTextInCell.bind(d);
 d.replaceTextInCellDeferredPagination=(...args)=>{deferredCellCalls++;return deferred(...args);};
 d.deleteTextInCell=(...args)=>{fullCellFallbackDeletes++;return fullDelete(...args);};
 const bridge=new BridgeProbe(d);let command;
 try{
  const before=svgs(d);assert.equal(text(d,c),c.original);assert.deepEqual(bridge.searchAllText(c.query,c.sensitive,true).map(h=>[h.charOffset,h.length]),c.ranges);
  let pos={sectionIndex:0,paragraphIndex:0,charOffset:0};const moves=[];
  const ih={getCursorPosition:()=>({...pos}),moveCursorTo:p=>{pos={...p};moves.push({...p});},cursor:{clearSelection(){},setAnchor(){},moveTo(p){pos={...p};moves.push({...p});}},executeOperation(op){assert.equal(op.kind,'snapshot');command=new SnapshotCommand(op.operationType,{...pos},{...pos},op.operation);command.execute(bridge);}};
  if(mode.startsWith('ui')){
   const dialog=Object.create(FindDialog.prototype);Object.assign(dialog,{services:{wasm:bridge,getInputHandler:()=>ih,eventBus:{emit(){}}},queryInput:{value:c.query},replaceInput:{value:replacement},caseSensitiveCheck:{checked:c.sensitive},statusLabel:{style:{},textContent:''},currentHit:null});
   if(mode==='ui-one'){
    dialog.doSearch(true);
    assert.equal(!!dialog.currentHit,c.matches>0);
    if(c.matches){assert.equal(dialog.currentHit.length,c.ranges[0][1]);assert.equal(moves.at(-1).charOffset,c.ranges[0][0]+c.ranges[0][1]);dialog.doReplace();assert.equal(command.type,'snapshot:replaceText');}
    else {dialog.doReplace();assert.equal(command,undefined);}
   }else {dialog.doReplaceAll();if(c.query){assert.equal(command.type,'snapshot:replaceAll');assert.equal(dialog.statusLabel.textContent,`${c.matches}개 바꿈`);}else{assert.equal(command,undefined);}}
   ui++;
  }else{
   command=new SnapshotCommand('replaceAll',{...pos},{...pos},w=>{const r=w.replaceAll(c.query,replacement,c.sensitive);assert.equal(r.ok,true);assert.equal(r.count,c.matches);return r.count?{...pos}:null;});command.execute(bridge);
  }
  const expected=mode==='ui-one'?c.expectedOne:c.expectedAll;assert.equal(text(d,c),expected);const after=svgs(d);persist(d,c,mode,'after',expected);
  if(c.matches===0){assert.deepEqual(after,before);noMatch++;}
  if(command&&!command.isNoOp()){
   command.undo(bridge);assert.equal(text(d,c),c.original);if(JSON.stringify(svgs(d))!==JSON.stringify(before))historySvgDifferences.push({id:c.id,mode,stage:'undo'});persist(d,c,mode,'undo',c.original);history++;
   command.execute(bridge);assert.equal(text(d,c),expected);if(JSON.stringify(svgs(d))!==JSON.stringify(after))historySvgDifferences.push({id:c.id,mode,stage:'redo'});persist(d,c,mode,'redo',expected);history++;
  }
  cases++;
 }finally{command?.discard(bridge);d.free();}
}
fs.writeFileSync(path.join(out,'export-manifest.json'),JSON.stringify(rows,null,2));const proof={cases,deferredCellCalls,fullCellFallbackDeletes,sourceSHA256:Object.fromEntries(['rhwp-studio/src/core/wasm-bridge.ts','rhwp-studio/src/ui/find-dialog.ts','rhwp-studio/src/engine/command.ts'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),historySvgDifferences,renderTrace,actualUICases:ui,historyRestores:history,noMatchUnchanged:noMatch,reopens:rows.length,engineSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),node:process.version,GUIVerified:false,regexSupported:false};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,historySvgDifferences:historySvgDifferences.length,renderTrace:renderTrace.length}));
