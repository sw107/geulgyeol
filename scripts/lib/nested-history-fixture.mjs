// Public factories + internal table copy/paste only; no model/XML mutation.
export function createNestedHistoryFixture(M, scenario, unicode) {
 const d=M.HwpDocument.createEmpty(),j=JSON.parse;d.createBlankDocument();
 const outer=j(d.createTable(0,0,0,1,2)),inner=j(d.createTable(0,1,0,1,2));
 const values=unicode?['가🙂다🧪','라𐐀바🙂']:['가나다🙂','라마바𐐀'];
 for(let i=0;i<2;i++)d.insertTextInCell(0,inner.paraIdx,inner.controlIdx,i,0,0,values[i]);
 const entry=(controlIndex,cellIndex)=>({controlIndex,cellIndex,cellParaIndex:0});
 d.copyControl(0,inner.paraIdx,'[]',inner.controlIdx);
 for(let i=0;i<2;i++)d.pasteInternalInCellByPath(0,outer.paraIdx,JSON.stringify([entry(outer.controlIdx,i)]),0);
 const refs=[0,1].map(i=>({parent:inner.paraIdx,path:[entry(inner.controlIdx,i)]}));
 for(let i=0;i<2;i++)for(let c=0;c<2;c++)refs.push({parent:outer.paraIdx,path:[entry(outer.controlIdx,i),entry(0,c)]});
 let parent=outer.paraIdx,prefix=[entry(outer.controlIdx,0)];
 if(scenario.startsWith('d3')){
  d.copyControl(0,outer.paraIdx,'[]',outer.controlIdx);const wrapper=j(d.createTable(0,2,0,1,1));parent=wrapper.paraIdx;
  d.pasteInternalInCellByPath(0,parent,JSON.stringify([entry(wrapper.controlIdx,0)]),0);
  prefix=[entry(wrapper.controlIdx,0),entry(0,0)];
  for(let i=0;i<2;i++)for(let c=0;c<2;c++)refs.push({parent,path:[entry(wrapper.controlIdx,0),entry(0,i),entry(0,c)]});
 }
 const a={parent,path:[...prefix,entry(0,0)]},b=structuredClone(a);
 if(scenario.endsWith('leaf'))b.path.at(-1).cellIndex=1;
 if(scenario.endsWith('middle'))b.path.at(-2).cellIndex=1;
 const position=ref=>({sectionIndex:0,paragraphIndex:0,parentParaIndex:ref.parent,controlIndex:ref.path[0].controlIndex,cellIndex:ref.path[0].cellIndex,cellParaIndex:ref.path[0].cellParaIndex,cellPath:ref.path,charOffset:0});
 const meta={scenario,unicode,refs,positions:[position(a),position(b)],same:scenario.endsWith('same')};
 const bytes=d.exportHwpx();d.free();return {bytes,meta};
}
export function nestedHistoryView(d,meta){
 const j=JSON.parse;
 return {fields:j(d.getFieldList()),body:Array.from({length:d.getParagraphCount(0)},(_,i)=>d.getTextRange(0,i,0,1000)),cells:meta.refs.map(r=>{
  const pj=JSON.stringify(r.path),text=d.getTextInCellByPath(0,r.parent,pj,0,1000);
  return {parent:r.parent,path:r.path,text,paragraphCount:d.getCellParagraphCountByPath(0,r.parent,pj),properties:j(d.getCellParaPropertiesAtByPath(0,r.parent,pj)),chars:[...text].map((_,i)=>j(d.getCellCharPropertiesAtByPath(0,r.parent,pj,i)))};
 })};
}
export function referenceIndex(meta,position){return meta.refs.findIndex(r=>r.parent===position.parentParaIndex&&JSON.stringify(r.path)===JSON.stringify(position.cellPath));}
