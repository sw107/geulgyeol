import type { CommandDef } from '../types';
import { showToast } from '../../ui/toast';

export const plainTextPasteCommand: CommandDef = {
  id: 'edit:paste-plain-text',
  label: '텍스트만 붙이기',
  shortcutLabel: 'Ctrl+Shift+V',
  canExecute: ctx => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode && !!ctx.canPastePlainText,
  execute(services) {
    const input = services.getInputHandler();
    if (!input?.canPastePlainText()) return;
    const text = services.readClipboardText?.();
    if (typeof text !== 'string') {
      showToast({message: '클립보드의 텍스트를 읽지 못했습니다.'});
      return;
    }
    input.performPastePlainText(text);
  },
};
