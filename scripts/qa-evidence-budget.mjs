// Single-writer, whole-run evidence budget; does not follow symlinks or delete files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export const NORMAL_EVIDENCE_LIMIT = 768 * 1024 * 1024;
export const FAILURE_EVIDENCE_LIMIT = 256 * 1024 * 1024;
export const REQUIRED_FREE_BYTES = 16374562816;
const marker = 'qa-evidence-status.json';
export function evidenceFootprint(root) {
 const totals = {normalBytes: 0, failureBytes: 0}, seen = new Set(), incomplete = new Set();
 function walk(dir, failed) {
  const status = path.join(dir, marker);
  if (fs.existsSync(status)) {
   const s = fs.lstatSync(status);
   assert(s.isFile() && !s.isSymbolicLink() && s.size < 16384, 'invalid evidence status');
   const outcome=JSON.parse(fs.readFileSync(status)).outcome;
   assert(['running','failed','complete'].includes(outcome),'invalid phase outcome');
   if(outcome==='running'&&!failed)incomplete.add(path.resolve(dir));
   failed ||= outcome === 'failed';
  }
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
   const p = path.join(dir, entry.name), s = fs.lstatSync(p);
   if (s.isSymbolicLink()) continue;
   if (s.isDirectory()) walk(p, failed);
   else if (s.isFile()) {
    if(!failed&&entry.name.endsWith('.partial'))incomplete.add(path.resolve(dir));
    if(entry.name==='manifest-status.json') {
     // Preserve historical failed output even if a large assertion expanded its
     // status. Its bytes remain charged to failure; never parse or promote it.
     if(!failed){assert(s.size<16384,'invalid manifest status');
      if(JSON.parse(fs.readFileSync(p)).complete!==true)incomplete.add(path.resolve(dir));}
    }
    const key = s.dev + ':' + s.ino;
    if (seen.has(key)) continue;
    seen.add(key);
    totals[failed ? 'failureBytes' : 'normalBytes'] += s.blocks * 512;
   }
  }
 }
 walk(root, false);
 return {...totals, totalBytes: totals.normalBytes + totals.failureBytes, incompletePhases:[...incomplete]};
}
export class EvidenceBudget {
 constructor({root, phase = root, normalLimit = NORMAL_EVIDENCE_LIMIT,
  failureLimit = FAILURE_EVIDENCE_LIMIT, requiredFreeBytes = REQUIRED_FREE_BYTES,
  freeBytes = () => { const s = fs.statfsSync(root); return Number(s.bavail) * Number(s.bsize); }} = {}) {
  this.root = path.resolve(root); this.phase = path.resolve(phase);
  const relative = path.relative(this.root, this.phase);
  assert(relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)),
   'phase must be within whole-run budget root');
  assert.equal(fs.realpathSync(this.root), this.root, 'budget root must not alias historical evidence');
  assert.equal(fs.realpathSync(this.phase), this.phase, 'phase must not alias historical evidence');
  for (const value of [normalLimit, failureLimit, requiredFreeBytes])
   assert(Number.isSafeInteger(value) && value >= 0, 'finite byte budget required');
  this.started=false;
  Object.assign(this, {normalLimit, failureLimit, requiredFreeBytes, freeBytes});
 }
 check({normalForecastBytes = 0, failureForecastBytes = 0} = {}) {
  for (const value of [normalForecastBytes, failureForecastBytes])
   assert(Number.isSafeInteger(value) && value >= 0, 'finite byte forecast required');
  const used = evidenceFootprint(this.root), free = this.freeBytes();
  const otherIncomplete=used.incompletePhases.filter(dir=>{
   const rel=path.relative(this.phase,dir);
   return !this.started||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel);
  });
  assert.equal(otherIncomplete.length,0,'unfinished evidence blocks next phase: '+otherIncomplete.join(', '));
  assert(used.normalBytes + normalForecastBytes <= this.normalLimit, 'normal evidence budget exceeded');
  const phaseStatus=path.join(this.phase,marker);
  const alreadyFailed=fs.existsSync(phaseStatus)&&JSON.parse(fs.readFileSync(phaseStatus)).outcome==='failed';
  const runningExposure=this.phase===this.root||alreadyFailed?0:evidenceFootprint(this.phase).totalBytes+normalForecastBytes;
  assert(used.failureBytes + Math.max(failureForecastBytes,runningExposure) <= this.failureLimit, 'failure evidence budget exceeded');
  const forecast = normalForecastBytes + failureForecastBytes;
  assert(free >= this.requiredFreeBytes + forecast, 'insufficient free space for evidence forecast');
  return {...used, freeBytes: free, normalForecastBytes, failureForecastBytes,
   normalLimit: this.normalLimit, failureLimit: this.failureLimit, requiredFreeBytes: this.requiredFreeBytes};
 }
 begin(forecast) {
  assert(this.phase!==this.root,'distinct phase directory under whole-run root required');
  const status = path.join(this.phase, marker);
  assert(!fs.existsSync(status), 'fresh phase budget status required');
  const preflight = this.check(forecast);
  fs.writeFileSync(status, JSON.stringify({schema: 1, outcome: 'running', root: this.root, preflight}) + '\n', {flag: 'wx'});
  this.started=true;
  return preflight;
 }
 mark(outcome) {
  assert(this.started,'phase not started by this writer');
  assert(['complete', 'failed'].includes(outcome));
  fs.writeFileSync(path.join(this.phase, marker), JSON.stringify({schema: 1, outcome, root: this.root}) + '\n');
 }
}
