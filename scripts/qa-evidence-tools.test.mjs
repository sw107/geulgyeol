import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createTableManifestWriter,writeTableManifest} from './write-electron-table-manifest.mjs';
import {EvidenceBudget,evidenceFootprint} from './qa-evidence-budget.mjs';
import {CaretRunIndex,forEachBatch} from './qa-caret-run-index.mjs';

const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-qa-tools-synthetic-')));
console.log('SYNTHETIC_EVIDENCE_ROOT='+root);
let serial=0;
const fresh=()=>{const p=path.join(root,String(serial++));fs.mkdirSync(p);return p;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const status=q=>JSON.parse(fs.readFileSync(path.join(q,'manifest-status.json')));
const sample=[{file:'one.hwpx',svg:['<svg>가🙂</svg>'],pageCount:1},{file:'two.hwp',svg:['<svg>나</svg>'],pageCount:1}];

test('ordered cases retain exact UTF-8 JSON bytes and both hashes',async()=>{
 const q=fresh(),w=await createTableManifestWriter(q);
 for(const [i,row] of sample.entries())await w.append(row,i);
 const proof=await w.finish({expectedRecords:2});
 const packed=fs.readFileSync(path.join(q,proof.file)),raw=gunzipSync(packed);
 assert.deepEqual(JSON.parse(raw),sample);assert.equal(raw.toString(),JSON.stringify(sample));
 assert.equal(proof.uncompressedSHA256,sha(raw));assert.equal(proof.fileSHA256,sha(packed));
 assert.equal(proof.uncompressedBytes,raw.length);assert.equal(proof.records,2);
 assert.equal(status(q).complete,true);assert(!fs.existsSync(path.join(q,proof.file+'.partial')));
});
test('legacy raw-array and empty gzip formats remain readable',async()=>{
 const q=fresh();const proof=await writeTableManifest(q,sample,false);
 assert.equal(fs.readFileSync(path.join(q,proof.file),'utf8'),JSON.stringify(sample));
 const empty=fresh(),w=await createTableManifestWriter(empty);await w.finish({expectedRecords:0});
 assert.equal(gunzipSync(fs.readFileSync(path.join(empty,'manifest.json.gz'))).toString(),'[]');
});
for(const [label,exercise,match] of [
 ['missing record',async w=>{await w.append(sample[0]);await w.finish({expectedRecords:2});},/missing manifest records/],
 ['duplicate identity',async w=>{await w.append(sample[0]);await w.append(sample[0]);},/duplicate saved file/],
 ['out-of-order record',async w=>{await w.append(sample[0],1);},/manifest record order/],
 ['oversize case',async w=>{await w.append({file:'huge',svg:['x'.repeat(200)]});},/bounded case size/]
])test(label+' leaves explicit incomplete evidence',async()=>{
 const q=fresh(),w=await createTableManifestWriter(q,{maxRecordBytes:180});
 await assert.rejects(exercise(w),match);await w.abort(new Error(label));
 assert.equal(status(q).complete,false);assert.equal(status(q).incomplete,true);
 assert(!fs.existsSync(path.join(q,'manifest.json.gz')));
 assert(fs.existsSync(path.join(q,'manifest.json.gz.partial')));
});
test('write-budget failure cannot promote a canonical manifest',async()=>{
 const q=fresh();let fail=false;
 const w=await createTableManifestWriter(q,{beforeWrite:()=>{if(fail)throw Error('injected quota');}});
 await w.append(sample[0]);fail=true;
 await assert.rejects(w.append(sample[1]),/injected quota/);await w.abort(Error('quota'));
 assert.equal(status(q).records,1);assert.equal(status(q).complete,false);
 assert(!fs.existsSync(path.join(q,'manifest.json.gz')));
});
test('corrupted stored gzip is rejected by disk readback',async()=>{
 const q=fresh(),w=await createTableManifestWriter(q);
 await w.append(sample[0]);await new Promise(resolve=>setTimeout(resolve,10));
 const fd=fs.openSync(path.join(q,'manifest.json.gz.partial'),'r+');
 fs.writeSync(fd,Buffer.from('BAD'),0,3,0);fs.closeSync(fd);
 await assert.rejects(w.finish({expectedRecords:1}));await w.abort(Error('corrupt'));
 assert.equal(status(q).complete,false);assert(!fs.existsSync(path.join(q,'manifest.json.gz')));
});
test('fresh-output check preserves historical evidence',async()=>{
 const q=fresh(),p=path.join(q,'manifest.json.gz');fs.writeFileSync(p,'old immutable bytes');
 const pin=sha(fs.readFileSync(p));
 await assert.rejects(createTableManifestWriter(q),/fresh manifest/);
 assert.equal(sha(fs.readFileSync(p)),pin);
});
test('whole-run footprint deduplicates hardlinks and skips symlinks',()=>{
 const q=fresh(),f=path.join(q,'a');fs.writeFileSync(f,'x');
 fs.linkSync(f,path.join(q,'b'));fs.symlinkSync(root,path.join(q,'external'));
 const used=evidenceFootprint(q);assert.equal(used.normalBytes,fs.statSync(f).blocks*512);
});
test('preflight rejects normal forecast without creating status',()=>{
 const q=fresh(),phase=path.join(q,'phase');fs.mkdirSync(phase);const b=new EvidenceBudget({root:q,phase,normalLimit:1024,failureLimit:1024,requiredFreeBytes:0,freeBytes:()=>10000});
 assert.throws(()=>b.begin({normalForecastBytes:1025}),/normal evidence budget/);
 assert(!fs.existsSync(path.join(q,'qa-evidence-status.json')));
});
test('preflight rejects free-space deficit without creating status',()=>{
 const q=fresh(),phase=path.join(q,'phase');fs.mkdirSync(phase);const b=new EvidenceBudget({root:q,phase,requiredFreeBytes:100,freeBytes:()=>199});
 assert.throws(()=>b.begin({normalForecastBytes:100}),/insufficient free/);
 assert(!fs.existsSync(path.join(q,'qa-evidence-status.json')));
});
test('failed phase consumes failure quota and is not reset by the next phase',()=>{
 const q=fresh(),phase=path.join(q,'phase');fs.mkdirSync(phase);
 const b=new EvidenceBudget({root:q,phase,normalLimit:65536,failureLimit:8192,requiredFreeBytes:0,freeBytes:()=>1e9});
 b.begin({normalForecastBytes:1});fs.writeFileSync(path.join(phase,'case'),'x');b.mark('failed');
 const used=evidenceFootprint(q);assert(used.failureBytes>=8192);assert.equal(used.normalBytes,0);
 const next=path.join(q,'next');fs.mkdirSync(next);
 const nextBudget=new EvidenceBudget({root:q,phase:next,normalLimit:65536,failureLimit:8192,requiredFreeBytes:0,freeBytes:()=>1e9});
 assert.throws(()=>nextBudget.begin({failureForecastBytes:1}),/failure evidence budget/);
});
test('cross-root phase and non-finite forecasts are rejected',()=>{
 const q=fresh();
 assert.throws(()=>new EvidenceBudget({root:q,phase:root}),/phase must be within/);
 const b=new EvidenceBudget({root:q,requiredFreeBytes:0,freeBytes:()=>1e9});
 assert.throws(()=>b.check({normalForecastBytes:NaN}),/finite byte forecast/);
});
test('owner index preserves all inclusive boundary witnesses and Unicode lengths',()=>{
 const index=new CaretRunIndex();
 const runs=[{cellIdx:4,cellParaIdx:0,charStart:0,text:'A🙂B'},
  {cellIdx:4,cellParaIdx:0,charStart:3,text:'CD'},
  {cellIdx:5,cellParaIdx:0,charStart:0,text:'other'}];
 runs.forEach((r,page)=>index.add(r,page));
 assert.equal(index.query(4,0,3).length,2);
 assert.equal(index.query(4,0,3,0).length,1);assert.equal(index.query(4,0,4,0).length,0);
 for(let offset=0;offset<6;offset++)
  assert.deepEqual(index.query(4,0,offset).map(w=>w.run),
   runs.filter(r=>r.cellIdx===4&&r.cellParaIdx===0&&r.charStart<=offset&&offset<=r.charStart+[...r.text].length));
});
test('Native owner guard excludes nested and unrelated controls without hiding overlaps',()=>{
 const index=new CaretRunIndex({target:{para:2,control:3},native:true});
 const r={parentParaIdx:2,controlIdx:3,cellIdx:4,cellParaIdx:0,charStart:0,text:'🙂',cellPath:[{}]};
 index.add(r,0);index.add({...r,cellPath:[{},{}]},0);index.add({...r,parentParaIdx:1},0);
 index.add({...r,controlIdx:4},0);
 assert.equal(index.query(4,0,1,0).length,1);
});
test('small batches preserve order and yield between batches',async()=>{
 const order=[];let yielded=false;setImmediate(()=>{yielded=true;});
 function* values(){for(let i=0;i<257;i++)yield i;}
 const count=await forEachBatch(values(),(v,i)=>{assert.equal(v,i);order.push(v);if(i===128)assert(yielded);},128);
 assert.equal(count,257);assert.deepEqual(order,Array.from({length:257},(_,i)=>i));
});
test('batch failure stops without omitting or repeating the processed prefix',async()=>{
 const prefix=[];await assert.rejects(forEachBatch([0,1,2,3,4],v=>{
  if(v===3)throw Error('stop');prefix.push(v);
 },2),/stop/);assert.deepEqual(prefix,[0,1,2]);
});

test('initial writer-budget rejection closes streams and marks incomplete',async()=>{
 const q=fresh();await assert.rejects(createTableManifestWriter(q,{beforeWrite:()=>{throw Error('initial quota');}}),/initial quota/);
 assert.equal(status(q).incomplete,true);assert(!fs.existsSync(path.join(q,'manifest.json.gz')));
});
test('completion cannot replace a newly introduced canonical file',async()=>{
 const q=fresh(),w=await createTableManifestWriter(q);await w.append(sample[0]);
 const canonical=path.join(q,'manifest.json.gz');fs.writeFileSync(canonical,'other evidence');
 await assert.rejects(w.finish({expectedRecords:1}),/EEXIST/);await w.abort(Error('canonical appeared'));
 assert.equal(fs.readFileSync(canonical,'utf8'),'other evidence');assert.equal(status(q).incomplete,true);
});

test('a phase cannot grow beyond the remaining failure evidence allowance',()=>{
 const q=fresh(),phase=path.join(q,'phase');fs.mkdirSync(phase);
 const b=new EvidenceBudget({root:q,phase,normalLimit:65536,failureLimit:8192,requiredFreeBytes:0,freeBytes:()=>1e9});
 assert.throws(()=>b.begin({normalForecastBytes:8193}),/failure evidence budget/);
 assert(!fs.existsSync(path.join(phase,'qa-evidence-status.json')));
});
