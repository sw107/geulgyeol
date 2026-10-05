import type { CommandDef } from '../types';
import { OptionsDialog } from '../../ui/options-dialog';
import { showToast } from '../../ui/toast';

export const toolCommands: CommandDef[] = [
  {
    id: 'tool:reflow-picture-groups',
    label: '그림 묶음 배치 다시 계산',
    canExecute: (ctx) => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode,
    execute(services) {
      const input = services.getInputHandler();
      if (!input) return;
      const changed = input.reflowPictureGroups();
      showToast({ message: changed < 0 ? '글자 입력을 마친 후 다시 실행하세요.'
        : changed > 0 ? `${changed}개 문단의 그림 묶음 배치를 다시 계산했습니다. 실행 취소로 되돌릴 수 있습니다.`
        : '다시 계산할 수 있는 그림 묶음 배치가 없습니다.' });
    },
  },
  {
    id: 'tool:options',
    opensDialog: true,
    label: '환경 설정',
    execute(services) {
      const dlg = new OptionsDialog(services.eventBus);
      dlg.show();
    },
  },
];
