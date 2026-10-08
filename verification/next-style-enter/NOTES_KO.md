# 문단 끝 Enter의 다음 스타일 — 2026-10-06

공개 beta1 엔진은 A(22).next=B(23)인 본문 끝에서 splitParagraph를 실행해도 새 문단에 A를 남겼다. 원본 앱을 수정하지 않고 기존 패키지 엔진의 Node 실행으로 재현했다(`baseline-packaged.json`). 동일 구조의 네이티브 기존 split 경로에서도 9개 지원 영역 모두 A가 유지됐다(`baseline-native.json`). 이 네이티브 baseline은 수정된 소스에서 기존 경로를 선택한 검사이며 과거 바이너리 실행으로 표시하지 않는다.

## 동작과 경계

일반 Enter에서 문단 끝을 나눌 때 새 문단에 다음 문단 스타일 B를 적용한다. 본문, 표 셀, 중첩 셀, 머리말, 꼬리말, 각주, 미주, 글상자, 표 캡션을 검사했다. 이전 문단과 다른 문단·스타일·참조는 유지한다. A의 기본 모양 ID인 글자 run/문단 모양만 B의 기본 ID로 교체하며, 직접 지정된 다른 모양 ID는 그대로 유지한다. 직접 모양의 필드 단위 합성까지 구현한 것은 아니다.

문단 중간 Enter, 일반 구조 split, 붙여넣기 split, removed_meta 복원은 기존 스타일을 유지한다. 빈 문단 끝과 자기 다음 스타일도 검사했다. [한컴 Mac 공식 도움말](https://help.hancom.com/hoffice_mac/webhelp/9.0/ko_kr/hwp/format/style/style%28edit%29.htm)은 Return으로 다음 문단 스타일을 적용한다고 설명하지만 중간 분할 및 직접 서식 정책의 정확한 기준은 제시하지 않는다. 끝에만 적용하는 현재 범위는 보수적인 구현 경계이며 실제 한컴 비교 검증은 남아 있다.

문단 스타일의 다음 대상이 글자 스타일인 경우는 현재 지원하지 않아 분할 전에 거절한다. 글자 스타일로 시작하는 문단은 다음 스타일 전환을 하지 않는다. 없는 스타일·모양, 범위 초과, 지원하지 않는 스타일 종류, opaque STYLE 참조는 문서와 이벤트를 바꾸지 않고 거절한다. 기존에 지원하지 않는 도형 캡션 split을 새 지원 영역으로 추가하지 않았다. 그림 캡션은 기존 셀 경로를 공유하지만 별도 fixture로 검증하지 않았다.

## 구현

엔진의 공통 next_style 계획을 모든 지원 split 경로에서 변경 전에 계산한다. 기존 Native/WASM split의 구조 분할 기본값과 시그니처를 보존하고 5개 WithNextStyle WASM export를 추가했다. Bridge의 마지막 선택 인자와 일반 Enter만 새 경로를 선택한다. 새 export가 없는 오래된 WASM으로 조용히 기존 동작을 수행하는 fallback은 없다.

본문/셀 Enter는 기존 SnapshotCommand를 사용해 실패 rollback과 정확한 undo/redo를 보장한다. 머리말·각주는 기존 submode snapshot 명령으로 편집 위치도 복원한다. Enter당 문서 snapshot이 1개, undo 상태에서는 2개가 유지되고 discard에서 해제된다. 큰 문서의 연속 Enter 비용은 아직 측정하지 않았다.

추가로 빈 B 문단을 merge한 뒤 역분할하면 B의 스타일·문단 모양은 돌아오지만 글자 모양이 A로 바뀌는 결함을 재현했다. ParaMeta에 선택적인 empty_char_shape_id를 추가하여 제어 문자 없는 빈 문단의 단일 start_pos=0 글자 모양만 보존한다. 기존 JSON의 필드 생략은 None으로 처리하며, 복원 참조도 변경 전에 검사한다.

## 자동 검증

Mac arm64, Rust 1.93.1, offline/locked, debug 정보·incremental 없이 jobs=2로 기존 target을 재사용했다. 정확한 명령·소스/로그 해시와 결과는 proof.json에 있다.

- 다음 스타일 정상/비전환 162개, HWP/HWPX 재열기 324회, snapshot undo/redo 288회, 실제 merge→역분할 36개.
- 잘못된 참조·복원 모양 등 원자 거절 126개. 전체 문서 Debug 상태와 이벤트 로그 동일.
- 현재 command.ts/Bridge 소스를 실행하는 mock 검사 11개: 새/기존 경로 구분, snapshot undo/redo, 부분 변경 후 실패 rollback, 자원 해제, 머리말·각주 편집 위치 복원. Node의 TS syntax 변환도 통과했다. 전체 tsc 검사는 아니다.
- Native lib+새 예제 3개 및 wasm32 lib strict Clippy(-D warnings) 통과.
- 기존 스타일 전파 48개/재열기96, 삭제16/32, 셀 수식72/288, 그룹 해제108/216, 스타일 메타데이터8/34, 이벤트8·타원5/26 회귀 통과.

전체 target 한도는 1.5 GiB이며 제한 중단이 없었다. 검사 중 최대 약 1.46 GiB, 최종 약 1.37 GiB다. 빌드가 종료됐고 새 GUI 검증 창은 열지 않았다.

## 전달 상태와 남은 확인

로컬 구현·검증 커밋만 만들었다. 공개 푸시는 부모가 직접 사용자 승인 대기 중이라고 명시했으므로 재시도하지 않았다. 원본 문서, 기본 앱, dev.3/dev.4, 공개 beta1/beta2, 원격 main·태그·릴리스, 계정·보안·인증서 설정을 변경하지 않았다.

새 WASM 바이너리의 실제 5개 binding 실행, 전체 TS/Vite 빌드, 새 Mac 패키징, 실제 GUI Enter/undo/redo/저장재열기, 물리 한글 IME, 한컴 중간 Enter·직접 서식 비교, 큰 문서 snapshot 비용, Linux 실행은 미검증이다. 이번 WASM Clippy는 컴파일·정적 검사이며 실행이나 GUI 성공으로 해석하지 않는다. 다음 단계는 별도 개발 WASM/앱에서 이 검증을 수행하는 것이다.
