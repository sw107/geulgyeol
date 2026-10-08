#!/usr/bin/env python3
"""Expand generated next-style fixtures; never reads or edits user documents."""
import pathlib,zipfile,xml.etree.ElementTree as ET,json,sys,copy
assert len(sys.argv)==3, 'SOURCE_FIXTURE_DIR OUTPUT_DIR'
source=pathlib.Path(sys.argv[1]);q=pathlib.Path(sys.argv[2]);q.mkdir(parents=True,exist_ok=True)
hp='http://www.hancom.co.kr/hwpml/2011/paragraph';manifest=[]
for scope in ['body','cell']:
 for count in [32,512,8192]:
  input=source/('scope0-direct0.hwpx' if scope=='body' else 'scope1-direct0.hwpx')
  with zipfile.ZipFile(input) as z:
   files={name:z.read(name) for name in z.namelist()};root=ET.fromstring(files['Contents/section0.xml'])
  for i in range(len(root),count):
   active=scope=='body' and i==count-1
   p=ET.SubElement(root,'{'+hp+'}p',{'id':str(100000+i),'paraPrIDRef':'0','styleIDRef':'22' if active else '0','pageBreak':'0','columnBreak':'0','merged':'0'})
   run=ET.SubElement(p,'{'+hp+'}run',{'charPrIDRef':'0'});t=ET.SubElement(run,'{'+hp+'}t');t.text='문단😀 끝' if active else ('합성 배경 문단 '+str(i)+' 가나다라마 ABC 123. ')*3
  files['Contents/section0.xml']=ET.tostring(root,encoding='utf-8',xml_declaration=True)
  path=q/(scope+'-'+str(count)+'.hwpx')
  with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
   for name,data in files.items():z.writestr(name,data)
  textChars=sum(len(t.text or '') for t in root.iter('{'+hp+'}t'))
  manifest.append({'file':path.name,'scope':scope,'paragraphs':count,'target':count-1 if scope=='body' else 1,'control':0,'cell':0,'offset':5,'textScalars':textChars,'inputBytes':path.stat().st_size})
(q/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False))

# Extra fixture is only for the composition-entry upper-limit fallback test.
with zipfile.ZipFile(q/'body-8192.hwpx') as z: files={n:z.read(n) for n in z.namelist()}
r=ET.fromstring(files['Contents/section0.xml'])
for i in range(len(r),32768):
 p=copy.deepcopy(r[2]);p.set('id',str(200000+i));r.append(p)
files['Contents/section0.xml']=ET.tostring(r,encoding='utf-8',xml_declaration=True)
with zipfile.ZipFile(q/'body-32768.hwpx','w',zipfile.ZIP_DEFLATED) as z:
 for n,b in files.items():z.writestr(n,b)
