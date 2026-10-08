// Execute current command/bridge sources with document mocks; no GUI or WASM claim.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const commandSource=fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'),'utf8');
let js=stripTypeScriptTypes(commandSource,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'');
js='const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+js;
const commands=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const bridgeSource=fs.readFileSync(path.join(root,'rhwp-studio/src/core/wasm-bridge.ts'),'utf8');
const methods=['splitParagraph','splitParagraphInCell','splitParagraphInCellByPath','splitParagraphInHeaderFooter','splitParagraphInFootnote'];
let probe='class BridgeProbe { doc; constructor(doc) { this.doc=doc; }\n';
for(const name of methods){const a=bridgeSource.indexOf('  '+name+'(');const b=bridgeSource.indexOf('\n  }',a)+4;probe+=bridgeSource.slice(a,b)+'\n';}
probe+='}\nexport {BridgeProbe};';
const bridgeJs='function serializeParaMeta(meta){return meta?JSON.stringify(meta):undefined;}\n'+stripTypeScriptTypes(probe,{mode:'transform'});
const {BridgeProbe}=await import('data:text/javascript;base64,'+Buffer.from(bridgeJs).toString('base64'));
let cases=0;
function mock(){
 const calls=[];const snapshots=new Map();let id=0;let state={paragraphs:[{style:'A',runs:[{pos:0,id:1}]}],unrelated:{table:'keep',refs:[5,7]}};
 const bridge={calls,snapshots,get state(){return state},saveSnapshot(){snapshots.set(++id,structuredClone(state));return id},restoreSnapshot(n){state=structuredClone(snapshots.get(n))},discardSnapshot(n){snapshots.delete(n)}};
 bridge.saveSnapshotWithComposition=()=>bridge.saveSnapshot();
 const doc={};for(const name of methods)for(const enter of [false,true]){const api=name+(enter?'WithNextStyle':'');doc[api]=(...args)=>{calls.push({api,args});state.paragraphs.push({style:enter?'B':'A',runs:[{pos:0,id:enter?2:1}]});return JSON.stringify({ok:true,paraIdx:1,hfParaIndex:1,fnParaIndex:1,cellParaIndex:1})};}
 const routes=new BridgeProbe(doc);for(const name of methods)bridge[name]=routes[name].bind(routes);bridge.mergeParagraph=()=>{state.paragraphs.pop()};bridge.mergeParagraphInCell=()=>{state.paragraphs.pop()};bridge.mergeParagraphInCellByPath=()=>{state.paragraphs.pop()};return bridge;
}
for(const [Class,pos]of [[commands.SplitParagraphCommand,{sectionIndex:0,paragraphIndex:0,charOffset:3}],[commands.SplitParagraphInCellCommand,{sectionIndex:0,paragraphIndex:0,parentParaIndex:0,controlIndex:1,cellIndex:0,cellParaIndex:0,charOffset:3}],[commands.SplitParagraphInCellCommand,{sectionIndex:0,paragraphIndex:0,parentParaIndex:0,controlIndex:1,cellIndex:0,cellParaIndex:0,charOffset:3,cellPath:[{controlIndex:1,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]}]]){
 const bridge=mock();const before=structuredClone(bridge.state);const cmd=new Class(pos,true);cmd.execute(bridge);assert.match(bridge.calls.at(-1).api,/WithNextStyle$/);const after=structuredClone(bridge.state);assert.equal(cmd.snapshotResourceCount(),1);
 cmd.undo(bridge);assert.deepEqual(bridge.state,before);assert.equal(cmd.snapshotResourceCount(),2);cmd.execute(bridge);assert.deepEqual(bridge.state,after);assert.equal(bridge.calls.length,1,'redo restores saved data');cmd.discard(bridge);assert.equal(bridge.snapshots.size,0);cases++;
 const structural=mock();const old=new Class(pos);old.execute(structural);assert.doesNotMatch(structural.calls.at(-1).api,/WithNextStyle$/);assert.equal(structural.snapshots.size,0);cases++;
 const failing=mock();failing.splitParagraph= failing.splitParagraphInCell= failing.splitParagraphInCellByPath=()=>{failing.state.unrelated.refs.push(99);throw Error('unsupported reference')};const original=structuredClone(failing.state);const rejected=new Class(pos,true);assert.throws(()=>rejected.execute(failing));assert.deepEqual(failing.state,original);assert.equal(failing.snapshots.size,0);cases++;
}
for(const mode of ['headerFooter','footnote']){
 const bridge=mock();const before=structuredClone(bridge.state);const context=mode==='headerFooter'?{mode,sectionIdx:0,isHeader:true,applyTo:0,paraIdx:0,charOffset:3,previewPage:0}:{mode,sectionIdx:0,paraIdx:0,controlIdx:1,innerParaIdx:0,charOffset:3,footnoteIndex:0,pageNum:0};
 const afterContext={...context,charOffset:0,...(mode==='headerFooter'?{paraIdx:1}:{innerParaIdx:1})};const pos={sectionIndex:0,paragraphIndex:0,charOffset:3};
 const cmd=new commands.SubmodeSelectionSnapshotCommand('enter',pos,pos,b=>{if(mode==='headerFooter')b.splitParagraphInHeaderFooter(0,true,0,0,3,undefined,true);else b.splitParagraphInFootnote(0,0,1,0,3,undefined,true);return pos},context,()=>afterContext);
 cmd.execute(bridge);assert.deepEqual(cmd.editContext(),afterContext);assert.match(bridge.calls.at(-1).api,/WithNextStyle$/);const after=structuredClone(bridge.state);cmd.undo(bridge);assert.deepEqual(bridge.state,before);assert.deepEqual(cmd.editContext(),context);cmd.execute(bridge);assert.deepEqual(bridge.state,after);assert.deepEqual(cmd.editContext(),afterContext);cmd.discard(bridge);assert.equal(bridge.snapshots.size,0);cases++;
}
// Parse all touched TS files with Node's official type stripper; this is not tsc.
for(const file of ['rhwp-studio/src/core/wasm-bridge.ts','rhwp-studio/src/engine/input-handler-keyboard.ts'])stripTypeScriptTypes(fs.readFileSync(path.join(root,file),'utf8'),{mode:'transform'});
console.log(JSON.stringify({cases,currentSourceExecuted:true,typedSyntaxParsed:true,fullTypeCheck:false,WasmRuntimeVerified:false,GUIVerified:false}));
