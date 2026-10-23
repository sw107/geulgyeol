# 합성 입력 E2E 진입점 복구

main `55d03a9032fb12f0d2d7c71750b9ddd2cdc3f1b5`에는 npm E2E 명령이 가리키는 진입점이 빠져 있었다. 이번 복구는 외부 문서 없이 실행 가능한 두 테스트와 그 실행에 필요한 코드로 제한한다. 제품 코드, SDK, 기본 Studio 테스트 검색 명령은 변경하지 않는다.

## 실행

기존 개발 의존성, 생성된 `pkg/rhwp.js`·`pkg/rhwp_bg.wasm`, 설치된 Chrome이 필요하다. Chrome을 내려받거나 의존성을 설치하는 스크립트는 포함하지 않는다. Mac/Linux 자동 탐색이 맞지 않으면 `CHROME_PATH`로 실행 파일을 지정한다.

```sh
cd rhwp-studio
node e2e/run-with-vite.mjs --npm e2e:toolbox-visibility
node e2e/run-with-vite.mjs --npm e2e:automation
```

각 실행은 사용 가능한 loopback 포트의 Vite 서버와 독립 임시 프로필의 headless Chrome을 사용하고 종료한다. 기본값으로 기존 사용자 Chrome에 연결하지 않으며 브라우저 sandbox를 해제하지 않는다. 명시적인 `--mode=host`는 `CHROME_CDP`도 지정해야 한다. 기본 보고서·스크린샷·Vite 캐시는 Git에서 제외되는 `.geulgyeol-local/e2e/`에 놓인다. 보고서 경로는 `E2E_OUTPUT_DIR`로 분리할 수 있다. 실패 기록을 보존하려면 실행마다 새 경로를 지정한다.

E2E 설정은 기존 beta Vite 설정의 alias와 feature flag를 사용한다. 개발용 base 경로와 캐시 위치, 지정한 SDK의 실제 경로만 추가한다. `--configLoader native`로 연결된 `node_modules`에 설정 번들을 쓰지 않는다. 공유 SDK·의존성을 참조하는 실행은 독립 배포물 또는 재현 가능한 전체 빌드 검증이 아니다.

## 출처와 변경

복구 원본: RHWP commit [`f1f9c6ae58344ee9368996d3543f76b9345cf227`](https://github.com/edwardkim/rhwp/tree/f1f9c6ae58344ee9368996d3543f76b9345cf227/rhwp-studio/e2e), © 2025–2026 Edward Kim. 원본 프로젝트 코드의 [MIT 고지](../../LICENSE)를 유지한다. 외부 HWP/HWPX·이미지·폰트 fixture와 E2E corpus는 복원하지 않았다. PR #96의 외부 문서 권리 보류는 그대로다.

| 파일 (`rhwp-studio/e2e/`) | 원본 Git blob | 글결 조정 |
|---|---|---|
| `toolbox-visibility.test.mjs` | `735c3c6916b9159d12810eb6218e802d84ebc36c` | 원문 그대로, assertion 14개 유지 |
| `automation-commands.test.mjs` | `d7e5d68d235ac7d235a413588ecf822ff284daf0` | 고정 화면 좌표 대신 새 문서의 편집기 포커스 사용, 기존 23개 assertion 유지 및 실제 입력 확인 1개 추가 |
| `helpers.mjs` | `8b355450b55c9c47898bc308a41898854547003c` | headless 기본값, Mac Chrome 탐색, sandbox 기본값 유지, 실패/0 assertion 처리와 소유 브라우저 정리 |
| `report-generator.mjs` | `20bed112b325d89c1cd37dba3c8816eba4ebea73` | 실행별 보고서 디렉터리에서 스크린샷 읽기 |
| `vite-server.mjs` | `b1dea785ad4176efe6568e2a9b9041f50f896307` | 글결 E2E 설정과 작업별 로그 경로 사용 |
| `run-with-vite.mjs` | `3dc859548ab314b1c9b78f0564bb5358e8894133` | 중단 신호를 자신이 시작한 테스트에 전달하고 서버 정리 |

`vite.config.mjs`와 `tests/e2e-harness.test.mjs`는 복구 실행 계약을 위한 새 코드다. harness의 6개 단위 검사는 실제 브라우저를 실행하지 않고 시작/페이지/보고서 실패, assertion 실패, 0 assertion, 정상 종료의 자원 정리를 확인한다. PR #104의 두 테스트 묶음 누락 방지 검사는 변경하지 않았다.

## 실제 검증과 한계

2026-10-23 UTC, Mac의 별도 headless Chrome 및 현재 Studio 소스에서 확인했다.

- 도구 상자: **14 pass / 0 fail**, 설정 없는 시작, 버튼·메뉴·Ctrl+F1 공유 상태, 설정 저장·리로드, 숨김 첫 프레임.
- 자동화: **24 pass / 0 fail**, 새 합성 빈 문서, `자동화` 입력, 실제 선택, 명령/메뉴 질의, 거절 사유, 대화상자 허용, 확장 명령 등록·회수.
- `npm --prefix rhwp-studio test`: **232 pass / 0 fail / 0 skip**. 추가 harness 6개와 기존 검색 보호 6개 포함.
- 실행 명령이 없는 Vite runner는 **exit 2**. 실제 초기화/선택 assertion 실패 실행들은 **exit 1**을 반환했으며 실패 증거를 보존했다.
- 초기 SDK 경로 403은 E2E 설정에서 해결했다. 초기 고정 좌표 클릭 후 빈 텍스트로 발생한 선택 실패는 편집기 포커스 준비와 입력 확인으로 해결했다. 제품의 선택 assertion은 제거하지 않았다.
- 재사용한 WASM SHA-256: `918c9c7dc584e4bdf28a8afa42fce062a077d944744d58bb4c37de74d559f697`. main에서 새로 컴파일한 엔진이라는 주장은 하지 않는다. 빌드·의존성 복제·사용자 프로필 수정 없음.
- 실행 중 관측한 최소 여유 공간 **16,555,438,080 bytes**, 하한 **16,374,562,816 bytes**. 이번 실행에만 해당하는 관측치이며 다른 실행의 공간 보장은 아니다.

기존 inventory의 **57개 진입점 중 3개**(테스트 2개와 Vite runner), **4개 helper 중 3개**만 복구했다. 나머지 **54개 진입점과 renderer-baseline-contract helper 1개는 미복구·미실행**이다. 일부는 권리 미확인 외부 fixture·manifest·추가 runtime 입력이 필요하고, 합성 입력을 쓰는 다른 후보도 제품 호환성 검토가 남아 있다. 이를 skip 또는 성공으로 집계하지 않는다. 현재 두 smoke로 전체 E2E, renderer 비교, 파일 저장/재열기, 물리 한글 IME, 패키지 앱, 전체 Rust 또는 CI 통과를 주장하지 않는다.
