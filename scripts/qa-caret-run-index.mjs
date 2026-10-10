// Index exact owner/paragraph and page; preserve overlap witnesses at line boundaries.
import assert from 'node:assert/strict';
export class CaretRunIndex {
 constructor({target, native = false} = {}) {
  this.target = target; this.native = native; this.byOwner = new Map();
 }
 add(run, page = run.page) {
  if (!Number.isInteger(run.cellIdx) || !Number.isInteger(run.cellParaIdx)) return;
  if (this.native && !(run.cellPath?.length === 1 && run.parentParaIdx === this.target.para &&
   run.controlIdx === this.target.control)) return;
  const key = run.cellIdx + ':' + run.cellParaIdx;
  let owner = this.byOwner.get(key);
  if (!owner) { owner = {all: [], byPage: new Map()}; this.byOwner.set(key, owner); }
  const witness = {run, page, start: run.charStart, end: run.charStart + [...run.text].length};
  owner.all.push(witness);
  if (!owner.byPage.has(page)) owner.byPage.set(page, []);
  owner.byPage.get(page).push(witness);
 }
 query(cell, para, offset, page) {
  const owner = this.byOwner.get(cell + ':' + para);
  const candidates = (page === undefined ? owner?.all : owner?.byPage.get(page)) || [];
  return candidates.filter(w => w.start <= offset && offset <= w.end);
 }
}
export async function forEachBatch(iterable, visit, size = 128) {
 assert(Number.isInteger(size) && size > 0, 'positive batch size required');
 let count = 0;
 for (const value of iterable) {
  await visit(value, count++);
  if (count % size === 0) await new Promise(resolve => setImmediate(resolve));
 }
 return count;
}
