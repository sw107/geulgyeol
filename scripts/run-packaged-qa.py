#!/usr/bin/env python3
"""Run a fresh signed-app QA suite with separate raw Node/app process evidence.
Usage: run-packaged-qa.py QA_DIR SCRIPT_BASENAME APP_EXECUTABLE WASM_PKG [ARGS...]
"""
from datetime import datetime,timezone
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
qa,script,exe,engine=Path(sys.argv[1]).resolve(),sys.argv[2],Path(sys.argv[3]).resolve(),Path(sys.argv[4]).resolve()
assert Path(script).name==script and script.endswith('.mjs')
assert '.app/Contents/MacOS/' in str(exe) and exe.is_file()
qa.mkdir(parents=True,exist_ok=True);(qa/'files').mkdir(exist_ok=True)
record,log=qa/'harness-process.json',qa/'harness-process.log';assert not record.exists() and not log.exists() and not (qa/'lifecycle.json').exists()
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
asar=exe.parents[1]/'Resources/app.asar';before=sha(asar)
source_names=list(dict.fromkeys([script,'run-packaged-qa.py','packaged-electron-qa.mjs','electron-document-lifecycle-bootstrap.cjs']+(['write-electron-table-manifest.mjs'] if script=='check-electron-stored-merged-fragments.mjs' else [])))
sources={name:sha(root/'scripts'/name) for name in source_names}
command=['node',str(root/'scripts'/script),str(qa)]
env={**os.environ,'GEULGYEOL_QA_ENGINE_DIR':str(engine),'GEULGYEOL_QA_PACKAGED_APP':str(exe)}
if script=='check-electron-stored-merged-fragments.mjs':command.append(str(engine))
elif script=='check-packaged-ordinary-launch.mjs':command.extend([str(exe),sha(engine/'rhwp_bg.wasm'),*sys.argv[5:]])
else:command.extend([str(exe),*sys.argv[5:]])
seed_before=sha(Path(env['GEULGYEOL_HOST_SEEDS'])) if env.get('GEULGYEOL_HOST_SEEDS') else None
engine_before=sha(engine/'rhwp_bg.wasm')
start=datetime.now(timezone.utc).isoformat()
with log.open('w') as f:result=subprocess.run(command,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
life=json.loads((qa/'lifecycle.json').read_text()) if (qa/'lifecycle.json').exists() else None
app_codes=life.get('exitCodes',[life.get('exitCode')]) if life else []
after=sha(asar)
sources_after={name:sha(root/'scripts'/name) for name in source_names}
seed_after=sha(Path(env['GEULGYEOL_HOST_SEEDS'])) if env.get('GEULGYEOL_HOST_SEEDS') else None
engine_after=sha(engine/'rhwp_bg.wasm')
proof={'command':command,'startedUTC':start,'finishedUTC':datetime.now(timezone.utc).isoformat(),'nodeHarnessExitCode':result.returncode,'appExitCodes':app_codes,'appLifecycleFailure':life.get('failure') if life else None,'asarBeforeSHA256':before,'asarAfterSHA256':after,'asarUnchanged':before==after,'qaSourceSHA256':sources_after,'qaSourceBeforeSHA256':sources,'qaSourceAfterSHA256':sources_after,'qaSourcesUnchanged':sources==sources_after,'sourceSeedsBeforeSHA256':seed_before,'sourceSeedsAfterSHA256':seed_after,'sourceSeedsUnchanged':seed_before==seed_after,'engineBeforeSHA256':engine_before,'engineAfterSHA256':engine_after,'engineUnchanged':engine_before==engine_after,'gzipManifestRequested':env.get('GEULGYEOL_QA_GZIP_MANIFEST')=='1','engineSHA256':sha(engine/'rhwp_bg.wasm'),'hostSeedsSHA256':sha(Path(env['GEULGYEOL_HOST_SEEDS'])) if env.get('GEULGYEOL_HOST_SEEDS') else None,'fragmentOperation':env.get('GEULGYEOL_FRAGMENT_OPERATION')}
record.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof),flush=True)
assert before==after,'QA must never modify candidate ASAR'
if result.returncode==0:
 assert sources==sources_after and seed_before==seed_after and engine_before==engine_after,'QA sources or inputs changed during execution'
 assert app_codes and all(code==0 for code in app_codes) and not proof['appLifecycleFailure'],'complete app exit evidence required'
raise SystemExit(result.returncode if result.returncode>=0 else 1)
