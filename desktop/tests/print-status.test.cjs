const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function fixture(text='문서 준비 완료'){
 const active=new Set();
 class Observer {
  constructor(callback){this.callback=callback;this.records=[];}
  observe(element){this.element=element;element.observers.add(this);active.add(this);}
  takeRecords(){const records=this.records;this.records=[];return records;}
  disconnect(){this.element?.observers.delete(this);active.delete(this);this.records=[];}
 }
 function element(initial){return {observers:new Set(),value:initial,get textContent(){return this.value;},set textContent(value){this.value=value;for(const o of this.observers){o.records.push({type:'childList'});queueMicrotask(()=>{const records=o.takeRecords();if(records.length)o.callback(records);});}}};}
 const exports={};const source=fs.readFileSync(path.resolve(__dirname,'../../rhwp-studio/src/command/print-status.ts'),'utf8');
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'}).replace('export class PrintStatus','exports.PrintStatus = class PrintStatus'),{exports,MutationObserver:Observer,WeakMap});
 return {PrintStatus:exports.PrintStatus,element:element(text),makeElement:element,active};
}
test('success restores the displaced normal message and disconnects observation',()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.update('인쇄 준비');s.update('인쇄 완료');s.finish();
 assert.equal(f.element.textContent,'문서 준비 완료');assert.equal(f.active.size,0);
});
test('a successful retry replaces the retained print error with its original normal status',()=>{
 const f=fixture(),failed=new f.PrintStatus(f.element);failed.update('준비');failed.fail('인쇄 실패');failed.finish();
 assert.equal(f.element.textContent,'인쇄 실패');assert.equal(f.active.size,1);
 const retry=new f.PrintStatus(f.element);retry.update('다시 준비');retry.finish();
 assert.equal(f.element.textContent,'문서 준비 완료');assert.equal(f.active.size,0);
});
test('repeated failures preserve the original normal message for the later successful retry',()=>{
 const f=fixture();for(const error of ['첫 실패','둘째 실패']){const s=new f.PrintStatus(f.element);s.update('준비');s.fail(error);s.finish();}
 const success=new f.PrintStatus(f.element);success.update('준비');success.finish();assert.equal(f.element.textContent,'문서 준비 완료');
});
test('a newer same-turn message survives later progress, failure and final cleanup',()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.update('준비');f.element.textContent='양식 모드';
 assert.equal(s.update('다음 쪽'),false);s.fail('실패');s.finish();
 assert.equal(f.element.textContent,'양식 모드');assert.equal(f.active.size,0);
});
test('an identical external rewrite of progress is preserved instead of restoring older text',()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.update('같은 문자열');f.element.textContent='같은 문자열';s.finish();
 assert.equal(f.element.textContent,'같은 문자열');assert.equal(f.active.size,0);
});
test('a newer message between attempts replaces the stored failure restore target',()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.fail('실패');s.finish();f.element.textContent='다른 작업 완료';
 const retry=new f.PrintStatus(f.element);retry.update('준비');retry.finish();assert.equal(f.element.textContent,'다른 작업 완료');
});
test('an identical external rewrite of a retained error relinquishes the old failure ownership',()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.fail('실패');s.finish();f.element.textContent='실패';
 const retry=new f.PrintStatus(f.element);retry.update('준비');retry.finish();assert.equal(f.element.textContent,'실패');
});
test('delivered external mutations relinquish ownership and release the observer',async()=>{
 const f=fixture(),s=new f.PrintStatus(f.element);s.fail('실패');s.finish();f.element.textContent='새 상태';await new Promise(setImmediate);
 assert.equal(f.active.size,0);const retry=new f.PrintStatus(f.element);retry.update('준비');retry.finish();assert.equal(f.element.textContent,'새 상태');
});
test('failure tracking is isolated by element and a missing status surface remains optional',()=>{
 const f=fixture(),second=f.makeElement('다른 문서');const a=new f.PrintStatus(f.element);a.fail('실패');a.finish();
 const b=new f.PrintStatus(second);b.update('준비');b.finish();assert.equal(second.textContent,'다른 문서');assert.equal(f.element.textContent,'실패');
 const absent=new f.PrintStatus(null);assert.equal(absent.update('준비'),false);absent.fail('실패');absent.finish();
});
