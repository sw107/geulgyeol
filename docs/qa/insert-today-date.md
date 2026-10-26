# 오늘 날짜 넣기 — 범위 및 검증

## 구현 전 선정 (2026-10-26 UTC)

- 원격 `main`을 `git ls-remote`로 재확인: `0183f5ccb4c3adcf652d17e64c7f4c87ba0be0f2`.
- 독립 worktree: `feat/insert-today-date`. 기존 checkout과 사용자 문서는 수정하지 않는다.
- 현재 README/DEV_CHANGES_KO, 명령 등록과 입력 메뉴를 대조했다. 확대/축소·찾아가기·문자표는 이미 구현되어 있으므로 제외했다. 날짜 삽입 명령·메뉴는 없다.
- 저장소에 현재 UI 로드맵이나 AGENTS.md/.agents/skills가 없음을 Git 트리와 로컬 경로에서 확인했다. 포함된 `engine/mydocs/tech/agent_roadmap/atlas_r1_r200.md`는 2026-08-12의 historical 에이전트 로드맵이며 일반 UI의 현재 요구사항이 아니다. GitHub 열린 이슈 조회는 0건이었다. 사용자 홈 `.agents/skills`는 문서·발표·연구용으로 이번 코드 변경에 적용할 스킬이 없었다.
- 선택 이유: 보고서·공문 본문에 자주 입력하는 오늘 날짜를 별도 창 없이 넣을 수 있다. 새 엔진 기능 없이 기존 텍스트 입력과 실행 취소 경로를 이용할 수 있다.
- 범위: 입력 → 오늘 날짜 넣기. 컴퓨터의 현지 날짜를 `YYYY-MM-DD` 일반 텍스트로 삽입한다. 자동 갱신 필드가 아니다. 선택 없는 일반 본문에서만 지원하며 표·글상자·캡션·머리말/꼬리말·각주/미주·양식·개체/텍스트 선택·IME 조합 중에는 삽입하지 않는다. 날짜 한 번은 실행 취소 한 번으로 되돌린다.
- 제외: native 오류 경계, 실패 입력 재현, atomic-field-fill, 후속 실패 복구, Rust 변경/광범위 회귀, 앱 교체/배포/설치/삭제, SDK 수정 및 PR 96 자료.

## 검증

구현 후 최소 단위 테스트와 가능한 실제 Electron 확인 결과를 아래에 기록한다.

- `TZ=Pacific/Kiritimati node --test desktop/tests/today-date.test.cjs`: 4 passed / 0 failed. 윤년·현지 날짜·0 채움, snapshot 한 건과 커서 위치/포커스, 제외 상태별 무변경, 메뉴/명령 가용성을 확인했다.
- `./rhwp-studio/node_modules/.bin/tsc -p rhwp-studio`: 통과.
- 제품 설정 `vite.geulgyeol-beta.config.mjs`를 이용한 별도 디렉터리 UI production build: 통과. 기존 의존성·WASM·글꼴을 읽어 사용했으며 설치/SDK/엔진 재빌드는 하지 않았다. 기존 CanvasKit fs/path 브라우저 외부화 안내만 출력됐다.
- 실제 macOS Electron 44.3.0, 별도 userData 프로필, 계측 없는 제품 UI: 새 문서 → 입력 메뉴 → 오늘 날짜 넣기 → 화면에 `2026-10-27` 표시 → Cmd+Z 한 번으로 날짜 전체 제거 → Cmd+Shift+Z로 복원 → `X` 후속 입력 → Cmd+Z로 `X`만 제거되고 날짜 유지. 입력 포커스도 유지됐다.
- GUI 화면 증거는 작업 폴더 `electron-date/`의 `date-inserted.png`, `date-undone.png`, `date-redone.png`, `date-followup-typing.png`, `followup-undone.png`에 보관한다. 제품 소스나 사용자 원본에 포함하지 않는다. `build-date.mjs`와 `electron-date/build-proof.json`은 로컬 빌드 근거다.
- 저장/재열기, Linux, 실제 물리 한글 IME는 이번 변경에서 검증하지 않았다. Rust 테스트와 기존 차단 조사는 실행하지 않았다. 독립 검토 및 부모의 병합 조율이 남아 있다.
