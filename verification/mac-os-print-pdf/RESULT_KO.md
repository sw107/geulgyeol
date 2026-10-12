# Mac 실제 인쇄 패널 PDF 저장 검증

검증 기준: main `0fcd046e30f23831222dac9621bad197dce67661`, 2026-10-12. 제품 코드 변경 없이 QA 소스·테스트·검증 문서만 추가했다.

프린터를 선택하지 않은 Mac 인쇄 패널에는 “1페이지 모두”가 표시됐지만, 실제 PDF 저장 결과는 HWP/HWPX 모두 2쪽이었다. 각 원본의 52행은 미리보기와 같은 순서로 1쪽 41행, 2쪽 11행을 유지했다. 이 조건에서는 페이지 누락 결함이 재현되지 않았다.

## 실제 경로와 관찰

Electron 44.3.0 / Chromium 152.0.7977.78, macOS 27.0.1 (26A434). 합성 `print-input.hwp`와 `.hwpx`를 실제 앱에서 열고 `file:print`를 실행했다. 별도 미리보기 창의 인쇄 버튼 → 실제 PDPrintPanel → PDF 메뉴의 “PDF로 저장…” → NSSavePanel → 새 QA 파일로 저장을 CUA로 수행했다. A4, 100%, 모든 페이지, 프린터 미선택 조건이다. Author 필드는 저장 전에 비웠다. 물리 프린터 출력과 Electron `printToPDF`는 실행하지 않았다.

저장 전후 전체 HWP/HWPX export SHA, 본문, 모든 화면/print SVG SHA, 쪽수, dirty, undo/redo 스택 길이가 동일했다. 관찰자가 기록한 native print 진입과 실제 `%PDF-` 파일 생성을 확인했다. 두 형식 종료 뒤 소유한 QA child가 정상 quit/exit 0했고, 앱 목록에서도 종료를 확인했다. 기존 사용자 문서는 사용하지 않았다.

## 원본과 전체 페이지 검사

원본 PDF와 PNG는 로컬 `mac-os-print-pdf/original2-20261012/qa/`에 보존했다. 원본 PDF/PNG는 검사 과정에서 수정하지 않았다. 바이너리와 개인 절대 경로를 공개 저장소에 추가하지 않는다. 상대 파일명·해시는 `proof.json`에 기록했다.

| 원본 | 바이트 | SHA256 |
| --- | ---: | --- |
| os-original-hwp.pdf | 196904 | 71d120ed29a8ebd00507a4762df190a29f2665df5ba72c070fb7dc4c39abd224 |
| os-original-hwpx.pdf | 196909 | e869471c9b928ffd0b755cb0e9b8d97679c11d9503dedd7fc7b78bdfd33134fb |

PDFKit/CoreGraphics로 원본 4페이지를 모두 144dpi, 1190×1684 PNG로 렌더하고 직접 시각 확인했다. 각 media/crop box는 595×842pt, 회전 0이다. 양형식의 같은 쪽 PNG RGB 전체 픽셀은 동일하다. PDF 파일 해시는 생성 시간 등 메타데이터 때문에 서로 다르다.

PDFKit의 모든 페이지 text 추출 결과가 빈 문자열이어서 텍스트 추출만으로 본문 보존을 주장하지 않는다. 로컬 Apple Vision OCR, 실제 잉크 영역 및 원본 print SVG를 함께 비교했다. NFC/공백 외 내용은 정규화하지 않았다. OCR은 104행의 마지막 `é`를 `e`로 읽었다. 이 엄격 차이를 `comparison.json`에 남기고 각 행의 실제 é 몸체 위 분리된 acute 잉크를 추가 확인했다. 육안으로도 한글·ABC 123·é를 확인했다.

총 104행의 라벨 순서, 본문, 쪽 분배, 폰트 폭/높이 기반 잉크 범위, 종이 내부 배치가 통과했다. SVG baseline 대비 실제 잉크 하단 차이는 최대 0.633154369픽셀(144dpi), 허용 2픽셀(1pt) 이내다. 폰트 bearing을 허용하는 행 단위 잉크 범위 검사이며, 글자별 vector path/좌표의 완전 동일성을 입증한 것은 아니다. 네 페이지 모두 가시적 잘림이 없다.

검사 민감도 테스트 7개 통과: 정상, 누락 행, 행 순서 변경, 본문 변경, baseline 4픽셀 이동, 종이 밖 잉크, OCR `e`를 실제 acute 잉크 없이 허용하지 않는 조건. 테스트는 `PYTHONDONTWRITEBYTECODE=1 python3 scripts/tests/os-print-pdf-comparison.test.py`로 실행한다(Pillow 필요). 검사기는 생성된 동일 출력에 덮어쓰지 않는 fresh-output 규칙을 사용한다.

