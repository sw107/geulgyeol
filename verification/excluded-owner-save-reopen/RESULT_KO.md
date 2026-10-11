# Owner 입력·이동·history 뒤 같은 형식 저장·재열기

승인된 PR33 HEAD `c926151078312808d6155faf0cfe22e11285650c`를 기반으로,
실제 Mac Electron에서 누적 변경의 저장 통합 경로를 HWP/HWPX 각 1건 확인했다.
새 제품 결함은 재현되지 않았다. 제품 코드는 변경하지 않고 QA handler와 독립
collector, 검증문서만 추가했다. PR27의 top-level 셀 이동 수정이 포함된 고정 UI와
기존 WASM을 재사용했으며 새 빌드·패키지·Native 실행은 없다.

## 기존 증거와 이번 범위

| 증거 | 이미 확인한 범위 | 이번에 추가한 범위 |
| --- | --- | --- |
| PR26 | owner24 입력, undo/redo, 같은 형식 저장·재열기 | 이동과 저장을 연결한 경로 |
| PR27~29 | Tab/Shift+Tab 및 이동 뒤 history 복원 | 그 상태에서 native 저장·재열기 |
| PR30~33 | redo 교체, 대화상자 취소·포커스·미적용 입력 | 저장 직후 dirty/history 및 실제 재열기 정책 |

위 기존 실행을 새 실행 건수에 합산하지 않았다. 이번 실제 시나리오는 **2건**,
이동 **4회**, history key **8회**(undo/redo **4쌍**), 같은 형식 저장·재열기 **2회**다.
독립 collector는 같은 raw 증거를 읽는 consumer이며 새 레이아웃 실행으로 집계하지
않는다. 첫 collector 결과를 보존하고 반복 머리행/후행본문 assertion을 강화한
`comparison-final` 결과를 공개했다. Electron은 다시 실행하지 않았다.

각 형식의 흐름은 다음과 같다.

1. clean 원본의 merged owner24(행8/열0, 32행×2열) 문단0/offset0에 `SAVE_NAV🙂` 입력.
2. 실제 Tab으로 cell25 문단0/offset0, Shift+Tab으로 owner24 문단63/scalar66 이동.
3. 실제 undo → redo로 전체 원본/편집 SVG·모델을 복원.
4. 앱 상단 저장 버튼으로 같은 형식의 사본을 실제 filesystem에 저장.
5. 저장 뒤 실제 undo → redo를 다시 실행해 history 유지 및 dirty 정책 확인.
6. 실제 앱 열기로 그 사본을 재열기. dirty 확인창 응답은 QA가 discard로 제어.

대상 owner는 일반 SQUEEZE cell3과 구별된다. 마지막 문단은 66 Unicode scalar
(UTF-16 68)다. 최초 선택과 history key helper는 QA의 명시적 editor focus를 사용한다.
이 결과를 물리 키보드나 포커스 자동 복귀 검증으로 확대하지 않는다.

## 결과와 정책

| 같은 형식 | 이동 | undo/redo 쌍 | 저장·재열기 | 페이지 |
| --- | ---: | ---: | ---: | ---: |
| HWP → HWP | 2 | 2 | 1 | 9 |
| HWPX → HWPX | 2 | 2 | 1 | 9 |

이동은 full SVG/model과 **두 export byte 배열**을 모두 유지했다. history 복원은
serialized container bytes를 제외한 **full SVG/model**을 비교했다. 저장 파일 bytes는
저장 직전 해당 형식 export와 native IPC payload의 SHA/길이가 일치했다. 같은 형식
재열기는 전체 9페이지 SVG, 텍스트, 본문/셀 문단·문자 서식, 스타일, 페이지 정의,
표 속성, 48행/81셀 및 merged topology를 그대로 유지했다. manifest는 전체 SVG
문자열을 보존하며 collector가 각 페이지의 SHA/UTF-8 길이를 raw state와 대조했다.

반복 머리행 cell0/1/2의 rendered runs는 입력 전후 9페이지 모두 동일했고,
`AFTER_TABLE_END` 후행본문 표시는 전체 페이지에서 1회였다. 저장·재열기의 전체
SVG/모델 일치로 이 상태도 유지됐다. 제외 geometry를 supported scope로 승격하거나
모든 배치의 정답으로 판정하지 않았다.

