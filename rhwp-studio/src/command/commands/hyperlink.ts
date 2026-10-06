import type { CommandDef } from '../types';
import { HyperlinkDialog } from '@/ui/hyperlink-dialog';
import { showToast } from '@/ui/toast';

export const bodyHyperlinkCommand: CommandDef = {
  id: 'insert:hyperlink', label: '하이퍼링크', icon: 'icon-hyperlink', shortcutLabel: 'Ctrl+K,H', opensDialog: true,
  canExecute: ctx => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode && !ctx.inTable
    && !ctx.inCellSelectionMode && !ctx.inPictureObjectSelection && !ctx.inTableObjectSelection,
  execute(services) {
    const ih = services.getInputHandler();
    if (!ih) return;
    try {
      const target = ih.getBodyHyperlinkTarget();
      const pos = target.selection?.start ?? target.position;
      const sec = pos.sectionIndex, para = pos.paragraphIndex;
      const start = pos.charOffset, end = target.selection?.end.charOffset ?? start;
      const selected = start !== end;
      const link = services.wasm.getBodyHyperlinkAt(sec, para, start);
      if (selected && link.found && (link.startCharIdx !== start || link.endCharIdx !== end)) {
        throw new Error('기존 하이퍼링크는 전체 범위를 선택해서 편집하세요.');
      }
      const stamp = () => JSON.stringify({generation: services.wasm.documentGeneration,
        text: services.wasm.getTextRange(sec, para, 0, services.wasm.getParagraphLength(sec, para)),
        fields: services.wasm.getFieldList(), para: services.wasm.getParaPropertiesAt(sec, para)});
      const captured = stamp();
      const dialog = new HyperlinkDialog({url: link.url ?? '',
        text: link.found ? link.text! : selected ? services.wasm.getTextRange(sec, para, start, end - start) : '',
        keepText: selected || link.found, editing: link.found});
      const apply = (remove: boolean, url = '', display = '') => {
        ih.getBodyHyperlinkTarget();
        if (stamp() !== captured) throw new Error('대화상자를 연 뒤 문서가 바뀌었습니다. 다시 선택하세요.');
        ih.executeOperation({kind: 'snapshot', operationType: remove ? 'unlinkBodyHyperlink' : 'bodyHyperlink', operation: wasm => {
          if (link.found) {
            const result = remove ? wasm.removeBodyHyperlink(sec, para, link.fieldId!) : wasm.updateBodyHyperlink(sec, para, link.fieldId!, url);
            if (!result.ok) throw new Error('하이퍼링크 편집 실패');
            return {...pos, charOffset: link.endCharIdx!};
          }
          const result = wasm.insertBodyHyperlink(sec, para, start, end, url, display);
          if (!result.ok) throw new Error('하이퍼링크 삽입 실패');
          return {...pos, charOffset: result.endCharIdx};
        }});
        services.wasm.clearActiveField();
      };
      dialog.onApply = (url, display) => apply(false, url, display);
      dialog.onRemove = () => apply(true);
      dialog.afterClose = () => ih.focus();
      dialog.show();
    } catch (error) { showToast({message: String(error), durationMs: 7000}); }
  },
};
