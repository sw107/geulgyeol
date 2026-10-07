import type { CommandDef, CommandServices } from '../types';
import type { ObjectPropsRef } from '@/engine/object-props';
import type { WasmBridge } from '@/core/wasm-bridge';
import { ParagraphBandDialog, type ParagraphBandAppearance } from '@/ui/paragraph-band-dialog';
import { showToast } from '@/ui/toast';

type Band = { ci: number; height: number; fillBgColor: number };
function normalBody(services: CommandServices): void {
  const c = services.getContext();
  if (!c.hasDocument || !c.isEditable || c.isFormMode || c.inTable || c.inCellSelectionMode || c.inTableObjectSelection) {
    throw new Error('문단 띠는 편집 가능한 일반 본문의 한 문단에서만 지원합니다.');
  }
}
function bandAt(wasm: WasmBridge, sec: number, para: number, ci: number): Band | null {
  try {
    const width = wasm.getBodyRectangleWidth(sec, para, ci), p = wasm.getShapeProperties(sec, para, ci);
    if (width.widthCriterion !== 'Para' || width.width !== 10000 || p.horzRelTo !== 'Para' || p.vertRelTo !== 'Para'
      || p.horzAlign !== 'Left' || p.vertAlign !== 'Top' || p.horzOffset !== 0 || p.vertOffset !== 0
      || p.lineType !== 0 || p.fillType !== 'solid' || p.fillPatType !== -1 || p.fillAlpha !== 0
      || p.height < 283 || p.height > 5669) return null;
    return {ci, height: p.height, fillBgColor: p.fillBgColor ?? 0};
  } catch { return null; }
}
function requireTrailing(wasm: WasmBridge, sec: number, para: number, ci: number): void {
  const positions = wasm.getControlTextPositions(sec, para);
  if (ci !== positions.length - 1 || positions[ci] !== wasm.getParagraphLength(sec, para)) {
    throw new Error('문단 끝의 마지막 개체로 저장된 단순 문단 띠만 편집·제거할 수 있습니다.');
  }
}

/** The band delete menu and ordinary object delete menu share the same safe boundary. */
export function validateParagraphBandObjectDeletion(services: CommandServices, ref: ObjectPropsRef): void {
  const wasm = services.wasm;
  if (ref.type === 'shape' && ref.cellIdx === undefined && ref.cellParaIdx === undefined && ref.outerTableControlIdx === undefined && !ref.cellPath?.length && !ref.headerFooter && !ref.noteRef && bandAt(wasm, ref.sec, ref.ppi, ref.ci)) {
    normalBody(services);
    services.getInputHandler()?.getBodyParagraphBandTarget();
    const comment = wasm.getBodyCommentAt(ref.sec, ref.ppi, wasm.getParagraphLength(ref.sec, ref.ppi));
    if (comment.editable === false) throw new Error(comment.reason || '지원하지 않는 문단 참조입니다.');
    requireTrailing(wasm, ref.sec, ref.ppi, ref.ci);
  }
}

/** Object properties delegates only recognized bands; ordinary absolute objects keep their dialog. */
export function openParagraphBandObjectProperties(services: CommandServices, ref: ObjectPropsRef): boolean {
  if (ref.type !== 'shape' || ref.cellPath?.length || ref.cellIdx !== undefined || ref.cellParaIdx !== undefined || ref.outerTableControlIdx !== undefined || ref.headerFooter || ref.noteRef) return false;
  if (!bandAt(services.wasm, ref.sec, ref.ppi, ref.ci)) return false;
  bodyParagraphBandCommand.execute(services); return true;
}

