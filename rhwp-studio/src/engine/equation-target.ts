/** Explicit first-level cell equation address. A missing/ambiguous container
 * must never fall back to a body control with the same numeric index. */
import type { CellPathLike, NoteControlRef } from '../core/types';
import type { WasmBridge } from '../core/wasm-bridge';
export interface EquationCellTarget {
  tableControlIdx: number;
  cellIdx: number;
  cellParaIdx: number;
  controlIdx: number;
}
export interface EquationSelectionRef {
  sec: number; ppi: number; ci: number;
  cellIdx?: number; cellParaIdx?: number; outerTableControlIdx?: number;
  cellPath?: CellPathLike; noteRef?: NoteControlRef;
}
const index = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export function equationCellTarget(ref: EquationSelectionRef): EquationCellTarget | undefined {
  if (ref.noteRef) return undefined;
  const path = ref.cellPath;
  let table: unknown, cell: unknown, para: unknown;
  if (path?.length) {
    if (path.length !== 1) throw new Error('중첩 표 수식 편집은 아직 지원하지 않습니다.');
    const e = path[0];
    table = 'controlIndex' in e ? e.controlIndex : e.controlIdx;
    cell = 'cellIndex' in e ? e.cellIndex : e.cellIdx;
    para = 'cellParaIndex' in e ? e.cellParaIndex : e.cellParaIdx;
  } else if (ref.cellIdx !== undefined && ref.cellIdx >= 0) {
    table = ref.outerTableControlIdx; cell = ref.cellIdx; para = ref.cellParaIdx;
  } else return undefined;
  if (!index(table) || !index(cell) || !index(para) || !index(ref.ci)) throw new Error('대상 셀 수식의 위치를 확인할 수 없습니다.');
  return {tableControlIdx: table, cellIdx: cell, cellParaIdx: para, controlIdx: ref.ci};
}
export function deleteEquationSelection(wasm: WasmBridge, ref: EquationSelectionRef): void {
  const cell = equationCellTarget(ref);
  if (cell) wasm.deleteEquationControlInCell(ref.sec, ref.ppi, cell);
  else wasm.deleteEquationControl(ref.sec, ref.ppi, ref.ci);
}

export function getEquationSelectionProperties(wasm: WasmBridge, ref: EquationSelectionRef) {
  if (ref.noteRef) return wasm.getNoteEquationProperties(ref.noteRef);
  const cell = equationCellTarget(ref);
  return cell ? wasm.getEquationPropertiesInCell(ref.sec, ref.ppi, cell)
    : wasm.getEquationProperties(ref.sec, ref.ppi, ref.ci);
}
export function setEquationSelectionProperties(wasm: WasmBridge, ref: EquationSelectionRef, props: Record<string, unknown>) {
  if (ref.noteRef) return wasm.setNoteEquationProperties(ref.noteRef, props);
  const cell = equationCellTarget(ref);
  return cell ? wasm.setEquationPropertiesInCell(ref.sec, ref.ppi, cell, props)
    : wasm.setEquationProperties(ref.sec, ref.ppi, ref.ci, undefined, undefined, props);
}
