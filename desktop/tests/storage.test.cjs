const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {atomicWrite,validateDocumentBytes}=require('../storage.cjs');
test('reject mismatched formats and empty exports',()=>{
 assert.throws(()=>validateDocumentBytes(new Uint8Array(),'hwp'));
 assert.throws(()=>validateDocumentBytes(Buffer.from('504b0304','hex'),'hwp'));
 assert.equal(validateDocumentBytes(Buffer.from('504b0304','hex'),'hwpx').length,4);
});
test('atomic replacement and failed rename cleanup',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'baram-test-'));
 try {const file=path.join(root,'document.hwp');await fs.writeFile(file,'original');await atomicWrite(file,Buffer.from('edited'));assert.equal(await fs.readFile(file,'utf8'),'edited');
 await fs.mkdir(path.join(root,'directory'));await assert.rejects(atomicWrite(path.join(root,'directory'),Buffer.from('bad')));assert.deepEqual((await fs.readdir(root)).sort(),['directory','document.hwp']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
