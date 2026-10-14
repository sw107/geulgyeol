// Real WASM regression: definition start 1, paragraph NewStart(123), continued pages.
// Usage: node ... ENGINE_PKG FRESH_OUTPUT baseline|fixed [EXISTING_SYNTHETIC_INPUT]
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const [pkg,output,mode,input]=process.argv.slice(2),out=path.resolve(output);assert(['baseline','fixed'].includes(mode));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));const wasm=fs.readFileSync(path.resolve(pkg,'rhwp_bg.wasm'));M.initSync({module:wasm});
const sha=b=>createHash('sha256').update(b).digest('hex');
if(!input){const d=M.HwpDocument.createEmpty();try{
 d.ensureDefaultNumbering();const id=d.createNumbering(JSON.stringify({levelFormats:Array.from({length:7},(_,i)=>'^'+(i+1)+'.'),numberFormats:Array(7).fill(0),startNumber:1}));
 const texts=['BEFORE','RESTART '+('가나다라마바사 '.repeat(4))+Array.from({length:110},(_,i)=>'\nLINE'+i+' '+('아자차카타파하 '.repeat(4))).join(''),'AFTER'];
 for(let p=0;p<texts.length;p++){if(p)d.splitParagraph(0,p-1,Array.from(texts[p-1]).length);d.insertText(0,p,0,texts[p]);d.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId:id,paraLevel:0,marginLeft:0,marginRight:0,indent:0}));}
 assert.equal(JSON.parse(d.setNumberingRestart(0,1,2,123)).ok,true);
 fs.writeFileSync(path.join(out,'seed.hwpx'),d.exportHwpx());
 execFileSync('python3',['-c',String.raw`
from zipfile import ZipFile
from pathlib import Path
import sys,re,copy
q=Path(sys.argv[1]);id=sys.argv[2]
with ZipFile(q/'seed.hwpx') as z:
 h=z.read('Contents/header.xml').decode()
 def flags(m):
  t=m.group(0);t=re.sub(r'useInstWidth="[^"]*"','useInstWidth="1"',t);t=re.sub(r'autoIndent="[^"]*"','autoIndent="1"',t)
  return re.sub(r'textOffset="[^"]*"','textOffset="0"',t)
 h,n=re.subn(r'<hh:numbering\b[^>]*\bid="'+id+r'"[^>]*>[\s\S]*?</hh:numbering>',flags,h);assert n==1
 with ZipFile(q/'restart.hwpx','x') as dest:
  for e in z.infolist():dest.writestr(copy.copy(e),h.encode() if e.filename=='Contents/header.xml' else z.read(e.filename))
`,out,String(id)],{stdio:'inherit'});
}finally{d.free();}}
const bytes=fs.readFileSync(input??path.join(out,'restart.hwpx'));
function observe(d,order){const pages=Array.from({length:d.pageCount()},(_,p)=>p);if(order==='reverse')pages.reverse();const runs=pages.flatMap(page=>JSON.parse(d.getPageTextLayout(page)).runs.map(r=>({...r,page}))).sort((a,b)=>a.page-b.page||a.y-b.y||a.x-b.x);
 const body=runs.filter(r=>r.paraIdx===1&&Number.isInteger(r.charStart)&&r.text);const first=body.find(r=>r.charStart===0);assert(first);const lines=new Map();for(const r of body){const key=r.page+':'+r.y,old=lines.get(key);if(!old||r.charStart<old.charStart)lines.set(key,r);}
 const later=[...lines.values()].filter(r=>r.page>first.page).map(r=>({page:r.page,charStart:r.charStart,x:r.x}));assert(later.length>20);const markers=runs.filter(r=>!Number.isInteger(r.charStart)&&/^\d+\.$/.test(r.text)).map(r=>r.text);
 return {pages:d.pageCount(),firstX:first.x,later,markers,text:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000))};}
function check(v){assert.deepEqual(v.markers,['1.','123.','124.']);assert(v.later.every(r=>Math.abs(r.x-v.firstX)<.11),'NewStart actual marker width must continue on every later page');}
const stages=[];let d=new M.HwpDocument(bytes);d.setNumberingRestart(0,1,2,123);try{const initial=observe(d);fs.writeFileSync(path.join(out,'initial.json'),JSON.stringify(initial,null,2));assert.deepEqual(observe(d,'reverse'),initial);
 if(mode==='baseline'){assert.throws(()=>check(initial));assert(initial.later.some(r=>Math.abs(r.x-initial.firstX)>1));}
 else {check(initial);for(const [i,ext] of ['Hwpx','Hwp','Hwpx','Hwp'].entries()){const report=d['export'+ext+'WithReport']();let raw;try{assert.equal(JSON.parse(report.contentLoss()).count,0);raw=report.takeBytes();}finally{report.free();}fs.writeFileSync(path.join(out,'reopen-'+i+'.'+ext.toLowerCase()),raw);d.free();d=new M.HwpDocument(raw);d.setNumberingRestart(0,1,2,123);const v=observe(d,'reverse');check(v);assert.deepEqual(v,initial);stages.push({ext,sha256:sha(raw)});}}
 const proof={mode,engineSHA256:sha(wasm),inputSHA256:sha(bytes),definitionStart:1,paragraphRestart:123,flags:12,pages:initial.pages,firstX:initial.firstX,laterX:[...new Set(initial.later.map(r=>r.x))],laterLines:initial.later.length,markers:initial.markers,renderOrderIndependent:true,saveReopens:stages.length,restartReappliedAfterEachLoad:true,stages,nativeAppUI:false};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{d.free();}
