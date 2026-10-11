# PR34 저장 사본의 재열기 후 편집·두 번째 저장

승인된 PR34 고정 HEAD `1cd2007dbaac0a02737dad5fb3ef389695a86bdc`에서 별도 브랜치를
만들었다. PR34의 실제 저장 사본 HWP/HWPX를 **그대로 입력 사본으로 복사**해 열고,
owner 재입력·Tab/Shift+Tab·undo/redo·같은 형식 두 번째 저장·재열기를 한 묶음으로
검증했다. 새 제품 결함은 재현되지 않았다. 제품 수정 없이 QA helper의 새 작업 분기,
독립 collector 및 문서/proof 4파일만 포함한다.

## 원본과 고정 증거

| 이번 입력 | PR34 저장 사본 SHA-256 |
| --- | --- |
| HWP | `04b867834c89867942cc6f8e3888b8da02f0e63076a84e93393ceaacae2cb8c4` |
| HWPX | `ef1692222a7af366d3f6c2ed4eb4ca26912b21c6b5b7bd1d73e36d2210dfde0b` |

PR34 기존 저장 경로에는 쓰지 않았다. 새 QA의 `reopened-lineWrap-input.*`도 덮어쓰지
않고 `reopened-lineWrap-{format}-owner-reopened-edit.*`라는 별도 출력에 저장했다.
실행 전후 입력 원본과 복사본 SHA가 위 값과 같다. 새 입력의 full SVG/model은 PR34
기존 재열기 raw state와 동일함을 독립 collector로 대조했다. 본문에는 기존
`SAVE_NAV🙂` 편집이 이미 보존돼 있으며 그 앞에 `REOPEN_EDIT🙂`를 추가했다.

브랜치 변경 전 PR34 checker를 고정 SHA의 Git blob에서 별도 checkpoint로 보존했고,
기존 harness/public proof SHA와 `35ef78a5763204dabeebd0dffb818d010ae0d8b1fafa60c5e039bb643f198a12`
일치를 확인했다. 이전 파일/marker를 덮어써 검증 출처를 바꾸지 않았다.

## 실제 실행과 새 집계

HWP/HWPX 각 **1개 흐름**, 총 **2개 시나리오**다. PR34의 이전 실행 건수는 합산하지
않았다. 독립 collector는 동일 raw 자료의 대조이며 새 Electron 실행으로 집계하지 않는다.

1. PR34 저장 사본을 실제 앱에서 열어 clean·빈 history로 시작.
2. merged owner24(행8/열0, 32행×2열) 문단0/scalar0에 `REOPEN_EDIT🙂` 입력.
3. 실제 Tab → cell25 문단0/offset0, Shift+Tab → owner24 문단63/scalar66 이동.
4. 실제 undo → redo로 PR34 저장 상태와 새 편집 상태의 full SVG/model 복원.
5. 앱 상단 저장 버튼으로 새로운 이름의 같은 형식 사본 저장.
6. 저장 후 undo → redo로 dirty/history 유지 정책 확인.
7. 실제 앱 열기로 새 사본 재열기. 미저장 확인 응답은 QA discard로 제어.
8. 이전 command 해제, 이전 snapshot ID 거절, 빈 history undo/redo 불변 확인.

| 새 실행 | 이동 | 복원 history key | undo/redo 쌍 | 재열기 후 빈 history key | 두 번째 저장·재열기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| HWP | 2 | 4 | 2 | 2 | 1 |
| HWPX | 2 | 4 | 2 | 2 | 1 |

합계는 이동 **4회**, 복원 history key **8회 (4쌍)**, 빈 history key **4회**,
총 history key **12회**, 두 번째 저장·재열기 **2회**다. 빈 history key를 복원 pair로
집계하지 않았다. 최초 선택과 history key helper는 QA의 명시적 editor focus를 사용하며,
물리 키보드/포커스 자동 복귀 검증으로 확대하지 않는다.

이동은 full SVG/model과 양 export byte 배열이 정확히 같다. history 복원 및 같은 형식
재열기는 serialized container bytes를 제외한 full SVG/model이 같다. 실제 저장 파일은
직전 해당 형식 export 및 native IPC payload의 SHA·길이와 일치했다. 두 형식 모두
9페이지, 48행/81셀, merged topology, 내용·본문/셀 문단·문자 서식·스타일·페이지 정의·
표 속성을 보존했다. 기존 문자 shape ID를 그대로 유지했고 신규 문자만 추가했다.
반복 머리행 rendered runs는 입력 전후 9페이지에서 동일했으며 `AFTER_TABLE_END`
후행본문 표시는 전체 페이지에 1회다. 새 저장 manifest의 전체 SVG 문자열도 페이지별
SHA/길이와 모델을 대조했다. 제외 geometry의 일반 정답을 확정한 결과는 아니다.