| 시점 | dirty | undo / redo | snapshot resources |
| --- | --- | --- | ---: |
| 입력 직후·이동 후 | true | 1 / 0 | 1 |
| 저장 직후 | false | 1 / 0 | 1 |
| 저장 뒤 undo | true | 0 / 1 | 2 |
| 저장 뒤 redo | true | 1 / 0 | 1 |
| 실제 재열기 완료 | false | 0 / 0 | 0 |

저장은 command 객체·필드·snapshot ID·cursor·generation을 유지하며 파일 이름과 dirty를
갱신했다. undo/redo 뒤에는 저장된 텍스트와 같아도 dirty=true인 현재 정책을 확인했다.
재열기는 document generation을 바꾸고 기존 history/resources를 해제했다. 두 형식
모두 실제 unsaved open 확인창이 1회 발생했다.

새 handler의 저장→재열기 구간에서는 기존 QA `load()`나 `notifySaved()`를 호출하지
않았다. 제품의 `baram.js saveCurrent()` 완료 통지와 `open()`/`loadDocument()` 경로를
사용했다. 초기 fixture 준비에서만 기존 load helper를 사용했다. 따라서 QA가 dirty를
먼저 해제해 실제 저장/열기 정책을 가리는 결과가 아니다.

Node harness 0, Electron app 0 및 정상 quit을 별도로 확인했다. errors 0, fallback
완화 비교 0, 전체 manifest 계획/결과 2건이 일치했다. raw state 20개는 새 private
QA에 보존했다. JS/Python syntax와 `git diff --check`도 통과했다. 기존 QA 도구 unit
33건은 재실행하지 않았고 이번 통과 수에 포함하지 않는다.

## 재검증

기존 원본 seed의 `historyCell:24`, `repairExpected:true`, `fallbackExactHistory:true`,
`sameFormatSaveReopen:true`, `operations:["owner-save-reopen"]`를 사용한다. runtime은
PR27 고정 build의 external `runtime-pin-verified.json`과 52개 파일을 대조하여 새 폴더에
하드링크 재사용한다. 전체 예산 preflight를 먼저 수행해야 한다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
GEULGYEOL_QA_NORMAL_FORECAST_BYTES=67108864 \
GEULGYEOL_QA_FAILURE_FORECAST_BYTES=16777216 \
python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
python3 -B scripts/check-owner-save-reopen-evidence.py \
  "$RUN_ROOT" "$WASM_PKG" "$RUN_ROOT/fresh-comparison"
```

## 보존·예산·남은 범위

실행 전 기존 QA, 공개 검증문서, 원본 dirty 파일 **9,317개 해시**를 고정했고 collector
종료까지 동일했다. 개인 원본·raw 사본·profile·runtime·경로 목록은 공개하지 않았다.
과거 failed marker, 초기 진단 실패, 원래 build child 0 / coordinator 후처리 1도 유지했다.

전체 새 증거 forecast는 normal **100,663,296B (96MiB)** / failure **16,777,216B**였고,
producer profile/raw/저장/manifest 64MiB, pins/collector/문서 8MiB, margin 24MiB를 포함했다.
실행 전 normal 661,168,128B / failure 84,967,424B, free 45,655,539,712B였다.
문서 직전 완료 snapshot과 한도는 동봉 proof에 기록했다. globalSynthetic은
**15,126,528B / 32,000,000B**로 유지됐으며 실행 중 phase는 0이다. 삭제·재패키징·
새 캐시 빌드는 하지 않았다. 다음 실행은 현재 할당량으로 전체 forecast를 다시 검사한다.

cross-format right page18 wrap 정답은 계속 미판정이다. 한컴 Viewer는 편집 oracle이
아니며 이번 같은 형식 통과로 그 차이를 해결했다고 주장하지 않는다. 물리 IME·OS
파일 chooser·수동 GUI·Linux/CI·새 packaged app은 미검증이다. Rust unit은 기존 누락
입력 4개가 있어 실행하지 않았다. PR25 직접 승인 대기는 유지하고 병합하지 않았다.

다음 최소 구현/검증 후보는 **재열기 후 owner24 재입력과 Tab/Shift+Tab·undo/redo**다.
새 document generation에서 원래 history가 제거된 뒤 신규 snapshot/history가 올바르게
생성되는지 확인하면 이번 저장 통합과 이어진다. 새 제품 수정은 명확한 결함 재현 시에만
진행한다.
