// Synthetic inputs for native/WASM/Electron numbering flag checks. Never reads user documents.
// Usage: node scripts/prepare-numbering-head-fixtures.mjs WASM_PKG FRESH_FIXTURE_DIR
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const [pkg,out]=process.argv.slice(2).map(p=>path.resolve(p));
assert(!fs.existsSync(out),'Fresh fixture directory required');fs.mkdirSync(out,{recursive:true});
const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));
M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const d=M.HwpDocument.createEmpty(),texts=Array.from({length:7},(_,p)=>'항목'+p+' '+('번호 서식 보존과 두 번째 줄 시작 위치 확인 '.repeat(5))+'끝🙂');
let numberingId;
try {
 d.ensureDefaultNumbering();
 numberingId=d.createNumbering(JSON.stringify({levelFormats:Array.from({length:7},(_,i)=>'^'+(i+1)+'.'),numberFormats:[0,2,8,0,2,8,0],startNumber:0}));
 for(let p=0;p<7;p++){
  if(p)d.splitParagraph(0,p-1,Array.from(texts[p-1]).length);
  d.insertText(0,p,0,texts[p]);
  d.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId,paraLevel:p,marginLeft:p*6,indent:-p*4}));
 }
 fs.writeFileSync(path.join(out,'seed.hwpx'),Buffer.from(d.exportHwpx()),{flag:'wx'});
} finally {d.free();}
execFileSync('python3',['-B','-c',String.raw`
import pathlib,zipfile,re,json,hashlib,sys
out=pathlib.Path(sys.argv[1]);id=int(sys.argv[2]);flags=[0,4,8,12,4,8,12];rows=[]
with zipfile.ZipFile(out/'seed.hwpx') as z:entries={n:z.read(n) for n in z.namelist()}
for name in ['numeric','boolean','omitted']:
 heads=[];expected=[0]*7 if name=='omitted' else flags
 for i in range(10):
  bits=expected[i] if i<7 else 12
  attrs='' if name=='omitted' else ' useInstWidth="'+(('true' if bits&4 else 'false') if name=='boolean' else ('1' if bits&4 else '0'))+'" autoIndent="'+(('true' if bits&8 else 'false') if name=='boolean' else ('1' if bits&8 else '0'))+'"'
  heads.append(f'<hh:paraHead start="{0 if i==0 else 1}" level="{i+1}" align="LEFT"{attrs} widthAdjust="{-12 if i==0 else 0}" textOffsetType="PERCENT" textOffset="0" numFormat="{["DIGIT","ROMAN_CAPITAL","HANGUL_SYLLABLE"][i%3]}" charPrIDRef="{4294967295 if i==0 else 0}">^{min(i+1,7)}.</hh:paraHead>')
 header=entries['Contents/header.xml'].decode();pattern=r'(<hh:numbering\b[^>]*\bid="'+str(id)+r'"[^>]*>).*?(</hh:numbering>)'
 header,count=re.subn(pattern,lambda m:m[1]+''.join(heads)+m[2],header,flags=re.S);assert count==1
 p=out/(name+'.hwpx')
 with zipfile.ZipFile(p,'x',compression=zipfile.ZIP_DEFLATED) as z:
  for n,v in entries.items():z.writestr(n,header.encode() if n=='Contents/header.xml' else v)
 rows.append({'name':name,'numberingId':id,'expectedFlags':expected,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'proof.json').write_text(json.dumps({'synthetic':True,'paragraphs':7,'rows':rows},ensure_ascii=False,indent=2)+'\n')
`,out,String(numberingId)],{stdio:'inherit'});
console.log(JSON.stringify({synthetic:true,paragraphs:7,numberingId,fixtures:3,out}));
