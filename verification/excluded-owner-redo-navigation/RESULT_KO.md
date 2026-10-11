# 단일 redo entry 보존 navigation과 실제 history 복구

승인된 PR28 HEAD `786ebce238d31011aa458d5f2dce1462f9d6aa93` 기반의 별도 QA다.
SQUEEZE 일반 셀은 **3**, 편집 대상은 **32행 × 2열 병합 owner 24**다.
새 결함을 발견하지 않아 제품 소스와 UI/WASM은 변경하지 않았다. PR26/27/28 HEAD 및
기존 검증 증거를 보존했다. 이 결과를 과거 redo 결함의 새 재현으로 분류하지 않는다.

## 실제 Mac Electron 계약 검증

HWP/HWPX 보존 원본을 각각 한 번의 동일 시나리오로 검사했다. owner 24 문단 0의
시작에 실제 `REDO_NAV🙂` 9 scalar를 입력하고 실제 Meta+Z로 undo했다. 이때 원본
전체 SVG·모델이 복구되고 undo 0 / redo 1 / snapshot resource 2가 됐다.
그 상태에서 Tab→cell 25 시작, Shift+Tab→owner 24 마지막 문단 끝을 수행했다.
owner 24의 마지막은 paragraph **63**, scalar offset **66**이다. emoji 두 개를
포함한 마지막 문단의 UTF-16 길이는 **68**이며 이를 offset으로 사용하지 않았다.

| 단계 (각 형식 동일) | undo | redo | snapshot resource |
| --- | ---: | ---: | ---: |
| 실제 입력 후 | 1 | 0 | 1 |
| 첫 실제 undo | 0 | 1 | 2 |
| Tab 및 Shift+Tab 후 | 0 | 1 | 2 유지 |
| 이동 후 실제 redo | 1 | 0 | 1 |
| 다시 실제 undo | 0 | 1 | 2 |

navigation 전후 전체 SVG·모델 및 두 형식 export bytes가 exact다. 각 전이의 실제
시작·끝 cursor와 cellPath를 보존해 두 이동 사이의 연속성도 확인했다. UI dirty는
첫 undo 후 true이며 이동 내내 true를 유지했다. redo stack의 유일한 command는
기록된 모든 필드, timestamp, cursorBefore/After 및 before/after snapshot ID가 같았다.

이어서 실제 Meta+Shift+Z를 실행하여 **이동 이전 편집 후 전체 SVG·모델**을 복구했다.
redo는 after snapshot을 반환해 resource 1로 줄었고 같은 beforeId를 유지했다.
마지막 Meta+Z는 **처음 원본 전체 SVG·모델**을 복구하며 after snapshot을 새로 잡아
resource 2가 됐다. 두 history jump의 cursor도 원래 edit/source cursor를 정확히
복구했다. 실제 관찰된 IDs는 before 0, navigation 동안 after 1, redo 후 after null,
최종 undo 후 after 2다. 새로운 ID 할당이나 2→1→2 변화를 누수·navigation 변경으로
분류하지 않는다. history 비교는 전체 SVG·모델이며 serialized export container bytes는
그 비교에서 제외한다. navigation의 추가 bytes 불변 assertion과 구분한다.

최종 집계는 **시나리오 2건 / 이동 4전이 / 실제 history 복구 6건**이다.
history 복구 6건은 첫 undo 2, 이동 후 redo 2, 마지막 undo 2이며,
이동 후 redo→undo cycle은 **각 형식 1회, 총 2회**다. 이 횟수로 추가 cycle을 주장하지
않는다. Node 및 Electron 실제 exit 0, 정상 quit이며 page/model 상태와 별도로 기록했다.

## 독립 비교·보존·예산

독립 collector는 source input/copy SHA, 12개 단계 상태 파일, 원본·편집 상태의 full
SVG/model equality, redo command의 필드와 snapshot IDs, 실제 cursor 및 1→2→1→2
resource 계약을 확인했다. 입력은 목표 문단의 prefix만 바꾸고 나머지 owner 문단,
다른 셀, 본문·서식·표 속성·페이지 정의·스타일을 보존했다. 신규 저장 파일이나 Native
실행은 없다. 만료되지 않은 seed/QA source before/after pin과 실제 engine SHA도 같다.

원본·dirty·전체 이전 QA·PR26/27/28 공개 증거 **7,759개 해시**는 같았다.
PR27 verified runtime 52개를 하드링크 재사용했고 UI 제품 소스는 이전 build source pin과
일치한다. 이전 **build child exit 0 / coordinator 후처리 exit 1**의 구분과 원래
source proof·실패 기록·complete marker·verified pin을 그대로 유지했다. 이번 검사
프로세스 exit 0을 그 이전 coordinator exit 0으로 재표기하지 않았다.
새 UI/WASM 빌드, 패키지, synthetic 테스트 폴더를 생성하거나 이전 증거를 삭제하지 않았다.
개인 원본, 프로필, runtime과 private 경로 목록은 공개 커밋에서 제외했다.

추가 파일 전에 normal 128 MiB / failure 16 MiB forecast 및 free 안전하한을 확인했다.
최종 기록 전 normal **616,239,104B**, failure **75,276,288B**, unfinished phase 0이다.
한도는 각각 805,306,368B / 268,435,456B, free 하한은 16,374,562,816B다.
실제 완료 free/forecast는 `proof.json`에 기록했다. canonical `/tmp`와 Python tempdir의
모든 `geulgyeol-*synthetic-*`를 inode 중복 없이 계산한 전역 합성 증거는
**15,126,528B / 32,000,000B**로 유지됐다.

## 재검증과 남은 범위

기존 `fallback-lineWrap` 두 files, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-redo-navigation"]` seed와 fresh private runtime이 필요하다.
보존된 `RUN_ROOT/electron`, `seeds.json`, `prior-pins.json` 및 인접 PR27 build/runtime
pins는 독립 비교에 사용된다. 이미 실행된 phase를 다시 실행하거나 덮어쓰지 않는다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$FRESH_ELECTRON_PHASE" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-redo-navigation-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

전용 checker/collector syntax, 실제 Electron 및 독립 상태·해시 비교를 확인했다.
이번은 **단일 entry**로 한정했다. 복수 entry, redo 보유 중 새 편집, 마지막 셀 행 추가,
중첩 표, 저장·재열기, IME·수동 GUI·Linux/CI 및 새 packaged app은 검증하지 않았다.
Rust unit의 기존 누락 입력 문제, 제외 geometry 지원 승격, right page18 형식 간
정답 판정을 이번 결과로 해결했다고 표시하지 않는다.

다음 최소 후보는 redo 보유 상태에서 새 입력이 redo를 비우고 snapshot을 반환하는
계약 및 새 단일 history의 복구다. PR25 직접 승인 대기와 추가 병합 승인 요청 보류를
유지했다.
