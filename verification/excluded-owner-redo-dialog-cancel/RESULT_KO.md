# 단일 redo entry와 셀 속성 대화상자 취소

승인된 PR30 HEAD `02981d3719b41ce4a2de84bbd94e2de63e32dd6b` 기반 별도 QA다.
SQUEEZE 일반 셀은 **3**, 대상은 **32행 × 2열 병합 owner 24**다.
새 제품 결함은 발견하지 않았고 제품 소스·UI/WASM은 변경하지 않았다.
PR30 고정 HEAD와 복구 6건(setup undo 2 + 새 undo 2 + redo 2), 새 undo→redo pair
총 2회라는 기존 집계 및 이전 원본·dirty·증거를 보존했다.

## 실제 Mac Electron 시나리오

HWP/HWPX에서 각각 owner 24 문단 0 시작에 실제 `REDO_CANCEL🙂`를 입력하고
실제 undo하여 단일 redo entry를 보유했다. undo 0 / redo 1 / resource 2이며 dirty는
true다. 현재 셀 모드에서 제품 `table:cell-props` 명령으로 대화상자를 열었다.
표 개체 선택 모드를 만들지 않았으며 실제 셀 모드의 기본·여백/캡션·표·셀 탭과
취소 버튼 1개를 확인했다. 입력 필드를 변경하거나 확인 버튼을 누르지 않았다.
실제 Electron renderer에서 취소 버튼을 클릭하고 대화상자가 숨겨질 때까지 기다렸다.

| 단계 (각 형식 동일) | undo | redo | resource | dirty |
| --- | ---: | ---: | ---: | --- |
| 입력 직후 | 1 | 0 | 1 | true |
| setup 실제 undo | 0 | 1 | 2 | true |
| 셀 속성 열기 | 0 | 1 | 2 | true 유지 |
| 셀 속성 취소 | 0 | 1 | 2 | true 유지 |
| 취소 후 실제 redo | 1 | 0 | 1 | true |
| 뒤이은 실제 undo | 0 | 1 | 2 | true |

열기와 취소 각각에서 **전체 모델·SVG와 HWP/HWPX 양 export bytes**가 redo 보유
직전 상태와 같았다. 본문·서식·표/셀 속성·페이지·스타일 및 내용은 같았으며 cursor,
dirty, history counts/resources와 전체 command 필드도 같았다. before/after snapshot
IDs **0, 1**을 유지했다. read-only Puppeteer JSHandle로 같은 redo command 객체라는
것도 각 단계에서 확인한 뒤 handle을 해제했다. product command 또는 snapshot
메서드를 대체하거나 직접 snapshot 복원 probe를 실행하지 않았다.

취소 후 실제 redo 단축키는 이전 편집 모델·SVG와 scalar cursor offset **12**를
복구했고, 뒤이은 실제 undo는 원본 모델·SVG와 cursor offset 0을 복구했다. 이 history
복구 비교는 **HWP/HWPX export container bytes를 제외**한다. beforeId 0과 timestamp,
cursorBefore/After 등 안정 필드를 보존하고 기존 lazy snapshot 계약에 따라 redo 후
afterId null, 최종 undo 후 afterId 2를 확인했다. 취소 전 두 snapshot이 재사용 가능한
것은 뒤이은 실제 redo/undo 복구로 확인했으며 RSS 또는 전역 저장소 수를 측정한 것은 아니다.
키보드 history 검사 직전에는 기존 QA의 제품 `focus()` 경로를 사용했다. 취소 직후의
자동 포커스 복원이나 물리 메뉴 조작·IME까지 검증했다고 주장하지 않는다.

최종 집계는 **시나리오 2건 / 대화상자 열기·취소 4단계 / 동일 redo 객체 검사 4건**이다.
모델·SVG history 복구는 **setup undo 2 + 취소 후 redo 2 + 뒤이은 undo 2 = 6건**,
취소 후 redo→undo cycle은 **각 형식 1회, 총 2회**다. 대화상자 history entry 추가는 0.
실제 Node/Electron exit 0 및 정상 quit을 별도 기록했다.

## 독립 비교·보존·예산

collector는 원본/copy SHA, 12개 단계 파일, 실제 셀 모드 대화상자 표시와 취소, redo
객체 identity 및 전체 필드·snapshot IDs·cursor·dirty·history 보존, 전체 SVG·모델
복구 및 snapshot 반환/재할당 계약을 독립 비교했다. 새 prefix 외에 다른 owner 문단,
다른 셀, 본문·서식·표 속성·페이지 정의·스타일을 보존했다. manifest는 완료된 빈 목록,
저장/재열기 records와 planned records는 0이다.

원본·기존 dirty·이전 QA·PR26~30 공개 증거 **8,092개 해시**는 같았다. verified runtime
52개를 하드링크 재사용하고 UI 제품 source pins가 같음을 확인했다. 새 UI/WASM 빌드,
패키지, 저장·재열기·Native 실행 또는 synthetic 폴더를 만들지 않았다. 기존
**build child exit 0 / coordinator 후처리 exit 1** 기록, source proof, 원래 complete
marker와 verified pin을 유지했다. 이전 실패 기록을 이번 exit 0으로 덮어쓰지 않았다.
개인 원본·프로필·runtime·private 경로 목록은 공개하지 않았다.

추가 파일 전에 normal **624,869,376B** / failure **75,276,288B**, normal 128 MiB /
failure 16 MiB forecast 및 free 하한을 확인했다. 최종 기록 전 normal
**633,434,112B** / failure **75,276,288B**, unfinished phase 0이다. 한도는
805,306,368B / 268,435,456B, free 하한은 16,374,562,816B다. 완료 snapshot의 정확한
free/forecast는 `proof.json`에 있다. canonical `/tmp`와 Python tempdir에서 모든
`geulgyeol-*synthetic-*`를 inode 중복 없이 계산한 전역 합성 증거는
**15,126,528B / 32,000,000B**로 유지됐다. 기존 파일이나 캐시를 삭제하지 않았다.

## 재검증과 다음 범위

기존 `fallback-lineWrap` 두 files, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-redo-dialog-cancel"]` seed를 사용한다. fresh private runtime을 준비한
뒤 첫 명령으로 실행하며 보존된 phase는 재실행하거나 덮어쓰지 않는다. 독립 비교에는
`RUN_ROOT/electron`, `seeds.json`, `prior-pins.json`과 인접 PR27 build/runtime pins가 필요하다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$FRESH_ELECTRON_PHASE" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-redo-dialog-cancel-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

checker/collector syntax, 실제 Electron, 독립 state/SHA 비교와 product 소스 무변경을
확인했다. 설정 확인/저장·속성 변경·복수 entry·저장/재열기·중첩 표·마지막 셀 행 추가,
IME·수동 GUI·Linux/CI 또는 새 packaged app은 이번 범위에서 실행하지 않았다.
제외 geometry/history scope 승격, 기존 Rust 누락 입력 해결, right page18 형식 간
정답 판정을 주장하지 않는다.

다음 최소 후보는 같은 단일 redo 보유 셀 속성 대화상자를 **Escape로 닫는 경로**에서
redo·snapshot 보존과 이후 실제 redo/undo를 확인하는 것이다. PR25 직접 승인 대기와
추가 병합 승인 요청 보류를 유지했다.
