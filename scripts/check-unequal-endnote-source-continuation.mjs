// Reusable engine-level acceptance gate. No app, pixel or Hancom claim.
// baseline|fixed NATIVE_RAW WASM_RAW FRESH_REPORT [CASE_NAME]
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [mode, nativePath, wasmPath, out, caseName='unequal-two'] = process.argv.slice(2);
assert(['baseline', 'fixed'].includes(mode));
const read = p => JSON.parse(fs.readFileSync(p));
const native = read(nativePath), wasm = read(wasmPath), rows = [], violations = [], warmColdGeometry=[];
const scalars = t => [...t];
const cases = x => x.rows.filter(r => r.case === caseName);
assert.deepEqual(cases(native).map(r => r.stage), ['before','grown','undo','redo']);
assert.deepEqual(cases(wasm).map(r => r.stage), ['before','grown','undo','redo']);
function nodes(v) { return v.pages.flatMap((p,page) => p.nodes.filter(n => n.para === 2).map(n => ({...n,page}))); }
function runtimeParity(w,n,tolerance=.051,sourceOffsets=false) {
  const ws=nodes(w),ns=nodes(n); assert.equal(ws.length,ns.length);
  for(const [i,wn] of ws.entries()) {
    const nn=ns[i];
    for(const k of ['kind','para','column','text','page']) assert.equal(wn[k],nn[k],k);
    // Existing public render JSON rounds coordinates to 0.1 px. Keep the
    // established 0.051 px serialization tolerance, without rounding data.
    for(const k of ['x','y','width','height']) assert(Math.abs(wn.bbox[k]-nn.bbox[k])<=tolerance,k);
    if(sourceOffsets)assert.equal(wn.start,nn.start,'source offset');
  }
}
function observe(v, reference, runtime, stage, variant) {
  const source = runtime === 'native' ? v.semantic.note[0].text : v.texts[0];
  assert.equal(source,reference.semantic.note[0].text,'source model preservation');
  const expected = '1) ' + source, chars = scalars(expected), ns = nodes(v);
  assert(ns.every(n => n.kind === 'TextRun'),'plain-text-only fixture');
  let next = 0, wrongSourceRuns = 0; const gaps = [], overlaps = [], bounds = [], frames = [];
  for (const n of ns) {
    // WASM starts index its emitted stream, not the original source. Never
    // use them as an oracle for a source hole. Native exposes char_start.
    if(runtime === 'native') {
      if(n.start > next) gaps.push([next,n.start]);
      if(n.start < next) overlaps.push([n.start,next]);
      if(chars.slice(n.start,n.start+scalars(n.text).length).join('') !== n.text) wrongSourceRuns++;
      next = n.start + scalars(n.text).length;
    }
    const info = v.pages[n.page].info, c = info.columns[n.column ?? 0], b = n.bbox;
    const frame = reference.items[n.page].bodyArea;
    if(b.x < c.x-.1 || b.x+b.width > c.x+c.width+.1 || b.y < frame.y-.1 || b.y+b.height > frame.y+frame.height+.1) bounds.push({page:n.page,column:n.column,bbox:b});
    const key=n.page+':'+n.column;
    let f=frames.find(f => f.key===key);
    if(!f){ f={key,page:n.page,column:n.column,width:c.width,renderedScalars:0};frames.push(f); }
    f.renderedScalars+=scalars(n.text).length;
    if(runtime==='native'){f.start??=n.start;f.end=n.start+scalars(n.text).length;}
  }
  if(runtime==='native' && next < chars.length) gaps.push([next,chars.length]);
  const rendered=ns.map(n=>n.text).join('');
  const cursorMismatches=(v.queries??[]).filter(q=>q.error||q.hit?.paragraphIndex!==2||q.hit?.charOffset!==q.offset+3).map(q=>({offset:q.offset,expectedRenderedOffset:q.offset+3,hit:q.hit?.charOffset,error:q.error}));
  const row={runtime,stage,variant,sourceScalars:scalars(source).length,expectedScalars:chars.length,renderedScalars:scalars(rendered).length,missingScalars:chars.length-scalars(rendered).length,exactText:rendered===expected,sourceGaps:runtime==='native'?gaps:null,sourceOverlaps:runtime==='native'?overlaps:null,wrongSourceRuns:runtime==='native'?wrongSourceRuns:null,boundsFailures:bounds.length,frames,cursorQueries:v.queries?.length??0,cursorMismatches};
  rows.push(row);
  if(mode==='baseline') {
    const long=stage==='grown'||stage==='redo';
    assert.equal(row.missingScalars,long?252:0);assert.equal(row.boundsFailures,long?171:0);
    assert.equal(row.sourceScalars,long?1448:8);
    if(runtime==='native'){assert.deepEqual(gaps,long?[[129,381]]:[]);assert.deepEqual(overlaps,[]);assert.equal(wrongSourceRuns,0);}
  } else {
    if(!row.exactText || row.boundsFailures || gaps.length || overlaps.length || wrongSourceRuns || cursorMismatches.length) violations.push({runtime,stage,variant,exactText:row.exactText,bounds:row.boundsFailures,gaps,overlaps,wrongSourceRuns,cursorMismatches});
  }
}
for(const n of cases(native)) {
  const w=cases(wasm).find(w=>w.stage===n.stage);
  assert.deepEqual(Object.keys(n.result).sort(),['cold','live','rebuilt']);
  assert.deepEqual(Object.keys(w.result).sort(),['cold','live']);
  for(const [variant,v] of Object.entries(n.result)) {
    const ns=nodes(v),live=nodes(n.result.live);assert.equal(ns.length,live.length);
    let coordinates=0,maxDelta=0;
    for(const [i,node] of ns.entries()) {
      for(const k of ['text','start','page','column'])assert.equal(node[k],live[i][k]);
      for(const k of ['x','y','width','height']) {const delta=Math.abs(node.bbox[k]-live[i].bbox[k]);if(delta>1e-9){coordinates++;maxDelta=Math.max(maxDelta,delta);}}
    }
    warmColdGeometry.push({stage:n.stage,variant,coordinates,maxDelta});
    if(mode==='baseline') {
      const known=variant==='cold'&&['grown','redo'].includes(n.stage);
      assert.equal(coordinates,known?140:0);assert(Math.abs(maxDelta-(known?12:0))<1e-9);
    } else if(coordinates) violations.push({stage:n.stage,variant,warmColdGeometry:{coordinates,maxDelta}});
    observe(v,n.result.live,'native',n.stage,variant);
  }
  for(const [variant,v] of Object.entries(w.result)) {
    runtimeParity(v,n.result[variant]);
    observe(v,n.result[variant],'wasm',n.stage,variant);
  }
}
for(const [a,b] of [['before','undo'],['grown','redo']]) for(const runtime of ['native','wasm']) {
  const all=cases(runtime==='native'?native:wasm);
  const av=all.find(r=>r.stage===a).result,bv=all.find(r=>r.stage===b).result;
  for(const variant of Object.keys(av)) {
    runtimeParity(av[variant],bv[variant],1e-9,runtime==='native');
    assert.deepEqual(runtime==='native'?av[variant].semantic:av[variant].texts,runtime==='native'?bv[variant].semantic:bv[variant].texts,'undo/redo source preservation');
  }
}
const report={mode,case:caseName,passed:violations.length===0,meaning:mode==='baseline'?'Known failure reproduced; NOT a fix pass.':'Candidate acceptance gate; all violations must be empty.',GUIVerified:false,HancomVerified:false,WASMSourceOffsetsExported:false,warmColdGeometry,rows,violations};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mode,passed:report.passed,snapshots:rows.length,violations:violations.length,meaning:report.meaning}));
if(violations.length) process.exitCode=1;
