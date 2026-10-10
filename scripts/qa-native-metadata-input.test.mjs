import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {openNativeSourceEvidence,openNativeSavedEvidence} from './qa-native-metadata-input.mjs';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-native-metadata-synthetic-')));
console.log('SYNTHETIC_EVIDENCE_ROOT='+root);let serial=0;
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const json=(f,value)=>fs.writeFileSync(f,JSON.stringify(value));
const edit=(f,mutate)=>{const value=JSON.parse(fs.readFileSync(f));mutate(value);json(f,value);};
function fixture() {
 const q=path.join(root,String(serial++));fs.mkdirSync(q);
 const source=path.join(q,'source'),nativeRoot=path.join(source,'native-source'),baseline=path.join(q,'baseline');
 fs.mkdirSync(nativeRoot,{recursive:true});fs.mkdirSync(baseline);
 const binary=path.join(q,'actual-fake-native');fs.writeFileSync(binary,'fake bytes, never executed');
 const marker=d=>json(path.join(d,'qa-evidence-status.json'),{schema:1,outcome:'complete',root:q});marker(source);marker(baseline);
 const files={};for(const format of ['hwp','hwpx']){files[format]=path.join(q,'input.'+format);fs.writeFileSync(files[format],'synthetic '+format);}
 const seedsFile=path.join(q,'seeds.json');json(seedsFile,[{label:'fixture',files}]);
 const rows=[],baselineRows=[];
 for(const format of ['hwp','hwpx']) {
  const stem='fixture-'+format,dest=path.join(nativeRoot,stem);fs.mkdirSync(dest);
  const ledger=path.join(dest,'ledger.json');json(ledger,{pages:[{page:0,text:{runs:[]}}]});
  const svg=path.join(dest,'page-0.svg');fs.writeFileSync(svg,'<svg/>');
  const log=path.join(nativeRoot,stem+'.log');fs.writeFileSync(log,'synthetic');
  const oracle=path.join(baseline,stem+'.json');json(oracle,{label:stem,nativeLedgerSHA256:sha(ledger),sourceSHA256:sha(files[format]),
   readOnly:true,runs:[],pages:[{page:0,svgSHA256:sha(svg)}]});
  rows.push({label:'fixture',format,exitCode:0,nativeSHA256:sha(binary),command:[binary,files[format],dest],
   sourceSHA256Before:sha(files[format]),sourceSHA256After:sha(files[format]),ledgerSHA256:sha(ledger),logSHA256:sha(log)});
  baselineRows.push({label:stem,runs:0,oracleSHA256:sha(oracle),nativeLedgerSHA256:sha(ledger),sourceSHA256:sha(files[format])});
 }
 const processFile=path.join(source,'native-source-process.json');json(processFile,{mode:'source',complete:true,cases:2,
  seedIndexSHA256:sha(seedsFile),nativeBinary:binary,nativeSHA256Before:sha(binary),nativeSHA256After:sha(binary),rows});
 json(path.join(baseline,'proof.json'),{mode:'baseline',complete:true,cases:2,seedIndexSHA256:sha(seedsFile),nativeBodyRuns:0,rows:baselineRows});
 return {q,source,baseline,nativeRoot,seedsFile,binary,files,processFile,
  load:()=>openNativeSourceEvidence({nativeRoot,seedsFile,baselineRoot:baseline})};
}
test('metadata path succeeds without a legacy compatibility binary or executing fake bytes',async()=>{
 const f=fixture(),before=sha(f.processFile),e=await f.load();
 assert.equal(e.nativeBinary,f.binary);assert.equal(e.nativePin,sha(f.binary));
 assert(!fs.existsSync(path.join(f.source,'native/debug/examples/three_column_owner_check')));
 await e.verifyUnchanged();assert.equal(sha(f.processFile),before);
});
for(const [name,mutate] of [
 ['missing metadata cannot fall back to a present legacy hardlink',f=>{const d=path.join(f.source,'native/debug/examples');fs.mkdirSync(d,{recursive:true});fs.linkSync(f.binary,path.join(d,'three_column_owner_check'));edit(f.processFile,p=>delete p.nativeBinary);}],
 ['relative Native metadata path',f=>edit(f.processFile,p=>p.nativeBinary='actual-fake-native')],
 ['wrong Native before SHA',f=>edit(f.processFile,p=>p.nativeSHA256Before='0'.repeat(64))],
 ['wrong Native after SHA',f=>edit(f.processFile,p=>p.nativeSHA256After='0'.repeat(64))],
 ['Native command disagrees with metadata',f=>edit(f.processFile,p=>p.rows[0].command[0]=f.seedsFile)],
 ['failed Native exit code',f=>edit(f.processFile,p=>p.rows[0].exitCode=1)],
 ['incomplete source proof',f=>edit(f.processFile,p=>p.complete=false)],
 ['running source marker',f=>edit(path.join(f.source,'qa-evidence-status.json'),p=>p.outcome='running')],
 ['failed baseline marker',f=>edit(path.join(f.baseline,'qa-evidence-status.json'),p=>p.outcome='failed')],
 ['changed source bytes',f=>fs.appendFileSync(f.files.hwp,'changed')],
 ['changed ledger bytes',f=>fs.appendFileSync(path.join(f.nativeRoot,'fixture-hwp/ledger.json'),' ')],
 ['changed baseline oracle',f=>fs.appendFileSync(path.join(f.baseline,'fixture-hwp.json'),' ')],
 ['changed Native SVG',f=>fs.appendFileSync(path.join(f.nativeRoot,'fixture-hwp/page-0.svg'),' ')],
 ['duplicate source identity despite counts',f=>edit(f.processFile,p=>p.rows[1]=p.rows[0])],
 ['incorrect source case count',f=>edit(f.processFile,p=>p.cases=1)],
 ['incorrect baseline ledger pin',f=>edit(path.join(f.baseline,'proof.json'),p=>p.rows[0].nativeLedgerSHA256='0'.repeat(64))]
])test(name+' is rejected read only',async()=>{
 const f=fixture();mutate(f);const pin=sha(f.processFile);await assert.rejects(f.load());assert.equal(sha(f.processFile),pin);
});
for(const [name,file] of [['Native',f=>f.binary],['process proof',f=>f.processFile],['source marker',f=>path.join(f.source,'qa-evidence-status.json')],['source',f=>f.files.hwpx]])
 test(name+' mutation during consumption rejects final unchanged check',async()=>{
  const f=fixture(),e=await f.load();fs.appendFileSync(file(f),' ');await assert.rejects(e.verifyUnchanged());
 });
