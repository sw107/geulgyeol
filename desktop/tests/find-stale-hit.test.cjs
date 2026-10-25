const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
function controller(){
 const exports={};const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/ui/find-dialog.ts'),'utf8');
 const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport\s+/g,'')+'\nObject.assign(exports,{FindDialog});';
 vm.runInNewContext(code,{exports,document:{body:{appendChild(){}}}});
 const handlers=new Map(),calls=[],hit={found:true,sec:0,para:0,charOffset:4,length:6};let response=hit;
 const eventBus={on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);return()=>handlers.get(event).delete(fn);},emit(event){for(const fn of handlers.get(event)||[])fn();}};
 const wasm={documentGeneration:1,searchText(...args){calls.push(['search',...args]);return response;},replaceText(...args){calls.push(['replace',...args]);response={found:false};return {ok:true};}};
 let position={sectionIndex:0,paragraphIndex:0,charOffset:0},anchor=null;
 const ih={getCursorPosition:()=>({...position}),getSelection:()=>anchor?{start:{...anchor},end:{...position}}:null,
  moveCursorTo(pos){anchor=null;position={...pos};},
  cursor:{setAnchor(){anchor={...position};},moveTo(pos){position={...pos};},clearSelection(){anchor=null;}},
  executeOperation(op){calls.push(['snapshot']);op.operation(wasm);}};
 function place(pos){ih.moveCursorTo(pos);}
 function selectHit(hit){const cell=hit.cellContext;place({sectionIndex:hit.sec,paragraphIndex:cell?.parentPara??hit.para,charOffset:hit.charOffset,
  ...(cell?{parentParaIndex:cell.parentPara,controlIndex:cell.ctrlIdx,cellIndex:cell.cellIdx,cellParaIndex:cell.cellPara}:{})});ih.cursor.setAnchor();ih.cursor.moveTo({...position,charOffset:hit.charOffset+hit.length});}
 const d=new exports.FindDialog({wasm,eventBus,getInputHandler:()=>ih},'replace');
 Object.assign(d,{build(){},applyMode(){},installKeyCaptureHandler(){},removeKeyCaptureHandler(){},focusInput(){},wrap:{remove(){}},queryInput:{value:'',focus(){},select(){}},replaceInput:{value:'Q'},caseSensitiveCheck:{checked:false},statusLabel:{style:{},textContent:''}});
 d.show();d.queryInput.value='needle';d.findNext();calls.length=0;
 return {d,wasm,eventBus,handlers,calls,place,selectHit,missing(){response={found:false};}};
}
for(const event of ['document-mutated','document-changed','history-jumped'])test(event+' invalidates the cached hit before replacing and does not record history',()=>{
 const c=controller();c.eventBus.emit(event);c.d.doReplace();assert.deepEqual(c.calls.map(x=>x[0]),['search']);
});
for(const [name,change] of [['new query',c=>c.d.queryInput.value='different'],['case option',c=>c.d.caseSensitiveCheck.checked=true],['empty query',c=>c.d.queryInput.value='']])test(name+' is checked at replace time even without an input event',()=>{
 const c=controller();change(c);c.missing();c.d.doReplace();assert(!c.calls.some(x=>x[0]==='replace'||x[0]==='snapshot'));
});
test('a document swap generation cannot reuse an old range without a fresh search',()=>{
 const c=controller();c.wasm.documentGeneration++;c.d.doReplace();assert.deepEqual(c.calls.map(x=>x[0]),['search']);
});
for(const kind of ['body','cell'])test('previous find after a document swap starts at the new cursor, not the old '+kind+' hit',()=>{
 const c=controller();c.d.currentHit={found:true,sec:2,para:7,charOffset:12,length:6,...(kind==='cell'?{cellContext:{parentPara:7,ctrlIdx:0,cellIdx:1,cellPara:0}}:{})};
 c.wasm.documentGeneration++;c.place({sectionIndex:0,paragraphIndex:0,charOffset:0});c.d.findPrev();
 assert.deepEqual(c.calls,[['search','needle',0,0,0,false,false,true,undefined]]);
 assert.equal(c.d.currentHitGeneration,c.wasm.documentGeneration);
});
test('previous find in the same document starts at the current match start to skip it',()=>{
 const c=controller();c.d.findPrev();assert.deepEqual(c.calls,[['search','needle',0,0,4,false,false,true,undefined]]);
});
test('previous find retains the cached flat cell address in the same document',()=>{
 const c=controller(),cell={parentPara:7,ctrlIdx:2,cellIdx:1,cellPara:3};
 c.d.currentHit={found:true,sec:0,para:7,charOffset:4,length:6,cellContext:cell};
 c.selectHit(c.d.currentHit);
 c.d.findPrev();assert.deepEqual(c.calls,[['search','needle',0,7,4,false,false,true,cell]]);
});
test('a fresh unchanged hit replaces once through the real snapshot routing contract',()=>{
 const c=controller();c.d.doReplace();assert.equal(c.calls.filter(x=>x[0]==='snapshot').length,1);assert.deepEqual(c.calls.find(x=>x[0]==='replace'),['replace',0,0,4,6,'Q']);
});
for(const [name,change] of [
 ['cleared selection',c=>c.place({sectionIndex:0,paragraphIndex:0,charOffset:10})],
 ['different body paragraph',c=>c.selectHit({found:true,sec:0,para:1,charOffset:4,length:6})],
 ['different section',c=>c.selectHit({found:true,sec:1,para:0,charOffset:4,length:6})],
 ['body-to-cell selection',c=>c.selectHit({found:true,sec:0,para:0,charOffset:4,length:6,cellContext:{parentPara:0,ctrlIdx:0,cellIdx:0,cellPara:0}})],
])test(name+' invalidates a previously selected body hit before replacing',()=>{
 const c=controller();change(c);c.d.doReplace();assert.deepEqual(c.calls.map(x=>x[0]),['search']);
});
test('a different cell with identical offsets cannot reuse the previous flat-cell hit',()=>{
 const c=controller();c.d.currentHit={found:true,sec:0,para:7,charOffset:4,length:6,cellContext:{parentPara:7,ctrlIdx:1,cellIdx:0,cellPara:0}};
 c.selectHit({...c.d.currentHit,cellContext:{parentPara:7,ctrlIdx:1,cellIdx:1,cellPara:0}});
 c.d.doReplace();assert.deepEqual(c.calls.map(x=>x[0]),['search']);
});
for(const failure of ['false','throw'])test('single replace reports '+failure+' inside the snapshot instead of committing or escaping',()=>{
 const c=controller();c.wasm.replaceText=()=>{if(failure==='throw')throw Error('engine refused');return {ok:false};};
 assert.doesNotThrow(()=>c.d.doReplace());assert.equal(c.d.statusLabel.textContent,'바꾸기에 실패했습니다.');
 assert.equal(c.d.statusLabel.style.color,'#c00');
});
test('single replace without a handler does not publish a failed edit',()=>{
 const c=controller(),events=[];c.d.services.getInputHandler=()=>null;c.eventBus.emit=event=>events.push(event);c.wasm.replaceText=()=>({ok:false});
 assert.doesNotThrow(()=>c.d.doReplace());assert.deepEqual(events,[]);assert.equal(c.d.statusLabel.textContent,'바꾸기에 실패했습니다.');
});
test('dialog subscriptions do not duplicate on focus and all release on hide/reopen',()=>{
 const c=controller();c.d.show();for(const set of c.handlers.values())assert.equal(set.size,1);c.d.hide();for(const set of c.handlers.values())assert.equal(set.size,0);c.d.show();for(const set of c.handlers.values())assert.equal(set.size,1);
 c.calls.length=0;c.d.doReplace();assert(!c.calls.some(x=>x[0]==='replace'||x[0]==='snapshot'));c.d.hide();
});
