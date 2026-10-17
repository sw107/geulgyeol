# 일반 본문 선택 입력의 undo 묶음 — 실환경 검증 전 후보

기준 main: `f8356bb02a7366631d39babfca2ef773dfb5fd31`.
**실제 WASM/Electron 검증을 완료하기 전에는 병합하지 않는다.**

PR #69에서 기존 선택 교체가 두 단계 undo라는 것을 실제 Electron에서 확인했다.
이번 소스 조사에서는 비조합 `onInput`이 `deleteSelection()`과 `InsertTextCommand`를
서로 다른 history 항목으로 실행하는 원인을 확인했다. 첫 undo는 입력 글자만 제거하고,
둘째 undo가 삭제 조각을 복원한다. 과거 실제 앱 근거를 이번 후보의 통과 근거로 사용하지 않는다.

## 수정 범위

필드 없는 문서의 normal 모드, 같은 구역 안 일반 본문 선택에 한정해 삭제와 입력을
기존 `SnapshotCommand` 한 건으로 묶는다. 임시 `DeleteSelectionCommand`의 삭제 조각은
항상 해제하고, 삭제가 no-op이면 입력하지 않는다. 이후 일반 타이핑과도 이력을 합치지 않는다.
기존 계약에 따라 교체 undo는 원문을 복원하되 삭제 전 선택을 다시 선택하지 않는다.

입력 실패는 기존 snapshot rollback을 사용하며 성공적으로 복원된 경우에만 선택과
대기 서식을 되돌린다. rollback 자체의 실패나 이미 commit된 뒤 refresh 실패를
성공적인 복원으로 표시하지 않는다. 필드 조회 실패는 삭제 전에 중단한다.

필드가 하나라도 있는 문서, form 모드, 셀·글상자, 머리말/꼬리말·각주,
IME/iOS 입력과 구역을 넘는 선택은 기존 경로에 남긴다. 따라서 이 범위의 기존
2단계 undo를 해결했다고 주장하지 않는다. Rust/WASM API와 공통 history 구현은 수정하지 않는다.

## 이번 실행 범위

- VM 회귀 **34개 통과**: 신규 파일 29개와 기존 native edit/history 계약 5개.
- 수정 전 같은 VM 행동 검사는 첫 undo 뒤 빈 문서로 실패한다. 최종 후보에서는
  첫 undo 원문 복원, redo, 뒤따르는 타이핑의 독립 경계, Unicode scalar와 이웃 텍스트,
  대기 서식 및 stale 서식 배제, no-op/실패 시 redo 보존과 자원 해제를 검사했다.
- 실제 소스의 `onInput`, 라우터의 `executeOperation`/`deleteSelection`/form gate/
  pending-format 메서드, `CommandHistory`, `SnapshotCommand`, 삭제/삽입 명령을 실행했다.
  **WASM·커서·geometry·refresh는 메모리 어댑터다.** snapshot/format/metadata 보존 결과도
  이 모델 범위이며 실제 파일 형식·엔진의 무손실 근거가 아니다.
- 전체 Studio `tsc --noEmit --incremental false`, 신규 CJS `node --check`, Git 공백 검사 통과.
- 앱 실행·Native/WASM 실행/빌드·Vite 빌드·전체 desktop 묶음·패키징·설치·새 의존성 추가는 없다.
  CI 체크 부재를 통과로 집계하지 않는다.

실행 명령:

```sh
node --test desktop/tests/atomic-selection-input.test.cjs desktop/tests/edit-history.test.cjs
node --check desktop/tests/atomic-selection-input.test.cjs
cd rhwp-studio && node node_modules/typescript/bin/tsc --noEmit --incremental false
```

## 병합 차단점

1. 실제 WASM/production Studio를 사용하는 Electron에서 비조합 선택 교체 → 첫 undo 원문 복원
   → redo를 확인해야 한다. 역방향 선택, 여러 문단, 한글/emoji, 혼합 직접 서식과 스타일을 포함한다.
2. 실제 snapshot·삭제 조각의 수명과 오류 경로, 커서·문서 버전·복구본 상태를 확인하고
   HWP/HWPX 저장·실제 앱 재열기에서 내용과 참조를 비교해야 한다.
3. 새 경로는 전체 문서 snapshot을 쓰므로 큰 문서의 메모리·응답성과 기존 snapshot 예산을
   실제 엔진에서 확인해야 한다. VM의 110회 반복 검사는 엔진 측 성능·예산 인증이 아니다.
4. 제외한 필드/하위 편집/IME 경로가 그대로 유지되는지 실환경 회귀가 필요하다.

기존 공간 기준 `15 GiB + 256 MiB = 16,374,562,816 bytes`는 변경하지 않았다.
사용자가 명시한 소스/VM/noEmit 최소 범위만 실행했다. 실제 엔진·앱 검증을 위한
공간과 실행 조건이 확보되기 전에는 위 차단점을 해제하지 않는다. 새 베타 배포도 보류한다.

원시 로그·수정 전 소스·실패 시도·source/support/evidence pin은 저장소 밖
`atomic-selection-replacement/qa/`에 보존한다. 초기 회귀의 필드 조회 실패 처리와
대기 서식 초기화 가정에 따른 실패도 최종 통과와 구분한다. 원본 dirty checkout과 기존 증거에는 쓰지 않았다.
