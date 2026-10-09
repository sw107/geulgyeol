#!/usr/bin/env python3
"""Compare source owner paragraphs and physical fragment ownership, not page counts.
Usage: check-mixed-owner-ledger.py LEDGER_JSON CUT_LOG FRESH_PROOF_JSON
The ledger comes from the independent mixed_table_owner_probe Native example.
"""
import hashlib,json,re,sys
from pathlib import Path
ledger_path,log_path,out=map(Path,sys.argv[1:4]);assert not out.exists()
d=json.loads(ledger_path.read_text());owners=d['owners'];header_rows={r for o in owners if o['header'] for r in range(o['rowStart'],o['rowEnd'])};leading=0
while leading in header_rows: leading+=1
norm=lambda s: ''.join(s.split());proof=[]
for owner in owners:
 fragments=[];all_paras={i:[] for i in range(len(owner['paragraphs']))};is_header=owner['rowStart']<leading
 for page in d['pages']:
  runs=[r for r in page['text']['runs'] if r.get('cellPath') and r.get('cellIdx')==owner['cell'] and r.get('controlIdx')==d['target']['control'] and r.get('parentParaIdx')==d['target']['para']]
  runs.sort(key=lambda r:(r['cellParaIdx'],r['charStart']));per_para={i:[] for i in all_paras}
  for run in runs: per_para[run['cellParaIdx']].append(run['text']);all_paras[run['cellParaIdx']].append(run['text'])
  controls=[t for t in page['controls']['controls'] if t['type']=='table' and t['paraIdx']==d['target']['para'] and t['controlIdx']==d['target']['control']]
  cells=[c for t in controls for c in t['cells'] if c['cellIdx']==owner['cell']]
  if is_header and cells:
   for i,text in enumerate(owner['paragraphs']): assert norm(''.join(per_para[i]))==norm(text),('header',owner['cell'],page['page'],i)
  if runs: fragments.append({'page':page['page'],'paragraphs':sorted({r['cellParaIdx'] for r in runs}),'scalars':sum(len(norm(r['text'])) for r in runs)})
 if not is_header:
  for i,text in enumerate(owner['paragraphs']):assert norm(''.join(all_paras[i]))==norm(text),(owner['cell'],i,'missing/duplicate/reordered source text')
 proof.append({k:owner[k] for k in ['cell','rowStart','rowEnd','colStart','colEnd']}|{'repeatedLeadingHeader':is_header,'fragments':fragments,'exactSourceParagraphOwnership':True})
pattern=r'MIXED_OWNER_CUT block=(\d+)\.\.(\d+) start=(\[[^\]]*\]) end=(\[[^\]]*\]) height=([\d.]+) budget=([\d.]+)'
cuts=[];previous=None
for match in re.finditer(pattern,log_path.read_text()):
 lo,hi,start,end,height,budget=match.groups();start=json.loads(start);end=json.loads(end);height=float(height);budget=float(budget)
 if start and previous is not None:assert start==previous,'fragment starts exactly at preceding owner cut'
 assert all(e>=s for s,e in zip(start or [0]*len(end),end));assert height<=budget+.1,'cut stays within physical budget';previous=end
 cuts.append({'rowStart':int(lo),'rowEnd':int(hi),'start':start,'end':end,'height':height,'budget':budget})
assert cuts,'diagnostic owner cuts required'
out.write_text(json.dumps({'pages':len(d['pages']),'owners':proof,'cuts':cuts,'ownershipIssues':0,'existingRowCutCapacityFPEpsilonPx':0.1,'sourceLedgerSHA256':hashlib.sha256(ledger_path.read_bytes()).hexdigest(),'cutLogSHA256':hashlib.sha256(log_path.read_bytes()).hexdigest()},indent=2)+'\n');print(json.dumps({'pages':len(d['pages']),'owners':len(proof),'cuts':len(cuts),'ownershipIssues':0}))