## generation과 stale snapshot

새로 열린 PR34 사본에서 입력 시 history entry/resource는 1/1로 시작했다. 실제
undo/redo로 이 사본의 원래 저장 상태와 새 편집 상태를 복원했다. 저장 직후에는
동일 command/필드/ID/cursor/generation을 유지하며 dirty=false, 저장 뒤 undo/redo는
dirty=true였다. 두 번째 재열기는 generation을 변경하고 dirty=false, history/resource
0으로 초기화했다. 저장→재열기 사이에는 QA `load()`/`notifySaved()`를 호출하지 않았다.

각 형식에서 실제 새 입력 command 객체를 QA handle로 보유해 두 번째 재열기 뒤
검사했다. 이전 stack에서 빠졌고 `beforeId`/`afterId`는 null, resource는 0이었다.
재열기 직전 살아 있던 참조는 **before snapshot 1개**다. 두 차례 undo에서 기록한
나머지 after ID 2개는 redo 단계에서 이미 해제됐다. 이들 기록 ID 총 3개/형식, **6개
복원 시도**는 새 generation의 실제 WASM에서 snapshot 없음 오류로 거절됐다.
각 거절 묶음 뒤 full SVG/model·양 export bytes·dirty/cursor/history/generation이
모두 동일해 원자적 불변을 확인했다. 이어 실제 빈 undo/redo 4회도 동일했다.

snapshot ID 숫자는 새 document에서 재사용될 수 있다. 서로 다른 generation의 숫자
ID가 항상 유일하다는 주장은 하지 않는다. 여기서는 이전 객체의 참조 해제와 **새
snapshot 생성 전** 새 문서의 이전 ID 부재 및 원자적 거절을 확인했다. 원래 파일의
serialized 데이터에 history/snapshot 참조가 들어간 것으로 간주하지 않았다.

Node harness 0, Electron app 0, 정상 quit, errors 0, fallback 완화 비교 0,
manifest 계획/결과 2건을 확인했다. raw state 26개를 보존했다. JS/Python syntax 및
`git diff --check` 통과이며 기존 unit 33건을 새 통과 수로 합산/재실행하지 않았다.
새 Native 실행·UI/WASM 빌드·패키지는 없다. 기존 runtime 52파일을 재사용했다.

## 재검증과 예산

seed는 PR34 저장 파일을 files로 지정하고 위 SHA를 `priorSavedSHA256`에 기록한다.
`label:"reopened-lineWrap"`, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `sameFormatSaveReopen:true`,
`operations:["owner-reopened-edit"]`를 사용한다. runtime은 기존 external pin을 대조해
fresh phase에 하드링크 재사용한다. 전체 forecast를 먼저 검사한다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
GEULGYEOL_QA_NORMAL_FORECAST_BYTES=67108864 \
GEULGYEOL_QA_FAILURE_FORECAST_BYTES=16777216 \
python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" \
python3 -B scripts/check-owner-reopened-edit-evidence.py \
  "$RUN_ROOT" "$WASM_PKG" "$RUN_ROOT/fresh-comparison"
```

기존 QA/공개 문서/dirty/PR34 저장 사본 **9,497개 해시**가 종료까지 같았다. 이전
failed marker 및 원래 build child 0 / coordinator 후처리 1을 유지했다. private 원본·
사본·profile·runtime·경로 목록은 공개하지 않았다. 삭제·보안 설정 변경도 없다.

전체 새 forecast는 normal **100,663,296B (96MiB)** / failure **16,777,216B**다.
producer profile/raw/저장/manifest 64MiB, pins/collector/문서 8MiB, margin 24MiB를
포함했다. 최초 normal **670,605,312B** / failure **84,967,424B**, free
**44,428,439,552B**로 검사했다. 완료 snapshot과 한도는 proof에 있으며 running phase는
0이다. globalSynthetic은 **15,126,528B / 32,000,000B**다. 다음 실행은 전체 새
forecast를 현재 normal 잔여량에 맞춰 다시 검사해야 한다. 기존 default 128MiB
producer forecast를 그대로 적용하면 현재 normal 한도를 넘는다.

cross-format right page18 wrap 정답은 계속 미판정이다. 물리 IME·OS chooser·수동 GUI·
Linux/CI·새 packaged app은 미검증이며 누락 입력 4개로 막힌 Rust unit은 실행하지
않았다. PR25 직접 승인 대기와 추가 병합 요청 보류를 유지했다.

다음 최소 후보는 재열기 후 owner24와 다음 cell25를 연속 편집하여 **복수 history
entry의 undo/redo와 저장**을 연결하는 것이다. 현재 결과는 단일 owner 입력 command
범위이며 여러 셀/복수 entry/IME 지원 전체로 확대하지 않는다.
