import type { CommandServices } from '../command/types';
import type { ValidationReport } from '../core/wasm-bridge';

const PAGE_SIZE = 50;
const KIND_LABELS: Record<string, string> = {
  LinesegArrayEmpty: '줄 배치 정보가 비어 있음',
  LinesegUncomputed: '줄 높이가 계산되지 않음',
  LinesegTextRunReflow: '긴 문단의 줄 배치 정보가 하나뿐임',
};

type DiagnosticServices = Pick<CommandServices, 'wasm' | 'getInputHandler'>;
let activeDialog: DocumentDiagnosticsDialog | null = null;

/** Close before any document replacement, including failed/cancelled loads. */
export function closeDocumentDiagnostics(): void {
  activeDialog?.hide(false);
}

export function showDocumentDiagnostics(services: DiagnosticServices): void {
  if (activeDialog) {
    activeDialog.show();
    return;
  }
  new DocumentDiagnosticsDialog(services).show();
}

/** Displays the engine's load-time report only; never repairs or recomputes it. */
export class DocumentDiagnosticsDialog {
  private overlay: HTMLDivElement | null = null;
  private dialog!: HTMLDivElement;
  private content!: HTMLDivElement;
  private closeButton!: HTMLButtonElement;
  private previousFocus: HTMLElement | null = null;
  private generation = -1;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private focusHandler: (() => void) | null = null;

  constructor(private services: DiagnosticServices) {}

