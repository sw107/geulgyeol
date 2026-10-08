const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {bootHost,storageWithFaults,uiController}=require('../../scripts/check-host-save.cjs');
const storage=require('../storage.cjs');
const main=require.resolve('../main.cjs'),storageFile=require.resolve('../storage.cjs');
const fixtureRoot=process.env.GEULGYEOL_HOST_SAVE_FIXTURE_DIR;
// The standalone regression can use signature-only bytes; the recorded QA run
// supplies complete verified synthetic HWPX documents and checks Native reopen.
async function fixture(label){return fixtureRoot?fs.readFile(path.join(fixtureRoot,label+'.hwpx')):Buffer.concat([Buffer.from('504b0304','hex'),Buffer.from(label)]);}
async function folder(){return fs.mkdtemp(path.join(process.env.GEULGYEOL_HOST_SAVE_QA_DIR||os.tmpdir(),'host-save-test-'));}

test('actual host completion and cancel control UI dirty state',async()=>{
 const dir=await folder(),file=path.join(dir,'saved.hwpx'),bytes=await fixture('edited');
 let selected={canceled:true};const host=await bootHost(main,storage,async()=>selected);
 const ui=await uiController((data,name,format)=>host.save(host.event,{data,name,format}),bytes);
 await ui.get('save').onclick();assert.equal(ui.reported.at(-1),true);assert.deepEqual(ui.notified,[]);
 assert.match(ui.get('status').textContent,/취소/);assert.deepEqual(await fs.readdir(dir),[]);
 selected={canceled:false,filePath:file};await ui.get('save').onclick();assert.deepEqual(await fs.readFile(file),bytes);
 assert.deepEqual(ui.notified,['saved.hwpx']);assert.equal(ui.reported.at(-1),false);assert.match(ui.get('status').textContent,/저장 완료/);
});

test('real temp write plus close fault reports primary error and leaves original, then permits retry',async()=>{
 const dir=await folder(),file=path.join(dir,'existing.hwpx'),before=await fixture('old'),after=await fixture('edited');await fs.writeFile(file,before);
 const faulty=storageWithFaults(storageFile,'write-and-close');let fail=true;
 const host=await bootHost(main,{...storage,atomicWrite:(...args)=>fail?faulty.atomicWrite(...args):storage.atomicWrite(...args)},async()=>({canceled:false,filePath:file}));
 const ui=await uiController((data,name,format)=>host.save(host.event,{data,name,format}),after);
 await ui.get('save').onclick();assert.deepEqual(await fs.readFile(file),before);assert.deepEqual(await fs.readdir(dir),['existing.hwpx']);
 assert.equal(ui.get('error-dialog').open,true);assert.match(ui.get('error-text').textContent,/synthetic-write-EIO/);
 assert.equal(ui.reported.at(-1),true);assert.deepEqual(ui.notified,[]);assert.equal(ui.get('editor').inert,false);
 fail=false;await ui.get('save').onclick();assert.deepEqual(await fs.readFile(file),after);assert.equal(ui.reported.at(-1),false);
});

test('IPC rejects duplicate through pending filesystem write and releases guard after completion',async()=>{
 const dir=await folder(),file=path.join(dir,'pending.hwpx'),bytes=await fixture('edited');let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let writes=0,dialogs=0;
 const host=await bootHost(main,{...storage,atomicWrite:async(...args)=>{writes++;if(writes===1){entered();await gate;}return storage.atomicWrite(...args);}},async()=>{dialogs++;return {canceled:false,filePath:file};});
 const args={data:bytes,name:'pending.hwpx',format:'hwpx'},first=host.save(host.event,args);await started;
 await assert.rejects(host.save(host.event,args),/저장 작업.*진행/);assert.equal(dialogs,1);assert.equal(writes,1);
 assert.deepEqual(await fs.readdir(dir),[]);release();await first;await host.save(host.event,args);
 assert.equal(dialogs,2);assert.equal(writes,2);assert.deepEqual(await fs.readFile(file),bytes);
});

test('exclusive temp collision never removes a pre-existing file',async()=>{
 const dir=await folder(),existing=path.join(dir,'.baram-collision-existing.tmp');await fs.writeFile(existing,'owned by earlier synthetic operation');
 await assert.rejects(storageWithFaults(storageFile,'collision').atomicWrite(path.join(dir,'new.hwpx'),await fixture('edited')),e=>e.code==='EEXIST');
 assert.equal(await fs.readFile(existing,'utf8'),'owned by earlier synthetic operation');assert.deepEqual(await fs.readdir(dir),['.baram-collision-existing.tmp']);
});
