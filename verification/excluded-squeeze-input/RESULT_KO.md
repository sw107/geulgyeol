# SQUEEZE 일반 셀 입력 history 보강

PR22의 기존 `excluded-linewrap-undo/RESULT_KO.md`는 실제 Electron 작업을
Delete와 Shift+Enter에 한정했다. 이번에는 같은 보존 원본을 다시 생성하지 않고
48행 표의 history-only 대상 cell 24, paragraph 0, charOffset 0에 `EDIT🙂`를
입력하는 누락 경로 하나를 검증했다. 새 제품 결함은 재현되지 않아 제품 코드는
변경하지 않았다. 기반 main은 `ff03a7b9c9b16d6f565a5f5193f0a4eb6313e536`이다.

## 변경과 판정

전용 Electron checker에 `history-input` 작업을 추가했다. 이 작업은
`repairExpected`와 `fallbackExactHistory`를 요구하고 기존 snapshot assertion을
재사용한다. 형식 내부 비교를 먼저 확정하기 위해 `sameFormatSaveReopen`의
명시적 opt-in을 추가했다. 저장 계획과 전용 checker의 실제 저장 대상을 같은
형식 하나로 맞추며, opt-in이 없는 기존 계획은 두 형식을 그대로 생성한다.

| 실제 Mac Electron 입력 | undo/redo exact pair | 같은 형식 재열기 | Native exact 비교 |
| --- | ---: | ---: | ---: |
| HWP 원본 → HWP | 2 | 1 | 1 |
| HWPX 원본 → HWPX | 2 | 1 | 1 |

각 pair는 undo와 redo 모두의 전체 페이지 SVG 및 모델을 독립 gzip 상태 파일과
비교했다. 첫 입력은 history entry 1개와 원본 snapshot resource 1개를 사용했다.
원본·편집 상태는 모두 9페이지였다. 대상 문자만 기대한 위치에 추가됐고 나머지
셀 문자, 원래 문자 shape ID, 본문·문단 서식·표 속성·페이지 정의·스타일을 보존했다.
실제 저장 파일은 현재 export bytes와 일치했으며 재열기는 전체 SVG·셀·본문
서식을 유지했다. Electron 및 Node exit 0, 정상 quit을 별도로 기록했다.
고정 Native의 저장 2개 full SVG/model 비교 및 개별·overall exit 0,
overflow 경고 0도 확인했다. metadata consumer는 provenance만 검증하며 새
레이아웃 실행으로 중복 집계하지 않았다.

입력과 저장 파일 모두 guarded layout 대상은 0, 별도 history 대상은 `[24]`다.
SQUEEZE 제외 geometry는 새 supported scope로 승격하지 않았다. 전체 geometry의
정답·일반 paint 보장이나 반복 머리행 지원 확대를 이번 결과로 주장하지 않는다.

## 보존 및 예산

기존 QA root의 모든 일반 파일, 입력 원본 두 개, 기존 dirty 파일을 실행 전에
고정하여 6,761개 해시가 끝까지 같음을 확인했다. PR25의 기존 branch HEAD
`52f6baf452b72fd1ec27e68666474a6769893153` 및 증거는 변경하지 않았다.
새 private runtime은 기존 52개 파일을 하드링크 재사용했고 새 빌드·패키지·캐시를
생성하지 않았다. Node warning 때문에 사용자 홈의 package.json을 바꾸지 않았다.

추가 파일 전에 128 MiB normal / 16 MiB failure forecast와 전체 예산을 확인했다.
실행 후 완료 snapshot은 normal 580,939,776B / failure 71,172,096B,
진행 중 phase 0이다. 한도는 각각 805,306,368B / 268,435,456B이고
free는 46,673,072,128B 이상으로 안전하한 16,374,562,816B를 넘었다.
이 수치는 새 문서와 final-budget 기록 전 snapshot이며 파일 삭제를 뜻하지 않는다.
raw 원본·개인 경로·runtime·프로필은 공개 커밋에 포함하지 않았다.

## 재검증

private RUN_ROOT에 `seeds.json`, 실행 전 `prior-pins.json`, `electron/`, `native/`가
있어야 한다. 원본 seed는 `fallback-lineWrap`의 기존 files, `historyCell:24`,
`repairExpected:true`, `fallbackExactHistory:true`, `sameFormatSaveReopen:true`,
`operations:["history-input"]`를 사용한다. 같은 input SHA는 `proof.json`에 기록했다.

```sh
# 기존 고정 runtime을 새 폴더에 재사용한 뒤 실행한다.
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-native-saved-qa.py \
  "$RUN_ROOT/electron/manifest.json.gz" "$RUN_ROOT/native" "$FIXED_NATIVE"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-squeeze-input-evidence.py \
  "$RUN_ROOT" "$WASM_PKG" "$FIXED_NATIVE" "$RUN_ROOT/fresh-comparison"
```

`node --test scripts/qa-evidence-tools.test.mjs` 33건 통과 및 전용 checker/collector
syntax를 확인했다. 전역 synthetic 임시 증거는 canonical `/tmp`와 Python tempdir의
모든 `geulgyeol-*synthetic-*` 폴더를 inode 중복 없이 계산해 14,938,112B로
32,000,000B 한도 안이다. 새 unit-test 폴더도 보존했다. 실행에 사용한 WASM, UI runtime, Native SHA 및 증거 파일 SHA는
동봉 `proof.json`에 있다. 비교 collector의 실행 중 budget에는 자기 phase가
기록되므로 공개 proof의 budget은 별도 완료 snapshot이다.

## 남은 범위와 다음 후보

SQUEEZE input 하나만 새로 실행했다. Tab, 혼합 burst, 첫/중간/끝 fragment 입력을
모두 검증한 결과로 확대하지 않는다. 다음 후보는 같은 SQUEEZE 셀에서의 Tab 이동과
history 불변 확인이며, 이는 새 입력·재열기 검증과 별개의 범위다.

right page18 HWP/HWPX 중간 편집 차이의 정답 판정은 보류한다. 설치된 한컴 Viewer는
편집 기준이 아니며 편집 가능한 한컴은 없으므로 이번 작업에서 제품 정책을 정하지
않았다. PR25 병합은 여전히 별도 직접 승인 대기다. Mac physical IME·수동 GUI,
OS 파일 chooser, Linux/CI 및 새 packaged app은 검증하지 않았다. Rust unit build는
기존 누락 입력 4개로 막혀 있어 이번 결과를 Rust unit 통과로 표시하지 않는다.
