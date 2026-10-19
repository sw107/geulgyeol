// MANIFEST BASE_NATIVE FIXED_NATIVE BASE_WASM FIXED_WASM FRESH_OUTPUT_DIR
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [manifest,bnPath,nPath,bwPath,wPath,out]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p));
const fixtures=read(manifest),bn=read(bnPath),n=read(nPath),bw=read(bwPath),w=read(wPath);
fs.mkdirSync(out);
const results=[], checker=fileURLToPath(new URL('./check-unequal-endnote-source-continuation.mjs',import.meta.url));
for(const f of fixtures){
  assert.equal(createHash('sha256').update(fs.readFileSync(f.path)).digest('hex'),f.sha256);
  const rows=n.rows.filter(r=>r.case===f.case);
  assert.deepEqual(rows.map(r=>r.stage),['before','grown','undo','redo']);
  for(const row of rows){
    const base=bn.rows.find(r=>r.case===f.case&&r.stage===row.stage);
    const wasm=w.rows.find(r=>r.case===f.case&&r.stage===row.stage);
    const baseWasm=bw.rows.find(r=>r.case===f.case&&r.stage===row.stage);
    assert(base&&wasm&&baseWasm);
    for(const [variant,v]of Object.entries(row.result))
      assert.deepEqual(v.semantic,base.result[variant].semantic,'source model unchanged from main');
    for(const [variant,v]of Object.entries(wasm.result)){
      const b=baseWasm.result[variant];
      for(const key of ['body','texts','equations'])assert.deepEqual(v[key],b[key],'public source properties unchanged');
    }
    if(!f.supported){
      assert.deepEqual(row,base,'excluded Native path unchanged');
      assert.deepEqual(wasm,baseWasm,'excluded WASM path unchanged');
    }
  }
  if(f.supported){
    const report=path.join(out,f.case+'.json');
    const p=spawnSync(process.execPath,[checker,'fixed',nPath,wPath,report,f.case],{stdio:'inherit'});
    assert(!p.error&&p.status===0,'supported source/geometry/history/cursor gate');
    assert.equal(read(report).passed,true);
  }
  results.push({case:f.case,supported:f.supported,snapshots:20,
    ...(f.supported?{passed:true}:{unchangedFromMain:true,knownFailuresNotFixPass:true})});
}
const proof={GUIVerified:false,HancomVerified:false,cases:fixtures.length,
  supportedCases:fixtures.filter(f=>f.supported).length,stages:fixtures.length*4,
  snapshots:fixtures.length*20,sourceModelUnchangedFromMain:true,
  baselineWasmSHA256:bw.wasmSHA256,candidateWasmSHA256:w.wasmSHA256,results};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(proof));
