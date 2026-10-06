const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function controller({fail=false,fallback=false,disabled=false,add=false}={}){
  const notices=[],calls=[],exports={};let state={name:'original',shape:'original'},snap;
  const api={saveSnapshot:()=>{snap=structuredClone(state);calls.push('save');return 7;},restoreSnapshot:id=>{assert.equal(id,7);state=structuredClone(snap);calls.push('rollback');},discardSnapshot:id=>{assert.equal(id,7);calls.push('discard');},
    updateStyle:()=>{state.name='edited';calls.push('metadata');return true;},createStyle:()=>{state.name='created';calls.push('create');return 4;},
    updateStyleShapesPreservingOverrides:()=>{calls.push('propagate');if(fail)throw Error('지원하지 않는 바탕쪽 참조');state.shape='updated';return {ok:true};}};
  const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/ui/style-edit-dialog.ts'),'utf8');
  const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/import\s+\{([\s\S]*?)\}\s+from\s+(['"])(.+?)\2;/g,(_,names,q,target)=>`const {${names}}=require(${JSON.stringify(target)});`).replace('export const MAX_STYLE_NAME_LEN','const MAX_STYLE_NAME_LEN').replace('export class StyleEditDialog','exports.StyleEditDialog = class StyleEditDialog');
  vm.runInNewContext(code,{exports,require:n=>n==='./toast'?{showToast:n=>notices.push(n)}:{ModalDialog:class{}},console:{warn(){}},alert:m=>notices.push({message:m})});
  const dialog=Object.create(exports.StyleEditDialog.prototype);
  Object.assign(dialog,{addMode:add,nameInput:{value:'edited'},enNameInput:{value:'edited'},typePara:{checked:true},nextStyleSelect:{value:'0'},styleInfo:{id:4,type:0,nextStyleId:0},baseInfo:{},charModsJson:'{"fontSize":2400}',paraModsJson:'{}',wasm:api,eventBus:{emit:()=>calls.push('event')},onSave:()=>calls.push('refresh'),
    services:fallback?undefined:{getInputHandler:()=>({executeOperation:op=>{calls.push(op.kind);if(!disabled)op.operation(api);},getPosition:()=>({sectionIndex:0,paragraphIndex:0,charOffset:0})})}});
  return {dialog,calls,notices,state:()=>state};
}
test('style editor commits metadata and propagation in one snapshot and releases its rollback snapshot',()=>{
  const c=controller();assert.equal(c.dialog.onConfirm(),true);assert.deepEqual(c.calls,['snapshot','save','metadata','propagate','discard','refresh']);assert.deepEqual(c.state(),{name:'edited',shape:'updated'});
});
for(const fallback of [false,true])for(const add of [false,true])test(`unsupported propagation rolls back ${add?'create':'edit'} (${fallback?'fallback':'history'})`,()=>{
  const c=controller({fail:true,fallback,add});assert.equal(c.dialog.onConfirm(),false);assert.deepEqual(c.state(),{name:'original',shape:'original'});assert(c.calls.includes('rollback'));assert(c.calls.includes('discard'));assert(!c.calls.includes('refresh'));assert(!c.calls.includes('event'));assert(c.notices[0].message.includes('바탕쪽'));
});
test('disabled editing routes leave style metadata and shapes untouched',()=>{
  const c=controller({disabled:true});assert.equal(c.dialog.onConfirm(),false);assert.deepEqual(c.calls,['snapshot']);assert.deepEqual(c.state(),{name:'original',shape:'original'});
});
