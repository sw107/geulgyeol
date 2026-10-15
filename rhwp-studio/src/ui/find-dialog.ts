import type { CommandServices } from '@/command/types';
import type { SearchResult, ReplaceResult, ReplaceAllResult } from '@/core/types';

export type FindMode = 'find' | 'replace';

/**
 * [#3865] 검색 히트로 커서를 옮기고 매치를 선택 표시한다.
 *
 * 찾기 대화상자와 대화상자 없는 "찾기 다음"(F3) 이 **같은 이동 규칙을 써야** 한다.
 * 한쪽만 셀을 다루면 같은 문서에서 Ctrl+F 는 표 안을 찾는데 F3 는 못 찾는 상태가 된다.
 *
 * 표 셀 매치는 `cellContext` 가 셀 안 문단을 지목한다. 이때 `paragraphIndex` 는 표가
 * 놓인 바깥 문단이고, 실제 캐럿 위치는 `cellIndex` 계열 필드가 정한다.
 */
export function navigateToSearchHit(ih: ReturnType<CommandServices['getInputHandler']>, hit: SearchResult): void {
  if (!ih || !hit.found) return;

  const cell = hit.cellContext;
  const startPos = cell
    ? {
        sectionIndex: hit.sec!,
        paragraphIndex: cell.parentPara,
        charOffset: hit.charOffset!,
        parentParaIndex: cell.parentPara,
        controlIndex: cell.ctrlIdx,
        cellIndex: cell.cellIdx,
        cellParaIndex: cell.cellPara,
      }
    : {
        sectionIndex: hit.sec!,
        paragraphIndex: hit.para!,
        charOffset: hit.charOffset!,
      };
  const endPos = { ...startPos, charOffset: hit.charOffset! + hit.length! };

  // 선택 영역으로 하이라이트: anchor → start, cursor → end
  const cursor = (ih as any).cursor;
  if (cell) {
    // moveCursorTo 의 사전 검증은 본문 좌표만 본다(getCursorRect). 셀 위치를 넘기면
    // 바깥 문단을 검사해 엉뚱하게 거절될 수 있으므로, 셀 매치는 커서를 직접 옮긴다 —
    // rhwpDev.goto 가 이미 쓰는 경로다.
    cursor?.clearSelection();
    cursor?.moveTo(startPos);
  } else {
    ih.moveCursorTo(startPos);
  }
  if (cursor) {
    cursor.setAnchor();
    cursor.moveTo(endPos);
  }
  // 캐럿 갱신 + 스크롤
  (ih as any).updateCaret?.();
}

/**
 * 찾기/찾아바꾸기 모달리스 대화상자
 *
 * ModalDialog와 달리 편집 영역 조작이 가능하도록 overlay를 사용하지 않는다.
 */
export class FindDialog {
  static lastQuery = '';
  static lastCaseSensitive = false;

  private _open = false;
  private mode: FindMode;
  private services: CommandServices;

  private wrap!: HTMLDivElement;
  private queryInput!: HTMLInputElement;
  private replaceInput!: HTMLInputElement;
  private caseSensitiveCheck!: HTMLInputElement;
  private replaceRow!: HTMLDivElement;
  private replaceButtonRow!: HTMLDivElement;
  private statusLabel!: HTMLSpanElement;
  private titleLabel!: HTMLSpanElement;
  private keyCaptureHandler: ((e: KeyboardEvent) => void) | null = null;

  /** 현재 검색 결과 (바꾸기 시 위치 참조용) */
  private currentHit: SearchResult | null = null;
  private currentHitQuery: string | null = null;
  private currentHitCaseSensitive = false;
  private currentHitGeneration: number | null = null;

  /** Modeless editing can invalidate the matched range while this dialog stays open. */
  private hitInvalidationOff: (() => void)[] = [];

  constructor(services: CommandServices, mode: FindMode) {
    this.services = services;
    this.mode = mode;
  }

  isOpen(): boolean { return this._open; }

  show(): void {
    if (this._open) { this.focusInput(); return; }
    this._open = true;
    this.invalidateHit();
    this.build();
    document.body.appendChild(this.wrap);
    this.queryInput.value = FindDialog.lastQuery;
    this.caseSensitiveCheck.checked = FindDialog.lastCaseSensitive;
    this.applyMode();
    this.installKeyCaptureHandler();
    this.hitInvalidationOff = ['history-jumped', 'document-mutated', 'document-changed']
      .map(event => this.services.eventBus.on(event, () => this.invalidateHit()));
    this.focusInput();
  }

