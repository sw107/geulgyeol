const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function controller(api){
  const notices=[],calls=[],exports={};
  const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/ui/style-dialog.ts'),'utf8');
  const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/import\s+\{([\s\S]*?)\}\s+from\s+(['"])(.+?)\2;/g, (_,names,quote,target)=>`const {${names}}=require(${JSON.stringify(target)});`).replace('export class StyleDialog','exports.StyleDialog = class StyleDialog');
  vm.runInNewContext(code,{exports,require:n=>n==='./toast'?{showToast:n=>notices.push(n)}:{ModalDialog:class{}},
    confirm:message=>{calls.push(['confirm',message]);return true;},alert:message=>notices.push({message}),console:{warn(){}},setTimeout});
  const dialog=Object.create(exports.StyleDialog.prototype);
  Object.assign(dialog,{selectedId:4,styles:[{id:4,name:'스타일 A'}],wasm:api,eventBus:{emit:n=>calls.push(['emit',n])},
    services:{getInputHandler:()=>({executeOperation:op=>{calls.push(['snapshot',op.kind,op.operationType]);op.operation(api);},getCursorPosition:()=>({sectionIndex:0,paragraphIndex:0,charOffset:0}),getCurrentStyleId:()=>0})},
    loadStyles:()=>calls.push(['refresh']),updateInfo:()=>calls.push(['info']),setCurrentStyleId:id=>calls.push(['current',id])});
  return {dialog,notices,calls};
}
test('style manager deletes through the format-preserving API and refreshes current style in one snapshot',()=>{
  const deleted=[];const {dialog,calls}=controller({deleteStylePreservingFormat:id=>{deleted.push(id);return {ok:true};},deleteStyle:()=>{throw Error('legacy path');}});
  dialog.handleDelete();
  assert.deepEqual(deleted,[4]);assert.equal(dialog.selectedId,0);
  assert(calls[0][1].includes('서식을 유지'));
  assert.deepEqual(calls.slice(1),[['snapshot','snapshot','deleteStyle'],['refresh'],['info'],['current',0]]);
});
test('an unsupported or malformed reference keeps the selected style and exposes the rejection reason',()=>{
  const message='바탕쪽이 포함된 문서의 스타일 삭제는 아직 지원하지 않습니다.';
  const {dialog,notices,calls}=controller({deleteStylePreservingFormat:()=>{throw Error(message);}});
  dialog.handleDelete();assert.equal(dialog.selectedId,4);
  assert.equal(calls.filter(c=>c[0]==='refresh').length,0);
  assert(notices[0].message.includes(message));
});

test('a disabled editing mode leaves the selected style intact when the operation router skips execution',()=>{
  let changed=false;const {dialog,calls}=controller({deleteStylePreservingFormat:()=>{changed=true;return {ok:true};}});
  dialog.services={getInputHandler:()=>({executeOperation:()=>{},getCurrentStyleId:()=>0})};
  dialog.handleDelete();assert.equal(changed,false);assert.equal(dialog.selectedId,4);
  assert.equal(calls.filter(c=>c[0]==='refresh').length,0);
});
