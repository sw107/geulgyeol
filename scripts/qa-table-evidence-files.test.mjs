// Preserve synthetic output for audit; do not clear earlier tests or QA evidence.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {operationEvidencePrefix, writeImmutableEvidence} from './qa-table-evidence-files.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-qa-tools-synthetic-evidence-files-'));
const first=path.join(root,'run-1'), second=path.join(root,'run-2');fs.mkdirSync(first);fs.mkdirSync(second);
const names=[];
for(const operation of ['mixed-text-history','mixed-burst-history'])for(const cycle of [0,1])for(const action of ['undo','redo']){
 const prefix=operationEvidencePrefix('fixture-input.hwp',operation),name=prefix+'-mixed-'+action+'-'+cycle+'-0-state.json.gz';
 names.push(name);const bytes=Buffer.from(operation+'/'+action+'/'+cycle);writeImmutableEvidence(first,name,bytes);assert.deepEqual(fs.readFileSync(path.join(first,name)),bytes);
}
assert.equal(new Set(names).size,8,'settled/burst and cycles retain distinct artifacts');
const original=fs.readFileSync(path.join(first,names[0]));
assert.throws(()=>writeImmutableEvidence(first,names[0],Buffer.from('replacement')),{code:'EEXIST'});
assert.deepEqual(fs.readFileSync(path.join(first,names[0])),original,'collision leaves original bytes intact');
writeImmutableEvidence(second,names[0],Buffer.from('new execution'));assert.deepEqual(fs.readFileSync(path.join(first,names[0])),original,'fresh execution cannot alter prior phase');
assert.throws(()=>writeImmutableEvidence(first,'../escape','bad'));
assert.throws(()=>operationEvidencePrefix('../fixture','mixed-text-history'));
assert.throws(()=>operationEvidencePrefix('fixture-input.hwp','../mixed-text-history'));
console.log(JSON.stringify({operationArtifacts:8,collisionRejected:true,priorBytesPreserved:true,freshExecutionSeparated:true,unsafeNamesRejected:true}));
