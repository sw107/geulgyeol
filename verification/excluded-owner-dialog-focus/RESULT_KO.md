# Escape·취소 후 편집기 포커스와 키보드 전달

승인된 PR31 HEAD `a058caa31f2f9d2c2346d4f7c7f4efe753aff9f9` 기반 별도 QA다.
SQUEEZE 일반 셀은 **3**, 대상은 **32행 × 2열 병합 owner 24**다. 새 UI 결함은
발견하지 않았으며 제품 소스·UI/WASM은 변경하지 않았다. PR31의 취소 후 키보드
검사는 명시적 제품 `focus()` 호출을 사용해 자동 포커스를 검증하지 않았다는 범위를
그대로 보존했다. 이번 시나리오는 그 미검증 범위를 별도 증거로 확인했다.

## 의도와 실제 동작

기존 `ui/dialog.ts`의 `ModalDialog.show()`는 확인 버튼에 포커스를 주고 document
capture에서 모달 키를 처리한다. Escape는 대화상자를 닫고 전파를 막는다. `hide()`는
마지막 overlay가 사라진 경우 `MODAL_DIALOG_CLOSED_EVENT`를 보낸다. `main.ts`의
`setupModalFocusRestore()`는 활성 InputHandler의 제품 `focus()`로 입력 영역을 복원한다.
이 복원은 기존 의도이며, 닫힌 뒤 확인/취소 버튼이나 body에 포커스를 남기려는 경로가 아니다.
제품의 이 이벤트·메서드를 대체하거나 계측 wrapper로 바꾸지 않았다.

HWP/HWPX × Escape/취소 버튼 = **4개 시나리오**다. 각 시나리오는 owner 24 문단 0
시작에 `REDO_FOCUS🙂`를 실제 입력한 뒤 undo하여 undo 0 / redo 1 / resource 2를
보유한다. 셀 모드에서 제품 `table:cell-props` 명령으로 대화상자를 열고 확인 버튼의
실제 포커스와 셀 모드 탭을 확인했다. 입력 필드 변경과 확인/설정 저장은 없다.

첫 열기·닫기에서는 실제 Escape 키 또는 취소 버튼 클릭 직후 상태를 관찰하고,
QA `focus()` 없이 실제 Mac redo→undo 단축키를 전달했다. 이어 복구된 단일 redo
상태에서 같은 경로로 다시 열고 닫아 일반 문자 키 `x`를 즉시 전달했다. 두 번째
닫기는 일반 키의 전달이 history 처리 후 부수적인 포커스 복원에 가려지지 않도록
따로 확인하는 단계다. 복수 history entry를 만들지 않았다.

| 단계 (4개 시나리오 동일) | undo | redo | resource | 포커스 |
| --- | ---: | ---: | ---: | --- |
| setup 입력 | 1 | 0 | 1 | 편집 입력 |
| setup undo | 0 | 1 | 2 | 편집 입력 |
| 첫 대화상자 열기 | 0 | 1 | 2 유지 | 확인 버튼 |
| 첫 Escape/취소 닫기 | 0 | 1 | 2 유지 | 편집 입력 |
| 강제 focus 없는 redo | 1 | 0 | 1 | 편집 입력 |
| 강제 focus 없는 undo | 0 | 1 | 2 | 편집 입력 |
| 두 번째 열기·닫기 | 0 | 1 | 2 유지 | 확인 버튼 → 편집 입력 |
| 닫기 직후 일반 키 x | 1 | 0 | 1 | 편집 입력 |

## 포커스·키보드·history 증거

처음 셀 cursor를 준비할 때 기존 QA `selectCell()`의 제품 focus 호출을 사용했다.
그 뒤 새 `ownerDialogFocus()` 함수에는 `focus()`·`selectCell()`·기존 강제 포커스
history helper 호출이 없다. 대화상자 닫기와 다음 키 전달 사이에도 포커스 변경·선택
변경·직접 mutation을 넣지 않았다. 클릭이 취소 버튼에 주는 포커스는 실제 사용자
입력 경로이며, 닫힌 뒤에는 제품이 입력 영역으로 돌려준다.

각 닫기 후 host의 active element는 editor **IFRAME**, renderer의 active element는
실제 InputHandler 입력 **TEXTAREA / aria-label "문서 편집 입력"**이며 handler는 active다.
대화상자 열기 중 확인 버튼으로 옮겨졌던 포커스가 실제 `focusin` 이벤트로 편집기에
돌아왔다. Escape 자체는 모달 버튼에 전달되고 이후 편집 키는 편집 입력에 전달됐다.

읽기 전용 passive capture listener로 `keydown`·`input`·`focusin`의 target과
`isTrusted`를 관찰했다. listener는 전파를 막거나 기본 동작을 바꾸지 않으며 bounded
64개 로그를 사용하고 finally에서 제거한다. 실제 Electron CDP 키보드 입력의 redo/undo
각 keydown은 편집 입력을 target으로 했고, 일반 `x`는 편집 입력의 keydown 및
`inputType:insertText`, data `x` input으로 전달됐다. 물리 키보드·한글 IME 수동 검증을
한 것은 아니다.

