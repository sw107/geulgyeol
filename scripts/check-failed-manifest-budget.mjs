// Preserve and charge oversized failed metadata; reject unbounded live/success status.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {evidenceFootprint,EvidenceBudget} from './qa-evidence-budget.mjs';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-qa-tools-synthetic-failed-status-')));
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const large='{"failure":"'+'x'.repeat(65536)+'"}';
for(const outcome of ['failed','running','complete']){
 const q=path.join(root,outcome);fs.mkdirSync(q);fs.writeFileSync(path.join(q,'qa-evidence-status.json'),JSON.stringify({outcome}));const p=path.join(q,'manifest-status.json');fs.writeFileSync(p,large);const pin=digest(p);
 if(outcome==='failed'){
  const used=evidenceFootprint(q);assert.equal(used.normalBytes,0);assert(used.failureBytes>=fs.statSync(p).blocks*512);assert.equal(used.incompletePhases.length,0);
  assert.throws(()=>new EvidenceBudget({root:q,failureLimit:used.failureBytes-1,requiredFreeBytes:0}).check(),/failure evidence budget exceeded/);
 }else assert.throws(()=>evidenceFootprint(q),/invalid manifest status/);
 assert.equal(digest(p),pin,'original failed/live/success bytes preserved');
}
// An oversized phase marker remains invalid even when it claims failure.
const bad=path.join(root,'bad-marker');fs.mkdirSync(bad);fs.writeFileSync(path.join(bad,'qa-evidence-status.json'),JSON.stringify({outcome:'failed',extra:'x'.repeat(16384)}));assert.throws(()=>evidenceFootprint(bad),/invalid evidence status/);
console.log(JSON.stringify({root,cases:4,passed:true,originalBytesPreserved:true,evidenceRetained:true}));
