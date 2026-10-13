const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
const {fixture}=require('./support/status-message-fixture.cjs');
function setup(){
 const f=fixture(),callbacks=new Map(),pending=new Set(),delays=new Map();let id=0;
 const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/ui/autosave-status.ts'),'utf8');
 const exports={},dependencies={PrintStatus:f.PrintStatus};
 const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g,'const {PrintStatus}=dependencies;').replace('export class AutosaveStatusDisplay','exports.AutosaveStatusDisplay = class AutosaveStatusDisplay');
 vm.runInNewContext(code,{exports,dependencies,setTimeout(fn,ms){callbacks.set(++id,fn);pending.add(id);delays.set(id,ms);return id;},clearTimeout(key){pending.delete(key);}});
 const display=new exports.AutosaveStatusDisplay(()=>f.element,n=>n+' B');
 return {...f,display,pending,delays,last:()=>id,fire(key=id){pending.delete(key);callbacks.get(key)();}};
}
const saving={state:'saving',reason:'qa-idle'},saved={state:'saved',reason:'qa-idle',byteLength:42};
test('autosave inherits the normal status underneath an active print instead of retaining its progress',()=>{
 const s=setup(),print=new s.PrintStatus(s.element);print.update('인쇄 2/2');s.display.update(saving);s.display.update(saved);
 print.finish();assert.equal(s.element.textContent,'복구용 자동 저장 완료 (42 B)');s.fire();
 assert.equal(s.element.textContent,'문서 준비 완료');assert.equal(s.active.size,0);
});
test('a newer message survives the saved notification and delayed restore after autosave starts',()=>{
 const s=setup();s.display.update(saving);s.element.textContent='양식 모드';s.display.update(saved);s.fire();
 assert.equal(s.element.textContent,'양식 모드');assert.equal(s.active.size,0);
});
test('a canceled older restore callback cannot finish or clear the newer autosave session',()=>{
 const s=setup();s.display.update(saving);s.display.update(saved);const old=s.last();s.display.update(saving);s.fire(old);
 assert.equal(s.element.textContent,'복구용 자동 저장 중...');s.display.update(saved);s.fire();assert.equal(s.element.textContent,'문서 준비 완료');
});
test('an autosave restore delivered during a later print does not overwrite its progress',()=>{
 const s=setup();s.display.update(saving);s.display.update(saved);const print=new s.PrintStatus(s.element);print.update('다음 인쇄 1/2');s.fire();
 assert.equal(s.element.textContent,'다음 인쇄 1/2');print.finish();assert.equal(s.element.textContent,'문서 준비 완료');
});
test('an identical external rewrite of the completed notice survives the restore timer',()=>{
 const s=setup();s.display.update(saving);s.display.update(saved);const text=s.element.textContent;s.element.textContent=text;s.fire();assert.equal(s.element.textContent,text);
});
test('background notices keep a retained print failure and its successful-retry target intact',()=>{
 const s=setup(),print=new s.PrintStatus(s.element);print.fail('인쇄 실패');print.finish();s.display.update(saving);s.display.update(saved);
 assert.equal(s.element.textContent,'인쇄 실패');assert.equal(s.pending.size,0);
 const retry=new s.PrintStatus(s.element);retry.update('다시 인쇄');retry.finish();assert.equal(s.element.textContent,'문서 준비 완료');
});
test('blocked and failed background notices use their existing duration and restore only owned messages',()=>{
 const s=setup();s.display.update({state:'blocked',reason:'qa-blocked'});assert.equal(s.delays.get(s.last()),4000);s.fire();assert.equal(s.element.textContent,'문서 준비 완료');
 s.display.update(saving);s.display.update({state:'error',reason:'qa-error',error:new Error('store unavailable')});assert.equal(s.element.textContent,'복구용 자동 저장 실패');assert.equal(s.delays.get(s.last()),4000);s.fire();assert.equal(s.element.textContent,'문서 준비 완료');
});