열기·닫기 각각은 **전체 모델·SVG와 HWP/HWPX 양 export bytes**, 내용·cursor·dirty·
history counts/resources·동일 redo command 객체와 전체 필드를 유지했다. 첫 대화상자
동안 snapshot IDs **0, 1**, 두 번째 동안 **0, 2**가 같았다. command는 read-only
JSHandle로 동일성을 확인하고 해제했다. direct snapshot restore probe는 없다.

첫 닫기 후 실제 redo는 이전 편집 모델·SVG와 scalar cursor offset **11**을 복구했고,
undo는 원본 모델·SVG와 offset 0을 복구했다. beforeId 0과 timestamp·cursor 계약을
유지하고 lazy after snapshot 반환/재할당에 따라 redo 후 null, undo 후 2를 확인했다.
이 **history 복구 비교는 export container bytes를 제외**한다. 두 번째 닫기 직후
일반 x 입력은 원본 첫 문단에 x 한 글자를 추가하고 cursor offset 1, 새 단일 undo entry,
redo 0 / resource 1, 새 beforeId 3을 만들었다. 다른 문단·셀·본문·서식·표 속성·페이지·
스타일을 보존했다. 이 의도된 새 입력의 redo 교체를 과거 결함으로 보고하지 않는다.

집계는 **4개 시나리오 / 닫기 8회 / 열기·닫기 16단계 / 동일 redo 객체 검사 16건**이다.
강제 포커스 없는 닫기 후 **history key command 8건**, 즉시 일반 문자 입력 **4건**을
확인했다. history 복구는 **setup undo 4 + 닫기 후 redo 4 + undo 4 = 12건**,
redo→undo cycle은 **4회**다. 실제 Node/Electron exit 0 및 정상 quit을 별도 기록했다.
대화상자 자체가 추가한 history entry는 0이며 일반 문자 입력은 의도된 1 entry다.

## 독립 비교·보존·예산

collector는 원본/copy SHA, 36개 단계 파일, 실제 focus target·trusted key/input,
두 닫기 경로의 전체 불변·command identity·snapshot IDs, 실제 history 복구,
일반 문자 입력 및 새 단일 entry를 독립 비교했다. QA 함수의 강제 focus 부재와
passive observer·cleanup도 확인했다. 원본·기존 dirty·이전 QA·PR26~31 공개 증거
**8,258개 해시**는 같았다. verified runtime 52개와 제품 source pins를 재확인했다.

새 UI/WASM 빌드·패키지·저장/재열기·Native 실행·synthetic 폴더는 없다. 기존
**build child exit 0 / coordinator 후처리 exit 1** 기록, source proof, 원래 complete
marker와 verified pin을 유지했다. 개인 원본·프로필·runtime·private 경로 목록은
공개하지 않았다. 완료된 manifest와 planned records는 0이다.

추가 파일 전에 normal **633,438,208B** / failure **75,276,288B**, normal 128 MiB /
failure 16 MiB forecast 및 free 하한을 확인했다. 최종 기록 전 normal
**642,777,088B** / failure **75,276,288B**, unfinished phase 0이다. 한도는
805,306,368B / 268,435,456B, free 하한은 16,374,562,816B다. 완료 snapshot의 정확한
free/forecast는 `proof.json`에 있다. canonical `/tmp`와 Python tempdir의 전역 합성
증거는 inode 중복 없이 **15,126,528B / 32,000,000B**로 유지됐다. 기존 파일이나
캐시를 삭제하지 않았다.

## 재검증과 다음 범위

기존 `fallback-lineWrap` 두 files, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-dialog-escape-focus","owner-dialog-cancel-focus"]` seed를 사용한다.
fresh private runtime을 준비하고 아래 순서로 실행한다. 보존된 phase는 덮어쓰지 않는다.
독립 비교에는 `RUN_ROOT/electron`, `seeds.json`, `prior-pins.json`과 인접 PR27
build/runtime pins가 필요하다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$FRESH_ELECTRON_PHASE" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-dialog-focus-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

checker/collector syntax, 실제 Electron, 독립 state/SHA 비교와 제품 소스 무변경을
확인했다. 설정 확인/저장·속성 변경·복수 entry·저장/재열기·중첩 표·마지막 셀 행 추가,
물리 키보드·IME·수동 GUI·Linux/CI 또는 새 packaged app은 이번 범위에서 실행하지
않았다. 제외 geometry/history scope 승격, 기존 Rust 누락 입력 해결, right page18
형식 간 정답 판정을 주장하지 않는다.

다음 최소 후보는 셀 속성의 **숫자 입력칸에 포커스가 있는 상태에서 Escape로 닫기**다.
값을 바꾸지 않고 같은 단일 redo·snapshot 보존과 편집 키 전달을 확인할 수 있다.
PR25 직접 승인 대기와 추가 병합 승인 요청 보류를 유지했다.