function savedFixture() {
 const q=path.join(root,String(serial++));fs.mkdirSync(q);const phase=path.join(q,'saved');fs.mkdirSync(phase);
 const binary=path.join(q,'actual-fake-native');fs.writeFileSync(binary,'never executed');
 json(path.join(phase,'qa-evidence-status.json'),{schema:1,outcome:'complete',root:q});
 json(path.join(phase,'native-wrapper-status.json'),{complete:true,cases:1});
 const manifest=path.join(q,'manifest.json');fs.writeFileSync(manifest,'synthetic manifest');
 const indexFile=path.join(phase,'index.json'),pin=sha(binary);json(indexFile,{cases:1,nativeSHA256:pin,
  verificationInputsUnchanged:true,scratchIsCanonicalEvidence:false,qaSourceBeforeSHA256:{wrapper:pin},qaSourceAfterSHA256:{wrapper:pin},
  sourceManifestSHA256:sha(manifest),sourceUncompressedSHA256:sha(manifest),
  rows:[{savedFile:'case.hwp',savedSHA256:pin,manifestSHA256:pin,nativeExitCode:0,nativeSame:true,overflowWarnings:0}]});
 const processFile=path.join(phase,'native-process.json');json(processFile,{schema:1,phase,exitCode:0,indexSHA256:sha(indexFile),
  command:[process.execPath,'-B',path.join(q,'shard-electron-table-manifest.py'),manifest,phase,binary,'--scratch'],
  wrapperSourceSHA256Before:{wrapper:pin},wrapperSourceSHA256After:{wrapper:pin},
  sourceManifestSHA256Before:sha(manifest),sourceManifestSHA256After:sha(manifest),nativeSHA256Before:pin,nativeSHA256After:pin});
 return {phase,binary,indexFile,processFile,rebind:()=>edit(processFile,p=>p.indexSHA256=sha(indexFile)),load:()=>openNativeSavedEvidence({phase,nativeBinary:binary})};
}
test('saved consumer requires completed wrapper, phase and successful Native rows',async()=>{
 const f=savedFixture(),e=await f.load();assert.equal(e.cases,1);await e.verifyUnchanged();
});
for(const [name,mutate] of [
 ['retained index after failed finalization',f=>edit(path.join(f.phase,'qa-evidence-status.json'),p=>p.outcome='failed')],
 ['missing phase marker',f=>fs.renameSync(path.join(f.phase,'qa-evidence-status.json'),path.join(f.phase,'preserved-marker'))],
 ['incomplete wrapper status',f=>edit(path.join(f.phase,'native-wrapper-status.json'),p=>p.complete=false)],
 ['nonzero saved Native exit',f=>edit(f.indexFile,p=>p.rows[0].nativeExitCode=1)],
 ['wrong saved Native pin',f=>edit(f.indexFile,p=>p.nativeSHA256='0'.repeat(64))],
 ['inconsistent saved count',f=>edit(f.indexFile,p=>p.cases=2)]
])test(name+' cannot treat index presence as success',async()=>{
 const f=savedFixture();mutate(f);f.rebind();const pin=sha(f.indexFile);await assert.rejects(f.load());assert.equal(sha(f.indexFile),pin);
});
test('saved marker mutation during consumption is rejected',async()=>{
 const f=savedFixture(),e=await f.load();edit(path.join(f.phase,'qa-evidence-status.json'),p=>p.outcome='failed');await assert.rejects(e.verifyUnchanged());
});

