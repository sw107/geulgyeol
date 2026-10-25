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
