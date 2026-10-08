const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {startProfileServer}=require('../profile-server.cjs');
const close=server=>new Promise(resolve=>server.close(resolve));

test('profile origin survives restart, other profiles differ, busy origin does not silently change',async()=>{
  const base=await fs.mkdtemp(path.join(process.env.GEULGYEOL_HOST_SAVE_QA_DIR||os.tmpdir(),'profile-origin-'));
  const root=path.join(base,'web'),profile=path.join(base,'profile');
  await fs.mkdir(root);await fs.writeFile(path.join(root,'index.html'),'synthetic origin test');
  let first,other,reopened,occupier;
  try{
    first=await startProfileServer(root,profile);const origin=first.origin;
    const record=await fs.readFile(path.join(profile,'asset-origin.json'));
    other=await startProfileServer(root,path.join(base,'other'));assert.notEqual(other.origin,origin);
    await close(first.server);first=null;
    reopened=await startProfileServer(root,profile);assert.equal(reopened.origin,origin);
    assert.equal(await (await fetch(origin)).text(),'synthetic origin test');
    assert.deepEqual(await fs.readFile(path.join(profile,'asset-origin.json')),record);
    await close(reopened.server);reopened=null;
    occupier=net.createServer();await new Promise(resolve=>occupier.listen(JSON.parse(record).port,'127.0.0.1',resolve));
    await assert.rejects(startProfileServer(root,profile),/복구용 로컬 주소가 사용 중/);
    assert.deepEqual(await fs.readFile(path.join(profile,'asset-origin.json')),record);
  }finally{for(const value of [first?.server,other?.server,reopened?.server,occupier])if(value?.listening)await close(value);}
});
