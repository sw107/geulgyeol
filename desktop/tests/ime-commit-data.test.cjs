// Replays event-order contracts through production input handlers/commands/history
// and the existing WASM SDK. It is not a physical keyboard/native GUI test.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {stripTypeScriptTypes} = require('node:module');
const root = path.resolve(__dirname, '../..');
let modules;
async function load() {
  return modules ??= (async () => {
    // Extend only the QA loader's production-method list for the cell IME path.
    // Keep the shared loader file and the real bridge implementation unchanged.
    const loader=fs.readFileSync(path.join(root,'scripts/lib/text-command-qa.mjs'),'utf8');
    const marker="'insertTextInCellDeferredPagination',";
    assert.equal(loader.split(marker).length,2);
    const expanded=loader.replace(marker,marker+"'replaceTextInCellDeferredPagination',");
    const {loadTextCommandQA} = await import('data:text/javascript;base64,'+Buffer.from(expanded).toString('base64'));
    const qa = loadTextCommandQA(root);
    const source = fs.readFileSync(path.join(root,'rhwp-studio/src/engine/input-handler-text.ts'),'utf8');
    const code = stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'').replace(/\bexport\s+/g,'');
    const keys=Object.keys(qa.commands);
    const input = new Function(...keys,code+'\nreturn {onInput,onCompositionStart,onCompositionEnd,getTextAt,replaceTextAtRaw};')(...keys.map(k=>qa.commands[k]));
    const handler = fs.readFileSync(path.join(root,'rhwp-studio/src/engine/input-handler.ts'),'utf8');
    const a=handler.indexOf('  private onCompositionStart('),b=handler.indexOf('\n  /** 위치에서 텍스트를 읽는다',a);
    assert(a>=0 && b>a);
    const router = stripTypeScriptTypes('class Router {\n'+handler.slice(a,b)+'\n}',{mode:'transform'});
    const Router = new Function('_text',router+'\nreturn Router;')(input);
    const folder=process.env.GEULGYEOL_QA_ENGINE_DIR||path.join(root,'desktop/web/studio');
    const M=await import(pathToFileURL(path.join(folder,'rhwp.js')));
    M.initSync({module:fs.readFileSync(path.join(folder,'rhwp_bg.wasm'))});
    return {...qa,input,Router,M};
  })();
}
function fixture(Q,doc,context) {
  const wasm=new Q.Bridge(doc), history=new Q.CommandHistory();
  let position={sectionIndex:0,paragraphIndex:0,charOffset:1};
  if(context==='cell')position={...position,parentParaIndex:1,controlIndex:0,cellIndex:0,cellParaIndex:0};
  const effects=new Q.commands.TextMutationEffectAccumulator();
  const h=Object.assign(new Q.Router(),{wasm,history,active:true,editMode:'normal',textarea:{value:''},_isIOS:false,
    isComposing:false,compositionAnchor:null,compositionLength:0,_lastCompositionText:'',_lastComposedText:'',
    cursor:{isInHeaderFooter:()=>false,isInFootnote:()=>false,isInCell:()=>context==='cell',hasSelection:()=>false,
      getPosition:()=>({...position}),getRect:()=>null,moveTo:p=>{position={...p};}},
    caret:{hideComposition(){}},updateCaret(){},afterTextInputEdit(){},
    canInsertTextInFormMode:()=>true,canDeleteTextInFormMode:()=>true,
    resetRawTextMutationEffects:()=>effects.consume(),consumeRawTextMutationBeforeCursor:()=>{effects.consume();return false;},
    replaceTextAtRaw:(...args)=>effects.add(Q.input.replaceTextAtRaw.call(h,...args)),
    getTextAt:(...args)=>Q.input.getTextAt.call(h,...args),
    executeOperation(desc){
      if(desc.kind==='record')history.recordWithoutExecute(desc.command,wasm);
      else if(desc.kind==='command')position=history.execute(desc.command,wasm);
      else throw Error('Unexpected input route '+desc.kind);
    },
  });
  return {h,history,wasm,input:text=>{h.textarea.value=text;Q.input.onInput.call(h,{inputType:'insertCompositionText',isComposing:h.isComposing,data:text});}};
}
for(const ext of ['hwp','hwpx'])for(const context of ['body','cell'])for(const c of [
  {name:'final update before end',updates:['ㄱ','가'],final:'가'},
  {name:'end before final input',updates:['ㄱ'],final:'가'},
  {name:'end without an input update',updates:[],final:'가'},
  {name:'cancel with empty final data',updates:['ㄱ'],final:''},
])test(`${ext} ${context}: ${c.name} commits final text once, undo/redo and save/reopen retain it`,async()=>{
 const Q=await load(),seed=Q.M.HwpDocument.createEmpty();let doc,reopened;
 try{
  seed.createBlankDocument();
  if(context==='cell'){
    assert(JSON.parse(seed.splitParagraph(0,0,0)).ok);
    assert(JSON.parse(seed.createTable(0,1,0,1,1)).ok);
    assert(JSON.parse(seed.insertTextInCell(0,1,0,0,0,0,'앞뒤')).ok);
  }else assert(JSON.parse(seed.insertText(0,0,0,'앞뒤')).ok);
  doc=new Q.M.HwpDocument(ext==='hwp'?seed.exportHwp():seed.exportHwpx());
  const read=d=>context==='cell'?d.getTextInCell(0,1,0,0,0,0,20):d.getTextRange(0,0,0,20);
  const f=fixture(Q,doc,context);f.h.onCompositionStart();for(const text of c.updates)f.input(text);
  f.h.textarea.value=c.final;f.h.onCompositionEnd({data:c.final});
  const expected='앞'+c.final+'뒤';
  assert.equal(read(doc),expected,'compositionend must commit even if no trailing input arrives');
  f.input(c.final); // A trailing commit input must not insert the same text again.
  assert.equal(read(doc),expected);
  if(c.final){f.history.undo(f.wasm);assert.equal(read(doc),'앞뒤');f.history.redo(f.wasm);assert.equal(read(doc),expected);}
  else assert.equal(f.history.canUndo(),false);
  reopened=new Q.M.HwpDocument(ext==='hwp'?doc.exportHwp():doc.exportHwpx());
  assert.equal(read(reopened),expected);
 }finally{reopened?.free();doc?.free();seed.free();}
});
