// Real WASM exports, synthetic Native fixtures and document-order occurrences.
// node scripts/check-named-field-occurrence.mjs ENGINE_PKG NATIVE_FIXTURES FRESH_OUTPUT
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [pkg,fixtures,output]=process.argv.slice(2);assert(pkg&&fixtures&&output);fs.mkdirSync(output);
const wasm=fs.readFileSync(path.resolve(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));initSync({module:wasm});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fields=d=>JSON.parse(d.getFieldList()).filter(f=>f.name==='중복');
const values=d=>fields(d).map(f=>f.value);
const state=d=>({fields:JSON.parse(d.getFieldList()),hwp:sha(d.exportHwp()),hwpx:sha(d.exportHwpx()),svg:Array.from({length:d.pageCount()},(_,i)=>sha(d.renderPageSvg(i)))});
const source=JSON.parse(fs.readFileSync(path.join(fixtures,'proof.json')));
const rows=[];let reopens=0,restores=0,rejections=0,readChecks=0,legacyChecks=0,protectedChecks=0;
const invalid=[['undefined',undefined],['null',null],['string','1'],['boolean',true],['array',[]],['array-number',[1]],['object',{}],['boxed-number',new Number(1)],['NaN',NaN],['Infinity',Infinity],['negative-infinity',-Infinity],['negative',-1],['fraction',1.5],['u32-overflow',2**32],['safe-integer-overflow',Number.MAX_SAFE_INTEGER],['bigint',1n],['symbol',Symbol('index')],['function',()=>1]];
for(const fixture of source.fixtures){
  const bytes=fs.readFileSync(fixture.path),original=fixture.values;
  for(const occurrence of [0,Math.floor(original.length/2),original.length-1])for(const replacement of ['순번 새값😀','','한글 "인용" \\ 값']){
    const d=new HwpDocument(bytes),label=`${fixture.kind}-${fixture.format}-${rows.length}`;
    try{
      const before=state(d),list=fields(d);
      assert.equal(typeof d.getFieldValueByNameAt,'function');assert.equal(typeof d.setFieldValueByNameAt,'function');
      for(let i=0;i<original.length;i++){
        const got=JSON.parse(d.getFieldValueByNameAt('중복',i));assert.equal(got.ok,true);assert.equal(got.value,original[i]);assert.equal(got.fieldId,list[i].fieldId);readChecks++;
      }
      assert.deepEqual(state(d),before);
      const undo=d.saveSnapshot();const result=JSON.parse(d.setFieldValueByNameAt('중복',occurrence,replacement));
      assert.equal(result.ok,true);assert.equal(result.fieldId,list[occurrence].fieldId);assert.equal(result.oldValue,original[occurrence]);assert.equal(result.newValue,replacement);
      const expected=[...original];expected[occurrence]=replacement;assert.deepEqual(values(d),expected);
      const saved=[];
      for(const format of ['Hwp','Hwpx']){
        const exp=d['export'+format+'WithReport']();let data,loss;
        try{loss=JSON.parse(exp.contentLoss());data=exp.takeBytes();}finally{exp.free();}assert.equal(loss.count,0);
        const file=path.join(output,`${label}.${format.toLowerCase()}`);fs.writeFileSync(file,data,{flag:'wx'});
        const r=new HwpDocument(data);
        try{
          assert.deepEqual(values(r),expected);assert.equal(JSON.parse(r.getFieldValueByNameAt('중복',occurrence)).value,replacement);reopens++;
          assert.equal(JSON.parse(r.setFieldValueByNameAt('중복',occurrence,'재편집😀')).ok,true);
          const again=[...expected];again[occurrence]='재편집😀';assert.deepEqual(values(r),again);
          const redone=r['export'+format](),reeditFile=path.join(output,`${label}-reedit.${format.toLowerCase()}`);fs.writeFileSync(reeditFile,redone,{flag:'wx'});
          const rr=new HwpDocument(redone);try{assert.deepEqual(values(rr),again);reopens++;}finally{rr.free();}
          saved.push({format,file,sha256:sha(data),reeditFile,reeditSHA256:sha(redone)});
        }finally{r.free();}
      }
      const after=state(d),redo=d.saveSnapshot();try{d.restoreSnapshot(undo);assert.deepEqual(state(d),before);restores++;d.restoreSnapshot(redo);assert.deepEqual(state(d),after);restores++;}finally{d.discardSnapshot(undo);d.discardSnapshot(redo);}
      rows.push({label,kind:fixture.kind,inputFormat:fixture.format,occurrence,replacement,expected,saved});
    }finally{d.free();}
  }
  const d=new HwpDocument(bytes);
  try{
    const before=state(d);
    const reject=(name,index)=>{
      assert.throws(()=>d.getFieldValueByNameAt(name,index));assert.deepEqual(state(d),before);rejections++;
      assert.throws(()=>d.setFieldValueByNameAt(name,index,'잘못된 쓰기'));assert.deepEqual(state(d),before);rejections++;
    };
    for(const [,index] of invalid)reject('중복',index);
    let coerced=0;reject('중복',{valueOf(){coerced++;return 1;}});assert.equal(coerced,0);
    for(const [name,index] of [['중복',original.length],['중복',4294967295],['없는 이름',0],['중복{{1}}',0]])reject(name,index);
    assert.equal(JSON.parse(d.getFieldValueByName('중복')).value,original[0]);assert.equal(JSON.parse(d.getFieldValueByNameAt('중복',-0)).value,original[0]);
    assert.equal(JSON.parse(d.setFieldValueByName('중복','기존 첫 일치')).ok,true);const expected=[...original];expected[0]='기존 첫 일치';assert.deepEqual(values(d),expected);legacyChecks++;
  }finally{d.free();}
  if(fixture.kind==='cells'){
    const d=new HwpDocument(bytes);
    try{
      const f=fields(d)[0],cell=f.location.path[0];
      assert.equal(JSON.parse(d.insertClickHereFieldInCell(f.location.sectionIndex,f.location.paraIndex,cell.controlIndex,cell.cellIndex,cell.paraIndex,0,false,'안내','','안쪽 보호',true)).ok,true);
      const before=state(d);assert.throws(()=>d.setFieldValueByNameAt('중복',0,'겹친 필드 덮어쓰기'));assert.deepEqual(state(d),before);protectedChecks++;
    }finally{d.free();}
  }
}
const proof={engineSHA256:sha(wasm),cases:rows.length,readChecks,rejections,legacyChecks,protectedChecks,reopens,snapshotRestores:restores,rows,
  limits:['Engine-only SDK API; no OCX token routing, source UI or native Hancom claim.','Occurrence order is the current document getFieldList order. Callers must refresh it after structural edits.']};
fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:rows.length,readChecks,rejections,legacyChecks,protectedChecks,reopens,snapshotRestores:restores}));
