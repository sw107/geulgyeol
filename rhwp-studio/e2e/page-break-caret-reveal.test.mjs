/**
 * Cmd+Enter 쪽 나누기 뒤 새 쪽 캐럿과 편집 영역 viewport가 함께 이동하는 회귀.
 */
import {
  runTest,
  createNewDocument,
  loadApp,
  screenshot,
  typeText,
  assert,
} from './helpers.mjs';

async function pressCommandEnter(page) {
  await page.keyboard.down('Meta');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Meta');
}

runTest('쪽 나누기 캐럿·viewport 추종', async ({ page }) => {
  // Prepare only the owned browser profile; onboarding is not under test.
  await page.evaluateOnNewDocument(() => localStorage.setItem('rhwp-settings', JSON.stringify({
    version: 1, theme: { mode: 'light', skin: 'default', skinChosen: true },
  })));
  await loadApp(page);
  await createNewDocument(page);
  await page.evaluate(() => {
    window.__inputHandler.moveCursorTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    window.__inputHandler.focus();
  });
  await typeText(page, '쪽 나누기 앞');
  assert(await page.evaluate(() => window.__wasm.getTextRange(0, 0, 0, 100)) === '쪽 나누기 앞', '쪽 나누기 전 합성 입력 확인');

  const prepared = await page.evaluate(() => {
    const input = window.__inputHandler;
    const container = document.getElementById('scroll-container');
    const length = window.__wasm?.doc.getParagraphLength(0, 0) ?? 0;
    input.viewportManager.setZoom(1.5);
    input.viewportManager.setScrollTop(0);
    const moved = input.moveCursorTo({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: length,
    });
    return {
      moved,
      wasmPageCount: window.__wasm?.pageCount ?? 0,
      virtualPageCount: input.virtualScroll.pageCount,
      scrollTop: container?.scrollTop ?? -1,
    };
  });
  assert(prepared.moved, '쪽 나누기 전 첫 문단 끝에 커서 배치');
  assert(prepared.wasmPageCount === 1 && prepared.virtualPageCount === 1,
    `한 쪽 fixture 준비 (${prepared.wasmPageCount}/${prepared.virtualPageCount})`);

  await pressCommandEnter(page);

  await page.waitForFunction(() => {
    const input = window.__inputHandler;
    const rect = input?.cursor?.getRect?.();
    const container = document.getElementById('scroll-container');
    return (window.__wasm?.pageCount ?? 0) === 2
      && input?.virtualScroll?.pageCount === 2
      && rect?.pageIndex === 1
      && (container?.scrollTop ?? 0) > 0;
  }, { timeout: 10_000 });

  const state = await page.evaluate(() => {
    const input = window.__inputHandler;
    const rect = input.cursor.getRect();
    const pos = input.cursor.getPosition();
    const zoom = input.viewportManager.getZoom();
    const pageOffset = input.virtualScroll.getPageOffset(rect.pageIndex);
    const container = document.getElementById('scroll-container');
    const caret = document.querySelector('#scroll-content .caret');
    const style = caret && getComputedStyle(caret);
    const box = caret?.getBoundingClientRect();
    const caretDisplayed = !!box && box.width > 0 && box.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
    const caretTop = Number.parseFloat(caret?.style.top ?? 'NaN');
    const caretHeight = Number.parseFloat(caret?.style.height ?? 'NaN');
    return {
      pos,
      rect,
      pageOffset,
      caretTop,
      caretDisplayed,
      caretHeight,
      expectedCaretTop: pageOffset + rect.y * zoom,
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      caretViewportTop: caretTop - container.scrollTop,
      caretViewportBottom: caretTop + caretHeight - container.scrollTop,
    };
  });

  assert(state.caretDisplayed, '캐럿 DOM이 실제 표시 상태');
  assert(state.pos.paragraphIndex === 1 && state.pos.charOffset === 0,
    `커서가 새 문단 첫 위치로 이동 (${JSON.stringify(state.pos)})`);
  assert(state.rect.pageIndex === 1 && state.pageOffset > 0,
    `커서가 새 쪽 좌표를 소유 (page=${state.rect.pageIndex}, offset=${state.pageOffset})`);
  assert(Math.abs(state.caretTop - state.expectedCaretTop) < 1,
    `캐럿 DOM이 새 쪽 offset으로 재배치 (${state.caretTop} ≈ ${state.expectedCaretTop})`);
  assert(state.scrollTop > 0, `편집 영역이 새 쪽으로 스크롤 (${state.scrollTop})`);
  assert(state.caretViewportTop >= 19 && state.caretViewportBottom <= state.clientHeight - 19,
    `캐럿이 viewport 여백 안에 표시 (${state.caretViewportTop}..${state.caretViewportBottom}/${state.clientHeight})`);
  await typeText(page, '새 쪽 입력');
  const text = await page.evaluate(() => [0, 1].map(index => window.__wasm.getTextRange(0, index, 0, 100)));
  assert(text[0] === '쪽 나누기 앞' && text[1] === '새 쪽 입력', '쪽 나누기 후 새 쪽에 이어 입력하며 앞 본문 보존');
  await screenshot(page, 'page-break-caret-and-input');
}, { skipLoadApp: true });
