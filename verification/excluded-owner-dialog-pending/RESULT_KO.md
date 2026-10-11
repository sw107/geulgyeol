# 숫자 미적용 변경의 Escape·취소와 단일 redo 보존

승인된 PR32 HEAD `c673197b36264e7e4c21c2e3caf8c1a753d12f44` 기반 별도 QA다.
관련 Escape·취소 버튼 경로를 한 묶음으로 확인했다. SQUEEZE 일반 셀은 **3**, 대상은
**32행 × 2열 병합 owner 24**다. 두 취소 경로의 문서·history·포커스 결함은 재현되지
않아 제품 소스·UI/WASM은 변경하지 않았다. 이전 고정 SHA·증거·원본·dirty를 보존했다.

## 실제 필드 계약

셀 모드 `table:cell-props` 대화상자의 **여백/캡션 → 바깥 여백 → 왼쪽** 숫자 필드는
활성·편집 가능하며 type number, step **0.1mm**, 표시 min/max **-115.6~115.6mm**다.
`populateFields()`는 signed HWPUNIT을 0.1mm로 표시한다. `numberInput()`의 change
handler는 DOM 값의 범위만 조정하고 문서를 적용하지 않는다. `onConfirm()`에서 정확한
signed 범위를 검사하고 outerLeft 변환과 snapshot history 작업을 진행한다.

fixture의 원래 outerLeft **283HU**는 **1.0mm**로 표시된다. 실제 CDP 숫자 입력칸 클릭과
**ArrowUp** 키로 **1.1mm**가 되었고, 필드 변환 계약상 **312HU**이므로 원래 문서 값과
다르다. 필드는 valid이고 초점은 해당 INPUT에 있다. 확인 버튼은 누르지 않았고 실제
문서는 계속 283HU다. 개인 원본을 편집하거나 확인/설정 저장·다른 속성 변경을 하지 않았다.

## 실제 Mac Electron 시나리오와 집계

HWP/HWPX × Escape/취소 버튼 = **4개 시나리오**다. 각 fixture의 owner 24 문단 0에
`REDO_PENDING🙂`를 입력한 뒤 undo하여 단일 redo entry와 snapshot resource 2를
보유했다. 첫 대화상자에서 숫자 필드를 미적용 변경한 뒤 닫고 실제 redo→undo 키를
전달했다. 같은 단일 redo 상태에서 다시 열어 숫자를 미적용 변경하고 닫은 직후 일반
문자 **x**를 전달했다. 두 번째 열기는 일반 키 전달을 history 처리의 포커스 복원과
구분하기 위한 단계이며, 다시 표시된 값은 원래 **1.0mm**였다.

| 단계 (4개 시나리오 동일) | undo | redo | resource | 숫자 필드 / 문서 |
| --- | ---: | ---: | ---: | --- |
| setup 입력 | 1 | 0 | 1 | 문서 outerLeft 283 |
| setup undo | 0 | 1 | 2 | 문서 outerLeft 283 |
| 첫 열기·숫자 미적용 변경 | 0 | 1 | 2 유지 | 1.0→1.1mm / 문서 283 유지 |
| Escape/취소 닫기 | 0 | 1 | 2 유지 | 문서 283 유지 |
| 강제 focus 없는 redo | 1 | 0 | 1 | 이전 편집 복구 |
| 강제 focus 없는 undo | 0 | 1 | 2 | 원본 복구 |
| 두 번째 열기·미적용 변경·닫기 | 0 | 1 | 2 유지 | 다시 1.0→1.1mm / 문서 283 유지 |
| 닫기 직후 일반 x 키 | 1 | 0 | 1 | 본문 셀에 x만 추가 / outerLeft 283 |

열기·숫자 변경 중·닫기 각각에서 **전체 모델·SVG와 HWP/HWPX 양 export bytes**, 내용,
서식·표/셀 속성·페이지·스타일, cursor·dirty·history counts/resources·같은 redo 객체와
전체 필드가 같았다. 첫 대화상자 동안 snapshot IDs **0, 1**, 두 번째 동안 **0, 2**를
유지했다. read-only JSHandle은 확인 후 해제했고 direct snapshot restore probe는 없다.

숫자 변경의 keydown/input/change는 실제 대화상자 INPUT을 target으로 했으며 편집기에
전달되지 않았다. Escape는 **숫자 INPUT**에서 전달됐다. 취소 버튼은 실제 클릭했고,
두 경로 모두 닫힌 뒤 host IFRAME와 실제 editor TEXTAREA(aria-label "문서 편집 입력")로
포커스가 돌아왔다. 초기 셀 준비에만 기존 QA `selectCell()` focus를 사용했다. 새
`ownerDialogPending()`에는 강제 `focus()`·`selectCell()`·기존 history key helper 호출이
없다. 읽기 전용 passive observer는 기본 동작/전파를 바꾸지 않으며 finally에서 제거했다.

첫 닫기 후 실제 redo는 이전 편집 모델·SVG와 scalar cursor offset **13**을, undo는
원본 모델·SVG와 offset 0을 복구했다. **history 복구는 export container bytes를 제외**한다.
두 번째 닫기 직후 일반 x의 keydown과 input이 editor를 target으로 하고 cursor offset 1,
새 단일 undo entry와 redo 0 / resource 1을 만들었다. 다른 문단·셀·본문·서식·표 속성·
페이지·스타일을 보존했다. 의도된 새 입력의 redo 교체는 과거 결함으로 보고하지 않는다.

