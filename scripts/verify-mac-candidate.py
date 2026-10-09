#!/usr/bin/env python3
"""Verify an isolated signed Mac candidate against its exact packaging source.
Usage: verify-mac-candidate.py QA_ROOT FRESH_PHASE
No ZIP, existing app, source file, or earlier evidence is modified.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,plistlib,re,struct,subprocess,sys
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parent.parent;q=Path(sys.argv[1]).resolve();phase=sys.argv[2];assert re.fullmatch(r'[a-z0-9-]+',phase)
package_proof=json.loads((q/'package-proof.json').read_text());app=Path(package_proof['app']);asar=app/'Contents/Resources/app.asar';out=q/(phase+'-verification.json');manifest_path=q/(phase+'-bundle-files.json');assert not out.exists() and not manifest_path.exists()
sha=lambda data:hashlib.sha256(data).hexdigest()
spec=importlib.util.spec_from_file_location('asar_helpers',root/'scripts/repackage-mac-candidate.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
header,contents=helper.read_archive(asar);raw=asar.read_bytes();fields=struct.unpack('<4I',raw[:16]);header_sha=sha(raw[16:16+fields[3]])
for name,node in helper.entries(header):
 integrity=node['integrity'];block=integrity['blockSize'];assert integrity['blocks']==[sha(contents[name][i:i+block]) for i in range(0,len(contents[name]),block)]
info=plistlib.loads((app/'Contents/Info.plist').read_bytes());package=json.loads(contents['package.json']);build=json.loads(contents['build-info.json']);product=package_proof['sourceCommit']
assert info['CFBundleShortVersionString']==info['CFBundleVersion']==package['version']==build['version']=='0.4.4-beta.3'
assert info['CFBundleIdentifier']=='org.geulgyeol.beta.0443';assert info['CFBundleExecutable']==package['productName']==build['product']=='GeulgyeolBeta3'
assert info['ElectronAsarIntegrity']['Resources/app.asar']['hash']==header_sha==package_proof['asarHeaderSHA256'];assert build['sourceCommit']==product;assert sha(raw)==package_proof['asarSHA256']
tracked=0;asset_sources=0
tracked_paths=set(subprocess.check_output(["git","ls-tree","-r","--name-only",product],cwd=root,text=True).splitlines())
for name,row in package_proof['files'].items():
 source=Path(row['source']);assert sha(contents[name])==row['sha256']==sha(source.read_bytes());assert build['files'][name]==row['sha256']
 if source.is_relative_to(root) and source.relative_to(root).as_posix() in tracked_paths:
  relative=source.relative_to(root).as_posix();assert contents[name]==subprocess.check_output(['git','show',product+':'+relative],cwd=root);tracked+=1
 else:asset_sources+=1
for name in contents:
 assert not any(part in ['node_modules','tests','.git','.env'] for part in name.split('/')) and 'dev-probe-plugin' not in name
js=[data for name,data in contents.items() if name.startswith('web/studio/assets/') and name.endswith('.js')]
assert js and all(b'window.__wasm' not in data and b'window.__inputHandler' not in data for data in js),'Production globals must not be exposed'
engines={name:sha(data) for name,data in contents.items() if 'rhwp_bg' in name and name.endswith('.wasm')};assert set(engines.values())=={package_proof['engineSHA256']}
buildproof=json.loads((q/'production/build-proof.json').read_text());assert buildproof['instrumentedQAReadOnlyExposures'] is False
for p in (app/'Contents/Frameworks').glob('*.app'):
 d=plistlib.loads((p/'Contents/Info.plist').read_bytes());assert d['CFBundleIdentifier'].startswith(info['CFBundleIdentifier']+'.helper');assert (p/'Contents/MacOS'/d['CFBundleExecutable']).is_file()
manifest={};size=0
for p in sorted(app.rglob('*')):
 name=p.relative_to(app).as_posix()
 if p.is_symlink():
  target=os.readlink(p);assert p.resolve().is_relative_to(app.resolve());manifest[name]={'type':'symlink','target':target,'sha256':sha(target.encode())}
 elif p.is_file():
  data=p.read_bytes();size+=len(data);manifest[name]={'type':'file','sha256':sha(data),'size':len(data),'mode':p.stat().st_mode&0o777}
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
signature=subprocess.run(['codesign','--verify','--deep','--strict','--verbose=2',str(app)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(q/(phase+'-signature-verify.log')).write_text(signature.stdout);assert signature.returncode==0
signature_info=subprocess.run(['codesign','-dv','--verbose=4',str(app)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(q/(phase+'-signature-details.log')).write_text(signature_info.stdout);assert signature_info.returncode==0
cdhash=re.search(r'^CDHash=(\w+)',signature_info.stdout,re.M).group(1);assert 'Signature=adhoc' in signature_info.stdout
arch=subprocess.check_output(['lipo','-archs',str(app/'Contents/MacOS'/info['CFBundleExecutable'])],text=True).strip();assert arch=='arm64'
result={'sourceProductSHA':product,'version':package['version'],'bundleId':info['CFBundleIdentifier'],'profileName':package['productName'],'architecture':arch,'asarSHA256':sha(raw),'asarHeaderSHA256':header_sha,'engineSHA256':engines,'allASAREntryAndBlockHashesValid':True,'allPackagedBytesMatchDeclaredSource':True,'trackedDesktopFilesMatchExactGitProductSHA':tracked,'generatedOrUntrackedAssetFilesMatchPinnedPackageSHA':asset_sources,'productionReadGlobalsAbsent':True,'bundleTreeSHA256':sha(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()),'bundleFileBytes':size,'bundleEntries':len(manifest),'asarEntries':len(contents),'codeResourcesSHA256':sha((app/'Contents/_CodeSignature/CodeResources').read_bytes()),'CDHash':cdhash,'strictDeepSignatureExitCode':signature.returncode,'signatureType':'ad-hoc','developerIDSigned':False,'notarized':False,'ZIPCreated':False}
out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
