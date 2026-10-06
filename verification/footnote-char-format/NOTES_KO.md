# 각주·미주 선택 글자 서식 구현과 검증

이전 후보의 각주 모드 글자 서식 차단을 재현한 뒤 전용 getter/range formatter를 추가하고 실제 UI 명령에 연결했다. 원본·기존 앱을 보존한 독립 checkout에서 작업했다. 공개 push/release 및 새 앱 패키징은 없다.

## 구현

- `note_char_format.rs`: 범위 전체와 각 문단의 모양·스타일·글꼴·테두리 참조, 지원 속성을 변경 전에 검사한다. 자동번호가 있는 일반 텍스트만 허용한다. 기존 run마다 바꿀 속성만 덮어써 다른 직접 서식을 보존한다. 잘못된 범위·비지원 컨트롤·속성은 원자적으로 거절한다.
- 전용 WASM/Bridge getter/setter를 추가한다. 실제 툴바 굵게/기울임·크기·장평·자간과 글자 모양 대화상자는 저장한 정확한 노트 선택을 사용한다. 대화상자 조작으로 선택이 풀린 경우도 원래 범위에 적용한다. 다른 노트 문맥이면 거절한다.
- 글꼴 이름 등록은 모든 사전 검사 뒤 snapshot 안에서 수행한다. 기존 언어별 등록기를 사용하며 모든 pool에 placeholder를 추가하는 기존 동작까지 용량 검사에 반영한다. 전역 등록기 변경은 없다. 새 글꼴 정의도 undo/redo로 복원한다.
- `FootnoteSelectionSnapshot`과 검증된 Cursor 선택 복원을 추가한다. `SubmodeSelectionSnapshotCommand`/실제 `CommandHistory`를 이용한다. 빈 선택·같은 서식은 명령 이력을 남기지 않고 예약 입력 서식을 만들지 않는다. 노트 모드의 오래된 본문 범위 적용도 차단한다.

## 결과

| 검사 | 결과 |
|---|---|
| 수정 전 실제 WASM/UI 재현 | 굵게/기울임 2요청 차단, dispatch 0, HWPX·SVG 무변경 |
| 네이티브 | 각주/미주 × ASCII/Unicode 및 혼합 run 20사례, 복원104, HWP/HWPX 재열기40, 무변경 거절212 |
| 실제 WASM/UI 메서드·CommandHistory | 36사례, 이력복원216·선택복원216, 재열기72, 거절32, no-op40, 저장재열기 전체 SVG72/72 일치 |
| UI 저장물 네이티브 확인 | 72개: 노트 종류/번호·문단/스타일·텍스트/논리 위치·자동번호·본문 참조 보존 |
| 중첩 문단 회귀 | UI108, 복원648, 재열기216, 거절80, SVG216/216; History 예산375명령/복원129 |
| 모양복사 회귀 | UI30, 복원180, 재열기60, 거절44, 반복30 |
| 검색 회귀 | 408사례/UI272, 복원640, 재열기2096, no-match120, 이력 SVG차이0 |
| 표 치환 회귀 | 24사례, 복원170, 재열기82, 거절4, 레이아웃 차이0 |
| 기타 | next-style UI mock11, TypeScript, Vite 웹 빌드, native/WASM Clippy `-D warnings` 통과 |

지원 속성마다 모든 glyph를 검사해 선택 밖 서식과 선택 안의 생략 속성을 비교했다. 네이티브 전체 모델 보존 비교는 선택 문단의 수정 run/줄 캐시와 새 모양 정의만 정규화했다. 실패 요청은 모델·SVG를 비교하고 UI의 잘못된 글꼴+범위 요청은 HWPX 바이트도 비교했다. UI 저장물은 실제 formatter 출력이며 native parser로 별도 읽었다.

UI 검사는 현재 Bridge/InputHandler/format command/Cursor의 실제 메서드와 실제 CommandHistory를 실행한다. DOM·커서 상태·dispatch adapter, CharShapeDialog DOM은 mock이다. 화면 클릭·렌더러 이벤트·물리 IME 성공을 주장하지 않는다. dev.6 Electron은 Node 모드로만 사용했다.

## 빌드·보존·제약

최종 fresh WASM SHA256: `842ad64565374959aca3f1fdc688a1c2baed0db65de1c8b30501764697f71a6f`. 최종 웹 엔진 및 모든 WASM 회귀의 엔진 해시가 일치한다. 엔진 소스가 release 빌드 시점 해시와 일치한다. 기존 Rust target을 재사용했고 peak 2,808,475,648 bytes로 3 GiB 상한을 지켰다.

보호 대상 dev.6/dev.5/BetaNext ASAR 해시가 유지됐다. 허용 fixture11개 해시 확인, 복원0, 막힌 원본3개는 그대로다. 이전 전체 라이브러리 검사는 fixture 누락으로 compile exit101/runtime0이었으며 이번 전체 검사 재시도·복원·대체·skip은 하지 않았다. 차단 파일: `3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`.

이 작업의 검증 프로세스는 종료됐고 GUI 창은 띄우지 않았다. 실제 Mac GUI/물리 IME/Linux 및 새 앱 패키징은 미검증이다. 다음 확인은 실제 GUI의 각주/미주 다중·역방향 선택, 툴바/대화상자/글꼴 적용, undo/redo 선택, 저장재열기와 대형 문서 snapshot 메모리·반응성이다. 비지원 개체/필드 문단 및 선택 없는 입력 서식은 별도 확장이다.

원시 결과·저장 사본·로그는 checkout 인접 `../footnote-char-qa/`에 있다. `proof.json`은 결과 요약과 소스·보호 대상 해시를 담는다. 자동검사는 생성한 문서만 수정하며 사용자 원본 문서는 쓰지 않았다.

## 재현 명령

checkout에서 Rust 1.93.1, 기존 Cargo home/target와 `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=2`를 사용한다. 아래 `node`는 TypeScript transform을 지원하는 Node 24를 뜻한다. 이번에는 기존 dev.6 Electron의 `ELECTRON_RUN_AS_NODE=1` 런타임을 사용했다.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example footnote_char_format_check -- ../footnote-char-qa/behavior/native
node scripts/check-footnote-char-wasm.mjs pkg ../footnote-char-qa/behavior/native ../footnote-char-qa/ui
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example footnote_char_format_check -- --verify-ui ../footnote-char-qa/ui/export-manifest.json ../footnote-char-qa/behavior/ui-saved
```

최신 소스로 WASM release를 다시 생성한 뒤 `wasm-bindgen 0.2.127`의 web target bindings를 `pkg`에 생성해야 한다. 수정 전 차단 재현은 baseline 소스와 이전 `51986b3…` 엔진을 별도 사용한다. 전체 라이브러리 검사나 fixture 복원을 위 명령에 덧붙이지 않는다.
