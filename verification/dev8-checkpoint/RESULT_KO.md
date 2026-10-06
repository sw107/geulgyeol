# dev8 통합 Mac 후보 검증

- 새 후보 하나: `../dev8-checkpoint-qa/GeulgyeolDev8.app`, `0.4.4-dev.8`, `org.geulgyeol.dev.checkpoint8`. ZIP 없음. 기존 dev7/dev6/DevEnter/BetaNext ASAR 및 연결된 `pkg` 해시 보존.
- 엔진 소스 기준 `a59a13ca5482f83f652e9c98e0231ff3e1bf037f`. WASM SHA256 `592806b2b8f8c3e0f3736512bc17d72e8c919bdb03c71135490957f5f84b4fe1`. 이전 검증 빌드의 엔진 소스 1,141개와 현재 소스를 대조했다. Rust 재빌드 없음.
- 빌드/패키징/검증 도구에 선택적인 엔진 디렉터리와 원본 앱 해시를 받도록 최소 수정했다. 기본 경로는 기존 `pkg`를 유지한다. 후보 DTS로 TypeScript 검사 후 후보 WASM alias로 Studio를 새 빌드했다. 설치된 의존성과 dev7 Electron 44.3.0 arm64 런타임을 재사용했다.
- 새 Vite 자산 전부, 별도 bindings 4개, 번들 내 hashed WASM, ASAR 각 파일/블록/header 무결성, Helper 4개 식별자, 프로필 격리, 번들 내부 symlink를 검증했다. 현재 desktop 실행 자산과 일치한다. 원본 package-lock은 재사용 런타임의 자료로 보존했다.
- `codesign --verify --deep --strict` 통과, ad-hoc 서명. Developer ID/공증은 제공하지 않는다.

## 패키지 엔진 검사

새 앱의 Node 24.20.0에서 패키지 bindings를 초기화하고 **현재 실제 UI 명령/다이얼로그/입력 처리/CommandHistory**를 사용했다. DOM/커서 기하/화면 갱신은 어댑터이며 실제 GUI 성공을 의미하지 않는다.

| 검사 | 결과 |
|---|---|
| ClickHere 삽입·직접 입력·값 교체·이동·제거, 각주 앵커/서식 보존 | 저장재열기 54 + 별도 이전 결함 4, undo/redo 각 24, 거절 14, 셀 회귀 6 |
| 값 교체 원자성 | 정상 10, Snapshot undo/redo 10쌍, 저장재열기 20, 비지원 18건 모두 무변경 거절 |
| 본문 번호 | 20 사례, 저장재열기 44, undo 52 / redo 51, 거절 85, 무변경 5, rollback 1 |
| 셀·중첩 셀 번호 | 78 사례, 저장재열기 156, undo 210 / redo 204, 거절 258, 무변경 18, rollback 6 |

전부 통과. undo/redo 수가 다른 항목은 기존 하니스의 취소/rollback 검사까지 포함한다. HWP/HWPX 두 형식을 재열어 값·서식·번호·필드 참조를 비교했다. 합계 재열기 278회. 하니스별 세부 증거는 후보 디렉터리의 각 `proof.json`에 있다. 기존 빈 BorderFill 기본값 차이는 정상 fixture를 **편집 전에** 명시적으로 정규화하며 실제 변경 비교를 필터링하지 않는다.

## Mac 프로세스 검사와 한계

sandbox 실행은 로컬 서버를 열지 못하고 exit -6이었다. 후보에 한정한 승인된 도구 실행으로 재검사하여 버전 HTML, 신규 JS/WASM 자산 해시 전부, 로컬 서버 응답을 확인했다. AppleScript quit exit 0 및 앱 exit 0, 본체/Helper 잔류 0개. Node 엔진 초기화와 프로세스/서빙/종료 검사이며 실제 renderer 편집·GUI·물리 IME는 미검증이다.

인접한 빈 필드 경계로 값을 비우는 경우는 무변경 거절 유지. 세로쓰기 셀의 긴 내용 pagination은 비지원 상태. Linux는 이번 Mac 통합에서 재검사하지 않았다. 전체 Rust library 테스트는 기존 누락 include_bytes fixture 3개로 차단된 상태이며 복원/대체/검사 약화 없음.

추가 사용량 약 383.3MiB, 1GiB 한도 이하. Cargo target 3.103GiB로 변동 없고 4GiB 이하, 실제 여유 약 23.0GiB로 10GiB 이상. 캐시 삭제/설치/대형 복제 없음. 공개 push/release 및 보안·계정·인증서·원격 권한 변경 없음.

## 다음 작업 제안 하나 — 이번에 구현하지 않음

**이름 붙은 셀 전체 값 교체의 내부 필드 참조 보호.** `setFieldValueByName('virtual-cell', '새값🙂')`가 `set_cell_field_text` 경로를 사용하면 같은 셀 첫 문단의 빈 ClickHere `inner` 필드가 새 셀 값 전체를 흡수한다. 후보 엔진에서 빈 값 `''` → `'새값🙂'` 변화와 HWP/HWPX 재열기에서도 같은 결과를 재현했다. 두 저장 loss report count는 0이므로 자동 손실 보고도 드러내지 못한다. `next-gap-virtual-cell.json` / `probe-next-gap.mjs`가 증거다. 다음에는 이 별도 경로에 소유권 preflight와 무변경 거절을 적용하는 작업을 제안한다. 이번 후보에는 수정하지 않았다.

## 증거 경로

`../dev8-checkpoint-qa`: source-freeze.json, package-build.json, package-verification.json, signature*.log, runtime.json, basic-launch-proof.json, process-cleanup.json, 각 편집 검사 proof.json, next-gap-virtual-cell.json. 저장된 원본 검증 문서는 읽기만 했으며 새 재열기 문서는 이 후보 디렉터리에만 생성했다. 전체 핵심 증거 사본은 `verification/dev8-checkpoint/proof.json`.
