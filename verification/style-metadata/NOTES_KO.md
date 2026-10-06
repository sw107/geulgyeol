# 스타일 추가·메타데이터 참조 검증 — 2026-10-06

스타일 이름/다음 스타일 수정과 새 스타일 추가 API가 ID를 범위 검사 없이 `u8`/`u16`으로 변환하여 잘못된 문서 참조를 만들었다. `FUNCTION_GAPS_DRAFT.md`의 다음 스타일/저장 보존 미검증 항목과 현재 소스를 비교해 이 실제 결함 하나를 후속 수정으로 선택했다. 이미 구현된 저장 줄 그룹 해제·셀 수식·스타일 삭제/전파는 새 누락으로 취급하지 않는다.

## 재현

기존 공개 `v0.4.4-beta.1`의 동일한 패키지 엔진으로 합성 문서만 사용했다. 기존 앱 파일을 변경하지 않고 Electron의 Node 모드에서 `createBlankDocument` → `createStyle`/`updateStyle` → 두 형식 export/reopen을 실행했다. 새 GUI 창은 열지 않았다. `baseline-probe.json`이 실제 스타일 목록과 손실 보고를 기록한다.

- 스타일 22개인 문서에서 `nextStyleId:250`을 추가해도 ID 22를 반환하고 존재하지 않는 다음 스타일을 그대로 저장한다.
- `nextStyleId:256`은 0으로, 수정 요청의 `nextStyleId:-1`은 255로 바뀐다. 잘못된 수정도 true를 반환하며 이름까지 먼저 바뀐다.
- `type:2`를 받아들인다. HWP에서는 2가 남고 HWPX 재열기에서는 0으로 바뀐다.
- `baseCharShapeId:65536`이 0으로 바뀌어 호출자가 지정한 기본 모양을 조용히 대체한다.
- 위 저장에서 손실 보고 count는 모두 0이다. 손실 보고가 이 결함을 막아 주지 않음을 확인했다.

## 구현

`DocumentCore::create_style_native`와 `update_style_metadata_native`에서 JSON 객체·이름의 타입/UTF-16 저장 길이·정수 참조·실제 존재 여부·지원 종류(문단 0/글자 1)를 변경 전에 검사한다. 명시한 기본 모양이 잘못되면 바탕글로 대체하지 않고 전체 요청을 거절한다. 기존 스타일 정의의 잘못된 종류/다음 스타일/모양 참조와 opaque STYLE 레코드도 변경 없이 거절한다.

스타일 ID는 0…255, 최대 256개다. ID 255와 새 스타일의 자기 다음 스타일은 유효하다. 기본 모양을 생략하면 기존대로 바탕글의 모양을 사용한다. update는 이름/영문 이름/nextStyleId만 바꾸고 문단·직접 서식·다른 스타일·언어/잠금 설정을 건드리지 않는다. 같은 메타데이터의 재요청은 raw 상태도 유지한다. 실제 이름 변경은 HWP의 STYLE raw_data 및 DocInfo raw stream을 무효화해 재저장 때 변경을 반영한다.

WASM의 기존 `createStyle`/`updateStyle`는 네이티브 구현에 위임한다. 정상 반환값과 실패 `-1`/`false` 규약은 유지했다. 기존 스타일 편집 UI가 이 실패 반환값과 snapshot rollback을 이미 처리하므로 UI/API 형식을 넓히지 않는다. 이름 변경에는 문단 참조 재색인이 필요하지 않아 알 수 없는 문단 개체 자체를 이유로 전체 문서를 거절하지 않으며, 해당 문단 상태 보존도 검사했다. 스타일 모양 전파·import/export·다음 스타일을 실제 Enter 동작에 적용하는 기능 전반까지 완료했다는 주장은 하지 않는다.

## 검증

Mac arm64/Rust 1.93.1에서 `cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example style_metadata_check -- OUTPUT_DIR`가 통과했다.

- 본문/셀, 중첩 셀, 머리말, 각주 × 문단/글자 스타일 = 정상 변경 8개.
- undo/redo 16회, HWP/HWPX 재열기 34회. 재열린 HWP를 다시 이름 변경·재저장하여 raw DocInfo 무효화도 검사한다.
- 문단/직접 서식/다른 스타일 보존, ID 255와 자기 다음 스타일 보존.
- 잘못된 JSON·타입·음수/소수·범위/존재 오류·저장 길이 초과·기존 정의 오류·opaque STYLE·257번째 추가·빈 문서의 없는 모양 등 원자 거절 48개. 매 거절에서 문서의 전체 Debug 상태와 이벤트 로그가 동일하다.
- native 기본 feature 라이브러리 및 새 예제 두 개의 strict Clippy, `wasm32-unknown-unknown` 라이브러리 strict Clippy 모두 통과(`-D warnings`).
- 수정 후 전파 48개/재열기 96회/원자 거절 17개, 삭제 16개/재열기 32회/거절 11개, 셀 수식 72개/재열기 288회/거절 10개, 그룹 해제 108개/재열기 216회/거절 14개, 이벤트 8개·타원 5개/재열기 26회 회귀 검사를 다시 통과했다.

기존 target을 재사용하고 디버그 정보/증분 출력을 끄며 jobs=2, 전체 target 한도 1.5 GiB를 유지했다. 최대 약 1.40 GiB/최종 약 1.31 GiB, 제한 중단 없음. 정확한 명령·크기·exit code·소스/로그 해시는 `proof.json`에 있다. 상세 로그와 합성 문서는 저장소 밖 `../style-lint-qa/`, baseline 재현 사본은 `../style-metadata-qa/`에 있다.

## 미검증 및 다음 확인

WASM 검사는 컴파일/정적 검사이며 새 WASM 바이너리를 실행하지 않았다. 새 Mac 앱/ZIP을 빌드하거나 새 릴리스를 만들지 않았고, 실제 GUI 편집·네이티브 저장 대화상자·물리 한글 IME·Linux 엔진 실행은 미검증이다. 사용할 수 있는 GUI 도구가 없어 다른 도구나 자동 키 입력으로 성공 처리하지 않는다. 추가 검증 창은 없다.

다음 확인은 새 개발 WASM/앱에서 정상 스타일 추가/이름 수정, 실패 요청의 UI 원자 rollback, 표·머리말·각주 전파, GUI undo/redo와 두 형식 저장·닫기·재열기, 실제 IME다. 원본 문서, 기본 앱, dev.3/dev.4, 공개 beta.2와 v0.4.4-beta.1 첨부, 원격 main을 유지한다.
