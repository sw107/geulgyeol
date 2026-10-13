import { PrintStatus } from '@/command/print-status';
import type { AutosaveStatus } from '@/recovery/autosave-manager';

/** UI only: recovery transactions and document dirty state remain independent. */
export class AutosaveStatusDisplay {
  private owner: PrintStatus | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressed = false;

  constructor(
    private readonly getElement: () => HTMLElement | null,
    private readonly formatBytes: (bytes: number) => string,
  ) {}

  update(status: AutosaveStatus): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    const element = this.getElement();
    if (!element) { this.owner?.finish(); this.owner = null; this.suppressed = false; return; }

    if (status.state === 'saving') {
      this.owner?.finish();
      this.owner = null;
      // A background notice must not consume an error's successful-retry target.
      this.suppressed = PrintStatus.hasRetainedFailure(element);
      if (this.suppressed) return;
      this.owner = new PrintStatus(element);
      this.owner.update('복구용 자동 저장 중...');
      return;
    }
    if (this.suppressed) { this.suppressed = false; return; }
    if (!this.owner && PrintStatus.hasRetainedFailure(element)) return;
    const owner = this.owner ??= new PrintStatus(element);
    const message = status.state === 'saved'
      ? `복구용 자동 저장 완료 (${this.formatBytes(status.byteLength)})`
      : status.state === 'blocked'
        ? '보호 문서는 복구용 자동 저장을 하지 않습니다'
        : '복구용 자동 저장 실패';
    owner.update(message);
    this.restoreTimer = setTimeout(() => {
      if (this.owner !== owner) return;
      owner.finish();
      this.owner = null;
      this.restoreTimer = null;
    }, status.state === 'saved' ? 1_600 : 4_000);
  }
}
