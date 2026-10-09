# 표 바깥 여백 조회·편집·저장

2026-10-09, 기준 main `2660485315ff34c652e66438c29212ed6162db78`, 개발 브랜치 `dev/table-outer-margins`. 기존 공개 beta.2 앱·ZIP·태그·릴리스는 그대로 보존한다.

HWPX XML의 바깥 여백 283이 getter에서는 0으로 보이고 명시 변경도 무시되는 결함을 기존 엔진과 실제 Mac Electron에서 재현했다. HWP 입력은 getter와 raw만 변경되어 HWPX 저장 시 이전 283으로 돌아갔다. 이제 getter는 존재하는 raw 필드를 각각 우선하며 없는 필드는 typed Table 값을 사용한다. 명시 편집은 Table와 common.margin 양쪽을 갱신하고 존재하는 raw 필드만 덧쓴다. raw를 임의 확장하지 않는다. 여백 같은 부분 변경이 HWPX의 풍부한 common.attr/원래 raw flags를 덮지 않도록 실제 플래그 입력이 있을 때만 갱신한다.

속성 대화상자의 0.1mm 표시를 그대로 확인하면 원래 signed HWPUNIT를 보존한다. 따라서 13·0·-283·32767 같은 값이 조회/무변경 확인 때문에 반올림되지 않는다. 기존 표 크기 검사에 있던 0↔283 형식 예외도 제거했다.

검증은 기존 안전한 합성 표 6종(병합·자동 크기·혼합 직접서식 포함)과 별도 정밀 여백 fixture로 수행했다.

- 실제 Mac 공식 Electron 44.3.0: 14사례, 정확한 undo/redo 28쌍, 실제 저장 IPC→HWP/HWPX 재열기 56회. 조회·무변경 확인·취소 시 모델/전체 SVG/저장 바이트/이력 불변을 확인했다. 편집 후 다른 속성·셀/스타일/본문과 전체 SVG 왕복을 대조했다. 정상 종료 exit 0.
- 별도 Native 실행: 48편집·48 snapshot 복원 쌍·양형식 96재열기, 길이 0/24…32 raw 계약 40건. typed Table/common 일치, 필드별 raw 우선순위, signed 범위, raw 길이·다른 필드, 전체 셀·DocInfo·BinData·바깥 본문 보존 검사 통과. Electron 저장 파일 56개의 동일 바이트 getter/전체 SVG 독립 실행 대조도 통과했다. Native/WASM은 같은 엔진 계열이다.
- desktop 자동 회귀 48통과·1skip·0실패, 현재 새 엔진 선언을 사용하는 TypeScript, Clippy `--lib --example table_margin_check -D warnings`, WASM release 빌드, 별도 생산 Vite 빌드 통과. 생산 JS에는 QA 핸들 노출이 없다.

실제 Electron은 현재 host/preload/SDK와 새 Studio를 별도 QA runtime/profile에서 실행했다. 선택/읽기 검사에만 private 번들의 기존 핸들을 노출하고, OS 선택창 응답은 private bootstrap으로 제어했다. 속성 편집·CommandHistory·native IPC·실제 파일 쓰기는 제품 경로를 사용했다. 소유 QA 창의 background throttling을 끄고 완료 상태를 기다렸다. 앞선 QA 실패(선택자, 동일 파일 재열기 대기, stale 바이트 기대값, background 대기)는 증거와 정상 종료를 보존했으며 마지막 행렬은 전부 통과했다.

이는 새 서명 앱/설치 패키지 검증이나 수동 GUI 성공이 아니다. 공개 앱에는 미통합이다. 물리 IME·OS 선택창·클립보드·한컴 실문서·Linux는 미검증이며, 전체 Rust lib 테스트는 기존 include_bytes fixture 3개 누락으로 차단되어 standalone 검사와 구분한다. 원본·이전 QA·캐시 및 공개 앱/ZIP 보존 결과와 실행 해시는 [proof.json](proof.json)에 기록했다. 로컬 전체 증거는 `/Users/sw107/Documents/Codex/2026-10-06/task/table-outer-margin-qa`에 있다.

다음 확인은 긴 가로 표의 첫/중간/끝 fragment 편집→undo/redo→저장·재열기를 최신 Electron에서 재현하는 관문이다. 깊이2 비병합 중첩 표 열 편집은 별도 작은 구현 후보이며, 긴 세로 셀 페이지 소유권은 metric/source adapter와 실제 page frame부터 좁혀야 하는 더 큰 후속 과제다. 기존 완료 기능을 재구현하거나 테스트 수로 전체 완성률을 계산하지 않는다.

재실행: `scripts/build-electron-table-margin-qa.mjs <QA root> <fresh phase> <new engine dir>`로 private runtime을 만들고 `GEULGYEOL_MARGIN_SEEDS=<seed-manifest.json> node scripts/check-electron-table-margins.mjs <QA phase> <new engine dir>`를 실행한다. Native example은 `<output> <six-seed manifest> [Electron manifest]`를 받는다. 외부 QA fixture/엔진 경로가 필요하며 기본 앱 자산을 덮지 않는다.
