import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const root=process.env.GEULGYEOL_QA_SOURCE_ROOT||path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]);assert(!fs.existsSync(out));fs.mkdirSync(out);
const M=await import(pathToFileURL(path.join(root,'pkg/rhwp.js')));M.initSync({module:fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))});const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[];
for(const [name,text] of [['find-input','PRE needle POST second Needle end🙂'],['alternate-input','OTHER safe content🙂']]){
 const d=M.HwpDocument.createEmpty();try{d.createBlankDocument();assert(JSON.parse(d.insertText(0,0,0,text)).ok);
  const files={};for(const ext of ['hwp','hwpx']){const bytes=Buffer.from(ext==='hwp'?d.exportHwp():d.exportHwpx());fs.writeFileSync(path.join(out,name+'.'+ext),bytes,{flag:'wx'});files[ext]=sha(bytes);}rows.push({name,text,filesSHA256:files});
 }finally{d.free();}
}
fs.writeFileSync(path.join(out,'fixture-proof.json'),JSON.stringify({synthetic:true,expectedPages:1,rows,wasmSHA256:sha(fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm')))},null,2),{flag:'wx'});
