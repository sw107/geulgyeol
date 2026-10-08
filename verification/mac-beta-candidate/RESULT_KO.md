# Mac beta.2 후보의 복구본 pruning 안전성 수정

단일 후보 **GeulgyeolBeta2.app / 0.4.4-beta.2 / Mac arm64**를 갱신했다. `main` 병합 기반은 `35fdcd0b6c0f9c648c534da8300eacb2494d9623`, 패키지 제품 소스는 `af87bf3764b0e524f459425e161ed154017fc5b3`이다. 그 이후 커밋은 QA·결과 기록이며 패키지 제품 코드와 구분한다. 공개 태그·릴리스는 만들지 않았다.

## 재현한 결함과 수정

이전 복구 손실 수정은 유지한다. 복구 로드 직후 dirty 표시, 선택 draft ID의 이어 쓰기, 복구 직후 삭제 금지, replacement put 완료 전 영속본 보존, 실제 저장·명시적 폐기 후 현재 ID만 정리, 전체 삭제 실패 오류 표시를 보존했다.

독립 검토에서 발견한 후속 P2를 수정 전 실제 패키지로 재현했다. 다른 draft12개의 `savedAt`을 미래로 둔 상태에서 현재 ID에 replacement put을 완료하면, 시간순 pruning이 방금 저장한 현재 ID를 삭제했다. renderer crash·정상 종료·재실행 후 미래 timestamp 후보만 남고 현재 최신 복구본이 사라졌다. OS 시계는 변경하지 않았으며 IndexedDB 합성 fixture의 timestamp만 조정했다.

메모리와 IndexedDB 모두 방금 영속 저장한 ID를 pruning 대상에서 제외한 뒤 시간순 정리한다. 조회는 요청 성공만으로 진행하지 않고 readonly transaction 완료를 기다린다. 모든 제거는 한 readwrite transaction에서 수행하며, 두 번째 delete API 호출이 실패해도 abort하여 먼저 발행한 삭제를 되돌린다. 현재 ID와 문서 dirty 상태는 pruning 실패에도 유지한다.

## 실제 패키지 검증

| 검사 | 결과 |
|---|---|
| 미래 timestamp12개·현재 replacement 성공 | 현재 ID 보존·가장 오래된 적격 미래 항목만 제거·한도12 유지. crash·재실행 후 최신 본문 복구, 실제 저장 후 현재 ID만 정리 |
| pruning 조회 API 실패 | replacement 완료·원래13개 유지·삭제 호출 없음·최신 본문 재복구 |
| 조회 요청 성공 뒤 readonly transaction abort | 완료 전 삭제를 시작하지 않음·13개 유지·최신 본문 재복구 |
| 두 번째 삭제 API 실패 | 미래13개+현재1개에서 첫 삭제 발행 뒤 실패. 일괄 abort로 첫 삭제도 rollback·14개 유지·최신 본문 재복구 |
| 두 번째 delete 요청 성공 뒤 transaction abort | 두 삭제 모두 rollback·14개 유지·최신 본문 재복구 |
| 이전 복구 안전성8시나리오 | 두 번째 crash·선택 삭제 실패·나중에·전체 삭제 실패/재시도·중간 draft 선택·replacement 실패/abort/성공20항목 재통과 |
| 기존 수명 주기 / 재실행 복구 / 최종 응답 경합 | 29 / 6 / 11항목 재통과 |
| 어댑터 없는 일반 기동·네이티브 정상 종료 | 새 전용 프로필·main inspector/응답 어댑터 없음. 읽기 전용 renderer CDP로 버전·엔진·clean 상태 확인. 자신이 실행한 생존 PID에만 `NSRunningApplication.terminate` 요청·exit0 |
| 데스크톱 회귀 / TypeScript / production Vite | 47통과·기존 private 검사1개 skip, TypeScript·Vite 통과 |

**현재 실제 패키지 시나리오81개와 별도 일반 기동·종료1개**를 통과했다. 현재 후보46회 실행이 모두 exit0으로 정상 종료했다. 수정 전 미래 timestamp 재현3회도 정상 종료했고 전용 QA 프로세스·포트 잔류가 없다. 테스트 수를 기능 전체 완성률로 계산하지 않는다.

실제 `.app`의 production UI·WASM·IndexedDB·IPC·파일 쓰기·재실행을 사용했다. 합성 HWP와 제어된 native 선택 응답·renderer crash·IndexedDB 오류는 QA 조건이다. 요청 성공 후 실제 transaction abort와 API 호출 실패를 구분했다. 원래 재실행 검사는 실제 autosave 타이머가 만든 draft를 사용했다. 편집은 공개 plugin API, 복구 선택은 CDP DOM 조작이다. 일반 기동은 어댑터 없이 별도 수행했다. ASAR를 테스트 중 변경하지 않았다.

