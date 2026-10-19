// Synthetic engine observations. Does not launch an app or certify HWP interoperability.
// wasm PKG MANIFEST NATIVE_RAW FRESH_OUT | verify MANIFEST BASE_NATIVE FIXED_NATIVE BASE_WASM FIXED_WASM FRESH_PROOF
// verify-native MANIFEST BASE_NATIVE FIXED_NATIVE FRESH_PROOF (does not certify WASM)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [mode, ...args] = process.argv.slice(2), read = p => JSON.parse(fs.readFileSync(p)),
  sha = b => createHash('sha256').update(b).digest('hex');
function geometry(v) {
  const failures = [];
  for (const [page, p] of v.pages.entries()) for (const n of p.nodes) {
    const b = n.bbox, c = p.info.columns[n.column ?? 0], frame = v.items[page].bodyArea;
    if (b.x < c.x - .1 || b.x + b.width > c.x + c.width + .1 || b.y < frame.y - .1 || b.y + b.height > frame.y + frame.height + .1)
      failures.push({page, kind:n.kind, bbox:b});
  }
  return failures;
}
function renderOnly(v) {
  return v.pages.map(p => ({info:p.info, nodes:p.nodes.map(({font, baseline, ...n}) => n)}));
}
function assertRenderParity(w, n, canonicalSource) {
  assert.equal(w.pages.length,n.pages.length);
  const emitted=new Map(); let sourceStartMismatches=0;
  for(const [page,p]of w.pages.entries()){
    assert.deepEqual(p.info,n.pages[page].info);assert.equal(p.nodes.length,n.pages[page].nodes.length);
    for(const [i,t]of p.nodes.entries()){
      const nt=n.pages[page].nodes[i],start=emitted.get(nt.para)??0;
      assert.equal(t.kind,nt.kind);assert.equal(t.para,nt.para);assert.equal(t.column,nt.column);
      // WASM JSON omits char_start. Its start is derived from the EMITTED
      // stream, which cannot expose source holes in the legacy negative cases.
      assert.equal(t.start,start,'emitted-stream interval parity');
      if(t.kind==='TextRun'){
        assert.equal(t.text,nt.text);
        if(start!==nt.start)sourceStartMismatches++;
        if(canonicalSource)assert.equal(start,nt.start,'canonical source scalar interval');
      }
      emitted.set(nt.para,start+(t.kind==='TextRun'?[...nt.text].length:1));
      for(const k of ['x','y','width','height'])assert(Math.abs(t.bbox[k]-nt.bbox[k])<=.051,'Native/WASM render geometry');
    }
  }
  return sourceStartMismatches;
}
function coverageFailures(v){
  return v.semantic.note.flatMap((p,pi)=>{
    const text=v.pages.flatMap(p=>p.nodes).filter(n=>n.kind==='TextRun'&&n.para===2+pi).map(n=>n.text).join(''),expected=(pi===0?'1) ':'')+p.text;
    return text===expected?[]:[{notePara:pi,expectedChars:[...expected].length,renderedChars:[...text].length}];
  });
}
if (mode === 'wasm') {
  const [pkg, manifest, nativeFile, out] = args, fixtures = read(manifest), native = read(nativeFile), rows = [];
  fs.mkdirSync(out);
  const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
  M.initSync({module:fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))});
  for (const f of fixtures) {
    const bytes = fs.readFileSync(f.path); assert.equal(sha(bytes), f.sha256);
    const d = new M.HwpDocument(bytes);
    const view = (doc, stage) => {
      const template = native.rows.find(r => r.case === f.case && r.stage === stage).result.live;
      const bodyCount = doc.getParagraphCount(0), streams = new Map();
      const pages = Array.from({length:doc.pageCount()}, (_, page) => {
        const nodes = [];
        function walk(n, col, pi) {
          if (n.type === 'Column') col = n.col;
          if (n.type === 'TextLine') pi = n.pi ?? pi;
          pi = n.pi ?? pi;
          if ((n.type === 'TextRun' && pi >= bodyCount) || n.type === 'Equation') {
            const start = streams.get(pi) ?? 0;
            streams.set(pi, start + (n.type === 'Equation' ? 1 : [...n.text].length));
            nodes.push({kind:n.type, para:pi, column:col, start,
              ...(n.type === 'TextRun' ? {text:n.text} : {}),
              bbox:{x:n.bbox.x, y:n.bbox.y, width:n.bbox.w, height:n.bbox.h}});
          }
          for (const c of n.children ?? []) walk(c, col, pi);
        }
        walk(JSON.parse(doc.getPageRenderTree(page)), undefined, undefined);
        return {info:JSON.parse(doc.getPageInfo(page)), nodes};
      });
      const texts = JSON.parse(doc.getFootnoteInfo(0,0,2)).texts;
      const equations = template.semantic.note.flatMap((p, pi) => p.equations.map((_, ci) =>
        ({para:pi, control:ci, props:JSON.parse(doc.getNoteEquationProperties('endnote',0,0,2,pi,ci))})));
      const queries = template.queries.map(q => {
        const result = {source:q.source, offset:q.offset};
        try {
          result.rect = JSON.parse(doc.getCursorRectInNote(...q.source,q.offset));
          const r = result.rect;
          result.hit = JSON.parse(doc.hitTest(r.pageIndex,r.x,r.y+r.height*.5));
        } catch (e) { result.error=String(e); }
        return result;
      });
      return {body:Array.from({length:bodyCount},(_,p)=>doc.getTextRange(0,p,0,doc.getParagraphLength(0,p))), texts, equations, pages, queries};
    };
    const check = stage => {
      const live = view(d,stage), bytes = d.exportHwpx();
      fs.writeFileSync(path.join(out,`${f.case}-${stage}.hwpx`),bytes,{flag:'wx'});
      const cold = new M.HwpDocument(bytes);
      try { rows.push({case:f.case, stage, result:{live,cold:view(cold,stage)}}); } finally {cold.free();}
    };
    try {
      check('before'); const initial=d.saveSnapshot();
      for (const a of f.actions) d.insertTextInFootnote(a.section,a.para,a.control,a.notePara,0,a.text);
      check('grown'); const grown=d.saveSnapshot();
      d.restoreSnapshot(initial); check('undo'); d.restoreSnapshot(grown); check('redo');
      d.discardSnapshot(initial); d.discardSnapshot(grown);
    } finally {d.free();}
  }
  fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify({GUIVerified:false,wasmSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),rows}),{flag:'wx'});
  console.log(`WASM equation observations=${rows.length}`);
} else if (mode === 'verify' || mode === 'verify-native') {
  const nativeOnly=mode==='verify-native';
  const [manifest,bn,fn,bw,fw,fullOut] = args, out=nativeOnly?bw:fullOut,
    fixtures=read(manifest), base=read(bn), fixed=read(fn), baseW=nativeOnly?null:read(bw), fixedW=nativeOnly?null:read(fw), rows=[];
  let cursorChecks=0, equationChecks=0, knownEquationCursorGaps=0;
  const find=(raw,r)=>raw.rows.find(v=>v.case===r.case&&v.stage===r.stage);
  for (const r of fixed.rows) {
    const f=fixtures.find(f=>f.case===r.case), baseRow=find(base,r), w=nativeOnly?null:find(fixedW,r), oldW=nativeOnly?null:find(baseW,r), before=find(fixed,{case:r.case,stage:'before'}).result.live;
    const live=r.result.live, plain=new Set(live.semantic.note.flatMap((p,i)=>p.equations.length?[]:[i]));
    let baselineSourceStartMismatches=0;
    for (const [variant,v] of Object.entries(oldW?.result??{})) {
      const n=baseRow.result[variant];assert.deepEqual(v.body,n.semantic.body);assert.deepEqual(v.texts,n.semantic.note.map(p=>p.text));
      baselineSourceStartMismatches+=assertRenderParity(v,n,false);
      for(const nq of n.queries)assert.deepEqual(v.queries.find(q=>q.offset===nq.offset&&q.source[3]===nq.source[3]),nq,'baseline cursor API parity');
    }
    for (const [variant,v] of Object.entries(r.result)) {
      assert.deepEqual(v.semantic.body,before.semantic.body);
      for (const [pi,p] of v.semantic.note.entries()) {
        const original=before.semantic.note[pi], action=f.actions.find(a=>a.notePara===pi);
        assert.equal(p.text,(['grown','redo'].includes(r.stage)?action?.text??'':'')+original.text);
        assert.deepEqual(p.equations,original.equations);
        // Inserting source text at zero moves controls in that same paragraph.
        // The inline-mixed negative fixture exercises this existing model rule.
        const delta=['grown','redo'].includes(r.stage)?[...(action?.text??'')].length:0;
        assert.deepEqual(p.positions,original.positions.map(pos=>pos+delta));
      }
      if (!f.supported) {
        assert.deepEqual(renderOnly(v),renderOnly(baseRow.result[variant]),`negative render unchanged: ${r.case}/${variant}`);
        for (const q of baseRow.result[variant].queries) assert.deepEqual(v.queries.find(t=>t.offset===q.offset&&t.source[3]===q.source[3]),q);
        continue;
      }
      assert.equal(geometry(v).length,0,`${r.case}/${r.stage}/${variant} fits owner frame`);
      assert.deepEqual(coverageFailures(v),[],'all supported note text, including the static equation label, rendered once');
      assert.deepEqual(v,live,'supported live/cold/rebuilt identical');
      const nodes=v.pages.flatMap((p,page)=>p.nodes.map(n=>({...n,page}))), equations=nodes.filter(n=>n.kind==='Equation');
      assert.equal(equations.length,v.semantic.note.reduce((n,p)=>n+p.equations.length,0));
      for (const e of equations) {
        const np=e.note.note_para_index, source=v.semantic.note[np].equations[e.note.inner_control_index];
        assert.equal(e.script,source.script); assert.deepEqual([e.note.section_index,e.note.para_index,e.note.control_index,e.note.kind],[0,0,2,'endnote']);
        assert.equal(e.para,2+np); equationChecks++;
      }
      for (const pi of plain) {
        const runs=nodes.filter(n=>n.kind==='TextRun'&&n.para===2+pi), prefix=pi===0?'1) ':'';
        assert.equal(runs.map(n=>n.text).join(''),prefix+v.semantic.note[pi].text,'source text once');
        let next=0;for (const n of runs) {assert.equal(n.start,next);next += [...n.text].length;}
      }
      for (const q of v.queries) {
        const pi=q.source[3], offset=q.offset+(pi===0?3:0), runs=nodes.filter(n=>n.kind==='TextRun'&&n.para===2+pi);
        if (!plain.has(pi)) {
          if(q.offset===0){
            const prior=baseRow.result[variant].queries.find(t=>t.source[3]===pi&&t.offset===0);
            assert.equal(q.hit?.charOffset,prior.hit?.charOffset,'existing equation-slot cursor gap unchanged');
            if(q.hit?.charOffset!==0)knownEquationCursorGaps++;
          }
          continue;
        }
        const target=runs.find(n=>n.start===offset)??runs.find(n=>n.start<=offset&&offset<n.start+[...n.text].length)??runs.findLast(n=>n.start+[...n.text].length===offset);
        assert(target); const c=q.rect,b=target.bbox;
        assert(c&&!q.error); assert.equal(c.pageIndex,target.page);
        assert(Math.abs(c.y-(b.y+target.baseline-target.font*.8))<=.11,'render-derived caret y');
        assert(Math.abs(c.height-target.font)<=.11); assert(c.x>=b.x-.6&&c.x<=b.x+b.width+.6);
        if(offset===target.start)assert(Math.abs(c.x-b.x)<=.11);
        if(offset===target.start+[...target.text].length)assert(Math.abs(c.x-b.x-b.width)<=.6);
        assert.deepEqual([q.hit.sectionIndex,q.hit.paragraphIndex,q.hit.charOffset,q.hit.cursorRect.pageIndex],[0,2+pi,offset,target.page]);cursorChecks++;
      }
    }
    for (const [variant,v] of Object.entries(w?.result??{})) {
      const n=r.result[variant];assert.deepEqual(v.body,n.semantic.body);assert.deepEqual(v.texts,n.semantic.note.map(p=>p.text));
      assertRenderParity(v,n,f.supported);
      // Both architectures have the same existing object-slot cursor limitation.
      for(const q of v.queries){const nq=n.queries.find(t=>t.offset===q.offset&&t.source[3]===q.source[3]);assert.deepEqual(q,nq);}
      const old=oldW.result[variant]; assert.deepEqual(v.equations,old.equations,'full public equation properties preserved');
      if(f.supported)assert.deepEqual(v,w.result.live,'WASM supported live/cold identical');
      else assert.deepEqual(v,old,'unsupported WASM path unchanged');
    }
    rows.push({case:r.case,stage:r.stage,supported:f.supported,pages:live.pages.length,
      baselineGeometryFailures:geometry(baseRow.result.live).length,fixedGeometryFailures:geometry(live).length,
      baselineSourceStartMismatches,baselineRenderedCoverageFailures:coverageFailures(baseRow.result.live),fixedRenderedCoverageFailures:coverageFailures(live)});
  }
  const result={GUIVerified:false,WASMVerified:!nativeOnly,cases:fixtures.length,supportedCases:fixtures.filter(f=>f.supported).length,states:rows.length,cursorChecks,equationChecks,knownEquationCursorGaps,
    sourcePreserved:true,unsupportedPathsUnchanged:true,rows};
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,rows:undefined}));
} else throw Error('unknown mode');
