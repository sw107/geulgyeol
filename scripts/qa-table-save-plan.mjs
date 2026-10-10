// Plan saved-file identities before executing fixture operations.
import assert from 'node:assert/strict';
import path from 'node:path';
export function selectPlannedOperations(operations, requested, singleOperation) {
 const names=operations.map(o=>o.name);
 assert.equal(new Set(names).size,names.length,'duplicate generated operation');
 if(requested!==undefined) {
  assert(Array.isArray(requested)&&requested.every(n=>typeof n==='string'),'operation plan required');
  assert.equal(new Set(requested).size,requested.length,'duplicate requested operation');
  for(const name of requested)assert(names.includes(name),'planned operation unavailable: '+name);
 }
 if(singleOperation)assert(names.includes(singleOperation)&&(!requested||requested.includes(singleOperation)),
  'selected operation unavailable: '+singleOperation);
 return operations.filter(o=>(!requested||requested.includes(o.name))&&(!singleOperation||singleOperation===o.name));
}
export function plannedTableSaveFiles(q, fixture, operations) {
 return operations.flatMap(op=>
  ['noop','navigation'].includes(op.kind)&&!fixture.verifyUnchangedSaveReopen?[]:
   ['hwp','hwpx'].map(ext=>path.join(q,'files',fixture.label+'-'+fixture.ext+'-'+op.name+'.'+ext)));
}

export function assertPlannedFixtures(expected,actual) {
 assert.equal(new Set(expected).size,expected.length,'duplicate planned fixture');
 assert.deepEqual(actual,expected,'incomplete or out-of-order fixture plan');
}
