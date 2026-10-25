# 합성 본문 편집 E2E 복구

기준 main은 `7db816a5e1fd76a29fce20433a38a290abcd8aac`(#106 병합)이다. 기존 npm 명령에서 누락됐던 `text-flow.test.mjs`와 `page-break-caret-reveal.test.mjs` 두 진입점만 복구했다. 제품 코드, 공용 helper/runner, 테스트 검색·집계, package scripts는 변경하지 않았다.

## 실행 및 검사 범위

기존 Node 22.18 이상·Studio 의존성·WASM SDK와 Chrome이 필요하다. [E2E 실행 계약](e2e-smoke-recovery.md)의 독립 headless 프로필 및 Vite runner를 사용한다. 설치·빌드는 이 명령에 포함되지 않는다.

```sh
cd rhwp-studio
node e2e/run-with-vite.mjs --npm e2e
npm run e2e:page-break-caret
```

`CHROME_PATH`로 기존 Chrome을 지정하고, 실행마다 다른 `E2E_OUTPUT_DIR`로 실패 증거를 보존할 수 있다. Chrome은 기본 sandbox를 사용하며 사용자 브라우저에 연결하지 않는다.

- 텍스트 흐름: 실제 키 입력, 자동 줄바꿈의 조판 줄 수, Enter 분리, 62개 문단을 통한 자동 쪽 넘김과 본문 순서, Home·Backspace 병합을 확인한다. 빈 문자열도 통과시키던 원본 단언을 정확한 문자열 비교로 바꾸고, 문단 수와 병합 본문을 함께 확인한다.
- 쪽 나누기: Cmd+Enter 후 문서·가상 화면의 2쪽 전환, 커서의 새 문단/쪽 위치, 캐럿 DOM 표시·좌표·viewport 여백, 새 쪽에 이어 입력하는 흐름을 확인한다. 원본 7개 단언을 유지하고 입력 전후 및 캐럿 표시 확인 3개를 추가했다.

테스트 시작 시 소유한 임시 브라우저 프로필에 스킨 선택 완료 설정을 넣고 새 빈 문서를 만든다. 커서 초기 배치·포커스와 배율은 setup API를 사용한다. 검증 대상 입력·Enter·Home·Backspace·Cmd+Enter는 Puppeteer 키보드 경로를 사용하며, WASM을 통한 본문 변조는 하지 않는다. 실제 물리 한글 IME 또는 새 문서 버튼 UI 검증은 아니다.

## 출처와 권리

RHWP upstream commit [`f1f9c6ae58344ee9368996d3543f76b9345cf227`](https://github.com/edwardkim/rhwp/tree/f1f9c6ae58344ee9368996d3543f76b9345cf227/rhwp-studio/e2e), © 2025–2026 Edward Kim, [MIT](../../LICENSE)의 로컬 Git 객체에서 복원했다.

| 파일 | 원본 Git blob | 조정 |
|---|---|---|
| `text-flow.test.mjs` | `6905c7921fbb2986c0e93d852f39ced9f8eb12c2` | 초기화·포커스 준비, 빈 문자열 성공 제거, 줄바꿈/문단/본문 보존 단언 강화, 합성 60줄 |
| `page-break-caret-reveal.test.mjs` | `84728ccca6d51736e0805b2d18d9fb50ef28e027` | 초기화·포커스 준비, 입력 전후·실제 캐럿 DOM 표시 확인 |

두 테스트 모두 새 빈 문서와 코드에 있는 합성 텍스트만 사용한다. 외부 문서·이미지·폰트 fixture를 복원하거나 취득하지 않았다. PR #96의 권리 보류를 유지한다.

## 2026-10-24 실제 검사

Mac의 기존 Chrome을 독립 headless 모드로 실행했다. 각 실행은 자체 Vite·브라우저를 종료했고 하한 16,374,562,816 bytes를 감시했다. 이번 baseline·수정본·결함 주입 실행의 관측 최소 여유는 39,300,325,376 bytes였다.

| 검사 | 결과 | 의미 |
|---|---|---|
| 원본 text-flow | 3 pass / 2 fail, exit 1 | 초기 본문이 빈 문자열인데 입력 확인이 통과했고, 문단 분리·쪽 넘김은 실패. 실패 증거 보존 |
| 원본 page-break | 7 pass / 0 fail, exit 0 | 원본 7개 계약 확인 |
| 보강 text-flow | 16 pass / 0 fail, exit 0 | 2쪽·62개 문단의 전체 본문 일치 및 마지막 병합 확인 |
| 보강 page-break | 10 pass / 0 fail, exit 0 | 캐럿 표시·새 쪽 이동 및 이어 입력 확인 |
| 첫 입력을 누락시킨 테스트 사본 | 11 pass / 5 fail, exit 1 | 입력/본문 보존 누락을 실제 검출 |
| 쪽 나누기 키를 누락시킨 테스트 사본 | 전제 3 pass 후 10초 대기 오류, exit 1 | 새 쪽 전환 누락을 성공으로 집계하지 않음 |
| `npm --prefix rhwp-studio test` | 240 pass / 0 fail / 0 skip, exit 0 | #104 검색 fail-fast와 #106 runner 회귀 포함 |
| 두 모듈 `node --check`, `git diff --check` | pass | 문법·공백 검사 |

결함 주입은 전용 테스트 사본에만 적용했고 PR에는 포함하지 않는다. HTML 보고서·스크린샷·실행 로그와 주입 사본은 작업 증거 경로에 보존했다. 자동 쪽 넘김 화면과 쪽 나누기 뒤 새 쪽 입력 화면도 직접 확인했다.

재사용 SDK WASM SHA-256은 `918c9c7dc584e4bdf28a8afa42fce062a077d944744d58bb4c37de74d559f697`이다. SDK·의존성은 원본 경로를 참조했고 복제·변경하거나 새 엔진을 빌드하지 않았다. 저장소의 최신 엔진을 새로 컴파일한 검증이라는 의미는 아니다.

## 남은 범위

#106 기록의 54개 미복원 진입점 중 2개를 추가했다. 같은 inventory 기준으로 **52개 진입점과 renderer-baseline-contract helper 1개는 여전히 미복원·미실행**이다. 전체 E2E, 파일 저장·재열기, renderer 비교, 실제 IME, 패키지 앱, Linux, 전체 Rust와 CI는 이번 검증 범위 밖이다. 병합·배포·권한 변경은 수행하지 않았다.
