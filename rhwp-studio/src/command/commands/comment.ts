import type { CommandDef } from '../types';
import { CommentDialog } from '@/ui/comment-dialog';
import { showToast } from '@/ui/toast';

export const bodyCommentCommand: CommandDef = {
  id: 'insert:comment', label: '검토 주석', icon: 'icon-comment', opensDialog: true,
  canExecute: ctx => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode && !ctx.inTable
    && !ctx.inCellSelectionMode && !ctx.inPictureObjectSelection && !ctx.inTableObjectSelection,
  execute(services) {
    const ih = services.getInputHandler(); if (!ih) return;
    try {
      const target = ih.getBodyCommentTarget(), wasm = services.wasm;
      const pos = target.selection?.start ?? target.position;
      const sec = pos.sectionIndex, para = pos.paragraphIndex, start = pos.charOffset;
      const end = target.selection?.end.charOffset ?? start;
      const comment = wasm.getBodyCommentAt(sec, para, start);
      if (comment.editable === false) throw new Error(comment.reason || '이 문서의 주석 저작은 지원하지 않습니다.');
      if (comment.found && start !== end && (comment.startCharIdx !== start || comment.endCharIdx !== end)) {
        throw new Error('기존 주석은 전체 범위를 선택하거나 범위 안에 커서를 두세요.');
      }
      if (!comment.found && start === end) throw new Error('검토 주석을 추가할 본문 텍스트를 선택하세요.');
      const selectionStamp = JSON.stringify(target);
      const stamp = () => JSON.stringify({generation: wasm.documentGeneration, fields: wasm.getFieldList(),
        text: wasm.getTextRange(sec, para, 0, wasm.getParagraphLength(sec, para)),
        properties: wasm.getParaPropertiesAt(sec, para), comment: wasm.getBodyCommentAt(sec, para, start)});
      const captured = stamp(); let closed = false, applied = false;
      const dialog = new CommentDialog({content: comment.content ?? '', editing: comment.found,
        selectedText: comment.selectedText ?? wasm.getTextRange(sec, para, start, end - start),
        author: comment.author ?? '', createDateTime: comment.createDateTime ?? null,
        supportedSaveFormats: comment.supportedSaveFormats ?? ['hwp', 'hwpx']});
      const apply = (remove: boolean, content = '') => {
        if (closed || applied) throw new Error('이미 닫히거나 적용된 주석 대화상자입니다.');
        if (JSON.stringify(ih.getBodyCommentTarget()) !== selectionStamp || stamp() !== captured) {
          throw new Error('대화상자를 연 뒤 문서 또는 선택 범위가 바뀌었습니다. 다시 선택하세요.');
        }
        if (!remove && comment.found && content === comment.content) { applied = true; return; }
        ih.executeOperation({kind: 'snapshot', operationType: remove ? 'removeBodyComment' : 'bodyComment',
          operation: bridge => {
            const result = comment.found
              ? remove ? bridge.removeBodyComment(sec, para, comment.fieldId!)
                : bridge.updateBodyComment(sec, para, comment.fieldId!, content)
              : bridge.insertBodyComment(sec, para, start, end, content);
            if (!result.ok) throw new Error('검토 주석 적용 실패');
            return {...pos, charOffset: comment.found ? comment.endCharIdx! : end};
          }});
        wasm.clearActiveField(); applied = true;
      };
      dialog.onApply = content => apply(false, content);
      dialog.onRemove = () => apply(true);
      dialog.afterClose = () => { closed = true; ih.focus(); };
      dialog.show();
    } catch (error) { showToast({message: String(error), durationMs: 7000}); }
  },
};
