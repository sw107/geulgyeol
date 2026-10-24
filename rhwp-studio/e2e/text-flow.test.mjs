/**
 * Synthetic editing regression, adapted from RHWP f1f9c6ae (MIT).
 * Real keyboard input → line wrap → Enter → page overflow → Backspace merge.
 * No external document fixture or direct WASM document mutation is used.
 */
import {
  runTest, loadApp, createNewDocument, screenshot, assert, setTestCase,
  getPageCount, getParagraphCount,
} from './helpers.mjs';

const settle = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));
const textAt = (page, paragraph) => page.evaluate(index => {
  const wasm = window.__wasm;
  return wasm.getTextRange(0, index, 0, wasm.getParagraphLength(0, index));
}, paragraph);
const type = async (page, text) => {
  await page.keyboard.type(text);
  await settle(page);
};

await runTest('합성 텍스트 입력·분리·병합', async ({ page }) => {
  // Seed only this owned browser profile. Onboarding is outside this contract.
  await page.evaluateOnNewDocument(() => localStorage.setItem('rhwp-settings', JSON.stringify({
    version: 1, theme: { mode: 'light', skin: 'default', skinChosen: true },
  })));
  await loadApp(page);
  await createNewDocument(page);
  await page.evaluate(() => {
    window.__inputHandler.moveCursorTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    window.__inputHandler.focus();
  });

  setTestCase('새 문서와 실제 입력');
  assert(await getPageCount(page) === 1, '새 문서는 한 쪽');
  assert(await getParagraphCount(page) === 1 && await textAt(page, 0) === '', '새 문서는 빈 문단 하나');
  assert(await page.evaluate(() => document.activeElement === window.__inputHandler.textarea), '편집기 입력 포커스');
  const first = 'Hello World 글결';
  await type(page, first);
  // The upstream `includes(...) || text === ""` incorrectly passed absent input.
  assert(await textAt(page, 0) === first, '입력한 영문·한글 본문이 정확히 일치');
  await screenshot(page, 'text-flow-input');

  setTestCase('자동 줄바꿈은 문단과 본문을 보존');
  const wrapped = first + ' The quick brown fox jumps over the lazy dog.'.repeat(5);
  await type(page, wrapped.slice(first.length));
  const lines = await page.evaluate(() => window.__wasm.getLineInfo(0, 0, 0));
  assert(lines.lineCount > 1, `실제 조판 줄 수가 증가 (${lines.lineCount})`);
  assert(await getParagraphCount(page) === 1, '자동 줄바꿈은 문단을 나누지 않음');
  assert(await textAt(page, 0) === wrapped, '줄바꿈 뒤 전체 텍스트 보존');
  await screenshot(page, 'text-flow-wrap');

  setTestCase('Enter로 정확히 한 문단 분리');
  await page.keyboard.press('Enter');
  await type(page, 'New paragraph after Enter');
  assert(await getParagraphCount(page) === 2, 'Enter 한 번은 문단을 하나 추가');
  assert(await textAt(page, 0) === wrapped, 'Enter 뒤 이전 문단 보존');
  assert(await textAt(page, 1) === 'New paragraph after Enter', '새 문단에 입력됨');

  setTestCase('쪽 넘김 뒤 모든 문단 보존');
  // 60 short lines cross the default blank-template page without font fixtures.
  const expected = [wrapped, 'New paragraph after Enter'];
  for (let i = 1; i <= 60; i++) {
    await page.keyboard.press('Enter');
    const line = `Line ${i}`;
    await type(page, line);
    expected.push(line);
  }
  await settle(page);
  const paragraphs = await page.evaluate(() => {
    const w = window.__wasm;
    return Array.from({ length: w.getParagraphCount(0) }, (_, i) =>
      w.getTextRange(0, i, 0, w.getParagraphLength(0, i)));
  });
  const pages = await getPageCount(page);
  assert(pages >= 2, `자동 쪽 넘김 (${pages}쪽)`);
  assert(JSON.stringify(paragraphs) === JSON.stringify(expected), '쪽 넘김 뒤 62개 문단의 텍스트·순서 정확히 보존');
  await screenshot(page, 'text-flow-overflow');

  setTestCase('Home·Backspace로 마지막 두 문단 병합');
  await page.keyboard.press('Home');
  await settle(page);
  const cursor = await page.evaluate(() => window.__inputHandler.cursor.getPosition());
  assert(cursor.paragraphIndex === 61 && cursor.charOffset === 0, 'Home으로 마지막 문단 시작에 위치');
  await page.keyboard.press('Backspace');
  await settle(page);
  assert(await getParagraphCount(page) === 61, 'Backspace 한 번은 문단을 하나 병합');
  assert(await textAt(page, 60) === 'Line 59Line 60', '병합한 두 문단의 본문 보존');
  assert(await textAt(page, 0) === wrapped, '병합 뒤 앞 문단 보존');
  await screenshot(page, 'text-flow-merge');
}, { skipLoadApp: true });
