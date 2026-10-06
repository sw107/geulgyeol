# 본문 번호 이어쓰기 구현·검증

체크아웃 `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, 기준 `1d85931f582de727b0c2e1c48ede9a2e7e6051a9`(dev7 보존 체크포인트). 로그·합성 입력·저장 파일·최종 Native/WASM 결과는 인접 `../numbering-continuation-qa`에 보존한다. 이 변경은 새 앱 배포가 아니다.

## 문제와 수정

번호 대화상자가 이력 명령 밖에서 정의를 생성했다. 일반 문단에서 “앞 번호 목록에 이어”, 번호 문단에서 “이전 번호 목록에 이어”를 확인하면 새 ID가 적용되어 3번이 1번으로 돌아갔다. 두 경로를 수정 전에 각각 실제 WASM/UI 코드로 실행하여 `1. != 3.` 실패와 exit1을 기록했다.

본문에서 대화상자 진입 시 대상 문단·선택 범위, 정의, 문서 세대, 이전 문단 속성과 대상 텍스트를 고정한다. 앞 번호는 가장 가까운 앞선 번호/개요 목록 ID를 찾고, 이전 번호는 현재 목록이 앞서 사용되었다면 그 ID를 기본 선택한다. 다른 이전 목록은 마지막 항목 문단과 텍스트를 표시하는 목록에서 고른다. 글머리표의 ID는 별도 테이블이므로 번호 목록 후보에 넣지 않는다.

이어쓰기는 기존 정의와 문단 수준을 보존하고 불필요한 정의를 만들지 않는다. 새 목록은 별도 정의를 snapshot 명령 안에서 만들고 지정 수준만 시작 번호를 설정한다. 다른 목록의 상위 카운터를 새 ID에 상속하지 않는다. 번호 해제도 저장된 본문 범위에 적용한다. 정의 생성·문단 변경·undo/redo 및 적용 도중 실패의 rollback이 한 명령에 속한다. 무변경 확인은 redo를 보존한다. 문서/정의/대상 변경, 잘못된 이전 목록 ID·모드·시작 번호는 무변경 거절한다.

엔진 getter는 새 목록의 실제 수준 시작 번호를 반환하며, 쪽·주석·그림 등의 NewNumber 컨트롤과 글머리표를 문단 번호 재시작으로 오인하지 않는다. 저장되지 않는 IR numbering_restart를 연결하는 방법은 사용하지 않았다. 기존 번호 정의 ID·ParaShape의 ID/수준·시작 번호 직렬화로 HWP/HWPX 양쪽을 지원한다.

## 검증

- 실제 NumberingDialog 본문 구성·라디오/시작 번호/이전 목록 입력 리스너·onConfirm, format 명령, InputHandler 메서드/executeOperation, CommandHistory와 WASM: 20경우. 두 실패의 3번 유지, 앞/이전/새 시작5, 다른 목록·일반 문단·글머리표 개입, 다단계, 이전 목록 명시 선택, 선택 범위/번호 해제, 대화상자 중 커서 이동, 중간 삽입/삭제를 포함한다.
- undo52/redo51, 무변경 거절85(대화상자 이후 텍스트·대상 속성·앞 목록·정의·문단 수 변경5 포함), no-op5(redo 보존 포함), 중간 구조 편집2, 두 번째 문단 적용 실패 주입 rollback1. 명령 전/후 속성·정의·전체 SVG·HWPX 바이트를 대조했다.
- HWP/HWPX 저장재열기44(중간 삽입/삭제 저장4 포함). 표시 번호와 모든 조회 문단 속성을 검사했다. 저장 파일44개를 별도 Native 엔진으로 열어 정의·수준 시작 번호, 표시·속성, 글자 서식·스타일·주석 번호/참조를 확인했다. 기존 blank 기본값의 포맷별 차이를 제거하려고 편집 전 합성 blank를 HWPX로 한 번 저장·적재한다. 검증 시 조회 속성을 임의로 정규화하지 않는다. Native/JS 숫자의 160.0/160은 동일 수치로 비교한다.
- 원래 완료 기능의 Native 회귀: 스타일 전파48/재열기96/거절17, 스타일 삭제16/재열기32/거절11, 셀 수식72/재열기288/거절10, 저장 줄 회전그룹 해제108/재열기216/거절14, nextStyle Enter162/재열기324/거절126 통과. 회전 입력은 원본 QA fixture를 읽기만 했다.
- WASM/UI 기존 회귀7개: 각주 글자36, note 문단40와 캐럿12, note 예약 입력·조합·수명, 중첩 문단108, 모양복사30, 검색408, 표 치환24 통과. TS와 Vite, Native/WASM Clippy `-D warnings` 통과.

최종 fresh release WASM `3efa6005031ca8606848c7b48e75894411afe7ecadf7a7b61ca521d0816ffed3`. 엔진 src868개 해시와 빌드 proof가 일치하고 Vite 안의 WASM도 동일하다. Rust1.93.1/wasm-bindgen0.2.127, 기존 Cargo home/target을 재사용했다. debug0/incrementaloff/jobs2, target 최대3,036,266,496바이트로 3GiB 이하를 지켰다.

## 범위와 다음 확인

이 수정의 UI 경로는 한 구역 안 본문 번호 대화상자이다. 셀·중첩 셀·머리말·각주 번호 대화상자와 기존 toolbar applyNumbering/toggleNumbering의 목록 정책 확장은 후속 범위다. 기존 번호/개요 문단의 명시 ID와 수준을 사용하며 문서 전체 목록 모델을 새로 만들지 않는다. 저장 속성의 numberingRestartMode는 앞선 ID 배치에서 추론하므로 같은 ID 연속 문단에서 “이전”을 선택해도 조회 모드는 “앞”(0)일 수 있다. 다른 문단의 저장 모양/참조는 그대로여도 앞 문단 번호 정책 변경에 따라 이 추론값은 달라질 수 있다.

DOM/ModalDialog, 커서/문서 세대와 화면 refresh는 검증 adapter이다. 실제 브라우저 배치·Mac GUI·물리 IME·Linux를 검증하지 않았다. dev7 Electron은 Node 모드로만 사용했다. 새 Mac 앱 패키징·서명·정상 실행·공개 push/release는 수행하지 않았다. Node/Cargo/Vite 검증 세션은 종료했다.

다음은 Mac GUI에서 이전 목록 선택과 시작5, 다단계/선택 범위·번호 해제, undo/redo, HWP/HWPX 저장재열기를 확인하고 실제 HWP의 여러 목록·개요 자료를 비교하는 일이다. 개발 후보 앱 통합은 별도 범위로 남긴다. 원본 문서·기본 앱·기존 dev3/공개 beta2/dev7을 보존했다. dev6/dev5/BetaNext/dev7 ASAR4개 보호 해시가 일치한다. 허용 fixture11 검증/복원0/blocked3 유지. 전체 library 검사 재시도·누락 fixture 복원/대체/skip은 하지 않았다.

## 재실행

`node`는 Node24(dev7 Electron Node 모드 포함)이다. 저장물은 새 출력 폴더를 사용한다.

```sh
node scripts/check-numbering-continuation.mjs pkg OUTPUT_UI
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example numbering_continuation_check -- OUTPUT_UI/manifest.json OUTPUT_NATIVE
```

기존 target을 CARGO_TARGET_DIR로 지정하고 CARGO_PROFILE_DEV_DEBUG=0, CARGO_INCREMENTAL=0, CARGO_BUILD_JOBS=2를 사용한다. fresh WASM은 기존 toolchain/target으로 offline locked release lib만 빌드한 뒤 wasm-bindgen web 바인딩을 생성한다. 전체 library tests는 실행하지 않는다. UI 입력 합성/실패 주입/저장·속성 비교는 `scripts/check-numbering-continuation.mjs`, Native 참조 대조는 `engine/examples/numbering_continuation_check.rs`가 담당한다.