## 패널 “1” 표시 해석

[Electron v44.3.0 PrintViewManagerElectron](https://github.com/electron/electron/blob/v44.3.0/shell/browser/printing/print_view_manager_electron.cc)은 ScriptedPrint를 native 기본 경로로 전달하며 PrintToPdf는 별도 메서드다. [v44.3.0 DEPS](https://github.com/electron/electron/blob/v44.3.0/DEPS)의 Chromium 버전은 152.0.7977.78이다. 해당 [Chromium Mac AskUserForSettings](https://github.com/chromium/chromium/blob/152.0.7977.78/printing/printing_context_mac.mm#L433)는 범위 사전 선택을 피하려고 max_pages를 NSPrintPanel에 넣지 않는다. [GetPageRangesFromPrintInfo](https://github.com/chromium/chromium/blob/152.0.7977.78/printing/printing_context_mac.mm#L801)는 AllPages가 true이면 first/last 값으로 범위를 만들지 않는다. 따라서 이 관찰에서 패널의 “1”을 엔진 쪽수나 출력 제한으로 해석할 수 없다. 실제 2쪽 OS 출력과도 일치한다.

## 보존과 자원

미커밋 dirty 4파일·기존 cache, lock 3종, WASM, PR40–42 및 과거 QA 증거를 보존했다. 이전 증거 273개 SHA와 이전 Swift cache 133개 파일 내용은 동일했다. 제품 desktop 파일은 main과 일치하는 frozen runtime을 사용했고, 기존 Studio/WASM은 재사용했다(WASM SHA는 proof 참조). 새 앱 패키지·엔진 빌드·라이브러리 설치는 없었다.

PDFKit/Vision SDK 컴파일은 기존 Swift module cache를 재사용했지만 실제 추가 할당은 192872448바이트(183.94MiB)였다. 이전 cache 내용은 보존했고 더 컴파일하지 않았다. 전체 소유 경로·역사 QA·공유 Swift cache 합계 4676820992바이트는 7GiB 한도 이내였다. 초기 QA 준비 경합(인쇄 명령 ok=false, native 출력 미진입)과 첫 Swift SDK 키 타입 오류는 별도 실패 기록으로 보존했다. 수정 후 완료한 원본 PDF 검사를 반복 실행하지 않았다.

## 남은 범위

이번 결과는 합성 A4 일반 본문 2쪽에 한정된다. PDF 검색/복사 가능한 텍스트, 표·그림·혼합 용지, 실제 프린터, Linux, 배포 앱 패키지, 파일 메뉴 별도 PDF 내보내기 경로 및 Electron printToPDF는 검증하지 않았다. PDFKit 빈 text만으로 원본이 raster라는 결론을 내리지 않는다. 다음 후보는 실제 Mac OS PDF의 검색·복사 가능성 원인 조사 또는 표·그림 문서의 같은 경로 검증이다. 병합·릴리스는 독립 검토 후 부모가 조율한다.

## QA 실행 준비

이 driver는 기존 합성 QA 준비 규약을 사용한다. 새 phase 아래 `source/`의 frozen desktop/runtime 및 Studio/공식 Electron·puppeteer-core 경로, `qa/bootstrap.cjs`, `qa/runtime/`, 빈 `qa/files`, `qa/reference`, `qa/pdf`와 전체 실행 root의 running evidence budget marker를 먼저 준비해야 한다. fixture는 같은 전체 root의 `mac-print-preview/fixtures/fixture-proof.json`으로 핀한다. 준비된 phase에 `node scripts/check-electron-os-print-pdf.mjs <phase>`를 실행한 뒤, 허용된 native CUA 관찰자가 실제 버튼·시트·저장 동작을 확인하고 `os-pdf-saved-<format>.json` receipt를 쓴다. 단순한 receipt 파일 생성만으로 native UI 검증을 대신할 수 없다. Driver는 완료된 phase·원본 출력에 재실행하지 않는다.

macOS SDK가 있는 환경에서 Swift inspector와 OCR helper를 각각 컴파일하고, inspector에 원본 PDF/새 출력 디렉터리를, OCR helper에 각 PNG/새 JSON 경로를 넘긴다. `python3 -B scripts/compare-os-print-pdf.py <phase>`는 `qa/reference`, 두 `qa/render-<format>/inspection.json`, PNG 및 `ocr-<page>.json`을 사용해 새 `qa/comparison.json`을 만든다. 이번 완료 phase의 기존 비교 파일은 덮어쓰지 않는다.

최종 evidence budget: normal 701173760바이트 / 805306368, failure 153493504바이트 / 268435456, 미완료 phase 0개, 여유 공간 56051793920바이트. 완료 marker를 기록했다. 문서 추가 뒤 소유 경로 합계는 4676833280바이트였으며 동일한 7GiB 한도 안이다.
