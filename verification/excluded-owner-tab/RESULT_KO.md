# 제외표 병합 owner의 Tab 읽기 순서 복구

48행 제외표의 cell 24(row 8, col 0)는 **32행 × 2열 병합 owner**다.
SQUEEZE 일반 셀은 별도의 cell 3(row 1, col 0)이다. PR26 입력 검증 역시
SQUEEZE가 있는 제외표의 병합 owner 24 입력 history를 확인한 것으로 해석한다.
이번 브랜치는 승인된 PR26 HEAD
`cfd311b16749a1d59fd432390dd3edc6e8f52a27`를 기반으로 하며 그 HEAD와 증거는
수정하지 않았다. PR의 base도 PR26 브랜치다.

## 계약과 결함

`input-handler-keyboard.ts`의 Tab은 표 셀에서 읽기 순서 이동을 수행하며,
마지막 셀에서만 행을 추가한다. `cursor.ts`는 row/col 순서와 중복 cell ID 제거로
다음 셀을 정한다. owner 24 다음 대상은 같은 row 8의 col 2 일반 셀 **25**이고
paragraph/charOffset 0이다. 마지막 셀은 80이므로 owner 24에서 행을 추가하거나
후행 본문으로 나가면 계약에 맞지 않는다.

기존 runtime의 실제 Mac Electron HWPX에서 owner 24 Tab은 cell 25 대신
표 밖 paragraph 1의 후행 본문으로 이동했다. 해당 실행은 Node exit 1,
Electron 정상 quit/exit 0으로 보존했다. 모델·SVG·dirty·history는 같았지만
HWP export bytes도 달라 첫 엄격 불변 assertion에서 중단됐다. 그 차이의 별도
serialization 원인을 판정하지 않으며 새 redo 또는 형식 간 정책 결함으로
분류하지 않는다. 이전 HWP 입력은 그 실패로 실행되지 않았다.

`getCellReadingOrder()`가 단일 `cellPath`에도 중첩 표 bbox 조회를 사용했다.
실제 같은 문서의 top-level 조회는 원래 model cell ID 81개를 반환하며
24 다음은 25다. 경로 조회는 fragment 내 번호 21개를 반환하여 owner 24가 없다.
이 상태의 cursor는 현재 cell을 읽기 순서에서 찾지 못해 `exitTable(1)`을 탔다.

제품 수정은 `cursor.ts`의 조회 선택 조건 한 곳이다. 경로 깊이 1의 top-level 표는
model ID를 유지하는 직접 조회를 사용하고 깊이 2 이상은 기존 경로 조회를 유지한다.
중첩 표 쿼리 구현, 행 추가 정책, history·renderer·WASM은 변경하지 않았다.

## 실제 검증

| 최종 Mac Electron 입력 | Tab 이동 | 전체 모델·SVG·두 export bytes | dirty / undo / redo / snapshot |
| --- | --- | --- | --- |
| HWP 원본 | owner 24 → cell 25 시작 | exact | false / 0 / 0 / 0 유지 |
| HWPX 원본 | owner 24 → cell 25 시작 | exact | false / 0 / 0 / 0 유지 |

두 형식 모두 원본과 복사본의 SHA가 같으며 새 원본을 생성하지 않았다.
최종 실제 검사에는 새 문서 입력이나 저장을 하지 않았다. 따라서 history pair,
저장·재열기, 새 Native 검증은 각각 0이고 이 결과를 저장 회복 검증으로 확대하지 않는다.
반복 export만 수행한 무입력 control의 모델·SVG도 같았다. 최종 Tab 전후는
HWP와 HWPX export bytes까지 엄격 비교했다. Node/Electron 실제 exit 0 및 정상 quit,
입력 seed와 QA 소스 before/after 해시, 대상 cursor/cellPath를 따로 보존했다.
같은 bbox 조회 결과를 상태 파일에 기록하여 소스 해석만으로 원인을 추측하지 않았다.