## 현재 산출물·해시

- 앱: `/Users/sw107/Documents/Codex/2026-10-06/task/mac-beta2-candidate-qa/GeulgyeolBeta2.app`
- 최종 ZIP 하나: `Geulgyeol-0.4.4-beta.2-mac-arm64.zip` — 154,411,069바이트
- ZIP SHA256: `ea2a23eedf1fc1149ba70cc664046634714b598e051802261c163553056af0b4`
- ASAR SHA256: `2ab3e7ca8ce041f593b2d5687cd4e7ffe7331c9607ca0295ccf95fd59491f3b4`
- ASAR header SHA256: `8d8e5dbde058ca7ca11bdb83578267c73e7bc53e2755e920d4cd30f42550fc55`
- 번들 tree SHA256: `b20a052c48e64b6c9a8ea825e7a033fa0d0152ec4d2fc421ba000f01670824ca`
- WASM 불변: `e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45`
- bundle ID `org.geulgyeol.beta.0442`, 프로필 `GeulgyeolBeta2`. QA는 새 전용 profile root만 사용.

현재 production UI와 검증된 기존 엔진으로 같은 후보를 갱신했다. ASAR80항목의 전체·블록 해시/소스 출처, 번들279항목의 ZIP 바이트·링크·모드 대조, 실행 후 strict deep ad-hoc 서명이 통과했다. 이전 signed ZIP·ASAR·검증 명세는 `pruning-safety/pre-fix-package/`에 보존했다. 이전 ZIP SHA256은 `240d87a7e68f000e006bb06e6508e5c719303e2747fbbc269b060c681d593348`, ASAR는 `be2838d42b51a4d1c171456ce2cdf8ab2ce9a86812d0e934708ea4f296922091`이다. 새 후보 앱을 추가 복제하지 않았다. Developer ID·공증은 제공하지 않는다.

## 보존·한계·다음 확인

원본73,368개·이전 QA6,548개·기존 캐시579개가 불변이다. 변경 전 후보/검증 파일2,895개도 대조했고 후보·ZIP의 이전 바이트는 보존된 ZIP으로 확인했다. 다른 이전 증거 변경·누락은 없다. Rust target 4,690,055,168바이트는4.5 GiB 이내, 패키지/QA 1,510,821,888바이트는2 GiB 이내, 여유 41,183,907,840바이트는15 GiB 이상이다. 기본 앱·사용자 원본·기존 개발 후보를 보존했다.

**OS 선택창·물리 한글 IME·클립보드·수동 GUI·한컴 대조·Linux 런타임은 미검증이다.** 접근성 preflight는 false이며 권한 요청·설정 변경·우회는 하지 않았다. CDP/plugin 완성 문자열 입력을 물리 IME 성공으로 계산하지 않는다. 기존 한컴 Viewer는 소유를 확인하지 못해 개입하지 않았다. 이전 사용자 경로·일반 실행 증거는 역사 기록으로 보존했고 이번 실행과 분리했다. Linux 캐시 ELF/무결성 읽기 전용 검사도 Linux 실행 성공이 아니다.

다음은 부모의 미래 timestamp/pruning 실패 재검토, 실제 OS 선택창·물리 IME·한컴 독립 재열기·Linux 실행이다. 이전 BetaNext/ephemeral origin 복구본 자동 이관 부재와 고정 로컬 포트 충돌 시 시작 거절 정책을 유지한다.

## 재현·증거

`GEULGYEOL_QA_ENGINE_DIR`에 검증 엔진을 지정하고 각 실행마다 새 QA 폴더와 `files/`를 준비한다.

```sh
node scripts/check-packaged-pruning-safety.mjs "$QA_DIR" "$APP_EXECUTABLE" future-timestamps
node scripts/check-packaged-recovery-safety.mjs "$QA_DIR" "$APP_EXECUTABLE" crash-again
node scripts/check-packaged-ordinary-launch.mjs "$QA_DIR" "$APP_EXECUTABLE" e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45
```

pruning 시나리오는 `future-timestamps`, `query-failure`, `query-abort`, `delete-failure`, `delete-abort`다. ordinary 검사는 새 프로필과 어댑터 없는 실행을 사용한다. 증거 루트는 `/Users/sw107/Documents/Codex/2026-10-06/task/mac-beta2-candidate-qa/pruning-safety`이며 [proof.json](proof.json)에 항목·종료·패키지·보존 결과를 기록했다. [사용자 경로 확인](USER_PATH_CHECK_KO.md)은 수정 전 환경 한계의 역사 기록이다.
