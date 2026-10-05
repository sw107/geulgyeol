const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {installCloseController}=require('../close-controller.cjs');
function window(){const w=new EventEmitter();w.dead=false;w.destroy=()=>w.dead=true;w.isDestroyed=()=>w.dead;w.close=()=>w.emit('close',{preventDefault(){}});return w;}
const tick=()=>new Promise(r=>setImmediate(r));
test('discard destroys window without reentering renderer unload',async()=>{const w=window();let calls=0;installCloseController(w,{isDirty:()=>true,confirmDiscard:async()=>{calls++;return true;}});w.close();w.close();await tick();assert.equal(calls,1);assert.equal(w.dead,true);});
test('cancel and failed prompt permit a later close attempt',async()=>{const w=window();let calls=0;installCloseController(w,{isDirty:()=>true,confirmDiscard:async()=>{calls++;if(calls===1)throw Error('dialog failure');return calls===3;}});w.close();await tick();assert.equal(w.dead,false);w.close();await tick();assert.equal(w.dead,false);w.close();await tick();assert.equal(w.dead,true);});
test('clean window closes without prompting',()=>{const w=window();installCloseController(w,{isDirty:()=>false,confirmDiscard:()=>{throw Error('unexpected');}});w.close();assert.equal(w.dead,true);});
test('discard waits for cleanup and cleanup failure permits retry',async()=>{
 const w=window();let finish;let calls=0;const errors=[];
 installCloseController(w,{isDirty:()=>true,confirmDiscard:async()=>true,beforeDiscard:async()=>{calls++;if(calls===1)throw Error('cleanup failed');await new Promise(r=>finish=r);},onError:e=>errors.push(e.message)});
 w.close();await tick();assert.equal(w.dead,false);assert.deepEqual(errors,['cleanup failed']);
 w.close();await tick();w.close();assert.equal(calls,2);assert.equal(w.dead,false);
 finish();await tick();assert.equal(w.dead,true);
});
