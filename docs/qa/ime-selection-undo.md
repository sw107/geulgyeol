# 본문 선택 IME 교체의 undo 단위

선택한 `ABC`를 한글 `가`로 덮어쓸 때 삭제와 삽입을 따로 기록하던 경로를 수정한다. 기존 일반 텍스트 선택 교체와 동일하게 한 번의 undo로 원문을 복구하고, 한 번의 redo로 교체 결과를 복구한다.

## 범위와 계약

- 일반 편집 모드, 필드가 없는 문서, 같은 구역의 일반 본문 선택만 적용한다. 여러 본문 문단과 Unicode scalar 위치를 지원한다.
- 셀 내부·셀 간·중첩 셀·글상자·각주·머리말·필드·양식 경로는 기존 구현을 사용한다. 이 PR은 해당 영역의 undo 개선을 주장하지 않는다.
- 조합 중에는 history/redo를 건드리지 않는 복구용 snapshot을 보관한다. 확정 시 미리보기를 되돌리고 기존 `replaceBodySelectionInput` 트랜잭션으로 한 번 기록한다.
- 빈 조합 종료·취소는 원문, 선택 방향/블록 단계와 redo를 복구한다. 복구 뒤 화면 invalidation도 수행한다.
- 정상 교체 후 undo는 기존 타이핑 계약대로 원문과 캐럿을 복원하며 선택 강조를 되살리지 않는다. **취소의 선택 복구와 undo의 선택 동작은 다르다.**
- blur는 최종 조합 데이터보다 먼저 올 수 있으므로 교체를 마감하지 않고 native `compositionend`를 기다린다. 미리보기 `ㄱ` 뒤 final `가`도 같은 교체에 반영한다.
- 조합 중 Undo는 현재 미리보기를 한 트랜잭션으로 마감하고 되돌린다. Undo·명시적 취소 이후 남은 이전 조합의 이벤트는 완료한 문서를 다시 수정하지 않는다. 새 `compositionstart`는 이 보호 상태를 해제한다.
- 다른 편집 명령·Redo·문서 에이전트는 조합 완료 전 무변경 거절하고 재시도를 요구한다. 최종 native 데이터가 오기 전 미리보기를 임의로 확정하지 않는다. deactivate/dispose는 복구용 상태를 취소·정리하며 다른 document generation에는 이전 snapshot을 적용하지 않는다.

## 코드 검사

```sh
GEULGYEOL_QA_ENGINE_DIR=/absolute/path/to/existing/sdk node --test \
  desktop/tests/ime-selection-undo.test.cjs \
  desktop/tests/atomic-selection-input.test.cjs \
  desktop/tests/ime-commit-data.test.cjs
node scripts/test-studio.mjs
```

전용 검사에는 실제 생산 입력 라우터/명령/history, 메모리 모델의 실패 주입 및 합성 HWP/HWPX 엔진 검사가 포함된다. 실제 문서는 여러 문단·이모지 선택 교체, 한 번의 undo 후 HWPX bytes 일치, redo, 취소, 각 형식 export/reopen을 검사한다. WASM은 기존 SDK를 재사용하며 새 빌드의 인증이 아니다. GUI·OS IME 이벤트 생성·물리 키보드는 이 검사로 검증되지 않는다.

## 독립 네이티브 QA 대기

사용자 문서/실행 중 앱과 분리된 QA 사본에서 진행한다. 현재 사용자 앱 PID 54608과 문서를 조작하지 않는다.

1. 새 합성 문서에서 `SELECT: ABC`의 ABC만 선택 → 한글 가 조합·확정 → undo 한 번으로 ABC → redo 한 번으로 가.
2. 역방향 선택, 이모지가 있는 선택, 여러 본문 문단을 넘는 선택에서 동일 검사. 주변 텍스트·서식 보존 확인.
3. 조합을 빈 결과로 취소: 원문·선택 방향·블록 단계·기존 redo와 화면이 복구되는지 확인. Escape는 OS에서 확정할 수도 있으므로 실제 compositionend의 빈 data 여부를 구분한다.
4. 조합 중 메뉴 Undo/Redo·포커스 이탈 후 후속 입력을 점검하고 지연된 compositionend/input 순서를 기록한다. `blur → end → input`과 `blur → input → end`에서 글자가 한 번만 남는지, 빈 종료는 원문을 복구하는지 확인한다. 조합 중 다른 편집 명령의 거절 및 조합 완료 후 재시도를 확인한다. #112의 별도 네이티브 IME 조사와 혼동하지 않는다.
5. 셀 내부/셀 간/각주/필드/양식은 기존 동작과 비교하여 새 본문 경로가 개입하지 않는지 확인한다.
6. 사본 저장 및 새 프로세스 재열기, undo/redo 반복, 문서 전환·닫기 확인.

독립 검토와 네이티브 QA 전 병합하지 않는다. 배포·설치 앱 교체·외부 권리 미확인 fixture 복원은 범위 밖이다.


## 문서 전환 중 남은 IME 이벤트 계약 (main 0b94b456 기준)

문서 모델의 세대와 textarea의 native 조합 스트림은 수명이 다르다. `loadBytes`/새 문서 경로는 WASM 문서를 바꾼 뒤 `initializeDocument`에서 입력 핸들러를 deactivate/activate한다. 원래 문서 세대가 바뀌면 종료된 조합 표시도 지웠으므로, `compositionend → input(insertText)`가 늦게 도착하면 새 문서에 이전 조합의 글자가 삽입될 수 있었다. 실제 Mac에서 이 순서가 발생했다는 주장은 아니다.

