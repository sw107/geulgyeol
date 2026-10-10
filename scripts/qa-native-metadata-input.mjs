// Read-only Native provenance consumers. Never execute binaries or create compatibility links.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const CASE_LIMIT=32*1024*1024, digestPattern=/^[a-f0-9]{64}$/;
function requiredDigest(value) {
 assert(typeof value==='string'&&digestPattern.test(value),'required SHA256 digest missing or malformed');return value;
}
async function fileSHA(file) {
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 return hash.digest('hex');
}
class Inputs {
 pins=new Map();
 limits=new Map();
 async pin(file,expected,limit=CASE_LIMIT) {
  const resolved=path.resolve(file),s=fs.lstatSync(resolved);
  assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=limit,'bounded regular evidence file required');
  assert.equal(fs.realpathSync(resolved),resolved,'canonical evidence path required');
  const hash=await fileSHA(resolved);
  if(expected!==undefined){assert(digestPattern.test(expected),'SHA256 required');assert.equal(hash,expected,'evidence SHA256 mismatch');}
  if(this.pins.has(resolved))assert.equal(hash,this.pins.get(resolved),'evidence changed during load');
  this.pins.set(resolved,hash);this.limits.set(resolved,Math.min(limit,this.limits.get(resolved)??limit));return hash;
 }
 async expected(file,expected,limit=CASE_LIMIT) {
  return this.pin(file,requiredDigest(expected),limit);
 }
 async json(file,limit=CASE_LIMIT) {
  await this.pin(file,undefined,limit);const value=JSON.parse(fs.readFileSync(file,'utf8'));
  await this.pin(file,undefined,limit);return value;
 }
 async phase(directory) {
  assert.equal(fs.realpathSync(directory),path.resolve(directory),'canonical phase required');
  const marker=await this.json(path.join(directory,'qa-evidence-status.json'),16383);
  assert.equal(marker.schema,1);assert.equal(marker.outcome,'complete','completed phase required');
  assert(typeof marker.root==='string'&&path.isAbsolute(marker.root),'absolute phase root required');
  const root=fs.realpathSync(marker.root),relative=path.relative(root,fs.realpathSync(directory));
  assert(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'phase within recorded root required');
  return root;
 }
 async unchanged() {
  for(const [file,pin] of this.pins)await this.pin(file,pin,this.limits.get(file));
 }
}
function nativePath(file) {
 assert(typeof file==='string'&&path.isAbsolute(file),'absolute Native metadata path required');
 assert.equal(fs.realpathSync(file),file,'canonical Native metadata path required');return file;
}
export async function openNativeSourceEvidence({nativeRoot,seedsFile,baselineRoot}) {
 nativeRoot=path.resolve(nativeRoot);baselineRoot=path.resolve(baselineRoot);
 const input=new Inputs(),sourcePhase=path.dirname(nativeRoot);
 assert.equal(await input.phase(sourcePhase),await input.phase(baselineRoot),'same whole-run source/baseline root required');
 const nativeProcessFile=path.join(sourcePhase,'native-source-process.json');
 const process=await input.json(nativeProcessFile),baselineProof=await input.json(path.join(baselineRoot,'proof.json'));
 assert.equal(process.mode,'source');assert.equal(process.complete,true,'complete source proof required');
 assert.equal(baselineProof.mode,'baseline');assert.equal(baselineProof.complete,true,'complete baseline proof required');
 const seeds=await input.json(seedsFile),seedPin=input.pins.get(path.resolve(seedsFile));
 assert.equal(process.seedIndexSHA256,seedPin);assert.equal(baselineProof.seedIndexSHA256,seedPin);
 const nativeBinary=nativePath(process.nativeBinary);
 const nativePin=await input.expected(nativeBinary,process.nativeSHA256Before,512*1024*1024);
 assert.equal(requiredDigest(process.nativeSHA256After),nativePin);
 assert(Array.isArray(seeds)&&seeds.length>0&&seeds.length<=128,'bounded source plan required');
 assert(Array.isArray(process.rows)&&Array.isArray(baselineProof.rows),'source/baseline rows required');
 assert.equal(process.cases,seeds.length*2);assert.equal(process.rows.length,process.cases);
 assert.equal(baselineProof.cases,process.cases);assert.equal(baselineProof.rows.length,process.cases);
 const labels=new Set();let i=0,bodyRuns=0;
 for(const seed of seeds) {
  assert(typeof seed.label==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(seed.label),'safe label required');
  assert(!labels.has(seed.label),'unique source label required');labels.add(seed.label);
  assert.deepEqual(Object.keys(seed.files).sort(),['hwp','hwpx']);
  for(const format of ['hwp','hwpx']) {
   const row=process.rows[i],baselineRow=baselineProof.rows[i++],stem=seed.label+'-'+format;
   assert.equal(row.label,seed.label);assert.equal(row.format,format);assert.equal(row.exitCode,0,'successful Native exit required');
   assert.equal(row.nativeSHA256,nativePin);assert(Array.isArray(row.command)&&row.command.length===3,'Native source command required');
   assert.equal(row.command[0],nativeBinary,'Native command must match metadata');
   assert(typeof seed.files[format]==='string'&&path.isAbsolute(seed.files[format]),'absolute planned source required');
   const source=fs.realpathSync(seed.files[format]);assert.equal(row.command[1],source);
   const sourcePin=await input.expected(source,row.sourceSHA256Before);assert.equal(requiredDigest(row.sourceSHA256After),sourcePin);
   const ledgerFile=path.join(nativeRoot,stem,'ledger.json');await input.expected(ledgerFile,row.ledgerSHA256);
   const ledger=await input.json(ledgerFile);await input.expected(path.join(nativeRoot,stem+'.log'),row.logSHA256);
   const oracleFile=path.join(baselineRoot,stem+'.json'),oracle=await input.json(oracleFile);
   assert.equal(baselineRow.label,stem);assert.equal(baselineRow.oracleSHA256,input.pins.get(oracleFile));
   assert.equal(baselineRow.nativeLedgerSHA256,row.ledgerSHA256);assert.equal(baselineRow.sourceSHA256,sourcePin);
   assert.equal(oracle.label,stem);assert.equal(oracle.readOnly,true);
   assert.equal(oracle.nativeLedgerSHA256,row.ledgerSHA256);assert.equal(oracle.sourceSHA256,sourcePin);
   assert(Array.isArray(oracle.pages)&&Array.isArray(oracle.runs)&&Array.isArray(ledger.pages),'Native pages and runs required');
   assert.equal(baselineRow.runs,oracle.runs.length);bodyRuns+=oracle.runs.length;
   assert.deepEqual(oracle.pages.map(p=>p.page),ledger.pages.map(p=>p.page));
   const pages=new Set();
   for(const page of oracle.pages) {
    assert(Number.isSafeInteger(page.page)&&page.page>=0&&!pages.has(page.page),'unique Native page required');pages.add(page.page);
    await input.expected(path.join(nativeRoot,stem,'page-'+page.page+'.svg'),page.svgSHA256,16*1024*1024);
   }
  }
 }
 assert.equal(baselineProof.nativeBodyRuns,bodyRuns);await input.unchanged();
 return {nativeBinary,nativePin,nativeProcess:process,nativeProcessFile,
  nativeProcessSHA256:input.pins.get(nativeProcessFile),verifyUnchanged:()=>input.unchanged(),inputFiles:input.pins.size};
}
export async function openNativeSavedEvidence({phase,nativeBinary,processFile}) {
 phase=path.resolve(phase);const input=new Inputs();await input.phase(phase);
 const status=await input.json(path.join(phase,'native-wrapper-status.json'));
 assert.equal(status.complete,true,'complete Native wrapper required');
 const processRecord=await input.json(processFile??path.join(phase,'native-process.json'));
 assert.equal(processRecord.schema,1);assert.equal(processRecord.exitCode,0,'successful whole Native wrapper exit required');
 assert.equal(processRecord.phase,phase,'wrapper process must identify this phase');
 assert(Array.isArray(processRecord.command)&&processRecord.command.length===7,'recorded Native wrapper command required');
 assert.equal(path.basename(processRecord.command[2]),'shard-electron-table-manifest.py');
 assert.equal(processRecord.command[4],phase);assert.equal(processRecord.command[5],nativePath(nativeBinary));
 assert.equal(processRecord.command[6],'--scratch');
 const indexFile=path.join(phase,'index.json');await input.expected(indexFile,processRecord.indexSHA256);
 const index=await input.json(indexFile);
 assert.deepEqual(processRecord.wrapperSourceSHA256Before,processRecord.wrapperSourceSHA256After);
 assert(processRecord.wrapperSourceSHA256Before&&Object.keys(processRecord.wrapperSourceSHA256Before).length>0,'process wrapper source pins required');
 for(const pin of Object.values(processRecord.wrapperSourceSHA256Before))requiredDigest(pin);
 assert.equal(requiredDigest(processRecord.sourceManifestSHA256Before),requiredDigest(index.sourceManifestSHA256));
 assert.equal(requiredDigest(processRecord.sourceManifestSHA256After),index.sourceManifestSHA256);
 await input.expected(processRecord.command[3],index.sourceManifestSHA256);
 assert.equal(requiredDigest(processRecord.nativeSHA256Before),requiredDigest(index.nativeSHA256));
 assert.equal(requiredDigest(processRecord.nativeSHA256After),index.nativeSHA256);
 assert.equal(index.verificationInputsUnchanged,true);assert.equal(index.scratchIsCanonicalEvidence,false);
 assert.deepEqual(index.qaSourceBeforeSHA256,index.qaSourceAfterSHA256);
 for(const [name,pin] of Object.entries(index.qaSourceBeforeSHA256??{}))assert.equal(pin,processRecord.wrapperSourceSHA256Before[name]);
 assert(index.qaSourceBeforeSHA256&&Object.keys(index.qaSourceBeforeSHA256).length>0,'wrapper source pins required');
 for(const pin of Object.values(index.qaSourceBeforeSHA256))assert(digestPattern.test(pin),'wrapper SHA256 required');
 assert(digestPattern.test(index.sourceManifestSHA256)&&digestPattern.test(index.sourceUncompressedSHA256),'manifest pins required');
 const nativePin=await input.expected(nativePath(nativeBinary),index.nativeSHA256,512*1024*1024);
 assert(Array.isArray(index.rows)&&index.rows.length>0,'nonempty Native saved index required');
 assert.equal(index.cases,index.rows.length);assert.equal(status.cases,index.cases);
 const identities=new Set();
 for(const row of index.rows) {
  assert.equal(row.nativeExitCode,0,'successful Native saved exit required');assert.equal(row.nativeSame,true);
  assert.equal(row.overflowWarnings,0);assert(typeof row.savedFile==='string'&&!identities.has(row.savedFile),'unique saved identity required');identities.add(row.savedFile);
  assert(digestPattern.test(row.savedSHA256)&&digestPattern.test(row.manifestSHA256),'saved input pins required');
 }
 await input.unchanged();return {cases:index.cases,nativePin,inputFiles:input.pins.size,verifyUnchanged:()=>input.unchanged()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [mode,a,b,c]=process.argv.slice(2);let evidence;
 if(mode==='source')evidence=await openNativeSourceEvidence({nativeRoot:a,seedsFile:b,baselineRoot:c});
 else {assert.equal(mode,'saved','source or saved mode required');evidence=await openNativeSavedEvidence({phase:a,nativeBinary:b});}
 await evidence.verifyUnchanged();console.log(JSON.stringify({mode,cases:evidence.cases??evidence.nativeProcess.cases,
  nativeSHA256:evidence.nativePin,inputFiles:evidence.inputFiles,metadataValidated:true,layoutReverified:false}));
}
