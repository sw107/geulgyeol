// Native or real WASM page geometry, master content and physical-address oracle.
// node scripts/check-inline-section-rendering.mjs native|wasm BINARY_OR_PKG STORAGE_FIXTURES FRESH_OUTPUT
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [mode, engine, fixtures, output] = process.argv.slice(2);
assert(['native', 'wasm'].includes(mode) && engine && fixtures && output);
fs.mkdirSync(output);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const source = JSON.parse(fs.readFileSync(path.join(fixtures, 'input-manifest.json'))).cases;
const labels = ['explicit-distinct', 'same-geometry', 'empty-first', 'single-empty-plus-physical',
  'shared-part', 'reversed-manifest', 'inline-plus-physical', 'pure-explicit-distinct',
  'pure-inline-plus-physical', 'control-sections-hwp', 'narrow-physical-control', 'late-column-owner'];
const cases = labels.map(label => {const row = source.find(r => r.label === label); assert(row); if(label==='late-column-owner'){row.expected[0].controls[0].columns=1;row.expected[0].controls[1].columns=2;} return row;});
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const runs = node => node ? walk(node).filter(n => n.type === 'TextRun' && n.text) : [];
const text = node => runs(node).map(n => n.text).join('');
const close = (a,b,message) => assert(Math.abs(a-b) <= 0.12, `${message}: ${a} != ${b}`);
const withoutSpaces = s => s.replace(/\s/gu, '');
let pageChecks = 0, hitChecks = 0, documents = 0, reopens = 0, restores = 0;
const rows = [];
function verify(dump, expected, label, strictBounds = true) {
  const body = expected.map(s => s.body.map(() => ''));
  for (const page of dump.pages) {
    const si = page.info.sectionIndex;
    assert(expected[si], label + ' physical section');
    const bodyNode = page.tree.children.find(n => n.type === 'Body');
    const visible = runs(bodyNode);
    assert(visible.length, label + ' has body content');
    const ownerFor = pi => expected[si].controls.filter(c => c.para <= pi).at(-1);
    const owner = ownerFor(visible[0].pi);
    assert(owner, label + ' direct logical owner');
    close(page.info.width, owner.width / 75, label + ' page info width');
    if(owner.columns)assert.equal(page.info.columns.length,owner.columns,label+' logical columns');
    close(page.tree.bbox.w, owner.width / 75, label + ' render-tree width');
    for (const run of visible) {
      assert.equal(ownerFor(run.pi).para, owner.para, label + ' owner must agree across page');
      assert(run.pi >= 0 && run.pi < body[si].length, label + ' physical paragraph address');
      body[si][run.pi] += run.text;
      if (strictBounds) {
        assert(run.bbox.x >= page.info.bodyLeft - 0.2, label + ' left text bound');
        assert(run.bbox.x + run.bbox.w <= page.info.bodyRight + 0.7, label + ' right text bound');
      }
    }
    const master = page.tree.children.find(n => n.type === 'MasterPage');
    assert.equal(withoutSpaces(text(master)), withoutSpaces(owner.masters.map(m => m.text).join('')), label + ' master owner');
    if (page.svg) {
      const width = Number(page.svg.match(/<svg\b[^>]*\bwidth="([^"]+)"/)[1]);
      close(width, owner.width / 75, label + ' SVG width');
    }
    pageChecks++;
  }
  for (let si=0; si<body.length; si++) for (let pi=0; pi<body[si].length; pi++) {
    assert.equal(withoutSpaces(body[si][pi]), withoutSpaces(expected[si].body[pi]), label + ' rendered body');
  }
  for (const cursor of dump.cursors) {
    assert.equal(cursor.hit.sectionIndex, cursor.section, label + ' hit section');
    assert.equal(cursor.hit.paragraphIndex, cursor.para, label + ' hit paragraph');
    assert.equal(cursor.hit.charOffset, 0, label + ' hit start offset');
    assert(dump.pages.some(p => p.page === cursor.rect.pageIndex), label + ' cursor page');
    hitChecks++;
  }
  if (dump.model) assert.deepEqual(dump.model.map(s => s.body), expected.map(s => s.body));
  documents++;
  rows.push({label,pages:dump.pages.length,widths:dump.pages.map(p=>p.info.width)});
}
const staged = path.join(output, 'inputs'); fs.mkdirSync(staged);
const stages = [];
for (const row of cases) {
  assert.equal(sha(fs.readFileSync(row.path)), row.sha256);
  const add = (name, original, expected) => {
    const file = path.join(staged, name + path.extname(original));
    fs.copyFileSync(original,file,fs.constants.COPYFILE_EXCL);
    stages.push({name,file,expected,sha256:sha(fs.readFileSync(file))});
  };
  add(row.label + '-input', row.path, row.expected);
  if (mode === 'native') for (const edited of [false,true]) for (const format of ['hwp','hwpx']) {
    const expected = structuredClone(format === 'hwp' && row.expectedHwp ? row.expectedHwp : row.expected);
    if (edited) expected.at(-1).body[expected.at(-1).body.length-1] += ' EDIT';
    const name = `${row.label}${edited?'-edited':''}-${format}`;
    const file = path.join(fixtures,'native',`${row.label}${edited?'-edited':''}-export.${format}`);
    add(name,file,expected);
  }
}
const original = cases.find(r => r.label === 'explicit-distinct');
const physical = cases.find(r => r.label === 'narrow-physical-control');
const longText = ' 가나다라 abcdef '.repeat(400);
function expectations(row) {
  const long=structuredClone(row.expected);long[0].body[1]+=longText;
  const split=structuredClone(long);
  split[0].body.splice(0,1,split[0].body[0].slice(0,3),split[0].body[0].slice(3));
  for(const owner of split[0].controls)if(owner.para>0)owner.para++;
  return {long,split};
}
function lineSignature(dump, pi) {
  return dump.pages.flatMap(page=>walk(page.tree.children.find(n=>n.type==='Body'))
    .filter(n=>n.type==='TextLine'&&n.pi===pi));
}
let physicalEquivalenceChecks=0;
if (mode === 'native') {
  const run = (args, log) => {
    const result=spawnSync(engine,args,{encoding:'utf8'});
    fs.writeFileSync(path.join(output,log),(result.stdout??'')+(result.stderr??''),{flag:'wx'});
    assert.equal(result.status,0,log);
  };
  const rendered=path.join(output,'rendered');
  run(['render',rendered,...stages.map(s=>s.file)],'render.log');
  for (const stage of stages) {
    const dump=JSON.parse(fs.readFileSync(path.join(rendered,stage.name+'-render.json')));
    for (const page of dump.pages) page.svg=fs.readFileSync(path.join(rendered,`${stage.name}-${page.page}.svg`),'utf8');
    verify(dump,stage.expected,stage.name);
    assert.equal(sha(fs.readFileSync(stage.file)),stage.sha256);
  }
  const edits=[];
  reopens=stages.length-cases.length;
  for(const [prefix,row] of [['inline',original],['physical',physical]]) {
    const edit=path.join(output,prefix+'-edit'), wanted=expectations(row), captured={};
    run(['render-edit',edit,row.path],prefix+'-edit.log');
    for(const [name,expected] of [['long',wanted.long],['long-hwp',wanted.long],['long-hwpx',wanted.long],
      ['split',wanted.split],['split-hwp',wanted.split],['split-hwpx',wanted.split],['undo',row.expected],['redo',wanted.long]]) {
      const dump=JSON.parse(fs.readFileSync(path.join(edit,name+'-render.json')));
      for(const page of dump.pages)page.svg=fs.readFileSync(path.join(edit,`${name}-${page.page}.svg`),'utf8');
      verify(dump,expected,prefix+'-'+name,false);
      if(name==='long')assert(dump.pages.length>2,'long body must continue onto another page');
      captured[name]=dump;
    }
    const counts=JSON.parse(fs.readFileSync(path.join(edit,'edit-counts.json')));
    reopens+=counts.reopens; restores+=counts.snapshotRestores; edits.push(captured);
  }
  for(const name of ['long','long-hwp','long-hwpx','split','split-hwp','split-hwpx','redo']) {
    const pi=name.startsWith('split')?2:1;
    assert.deepEqual(lineSignature(edits[0][name],pi),lineSignature(edits[1][name],pi),name+' physical-root line geometry');
    physicalEquivalenceChecks++;
  }
} else {
  const wasm=fs.readFileSync(path.join(engine,'rhwp_bg.wasm'));
  const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(engine,'rhwp.js')));initSync({module:wasm});
  function capture(d,expected,label,strictBounds=true) {
    const pages=Array.from({length:d.pageCount()},(_,page)=>({page,info:JSON.parse(d.getPageInfo(page)),tree:JSON.parse(d.getPageRenderTree(page)),svg:d.renderPageSvg(page)}));
    const cursors=expected.flatMap((s,si)=>s.body.flatMap((b,pi)=>{
      if(!b)return [];
      const rect=JSON.parse(d.getCursorRect(si,pi,0));
      return [{section:si,para:pi,rect,hit:JSON.parse(d.hitTest(rect.pageIndex,rect.x+0.1,rect.y+rect.height/2))}];
    }));
    const dump={pages,cursors};verify(dump,expected,label,strictBounds);
    fs.writeFileSync(path.join(output,label+'-render.json'),JSON.stringify(dump,null,2)+'\n',{flag:'wx'});
    return {text:d.getTextFileText(),hwp:sha(d.exportHwp()),hwpx:sha(d.exportHwpx()),pages:pages.map(p=>({info:p.info,svgSHA256:sha(p.svg)})),cursors,render:dump};
  }
  for (const row of cases) {
    const d=new HwpDocument(fs.readFileSync(row.path));
    try {
      const before=capture(d,row.expected,row.label+'-input'),undo=d.saveSnapshot();
      for(const edited of [false,true]) {
        const expected=structuredClone(row.expected);
        if(edited) { const si=expected.length-1,pi=expected[si].body.length-1;d.insertText(si,pi,d.getParagraphLength(si,pi),' EDIT');expected[si].body[pi]+=' EDIT'; }
        for(const format of ['hwp','hwpx']) {
          const wanted=structuredClone(format==='hwp'&&row.expectedHwp?row.expectedHwp:expected);
          if(edited&&format==='hwp'&&row.expectedHwp)wanted.at(-1).body[wanted.at(-1).body.length-1]+=' EDIT';
          const bytes=d[format==='hwp'?'exportHwp':'exportHwpx']();
          const label=`${row.label}${edited?'-edited':''}-${format}`;
          fs.writeFileSync(path.join(output,label+'.'+format),bytes,{flag:'wx'});
          const r=new HwpDocument(bytes);try{capture(r,wanted,label);reopens++;}finally{r.free();}
        }
      }
      const afterExpected=structuredClone(row.expected);afterExpected.at(-1).body[afterExpected.at(-1).body.length-1]+=' EDIT';
      const after=capture(d,afterExpected,row.label+'-after');
      const redo=d.saveSnapshot();
      try{d.restoreSnapshot(undo);assert.deepEqual(capture(d,row.expected,row.label+'-undo'),before);restores++;
        const expected=structuredClone(row.expected);expected.at(-1).body[expected.at(-1).body.length-1]+=' EDIT';
        d.restoreSnapshot(redo);assert.deepEqual(capture(d,expected,row.label+'-redo'),after);restores++;
      }finally{d.discardSnapshot(undo);d.discardSnapshot(redo);}
    }finally{d.free();}
  }
  const edits=[];
  for(const [prefix,row] of [['inline',original],['physical',physical]]) {
    const d=new HwpDocument(fs.readFileSync(row.path)),wanted=expectations(row),captured={};
    try{
      const before=capture(d,row.expected,prefix+'-long-before'),undo=d.saveSnapshot();
      d.insertText(0,1,d.getParagraphLength(0,1),longText);
      const long=capture(d,wanted.long,prefix+'-long',false),redo=d.saveSnapshot();captured.long=long.render;
      assert(long.pages.length>2,'long body continuation must span another page');
      for(const [name,expected,split] of [['long',wanted.long,false],['split',wanted.split,true]]){
        if(split){d.splitParagraph(0,0,3);captured.split=capture(d,expected,prefix+'-split',false).render;}
        for(const format of ['hwp','hwpx']){
          const bytes=d[format==='hwp'?'exportHwp':'exportHwpx']();fs.writeFileSync(path.join(output,prefix+'-'+name+'.'+format),bytes,{flag:'wx'});
          const r=new HwpDocument(bytes);try{captured[name+'-'+format]=capture(r,expected,prefix+'-'+name+'-'+format,false).render;reopens++;}finally{r.free();}
        }
      }
      d.restoreSnapshot(undo);assert.deepEqual(capture(d,row.expected,prefix+'-long-undo'),before);restores++;
      d.restoreSnapshot(redo);assert.deepEqual(capture(d,wanted.long,prefix+'-long-redo',false),long);restores++;
      d.discardSnapshot(undo);d.discardSnapshot(redo);edits.push(captured);
    }finally{d.free();}
  }
  for(const name of ['long','long-hwp','long-hwpx','split','split-hwp','split-hwpx']) {
    const pi=name.startsWith('split')?2:1;
    assert.deepEqual(lineSignature(edits[0][name],pi),lineSignature(edits[1][name],pi),name+' physical-root line geometry');
    physicalEquivalenceChecks++;
  }
}
for(const row of cases)assert.equal(sha(fs.readFileSync(row.path)),row.sha256);
const proof={mode,documents,pageChecks,hitChecks,reopens,snapshotRestores:restores,physicalEquivalenceChecks,fixtures:cases.length,rows,
  longTextMetricScope:'Long line geometry must equal a same-width physical-root control. Existing shared font-metric overhang is not repaired or certified here.',
  engineSHA256:sha(fs.readFileSync(mode==='native'?engine:path.join(engine,'rhwp_bg.wasm'))),GUIVerified:false};
fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...proof,rows:rows.length}));
