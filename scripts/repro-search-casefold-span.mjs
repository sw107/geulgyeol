// Diagnostic reproduction, intentionally records the unfixed search/replace mismatch.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const [engineArg,outArg]=process.argv.slice(2);assert(engineArg&&outArg,'ENGINE_DIR OUTPUT_DIR');fs.mkdirSync(outArg,{recursive:true});
const bytes=fs.readFileSync(path.resolve(engineArg,'rhwp_bg.wasm'));const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(engineArg,'rhwp.js')));initSync({module:bytes});
const examples=[
 {id:'expanded-query-deletes-ascii-neighbor',text:'İAB',query:'i\u0307a',expected:'QB'},
 {id:'expanded-query-deletes-emoji-neighbor',text:'İA😀TAIL',query:'i\u0307a',expected:'Q😀TAIL'},
 {id:'expanded-source-leaves-match-suffix',text:'i\u0307AB',query:'İA',expected:'QB'},
 {id:'ascii-control',text:'IAB',query:'ia',expected:'QB'},
];
const cases=[];const text=d=>d.getTextRange(0,0,0,d.getParagraphLength(0,0));
for(const example of examples)for(const api of ['replaceOne','replaceAll','replaceText']){
 const d=HwpDocument.createEmpty();let before,after;
 try{
  d.createBlankDocument();d.insertText(0,0,0,example.text);before=text(d);assert.equal(before,example.text);
  const hits=JSON.parse(d.searchAllText(example.query,false,false));assert.equal(hits.length,1);
  const hit=hits[0];const id=d.saveSnapshot();
  const result=JSON.parse(api==='replaceText'?d.replaceText(hit.sec,hit.para,hit.charOffset,hit.length,'Q'):d[api](example.query,'Q',false));assert.equal(result.ok,true);after=text(d);
  const files=[];
  for(const format of ['Hwp','Hwpx']){
   const exported=d['export'+format+'WithReport']();try{const report=JSON.parse(exported.contentLoss());assert.equal(report.count,0);const data=exported.takeBytes(),file=path.join(outArg,example.id+'-'+api+'.'+format.toLowerCase());fs.writeFileSync(file,data);const reopened=new HwpDocument(data);try{assert.equal(text(reopened),after);files.push({format,file,reopenedText:text(reopened),reportedContentLoss:report.count});}finally{reopened.free();}}finally{exported.free();}
  }
  d.restoreSnapshot(id);assert.equal(text(d),before);d.discardSnapshot(id);
  cases.push({...example,api,hit,before,actual:after,contentPreservationDefect:after!==example.expected,exportedWrongTextPersists:after!==example.expected,undoRestoresSource:true,files});
 }finally{d.free();}
}
const proof={engineSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),node:process.version,cases,total:cases.length,observedDefects:cases.filter(x=>x.contentPreservationDefect).length,controlPasses:cases.filter(x=>!x.contentPreservationDefect).length,allReopensPreserveObservedText:true,productionCodeChanged:false,GUIVerified:false,actualHancomUnicodeBehaviorVerified:false};fs.writeFileSync(path.join(outArg,'search-span-reproduction.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({total:proof.total,observedDefects:proof.observedDefects,controlPasses:proof.controlPasses}));
