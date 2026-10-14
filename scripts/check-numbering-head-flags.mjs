// Real current WASM, synthetic input only; emitted files are immutable/deduplicated.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const [pkg,phase,out,mode]=process.argv.slice(2).map((v,i)=>i<3?path.resolve(v):v);assert(['baseline','fixed'].includes(mode));assert(!fs.existsSync(out));fs.mkdirSync(out);const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const sha=b=>createHash('sha256').update(b).digest('hex');
function emit(name,bytes){const p=path.join(out,name);assert(!fs.existsSync(p));for(const n of fs.readdirSync(out)){const old=path.join(out,n);if(fs.statSync(old).isFile()&&fs.readFileSync(old).equals(bytes)){fs.linkSync(old,p);return;}}fs.writeFileSync(p,bytes,{flag:'wx'});}
const state=d=>({text:d.getTextFileText(),props:Array.from({length:d.getParagraphCount(0)},(_,p)=>({para:JSON.parse(d.getParaPropertiesAt(0,p)),char:JSON.parse(d.getCharPropertiesAt(0,p,0))})),styles:JSON.parse(d.getStyleList()),numberings:JSON.parse(d.getNumberingList()),svg:Array.from({length:d.pageCount()},(_,p)=>sha(d.renderPageSvg(p))),printSvg:Array.from({length:d.pageCount()},(_,p)=>sha(d.renderPageSvgWithProfile(p,'print')))});
const rows=[];const fixture=JSON.parse(fs.readFileSync(path.join(phase,'fixtures/proof.json')));
for(const {name,expectedFlags,numberingId} of fixture.rows)for(const source of ['hwp','hwpx']){
 const input=source==='hwp'?path.join(phase,'baseline-native',name+'-input.hwp'):path.join(phase,'fixtures',name+'.hwpx');let d=new M.HwpDocument(fs.readFileSync(input));try{d.convertToEditable();const initial=state(d);assert.equal(initial.props.length,7);for(let p=0;p<7;p++){assert.equal(initial.props[p].para.headType,'Number');assert.equal(initial.props[p].para.paraLevel,p);assert.equal(initial.props[p].para.numberingId,numberingId);}
 const stages=[];for(const [index,target] of ['hwpx','hwp','hwpx','hwp','hwpx'].entries()){
  const bytes=Buffer.from(target==='hwp'?d.exportHwp():d.exportHwpx());const file=name+'-'+source+'-'+index+'.'+target;emit(file,bytes);d.free();d=new M.HwpDocument(bytes);d.convertToEditable();const s=state(d);assert.deepEqual(s,initial);stages.push({target,file,sha256:sha(bytes),textFormatAndAllSvgEqual:true});
 }
 rows.push({name,source,expectedFlags,numberingId,stages});
}finally{d.free();}}
const proof={mode,wasmSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),synthetic:true,rows,actualWasm:true,HancomVerified:false,GUIVerified:false};emit('proof.json',Buffer.from(JSON.stringify(proof,null,2)));console.log(JSON.stringify({mode,documentPaths:rows.length,saveReopens:30}));
