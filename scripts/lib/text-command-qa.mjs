// Load current production text commands/history and the used bridge methods.
// UI/DOM is not emulated; no product edits or custom WASM mutation adapters.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
export function loadTextCommandQA(root=process.cwd()) {
 const read=p=>fs.readFileSync(path.join(root,'rhwp-studio/src',p),'utf8');
 function load(source,imports={}){
  const stripped=stripTypeScriptTypes(source,{mode:'transform'}),names=[...stripped.matchAll(/\bexport (?:class|function|const|let) (\w+)/g)].map(m=>m[1]);
  const bindings=[];
  for(const m of stripped.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?/gm)){
   assert(m[2] in imports,'Unbound runtime dependency '+m[2]);bindings.push(`const {${m[1].replace(/\bas\b/g,':')}}=imports[${JSON.stringify(m[2])}];`);
  }
  const code=stripped.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/\bexport (?=class|function|const|let)/g,'');
  return new Function('imports',bindings.join('\n')+'\n'+code+'\nreturn {'+names.join(',')+'};')(imports);
 }
 const invalidation=load(read('engine/input-edit-invalidation.ts'));
 const objects=load(read('engine/object-props.ts'),{'./equation-target':{}}); // unused object routes
 const commands=load(read('engine/command.ts'),{'./object-props':objects,'./input-edit-invalidation':invalidation});
 const {CommandHistory}=load(read('engine/history.ts'),{'./command':commands});
 const source=read('core/wasm-bridge.ts');
 function fn(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}',a);assert(a>=0&&b>a,name);return source.slice(a,b+2);}
 let bridge=read('core/local-text-replace-result.ts').replace(/export /g,'')+'\n'+fn('parseDeferredFocusedCellCursorGeometry')+'\n'+fn('parseDeferredFocusedPagePatch')+'\nexport class Bridge {doc;constructor(d){this.doc=d;}\n';
 for(const n of ['insertText','deleteText','getTextRange','replaceBodyTextLocal','insertTextInCell','deleteTextInCell','getTextInCell','insertTextInCellDeferredPagination','deleteTextInCellDeferredPagination','insertTextInCellByPath','deleteTextInCellByPath','getTextInCellByPath']){
  const a=source.indexOf('  '+n+'('),b=source.indexOf('\n  }\n',a);assert(a>=0&&b>a,n);bridge+=source.slice(a,b+4)+'\n';
 }
 const {Bridge}=load(bridge+'}');
 const input=read('engine/input-handler.ts');let undo='import {IMMEDIATE_TEXT_MUTATION_EFFECTS} from "./command";\nexport class UndoHost {\n';
 for(const n of ['handleUndo','handleRedo','restoreEditContextAfterHistory']){
  const a=input.indexOf('  private '+n+'('),b=input.indexOf('\n  }\n',a);assert(a>=0&&b>a,n);undo+=input.slice(a,b+4)+'\n';
 }
 const {UndoHost}=load(undo+'}',{'./command':commands});
 return {commands,CommandHistory,Bridge,UndoHost};
}
