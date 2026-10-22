// Real SDK + current commands/history/bridge, synthetic public-factory documents.
// node scripts/check-delete-undo-scalar.mjs fixed PKG FRESH_OUT [SOURCE_ROOT]
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import crypto from'node:crypto';import{pathToFileURL}from'node:url';
import{loadTextCommandQA}from'./lib/text-command-qa.mjs';
const[mode,pkg,out,root=process.cwd()]=process.argv.slice(2);assert(['baseline','fixed'].includes(mode));fs.mkdirSync(out);
const{commands:C,CommandHistory,Bridge}=loadTextCommandQA(root),j=JSON.parse,wasm=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm')),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:wasm});const rows=[],issues=[];let saves=0,reopens=0;
for(const context of['body','cell'])for(const direction of['backward','forward'])for(const payload of['A','가','🙂','𐐀','가🙂𐐀','e\u0301','👩‍💻','🙂🙂']){
 const d=M.HwpDocument.createEmpty();d.createBlankDocument();const name=context+'-'+direction+'-'+rows.length,initial='앞'+payload+'뒤',scalarLength=[...payload].length;
 let position={sectionIndex:0,paragraphIndex:0,charOffset:1},table;
 if(context==='body')d.insertText(0,0,0,initial);
 else {table=j(d.createTable(0,0,0,1,2));d.insertTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,initial);d.insertTextInCell(0,table.paraIdx,table.controlIdx,1,0,0,'다른 셀 보존🙂');position={...position,paragraphIndex:0,parentParaIndex:table.paraIdx,controlIndex:table.controlIdx,cellIndex:0,cellParaIndex:0,cellPath:[{controlIndex:table.controlIdx,cellIndex:0,cellParaIndex:0}]};}
 const h=new CommandHistory(),w=new Bridge(d),row={name,context,direction,payload,scalarLength,position,stages:[]};
 const text=x=>context==='body'?x.getTextRange(0,0,0,100):x.getTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,100);
 const view=x=>({text:text(x),fields:j(x.getFieldList()),body:Array.from({length:x.getParagraphCount(0)},(_,i)=>x.getTextRange(0,i,0,100)),sibling:table?x.getTextInCell(0,table.paraIdx,table.controlIdx,1,0,0,100):null});
 function equal(actual,expected,label){if(JSON.stringify(actual)===JSON.stringify(expected))return;issues.push({case:name,label,actual,expected});if(mode==='fixed')assert.deepEqual(actual,expected,name+' '+label);}
 function check(label,cursor,expectedText){equal(text(d),expectedText,label+' text');const v=view(d),outputs=[];
  for(const ext of['Hwp','Hwpx']){const bytes=d['export'+ext](),file=path.join(out,name+'-'+label+'.'+ext.toLowerCase());fs.writeFileSync(file,bytes,{flag:'wx'});saves++;const r=new M.HwpDocument(bytes);try{assert.deepEqual(view(r),v,'same-process reopen preserves actual model');reopens++;}finally{r.free()}outputs.push({format:ext,file,sha256:sha(bytes)});}
  row.stages.push({label,cursor,view:v,outputs});
 }
 try{
  check('before',position,initial);
  for(let i=0;i<scalarLength;i++){const at=direction==='backward'?scalarLength-i:1;h.execute(new C.DeleteTextCommand({...position,charOffset:at},1,direction,undefined,1000+i*30),w);}
  check('deleted',position,'앞뒤');let undone=h.undo(w);equal(undone.charOffset,1+scalarLength,'undo scalar caret');assert(!h.canUndo(),'fast consecutive deletions merge into one undo step');check('undo',undone,initial);
  const redone=h.redo(w);check('redo',redone,'앞뒤');undone=h.undo(w);equal(undone.charOffset,1+scalarLength,'second undo scalar caret');check('undo-again',undone,initial);
  let typed;try{typed=h.execute(new C.InsertTextCommand(undone,'X',5000),w);}catch(e){issues.push({case:name,label:'typing after undo',error:String(e)});if(mode==='fixed')throw e;row.typingError=String(e);continue;}
  check('typed',typed,'앞'+payload+'X뒤');assert(!h.canRedo());h.undo(w);check('typed-undo',undone,initial);typed=h.redo(w);check('typed-redo',typed,'앞'+payload+'X뒤');
 }finally{h.clear(w);d.free();rows.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({rows,issues}));}
}
if(mode==='baseline')assert(issues.length>0,'must reproduce old caret defect');
const result={mode,cases:rows.length,states:rows.reduce((n,r)=>n+r.stages.length,0),saves,reopens,issueCount:issues.length,issues,GUIVerified:false,physicalIMEVerified:false,WASMSHA256:sha(wasm),commandSourceSHA256:sha(fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'))),rows};fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined,issues:undefined}));