  hide(): void {
    this._open = false;
    this.removeKeyCaptureHandler();
    for (const off of this.hitInvalidationOff) off();
    this.hitInvalidationOff = [];
    this.invalidateHit();
    this.wrap?.remove();
  }

  focusInput(): void {
    this.queryInput?.focus();
    this.queryInput?.select();
  }

  switchMode(mode: FindMode): void {
    this.mode = mode;
    this.applyMode();
  }

  findNext(): void {
    this.doSearch(true);
  }

  findPrev(): void {
    this.doSearch(false);
  }

  // ── 내부 구현 ──

  private build(): void {
    this.wrap = document.createElement('div');
    this.wrap.className = 'find-dialog';

    // 타이틀 바
    const titleBar = document.createElement('div');
    titleBar.className = 'find-dialog-title';
    this.titleLabel = document.createElement('span');
    titleBar.appendChild(this.titleLabel);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialog-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => this.hide());
    titleBar.appendChild(closeBtn);
    this.wrap.appendChild(titleBar);

    // 본문
    const body = document.createElement('div');
    body.className = 'find-dialog-body';

    // 찾기 행
    const findRow = document.createElement('div');
    findRow.className = 'find-dialog-row';
    const findLabel = document.createElement('label');
    findLabel.textContent = '찾을 내용:';
    findLabel.className = 'find-dialog-label';
    this.queryInput = document.createElement('input');
    this.queryInput.type = 'text';
    this.queryInput.className = 'find-dialog-input';
    this.queryInput.addEventListener('input', () => this.invalidateHit());
    this.queryInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.queryInput.addEventListener('keyup', (e) => e.stopPropagation());
    this.queryInput.addEventListener('keypress', (e) => e.stopPropagation());
    findRow.appendChild(findLabel);
    findRow.appendChild(this.queryInput);
    body.appendChild(findRow);

    // 바꾸기 행
    this.replaceRow = document.createElement('div');
    this.replaceRow.className = 'find-dialog-row';
    const replaceLabel = document.createElement('label');
    replaceLabel.textContent = '바꿀 내용:';
    replaceLabel.className = 'find-dialog-label';
    this.replaceInput = document.createElement('input');
    this.replaceInput.type = 'text';
    this.replaceInput.className = 'find-dialog-input';
    this.replaceInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.replaceInput.addEventListener('keyup', (e) => e.stopPropagation());
    this.replaceInput.addEventListener('keypress', (e) => e.stopPropagation());
    this.replaceRow.appendChild(replaceLabel);
    this.replaceRow.appendChild(this.replaceInput);
    body.appendChild(this.replaceRow);

    // 옵션 행
    const optRow = document.createElement('div');
    optRow.className = 'find-dialog-row';
    this.caseSensitiveCheck = document.createElement('input');
    this.caseSensitiveCheck.type = 'checkbox';
    this.caseSensitiveCheck.id = 'find-case-sensitive';
    this.caseSensitiveCheck.addEventListener('change', () => this.invalidateHit());
    const caseLabel = document.createElement('label');
    caseLabel.htmlFor = 'find-case-sensitive';
    caseLabel.textContent = ' 대소문자 구분';
    optRow.appendChild(this.caseSensitiveCheck);
    optRow.appendChild(caseLabel);

    this.statusLabel = document.createElement('span');
    this.statusLabel.className = 'find-dialog-status';
    optRow.appendChild(this.statusLabel);
    body.appendChild(optRow);

    this.wrap.appendChild(body);

    // 버튼 행
    const btnRow = document.createElement('div');
    btnRow.className = 'find-dialog-buttons';

    const prevBtn = this.createButton('이전 찾기', () => this.findPrev());
    const nextBtn = this.createButton('다음 찾기', () => this.findNext());
    btnRow.appendChild(prevBtn);
    btnRow.appendChild(nextBtn);
    this.wrap.appendChild(btnRow);

    // 바꾸기 버튼 행
    this.replaceButtonRow = document.createElement('div');
    this.replaceButtonRow.className = 'find-dialog-buttons';
    const replaceBtn = this.createButton('바꾸기', () => this.doReplace());
    const replaceAllBtn = this.createButton('모두 바꾸기', () => this.doReplaceAll());
    this.replaceButtonRow.appendChild(replaceBtn);
    this.replaceButtonRow.appendChild(replaceAllBtn);
    this.wrap.appendChild(this.replaceButtonRow);

