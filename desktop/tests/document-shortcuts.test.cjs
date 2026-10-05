const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {installDocumentShortcuts}=require('../document-shortcuts.cjs');
test('mac document shortcuts intercept embedded file access exactly once and respect composition',()=>{
  const wc=new EventEmitter(), actions=[]; let prevented=0;
  installDocumentShortcuts(wc,a=>actions.push(a),'darwin');
  const send=overrides=>wc.emit('before-input-event',{preventDefault(){prevented++;}}, {type:'keyDown',key:'o',meta:true,...overrides});
  send({});send({key:'s'});send({key:'S',shift:true});
  assert.deepEqual(actions,['open','save','save']);assert.equal(prevented,3);
  for(const overrides of [{isComposing:true},{isAutoRepeat:true},{alt:true},{control:true},{type:'keyUp'},{shift:true},{meta:false},{key:'z'}])send(overrides);
  assert.equal(actions.length,3);assert.equal(prevented,3);
});