첫 실패 이후 중간 실행에서는 두 형식의 이동·모델·SVG·dirty·history 및 HWPX bytes를
검증했다. HWP bytes도 같음을 관찰한 뒤 최종 checker를 전체 bytes strict로 강화하고
새 `electron-final` phase에서 다시 실행했다. 중간 실행이나 첫 실패를 지우거나
최종 실행으로 재표기하지 않았다.

## 빌드·보존·예산

현재 UI만 private source-QA로 한 번 빌드했다. Vite child exit 0,
13개 assets 재사용 / 3개 기록, 기존 WASM 재사용이며 기존 앱·공개 beta·새 앱/zip
패키지를 생성하지 않았다. 실제 실행 runtime 52개 파일을 빌드 및 최종 실행 폴더에서
해시 검증했다. UI runtime tree SHA는 정렬된 compact JSON `runtimeFilesSHA256`의
SHA256이며 WASM SHA와 혼동하지 않는다.

빌드 coordinator는 phase complete 이후 닫힌 budget bridge에 `check()`를 호출해
exit 1이 됐다. 빌드 성공과 coordinator 오류를 분리 기록하고 이전 complete marker,
`failure.json`, source proof 및 처음 만든 runtime pin을 그대로 보존했다. 최초 pin의
`sourceRuntimeSHA256`은 cursor source digest였으므로 별도 verified pin에 runtime tree
계산법과 해시를 기록했다. 재사용은 그 verified pin을 명시해 독립 확인했다.
이는 build 전체 wrapper exit 0 주장이나 실패 표식 초기화가 아니다.

원본·기존 dirty·전체 이전 QA 및 PR26 공개 증거 파일 6,942개를 실행 전에 고정했고
최종 collector가 모두 같음을 재확인했다. PR25/26 HEAD와 증거를 보존했으며
개인 원본, 프로필, runtime, 원본 fixture 또는 private 경로 목록은 공개 커밋에서 제외했다.

추가 파일 전 전체 normal/failure/free 예산과 global synthetic 예산을 확인했다.
private 빌드는 64 MiB, Electron은 128 MiB normal forecast를 적용했다.
최종 기록 전 normal 592,793,600B / failure 75,276,288B, unfinished phase 0이다.
한도 805,306,368B / 268,435,456B 및 free 하한 16,374,562,816B 안이다.
실제 완료 snapshot free와 forecast는 `proof.json`에 있다. global synthetic은
canonical `/tmp`와 Python tempdir의 모든 `geulgyeol-*synthetic-*`를 inode 중복 없이
계산해 15,126,528B / 32,000,000B다. 이번에 synthetic 테스트 폴더를 추가하지 않았다.

## 재검증과 한계

`RUN_ROOT`에 보존된 `electron/`, `electron-final/`, `build-runtime/`, `seeds.json`,
`prior-pins.json`이 있어야 한다. seed는 기존 `fallback-lineWrap` 입력 두 개,
`repairExpected:true`, `fallbackExactHistory:true`, `historyCell:24`,
`verifyUnchangedSaveReopen:false`, `operations:["owner-tab"]`를 사용한다.
새 strict 비교 폴더는 기존 폴더를 덮어쓰지 않는다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$FRESH_ELECTRON_PHASE" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-tab-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

전용 checker와 collector syntax, private UI build 및 실제 Electron strict 회귀를 확인했다.
Rust engine은 변경하지 않았고 기존 누락 입력에 막힌 Rust unit build를 통과로 주장하지 않는다.
이 검증은 clean 상태의 forward Tab 한 번씩이다. 유지된 비어 있지 않은 undo/redo stack,
Shift+Tab, 마지막 셀 행 추가, 중첩 표, SQUEEZE 일반 셀 3 입력, IME·수동 GUI·Linux/CI,
새 packaged app은 검증하지 않았다. 제외 geometry/history scope는 그대로이며
right page18 형식 간 차이의 정답 판정은 보류한다.

다음 최소 후보는 cell 25에서 Shift+Tab으로 병합 owner 24 마지막 문단·문자 위치로
돌아가는 계약과 상태 불변이다. PR25 직접 승인 대기는 그대로이며 이번 QA는
어떤 PR의 병합 승인으로도 해석하지 않았다.
