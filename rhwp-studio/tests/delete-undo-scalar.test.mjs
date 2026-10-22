// Actual production commands/history/Undo routing; in-memory scalar API oracle.
// Real WASM save/reopen coverage is scripts/check-delete-undo-scalar.mjs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTextCommandQA} from '../../scripts/lib/text-command-qa.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {commands:C,CommandHistory,UndoHost}=loadTextCommandQA(root);
const corpus=[['A',1],['가',1],['🙂',1],['𐐀',1],['가🙂𐐀',3],['e\u0301',2],['👩‍💻',3],['🙂🙂',2]];
for(const context of ['body','cell','nested'])for(const direction of ['forward','backward'])for(const [payload,count]of corpus){
 test(`${context} ${direction} ${JSON.stringify(payload)} undo restores scalar caret and insertion`,()=>{
  let text='앞'+payload+'뒤',pos={sectionIndex:0,paragraphIndex:0,charOffset:1};const events=[];
  if(context!=='body')pos={...pos,parentParaIndex:0,controlIndex:2,cellIndex:0,cellParaIndex:0,cellPath:[{controlIndex:2,cellIndex:0,cellParaIndex:0},...(context==='nested'?[{controlIndex:0,cellIndex:0,cellParaIndex:0}]:[])]};
  const replace=(at,n,s)=>{const chars=[...text];assert(at>=0&&at+n<=chars.length);text=chars.slice(0,at).join('')+s+chars.slice(at+n).join('');return {ok:true,charOffset:at+[...s].length,documentPaginationPending:false,flowChanged:true,paginationDeferred:false};};
  const w={getTextRange:(_s,_p,a,n)=>[...text].slice(a,a+n).join(''),insertText:(_s,_p,a,s)=>replace(a,0,s),deleteText:(_s,_p,a,n)=>replace(a,n,''),replaceBodyTextLocal:(_s,_p,a,n,s)=>replace(a,n,s),getTextInCell:(_s,_p,_ci,_cell,_pi,a,n)=>[...text].slice(a,a+n).join(''),insertTextInCell:(_s,_p,_ci,_cell,_pi,a,s)=>replace(a,0,s),deleteTextInCell:(_s,_p,_ci,_cell,_pi,a,n)=>replace(a,n,''),insertTextInCellDeferredPagination:(_s,_p,_ci,_cell,_pi,a,s)=>replace(a,0,s),deleteTextInCellDeferredPagination:(_s,_p,_ci,_cell,_pi,a,n)=>replace(a,n,''),getTextInCellByPath:(_s,_p,_path,a,n)=>[...text].slice(a,a+n).join(''),insertTextInCellByPath:(_s,_p,_path,a,s)=>replace(a,0,s),deleteTextInCellByPath:(_s,_p,_path,a,n)=>replace(a,n,'')};
  const h=new CommandHistory(),host=new UndoHost();Object.assign(host,{history:h,wasm:w,cursor:{isInHeaderFooter:()=>false,isInFootnote:()=>false,moveTo:p=>{pos=p;events.push(p.charOffset);}},clearPendingFootnoteCharShape(){},flushDeferredPaginationIfNeeded(){},prepareTextMutationBeforeCursor(){return false;},clearTableResizeRuntimeCache(){},resetDerivedStateAfterHistoryJump(){},restoreSelectionAfterUndo(){},restoreSelectionAfterRedo(){},caretLayoutReveal:{requestFor(){}},afterEdit(){}});
  for(let i=0;i<count;i++)h.execute(new C.DeleteTextCommand({...pos,charOffset:direction==='backward'?count-i:1},1,direction,undefined,1000+i*30),w);
  assert.equal(text,'앞뒤');host.handleUndo();assert.equal(text,'앞'+payload+'뒤');assert.equal(pos.charOffset,1+count);assert.equal(events.at(-1),1+count);assert(!h.canUndo());
  host.handleRedo();assert.equal(text,'앞뒤');host.handleUndo();assert.equal(pos.charOffset,1+count);
  h.execute(new C.InsertTextCommand(pos,'X',5000),w);assert.equal(text,'앞'+payload+'X뒤');host.handleUndo();assert.equal(text,'앞'+payload+'뒤');host.handleRedo();assert.equal(text,'앞'+payload+'X뒤');
 });
}
