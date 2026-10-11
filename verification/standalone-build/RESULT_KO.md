# 글결 저장소 독립 빌드 검증

검증일: 2026-10-11. 엔진·데스크톱 제품 소스 기준은 main `781cc86ac5c09bcace551853212cc271162a6a41`이다. 이번 변경은 설치·빌드 경로와 검증 도구이며 제품의 `baram.js`, `baram.css`, `baram:*` 인터페이스는 유지한다.

## 변경

- 기존 두 `node_modules` 링크의 대상·잠금파일·도구 버전과 생성 runtime을 비공개 체크포인트에 보존했다. 링크 자체만 분리했고 외부 대상은 변경하지 않았다.
- 기존 npm 잠금파일과 공식 레지스트리로 `desktop/node_modules`, `rhwp-studio/node_modules` 실제 디렉터리를 설치했다. Electron 공식 `install.js`로 Mac 바이너리를 확보했다.
- Rust 1.93.1과 wasm-bindgen CLI 0.2.127을 `.geulgyeol-tools`에 설치했다. 공식 rustup 다운로드 체크섬과 공식 wasm-bindgen 릴리스의 SHA256을 확인했다. 사용자 전역 Cargo/Rustup·셸 설정은 변경하지 않았다.
- `standalone-env.sh`가 해당 빌드 프로세스의 Rust 경로·target을 저장소 내부로 고정한다. `build.sh`는 외부 링크·버전 불일치를 검사하고 로컬 tsc/vite를 직접 사용한다.
- 독립 Mac 패키징은 최신 소스 빌드 후 기존 후보를 덮어쓰지 않는 별도 경로에 후보 한 개만 만든다. 도구·프로필·원시 증거는 Git에서 제외한다.

## 재현

Mac ARM64에서 저장소 루트를 기준으로 실행한다.

```sh
bash scripts/setup-standalone.sh
bash scripts/build.sh
npm --prefix desktop test
node --test scripts/standalone-install.test.mjs
bash scripts/package-standalone-mac.sh
node scripts/check-standalone-mac.mjs .geulgyeol-local/fresh-mac-check
```

설치 스크립트는 외부 `node_modules` 링크나 외부 Rust 도구 링크를 발견하면 설치 전에 거절한다. 기존 링크는 대상 정보를 보존한 뒤 별도로 분리해야 한다. 패키징 스크립트는 기존 `dist/GeulgyeolIndependent-darwin-arm64/GeulgyeolIndependent.app`을 덮어쓰지 않는다. 각 실행은 저장 공간을 별도로 확인해야 한다. 이 검증에서는 정상 7GiB·실패 진단 1GiB, 여유 공간 하한 16,374,562,816바이트를 감시했다.

## 확인 결과

- Node 22.18.0, npm 10.9.3, Electron 44.3.0, Rust/Cargo 1.93.1, wasm-bindgen 0.2.127. 두 Node 디렉터리와 Rust 도구 트리에서 외부 symlink 0개.
- 엔진 release WASM 빌드, TypeScript 검사, 제품 UI 빌드 성공. 마지막 설정으로 재빌드한 WASM도 동일했다.
- 데스크톱 검사 49개 통과, 실패 0, 선택 외부 레이아웃 입력이 없어 1개 건너뜀. 외부 설치 대상 보존 회귀 검사 2개 통과.
- 후보의 실행파일·app.asar·전용 프로필 경로를 실제 실행 중 확인했다. 런타임 77개 파일이 마지막 빌드와 바이트 단위로 일치했다. package.json은 패키저가 제거하는 private/scripts/devDependencies를 제외한 메타데이터가 일치했다.
- 실제 Electron이 로드한 WASM SHA256이 자체 빌드와 일치했다. 한글·영문·`é`의 HWP/HWPX 바이트를 전용 증거 디렉터리에 기록하고 공개 호스트 API로 재열어 저장된 Unicode 본문 보존을 확인했다. 제품 app.quit 경로로 정상 종료했다(exit 0).
- 네이티브 대화상자 대체나 개발용 renderer handle을 넣지 않았다. OS 파일 선택기·실물 IME·프린터·Linux 실행은 이번 검증 범위에 포함하지 않는다.

## 생성 파일과 실패 증거

이전 생성 파일은 Git 제외 파일이며 빌드 소스 SHA를 식별하는 신뢰할 수 있는 영수증이 없었다. 서로 다른 기존 WASM의 SHA를 추측으로 소스 커밋에 연결하지 않고 복사 보존했다.

| 파일 상태 | SHA256 |
|---|---|
| 이전 pkg | `015e64b941e60f85fb10a86810aaef0909cd4a0f8de3992246b49c13d2a262c7` |
| 이전 desktop | `ccac2d483f32fdfeea8dc717bf8f3767b91e7301a1b0f63b3586d77261b3c1d8` |
| 새 pkg·desktop·실제 로드 WASM | `ac622053d7e8fa16d3474f8c3c9a4b252e4d735fa6e4d132884ed5b7885ffc69` |
| 검증 후보 app.asar | `95d9c3296885e17dc9b9552f44bf0259c29b45bff2eead2659a2747a6fcaef25` |

기존 생성 WASM을 사용한 검사 3개 실패는 새 빌드로 해소됐다. 최초 경로 검사에서는 내부 Rust proxy를 잘못 거절한 조건을 수정했다. 초기 Mac 검증은 CP949 계약의 `getTextFileText` 숫자 entity 결과를 원문과 비교한 검증 오류였다. 저장된 Unicode 문단 비교로 수정했고 원문 `é`도 보존됨을 확인했다. 실패 로그·전용 프로필은 보존했으며 실패 실행의 종료를 정상 종료 성공으로 계산하지 않았다.

## 보존·공간·후속

기존 미커밋 파일 4개와 잠금/패키지 파일 6개의 SHA가 유지됐다. 이전 QA 파일 9,859개도 모두 일치했다. 인쇄 준비 체크포인트와 원본·기존 앱·공개 릴리스·복구 자료를 보존했다.

독립화 추가 사용량에는 도구, 새 target, 생성 파일 보존본, 후보, 전용 증거와 공용 캐시 증가를 포함한다. 파일 할당량과 파일시스템 여유 공간 변화를 함께 기록하고 둘 중 큰 변화에 상한을 적용했다. 이전 QA/인쇄 예산은 변경하지 않았다. 수치는 인접 proof.json에 기록한다.

정리 대상은 아직 옮기거나 삭제하지 않았다. SHA가 같은 추가 ZIP 2개와 native 예제 실행파일 39개, 총 할당량 1.731923968GB의 정확한 경로·해시·남길 사본을 비공개 cleanup-candidates.json에 기록했다. 프로세스 조회 ps는 거절되어 우회하지 않았고, 실행 여부 불명인 파일·과거 QA 재실행 참조가 있는 옛 도구 디렉터리는 보류한다. 휴지통 이동은 공간을 확보하지 않으며 APFS 할당량이 실제 회수량을 보장하지 않는다.

다음 작업은 구체 정리 목록의 판정과 보존된 Mac 인쇄·미리보기 체크포인트 재개다. 설치 스크립트의 Linux 경로 제공과 실제 Linux 검증은 별도 후속 범위다.
