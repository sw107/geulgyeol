# 기존 혼합 서식 그림 캡션의 원자 편집

기준 `07a3b91`에서 실제 Mac 현재 소스 화면으로 세 결함을 재현한 뒤 수정했다. (1) 기존 굵게/기울임/색/크기를 가진 글자 Delete 뒤 undo하면 기본 서식으로 복원됨, (2) 캡션 선택 교체가 빈 cell path 때문에 거절됨, (3) 자동 번호가 있는 캡션에서 Enter가 요청 위치보다 한 scalar 앞을 나눔. 원본 문서·설치 앱·이전 dev.3/후보·공개 beta.2를 보존했다.

## 구현과 지원 계약

일반 본문의 단일 떠 있는 그림, 회전0(360의 배수), Top/Bottom 캡션에 한정했다. 캡션은 텍스트와 그림 AutoNumber만 허용하며 필드·책갈피·range tag·고아 FIELD_END·잘못된 번호 위치·인라인/Left/Right는 read-only 조회에서 먼저 거절한다. 기존 번호와 그 앞 라벨은 보호한다. 같은 그림 캡션 안의 한/여러 문단 선택 교체·삭제, Backspace/Delete와 문단 경계 합침, Enter/Shift+Enter, 여러 줄 plain text와 CRLF를 처리한다. rich/빈 붙여넣기와 캡션↔본문 선택은 변경하지 않는다.

캡션 전용 InputHandler 경로가 명시적인 flat caption path로 삭제/삽입/나눔을 수행하고 한 SnapshotCommand에 묶는다. 교체 글자는 선택 시작 글자의 정확한 charShapeId를 상속한다. Enter는 현재 캡션 스타일을 상속하며 nextStyle로 전환하지 않는다. Picture 캡션의 split API만 visible scalar→논리 제어 슬롯 오프셋으로 변환했다. 기존 표/글상자 경로를 유지한다. 조합 미리보기는 원본 snapshot에서 갱신하며 확정은 한 이력, 취소/실패는 문서·선택·pending redo를 보존한다.

## 최종 검증

- **Mac 현재 소스 headed Chrome:** 실제 DOM/Canvas2D/Cursor/InputHandler/CommandHistory에서 36편집, undo/redo144쌍(각4회), HWP/HWPX144재열기, 거절·취소·실패/no-op12건 통과. 굵게/기울임/색/크기/밑줄 혼합 캡션3문서와 한글·emoji·astral 경계, 여러 문단 편집, Chrome 자동 조합2건을 포함한다. 36사례 모두 undo HWP/HWPX 바이트 및 redo 바이트가 정확했고 내용/직접 서식/참조/그림/전체 SVG를 대조했다. 브라우저 오류0. 브라우저가 받은 최종 WASM 해시도 일치했다.
- **독립 Native:** GUI 저장물144건을 독립 엔진 명령 재실행 후 비교, snapshot264쌍과 read-only 비지원 조회14건 통과. 전체 캡션 문단/스타일·typed DocInfo 참조·BinData·전체 SVG를 대조했다. DocInfo raw/provenance 캐시와 알려진 각주 헤더 끝0 padding만 정규화했다. UI 캡션 문단 속성 getter는 표 전용이므로 해당 속성 비교는 Native에서 했다.
- **기존 회귀:** 본문 plain paste, 책갈피 선택 삭제/문단 구조/저작, 캡션 삽입·속성·삭제5검사 모두 통과. WASM 저장재열기1344건과 독립 Native1344건. 이 검사는 DOM/커서/화면 어댑터를 사용한 CLI 검사이며 새 GUI 성공으로 확대하지 않는다.
- **정적 검사:** 최종 후보 WASM/Native 빌드, TypeScript `--noEmit`, Clippy lib 및 두 검증 example의 `-D warnings`, 새 Rust 파일/example rustfmt와 `git diff --check` 통과. 전체 lib unit test는 기존 fixture3개 누락으로 이번에 실행하지 않았다.

자체 Chrome 창만 기존 화면 권한으로 OS 캡처하고 직접 확인했다. [혼합 캡션 화면](/Users/sw107/Documents/Codex/2026-10-06/task/caption-text-qa/mixed-caption-current-source-mac-window.png). 물리 한국어 IME·OS Cmd+V·마우스 hit-testing·네이티브 파일/저장 대화상자·설치 Electron host IPC·한컴·Linux는 미검증이다. 자동 조합은 Chrome CDP이며 물리 IME 성공이 아니다. 새 앱/ZIP·새 target·공개 푸시/릴리스·권한/계정/인증서 변경은 없다.

## 보존·한계

보호20677파일 SHA256 변경/누락0. 새 QA 최대 약261.4MiB, 기존 공유 target 최대4.071GiB(최종3.961GiB), 실제 디스크 여유 최저19.226GiB로 한도(추가1GiB/target4.5GiB/free15GiB)를 유지했다. 이전/실패 로그와 캐시도 삭제하지 않았다. 브라우저는 finally close, 자체 서버38531에 SIGTERM 후 도구 종료143, 잔류0/포트32167닫힘을 확인했다.

이번 혼합 캡션36사례의 정확 undo 바이트 검증은 [이전 Mac 소스 검사](../mac-source-ui/RESULT_KO.md)의 HWP 메타데이터 차이3건을 해결했다는 주장이 아니다. 이전 합성 캡션 입력/본문 조합의 줄 정보 생성2건과 그림 삭제 undo의 저장 캐럿 차이1건은 그대로 별도 한계다. 이전 검사에서 HWPX·내용/서식/참조·SVG·재열기는 동일했으므로 내용 손실로 확대하지 않는다.

다음 확인은 실제 Electron 후보 통합과 물리 한국어 IME, OS 저장/붙여넣기다. 복합 참조/인라인/회전/좌우/중첩 그림 캡션은 이번 지원 범위 밖이며 별도 계약·검증이 필요하다.

## 재현 자료

QA: `/Users/sw107/Documents/Codex/2026-10-06/task/caption-text-qa`. 원본 결함 projection/log, 현재 headed UI 드라이버 `full-browser.mjs`, `prepare-fixtures.mjs`, `serve.mjs`, 저장물144개와 manifest, Native/회귀/정적 검사 로그, 자체 창 캡처, 보호/예산/종료 증거를 보존했다. 각 파일 해시와 집계는 [proof.json](proof.json)에 기록했다. 원본 후보에 쓰지 않고 이 QA의 `pkg`와 전용 캐시/Chrome 프로필을 사용한다.

```sh
python3 ../caption-text-qa/run-budgeted.py native-caption-text ../style-lint-qa/target/debug/examples/body_rectangle_width_check ../caption-text-qa --verify-caption-text
```

위 Native example의 captionRange 재실행과 비지원 참조 거절은 소스에 포함했다. Mac GUI 재검사는 보존된 QA 드라이버/공식 Vite 설정으로 localhost32167의 현재 소스와 같은 QA WASM을 연결한 후 실행한다. 보호·예산 검사를 유지하며 다른 창/프로필/클립보드에 접근하지 않는다.
