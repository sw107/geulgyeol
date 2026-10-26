import type { CommandDef } from '../types';

/** Local calendar date: UTC conversion can change the day near midnight. */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const todayDateCommand: CommandDef = {
  id: 'insert:today-date',
  label: '오늘 날짜 넣기',
  canExecute: ctx => ctx.hasDocument && ctx.isEditable && !ctx.isFormMode && !!ctx.canInsertTodayDate,
  execute(services) {
    // Check the live input state too; menus may have been opened before it changed.
    services.getInputHandler()?.performInsertDate(formatLocalDate(new Date()));
  },
};
