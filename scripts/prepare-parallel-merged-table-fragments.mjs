// Existing synthetic fixture only; parallel/mixed rowspan owner matrix.
// Object-height changes are arithmetic stress data, not authored page-break proof.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';
const [outArg,pkgArg,sourceArg]=process.argv.slice(2),out=path.resolve(outArg),pkg=path.resolve(pkgArg);
assert(!fs.existsSync(out),'fresh fixture output');fs.mkdirSync(out,{recursive:true});
const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const variants=[
 {label:'parallel-large',longRight:true,merges:[[1,0,47,0],[1,1,47,1]]},
 {label:'parallel-unequal',merges:[[1,0,47,0],[1,1,47,1]]},
 {label:'mixed-large-left',merges:[[1,0,47,0]]},
 {label:'mixed-large-right',longRight:true,merges:[[1,1,47,1]]},
 {label:'mixed-staggered',longRight:true,merges:[[1,0,32,0],[16,1,47,1]]},
 {label:'parallel-short',longRight:true,merges:[[24,0,26,0],[24,1,26,1]]},
 {label:'mixed-short',longRight:true,merges:[[24,0,26,0]]}
],seeds=[],probe=[];
for(const v of variants){
 let d=new M.HwpDocument(fs.readFileSync(v.shortRows?path.join(path.dirname(sourceArg),'whole-before.hwp'):sourceArg));const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);assert(t);
 {d.insertTableColumn(0,t.para,t.controlIndex,0,true);for(let cell=0;cell<JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex)).cellCount;cell++){const info=JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,cell));if(info.col===1){d.insertTextInCell(0,t.para,t.controlIndex,cell,0,0,'RIGHT_ROW'+String(info.row).padStart(3,'0')+'_END'+(v.longRight?'앞😀'+('IA'.repeat(24))+'뒤🧪':''));if(info.row===0)d.setCellProperties(0,t.para,t.controlIndex,cell,JSON.stringify({isHeader:true}));}}}
 for(const merge of v.merges)d.mergeTableCells(0,t.para,t.controlIndex,...merge);
 if(v.shortRows){const def=JSON.parse(d.getPageDef(0));d.setPageDef(0,JSON.stringify({...def,marginBottom:34000}));}
 // Change only the stored source object frame, leaving row/cell boxes intact.
 // Product size editing intentionally changes row geometry and is not a way
 // to synthesize a saved partial-frame provenance case.
 const before=path.join(out,v.label+'-unmodified-frame.hwpx'),partial=path.join(out,v.label+'-partial-frame.hwpx');fs.writeFileSync(before,d.exportHwpx());
 execFileSync('python3',['-c',`import zipfile,sys,re,xml.etree.ElementTree as E
src,dst,frame=sys.argv[1:];hp='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
with zipfile.ZipFile(src) as z:
 data={n:z.read(n) for n in z.namelist()}
s=data['Contents/section0.xml'].decode();root=E.fromstring(s);table=root.find('.//'+hp+'tbl');size=table.find(hp+'sz');old=size.attrib['height'];assert old=='62400',old
prefix=s[:s.index('<hp:tbl')];rest=s[len(prefix):];rest=re.sub(r'(<hp:sz\\b[^>]*\\bheight=")'+old+r'(")',r'\\g<1>'+frame+r'\\2',rest,count=1);data['Contents/section0.xml']=(prefix+rest).encode()
with zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as z:
 for n,b in data.items():z.writestr(n,b)
`,before,partial,String(v.shortRows?31200:40000)]);
 d.free();d=new M.HwpDocument(fs.readFileSync(partial));assert.equal(JSON.parse(d.getTableProperties(0,t.para,t.controlIndex)).tableHeight,v.shortRows?31200:40000);
 const files={};for(const ext of['hwp','hwpx']){const file=path.join(out,v.label+'.'+ext);fs.writeFileSync(file,ext==='hwp'?d.exportHwp():d.exportHwpx());files[ext]=file;}
 const owners=Array.from({length:JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex)).cellCount},(_,i)=>({i,info:JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i))})).filter(c=>c.info.rowSpan>1).map(c=>c.i);
 seeds.push({label:v.label,files,operations:['input-0','input-1','input-2','host-input','replace-one','size-noop',...owners.flatMap(cell=>[0,1,2].map(i=>'owner-'+cell+'-input-'+i))],query:'ROW024',declaredBeforePx:10,declaredAfterPx:5,sourcePartialFrame:true,merged:v.merges,mergedOwners:true,snapshotEligibleOwners:v.label.startsWith('parallel-')&&v.label!=='parallel-short'?owners:[]});
 const dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex)),cells=Array.from({length:dim.cellCount},(_,i)=>({i,info:JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i)),props:JSON.parse(d.getCellProperties(0,t.para,t.controlIndex,i)),paras:Array.from({length:d.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,p)=>d.getTextInCell(0,t.para,t.controlIndex,i,p,0,100000))})),pages=Array.from({length:d.pageCount()},(_,p)=>({page:p,runs:JSON.parse(d.getPageTextLayout(p)).runs,controls:JSON.parse(d.getPageControlLayout(p)).controls})),issues=[];
 for(const c of cells)for(const [pi,text]of c.paras.entries()){const owned=pages.map(p=>p.runs.filter(r=>r.cellIdx===c.i&&r.cellParaIdx===pi&&r.cellPath).map(r=>r.text).join(''));const expected=text.replace(/\s/g,'');if(c.props.isHeader){for(const actual of owned.filter(Boolean))if(actual.replace(/\s/g,'')!==expected)issues.push({cell:c.i,para:pi,kind:'header-owner'});}else if(owned.join('').replace(/\s/g,'')!==expected)issues.push({cell:c.i,para:pi,kind:'content-owner',expectedLength:expected.length,actualLength:owned.join('').replace(/\s/g,'').length});}
 probe.push({label:v.label,dimensions:dim,properties:JSON.parse(d.getTableProperties(0,t.para,t.controlIndex)),mergedCells:cells.filter(c=>c.info.rowSpan>1||c.info.colSpan>1).map(c=>({i:c.i,info:c.info,paragraphs:c.paras.length})),pageCount:d.pageCount(),issues});console.log(JSON.stringify(probe.at(-1)));d.free();
}
fs.writeFileSync(path.join(out,'seeds.json'),JSON.stringify(seeds,null,2));fs.writeFileSync(path.join(out,'probe.json'),JSON.stringify(probe,null,2));
