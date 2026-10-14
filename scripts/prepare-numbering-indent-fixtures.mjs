// Synthetic-only oracle inputs. Usage: node ... ENGINE_PKG FRESH_OUTPUT
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
const [pkg,output]=process.argv.slice(2),out=path.resolve(output);assert(pkg&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.resolve(pkg,'rhwp_bg.wasm'))});
const rows=[];const d=M.HwpDocument.createEmpty();try{
 d.ensureDefaultNumbering();for(let p=0;p<4;p++){
  const id=d.createNumbering(JSON.stringify({levelFormats:Array.from({length:7},(_,i)=>'^'+(i+1)+'.'),numberFormats:Array(7).fill(0),startNumber:123}));
  const label=['CASE00','CASE10','CASE01','CASE11'][p];
  const text=label+' '+('가나다라마바사 '.repeat(12))+'\nCONT'+label.slice(-2)+' '+('아자차카타파하 '.repeat(4));
  if(p)d.splitParagraph(0,p-1,Array.from(rows[p-1].text).length);d.insertText(0,p,0,text);
  d.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId:id,paraLevel:0,marginLeft:0,marginRight:0,indent:0,spacingAfter:12}));
  rows.push({p,id,bits:p*4,label,text});
 }fs.writeFileSync(path.join(out,'seed.hwpx'),d.exportHwpx());
}finally{d.free();}
fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify({synthetic:true,rows},null,2));
execFileSync('python3',['-c',String.raw`
from zipfile import ZipFile
from pathlib import Path
import json,re,sys,copy
q=Path(sys.argv[1]);rows=json.loads((q/'plan.json').read_text())['rows']
with ZipFile(q/'seed.hwpx') as src:
 h=src.read('Contents/header.xml').decode()
 for row in rows:
  pat=r'<hh:numbering\b[^>]*\bid="'+str(row['id'])+r'"[^>]*>[\s\S]*?</hh:numbering>'
  def flags(m):
   t=m.group(0)
   t=re.sub(r'useInstWidth="[^"]*"','useInstWidth="'+str((row['bits']>>2)&1)+'"',t)
   t=re.sub(r'autoIndent="[^"]*"','autoIndent="'+str((row['bits']>>3)&1)+'"',t)
   return re.sub(r'textOffset="[^"]*"','textOffset="0"',t)
  h,n=re.subn(pat,flags,h);assert n==1
 for name,header in [('decimal',h),('roman',h.replace('numFormat="DIGIT"','numFormat="ROMAN_CAPITAL"')),('multilevel',h)]:
  if name=='multilevel':
   header=re.sub(r'<hh:heading([^>]*?) level="0"',r'<hh:heading\1 level="1"',header)
   def level(m):
    t=m.group(0);l=int(re.search(r'level="(\d+)"',t)[1]);t=re.sub(r'start="[^"]*"','start="'+('123' if l==2 else '1')+'"',t)
    return re.sub(r'>[^<]*$', '>^1.^2.',t) if l==2 else t
   header=re.sub(r'<hh:paraHead[^>]+>[^<]*',level,header)
  with ZipFile(q/(name+'.hwpx'),'x') as dest:
   for entry in src.infolist():
    dest.writestr(copy.copy(entry),header.encode() if entry.filename=='Contents/header.xml' else src.read(entry.filename))
# Preserve ZIP member metadata, especially stored/uncompressed mimetype.
`,out],{stdio:'inherit'});
console.log(JSON.stringify({out,synthetic:true,fixtures:3,headCombinations:[0,4,8,12]}));
