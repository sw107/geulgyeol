# 재열기 후 owner snapshot + 일반 셀의 두 history entry

승인된 PR35 HEAD `a6d5f3df699b4226c574faeede7092209813d560` 기반의 제한된 한 묶음이다.
PR35의 HWP/HWPX 저장 사본을 복사하여 실제 앱에서 열고 owner24 snapshot 입력과
cell25 일반 입력을 별도 history entry로 만든 뒤, 역순 undo·정순 redo·새 이름의 같은
형식 저장·재열기를 검증했다. 새 결함은 재현되지 않았다. 제품 코드·UI/WASM은
변경하지 않았으며 QA handler, 독립 collector, 문서/proof 4파일만 포함한다.

## 의도한 entry가 실제로 분리된 결과

초기 상태는 PR35의 저장·재열기 full SVG/model과 동일했다. 기존 `REOPEN_EDIT🙂SAVE_NAV🙂`
입력이 보존된 사본이며 원래 PR35 파일/복사본을 덮어쓰지 않았다.

1. owner24 문단0/offset0에 `M24🙂` 입력 → snapshot:insertText entry 1개/resource 1개.
2. 실제 Tab → cell25 문단0/offset0. 모델/SVG/양 export bytes 및 history 불변.
3. cell25에 `M25🙂` 입력 → 별도 insertText entry 생성, 총 entry 2개/resource 1개.
4. 실제 Shift+Tab → owner24 문단63/scalar66. 모델/SVG/양 export bytes 및 history 불변.
5. 실제 undo cell25 → undo owner24 → redo owner24 → redo cell25.
6. 실제 앱 상단 저장 버튼으로 새 같은 형식 사본 저장 → 실제 앱 열기로 재열기.

owner24는 row8/col0, 32행×2열 병합이고 cell25는 row8/col2, 1행×1열이다.
실제 predicate는 두 셀 모두 guarded=false, excluded history는 owner24=true /
cell25=false였다. 두 객체를 실제 renderer JSHandle로 보유하여 stack의 객체 identity와
순서를 확인했다. 첫 객체는 `snapshot:insertText`, 두 번째는 `insertText`이며 두 번째의
snapshot resource는 0, beforeId/afterId 필드도 없다. 연속 입력이 한 entry로 합쳐진
결과를 통과로 처리하지 않았다.

| 각 형식의 단계 | undo / redo 객체 순서 | snapshot resource | cursor |
| --- | --- | ---: | --- |
| owner 입력 후 | owner / 없음 | 1 | owner24 offset4 |
| 일반 셀 입력 후 | owner, ordinary / 없음 | 1 | cell25 offset4 |
| undo ordinary | owner / ordinary | 1 | cell25 offset0 |
| undo owner | 없음 / ordinary, owner | 2 | owner24 offset0 |
| redo owner | owner / ordinary | 1 | owner24 offset4 |
| redo ordinary | owner, ordinary / 없음 | 1 | cell25 offset4 |
| 같은 형식 재열기 | 없음 / 없음 | 0 | 새 문서 초기 cursor |

각 history 단계의 full SVG/model은 **해당 중간 reference**와 exact다. cursor와 두 실제
객체의 stack 순서·resource도 별도로 대조했다. owner snapshot의 before ID는 유지되고
undo owner에서만 after를 생성했으며 redo owner에서 반환했다. 일반 입력은 실제 역연산
undo 및 다시 입력하는 redo 경로를 사용한다. 별도 snapshot wrapping으로 대체하지 않았다.

History 복원 비교는 HWP/HWPX serialized container bytes를 제외한 full SVG/model이다.
이동 비교는 양 export byte 배열까지 exact다. 원래 문자 shape ID, 본문/셀 문단·문자
서식, 스타일, 페이지 정의, 표 속성, 48행/81셀 및 병합 topology를 보존했다. 두 형식
모두 9페이지, 반복 머리행 rendered runs 9페이지와 `AFTER_TABLE_END` 후행본문 표시
1회를 보존했다. 제외 geometry의 일반 지원 범위/정답으로 승격하지 않았다.

## 저장 및 신규 집계

저장은 native filesystem/IPC를 사용했으며 파일 SHA·길이는 직전 해당 형식 export 및
IPC payload와 일치했다. dirty=false가 되면서 두 command 객체·필드·cursor/generation을
유지했다. clean 상태에서 실제 앱 열기로 재열기하므로 미저장 확인창은 0회였다.
재열기는 full SVG/model을 유지하고 generation을 변경하며 dirty=false, 빈 history /
resource 0으로 초기화했다. 이전 owner 객체의 beforeId/afterId는 null이었다.
저장→재열기 사이 QA `load()`/`notifySaved()` 호출은 없었다.

