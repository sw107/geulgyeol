const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DocumentAgentController}=require('../../rhwp-studio/src/document-agent/controller.ts');
const {EventBus}=require('../../rhwp-studio/src/core/event-bus.ts');
function document(){
 const eventBus=new EventBus(),wasm={documentGeneration:1,pageCount:1,getSourceFormat:()=> 'hwp',borrowDocumentHandle:()=>({exportHwp:()=>new Uint8Array([1,2,3])})};
 const controller=new DocumentAgentController({wasm,eventBus,isDirty:()=>true});
 return {eventBus,wasm,controller,state:()=>controller.getDocumentState()};
}
test('legacy object edits invalidate document revision even when only document-changed is emitted',()=>{
 const d=document(),before=d.state();
 d.eventBus.emit('document-changed');const inserted=d.state();
 assert.equal(inserted.documentEpoch,before.documentEpoch);assert(inserted.changeSeq>before.changeSeq);
 d.eventBus.emit('document-changed');assert(d.state().changeSeq>inserted.changeSeq);
});
test('paired text and pagination rendering notifications count each mutation once',()=>{
 const d=document();
 for(const [mutation,render] of [['input-handler-edit','input-handler-edit'],['document-agent','document-agent-rendered'],['input-handler-cell-overflow','cell-overflow-pagination'],['input-handler-resumable-pagination','deferred-pagination-complete']]){
  const before=d.state().changeSeq;d.eventBus.emit('document-mutated',mutation);d.eventBus.emit('document-changed',render);assert.equal(d.state().changeSeq,before+1);
 }
 const before=d.state();d.eventBus.emit('document-view-changed');assert.deepEqual(d.state(),before);
});
test('document replacement resets revision and disposal removes both event subscriptions',()=>{
 const d=document();d.eventBus.emit('document-changed');d.wasm.documentGeneration=2;
 assert.equal(d.state().documentEpoch,2);assert.equal(d.state().changeSeq,0);
 d.eventBus.emit('document-changed');assert.equal(d.state().changeSeq,1);
 d.controller.dispose();d.eventBus.emit('document-mutated');d.eventBus.emit('document-changed');assert.equal(d.state().changeSeq,1);
});
