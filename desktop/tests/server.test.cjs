const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {startServer}=require('../server.cjs');
test('asset server restricts host, methods, traversal and symlinks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'baram-web-'));await fs.mkdir(path.join(root,'web'));await fs.writeFile(path.join(root,'web/index.html'),'hello');await fs.writeFile(path.join(root,'secret'),'private');await fs.symlink(path.join(root,'secret'),path.join(root,'web/link'));
 const {server,origin}=await startServer(path.join(root,'web'));
 const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(origin+url,options,res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
 try{assert.equal(await request('/'),200);assert.equal(await request('/',{method:'POST'}),405);assert.equal(await request('/',{headers:{host:'attacker.example'}}),403);assert.equal(await request('/%2e%2e%2fsecret'),403);assert.equal(await request('/link'),403);assert.equal(await request('/%XX'),400);}finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
