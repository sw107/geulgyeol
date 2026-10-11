# 단일 redo entry 교체와 snapshot 반환

승인된 PR29 HEAD `e033a6935bcddef277e1182ea7b861b9803c184a` 기반 별도 QA다.
SQUEEZE 일반 셀은 **3**, 입력 대상은 **32행 × 2열 병합 owner 24**다.
새 제품 결함을 발견하지 않아 제품 소스·UI/WASM은 변경하지 않았다. PR29 고정 HEAD와
이전 증거를 보존했다. 이전 PR29의 export bytes 불변은 navigation 범위에 유지되며,
이번 실제 history 복구는 **export container bytes를 제외한 전체 SVG·모델**로 집계한다.
새 단계에는 Tab/Shift+Tab 이동을 추가하지 않았다.

## 실제 Mac Electron 시나리오

HWP/HWPX 보존 원본에서 각각 단일 history entry만 사용했다.
owner 24 문단 0 시작에 실제 `OLD_REDO🙂`를 입력한 뒤 실제 undo로 원본 모델·SVG를
복구했다. undo 0 / redo 1 / resource 2 상태에서 같은 위치에 `NEW_BRANCH🙂`를
실제 입력했다. 새 분기는 원본에 NEW prefix를 붙인 상태이며 OLD prefix 상태와 다르다.
새 분기의 cursor offset은 Unicode scalar **11**로 확인했다.

| 단계 (각 형식 동일) | undo | redo | resource |
| --- | ---: | ---: | ---: |
| 이전 입력을 undo한 직후 | 0 | 1 | 2 |
| 새 입력 후 | 1 | 0 | 1 |
| 빈 redo 키 입력 후 | 1 | 0 | 1 유지 |
| 새 분기 실제 undo | 0 | 1 | 2 |
| 새 분기 실제 redo | 1 | 0 | 1 |
| 소진된 redo 키 입력 후 | 1 | 0 | 1 유지 |

새 입력은 redo stack을 비우고 기존 command의 beforeId/afterId를 null로 바꿨으며
그 command의 resource는 0이 됐다. 기존 command를 read-only JSHandle로 보존하여
이 폐기 상태를 직접 확인한 뒤 handle을 해제했다. command를 대신 실행하거나
product discard 함수를 테스트 대체 구현으로 바꾸지 않았다.

기존 snapshot IDs **0, 1**은 각각 실제 WASM `restoreSnapshot`에서
`스냅샷 N 없음`으로 거절됐다. 이 API는 ID 조회에 실패하면 document 변경 전에
반환하는 계약이며, 두 거절 후 branch 모델·SVG·history·dirty·cursor가 같음을
확인했다. 두 형식 총 **4개 ID 거절**이다. snapshot 반환은 폐기 command resource 0과
저장소 ID의 복원 거절로 검증했다.

새 입력 직후 실제 redo 단축키를 눌러 이전 OLD 편집이 재실행되지 않음을 확인했다.
이후 실제 새 branch undo는 원본 전체 SVG·모델, 새 branch redo는 NEW 전체
SVG·모델을 복구했다. 그 뒤 다시 redo를 눌러 OLD entry가 아래에 숨겨져 있지 않음을
확인했다. 두 빈 redo는 모델·SVG·cursor·dirty와 기록된 history 필드를 유지했다.
새 command의 before snapshot은 **2**로 이전 IDs와 구분됐고 새 undo/redo 동안 같은
beforeId·timestamp·cursorBefore/After를 유지했다. after snapshot 할당/반환은 기존
lazy 계약을 따른다. 새 입력 폐기를 과거 redo 버그의 재현으로 분류하지 않는다.

최종 집계는 **시나리오 2건 / 이전 ID 거절 4건 / 빈 redo 검사 4건**이다.
모델·SVG 복구는 이전 setup undo 2 + 새 branch undo 2 + 새 branch redo 2 = **6건**이며
새 branch undo→redo pair는 **각 형식 1회, 총 2회**다. Node/Electron 실제 exit 0,
정상 quit을 상태 비교와 별도로 보존했다. 단일 redo entry 교체 동안 복수 entry를
만들지 않았으며, 직접 거절 probe와 실제 keyboard history 작업은 증거에서 구분했다.

## 독립 비교·보존·예산

collector는 원본/copy SHA, 14개 단계 파일, OLD/NEW 분기 차이, 폐기된 command
필드 및 resource 0, WASM ID 오류와 실패 원자성, 빈 redo 두 상태, 새 command의
undo/redo 전체 SVG·모델 및 cursor·snapshot 계약을 독립 비교했다. 새 prefix 외에
다른 owner 문단, 다른 셀, 본문·서식·표 속성·페이지 정의·스타일을 보존했다.

원본·dirty·전체 이전 QA·PR26~29 공개 증거 **7,924개 해시**는 같았다.
기존 verified runtime 52개를 하드링크 재사용하고 UI 제품 source pins가 같음을 확인했다.
새 UI/WASM 빌드, 패키지, 저장·재열기·Native 실행 또는 synthetic 테스트 폴더는 없다.
기존 **build child exit 0 / coordinator 후처리 exit 1** 기록, source proof, 원래
complete marker와 verified pin을 유지했다. 이번 검사 exit 0으로 이전 coordinator
exit 1을 덮어쓰지 않았다. 개인 원본·프로필·runtime·private 경로 목록은 공개하지 않았다.

추가 파일 전에 normal 128 MiB / failure 16 MiB forecast와 free 기준을 확인했다.
최종 기록 전 normal **624,865,280B**, failure **75,276,288B**, unfinished phase 0이다.
한도는 805,306,368B / 268,435,456B, free 하한은 16,374,562,816B다. 완료 snapshot의
정확한 free/forecast는 `proof.json`에 있다. canonical `/tmp`와 Python tempdir의 모든
`geulgyeol-*synthetic-*`를 inode 중복 없이 계산한 전역 합성 증거는
**15,126,528B / 32,000,000B**로 유지됐다. 기존 파일이나 캐시를 삭제하지 않았다.

## 재검증과 다음 범위

기존 `fallback-lineWrap` 두 files, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-redo-branch"]` seed를 사용한다. fresh private runtime을 준비한 뒤
첫 명령으로 실행하며, 보존된 phase는 재실행하거나 덮어쓰지 않는다. 독립 비교에는
`RUN_ROOT/electron`, `seeds.json`, `prior-pins.json`과 인접 PR27 build/runtime pins가 필요하다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$FRESH_ELECTRON_PHASE" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-redo-branch-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

checker/collector syntax와 실제 Electron 및 독립 state/SHA 비교를 확인했다.
복수 entry, 저장·재열기, 중첩 표, 마지막 셀 행 추가, IME·수동 GUI·Linux/CI 및 새
packaged app은 이번에 검증하지 않았다. 원래 owner 끝의 scalar offset 66과 UTF-16
길이 68의 구분은 그대로이며 이번에는 끝 위치 이동을 다시 실행하지 않았다.
제외 geometry/history scope 승격, 기존 Rust 누락 입력 해결, right page18 형식 간
정답 판정을 주장하지 않는다.

다음 최소 후보는 redo 보유 중 셀 속성 대화상자 취소가 redo·snapshot을 보존하고
이후 실제 redo가 편집 상태를 복구하는지 확인하는 것이다. PR25 직접 승인 대기와
추가 병합 승인 요청 보류를 유지했다.
