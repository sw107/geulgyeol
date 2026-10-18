// Engine-only regression: rejected replacement must not consume source text.
// node scripts/check-comment-single-replace-preflight.mjs ENGINE_PKG FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const [pkg,output,mode]=process.argv.slice(2);
assert(pkg&&output&&['baseline','fixed'].includes(mode));
fs.mkdirSync(output);
const wasm=fs.readFileSync(path.resolve(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));
initSync({module:wasm});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const text=d=>d.getTextRange(0,0,0,d.getParagraphLength(0,0));
const original='앞😀 needle 뒤 보존';
const positions=[{id:'before',at:0,query:'앞'},{id:'inside',at:3,query:'needle'},{id:'after',at:10,query:'뒤'}];
function fixture(){
  const d=HwpDocument.createEmpty();
  d.createBlankDocument();d.insertText(0,0,0,original);
  assert.equal(JSON.parse(d.insertBodyComment(0,0,3,9,'주석 내용 보존😀')).ok,true);
  return d;
}
function state(d){return {text:text(d),hwp:sha(d.exportHwp()),hwpx:sha(d.exportHwpx()),svg:sha(d.renderPageSvg(0))};}
const rows=[];
for(const inputFormat of ['Hwp','Hwpx'])for(const api of ['replaceText','replaceOne'])for(const position of positions)
for(const replacement of ['\n','\r','\r\n','Q','','긴문구😀']){
  const seed=fixture();let bytes;try{bytes=seed['export'+inputFormat]();}finally{seed.free();}
  const d=new HwpDocument(bytes);
  const rejected=/[\r\n]/u.test(replacement),label=`${inputFormat}-${api}-${position.id}-${rows.length}`;
  try{
    const before=state(d),undo=d.saveSnapshot();let error,result;
    try{result=JSON.parse(api==='replaceText'?d.replaceText(0,0,position.at,[...position.query].length,replacement):d.replaceOne(position.query,replacement,true));}
    catch(e){error=String(e);}
    const after=state(d);
    let expected=original;
    if(rejected){assert.match(error??'',/주석 본문에 줄바꿈/u);}
    else{
      assert.equal(error,undefined);assert.equal(result.ok,true);
      const chars=[...original];chars.splice(position.at,[...position.query].length,...replacement);expected=chars.join('');
      assert.equal(after.text,expected);
    }
    const unchanged=JSON.stringify(before)===JSON.stringify(after);
    const defect=rejected&&!unchanged;
    if(mode==='fixed'&&rejected)assert.deepEqual(after,before,label);
    const files=[];
    for(const format of ['Hwp','Hwpx']){
      const exported=d['export'+format+'WithReport']();let data,loss;
      try{loss=JSON.parse(exported.contentLoss());data=exported.takeBytes();}finally{exported.free();}
      assert.equal(loss.count,0);
      const file=path.join(output,label+'.'+format.toLowerCase());fs.writeFileSync(file,data,{flag:'wx'});
      const reopened=new HwpDocument(data);
      try{
        assert.equal(text(reopened),after.text);
        if(mode==='fixed')assert.equal(text(reopened),expected);
        // Reopened comments remain actual MEMO fields, not only visible text.
        const commentOffset=JSON.parse(reopened.searchAllText(rejected?'needle':position.id==='inside'?replacement||' 뒤':'needle',true,false))[0]?.charOffset;
        if(commentOffset!==undefined&&position.id!=='inside')assert.equal(JSON.parse(reopened.getBodyCommentAt(0,0,commentOffset)).ok,true);
      }finally{reopened.free();}
      files.push({format,path:file,sha256:sha(data),reportedContentLoss:loss.count});
    }
    const redo=d.saveSnapshot();
    try{d.restoreSnapshot(undo);assert.deepEqual(state(d),before,label+' undo');d.restoreSnapshot(redo);assert.deepEqual(state(d),after,label+' redo');}
    finally{d.discardSnapshot(undo);d.discardSnapshot(redo);}
    rows.push({label,inputFormat,api,position:position.id,replacement,rejected,error,before,after,unchanged,defect,files});
  }finally{d.free();}
}
let controls=0;
for(const api of ['replaceText','replaceOne'])for(const replacement of ['\n','\r','\r\n']){
  const d=HwpDocument.createEmpty();
  try{
    d.createBlankDocument();d.insertText(0,0,0,original);
    const result=JSON.parse(api==='replaceText'?d.replaceText(0,0,3,6,replacement):d.replaceOne('needle',replacement,true));
    assert.equal(result.ok,true);
    assert.equal(text(d),original.replace('needle',replacement));
    controls++;
  }finally{d.free();}
}
{
  const d=fixture();
  try{
    const before=state(d);
    assert.equal(JSON.parse(d.replaceOne('NOT_PRESENT','\n',true)).ok,false);
    assert.deepEqual(state(d),before);controls++;
    assert.throws(()=>d.replaceText(99,0,0,1,'\n'));
    assert.deepEqual(state(d),before);controls++;
  }finally{d.free();}
}
const proof={mode,engineSHA256:sha(wasm),cases:rows.length,controls,rejections:rows.filter(r=>r.rejected).length,
  successes:rows.filter(r=>!r.rejected).length,observedDefects:rows.filter(r=>r.defect).length,
  reopens:rows.length*2,snapshotRestores:rows.length*2,rows,
  limits:['Headless WASM engine only; no native app, physical input, UI history or Hancom validation.',
    'Scope is the existing single body replacement APIs; Replace All policy is unchanged.']};
fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mode,cases:proof.cases,controls,rejections:proof.rejections,successes:proof.successes,observedDefects:proof.observedDefects,reopens:proof.reopens}));
if(mode==='baseline')assert.equal(proof.observedDefects,36);
