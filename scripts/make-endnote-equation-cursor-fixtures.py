"""Synthetic HWPX cursor fixtures: SEED_WITH_FINAL_NOTE_EQUATION FRESH_OUTPUT."""
from pathlib import Path
from copy import deepcopy
import hashlib,json,sys,zipfile,xml.etree.ElementTree as ET
seed,out=Path(sys.argv[1]),Path(sys.argv[2]);out.mkdir()
HP='http://www.hancom.co.kr/hwpml/2011/paragraph';HH='http://www.hancom.co.kr/hwpml/2011/head';OPF='http://www.idpf.org/2007/opf/'
for prefix,uri in [('hp',HP),('hh',HH),('opf',OPF),('hs','http://www.hancom.co.kr/hwpml/2011/section'),('hc','http://www.hancom.co.kr/hwpml/2011/core')]:ET.register_namespace(prefix,uri)
ns={'hp':HP,'opf':OPF}
with zipfile.ZipFile(seed) as z:
 base={n:z.read(n) for n in z.namelist()}
 compression={n:z.getinfo(n).compress_type for n in z.namelist()}
# The retained synthetic seed stores a raw paraHead fragment using ns0 without
# its old declaration. Use the already-declared head prefix in this test copy.
header=base['Contents/header.xml']
seed_namespace_bound=b'<ns0:paraHead' in header and b'xmlns:ns0=' not in header
if seed_namespace_bound:
 header=header.replace(b'<ns0:paraHead',b'<hh:paraHead').replace(b'</ns0:paraHead>',b'</hh:paraHead>')
 base['Contents/header.xml']=header
ET.fromstring(base['Contents/header.xml'])
root=ET.fromstring(base['Contents/section0.xml']);note=root.find('.//hp:endNote',ns);assert note is not None
paras=note.find('hp:subList',ns).findall('hp:p',ns);assert len(paras)==2
original=paras[1];equation=original.find('.//hp:equation',ns);assert equation is not None
rows=[]
cases=[]
for text,tag in [('EQ_END','ascii'),('한😀é𐐷Z','unicode')]:
 for position,label in [(0,'first'),(len(text)//2,'middle'),(len(text),'last')]:
  cases.append((f'{tag}-{label}',text,[position],1,False))
cases += [('adjacent-equations','EQ_END',[0,0],1,False),('separated-equations','EQ_END',[1,4],1,False),('empty-equation','',[0],1,False)]
for target in [0,1]:
 cases += [(f'para{target}-first','EQ_END',[0],target,False),(f'para{target}-middle','EQ_END',[3],target,False),
           (f'deferred-para{target}','EQ_END',[0],target,True)]
for name,text,positions,target,deferred in cases:
 xml=deepcopy(root);n=xml.find('.//hp:endNote',ns);sub=n.find('hp:subList',ns);ps=sub.findall('hp:p',ns)
 p=deepcopy(original)
 for child in list(p):p.remove(child)
 run=ET.SubElement(p,'{'+HP+'}run',{'charPrIDRef':'0'})
 bypos={}
 for i,pos in enumerate(positions):
  eq=deepcopy(equation);eq.set('id',str(1140850689+i));bypos.setdefault(pos,[]).append(eq)
 buffer=''
 for i in range(len(text)+1):
  if i in bypos:
   if buffer:ET.SubElement(run,'{'+HP+'}t').text=buffer;buffer=''
   for eq in bypos[i]:run.append(eq)
  if i<len(text):buffer+=text[i]
 if buffer:ET.SubElement(run,'{'+HP+'}t').text=buffer
 sub.remove(ps[target]);sub.insert(target,p)
 for i,paragraph in enumerate(sub.findall('hp:p',ns)):paragraph.set('id',str(i))
 for i,eq in enumerate(n.findall('.//hp:equation',ns)):eq.set('id',str(1140850689+i))
 files=dict(base);files['Contents/section0.xml']=ET.tostring(xml,encoding='utf-8',xml_declaration=True)
 if deferred:
  other=deepcopy(xml)
  for parent in other.iter():
   for child in list(parent):
    if child.tag=='{'+HP+'}endNote':parent.remove(child)
  files['Contents/section1.xml']=ET.tostring(other,encoding='utf-8',xml_declaration=True)
  header=ET.fromstring(files['Contents/header.xml']);header.set('secCnt','2');files['Contents/header.xml']=ET.tostring(header,encoding='utf-8',xml_declaration=True)
  package=ET.fromstring(files['Contents/content.hpf']);ET.SubElement(package.find('opf:manifest',ns),'{'+OPF+'}item',{'id':'section1','href':'Contents/section1.xml','media-type':'application/xml'});ET.SubElement(package.find('opf:spine',ns),'{'+OPF+'}itemref',{'idref':'section1','linear':'yes'});files['Contents/content.hpf']=ET.tostring(package,encoding='utf-8',xml_declaration=True)
 path=out/(name+'.hwpx')
 with zipfile.ZipFile(path,'x',compression=zipfile.ZIP_DEFLATED) as z:
  for entry,data in files.items():z.writestr(entry,data,compress_type=compression.get(entry,zipfile.ZIP_DEFLATED))
 rows.append({'case':name,'path':str(path.resolve()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'section':0,'para':0,'control':2,'notePara':target,'expectedText':text,'expectedEquationPositions':positions,'deferred':deferred,'syntheticSeedHeaderNamespaceBound':seed_namespace_bound})
(out/'manifest.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('synthetic cases',len(rows))