  show(): void {
    if (this.overlay) {
      if (this.generation !== this.services.wasm.documentGeneration || !this.services.wasm.hasLoadedDocument()) {
        this.hide(false);
      } else {
        this.closeButton.focus();
        return;
      }
    }
    activeDialog?.hide(false);
    activeDialog = this;
    this.generation = this.services.wasm.documentGeneration;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-wrap';
    this.dialog.style.cssText = 'width:640px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);display:flex;flex-direction:column';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-label', '문서 점검');
    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = '문서 점검';
    title.style.cssText = 'flex:0 0 auto;cursor:default';
    this.dialog.appendChild(title);
    this.content = document.createElement('div');
    this.content.className = 'dialog-body';
    this.content.tabIndex = 0;
    this.content.setAttribute('role', 'region');
    this.content.setAttribute('aria-label', '문서 점검 결과');
    this.content.style.cssText = 'padding:16px 20px;overflow:auto;min-height:0;line-height:1.6;overflow-wrap:anywhere';
    this.dialog.appendChild(this.content);
    const footer = document.createElement('div');
    footer.className = 'dialog-footer';
    footer.style.flex = '0 0 auto';
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'dialog-btn dialog-btn-primary';
    this.closeButton.textContent = '닫기';
    this.closeButton.addEventListener('click', () => this.hide());
    footer.appendChild(this.closeButton);
    this.dialog.appendChild(footer);
    this.overlay.appendChild(this.dialog);
    this.render();
    document.body.appendChild(this.overlay);

    this.keyHandler = event => {
      // A caller outside the normal load path must not keep a stale snapshot interactive.
      if (this.generation !== this.services.wasm.documentGeneration || !this.services.wasm.hasLoadedDocument()) {
        event.stopPropagation(); event.preventDefault(); this.hide(false); return;
      }
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault(); this.hide();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const targets = this.focusTargets();
        const index = targets.indexOf(document.activeElement as HTMLElement);
        targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length].focus();
      } else if ((event.key === 'Enter' || event.key === ' ')
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && document.activeElement instanceof HTMLButtonElement) {
        event.preventDefault();
        document.activeElement.click();
      }
    };
    this.focusHandler = () => {
      if (this.overlay && !this.dialog.contains(document.activeElement)) this.closeButton.focus();
    };
    document.addEventListener('keydown', this.keyHandler, true);
    document.addEventListener('focusin', this.focusHandler);
    this.closeButton.focus();
  }

  hide(restoreFocus = true): void {
    if (!this.overlay) return;
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler, true);
    if (this.focusHandler) document.removeEventListener('focusin', this.focusHandler);
    this.keyHandler = null;
    this.focusHandler = null;
    this.overlay.remove();
    this.overlay = null;
    if (activeDialog === this) activeDialog = null;
    if (restoreFocus) {
      if (this.previousFocus?.isConnected && this.previousFocus !== document.body
        && !this.previousFocus.closest('[inert]')) this.previousFocus.focus();
      else this.services.getInputHandler()?.focus();
    }
    this.previousFocus = null;
  }

  private focusTargets(): HTMLElement[] {
    return Array.from(this.dialog.querySelectorAll<HTMLElement>('[tabindex="0"], button:not(:disabled)'));
  }

  private paragraph(text: string): void {
    const p = document.createElement('p');
    p.textContent = text;
    this.content.appendChild(p);
  }

  private render(): void {
    const wasm = this.services.wasm;
    this.paragraph('문서를 열 때 기록된 HWPX 줄 배치 경고를 보여 줍니다. 편집 후 다시 검사한 결과가 아니며, 경고가 없어도 호환성을 보증하지 않습니다.');
    this.paragraph('자동 보정은 글자 겹침 위험 때문에 꺼져 있습니다. 이 창은 문서를 변경하지 않습니다.');
    if (!wasm.hasLoadedDocument()) {
      this.paragraph('열린 문서가 없습니다.');
      return;
    }
    this.paragraph(`문서: ${wasm.fileName}`);
    if (wasm.getSourceFormat() !== 'hwpx') {
      this.paragraph('이 형식에는 HWPX 줄 배치 점검 결과를 제공하지 않습니다.');
      return;
    }
    try {
      const report = wasm.getValidationWarnings();
      this.paragraph(`기록된 경고 ${report.count}건`);
      if (report.count === 0) {
        this.paragraph('기록된 HWPX 줄 배치 경고가 없습니다.');
        return;
      }
      const summary = document.createElement('ul');
      for (const [kind, count] of Object.entries(report.summary)) {
        const item = document.createElement('li');
        item.textContent = `${kind}: ${count}건`;
        summary.appendChild(item);
      }
      this.content.appendChild(summary);
      this.paragraph('위치는 문서를 열 때의 순서이며 1부터 표시합니다. 편집 후에는 달라질 수 있습니다. 쪽 번호·중첩 표 경로는 제공되지 않습니다.');
      this.renderWarnings(report);
    } catch {
      this.paragraph('점검 결과를 가져오지 못했습니다. 창을 닫고 다시 열어 주세요.');
    }
  }

  private renderWarnings(report: ValidationReport): void {
    const list = document.createElement('ol');
    this.content.appendChild(list);
    const pager = document.createElement('div');
    const previous = document.createElement('button');
    const next = document.createElement('button');
    for (const button of [previous, next]) {
      button.type = 'button';
      button.className = 'dialog-btn';
    }
    previous.textContent = '이전 경고';
    next.textContent = '다음 경고';
    const status = document.createElement('span');
    status.setAttribute('aria-live', 'polite');
    pager.append(previous, status, next);
    this.content.appendChild(pager);
    let page = 0;
    const update = () => {
      const start = page * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, report.warnings.length);
      list.replaceChildren();
      list.start = start + 1;
      for (const warning of report.warnings.slice(start, end)) {
        const item = document.createElement('li');
        const cell = warning.cell;
        const location = `구역 ${warning.section + 1}, 문단 ${warning.paragraph + 1}`
          + (cell ? `, 표 컨트롤 ${cell.ctrl + 1}, 행 ${cell.row + 1}, 열 ${cell.col + 1}, 셀 문단 ${cell.innerPara + 1}` : '');
        item.textContent = `${KIND_LABELS[warning.kind] ?? warning.kind} — ${location}`;
        list.appendChild(item);
      }
      status.textContent = report.warnings.length ? ` ${start + 1}–${end} / ${report.warnings.length}건 ` : ' 상세 위치가 없습니다. ';
      previous.disabled = page === 0;
      next.disabled = end >= report.warnings.length;
    };
    previous.addEventListener('click', () => { page--; update(); this.content.scrollTop = 0; this.content.focus(); });
    next.addEventListener('click', () => { page++; update(); this.content.scrollTop = 0; this.content.focus(); });
    update();
  }
}
