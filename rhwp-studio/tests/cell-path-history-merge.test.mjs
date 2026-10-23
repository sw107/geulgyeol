import assert from'node:assert/strict';import{test}from'node:test';import path from'node:path';import{fileURLToPath}from'node:url';import{loadTextCommandQA}from'../../scripts/lib/text-command-qa.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),{commands:C}=loadTextCommandQA(root);
const entry=(controlIndex=0,cellIndex=0,cellParaIndex=0)=>({controlIndex,cellIndex,cellParaIndex});
const base={sectionIndex:0,paragraphIndex:0,parentParaIndex:0,controlIndex:2,cellIndex:0,cellParaIndex:0,cellPath:[entry(2),entry(),entry()],charOffset:0};
const variants=[['equal copied path',a=>structuredClone(a),true],['equal keys reordered',a=>({...a,cellPath:a.cellPath.map(e=>({cellParaIndex:e.cellParaIndex,cellIndex:e.cellIndex,controlIndex:e.controlIndex}))}),true]];
for(const depth of[1,2])for(const key of['controlIndex','cellIndex','cellParaIndex'])variants.push([`different depth ${depth} ${key}`,a=>{const b=structuredClone(a);b.cellPath[depth][key]++;return b;},false]);
variants.push(['different path depth',a=>({...a,cellPath:a.cellPath.slice(0,-1)}),false]);
const pairs=variants.map(([name,change,merge])=>({name,a:base,b:change(base),merge}));
const flat={...base,cellPath:undefined};pairs.push({name:'flat and equivalent depth-one path',a:flat,b:{...flat,cellPath:[entry(2)]},merge:true},{name:'flat and empty path',a:flat,b:{...flat,cellPath:[]},merge:true},{name:'same body paragraph',a:{sectionIndex:0,paragraphIndex:0,charOffset:0},b:{sectionIndex:0,paragraphIndex:0,charOffset:0},merge:true});
function make(kind,p,i){return kind==='insert'?new C.InsertTextCommand({...p,charOffset:i?1:0},i?'Y':'X',1000+i*30):new C.DeleteTextCommand({...p,charOffset:kind==='backward'&&!i?2:1},1,kind,i?'마':'다',1000+i*30);}
for(const {name,a,b,merge}of pairs)for(const kind of['insert','forward','backward'])test(`${kind}: ${name}`,()=>assert.equal(make(kind,a,0).mergeWith(make(kind,b,1))!==null,merge));
test('insert keeps time bound',()=>assert.equal(make('insert',base,0).mergeWith(new C.InsertTextCommand({...base,charOffset:1},'Y',1301)),null));
test('insert keeps format boundary',()=>assert.equal(make('insert',base,0).mergeWith(new C.InsertTextCommand({...base,charOffset:1},'Y',1030,{bold:true})),null));
test('insert keeps offset boundary',()=>assert.equal(make('insert',base,0).mergeWith(new C.InsertTextCommand({...base,charOffset:2},'Y',1030)),null));
test('delete keeps direction boundary',()=>assert.equal(make('forward',base,0).mergeWith(make('backward',base,1)),null));
test('delete keeps time bound',()=>assert.equal(make('forward',base,0).mergeWith(new C.DeleteTextCommand({...base,charOffset:1},1,'forward','마',1301)),null));
test('body paragraph boundary unchanged',()=>assert.equal(make('insert',pairs.at(-1).a,0).mergeWith(make('insert',{...pairs.at(-1).b,paragraphIndex:1},1)),null));
test('flat cell boundary unchanged',()=>assert.equal(make('forward',flat,0).mergeWith(make('forward',{...flat,cellIndex:1},1)),null));
