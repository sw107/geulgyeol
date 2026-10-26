# 텍스트만 붙이기 — 선정 범위와 검증

## 구현 전 선정

- 원격 main 재확인: `6e061db3bfc5df46e2764b3da345a5465a3b773f` (PR 120 병합본). 새 독립 worktree/브랜치 `feat/paste-plain-text`에서 개발한다.
- README/현재 명령과 메뉴, 기존 QA 기록, 열린 PR/이슈를 대조했다. 일반 붙이기는 내부 복사 서식·개체, 외부 HTML/그림을 우선한다. 텍스트만 선택하는 메뉴/단축키는 없다. 날짜 삽입 기능과 별개다.
- 포함된 로드맵 `engine/mydocs/tech/agent_roadmap/atlas_r1_r200.md`는 historical 에이전트 로드맵이다. 현재 일반 UI 로드맵/AGENTS.md/.agents/skills는 저장소 Git 트리에 없으며 열린 이슈도 없다. 현재 소스와 사용자 지시에 따라 작은 기능을 선정했다. 앞서 확인한 홈 `.agents/skills`에는 이번 코드 작업에 적용되는 스킬이 없었다.
- 선택 이유: 웹/다른 문서의 내용을 붙일 때 원치 않는 서식이나 표·그림을 가져오지 않고 본문에 글만 넣는 일상적인 편집 흐름을 개선한다.
- 범위: 편집 → 텍스트만 붙이기 및 Ctrl/Cmd+Shift+V. 클립보드의 text/plain만 기존 일반 본문 텍스트 붙이기 경로에 전달한다. 여러 줄과 선택 교체는 기존 경로 그대로 사용한다. 텍스트가 없으면 선택과 문서를 유지한다. 일반 붙이기 동작은 유지한다.
- 첫 지원 대상은 일반 본문이다. 표·글상자·캡션·머리말/꼬리말·각주/미주·필드·개체/셀 선택·양식·IME 조합 중에는 명령을 비활성화하고 실행 시에도 확인한다. Electron 호스트의 기존 trusted 발신자 검사 뒤 클립보드의 텍스트만 동기적으로 읽는다. 선택 위치가 바뀔 수 있는 비동기 읽기나 브라우저 클립보드 권한을 추가하지 않는다. 호스트 reader가 없는 standalone Studio에서는 지원하지 않으며 안내를 표시하고 문서를 바꾸지 않는다.
- 제외: native 오류 경계, atomic-field-fill, 실패 입력 재현 및 후속 편집 복구, Rust 변경/광범위 회귀, SDK 변경, PR 96 자료, 설치 앱 교체·배포·삭제·새 도구 설치.

## 검증

구현 후 집중 테스트와 가능한 실제 Electron 확인 결과를 기록한다.

- 최종 소스의 `node --test desktop/tests/plain-text-paste.test.cjs`: 5 passed / 0 failed. 기존 텍스트 붙이기 경로의 여러 줄·Unicode/선택 교체, 빈 텍스트 무변경, 일반 HTML 붙이기 경로 유지, 편집 상태 제한, trusted IPC/preload 연결과 Ctrl/Cmd+Shift+V 라우팅을 VM 단위로 확인했다. 실제 Electron 검증을 뜻하지 않는다.
- TypeScript 검사와 제품 설정 `vite.geulgyeol-beta.config.mjs`의 UI production 빌드 통과. 기존 의존성·WASM을 읽어 사용했고 Rust/SDK는 변경하거나 재빌드하지 않았다.
- 실제 Electron에서는 새 메뉴 표시와 일반 HTML 서식 복사까지 확인했다. 초기 execCommand 방식은 이벤트를 전달하지 않아 호스트의 텍스트 reader 방식으로 수정했다. 이후 후보에서도 메뉴 비활성을 관찰했으므로 현재 네이티브 UI에서 붙이기 성공을 확인하지 못했다. 같은 Electron 식별자를 쓰는 여러 QA 프로세스의 UI 입력 구분 문제도 있었지만, 이것을 원인으로 확정하지 않는다.
- 마지막 확인 대상은 작업 폴더 `electron-plain-paste-final/GeulgyeolPlainPasteQA.app`의 별도 프로필 QA 창이었다. CUA `getApp` 호출이 `aborted by user`로 끝났다. 해당 UI 선택/관찰의 완료 여부는 불확실하며 재시도하지 않았다. 정상 붙이기·실행 취소/다시 실행의 실제 GUI 성공 주장은 하지 않는다.
- **병합 보류**: 새 메뉴의 네이티브 활성화와 실제 텍스트 붙이기, 실행 취소/다시 실행 확인이 남았다. Draft PR로 보존하고 실제 앱 확인 전 병합하지 않는다. 코드 검토와 VM 연결 테스트는 실제 GUI 확인을 대체하지 않는다. 기존 차단 작업 조사는 재개하지 않았다.
- `electron-plain-paste/`, `electron-plain-paste-v2/`, `electron-plain-paste-final/`에 빌드·테스트·중간 GUI 증거를 보관한다. QA용 앱은 기존 Electron의 로컬 복사본이며 마지막 복사본의 식별자와 ad-hoc 서명만 구분했다. 원본/설치 앱과 기존 SDK는 보존했다. 설치·배포·파일 삭제는 하지 않았다. QA 프로필과 실행 중인 프로세스도 보존한다.


## 독립 코드 검토의 연결 회귀 보존

- 검토 대상 `fc9342433817edd5cb80952773f1d5d807fbd371`에서 독립 검토자는 기존 집중 테스트 5/5 및 연결 테스트 3/3을 확인했고 코드 수준의 차단 문제를 확정하지 못했다. 실제 GUI는 독립 재실행하지 않았다.
- 독립 `menu-chain.test.cjs`를 저장소 경로에 의존하지 않도록 [plain-text-paste-menu.test.cjs](../../desktop/tests/plain-text-paste-menu.test.cjs)로 추가했다. 실제 CursorState, InputHandler 가드, main getContext, 명령 정의, registry, dispatcher, MenuBar 상태 갱신을 연결한다. 본문 선택 여부는 실제 커서에서 읽으며, 허용되지 않는 상태에서 클립보드 읽기조차 실행하지 않는지 확인한다.
- 이번 실행은 변경한 테스트 파일만 `node --test desktop/tests/plain-text-paste-menu.test.cjs`로 실행해 **3 passed / 0 failed**였다. 기존 5개 테스트·TypeScript·UI 빌드·Rust·Electron GUI는 이번 후속 작업에서 재실행하지 않았다. 제품 코드나 편집 상태 제한 조건도 변경하지 않았다.
- 연결 테스트에서는 일반 본문 커서와 텍스트 선택이 활성화됐고, 문서 없음·양식·조합 중·셀·그림 선택·필드 상태에서는 차단됐다. 메뉴가 앞서 활성화됐더라도 실행 직전 상태를 다시 검사했다. 클립보드 reader의 유무는 canExecute 조건이 아니므로 호스트 reader 누락만으로 메뉴 비활성을 설명할 수 없다.
- 이 테스트의 native clipboard reader·실제 삽입 endpoint·WASM 조회·최소 메뉴 DOM·일부 입력 메서드는 대역이다. 실제 Electron의 메뉴 비활성 관찰 원인은 여전히 **미확정**이다. 사용자 중단 상태의 GUI 호출은 재시도하거나 다른 경로로 조작하지 않았다. 실제 텍스트만 붙이기와 Undo/Redo도 계속 **미검증**이며 **병합 보류**를 유지한다.
