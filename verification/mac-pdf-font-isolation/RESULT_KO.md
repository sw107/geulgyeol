# Mac PDF 검색·복사 손실의 CFF/Type3 원인 분리

2026-10-12. base main a6d9cfec2add44dd1fee97ee905478de02667e0d. 이 묶음은 QA 소스·민감도 테스트·검증 문서만 추가한다. 제품 수정이나 해결 완료를 주장하지 않는다.

## 확인된 원인

기존 합성 HWP 인쇄 SVG의 첫 행(21개 text 노드, 한글·영문·숫자·é)을 재사용했다. 기본 glyph는 이 Mac의 AppleSDGothicNeo-Regular CFF 글꼴로 출력된다. 설치 글꼴의 sfntVersion=OTTO, CFF table=true, glyf=false, fsType=8을 읽었다. fsType=8을 임베딩 금지로 해석하지 않는다.

[Chromium 152.0.7977.78 DEPS](https://github.com/chromium/chromium/blob/152.0.7977.78/DEPS#L330)는 Skia b6d106297ff9ef2ff8094033695d045e87775581을 고정한다. 해당 [SkPDFFont::FontType](https://github.com/google/skia/blob/b6d106297ff9ef2ff8094033695d045e87775581/src/pdf/SkPDFFont.cpp#L333)은 CFF를 Type3 fallback으로 처리한다. 실제 Electron 44.3.0 printToPDF에도 Apple 글꼴의 Type3와 ToUnicode 매핑이 기록된다.

동일 화면을 실제 PDPrintPanel → PDF로 저장 → NSSavePanel에서 저장하면 Type3 본문이 glyph path로 바뀌고 Unicode 텍스트가 사라진다. TrueType Arial의 영문은 텍스트로 남는다. [MetafileSkia::RenderPage](https://github.com/chromium/chromium/blob/152.0.7977.78/printing/metafile_skia.cc#L315)는 [PdfMetafileCg::RenderPage / CGContextDrawPDFPage](https://github.com/chromium/chromium/blob/152.0.7977.78/printing/pdf_metafile_cg_mac.cc#L237)로 PDF를 재생한다. 실제 전후 구조·추출 차이와 이 native 재생 경로로 CFF→Skia Type3→Mac Quartz path 변환의 손실을 확인했다. Quartz 내부 구현의 세부 원인까지 증명한 것은 아니다. raster 출력으로 분류하지 않는다.

## 실제 격리 대조

첫 7조건: 원래 engine 속성, textLength/lengthAdjust 제거, lengthAdjust만 spacing, Arial, Apple SD Gothic Neo, 단일 SVG text, 단일 HTML text. 원래 속성의 기본 글꼴과 속성을 제거·변경한 기본 글꼴 모두 OS PDF에서 본문 텍스트가 사라졌다. 따라서 textLength 삭제를 이 손실의 해결책으로 채택할 근거가 없다. Arial의 영문은 남지만 한글은 Apple fallback에서 사라졌다. SVG/HTML 구분 자체도 한글 손실을 해결하지 않았다.

추가 7조건: 원래 CFF, 기존 번들 NotoSansKR-Regular.woff2(TrueType)의 원래 길이, 길이 속성 제거, spacing, 75%, 125%, HTML text. fontFace 실제 loaded를 확인했고 기존 번들 파일만 읽었다. 실제 OS PDF에서 Noto의 Type0/CIDFontType2/ToUnicode가 유지되고 TrueType 6조건의 모든 합성 글자 inventory가 남았다. CFF 조건의 본문은 없어졌다(다른 TrueType fallback의 é만 남음). 문자 inventory와 읽기 순서 동일성을 구분한다.

각 묶음에서 **별도 Electron webContents.printToPDF 1개 + 실제 OS PDF 1개**, 총 원본 PDF 4개를 생성했다. 모두 A4 1쪽이고, PDFKit/CoreGraphics로 4쪽 모두 144dpi 렌더·직접 시각 확인했다. 가시적 잘림은 없다. 폰트/길이 변경에 따른 모양 차이는 의도된 대조이며 원래 glyph 모양·픽셀 동일성을 주장하지 않는다. Mac paper-box 반올림 차이도 있어 두 경로 전체 픽셀 동일성을 주장하지 않는다. PDF/PNG를 수정하지 않았다. 원본 파일 SHA·전체 추출·font subtype은 proof.json과 text-comparison.json에 있다. 바이너리와 개인 절대 경로는 공개하지 않는다.

실제 Mac 미리보기에서 TrueType OS PDF의 한글 검색 6개, ABC 검색 5개(75% 조건에서는 A B C로 나뉨)를 확인했다. 본문 AX 요소를 double-click해 실제 “미리보기”를 선택하고 Cmd-C 후 비운 검색 필드에 Cmd-V하면 같은 한글이 붙었다. 반면 PRINT_00 정확 검색은 0개였다. PDFKit 추출에도 밑줄이 다른 위치로 정렬되고 공백이 삽입된다. 따라서 TrueType 전환이나 직접 printToPDF만으로 모든 정확 검색·전체 행 복사가 해결됐다고 주장할 수 없다. 최초 좌표 drag는 텍스트를 복사하지 못했고, 실제 본문 요소 선택으로 재검증했다. 사용자 중간 입력은 근거에서 제외했다.

두 소유 Electron QA는 각각 normal quit / will-quit / exact child exit 0을 확인했다. 마지막 Preview QA 창 close 버튼을 눌렀으나 이후 AX 조회는 timeoutReached여서 도구에 의한 닫힘 확인은 보류다. 기존 Preview 앱을 quit/강제 종료하지 않았다. 이전 “창 없음” 사용자 확인은 재개 근거로 사용했고 앱 프로세스 종료 증명으로 확대하지 않았다.

## 제품 후보와 남은 구현

편집기의 등록 webfont 스타일을 인쇄 창에 복사하는 작은 후보를 작성하고 관련 테스트 10개를 통과했다. 그러나 Mac 빌드는 외부 webfont를 비활성화하고 main은 외부 리소스를 차단한다. 스타일 전달만으로 기본 Apple CFF를 TrueType으로 만들 수 없고, 이번 후보가 원래 인쇄·검색을 고쳤다는 최종 제품 검증도 없다. 후보 source/diff/test는 별도 로컬 QA에 보존한 뒤 두 제품 파일을 base main으로 원복했다. 글꼴 정책·보안·길이 속성·SVG 좌표는 제품에서 변경하지 않았다. 숨겨진 중복 텍스트도 추가하지 않았다.

기존 글꼴 모양을 유지하는 다음 구현 후보는 **native Quartz 재생을 거치지 않는 전용 PDF 저장 경로**다. 직접 printToPDF에는 CFF의 ToUnicode가 남는다는 대조 근거가 있다. 실제 제품에서는 안전한 소유 print webContents/OS 저장 chooser 경계를 설계하고, per-glyph 읽기 순서·정확 검색 문제를 추가 해결한 뒤 HWP/HWPX 전체 배치·쪽수·본문·dirty 및 비어 있지 않은 undo/redo 이력·검색/선택/복사를 최종 코드로 검증해야 한다. 이 기능은 이번 묶음에서 구현하지 않았다.

TrueType 글꼴 선택은 일부 검색·복사가 가능한 대안으로 확인됐지만 glyph 모양을 바꾼다. 자동 글꼴 대체를 기본 해결책으로 채택하지 않았다. 원래 CFF를 그대로 둔 실제 OS PDF 저장의 텍스트 보존은 현재 앱 소스의 최소 수정으로 검증된 해결책을 찾지 못했다. Electron/Skia/Quartz 자체 수정·새 패키징은 이 범위 밖이다. 표·그림 출력은 이 문제 뒤의 별도 검증으로 남긴다.

## 재현과 테스트

전체 QA root와 fresh phase의 EvidenceBudget을 시작한다. 기존 합성 hwp-page-1.svg를 입력으로 `python3 -B scripts/prepare-pdf-font-isolation.py SOURCE_SVG FRESH_PHASE` 또는 `prepare-tt-pdf-font-isolation.py`를 실행한다. 두 매개변수형 생성기가 실제 실행 HTML을 바이트 단위로 재현했다. 이미 완료한 phase에는 재실행하지 않는다. 새로운 source glyph나 사용자 원본을 임의로 넣지 않는다.

실행 중인 소유 QA가 없음을 확인한 후 기존 공식 Electron에 `GEULGYEOL_PRINT_ISOLATION_DIR=FRESH_PHASE`와 `scripts/check-electron-pdf-font-isolation.cjs`를 전달한다. driver는 별도 printToPDF를 먼저 생성하고 actual native 버튼·시트·새 파일 저장은 CUA가 관찰해야 한다. os-saved.json receipt는 실제 관찰에만 근거한다. physical 출력은 하지 않는다. 기존 검사 실행 파일 또는 scripts/inspect-os-print-pdf.swift로 원본을 새 render 디렉터리에 검사한다. 비교기는 두 phase와 fresh output JSON 경로를 받는다.

`python3 -B scripts/tests/pdf-font-isolation.test.py` 7개 통과: 정상 문자/순서, header-only, 한글 누락, 글자 중복, inventory만 동일한 읽기 순서 변경, case 누락, case 순서 변경. JS syntax/diff 검사 통과. 후보 제품 테스트는 미채택 후보의 근거일 뿐 최종 제품 해결 회귀검증으로 세지 않는다.

dirty4·lock3·WASM·PR40–42 pin·원본 PDF2·이전 증거273·Swift cache133 SHA를 보존했다. 새 engine/SDK 컴파일·앱 패키징·라이브러리 설치·physical 출력은 없다. 첫 민감도 테스트의 단일 괄호 syntax 오류와 Python WOFF2 decoder의 brotli 미설치 진단을 실패 근거로 보존했고, 설치 대신 WOFF2 header의 TrueType flavor를 읽고 실제 PDF FontFile2 결과로 확인했다. 최소 source/JSON/PNG/PDF/profile만 별도 QA 경로에 생성했다. 소유 경로 총합·예산은 proof와 budget-final 기록을 참조한다.