수정은 본문 선택 교체 스트림에 한정한다. 스냅샷은 계속 원래 document generation에서만 복구한다. 종료 표시와 마지막 native data는 핸들러에 보관하며, 세대 변경이나 deactivate를 넘어 전달된 이전 조합의 입력을 소비한다. 새 compositionstart는 종료 표시를 해제한다. 마지막 data는 동일한 후속 입력 한 번만 소비하며, 다른 일반 입력이 먼저 오면 폐기한다. 키 이벤트에서 글자를 추측하거나 시간 지연을 추가하지 않는다.

### 실제 SDK 자동 검사

두 형식 모두 프로젝트가 만든 빈 문서에 `ABC`, `NEW`, `ㄱ`, `가`를 넣는 합성 입력을 사용한다. 생산 입력 라우터/명령/history와 deactivate/activate 메서드를 실행하고, 렌더링·포커스 DOM 효과만 대체한다. 새 문서로 연결하는 bridge doc 및 generation 교체는 테스트에서 수행하므로 앱의 전체 파일 열기 절차 검증은 아니다.

| 경로 | 검사 수 (HWP+HWPX) | 확인한 계약 |
|---|---:|---|
| 빈 native end, preview 없음/ㄱ | 4 | 원문 bytes·역방향 선택·블록 단계·기존 redo 복구 |
| 명령 거절 후 확정/취소와 재시도 | 4 | 거절은 무변경, 재시도 정상 실행, undo 경계 유지 |
| 문서 교체 후 end/input 순서 | 32 | 가/ㄱ preview, end-input/input-end, 재활성화 뒤/비활성 중/비활성화 전/pending generation 변경: 새 문서 bytes와 history 보존, 새 조합 허용 |
| Redo 거절 → 빈 종료 → 재시도 | 2 | 기존 redo 항목 보존 후 정상 실행 |
| 재활성화 뒤 1회 final input 소비 | 2 | 다음 같은 일반 입력까지 막지 않음 |
| 문서 없는 동안 end | 2 | 이전 snapshot 접근 없이 다음 문서 보존 |
| 다른 일반 입력 뒤 같은 글자 | 2 | 오래된 final data가 이후 독립 입력을 삼키지 않음 |
| 정상 native end 직후 문서 교체 | 8 | 가/ㄱ preview, insertText/insertFromComposition의 남은 1회 입력을 새 문서에 삽입하지 않음 |

56건은 base에서 14 통과/42 실패, 수정본에서 56 통과다. 기존 IME/선택 교체 검사를 합친 165건, Studio 기본 254건과 타입 검사도 통과했다. 기존 SDK WASM SHA-256은 `918c9c7dc584e4bdf28a8afa42fce062a077d944744d58bb4c37de74d559f697`이다. 새 빌드의 검증이 아니다. 각 형식 export/reopen은 같은 프로세스의 SDK 검사다.

### 물리 입력 또는 별도 native QA가 필요한 항목

- OS IME에서 실제 빈 data 취소를 유도한 뒤 원문·선택·redo 복원 확인. Escape가 확정한 경우를 취소 성공으로 기록하지 않는다.
- 조합 중 포커스 이탈/문서 열기/새 문서에서 compositionstart, input의 data·inputType·isComposing, compositionend, blur와 문서 세대 변경의 실제 순서를 기록한다. 위 순서를 만들지 못하면 미재현으로 남긴다.
- 거절된 명령의 사용자 안내 및 조합 종료 후 재시도 UI, 화면 갱신·캐럿·포커스, 물리 키보드의 빠른 연속 입력을 확인한다.
- 사본 저장 대화상자 및 새 native 프로세스 재열기 검증은 별도다. 사용자 문서·미저장 앱을 사용하지 않는다.
- 이전 `가ㄴㅏ`/`가ㅏ` 관측의 원인은 미확정이다. 이 문서 전환 결함과 동일 원인이라고 단정하지 않는다.


### 동일 문자열의 새 일반 키 입력 회귀 수정

독립 검토에서 `compositionend(data=a) → 문서 교체 → 새 일반 keydown(a) → input(a)`를 이전 조합의 후속 입력으로 오인하는 P2를 확인했다. 실제 SDK HWP/HWPX에서 이전 trailing input이 없는 경우/비활성 중 이미 도착한 경우 각각 재현했으며 base 4 통과, PR 최초 head `b1700415b51a4d0578b9671c38ce9fb400cc33d5` 4 실패였다.

키 라우팅에서 소비되지 않은 새 문자 keydown은 입력 경계 번호를 갱신한다. 종료된 본문 선택 조합은 당시 번호를 저장하며, 새 경계에서는 final data와 기존 중복 억제 값을 폐기한다. keydown으로 문자를 생성·복구하지 않으며 실제 문자는 계속 input 이벤트에서만 받는다. 활성 조합, isComposing 또는 keyCode=229, Ctrl/Meta 조합과 preventDefault된 단축키는 새 문자 경계로 취급하지 않는다. Shift 및 Option 문자 입력은 허용한다. 비활성 중 도착한 이전 후속 input도 모델을 수정하지 않고 1회 억제 값을 소비한다.

수정 후 독립 리뷰 재현 4건과 기존 대조 8건이 통과했다. 프로젝트에 정상 동일 문자 입력 4건, 비활성 이벤트 소비 2건, isComposing/keyCode229 보호 4건을 추가했다. Option 문자 입력 2건과 소비된 Alt 단축키 보호 2건도 추가해 기존 165건을 유지한 집중 179/179, Studio 254/254, 타입 검사와 diff 검사가 통과했다. 실제 Mac이 이 이벤트 순서를 생성하는지와 물리 키보드 결과는 미검증이며, 이전 `가ㄴㅏ`/`가ㅏ` 관측의 원인은 미확정이다.
