// Bounded per-case JSON array writer. Old evidence is never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip, createGunzip} from 'node:zlib';

const hash = () => createHash('sha256');
export async function createTableManifestWriter(q, {
 gzip = true, beforeWrite = () => {}, maxRecordBytes = 32 * 1024 * 1024, expectedFiles
} = {}) {
 const file = path.join(q, gzip ? 'manifest.json.gz' : 'manifest.json');
 const partial = file + '.partial', status = path.join(q, 'manifest-status.json'), planFile=path.join(q,'manifest-plan.json');
 for (const p of [file, partial, status, planFile]) assert(!fs.existsSync(p), 'fresh manifest output required');
 const input = new PassThrough({highWaterMark: 65536});
 const output = fs.createWriteStream(partial, {flags: 'wx'});
 let pipelineError, closed = false, rawBytes = 0, records = 0;
 const rawHash = hash(), identities = new Set();let planned,planSHA;
 const done = (gzip ? pipeline(input, createGzip({level: 6}), output) : pipeline(input, output))
  .catch(e => { pipelineError = e; });
 const mark = (complete, extra = {}) => fs.writeFileSync(status, JSON.stringify({
  schema: 1, complete, file: path.basename(complete ? file : partial),
  records, uncompressedBytes: rawBytes, plannedRecords:planned?.length,plannedFilesSHA256:planSHA,...extra
 }) + '\n');
 const put = async text => {
  const data = Buffer.from(text);
  beforeWrite(data.length);
  if (pipelineError) throw pipelineError;
  await new Promise((resolve, reject) => input.write(data, e => e ? reject(e) : resolve()));
  rawHash.update(data); rawBytes += data.length;
 };
 const planFiles=files=>{
  assert(!closed,'manifest closed');assert.equal(records,planned?.length??0,'previous planned files incomplete');
  assert(Array.isArray(files)&&files.every(f=>typeof f==='string'&&f),'planned file identities required');
  const candidate=[...(planned||[]),...files];assert.equal(new Set(candidate).size,candidate.length,'duplicate planned file');
  const json=JSON.stringify(candidate);assert(Buffer.byteLength(json)<=1048576,'bounded manifest plan required');
  beforeWrite(Buffer.byteLength(json));fs.writeFileSync(planFile,json+'\n');
  planned=candidate;planSHA=hash().update(json+'\n').digest('hex');mark(false);
 };
 try { mark(false); await put('[');if(expectedFiles!==undefined)planFiles(expectedFiles); }
 catch(e) { input.destroy(e); await done; mark(false,{failure:String(e),incomplete:true}); throw e; }
 return {
  planFiles,
  async append(row, sequence = records) {
   assert(!closed, 'manifest closed');
   assert.equal(sequence, records, 'manifest record order');
   assert.equal(typeof row.file, 'string', 'saved file identity required');
   if(planned)assert.equal(row.file,planned[records],'unexpected or out-of-order planned file');
   assert(row.file && !identities.has(row.file), 'duplicate saved file identity');
   const json = JSON.stringify(row);
   assert(Buffer.byteLength(json) <= maxRecordBytes, 'manifest record exceeds bounded case size');
   await put((records ? ',' : '') + json);
   identities.add(row.file); records++; mark(false);
  },
  async finish({expectedRecords = records} = {}) {
   assert(!closed, 'manifest closed');
   assert.equal(records, expectedRecords, 'missing manifest records');
   if(planned){assert.equal(records,planned.length,'missing planned manifest files');assert.equal(hash().update(fs.readFileSync(planFile)).digest('hex'),planSHA,'disk planned file list changed');}
   await put(']'); input.end(); await done;
   if (pipelineError) throw pipelineError;
   const fd = fs.openSync(partial, 'r');
   try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
   const expected = rawHash.digest('hex'), storedHash = hash(), restoredHash = hash();
   let restoredBytes = 0;
   for await (const chunk of fs.createReadStream(partial)) storedHash.update(chunk);
   // Pipeline forwards compressed-source read errors as well as gzip errors.
   const restored = new PassThrough();
   const source = fs.createReadStream(partial);
   const restoreDone = (gzip ? pipeline(source, createGunzip(), restored) : pipeline(source, restored));
   const consume = (async () => {
    for await (const chunk of restored) { restoredHash.update(chunk); restoredBytes += chunk.length; }
   })();
   await Promise.all([restoreDone, consume]);
   assert.equal(restoredBytes, rawBytes);
   assert.equal(restoredHash.digest('hex'), expected, 'disk manifest restores exact JSON bytes');
   beforeWrite(0);
   const result = {file: path.basename(file), compression: gzip ? 'gzip' : 'none',
    records, plannedRecords:planned?.length,plannedFilesSHA256:planSHA,uncompressedBytes: rawBytes, uncompressedSHA256: expected,
    fileBytes: fs.statSync(partial).size, fileSHA256: storedHash.digest('hex'),
    diskReadBackVerified: true};
   // Exclusive promotion refuses to replace any concurrently introduced evidence.
   fs.linkSync(partial, file); fs.unlinkSync(partial); closed = true;
   mark(true, {expectedRecords, ...result});
   return result;
  },
  async abort(error) {
   if (closed) return;
   closed = true;
   input.destroy(error instanceof Error ? error : new Error(String(error)));
   await done;
   mark(false, {failure: String(error), incomplete: true});
  }
 };
}
export async function writeTableManifest(q, records, gzip = false) {
 const writer = await createTableManifestWriter(q, {gzip});
 try {
  for await (const row of records) await writer.append(row);
  return await writer.finish({expectedRecords: records.length});
 } catch (e) { await writer.abort(e); throw e; }
}
