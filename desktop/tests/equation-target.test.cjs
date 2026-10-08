const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const api = import(pathToFileURL(path.resolve(__dirname, '../../rhwp-studio/src/engine/equation-target.ts')));
test('cell equation property and deletion routes distinguish all inner indices and cells', async () => {
  const a = await api;
  const cells = new Map([['7/2/1/0', {script:'first'}], ['7/2/1/1', {script:'second'}], ['7/3/1/1', {script:'neighbor'}]]);
  const body = {script:'body'};
  const key = t => `${t.tableControlIdx}/${t.cellIdx}/${t.cellParaIdx}/${t.controlIdx}`;
  const wasm = {
    getEquationPropertiesInCell: (s,p,t) => {assert.equal(s,0);assert.equal(p,5);return cells.get(key(t));},
    setEquationPropertiesInCell: (s,p,t,v) => Object.assign(cells.get(key(t)),v),
    deleteEquationControlInCell: (s,p,t) => cells.delete(key(t)),
    getEquationProperties: () => body,
    setEquationProperties: () => {throw Error('body fallback');},
    deleteEquationControl: () => {throw Error('body fallback');},
  };
  const ref={sec:0,ppi:5,ci:1,cellPath:[{controlIndex:7,cellIndex:2,cellParaIndex:1}]};
  assert.equal(a.getEquationSelectionProperties(wasm,ref).script,'second');
  a.setEquationSelectionProperties(wasm,ref,{script:'edited'});
  assert.equal(cells.get('7/2/1/1').script,'edited');
  assert.equal(cells.get('7/2/1/0').script,'first');assert.equal(cells.get('7/3/1/1').script,'neighbor');
  a.deleteEquationSelection(wasm,ref);
  assert.equal(cells.has('7/2/1/1'),false); assert.equal(cells.size,2); assert.equal(body.script,'body');
});
test('both cell path encodings and explicit flat coordinates normalize to the same address', async()=>{
  const a=await api; const base={sec:0,ppi:5,ci:2}; const expected={tableControlIdx:7,cellIdx:3,cellParaIdx:4,controlIdx:2};
  for(const ref of [
    {...base,cellPath:[{controlIndex:7,cellIndex:3,cellParaIndex:4}]},
    {...base,cellPath:[{controlIdx:7,cellIdx:3,cellParaIdx:4}]},
    {...base,cellIdx:3,cellParaIdx:4,outerTableControlIdx:7},
  ]) assert.deepEqual(a.equationCellTarget(ref),expected);
});
test('ambiguous, invalid and nested cell addresses reject before touching any document', async()=>{
  const a=await api; let called=0; const wasm=new Proxy({}, {get:()=>()=>{called++;}});
  for(const ref of [
    {sec:0,ppi:0,ci:0,cellIdx:1,cellParaIdx:0},
    {sec:0,ppi:0,ci:0,cellPath:[{controlIndex:0,cellIndex:1,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]},
    {sec:0,ppi:0,ci:-1,cellPath:[{controlIndex:0,cellIndex:1,cellParaIndex:0}]},
    {sec:0,ppi:0,ci:0,cellPath:[{controlIndex:NaN,cellIndex:1,cellParaIndex:0}]},
  ]) {assert.throws(()=>a.deleteEquationSelection(wasm,ref));assert.throws(()=>a.setEquationSelectionProperties(wasm,ref,{}));assert.throws(()=>a.getEquationSelectionProperties(wasm,ref));}
  assert.equal(called,0);
});
test('body equation properties and deletion keep the body address',async()=>{
  const a=await api; const calls=[]; const wasm={getEquationProperties:(...args)=>calls.push(['get',...args]),setEquationProperties:(...args)=>calls.push(['set',...args]),deleteEquationControl:(...args)=>calls.push(['delete',...args])};
  const ref={sec:1,ppi:6,ci:3};a.getEquationSelectionProperties(wasm,ref);a.setEquationSelectionProperties(wasm,ref,{script:'x'});a.deleteEquationSelection(wasm,ref);
  assert.deepEqual(calls,[['get',1,6,3],['set',1,6,3,undefined,undefined,{script:'x'}],['delete',1,6,3]]);
});
