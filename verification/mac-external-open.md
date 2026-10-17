# macOS 외부 문서 열기 요청 처리

기준 main: `482af9b0ac4840c59e279bc76d8f71fcba668719`.

macOS의 `open-file` 이벤트를 등록하지 않아 시작 전과 편집기 준비 후에
전달된 문서 요청이 모두 무시됐다. 이번 수정은 이 이벤트로 전달된 HWP/HWPX를
기존 문서 전환 절차로 연다. Finder의 파일 연결 등록이나 실제 Finder 조작을
검증했다는 뜻은 아니다.

## 제품 동작

- 단일 인스턴스 소유자가 앱 준비 전에 이벤트를 등록하고 경로만 대기열에 보관한다.
  편집기 초기화와 진행 중인 파일 작업이 끝나면 한 요청씩 처리한다.
- 기존 `approveTransition('open')`과 버전 확인을 재사용한다. 저장·버리기·취소를
  현재 문서에 확인하고, 확인 중 추가 편집은 교체를 거절한다. 취소한 요청은 재시도하지 않는다.
- 오류/도움말 대화상자 동안 다음 요청을 보류하며 닫으면 재개한다.
  빈 대기열을 확인한 뒤에는 일반 저장마다 추가 IPC나 busy 상태를 만들지 않는다.
- IPC는 신뢰하는 메인 프레임에서 이미 요청된 파일을 가져오기만 한다.
  renderer에서 임의 경로를 전달할 수 없다. 절대 경로·HWP/HWPX 확장자,
  대기 요청 32개, 일반 파일 및 실제 읽기 64 MiB 상한을 검사한다.
- 별도 원자 저장 구현과 원본 문서는 바꾸지 않는다. Mac 패키저의 필수 파일 목록에
  새 모듈을 추가했고 synthetic ASAR에서 정확한 소스 포함/로드도 검사한다.

## 이번 실행 결과

| 검사 | 실제 결과 |
|---|---|
| 수정 전 실제 Electron | 시작 전/준비 후 요청 무시 2건 재현, 정상 종료 0 |
| 새 요청 처리 단위/통합 계약 | 16개 통과 |
| 전체 desktop 회귀 | 167개 통과, 실패 0, 기존 비공개 fixture 검사 skip 1 |
| 전체 Studio TypeScript | `tsc --noEmit` 통과 |
| JS 구문·Python AST·Git 공백 | 통과 |
| 수정 후 실제 Electron 외부 열기 | 9개 흐름 통과, 정상 종료 0 |
| 기존 실제 Electron lifecycle 회귀 | 29개 흐름 통과, 정상 종료 0 |

9개 흐름은 시작 전 HWPX, 준비 후 HWP, 미저장 취소 시 전체 HWPX 바이트 보존,
열기 전 기존 편집 저장, 저장 중 들어온 요청/추가 편집 보존, 확인 중 추가 편집 거절,
잘못된 파일 뒤 오류 창을 닫기 전 후속 요청 보류, HWP/HWPX 실제 디스크 저장 후
각각 외부 요청으로 재열기다. 기존 lifecycle 회귀는 새 문서·열기·닫기, 저장 실패/취소,
추가 편집·이전 문서 세대·중복 요청 및 실제 IndexedDB 복구본 보호를 다시 검사했다.

Electron 44.3.0의 실제 BrowserWindow·production Studio·preload·등록 IPC·원자 저장을
실행했다. QA는 소유 프로세스에 `app.emit('open-file', ...)`을 주입하고 네이티브
선택/확인 응답을 제어한다. 입력은 공개 플러그인 API다. Finder/OS 선택창 직접 조작,
물리 IME, 한글 편집·저장·재열기 검증으로 확대하지 않는다. 새 제품 배포 앱은 만들지 않았다.
Studio/엔진 소스가 기존 production QA 빌드와 같음을 확인하고 같은 바이트를 재사용했으며,
새 WASM/Vite 빌드는 하지 않았다. WASM SHA256은
`d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1`이다.

초기 unit fixture의 창 API 누락, 패키저 필수 목록 누락, 샌드박스 localhost EPERM,
첫 실제 앱 QA의 HWP 형식/HWPX 확장자 설정 오류 기록도 보존한다.
후자는 저장이 올바르게 거절됐고 QA가 대기 시간 초과로 실패했다. 최종 통과와 구분한다.

## 재실행 및 근거

```sh
node --test desktop/tests/*.test.cjs
cd rhwp-studio && node node_modules/typescript/bin/tsc --noEmit
# 저장소 루트에서, 합성 파일만 있는 새로운 QA 경로와 보존한 production runtime을 지정
node scripts/check-electron-external-open.mjs NEW_PHASE_DIR fixed PINNED_PRODUCTION_RUNTIME_DIR
```

원시 근거는 저장소 밖 `external-document-open/qa/`의 `app-baseline/proof.json`,
`app-fixed-final/proof.json`, `app-lifecycle/proof.json`, `lifecycle.json`,
`unit-final.tap`, `desktop-final-complete.tap`, `typescript.log`, `delivery-freeze.json`이다.
기존 dirty checkout·원본·폰트·엔진 입력과 이전 동결 증거의 보존을 별도로 확인한다.
CI 체크 부재를 통과로 표현하지 않는다.

정품 설치 메타데이터는 Hancom Office HWP 12.30.0 (6544)이다. 현재 텍스트 실행기에는
지원되는 한글 앱 입력/화면 제어가 없으며 음성 전용 화면 읽기 도구는 사용하지 않았다.
설치 메타데이터로 라이선스 활성화·편집 가능 여부나 한글 호환성을 추정하지 않는다.
RFN 허가·폰트 교체·새 베타 배포 보류는 유지한다.