| 실제 새 실행 | 이동 | history 복원 key | undo/redo 쌍 | 같은 형식 저장·재열기 |
| --- | ---: | ---: | ---: | ---: |
| HWP | 2 | 4 | 2 | 1 |
| HWPX | 2 | 4 | 2 | 1 |
| 합계 | 4 | 8 | 4 | 2 |

시나리오 2건의 단일 묶음만 실행했다. 이전 PR 실행, collector의 read-only 대조,
초기 fixture 준비를 새 history/reopen 건수에 합산하지 않았다. 이전의 잘 알려진 redo
결함을 새 결함으로 보고하지 않았다. Node harness 0 / Electron app 0, 정상 quit,
errors 0, fallback 완화 비교 0, manifest 계획/결과 2건을 확인했다.
최초 cursor 준비와 history key helper는 QA의 명시적 editor focus를 사용한다.

## 한도와 보존

실행 전 normal **680,349,696B** / failure **84,967,424B**, free **44,395,929,600B**를
확인했다. 승인된 전체 forecast는 normal/failure 각각 **117,440,512B (112MiB)**다.
profile 32MiB, 최대 state 40개용 20MiB, manifest/사본/IPC/화면/log 16MiB,
pins/checkpoint 4MiB, collector/문서 4MiB, contingency 36MiB를 포함한다.
producer는 이 중 68MiB normal 및 전체 112MiB failure forecast로 시작했다.

QA의 optional 상한으로 실제 renderer pageCount를 state 읽기 전에 검사하여 형식별
**최대 10페이지**, 기록 전에 **총 state 파일 최대 40개**를 적용했다. 이번 결과는
**9페이지·state 22개**, snapshot resource 최대 **2개**로 계획 상한 4개 안이다.
상한을 넘기거나 새 빌드가 필요해 범위를 늘린 실행은 없다.

고정 PR35 checker를 Git blob과 기존 harness/public SHA가 일치하는 새 checkpoint로
보존한 뒤 별도 브랜치를 만들었다. 기존 원본·dirty·공개 문서·모든 성공/실패 증거
**9,681개 해시**가 종료까지 같았다. 기존 UI runtime 52파일을 하드링크 재사용했고
새 빌드·패키지·Native 실행·synthetic 폴더는 없다. 원래 build child 0 / coordinator
후처리 1, 모든 과거 failed marker도 유지했다. private 원본·raw 사본·profile·runtime·
경로 목록은 공개하지 않았다. 삭제·압축 변환·보안 설정 변경은 하지 않았다.

완료 budget snapshot은 동봉 proof에 있다. 한도 normal 805,306,368B / failure
268,435,456B 및 free 하한 16,374,562,816B를 유지했고 진행 중 phase는 0이다.
globalSynthetic **15,126,528B / 32,000,000B**도 같다. 이 묶음 뒤에는 다음 실행을
시작하지 않았다. 현재 normal 잔여량은 112MiB보다 작아 같은 forecast를 자동 반복할
수 없으며 남은 예산과 결과를 먼저 보고한다.

## 재검증과 남은 범위

PR35 실제 저장 파일 SHA를 `priorSavedSHA256`에 지정하고 label `multi-owner-lineWrap`,
historyCell24, repairExpected/fallbackExactHistory/sameFormatSaveReopen true,
operations `["owner-multi-history"]`로 만든 seed를 사용한다. fresh phase와 고정
runtime pin을 확인한 뒤 전체 forecast를 먼저 검사한다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
GEULGYEOL_QA_NORMAL_FORECAST_BYTES=71303168 \
GEULGYEOL_QA_FAILURE_FORECAST_BYTES=117440512 \
GEULGYEOL_QA_MAX_PAGES=10 GEULGYEOL_QA_MAX_STATE_FILES=40 \
python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
python3 -B scripts/check-owner-multi-history-evidence.py \
  "$RUN_ROOT" "$WASM_PKG" "$RUN_ROOT/fresh-comparison"
```

JS/Python syntax 및 git diff --check를 통과했다. 기존 unit 33건은 재실행/신규 집계하지
않았다. 새 snapshot 생성 뒤 숫자 ID 재사용 전체·cross-format right page18 wrap 정답은
미판정이다. 물리 IME·OS chooser·수동 GUI·Linux/CI·새 packaged app·누락 입력 4개로
막힌 Rust unit은 미검증이다. PR25 승인 대기와 추가 병합 요청 보류를 유지했다.
다음 구현 후보는 이번 결과의 통합 검토이며 새 QA 실행 여부는 남은 예산으로 조정한다.
