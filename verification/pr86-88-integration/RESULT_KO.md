# PR86·87·88 통합 검증

공통 main `2a9c13448fdf682f169e5d4ba025135432d36fd1`에서 PR86
`17c909b81dc0d04229d23e0f829854f0527ae91f`, PR87
`51acf3e7101b134bbd1b3d47f650c55faf97f78c`, PR88
`bc4294352c5164b451ee54e2b71ae314907af3fb`를 별도 checkout의 로컬 통합
브랜치에 합쳤다. 원격 PR·main은 병합하거나 변경하지 않았다. 각 단독 PR의
독립 앱 검토 승인을 합본 승인으로 간주하지 않는다.

PR86/88의 커서 호출부 두 충돌은 PR86의 source→render owner 진입 helper와
PR88의 offset별 continuation helper를 함께 유지하도록 해결했다. 진입 helper와
`getNoteEditInfo`는 PR86과, source-addressed cursor 및 fragment 검색 메서드는
PR88과 정확히 같다. PR87의 serializer·export 명령·WASM API·bridge·write fence는
그 PR 원본과 같다. 이 동등성을 `conflict-resolution-proof.json`에 고정했다.

통합 WASM SHA256은
`4cdc2f4a0de8cf23ea0e7fbbf5d380a5c9cf4d87deaf129b5ef91730945d6379`다.
Rust 1.93.1/wasm-bindgen 0.2.127로 offline/locked 빌드와 경로 감사를 수행했다.
빌드 시점 통합 commit의 engine tree는 최종 source commit에서도 유지한다.
전체 SDK·Native 바이너리·UI bundle 해시는 `proof.json`과 동결 receipt에 있다.

## 합본에서 새로 실행한 계약

- 미주 진입: Native 98개·WASM 109개 조회 실패 0, 기존 UI entry/bridge/cursor
  메서드의 DOM 대역 진입 190회. HWPX 재열기와 잘못된 주소 거절도 유지했다.
- 렌더: 기존 18문서에 긴 미주+위험 바탕쪽 교차 입력 2개를 더한 100상태와
  보존 최소 입력 3종·15상태에서 원문·번호·선두 공백·줄 범위·기하 위반 0.
- 커서: 24문서·96상태, Native 6,558건·WASM 4,372건의 쪽·좌표·hit 역조회
  실패와 live/cold/Native 재구성 차이 0. 이전 offset10806 재현도 포함한다.
- 단독 PR88에서 막혔던 `different-widths`, `narrow-to-wide`,
  `multiple-donors`의 두 donor, `preserved-minimal-two`의 다섯 source target은
  before/성장/undo/redo × live/cold 40개 관찰에서 진입·끝 커서·hit 검사를 통과했다.
  source body와 이웃 미주를 보존하며 원래 source 주소로 긴 텍스트를 삽입했다.
- 생산 `enterNoteEditing`, 비조합 `onInput`, note command, `CommandHistory`,
  이력 context 복원, `Cursor` 메서드를 연결했다. 위 네 문서와 교차 입력 두 종의
  24상태에서 입력 10건·undo/redo 20건·커서 920건을 검증했다. textarea와 operation
  record dispatch는 대역이며 Electron trusted input·물리 IME 실행은 아니다.
- single-Even 위험 11종과 정상 HWP 6종에, 긴 미주와 위험 바탕쪽이 함께 있는
  2종을 추가했다. Native 원자적 거절 78회, raw-adapter cache 거절 13회,
  WASM raw/bridge 거절 각52회·host 거절 13회가 통과했다. hook/chooser/write/clean
  부작용 없이 내용·캐럿·이력·기존 파일을 보존하고 HWPX 대안 저장을 확인했다.
  교차 guard 입력은 생산 onInput이 저장한 grown HWPX와 byte 단위로 같다.
- 기존 미주67·물리구역65·carry45 비교를 두 런타임에서 다시 통과했다. 물리구역의
  예전 HWP30회 중 위험25회는 명시적 거절, 지원5회는 정상 재열기로 구분했다.
- Cargo check(라이브러리·6개 producer), Studio와 통합 SDK 타입 검사,
  기존 UI90·호스트/이력/복구20 테스트와 생산 UI bundle 빌드가 통과했다.

## 재현과 증거

동결 경로는 `/Users/sw107/Documents/Codex/2026-10-14/task/pr86-88-integration-20261019`다.
`reproduce.mjs`를 같은 상위 task 아래의 새 증거 폴더에 복사하고, 통합 checkout을
cwd로 두어 통합 SDK 경로를 인자로 실행한다. `run.mjs`의 고정 도구 환경과
`CARGO_TARGET_DIR`을 사용하며 모든 출력 경로는 새 경로여야 한다. 이 스크립트는
fixture 생성·Native/WASM 계약·생산 메서드 대역·위험 HWP guard·기존 회귀를 실행한다.
UI 타입/단위 검사는 `ui-checks.mjs`, 생산 bundle은 `build-ui.mjs`로 별도 고정했다.

검증기 예약 주소의 Native64/WASM32 차이, 테스트 추출에 빠진 본문 커서 helper,
PR87 거절 표시가 없는 옛 물리구역 manifest로 인한 세 중단의 원본 로그·출력을
보존했다. 예약 sentinel만 정규화했으며 일반 문단 주소나 제품 동작을 완화하지
않았다. 물리구역은 PR87에서 승인된 guard-aware manifest를 재사용했다.

## 남은 승인과 한계

**이 합본의 독립 재검토와 실제 Electron 통합 QA는 아직 수행하지 않았다.**
단독 앱 증거의 독립 검토 결과와 781개 파일을 해시로 보존했지만, 합본 앱 승인으로
대체하지 않는다. 실제 앱 담당자는 다섯 donor의 trusted 입력·이력·production IPC
저장·동일/새 프로세스 재열기와 교차 위험 HWP 거절을 새 source/SDK 조합으로 확인해야 한다.

전체 Rust unit 컴파일은 기존 누락 include 4개로 exit101이며 unit 실행 성공을
주장하지 않는다. CI 통과도 주장하지 않는다. 단독 앱 launch에는 sandbox-extension
경고 11건이 있었고, 이번 Node 대역에는 ExperimentalWarning, Vite에는 큰 chunk
경고가 남아 있다. 모든 로그가 깨끗하다는 주장이 아니다.

한글 비교·편집 라이선스 확인, 물리 IME, 모든 pointer/marker route, native chooser
UI, 서명·설치 패키지, 전체 pixel/인쇄 parity는 미검증이다. 이 통합은 기존의 개체
미주·서로 다른 단 폭·복잡한 앞 본문·HWP 상속 미지원 범위를 확장하지 않는다.
사용자 원본·기존 실패 증거를 보존하고 배포·원격 병합은 하지 않았다.