// Required pins may never be treated as an optional initial hash request.
for(const [name,where,field,saved] of [
 ['Native before',p=>p,'nativeSHA256Before',false],
 ['source before',p=>p.rows[0],'sourceSHA256Before',false],
 ['source log',p=>p.rows[0],'logSHA256',false],
 ['source ledger',p=>p.rows[0],'ledgerSHA256',false],
 ['saved Native',p=>p,'nativeSHA256',true],
])for(const [variant,value] of [['missing',undefined],['empty',''],['malformed','invalid-sha']])
 test(name+' '+variant+' digest is required',async()=>{
  const f=saved?savedFixture():fixture(),file=saved?f.indexFile:f.processFile;
  edit(file,p=>{if(value===undefined)delete where(p)[field];else where(p)[field]=value;});
  if(saved)f.rebind();await assert.rejects(f.load(),/required SHA256/);
 });
for(const [name,mutate] of [
 ['nonzero whole wrapper exit',f=>edit(f.processFile,p=>p.exitCode=1)],
 ['missing whole process record',f=>fs.renameSync(f.processFile,f.processFile+'.preserved')],
 ['wrong process phase',f=>edit(f.processFile,p=>p.phase=path.dirname(f.phase))],
 ['missing index process pin',f=>edit(f.processFile,p=>delete p.indexSHA256)],
 ['missing process Native pin',f=>edit(f.processFile,p=>delete p.nativeSHA256Before)],
 ['wrong process Native command',f=>edit(f.processFile,p=>p.command[5]=f.indexFile)],
])test(name+' cannot infer whole wrapper success from complete index',async()=>{
 const f=savedFixture();mutate(f);const pin=sha(f.indexFile);await assert.rejects(f.load());assert.equal(sha(f.indexFile),pin);
});
test('whole process record mutation is rejected after loading',async()=>{
 const f=savedFixture(),e=await f.load();edit(f.processFile,p=>p.exitCode=1);await assert.rejects(e.verifyUnchanged());
});
for(const failure of [false,true])test('real coordinator records own whole wrapper '+(failure?'failed':'successful')+' exit with fake Native only',async()=>{
 const q=path.join(root,String(serial++));fs.mkdirSync(q);
 const source=path.join(q,'saved.hwpx');fs.writeFileSync(source,'synthetic document');
 const manifest=path.join(q,'manifest.json');json(manifest,[{file:source,svg:['<svg/>'],pageCount:1}]);
 const binary=path.join(q,'fake-native.py');fs.writeFileSync(binary,'#!/usr/bin/env python3\nimport sys\nfrom pathlib import Path\nPath(sys.argv[2]).mkdir()\nraise SystemExit('+ (failure?1:0) +')\n');fs.chmodSync(binary,0o700);
 const phase=path.join(q,'phase');const script=path.join(import.meta.dirname,'run-native-saved-qa.py');
 const r=spawnSync('python3',['-B',script,manifest,phase,binary],{encoding:'utf8',timeout:15000,
  env:{...process.env,GEULGYEOL_QA_BUDGET_ROOT:q,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,failure?1:0,r.stderr);const record=JSON.parse(fs.readFileSync(path.join(phase,'native-process.json')));
 assert.equal(record.exitCode,failure?1:0);assert.equal(record.phase,phase);
 if(failure)await assert.rejects(openNativeSavedEvidence({phase,nativeBinary:binary}));
 else {const e=await openNativeSavedEvidence({phase,nativeBinary:binary});assert.equal(e.cases,1);await e.verifyUnchanged();}
});
