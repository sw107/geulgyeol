"""Inspect every real export's HWP numbering bits and HWPX tokens; no normalization."""
import pathlib,json,struct,zlib,zipfile,xml.etree.ElementTree as ET,importlib.util,sys,hashlib
r=pathlib.Path(__file__).resolve().parents[1];spec=importlib.util.spec_from_file_location('cfb',r/'scripts/compare-find-document-serializers.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def hwp_heads(p,id):
 streams=m.cfb(p);records=m.records(zlib.decompress(streams['DocInfo'],-15));payload=[v[2] for v in records if v[0]==23][id-1];at=0;heads=[]
 for _ in range(7):
  attr,width,distance,charid,n=struct.unpack_from('<IhhIH',payload,at);at+=14;fmt=payload[at:at+2*n].decode('utf-16le');at+=2*n;heads.append({'attr':attr,'flags':attr&12,'width':width,'distance':distance,'charId':charid,'format':fmt})
 return heads

def xml_heads(p,id):
 with zipfile.ZipFile(p) as z:root=ET.fromstring(z.read('Contents/header.xml'))
 ns={'hh':'http://www.hancom.co.kr/hwpml/2011/head'};num=root.find(f'.//hh:numbering[@id="{id}"]',ns);assert num is not None
 return [dict(v.attrib,format=v.text or '') for v in num.findall('hh:paraHead',ns)]
def inspect(p,id):return hwp_heads(p,id) if p.suffix=='.hwp' else xml_heads(p,id)
def main():
 phase=pathlib.Path(sys.argv[1]);scope=sys.argv[2];mode=sys.argv[3];out=phase/scope;fixtures=json.loads((phase/'fixtures/proof.json').read_text());rows=[]
 if scope in ['baseline-wasm','fixed-wasm']:
  proof=json.loads((out/'proof.json').read_text());files=[(out/s['file'],row['numberingId'],row['expectedFlags'],row['source'],s['target'],s['file']) for row in proof['rows'] for s in row['stages']]
 else:
  proof=json.loads((out/'proof.json').read_text());files=[]
  for row in proof['rows']:
   f=next(v for v in fixtures['rows'] if v['name']==row['name']);prefix=row['name']+'-'+row['ext']
   for stage in (['original','typed','formatted','format-undone','format-redone'] if mode=='fixed' else ['original'])+["reopened-"+s['target'] for s in row['saved']]:
    if mode=='baseline' and stage in ['typed','formatted']:continue
    for target in ['hwp','hwpx']:files.append((out/'files'/(prefix+'-'+stage+'.'+target),f['numberingId'],f['expectedFlags'],row['ext'],target,stage))
 for p,id,expected,source,target,stage in files:
  values=inspect(p,id)
  if target=='hwp':
   wanted=expected if mode=='fixed' or source=='hwp' and stage=='original' else [0]*7
   assert [v['flags'] for v in values]==wanted,(p,values,wanted)
   assert values[0]['charId']==4294967295 and values[1]['charId']==0
  else:
   # Spliced HWPX preserves source lexical tokens until the first HWP bridge.
   bridged=('reopened-hwp' in stage) or (scope.endswith('wasm') and int(stage.split('-')[-1].split('.')[0])>=2)
   if mode=='baseline' and bridged:wanted=[0]*7
   elif mode=='baseline' and source=='hwp':wanted=expected
   else:wanted=expected
   for i,head in enumerate(values[:7]):
    for field,bit in [('useInstWidth',4),('autoIndent',8)]:
     token=head.get(field)
     # Omitted input keeps lexical omission before a HWP bridge; existing IR default is 0.
     if token is None:assert expected==[0]*7
     else:assert token in ['0','1','false','true'];assert (token in ['1','true'])==bool(wanted[i]&bit),(p,i,field,token,wanted)
   assert values[0]['charPrIDRef']=='4294967295' and values[1]['charPrIDRef']=='0'
  rows.append({'file':str(p.relative_to(phase)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'headValues':values})
 result={'scope':scope,'mode':mode,'verifiedExports':len(rows),'rows':rows,'noZeroDefaultSentinelNormalization':True}
 p=phase/(scope+'-export-proof.json');assert not p.exists();p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'scope':scope,'mode':mode,'verifiedExports':len(rows)}))
if __name__=='__main__':main()
