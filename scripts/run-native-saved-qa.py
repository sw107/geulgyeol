"""Record the whole Native wrapper exit after its exact subprocess has returned.
Usage: MANIFEST_JSON FRESH_PHASE NATIVE_BINARY
Requires GEULGYEOL_QA_BUDGET_ROOT. Never changes prior evidence or clears markers.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import hashlib,json,os,subprocess
from datetime import datetime,timezone

def sha(p):
    with Path(p).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()
manifest,phase,native=[Path(p).resolve(strict=i!=1) for i,p in enumerate(sys.argv[1:4])]
assert len(sys.argv)==4 and not phase.exists() and phase.parent.is_dir()
assert os.environ.get('GEULGYEOL_QA_BUDGET_ROOT')
repo=Path(__file__).resolve().parent.parent
paths=[Path(__file__)]+[repo/'scripts'/p for p in ['shard-electron-table-manifest.py','native_qa_budget.py','qa-evidence-budget-bridge.mjs','qa-evidence-budget.mjs']]
pins={p.name:sha(p) for p in paths}
source_before,native_before=sha(manifest),sha(native)
command=[sys.executable,'-B',str(repo/'scripts/shard-electron-table-manifest.py'),str(manifest),str(phase),str(native),'--scratch']
started=datetime.now(timezone.utc).isoformat()
log=phase.parent/(phase.name+'-process.log')
with log.open('x') as stream:
    result=subprocess.run(command,cwd=repo,stdout=stream,stderr=subprocess.STDOUT)
# Exit is observed by this coordinator, not inferred from index presence or case exits.
record={'schema':1,'phase':str(phase),'command':command,'startedUTC':started,'finishedUTC':datetime.now(timezone.utc).isoformat(),
        'exitCode':result.returncode,'indexSHA256':sha(phase/'index.json') if (phase/'index.json').is_file() else None,
        'wrapperSourceSHA256Before':pins,'wrapperSourceSHA256After':{p.name:sha(p) for p in paths},
        'sourceManifestSHA256Before':source_before,'sourceManifestSHA256After':sha(manifest),
        'nativeSHA256Before':native_before,'nativeSHA256After':sha(native),'processLogSHA256':sha(log)}
assert phase.is_dir(), 'wrapper did not create its phase; log is retained'
payload=json.dumps(record,indent=2)+'\n';assert len(payload.encode())<16384
with (phase/'native-process.json').open('x') as stream:stream.write(payload)
print(json.dumps({'exitCode':result.returncode,'indexRecorded':record['indexSHA256'] is not None}),flush=True)
assert record['wrapperSourceSHA256Before']==record['wrapperSourceSHA256After']
assert record['sourceManifestSHA256Before']==record['sourceManifestSHA256After'] and record['nativeSHA256Before']==record['nativeSHA256After']
raise SystemExit(result.returncode if result.returncode>=0 else 1)
