const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test('memory recovery keeps the last saved ID when every other timestamp is future',async()=>{
  const store=await import(pathToFileURL(path.resolve(__dirname,'../../rhwp-studio/src/recovery/autosave-store.ts')));
  await store.clearAutosaveDrafts();
  const draft=(id,savedAt,data)=>({id,savedAt,data:new Uint8Array(data),fileName:id+'.hwp',sourceFormat:'hwp',byteLength:data.length});
  for(let i=0;i<12;i++)await store.saveAutosaveDraft(draft('future-'+i,Date.now()+365*86400000+i,[i]));
  await store.saveAutosaveDraft(draft('active',1,[42]));
  assert.deepEqual(Array.from((await store.getAutosaveDraft('active')).data),[42]);
  assert.equal((await store.listAutosaveDrafts()).length,12);
  assert.equal(await store.getAutosaveDraft('future-0'),null);
  await store.saveAutosaveDraft(draft('active',0,[43]));
  assert.deepEqual(Array.from((await store.getAutosaveDraft('active')).data),[43]);
  assert.equal((await store.listAutosaveDrafts()).length,12);
  await store.clearAutosaveDrafts();
});