최종 통과 집계는 **4개 시나리오 / 미적용 숫자 변경 8건 / 닫기 8회**다. 열기·닫기
불변 16단계 + 미적용 상태 8단계 = **24개 불변 checkpoint**, 동일 redo 객체 검사
**24건**이다. 강제 포커스 없는 닫기 후 history key command **8건**, 일반 입력 **4건**,
history 복구 **setup undo 4 + redo 4 + undo 4 = 12건**, redo→undo cycle **4회**다.
최종 Node/Electron 실제 exit 0 및 정상 quit을 별도 기록했다. 대화상자의 history 추가는 0.

## 초기 중단 증거와 한계

첫 시도는 CDP **Meta+A가 숫자 전체를 선택한다는 전제**로 1.5를 타이핑했다. 실제
값은 **151.0**, validity false가 되어 목표 값 검사에서 닫기 전 중단했다. 그때도 전체
문서·양 export·history·cursor·dirty와 같은 redo 객체는 유지됐다. 초기 Node exit **1** /
Electron exit **0**, 정상 quit, failed marker 및 raw 파일 **143개 해시**를 보존했다.
최종 통과를 초기 시도에 소급하지 않았다. 당시 checker는 승인 base와 당시 편집 스크립트로
새 checkpoint에 재구성했으며, 기록된 초기 source SHA와 정확히 같음을 확인했다.
원래 로그·process record·marker·raw 증거는 수정하지 않았다.

최종 단계는 숫자 field의 실제 ArrowUp 계약으로 **새 electron-final**에서 실행했다.
CDP Meta+A 선택 동작을 Mac 앱 또는 브라우저 기본 편집의 제품 결함으로 단정하지 않는다.
숫자 입력의 Meta+A 선택·실제 OS 키보드 동작은 **미판정**이다. CDP 합성 키의 trusted
이벤트를 관찰한 것이며 물리 키보드·한글 IME·수동 GUI까지 검증했다고 주장하지 않는다.

## 독립 비교·보존·예산과 재검증

collector는 원본/copy SHA, 최종 44개 단계 파일, 필드 값·범위·유효성·초점·ArrowUp 이벤트,
미적용 불변, 두 닫기 경로의 redo/snapshot·포커스·키보드 전달, 복구 및 일반 입력을
독립 비교했다. QA 함수의 강제 focus 부재와 passive observer cleanup도 확인했다.
이전 원본·dirty·QA·PR26~32 공개 증거 **8,448개 해시**, 초기 중단 **143개 해시**를
재확인했다. runtime 52개와 제품 source pins가 같으며 새 UI/WASM 빌드·패키지·
저장/재열기·Native·synthetic 폴더는 없다. 기존 build child exit **0** / coordinator
후처리 exit **1**, 원래 complete marker와 verified pin을 보존했다. 개인 원본·프로필·
runtime·private 경로 목록은 공개하지 않았다.

추가 파일 전에 normal **642,781,184B** / failure **75,276,288B**, normal 128 MiB /
failure 16 MiB forecast 및 free 하한을 확인했다. 초기 중단 증거를 failure로 보존한 뒤
최종 기록 전 normal **652,505,088B** / failure **78,860,288B**, unfinished phase 0이다.
한도는 805,306,368B / 268,435,456B, free 하한은 16,374,562,816B다. 완료 snapshot의
정확한 free/forecast는 `proof.json`에 있다. canonical `/tmp`와 Python tempdir의 전역 합성
증거는 inode 중복 없이 **15,126,528B / 32,000,000B**로 유지됐다. 기존 파일·캐시를
삭제하지 않았다.

기존 `fallback-lineWrap` 두 files, `historyCell:24`, `repairExpected:true`,
`fallbackExactHistory:true`, `verifyUnchangedSaveReopen:false`,
`operations:["owner-dialog-pending-escape","owner-dialog-pending-cancel"]` seed를 사용한다.
아래의 fresh runtime은 `RUN_ROOT/electron-final`이다. 보존된 phase를 덮어쓰지 않는다.
독립 비교에는 seed/prior pins, 초기 attempt pins와 raw phase, PR27 build/runtime pins가 필요하다.

```sh
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/run-electron-linewrap-history-qa.py \
  "$RUN_ROOT/electron-final" "$WASM_PKG" "$RUN_ROOT/seeds.json"
GEULGYEOL_QA_BUDGET_ROOT="$QA_ROOT" python3 -B scripts/check-owner-dialog-pending-evidence.py \
  "$RUN_ROOT" "$RUN_ROOT/fresh-comparison"
```

checker/collector syntax·독립 state/SHA 비교 및 제품 소스 무변경을 확인했다. 복수 entry·
설정 확인/저장·다른 속성 변경·저장/재열기·중첩 표·물리 키보드/IME·Linux/CI·새 packaged
app은 실행하지 않았다. 제외 geometry/history scope 승격, 기존 Rust 누락 입력 해결,
right page18 형식 간 정답 판정을 주장하지 않는다.

다음 후보는 입력칸의 **선택·숫자 편집 단축키 계약**을 한 묶음으로 진단하는 것이다.
특히 CDP Meta+A와 명시적 SelectAll 편집 명령을 구분해 현재 미판정을 좁힐 수 있다.
PR25 직접 승인 대기와 추가 병합 승인 요청 보류를 유지했다.
