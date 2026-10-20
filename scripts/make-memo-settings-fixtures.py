"""Synthetic header copies only; no historical input repair or URI guessing."""
from pathlib import Path
import sys,re,json,zipfile,hashlib,xml.etree.ElementTree as ET
seed,out=map(Path,sys.argv[1:]);out.mkdir();HEAD='http://www.hancom.co.kr/hwpml/2011/head';PROBE='urn:probe'
with zipfile.ZipFile(seed)as z:entries=[(i,z.read(i.filename))for i in z.infolist()]
h=dict((i.filename,b)for i,b in entries)['Contents/header.xml'].decode()
h=re.sub(r'<hh:memoProperties\b.*?</hh:memoProperties>|<hh:memoProperties\b[^>]*/>','',h,flags=re.S)
# Header-only metadata has distinctive values so fallback replacement cannot pass.
memo='<hh:memoProperties itemCnt="1" xmlns:q="urn:probe"><hh:memoPr id="0" width="15591" lineWidth="5" lineType="DASH" lineColor="#A9A9A9" fillColor="#CBFF99" activeColor="#C0DBFB" memoType="NORMAL" q:note="메모 한글😀 &amp; 값"/><q:extra q:type="q:Kind">보존𐐷</q:extra></hh:memoProperties>'
tail='<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="원본/한글😀&amp;문서" pageInherit="1" footnoteInherit="1"/></hh:docOption><hh:trackchageConfig flags="56"/><q:settings xmlns:q="urn:settings" q:type="q:Kind">설정😀 &amp; 값</q:settings>'
h=h[:h.index('</hh:refList>')]+ '</hh:refList>'+tail+'</hh:head>'
canonical=h.replace('</hh:refList>',memo+'</hh:refList>',1)
def root(s,attrs):return s.replace('<hh:head ','<hh:head '+attrs+' ',1)
def change_memo(s,new):return s.replace(memo,new,1)
cases=[('canonical',canonical),('memo-alias-element',root(change_memo(canonical,memo.replace('hh:memo','n:memo')),f'xmlns:n="{HEAD}"'))]
without_q=memo.replace(' xmlns:q="urn:probe"','')
cases.append(('memo-root-binding',root(change_memo(canonical,without_q),'xmlns:q="urn:probe"')))
cases.append(('memo-ref-list-binding',change_memo(canonical,without_q).replace('<hh:refList>', '<hh:refList xmlns:q="urn:probe">',1)))
cases.append(('memo-default-parent',change_memo(canonical,memo.replace('hh:memo','memo')).replace('<hh:refList>',f'<hh:refList xmlns="{HEAD}">',1)))
cases.append(('memo-local-shadow',root(canonical,'xmlns:q="urn:outer"')))
empty='<hh:memoProperties itemCnt="0" xmlns:q="urn:probe" q:note="A>B &amp; 한😀"/>'
cases.append(('memo-empty-quoted-delimiter',change_memo(canonical,empty)))
cases.append(('memo-comment-decoy',canonical.replace(memo,'<!-- <hh:memoProperties itemCnt="99"/> -->'+memo,1)))
cases.append(('memo-empty-local',change_memo(canonical,empty.replace('A>B','A B'))))
# Tail QName references inherit root bindings; stripping the local binding is intentional.
inherited_tail=tail.replace(' xmlns:q="urn:settings"','')
cases.append(('tail-root-binding',root(canonical.replace(tail,inherited_tail),'xmlns:q="urn:settings"')))
default_tail=tail.replace('hh:','')
cases.append(('tail-default-root',root(canonical.replace(tail,default_tail),f'xmlns="{HEAD}"')))
boundary=canonical.replace('<hh:head ','<h:head ').replace('</hh:head>','</h:head>').replace('<hh:refList>','<r:refList>').replace('</hh:refList>','</r:refList>');boundary=boundary.replace('<h:head ',f'<h:head xmlns:h="{HEAD}" xmlns:r="{HEAD}" ',1)
cases.append(('alias-boundaries',boundary))
all_alias=canonical.replace('hh:','h:').replace('xmlns:hh=','xmlns:h=');cases.append(('all-head-alias',all_alias))
cases.append(('tail-comment-boundary-decoy',canonical.replace('</hh:refList>','<!-- </hh:refList> trap -->'+'</hh:refList>',1)))
cases.append(('tail-comment-end-decoy',canonical.replace(tail,'<!-- </hh:head> trap -->'+tail,1)))
qname=tail.replace('<hh:docOption>','<hh:docOption xmlns:q="urn:probe" q:type="UnprefixedKind">')
cases.append(('tail-default-qname-value',root(canonical.replace(tail,qname),'xmlns="urn:default-qname"')))
cases.append(('double-escaped-uri',root(change_memo(canonical,without_q),'xmlns:q="urn:probe?a=1&amp;amp;b=2"')))
unicode=all_alias.replace('h:', '머리:').replace('xmlns:h=', 'xmlns:머리=');unicode=unicode.replace(memo.replace('hh:','머리:'),empty.replace('hh:','메:')).replace('<머리:head ',f'<머리:head xmlns:메="{HEAD}" ',1);cases.append(('unicode-empty-alias',unicode))
cases.append(('absent-memo-empty-tail',canonical.replace(memo,'').replace(tail,'')))
sibling=change_memo(canonical,without_q).replace('<hh:refList>','<hh:refList xmlns:q="urn:memo">',1);sibling=root(sibling,'xmlns:q="urn:head"');cases.append(('memo-tail-scope-separation',sibling))
cases.append(('undeclared-input-control',change_memo(canonical,memo.replace('q:','missing:').replace(' xmlns:q="urn:probe"',''))))
rows=[]
for name,header in cases:
 valid=True
 try:ET.fromstring(header)
 except ET.ParseError:valid=False
 assert valid==(name!='undeclared-input-control'),name
 p=out/(name+'.hwpx')
 with zipfile.ZipFile(p,'w')as z:
  for info,b in entries:z.writestr(info,header.encode()if info.filename=='Contents/header.xml'else b)
 rows.append({'case':name,'path':str(p.resolve()),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'inputXMLWellFormed':valid})
(out/'manifest.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'cases':len(rows),'wellFormedInputs':sum(x['inputXMLWellFormed']for x in rows),'seedSHA256':hashlib.sha256(seed.read_bytes()).hexdigest()}))
