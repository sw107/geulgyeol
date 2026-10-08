# 각주·미주 선택 문단 서식 구현과 검증

checkout: `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`. 기준 커밋 `8ede89e21942b24d69a6838e91ac50476ac98d3e`. 원본/기존 앱을 보존한 독립 개발 checkout이며 공개 push/release, 새 앱 제작은 없다.

## 구현

`applyParaFormatInFootnoteRange` native/WASM/Bridge API는 선택 범위 전체, 각 문단의 스타일·글자/글꼴·탭/테두리·번호 참조 및 지원 속성을 변경 전에 검사한다. 자동번호가 있는 일반 텍스트 문단만 지원한다. 정의 수 한도도 검사한다. 각 문단의 모양을 기반으로 생략 속성을 유지하고, 탭/테두리 변경도 자체 seed를 사용한다. 스타일·글자 run·텍스트·노트 번호/참조는 바꾸지 않는다. 기존 셀의 속성 validator는 가시성만 공유했으며 동작은 유지했다.

WASM 주소는 유한한 0..u32 정수만 허용한다. 소수·음수·NaN·Infinity·범위 초과가 조용히 다른 주소로 변환되지 않도록 export 경계에서 거절한다. Native는 typed usize 주소를 검사한다. 대화상자는 열 때 저장한 note/문단/문자 범위를 사용하고, 다른 note 문맥이면 적용하지 않는다. 같은 note 안에서 커서가 움직이거나 선택이 풀려도 원래 범위를 적용한다.

현재 `InputHandler.executeOperation`과 실제 `CommandHistory`의 `SubmodeSelectionSnapshotCommand`를 사용한다. undo/redo는 노트 문맥·선택/캐럿 및 문서/모양 정의를 복원한다. 빈 변경·같은 서식은 이력을 만들지 않는다. 기존 캐럿 서식 경로와 선택 없는 글자 서식의 비지원 경계는 유지했다. 글자 서식과 머리말/본문/표 경로의 기능을 확장하지 않았다.

## 자동 검증 결과

| 검사 | 통과 결과 |
|---|---|
| 기준 재현 | 정상 캐럿12, 대화상자 차단12, 잘못된 다중문단 대상4, 선택 없는 입력 서식 미지원4 |
| Native | 28사례, 복원168, HWP/HWPX 재열기56, 거절600, no-op28 |
| 실제 WASM/UI·명령 라우터·History | 40사례, 복원240/선택복원240, 재열기80, 거절176, no-op48, 저장재열기 전체SVG80/80 일치 |
| 기존 캐럿 대조군 | 최종 UI12, 별도 undo/redo24회 |
| UI 저장물 Native 확인 | 80개에서 글자 run·문단 스타일·텍스트·논리 위치·노트 종류/번호·본문 참조 보존 |
| 이전 각주 글자 서식 | UI36, 복원216, 재열기72, 거절32, no-op40, SVG72/72 일치 |
| 중첩 문단 | UI108, 복원648, 재열기216, 거절80, SVG216/216; History예산375명령/복원129 |
| 모양복사 | UI30, 복원180, 재열기60, 거절44, 반복30 |
| 검색 | 408사례/UI272, 이력복원640, 재열기2096, no-match120, SVG차이0 |
| 표 치환 | 24사례, 복원170, 재열기82, 거절4, 레이아웃차이0 |
| 빌드 | TypeScript/Vite 웹 빌드, native/WASM Clippy `-D warnings` 통과 |

Native는 각주/미주 × ASCII/Unicode, 혼합 글자 run·다른 문단 스타일·서로 다른 여백/들여쓰기·빈 중간 문단을 사용했다. 전체 모델 보존 비교는 대상 문단의 모양 ID/줄 캐시와 새 정의만 정규화한다. 개체가 있는 뒤 문단·손상된 스타일/모양/탭/번호/테두리 참조를 포함한 요청도 앞 문단이나 정의를 바꾸지 않는다. UI 실패 요청은 모든 대상/이웃/body 속성·SVG 및 HWPX 바이트 무변경을 확인했다.

UI는 실제 현재 Bridge/InputHandler/format commands, `executeOperation`, 선택 복원 메서드 및 CommandHistory를 실행한다. DOM·화면 refresh·geometry/cursor 상태는 adapter이며 ParaShapeDialog DOM을 mock했다. 물리 클릭/선택 및 대화상자 입력칸 단위 변환을 GUI에서 검증한 것은 아니다. 단위는 기존 engine getter와 raw setter 규약을 그대로 사용한다.

## 보존 및 미검증

최종 fresh WASM SHA256: `657d4b4a3949813d6d3c366a2ca1245c7c5e9d93dba34423db738419013af1e9`. 엔진 소스가 release 빌드 시점 해시와 일치하며 웹 엔진과 모든 WASM 회귀의 엔진 해시도 일치한다. Rust target 재사용, 3GiB 상한 준수. dev.6/dev.5/BetaNext ASAR 보호 해시 유지. 허용fixture11 확인, 복원0, 차단 원본3개 유지.

과거 전체 라이브러리 검사는 fixture3개 누락으로 compileexit101/runtime0이었다. 이번 전체 검사 재시도·복원·대체·skip은 없다. 막힌 파일은 `3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`다.

실제 Mac GUI·물리 IME·Linux 및 새 앱 패키징은 미검증이다. 기존 dev.6 Electron은 Node 모드로만 사용했고 보안/서명/권한은 변경하지 않았다. Node 모드의 `task_name_for_pid` 경고는 일부 실행 로그에 있으며 성공한 자동 검사를 GUI/서명 성공으로 해석하지 않는다.

다음 확인은 실제 Mac GUI에서 note 선택·툴바/대화상자 조회와 적용·undo/redo·저장재열기 및 큰 문서 snapshot 메모리/반응성이다. 선택 없는 다음 입력 글자 서식과 개체/필드 문단 확장은 후속 범위다. 원시 증거는 인접 `../note-paragraph-qa`에 있고 결과 요약/소스·보호 해시는 `proof.json`에 담았다.

## 재현 명령

Rust1.93.1, 기존 Cargo home/target, debug0/incrementaloff/jobs2를 사용한다. `node`는 Node24(Electron Node 모드 포함)를 뜻한다. fresh WASM release 후 wasm-bindgen0.2.127 web bindings를 `pkg`에 생성한다.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example note_paragraph_format_check -- ../note-paragraph-qa/behavior/native
node scripts/check-note-paragraph-wasm.mjs pkg ../note-paragraph-qa/behavior/native ../note-paragraph-qa/ui
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example note_paragraph_format_check -- --verify-ui ../note-paragraph-qa/ui/export-manifest.json ../note-paragraph-qa/behavior/ui-saved
node scripts/check-note-paragraph-gap.mjs ../note-paragraph-qa/baseline/engine ../footnote-char-qa/behavior/native ../note-paragraph-qa/baseline/repro ../note-paragraph-qa/baseline
```

마지막 명령은 보존한 기준 소스/엔진용이다. 최신 소스로 차단 재현을 실행하지 않는다. 전체 라이브러리 검사나 fixture 복원을 이 명령에 추가하지 않는다.
