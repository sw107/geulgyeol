"""Build synthetic copies only. Does not repair user files or infer undeclared prefixes."""
from pathlib import Path
import sys,re,json,zipfile,hashlib,xml.etree.ElementTree as ET
seed,out=map(Path,sys.argv[1:]);out.mkdir();HEAD='http://www.hancom.co.kr/hwpml/2011/head'
with zipfile.ZipFile(seed)as z:entries=[(i,z.read(i.filename))for i in z.infolist()]
header=dict((i.filename,b)for i,b in entries)['Contents/header.xml'].decode()
base=re.search(r'<hh:numberings\b.*?</hh:numberings>',header).group(0)
# Raw-only levels and explicit zero/sentinel flags must survive this fix.
base=base.replace('level="8" align="LEFT" useInstWidth="1" autoIndent="1"','level="8" align="RIGHT" useInstWidth="0" autoIndent="0"')
alias=base.replace('hh:paraHead','ns0:paraHead')
def decl(s,tag,attrs):return s.replace('<'+tag,'<'+tag+' '+attrs,1)
def root(s,attrs):return decl(s,'hh:head',attrs)
def make(n,table,rootattrs='',bullets=''):
 h=header.replace(re.search(r'<hh:numberings\b.*?</hh:numberings>',header).group(0),table)
 if rootattrs:h=root(h,rootattrs)
 if bullets:h=h.replace('</hh:numberings>','</hh:numberings>'+bullets,1)
 return n,h
cases=[make('canonical',base),make('alias-root',alias,f'xmlns:ns0="{HEAD}"'),make('alias-collection',decl(alias,'hh:numberings',f'xmlns:ns0="{HEAD}"'))]
# The singular element has a separate namespace scope from the collection.
cases.append(make('alias-numbering',alias.replace('<hh:numbering id=',f'<hh:numbering xmlns:ns0="{HEAD}" id=',1)))
cases.append(make('default-parent',base.replace('hh:paraHead','paraHead').replace('<hh:numbering id=',f'<hh:numbering xmlns="{HEAD}" id=',1)))
cases.append(make('shadowed-alias',alias.replace('<hh:numbering id=',f'<hh:numbering xmlns:ns0="{HEAD}" id=',1),'xmlns:ns0="urn:outer-shadow"'))
local=alias.replace('<ns0:paraHead ',f'<ns0:paraHead xmlns:ns0="{HEAD}" ')
cases.append(make('child-local-override',local,'xmlns:ns0="urn:outer-shadow"'))
ext=alias.replace('checkable="0">','checkable="0" x:flag="A&amp;B">',1).replace('</ns0:paraHead>','<x:mark x:type="x:T"/></ns0:paraHead>',1)
cases.append(make('entity-uri-and-qname-value',ext,f'xmlns:ns0="{HEAD}" xmlns:x="urn:test?A=1&amp;B=2"'))
# Preserve a standard-prefix shadow only on the raw fragment, never on generated hh nodes.
h=make('standard-prefix-shadow',ext,f'xmlns:ns0="{HEAD}" xmlns:x="urn:extension"')[1]
h=h.replace('hh:','h:').replace('xmlns:hh=', 'xmlns:h=');h=h.replace('<h:head ', '<h:head xmlns:hh="urn:shadowed-hh" ',1);h=h.replace('<x:mark ', '<hh:mark ',1)
cases.append(('standard-prefix-shadow',h))
inner=ext[ext.index('>')+1:ext.rindex('</hh:numberings>')]
inner1=inner.replace('<hh:numbering id=',f'<hh:numbering xmlns:ns0="{HEAD}" xmlns:x="urn:first" id=',1)
inner2=inner.replace('id="1" start=', 'id="2" start=',1).replace('<hh:numbering id=',f'<hh:numbering xmlns:ns0="{HEAD}" xmlns:x="urn:second" id=',1)
cases.append(make('sibling-scope',f'<hh:numberings itemCnt="2">{inner1}{inner2}</hh:numberings>'))
bullet=f'<hh:bullets itemCnt="1" xmlns:ns0="{HEAD}"><hh:bullet id="1" char="❏" useImage="0"><ns0:paraHead level="0" align="RIGHT" useInstWidth="0" autoIndent="0" widthAdjust="-12" textOffset="0" charPrIDRef="0"/></hh:bullet></hh:bullets>'
cases.append(make('bullet-collection',base,bullets=bullet))
cases.append(make('default-cleared-child',base.replace('hh:paraHead','paraHead').replace('<paraHead ', '<paraHead xmlns="" ').replace('<hh:numbering id=',f'<hh:numbering xmlns="{HEAD}" id=',1)))
cases.append(make('inherited-head-prefix-only',base.replace('hh:paraHead','n:paraHead').replace('<hh:numbering id=',f'<hh:numbering xmlns:n="{HEAD}" id=',1)))
# A real numbered body paragraph makes prefix rendering part of model/view checks.
numbered=make('alias-root-numbered-body',alias,f'xmlns:ns0="{HEAD}"')[1]
numbered=numbered.replace('<hh:heading type="NONE" idRef="0" level="0"/>','<hh:heading type="NUMBER" idRef="1" level="0"/>',1)
cases.append(('alias-root-numbered-body',numbered))
cases.append(make('undeclared-input-control',alias))
rows=[]
for name,h in cases:
 valid=True
 try:ET.fromstring(h)
 except ET.ParseError:valid=False
 assert valid==(name!='undeclared-input-control'),name
 p=out/(name+'.hwpx')
 with zipfile.ZipFile(p,'w')as z:
  for i,b in entries:z.writestr(i,h.encode()if i.filename=='Contents/header.xml'else b)
 rows.append({'case':name,'path':str(p.resolve()),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'inputXMLWellFormed':valid})
(out/'manifest.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps({'cases':len(rows),'wellFormedInputs':sum(r['inputXMLWellFormed']for r in rows),'seedSHA256':hashlib.sha256(seed.read_bytes()).hexdigest()}))
