# 병합 owner Shift+Tab 및 편집 history 이동 불변

이번은 SQUEEZE 일반 셀 **3**이 있는 제외표의 **32행 × 2열 병합 owner 24** 검증이다.
승인된 PR27 HEAD `88cd905130cb3b0e5eb84c428798f5788d7d45b8` 기반 별도 브랜치다.
PR26/27 HEAD와 증거를 보존했고 새로운 제품 결함을 찾지 않아 제품 소스는 변경하지 않았다.

## 계약과 실제 실행

`cursor.ts`의 Shift+Tab은 읽기 순서상 이전 셀의 **마지막 문단 끝**으로 이동한다.
cell 25(row 8, col 2)의 이전 셀은 owner 24(row 8, col 0)다. 보존 원본의
owner 24는 문단 64개이며 마지막 문단 63은 Unicode scalar 66개다. emoji 두 개를
포함하므로 UTF-16 길이 68을 charOffset으로 사용하지 않는다.

| 실제 Mac Electron 입력 | clean Shift+Tab | 실제 편집 후 Tab / Shift+Tab |
| --- | --- | --- |
| HWP 원본 | 25 → owner 24, paragraph 63, offset 66 | owner 24 → 25 시작 → owner 24 끝 |
| HWPX 원본 | 25 → owner 24, paragraph 63, offset 66 | owner 24 → 25 시작 → owner 24 끝 |

최종 집계는 **4개 시나리오, navigation 전이 6건**이다. clean 상태는 dirty=false,
undo/redo/snapshot 0/0/0을 유지했다. 편집 시나리오는 owner 24 문단 0의 시작에
실제 `NAV_EDIT🙂` 입력을 넣어 dirty=true와 undo 1 / redo 0 / snapshot resource 1을
확인한 뒤 Tab과 Shift+Tab을 눌렀다. 그 이동은 새 entry나 snapshot을 만들지 않았다.

각 전이 전후 전체 페이지 SVG, 모델, HWP 및 HWPX export bytes가 exact다.
body·표 속성·페이지 정의·스타일 및 나머지 셀을 보존했고 navigation은 문서 변경을
하지 않았다. 보존된 command의 기록된 필드도 같으며 `snapshot:insertText`의
beforeId, afterId=null, timestamp, 원래 cursorBefore/After 및 resource 1을 유지했다.
실제 navigation 시작 cursor와 끝 cursor, cellPath, dirty, history counts를 각 상태
파일에 기록하고 편집 왕복 두 전이 사이의 커서 연속성까지 독립 비교했다.

최종 Electron 및 Node 검사 exit 0, 정상 quit이다. source input bytes, QA 소스와
seed before/after hash 및 actual engine bytes를 확인했다. native chooser 응답은
통제했으며 physical IME·수동 GUI 검증으로 표시하지 않는다.

## 증거·빌드·예산 보존

첫 실행도 4개 시나리오/6전이가 통과했다. 그 상태의 `start`는 비교 기준 cursor였으므로
실제 각 전이 직전의 `navigationStart`를 추가해 최종 실행을 새 phase에서 수행했다.
첫 QA 및 collector 소스를 checkpoint로 보존했고 첫 실행·비교 증거를 덮어쓰거나
최종 6건에 중복 집계하지 않았다.

기존 원본·dirty·전체 이전 QA·PR26/27 공개 증거 **7,440개 파일 해시**는 같다.
이전 PR27의 verified runtime 52개를 하드링크 재사용했고 제품 소스 전체가 그 빌드
source pin과 일치한다. 새 UI/WASM 빌드·앱/zip 패키지·synthetic 테스트 폴더는 없다.
이전 UI **build child exit 0 / coordinator 후처리 exit 1**의 구분과 해당 source proof,
실패 기록, complete marker, 원래 pin 및 verified pin도 그대로 유지했다. 이번 실행의
Node/Electron exit 0을 이전 build coordinator exit 0으로 확대하지 않는다.

추가 파일 전에 128 MiB normal / 16 MiB failure forecast와 전체 예산을 확인했다.
최종 기록 전 normal **607,744,000B**, failure **75,276,288B**, unfinished phase 0이다.
한도는 각각 805,306,368B / 268,435,456B이며 free는 안전하한 16,374,562,816B 위다.
완료 snapshot의 정확한 free/forecast는 `proof.json`에 있다. canonical `/tmp` 및
Python tempdir의 모든 `geulgyeol-*synthetic-*`를 inode 중복 없이 계산한 전역 합성
증거는 **15,126,528B / 32,000,000B**다. 기존 파일이나 캐시를 삭제하지 않았다.

## 재검증 및 한계

보존 input seed는 기존 `fallback-lineWrap` 두 files, `historyCell:24`,
`repairExpected:true`, `fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-shift-tab","owner-edited-navigation"]`를 사용한다.
`RUN_ROOT`에는 첫/최종 Electron phase, source checkpoint, prior-pins.json이 필요하며
인접 PR27 `excluded-owner-tab/build-runtime`의 verified pin과 source proof를 사용한다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron-final" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-shift-tab-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

위 Electron phase는 fresh runtime이 준비돼 있어야 하며 기존 폴더를 재사용 실행하지
않는다. 이미 실행된 증거의 독립 비교는 두 번째 명령만 새 비교 폴더에 실행한다.
checker와 collector syntax, 실제 Electron 및 독립 SHA/state 비교를 확인했다.

비어 있지 않은 **undo stack 1개**에서 navigation 불변을 검증했다. undo 실행 후
비어 있지 않은 redo stack, 복수 entry, 마지막 셀 행 추가, 중첩 표, 저장·재열기,
새 Native 실행, IME·수동 GUI·Linux/CI는 이번에 실행하지 않았다. history undo/redo
pair 및 saved reopen 수는 모두 0이다. history command 실행 가능성을 별도 증명한
결과로 확대하지 않는다. 기존 누락 입력에 막힌 Rust unit 통과나 제외 geometry 지원
승격, right page18 형식 간 정답 판정도 주장하지 않는다.

다음 최소 후보는 실제 undo 뒤 redo entry를 보존한 상태의 Tab/Shift+Tab 불변이다.
PR25 직접 승인 대기를 유지하며 추가 병합 승인 요청을 하지 않았다.
