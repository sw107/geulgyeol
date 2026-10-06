import type { CommandDef } from '../types';
import { HyperlinkDialog } from '@/ui/hyperlink-dialog';
import { showToast } from '@/ui/toast';

export const bodyHyperlinkCommand: CommandDef = {
  id: 'insert:hyperlink', label: '하이퍼링크', icon: 'icon-hyperlink', shortcutLabel: 'Ctrl+K,H', opensDialog: true,
  canExecute: ctx => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode
    && !ctx.inCellSelectionMode && !ctx.inPictureObjectSelection && !ctx.inTableObjectSelection,
  execute(services) {
    const ih = services.getInputHandler();
    if (!ih) return;
    try {
      const target = ih.getHyperlinkTarget();
      const pos = target.selection?.start ?? target.position;
      const sec = pos.sectionIndex, para = pos.paragraphIndex;
      const start = pos.charOffset, end = target.selection?.end.charOffset ?? start;
      const selected = start !== end, path = target.cellPath, parent = pos.parentParaIndex!;
      const pathJson = JSON.stringify(path);
      const wasm = services.wasm;
      const link = path ? wasm.getCellHyperlinkAtByPath(sec, parent, path, start) : wasm.getBodyHyperlinkAt(sec, para, start);
      if (selected && link.found && (link.startCharIdx !== start || link.endCharIdx !== end)) {
        throw new Error('기존 하이퍼링크는 전체 범위를 선택해서 편집하세요.');
      }
      const text = (offset: number, count: number) => path
        ? wasm.getTextInCellByPath(sec, parent, pathJson, offset, count)
        : wasm.getTextRange(sec, para, offset, count);
      const stamp = () => JSON.stringify({generation: wasm.documentGeneration,
        text: text(0, path ? wasm.getCellParagraphLengthByPath(sec, parent, pathJson) : wasm.getParagraphLength(sec, para)),
        fields: wasm.getFieldList(),
        para: path ? wasm.getCellParaPropertiesAtByPath(sec, parent, pathJson) : wasm.getParaPropertiesAt(sec, para)});
      const captured = stamp();
      const owner = (t: typeof target) => {
        const p = t.selection?.start ?? t.position;
        return JSON.stringify([p.sectionIndex, t.cellPath ? p.parentParaIndex : p.paragraphIndex, t.cellPath]);
      };
      const capturedOwner = owner(target);
      const dialog = new HyperlinkDialog({url: link.url ?? '',
        text: link.found ? link.text! : selected ? text(start, end - start) : '',
        keepText: selected || link.found, editing: link.found});
      const apply = (remove: boolean, url = '', display = '') => {
        if (owner(ih.getHyperlinkTarget()) !== capturedOwner || stamp() !== captured) {
          throw new Error('대화상자를 연 뒤 문서 또는 대상이 바뀌었습니다. 다시 선택하세요.');
        }
        ih.executeOperation({kind: 'snapshot',
          operationType: path ? remove ? 'unlinkCellHyperlink' : 'cellHyperlink' : remove ? 'unlinkBodyHyperlink' : 'bodyHyperlink',
          operation: bridge => {
            if (link.found) {
              const result = path
                ? remove ? bridge.removeCellHyperlinkByPath(sec, parent, path, link.fieldId!) : bridge.updateCellHyperlinkByPath(sec, parent, path, link.fieldId!, url)
                : remove ? bridge.removeBodyHyperlink(sec, para, link.fieldId!) : bridge.updateBodyHyperlink(sec, para, link.fieldId!, url);
              if (!result.ok) throw new Error('하이퍼링크 편집 실패');
              return {...pos, charOffset: link.endCharIdx!};
            }
            const result = path ? bridge.insertCellHyperlinkByPath(sec, parent, path, start, end, url, display)
              : bridge.insertBodyHyperlink(sec, para, start, end, url, display);
            if (!result.ok) throw new Error('하이퍼링크 삽입 실패');
            return {...pos, charOffset: result.endCharIdx};
          }});
        wasm.clearActiveField();
      };
      dialog.onApply = (url, display) => apply(false, url, display);
      dialog.onRemove = () => apply(true);
      dialog.afterClose = () => ih.focus();
      dialog.show();
    } catch (error) { showToast({message: String(error), durationMs: 7000}); }
  },
};
