"""Reuse a pinned private source-QA runtime without builds or original changes.
Usage: OLD_PHASE FRESH_PHASE WHOLE_RUN_ROOT [EXTERNAL_RUNTIME_PIN]
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import hashlib,json,os,subprocess

def sha(p):
    with Path(p).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()
old,new,root=[Path(p).resolve() for p in sys.argv[1:4]]
assert root.is_dir() and not new.exists()
assert new.is_relative_to(root) and new!=root
pin_file=Path(sys.argv[4]).resolve() if len(sys.argv)>4 else old/'runtime-pin.json'
pins=json.loads(pin_file.read_text())
assert all(sha(old/'runtime'/p)==pin for p,pin in pins['runtimeFilesSHA256'].items())
repo=Path(__file__).resolve().parent.parent
host=repo/'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
assert sha(host)==pins['hostElectronBinarySHA256']
request={'root':str(root),'normalForecastBytes':1048576,'failureForecastBytes':16384}
code="import {EvidenceBudget} from './scripts/qa-evidence-budget.mjs';const r=JSON.parse(process.argv[1]);console.log(JSON.stringify(new EvidenceBudget({root:r.root}).check(r)));"
preflight=json.loads(subprocess.check_output(['node','--input-type=module','-e',code,json.dumps(request)],cwd=repo,text=True))
new.mkdir(parents=True,exist_ok=False)
for p,pin in pins['runtimeFilesSHA256'].items():
    target=new/'runtime'/p;target.parent.mkdir(parents=True,exist_ok=True)
    os.link(old/'runtime'/p,target)
fonts=old/'runtime/web/studio/fonts'
assert fonts.is_symlink()
(new/'runtime/web/studio/fonts').symlink_to(os.readlink(fonts))
os.link(old/'bootstrap.cjs',new/'bootstrap.cjs')
(new/'files').mkdir()
assert all(sha(new/'runtime'/p)==pin for p,pin in pins['runtimeFilesSHA256'].items())
(new/'runtime-pin.json').write_text(json.dumps(pins,indent=2)+'\n')
proof={'reusedRuntimeFiles':len(pins['runtimeFilesSHA256']),'bootstrapSHA256':sha(new/'bootstrap.cjs'),'hostElectronBinarySHA256':sha(host),'sourceRuntimeSHA256':pins['sourceRuntimeSHA256'],'newBuild':False,'newPackage':False,'oldInputsUnchanged':True,'preflight':preflight}
(new/'reuse-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof),flush=True)
