/** Atomic edits of simple, root picture captions. Other containers keep their editor. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DocumentPosition } from '@/core/types';
import { SnapshotCommand } from './command';
import { showToast } from '@/ui/toast';

type Action = 'replace' | 'delete' | 'backspace' | 'forward' | 'split' | 'break';
type Range = { start: DocumentPosition; end: DocumentPosition; blockPhase: number | null };
type Plan = { hadSelection: boolean; range: Range; text: string; action: Action; shapeId?: number; props?: any };
type Composition = { id: number; generation: number; plan: Plan; before: DocumentPosition; text: string };
const compositions = new WeakMap<object, Composition>();
const rejectedCompositions = new WeakSet<object>();
const count = (s: string) => [...s].length;
const cpi = (p: DocumentPosition) => p.cellParaIndex ?? 0;
const same = (a: DocumentPosition, b: DocumentPosition) => a.sectionIndex === b.sectionIndex
  && a.parentParaIndex === b.parentParaIndex && a.controlIndex === b.controlIndex
  && a.cellIndex === 0 && b.cellIndex === 0 && !a.cellPath?.length && !b.cellPath?.length;
function target(h: any): boolean {
  if (h.cursor.isInHeaderFooter() || h.cursor.isInFootnote()) return false;
  const selection = h.cursor.getSelectionOrdered();
  for (const p of [h.cursor.getPosition(), selection?.start, selection?.end]) {
    if (!p || p.parentParaIndex === undefined) continue;
    try { h.wasm.getPictureProperties(p.sectionIndex, p.parentParaIndex, p.controlIndex); return true; }
    catch { /* Other containers retain their editor. */ }
  }
  return false;
}
export function isEditing(this: any): boolean { return target(this); }
function fail(): void { showToast({ message: '이 그림 캡션 범위는 편집할 수 없습니다.' }); }
function plan(h: any, action: Action, text: string): Plan | null {
  const p = h.cursor.getPosition();
  if (h.editMode !== 'normal' || p.cellIndex !== 0 || p.cellPath?.length) throw Error('Unsupported caption context');
  const info = h.wasm.getPictureCaptionEditInfo(p.sectionIndex, p.parentParaIndex, p.controlIndex);
  const selection = h.cursor.getSelectionOrdered();
  let start = { ...(selection?.start ?? p) }, end = { ...(selection?.end ?? p) };
  if (!same(start, end)) throw Error('Caption selection crosses containers');
  const ps = info.paragraphs;
  if (!selection && (action === 'backspace' || action === 'forward')) {
    const i = cpi(p), len = count(ps[i]?.text ?? '');
    if (action === 'backspace') {
      if (p.charOffset > ps[i]?.editFrom) start.charOffset--;
      else if (p.charOffset === 0 && i > 0) start = { ...p, cellParaIndex: i - 1, charOffset: count(ps[i - 1].text) };
      else return null;
    } else if (p.charOffset < len) end.charOffset++;
    else if (i + 1 < ps.length) end = { ...p, cellParaIndex: i + 1, charOffset: 0 };
    else return null;
  }
  for (const x of [start, end]) {
    const para = ps[cpi(x)];
    if (!para || !Number.isInteger(x.charOffset) || x.charOffset < para.editFrom || x.charOffset > count(para.text)) throw Error('Invalid caption range');
  }
  if (cpi(start) > cpi(end) || (cpi(start) === cpi(end) && start.charOffset > end.charOffset)) throw Error('Reversed caption range');
  if (action === 'delete' && cpi(start) === cpi(end) && start.charOffset === end.charOffset) return null;
  if ([...text].some(ch => { const n = ch.codePointAt(0)!; return (n < 32 && !['\n', '\r', '\t'].includes(ch)) || n === 0xffff || (n >= 0xd800 && n <= 0xdfff); })) throw Error('Invalid caption text');
  const props = h.getPendingCharShape?.();
  const shapeId = selection && start.charOffset < count(ps[cpi(start)].text)
    ? h.wasm.getCellCharPropertiesAt(start.sectionIndex, start.parentParaIndex, start.controlIndex, 0, cpi(start), start.charOffset).charShapeId : undefined;
  return { hadSelection: !!selection, range: { start, end, blockPhase: h.cursor.blockSelectionPhase() }, action, text: text.replace(/\r\n?/g, '\n'), shapeId, props };
}
function apply(w: any, p: Plan): DocumentPosition {
  const { start, end } = p.range, sec = start.sectionIndex, parent = start.parentParaIndex!, ci = start.controlIndex!;
  let i = cpi(start), at = start.charOffset;
  if (i !== cpi(end) || at !== end.charOffset) {
    w.deleteRangeInCellByPath(sec, parent, JSON.stringify([{ controlIndex: ci, cellIndex: 0, cellParaIndex: i }]), i, at, cpi(end), end.charOffset);
  }
  const text = p.action === 'break' ? '\n' : p.text;
  const lines = p.action === 'break' ? [text] : text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (line) {
      w.insertTextInCell(sec, parent, ci, 0, i, at, line);
      if (p.shapeId !== undefined) w.setCharShapeIdInCell(sec, parent, ci, 0, i, at, at + count(line), p.shapeId);
      if (p.props) w.applyCharFormatInCell(sec, parent, ci, 0, i, at, at + count(line), JSON.stringify(p.props));
      at += count(line);
    }
    if (n + 1 < lines.length || p.action === 'split') {
      w.splitParagraphInCell(sec, parent, ci, 0, i, at, undefined, false); i++; at = 0;
    }
  }
  return { ...start, cellParaIndex: i, paragraphIndex: 0, charOffset: at };
}
class CaptionCommand extends SnapshotCommand {
  constructor(before: DocumentPosition, private plan: Plan) { super('editPictureCaption', before, before, w => apply(w, plan)); }
  selectionBefore(): Range | null { return this.plan.hadSelection && ['delete', 'backspace', 'forward'].includes(this.plan.action) ? this.plan.range : null; }
}
export function tryEdit(this: any, action: Action, text = ''): boolean {
  if (!target(this)) return false;
  const before = this.cursor.getPosition(), selection = this.cursor.getSelectionOrdered();
  let started = false;
  try {
    const p = plan(this, action, text);
    if (!p) return true;
    started = true;
    this.executeOperation({ kind: 'command', command: new CaptionCommand(before, p), meta: { refresh: 'full' } });
    this.cursor.clearSelection(); this.updateCaret();
  } catch {
    if (started) {
      this.cursor.moveTo(before);
      if (selection) this.cursor.selectPictureCaptionRange(selection.start, selection.end);
    }
    fail();
  }
  return true;
}
export function beginComposition(this: any): boolean {
  if (!target(this)) return false;
  try {
    const p = plan(this, 'replace', '');
    if (!p) return true;
    compositions.set(this, { id: this.wasm.saveSnapshot(), generation: this.wasm.documentGeneration, plan: p, before: this.cursor.getPosition(), text: '' });
  } catch { rejectedCompositions.add(this); fail(); }
  return true;
}
export function hasComposition(this: any): boolean { return compositions.has(this) || rejectedCompositions.has(this); }
export function updateComposition(this: any, text: string): boolean {
  if (rejectedCompositions.has(this)) return true;
  const s = compositions.get(this);
  if (!s) return false;
  if (s.generation !== this.wasm.documentGeneration || !this.wasm.hasLoadedDocument()) { compositions.delete(this); return true; }
  try {
    this.wasm.restoreSnapshot(s.id);
    this.cursor.moveTo(s.before);
    const p = { ...s.plan, text };
    // Validate preview text before deletion, against the restored original range.
    if (s.plan.range.start.charOffset !== s.plan.range.end.charOffset || cpi(s.plan.range.start) !== cpi(s.plan.range.end)) this.cursor.selectPictureCaptionRange(s.plan.range.start, s.plan.range.end);
    const validated = plan(this, 'replace', text);
    const pos = text ? apply(this.wasm, { ...p, text: validated!.text }) : s.before;
    s.text = text;
    this.compositionLength = count(text); this._lastCompositionText = text;
    this.cursor.clearSelection(); this.cursor.moveTo(pos); this.afterEdit();
  } catch { cancelComposition.call(this); rejectedCompositions.add(this); fail(); }
  return true;
}
export function finishComposition(this: any): boolean {
  if (rejectedCompositions.delete(this)) return true;
  const s = compositions.get(this);
  if (!s) return false;
  compositions.delete(this);
  if (s.generation !== this.wasm.documentGeneration || !this.wasm.hasLoadedDocument()) return true;
  try { this.wasm.restoreSnapshot(s.id); } finally { this.wasm.discardSnapshot(s.id); }
  this.cursor.moveTo(s.before);
  this.cursor.clearSelection();
  if (s.plan.range.start.charOffset !== s.plan.range.end.charOffset || cpi(s.plan.range.start) !== cpi(s.plan.range.end)) this.cursor.selectPictureCaptionRange(s.plan.range.start, s.plan.range.end);
  if (s.text) tryEdit.call(this, 'replace', s.text);
  else this.updateCaret();
  return true;
}
export function cancelComposition(this: any): void {
  const s = compositions.get(this); compositions.delete(this); rejectedCompositions.delete(this);
  if (s && s.generation === this.wasm.documentGeneration && this.wasm.hasLoadedDocument()) {
    try { this.wasm.restoreSnapshot(s.id); } finally { this.wasm.discardSnapshot(s.id); }
    this.cursor.moveTo(s.before); this.cursor.clearSelection();
    this.cursor.selectPictureCaptionRange(s.plan.range.start, s.plan.range.end);
  }
}
