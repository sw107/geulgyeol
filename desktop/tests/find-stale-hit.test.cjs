const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
function controller(){
 const exports={};const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/ui/find-dialog.ts'),'utf8');
 const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport\s+/g,'')+'\nObject.assign(exports,{FindDialog});';
 vm.runInNewContext(code,{exports,document:{body:{appendChild(){}}}});
 const handlers=new Map(),calls=[],hit={found:true,sec:0,para:0,charOffset:4,length:6};let response=hit;
 const eventBus={on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);return()=>handlers.get(event).delete(fn);},emit(event){for(const fn of handlers.get(event)||[])fn();}};
 const wasm={documentGeneration:1,searchText(...args){calls.push(['search',...args]);return response;},replaceText(...args){calls.push(['replace',...args]);response={found:false};return {ok:true};}};
 const ih={getCursorPosition:()=>({sectionIndex:0,paragraphIndex:0,charOffset:0}),moveCursorTo(){},cursor:{setAnchor(){},moveTo(){},clearSelection(){}},executeOperation(op){calls.push(['snapshot']);op.operation(wasm);}};
 const d=new exports.FindDialog({wasm,eventBus,getInputHandler:()=>ih},'replace');
 Object.assign(d,{build(){},applyMode(){},installKeyCaptureHandler(){},removeKeyCaptureHandler(){},focusInput(){},wrap:{remove(){}},queryInput:{value:'',focus(){},select(){}},replaceInput:{value:'Q'},caseSensitiveCheck:{checked:false},statusLabel:{style:{},textContent:''}});
 d.show();d.queryInput.value='needle';d.findNext();calls.length=0;
 return {d,wasm,eventBus,handlers,calls,missing(){response={found:false};}};
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
 c.wasm.documentGeneration++;c.d.findPrev();
 assert.deepEqual(c.calls,[['search','needle',0,0,0,false,false,true]]);
 assert.equal(c.d.currentHitGeneration,c.wasm.documentGeneration);
});
test('previous find in the same document starts at the current match start to skip it',()=>{
 const c=controller();c.d.findPrev();assert.deepEqual(c.calls,[['search','needle',0,0,4,false,false,true]]);
});
test('a fresh unchanged hit replaces once through the real snapshot routing contract',()=>{
 const c=controller();c.d.doReplace();assert.equal(c.calls.filter(x=>x[0]==='snapshot').length,1);assert.deepEqual(c.calls.find(x=>x[0]==='replace'),['replace',0,0,4,6,'Q']);
});
test('dialog subscriptions do not duplicate on focus and all release on hide/reopen',()=>{
 const c=controller();c.d.show();for(const set of c.handlers.values())assert.equal(set.size,1);c.d.hide();for(const set of c.handlers.values())assert.equal(set.size,0);c.d.show();for(const set of c.handlers.values())assert.equal(set.size,1);
 c.calls.length=0;c.d.doReplace();assert(!c.calls.some(x=>x[0]==='replace'||x[0]==='snapshot'));c.d.hide();
});
