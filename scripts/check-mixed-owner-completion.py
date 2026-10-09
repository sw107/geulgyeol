#!/usr/bin/env python3
"""Compare old/new Native completed-cut boundary, preserving every independent ledger.
Usage: check-mixed-owner-completion.py SEEDS_JSON NEW_PROBE OLD_PROBE FRESH_OUTPUT
"""
from pathlib import Path
import hashlib,json,os,re,subprocess,sys
seeds,new,old,out=Path(sys.argv[1]),Path(sys.argv[2]).resolve(),Path(sys.argv[3]).resolve(),Path(sys.argv[4]);assert not out.exists();out.mkdir(parents=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
root=Path(__file__).resolve().parent.parent
index=[]
for seed in json.loads(seeds.read_text()):
 for ext,file in seed['files'].items():
  pair={}
  for label,binary in [('old',old),('new',new)]:
   dest=out/(seed['label']+'-'+ext+'-'+label);log=dest.with_suffix('.log')
   env={**os.environ,'RHWP_DIAG_MIXED_OWNER':'1','RHWP_DIAG_MIXED_OWNER_SCAN':'1'}
   with log.open('w') as stream:r=subprocess.run([str(binary),file,str(dest)],env=env,stdout=stream,stderr=subprocess.STDOUT)
   assert r.returncode==0;d=json.loads((dest/'ledger.json').read_text());target=d['target'];table_pages=[];empty=[];hosts=[];header_instances=0;body_text={}
   for p in d['pages']:
    tables=[t for t in p['controls']['controls'] if t['type']=='table' and t['paraIdx']==target['para'] and t['controlIdx']==target['control']]
    runs=p['text']['runs'];body=[r for r in runs if r.get('cellPath') and r.get('cellIdx',0)>=2]
    if tables:
     table_pages.append(p['page']);header_instances+=len({r['cellIdx'] for r in runs if r.get('cellPath') and r.get('cellIdx',2)<2})
     if not body:empty.append(p['page'])
    host=[r for r in runs if not r.get('cellPath') and r['paraIdx']>=target['para']]
    for run in host:body_text.setdefault(run['paraIdx'],[]).append(run['text'])
    if host:hosts.append({'page':p['page'],'paras':sorted({r['paraIdx'] for r in host}),'y':min(r['y'] for r in host)})
   ledger_proof=dest/'ownership-proof.json'
   result=subprocess.run([sys.executable,str(root/'scripts/check-mixed-owner-ledger.py'),str(dest/'ledger.json'),str(log),str(ledger_proof)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
   assert result.returncode==0,result.stdout
   scans=[{'residual':float(a),'budget':float(b),'difference':float(a)-float(b)} for a,b in re.findall(r'residual=([\d.]+) budget=([\d.]+)',log.read_text())];edge=[v for v in scans if abs(v['difference'])<.2]
   pair[label]={'exitCode':r.returncode,'tablePages':table_pages,'emptyTablePages':empty,'headerCellInstances':header_instances,'trailingBody':hosts,'trailingBodyTextSHA256':hashlib.sha256(json.dumps({str(k):''.join(''.join(v).split()) for k,v in body_text.items()},sort_keys=True).encode()).hexdigest(),'nativeWarnings':log.read_text().count('LAYOUT_OVERFLOW'),'sourceLedgerSHA256':sha(dest/'ledger.json'),'cutLogSHA256':sha(log),'ownershipProofSHA256':sha(ledger_proof),'boundaryScans':edge}
   assert pair[label]['nativeWarnings']==0
   if label=='new':
    assert not empty and len(table_pages)==seed['expectedTablePages']
    assert header_instances==2*len(table_pages) and hosts and all(h['page']>=table_pages[-1] for h in hosts)
    assert len(edge)==1 and abs(edge[0]['difference']-seed['boundary']['residualMinusBudgetPx'])<1e-8
  assert pair['old']['trailingBodyTextSHA256']==pair['new']['trailingBodyTextSHA256'],'ordered trailing body text preserved'
  inside_over=0<seed['boundary']['residualMinusBudgetPx']<=.1
  assert bool(pair['old']['emptyTablePages'])==inside_over
  if inside_over:
   assert len(pair['old']['tablePages'])==len(pair['new']['tablePages'])+1
   assert pair['old']['headerCellInstances']==pair['new']['headerCellInstances']+2
   assert pair['old']['trailingBody'][0]['y']>pair['new']['trailingBody'][0]['y']
  index.append({'label':seed['label'],'format':ext,'sourceSHA256':sha(file),'expectedDifferencePx':seed['boundary']['residualMinusBudgetPx'],'pair':pair});print(json.dumps({'label':seed['label'],'format':ext,'oldEmpty':pair['old']['emptyTablePages'],'newEmpty':pair['new']['emptyTablePages']}),flush=True)
(out/'proof.json').write_text(json.dumps({'cases':len(index),'sourceSeedsSHA256':sha(seeds),'newNativeSHA256':sha(new),'oldNativeSHA256':sha(old),'rows':index},indent=2)+'\n')
