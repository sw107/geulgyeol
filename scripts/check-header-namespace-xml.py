"""Independent namespace-aware XML oracle, not schema/Hancom validation."""
from pathlib import Path
import sys,json,zipfile,xml.etree.ElementTree as ET
mode,manifest,outputs,report=sys.argv[1:];rows=[];failures=[];HEAD='http://www.hancom.co.kr/hwpml/2011/head'
def header(p):
 with zipfile.ZipFile(p)as z:return z.read('Contents/header.xml')
def tree(e):return[e.tag,sorted(e.attrib.items()),e.text,e.tail,[tree(c)for c in e]]
def signature(b):
 root=ET.fromstring(b);result=[]
 for name in ['numbering','bullet']:
  for e in root.iter('{'+HEAD+'}'+name):result.append([name,[tree(c)for c in e]])
 return result
for f in json.loads(Path(manifest).read_text()):
 original=header(f['path']);expected=signature(original)if f['inputXMLWellFormed']else None
 files=[p for p in sorted(Path(outputs).glob(f['case']+'-*.hwpx')) if p.stem[len(f['case'])+1:]in {'initial','grown','undo','redo',*(f'cycle{i}'for i in range(6))}]
 assert len(files)==6,(f['case'],len(files))
 for p in files:
  b=header(p);error=None;sig=None
  try:sig=signature(b)
  except ET.ParseError as e:error=str(e)
  ok=(error is not None)if expected is None else(error is None and sig==expected)
  row={'case':f['case'],'file':str(p),'inputWellFormed':f['inputXMLWellFormed'],'outputWellFormed':error is None,'originalNamespaceAndRawSubtreeSemanticsPreserved':ok if expected is not None else None,'error':error,'undeclaredInputNotGuessedOrRepaired':error is not None if expected is None else None}
  rows.append(row)
  if not ok:failures.append(row)
assert len(rows)==len(json.loads(Path(manifest).read_text()))*6
out={'mode':mode,'archives':len(rows),'inputCases':len(json.loads(Path(manifest).read_text())),'namespaceAwareXMLFailures':len(failures),'failures':failures,'rows':rows,'scope':'Python ElementTree expanded names, attributes and exact text/children of raw numbering/bullet subtrees; no HWPX schema or Hancom interoperability claim.'};Path(report).write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({**out,'rows':None,'failures':len(failures)}));assert mode=='observe'or not failures
