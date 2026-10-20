"""Namespace-aware metadata oracle; no schema/Hancom validity claim."""
from pathlib import Path
from io import BytesIO
import xml.etree.ElementTree as ET,json,zipfile,sys
mode,manifest,rawfile,report=sys.argv[1:];HEAD='http://www.hancom.co.kr/hwpml/2011/head';rows=[];failures=[]
def header(p):
 with zipfile.ZipFile(p)as z:return z.read('Contents/header.xml')
def metadata(b):
 contexts={};stack=[{}];pending=[];root=None
 for event,x in ET.iterparse(BytesIO(b),events=['start-ns','start','end']):
  if event=='start-ns':pending.append(x)
  elif event=='start':
   c={**stack[-1],**dict(pending)};pending=[];contexts[id(x)]=c;stack.append(c)
   if root is None:root=x
  else:stack.pop()
 def tree(e):
  qnames=[]
  for k,v in sorted(e.attrib.items()):
   if k.startswith('{urn:')and k.endswith('}type'):
    prefix,local=v.split(':',1)if':'in v else('',v);qnames.append([k,contexts[id(e)].get(prefix),local])
  return[e.tag,sorted(e.attrib.items()),e.text,e.tail,qnames,[tree(c)for c in e]]
 ref=next(c for c in root if c.tag=='{'+HEAD+'}refList');children=list(root);return{'memo':[tree(c)for c in ref if c.tag=='{'+HEAD+'}memoProperties'],'tailText':ref.tail,'tail':[tree(c)for c in children[children.index(ref)+1:]]}
fixtures={f['case']:f for f in json.loads(Path(manifest).read_text())};raw=json.loads(Path(rawfile).read_text())
for case in raw['rows']:
 f=fixtures[case['case']];expected=metadata(header(f['path']))if f['inputXMLWellFormed']else None
 for s in case['states']:
  if'file'not in s:
   row={'case':f['case'],'stage':s['stage'],'kind':'export/reopen not completed','detail':s.get('reopenError',s.get('exportError'))};rows.append(row);failures.append(row);continue
  error=None;actual=None
  try:actual=metadata(header(s['file']))
  except(ET.ParseError,StopIteration)as e:error=str(e)
  ok=error is not None if expected is None else(error is None and actual==expected)
  row={'case':f['case'],'stage':s['stage'],'file':s['file'],'inputXMLWellFormed':f['inputXMLWellFormed'],'outputMetadataParsed':error is None,'memoPreserved':actual['memo']==expected['memo']if expected is not None and actual is not None else None,'tailPreserved':(actual['tail']==expected['tail']and actual['tailText']==expected['tailText'])if expected is not None and actual is not None else None,'sourceExpandedNamesContentAndQNameContextPreserved':ok if expected is not None else None,'negativeControlNotGuessed':error is not None if expected is None else None,'error':error}
  rows.append(row)
  if not ok:failures.append(row)
assert len(rows)==len(fixtures)*6
out={'mode':mode,'cases':len(fixtures),'states':len(rows),'exportedArchives':sum('file'in r for r in rows),'unexpectedFailures':len(failures),'failures':failures,'rows':rows,'scope':'Expanded XML element/attribute names, exact memo/settings content, tail text, and synthetic QName-valued attributes. Comments/CDATA are parsed structurally; no schema certification or input repair.'};Path(report).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items()if k not in['rows','failures']}));assert mode=='observe'or not failures