    // 드래그 이동
    this.makeDraggable(titleBar);
  }

  private createButton(text: string, handler: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'dialog-btn';
    btn.textContent = text;
    btn.addEventListener('click', handler);
    return btn;
  }

  private installKeyCaptureHandler(): void {
    if (this.keyCaptureHandler) return;
    this.keyCaptureHandler = (e: KeyboardEvent) => {
      if (!this._open) return;
      const target = e.target as Node | null;
      const isInDialog = Boolean(target && this.wrap.contains(target));

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        return;
      }

      if (this.isFindEnter(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (target === this.replaceInput && !e.shiftKey) this.doReplace();
        else this.doSearch(!e.shiftKey);
        this.focusInput();
        return;
      }

      if (isInDialog) e.stopPropagation();
    };
    document.addEventListener('keydown', this.keyCaptureHandler, true);
  }

  private removeKeyCaptureHandler(): void {
    if (!this.keyCaptureHandler) return;
    document.removeEventListener('keydown', this.keyCaptureHandler, true);
    this.keyCaptureHandler = null;
  }

  private isFindEnter(e: KeyboardEvent): boolean {
    return e.key === 'Enter'
      && !e.altKey
      && !e.ctrlKey
      && !e.metaKey
      && !e.isComposing;
  }

  private applyMode(): void {
    const isReplace = this.mode === 'replace';
    this.titleLabel.textContent = isReplace ? '찾아 바꾸기' : '찾기';
    this.replaceRow.style.display = isReplace ? '' : 'none';
    this.replaceButtonRow.style.display = isReplace ? '' : 'none';
  }

  private invalidateHit(): void {
    this.currentHit = null;
    this.currentHitQuery = null;
    this.currentHitGeneration = null;
  }

  private doSearch(forward: boolean): void {
    const query = this.queryInput.value;
    if (!query) { this.invalidateHit(); this.statusLabel.textContent = ''; return; }

    FindDialog.lastQuery = query;
    FindDialog.lastCaseSensitive = this.caseSensitiveCheck.checked;

    const ih = this.services.getInputHandler();
    if (!ih) return;
    // A modeless dialog can outlive a document swap without a mutation event.
    // Only a hit from this document may override the new cursor for reverse search.
    if (this.currentHitGeneration !== this.services.wasm.documentGeneration) this.invalidateHit();
    const pos = ih.getCursorPosition();

    // 역방향 검색 시: 현재 선택 영역의 시작 위치를 기준으로 해야
    // 현재 매치를 건너뛰고 이전 매치를 찾을 수 있다.
    let fromSec = pos.sectionIndex;
    let fromPara = pos.paragraphIndex;
    let fromChar = pos.charOffset;

    if (!forward && this.currentHit?.found) {
      fromSec = this.currentHit.sec!;
      fromPara = this.currentHit.para!;
      fromChar = this.currentHit.charOffset!;
    }

    const result = this.services.wasm.searchText(
      query,
      fromSec,
      fromPara,
      fromChar,
      forward,
      this.caseSensitiveCheck.checked,
      // [#3865] 표 셀 안 텍스트도 찾는다. 아래 navigateToHit 이 cellContext 를 셀 좌표로
      // 옮길 수 있으므로 켤 수 있다 — 못 옮기면 "찾았다는데 화면은 안 움직임"이 된다.
      true,
    );

    if (result.found) {
      this.currentHit = result;
      this.currentHitQuery = query;
      this.currentHitCaseSensitive = this.caseSensitiveCheck.checked;
      this.currentHitGeneration = this.services.wasm.documentGeneration;
      this.navigateToHit(result);
      if (result.wrapped) {
        this.statusLabel.style.color = '#0066cc';
        this.statusLabel.textContent = forward ? '맨 마지막입니다. 처음부터 계속합니다.' : '맨 처음입니다. 끝부터 계속합니다.';
      } else {
        this.statusLabel.textContent = '';
      }
    } else {
      this.invalidateHit();
      this.statusLabel.style.color = '#c00';
      this.statusLabel.textContent = '검색 결과 없음';
    }
  }

  private navigateToHit(hit: SearchResult): void {
    navigateToSearchHit(this.services.getInputHandler(), hit);
  }

  private doReplace(): void {
    if (!this.currentHit || !this.currentHit.found
        || this.currentHitQuery !== this.queryInput.value
        || this.currentHitCaseSensitive !== this.caseSensitiveCheck.checked
        || this.currentHitGeneration !== this.services.wasm.documentGeneration) {
      this.invalidateHit();
      this.doSearch(true);
      return;
    }

    const newText = this.replaceInput.value;
    const hit = this.currentHit;

    // 텍스트 치환도 undo 대상 — 편집 라우터의 snapshot 명령으로 기록한다
    // (#1320 계약, pasteImage/objectProps 와 동일 패턴). services 미주입
    // 환경에서만 직접 적용 fallback.
    //
    // [#3865] 표 셀 매치는 반드시 셀 전용 경로로 바꿔야 한다. replaceText 는 본문 좌표만
    // 받으므로 셀 히트의 (sec, para) 를 그대로 넘기면 **표가 놓인 바깥 문단**을 고치게 되어
    // 엉뚱한 곳이 손상된다. 찾기가 셀 매치를 반환하기 시작했으니 여기도 함께 갈라야 한다.
    const cell = hit.cellContext;
    const applyReplace = (wasm: typeof this.services.wasm): ReplaceResult => {
      let replaced: ReplaceResult;
      if (cell) {
        // Snapshot commands do not publish deferred text-mutation effects to
        // InputHandler. Finish pagination here before cursor/render/history reads.
        const r = wasm.runInBatch(() => wasm.replaceTextInCellDeferredPagination(
          hit.sec!, cell.parentPara, cell.ctrlIdx, cell.cellIdx, cell.cellPara,
          hit.charOffset!, hit.length!, newText,
        ));
        replaced = { ok: r.ok };
      } else {
        replaced = wasm.replaceText(
          hit.sec!, hit.para!, hit.charOffset!, hit.length!, newText,
        );
      }
      // A failed result can follow partial mutation. Fail inside the snapshot
      // so rollback runs before history commits or discards a pending redo.
      if (!replaced.ok) throw new Error('replaceText failed');
      return replaced;
    };

    let result: ReplaceResult = { ok: false };
    const ih = this.services.getInputHandler();
    try {
      if (ih) {
        ih.executeOperation({ kind: 'snapshot', operationType: 'replaceText', operation: (wasm) => {
          result = applyReplace(wasm);
          return ih.getCursorPosition();
        }});
      } else {
        result = applyReplace(this.services.wasm);
        this.services.eventBus.emit('document-changed');
      }
    } catch {
      this.statusLabel.style.color = '#c00';
      this.statusLabel.textContent = '바꾸기에 실패했습니다.';
      return;
    }

    if (result.ok) {
      // 바꾼 뒤 다음 검색
      this.statusLabel.style.color = '';
      this.invalidateHit();
      this.doSearch(true);
    }
  }

  private doReplaceAll(): void {
    const query = this.queryInput.value;
    if (!query) return;

    const newText = this.replaceInput.value;

    // 모두 바꾸기는 문서 전역 치환 — snapshot 으로 기록해야 Ctrl+Z 로
    // 한 번에 되돌릴 수 있다.
    let result: ReplaceAllResult = { ok: false };
    const ih = this.services.getInputHandler();
    const replaceAll = (wasm: typeof this.services.wasm): ReplaceAllResult => {
      const replaced = wasm.runInBatch(() => wasm.replaceAll(query, newText, this.caseSensitiveCheck.checked));
      // A failed result may follow partial mutation. Throw inside the snapshot
      // so its existing rollback restores the document before history changes.
      if (!replaced.ok) throw new Error('replaceAll failed');
      return replaced;
    };
    try {
      if (ih) {
        ih.executeOperation({ kind: 'snapshot', operationType: 'replaceAll', operation: (wasm) => {
          result = replaceAll(wasm);
          // No matches must retain both stacks, snapshot budget and clean state.
          return result.count ? ih.getCursorPosition() : null;
        }});
      } else {
        result = replaceAll(this.services.wasm);
        if (result.count) this.services.eventBus.emit('document-changed');
      }
    } catch {
      this.statusLabel.style.color = '#c00';
      this.statusLabel.textContent = '모두 바꾸기에 실패했습니다.';
      return;
    }

    if (result.ok) {
      this.statusLabel.style.color = '';
      this.statusLabel.textContent = `${result.count}개 바꿈`;
      this.invalidateHit();
    }
  }

  private makeDraggable(handle: HTMLElement): void {
    let startX = 0, startY = 0, origX = 0, origY = 0;

    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.wrap.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;

      const onMove = (ev: MouseEvent) => {
        this.wrap.style.left = `${origX + ev.clientX - startX}px`;
        this.wrap.style.top = `${origY + ev.clientY - startY}px`;
        this.wrap.style.right = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