export const bodyParagraphBandCommand: CommandDef = {
  id: 'insert:para-band', label: '문단 띠', opensDialog: true,
  canExecute: c => c.hasDocument && c.isEditable && !c.isFormMode && !c.inTable && !c.inCellSelectionMode && !c.inTableObjectSelection,
  execute(services) {
    const ih = services.getInputHandler(); if (!ih) return;
    try {
      normalBody(services);
      const target = ih.getBodyParagraphBandTarget(), pos = target.selection?.start ?? target.position;
      const wasm = services.wasm, sec = pos.sectionIndex, para = pos.paragraphIndex;
      const selected = ih.getSelectedPictureRef(), positions = wasm.getControlTextPositions(sec, para);
      const bands = positions.map((_, ci) => bandAt(wasm, sec, para, ci)).filter((b): b is Band => b !== null);
      if (bands.length > 1) throw new Error('같은 문단에 문단 띠가 여러 개 있어 대상을 확정할 수 없습니다.');
      const band = selected ? bandAt(wasm, sec, para, selected.ci) : bands[0];
      if (selected && !band) throw new Error('회전·그룹·다른 개체 선택에서는 문단 띠를 편집할 수 없습니다.');
      if (band) requireTrailing(wasm, sec, para, band.ci);
      const length = wasm.getParagraphLength(sec, para);
      if (pos.charOffset < 0 || pos.charOffset > length) throw new Error('문단 띠의 본문 위치를 확인할 수 없습니다.');
      const comment = wasm.getBodyCommentAt(sec, para, length);
      if (comment.editable === false) throw new Error(comment.reason || '지원하지 않는 문단 참조입니다.');
      const selectionState = () => JSON.stringify({target: ih.getBodyParagraphBandTarget(), selected: ih.getSelectedPictureRef()});
      const selectionStamp = selectionState();
      const stamp = () => JSON.stringify({generation: wasm.documentGeneration, fields: wasm.getFieldList(),
        length: wasm.getParagraphLength(sec, para), text: wasm.getTextRange(sec, para, 0, length), paragraph: wasm.getParaPropertiesAt(sec, para),
        controls: wasm.getControlTextPositions(sec, para), band: band ? wasm.getShapeProperties(sec, para, band.ci) : null,
        page: wasm.getPageDef(sec), columns: wasm.getColumnDef(sec)});
      const captured = stamp(); let closed = false, applied = false;
      const initial = band ?? {height: 283, fillBgColor: 0};
      const dialog = new ParagraphBandDialog(initial, !!band);
      const apply = (remove: boolean, appearance: ParagraphBandAppearance = initial) => {
        normalBody(services);
        if (closed || applied || selectionState() !== selectionStamp || stamp() !== captured) {
          throw new Error('문서 또는 선택이 바뀌었습니다. 문단 띠를 다시 선택하세요.');
        }
        if (band) requireTrailing(wasm, sec, para, band.ci);
        if (!remove && band && band.height === appearance.height && band.fillBgColor === appearance.fillBgColor) { applied = true; ih.selectPictureObject(sec, para, band.ci, 'shape'); return; }
        let ci = band?.ci; let changed = false;
        ih.executeOperation({kind: 'snapshot', operationType: remove ? 'deleteObject' : band ? 'setObjectProps' : 'insertShape',
          operation: bridge => {
            if (remove) {
              if (!band || !bridge.deleteShapeControl(sec, para, band.ci).ok) throw new Error('문단 띠 제거 실패');
            } else if (band) {
              bridge.setShapeProperties(sec, para, band.ci, {height: appearance.height, fillBgColor: appearance.fillBgColor});
            } else {
              // Append the storage anchor so existing note/field/control owners remain unchanged.
              const result = bridge.createShapeControl({sectionIdx: sec, paraIdx: para, charOffset: length,
                shapeType: 'rectangle', width: 10000, height: appearance.height, treatAsChar: false, textWrap: 'InFrontOfText'});
              if (!result.ok || result.paraIdx !== para) throw new Error('문단 띠 삽입 실패');
              ci = result.controlIdx;
              bridge.setShapeProperties(sec, para, ci, {horzRelTo: 'Para', vertRelTo: 'Para', horzAlign: 'Left', vertAlign: 'Top',
                horzOffset: 0, vertOffset: 0, fillType: 'solid', fillBgColor: appearance.fillBgColor, fillPatType: -1, fillAlpha: 0, lineType: 0});
              bridge.setBodyRectangleWidth(sec, para, ci, {width: 10000, widthCriterion: 'Para'});
            }
            if (!remove && !bandAt(bridge, sec, para, ci!)) throw new Error('지원되는 문단 띠 속성을 확인할 수 없습니다.');
            changed = true; return {...pos};
          }});
        if (!changed) throw new Error('현재 편집 모드에서는 문단 띠를 적용할 수 없습니다.');
        applied = true;
        if (remove) ih.exitPictureObjectSelectionAndAfterEdit();
        else ih.selectPictureObject(sec, para, ci!, 'shape');
      };
      dialog.onApply = a => apply(false, a); dialog.onRemove = () => apply(true);
      dialog.afterClose = () => { closed = true; ih.focus(); }; dialog.show();
    } catch (error) { showToast({message: String(error), durationMs: 7000}); }
  },
};
