# Mac beta.2 후보의 복구 손실 수정

현재 단일 후보 **GeulgyeolBeta2.app / 0.4.4-beta.2 / Mac arm64**를 갱신했다. `main` 병합 기반은 `35fdcd0b6c0f9c648c534da8300eacb2494d9623`, 패키지에 포함된 제품 소스는 `7b250eb0948d95384ef8b7676110c1283c056f04`이다. 공개 태그·릴리스는 만들지 않았고 부모 재검토를 기다린다.

## 재현한 결함과 수정

수정 전 실제 패키지에서 두 문제를 재현했다.

- P1: 복구 직후 기존 draft가 삭제되어 영속 복구본이 0개가 됐다. 기본 idle autosave 10초 이전에 renderer를 다시 crash하고 정상 종료·재실행하니 복구 안내도 문서도 없었다.
- P2: 선택한 draft의 실제 IndexedDB delete API를 제어된 실패로 만들자 문서는 로드됐지만 dirty 표시까지 도달하지 않아 clean 상태로 남았다. draft 자체는 남았으나 종료의 저장 안내가 누락될 수 있었다.

복구 로드 성공 직후 문서를 dirty로 표시하고, 기존 draft ID를 AutosaveManager에 이어 준다. 복구 시 해당 draft를 삭제하지 않는다. 이후 자동 저장은 같은 ID에 원자적으로 put하며 transaction 완료 전까지 이전 영속본을 보존한다. 실제 파일 저장 또는 사용자가 명시적으로 승인한 폐기는 기존 수명 주기로 현재 ID만 정리한다. 선택하지 않은 draft는 그대로 둔다.

오래된 선택 draft가 보관 한도 정리의 대상일 수 있어, 저장소 pruning은 replacement put의 transaction 완료 이후로 옮겼다. 실패한 put이나 abort가 유일한 복구본을 먼저 지우지 않도록 했다. 전체 삭제 실패는 성공 안내 대신 지속 오류 안내를 보여 준다. 기본 종료 버전 검사·최종 쓰기 동결은 유지했다.

## 현재 산출물·해시

- 앱: `/Users/sw107/Documents/Codex/2026-10-06/task/mac-beta2-candidate-qa/GeulgyeolBeta2.app`
- 최종 ZIP 하나: 같은 폴더의 `Geulgyeol-0.4.4-beta.2-mac-arm64.zip` — 154,411,035바이트
- ZIP SHA256: `240d87a7e68f000e006bb06e6508e5c719303e2747fbbc269b060c681d593348`
- ASAR SHA256: `be2838d42b51a4d1c171456ce2cdf8ab2ce9a86812d0e934708ea4f296922091`
- ASAR header SHA256: `19b82067860c60329d46952a78199ee4416b04b7b734bb220c2b4a2fc7f9a2c1`
- WASM SHA256 불변: `e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45`
- 별도 bundle ID `org.geulgyeol.beta.0442`와 프로필 `GeulgyeolBeta2` 유지. QA는 새 전용 profile root만 사용.

현재 production Studio를 다시 빌드하고 검증된 엔진을 그대로 사용하여 단일 후보의 ASAR를 갱신했다. 이전 signed ZIP 전체를 `recovery-safety/pre-fix-package/previous-final-zip.backup`으로 보존했으며 ASAR·해시·검증 명세도 따로 보존했다. 새 후보 앱을 추가로 복제하지 않았다. 현재 ASAR 80항목의 전체/블록 해시와 소스 출처, 번들 279개 항목의 ZIP 내용·링크·모드 대조, 실행 후 strict deep ad-hoc 서명이 통과했다. Developer ID·공증은 제공하지 않는다.

## 수정 후 실제 패키지 검증

| 검사 | 결과 |
|---|---|
| 복구→저장 전 10초 이전 두 번째 crash→재실행 | 기존 영속본의 ID·바이트를 유지하고 동일 문서를 다시 복구, dirty 보존, 실제 저장 후 해당 ID만 정리 |
| 선택 draft 삭제 실패 | 복구 시 선택 ID의 delete API를 호출하지 않으며 로드 문서는 dirty. 실제 저장 후 정상 정리 |
| ‘나중에’ | 기존 draft 전부 불변, 깨끗한 새 문서로 시작·정상 종료, 다음 실행에서 동일 복구 후보 제시 |
| 전체 삭제 실패·재시도 | 실제 clear API 실패, 전체 바이트 보존·오류 표시·다음 실행의 재제시. 재시도 성공 후 빈 후보 확인 |
| 여러 draft 중 가운데 항목 선택 | B의 정확한 문서를 복구하고 A/C 유지. 실제 저장 후 B만 삭제 |
| 오래된 복구본 13개와 replacement put 실패 | 선택 A 및 모든 원래 영속본의 ID·바이트가 불변. pruning을 먼저 수행하지 않음 |
| replacement put 후 실제 transaction abort | 원래 13개 영속본이 rollback 뒤 그대로 남음. dirty 유지, 실제 파일 저장 성공 뒤 선택 A만 정리 |
| replacement 성공 뒤 crash | 같은 ID의 실제 put 완료·최신 추가 편집 보존, crash 후 최신 문서 재복구·저장 |
| 기존 수명 주기 / 원래 재실행 복구 / 최종 응답 경합 | 29 / 6 / 11개 재통과. 원래 복구 검사의 “복구 직후 삭제” 조건을 “실제 저장 전 영속본 보존”으로 수정 |
| 데스크톱 회귀 / TypeScript / production Vite | 46개 통과·기존 private 검사 1개 skip, 현재 엔진 TypeScript 및 Vite 통과 |

추가 8개 복구 시나리오의 20개 검증 항목을 포함해 **현재 실제 패키지 66개 항목**을 통과했다. 수정 후 검증 30회 실행은 모두 exit code 0으로 정상 종료했다. 수정 전 재현 5회 실행도 정상 종료했고, 전용 프로세스·열린 포트 잔류가 없다. 성공 수를 기능 전체 완성률로 계산하지 않는다.

실제 `.app`의 production UI·WASM·IndexedDB·IPC·파일 쓰기와 재실행을 사용했다. 추가 안전성 시나리오는 엔진으로 만든 합성 HWP를 실제 전용 IndexedDB에 저장하여 복구 후보로 사용했고, 원래 재실행 검사는 실제 autosave 타이머가 만든 draft를 사용했다. native 선택창 응답과 renderer crash는 QA에서 제어했다. clear/delete/put API 실패와 실제 IDB transaction abort는 구분하여 기록했다. 편집은 공개 plugin API, 복구 선택은 CDP DOM 조작이었다. ASAR를 테스트 중 변경하지 않았다.

## 보존과 미검증 범위

원본 73,368개·이전 QA 6,548개·기존 캐시 579개가 불변이다. 이번 갱신 이전 후보/검증 파일 1,522개도 검사했고, 허용된 후보 파일·ZIP의 이전 바이트는 보존된 ZIP으로 대조했다. 그 밖의 이전 증거는 변경·누락이 없다. Rust target 4,690,055,168바이트는 4.5 GiB 이내, 패키지/QA는 2 GiB 이내, 여유 공간은 15 GiB 이상이다. 기본 앱·사용자 원본·다른 개발 후보를 변경하지 않았다.

**OS 선택창·물리 한글 IME·클립보드·수동 GUI·한컴 대조·Linux 런타임은 미검증이다.** 이전 plugin 완성 문자열 입력을 IME 조합으로 계산하지 않았다. 접근성 허용이 확인되지 않은 환경을 우회하거나 권한·보안 설정을 변경하지 않았다. 기존 한컴 Viewer 창은 소유를 확인하지 못해 개입하지 않았다. 수정 전 일반 기동/AppleScript 종료 증거는 따로 보존하며 수정 후 일반 기동 검사로 재사용하지 않는다. Linux 캐시/준비 경로의 이전 읽기 전용 결과도 런타임 성공으로 계산하지 않는다.

다음은 부모의 P1/P2 재검토, 이어 실제 OS 선택창·물리 IME·한컴 독립 재열기·Linux 실행 확인이다. 과거 ephemeral origin/BetaNext 복구본의 자동 이관과 사용 중인 고정 로컬 포트에서의 시작 거절 정책은 유지한다.

## 재현·증거

`GEULGYEOL_QA_ENGINE_DIR`에 검증된 엔진 경로를 지정하고 각 시나리오마다 새 QA 폴더와 `files/`를 준비한다.

```sh
node scripts/check-packaged-recovery-safety.mjs "$QA_DIR" "$APP_EXECUTABLE" crash-again
node scripts/check-packaged-document-lifecycle.mjs "$QA_DIR" "$APP_EXECUTABLE"
node scripts/check-packaged-recovery.mjs "$QA_DIR" "$APP_EXECUTABLE"
```

추가 시나리오는 `crash-again`, `delete-failure`, `later`, `clear-failure`, `select-many`, `replacement-failure`, `replacement-abort`, `replacement-success`다. 이전 코드의 baseline 재현은 원래 패키지에서 실행한 기록으로 보존했다. 증거 루트는 `/Users/sw107/Documents/Codex/2026-10-06/task/mac-beta2-candidate-qa/recovery-safety`, 요약은 [proof.json](proof.json), 수정 전 환경 한계는 [사용자 경로 확인](USER_PATH_CHECK_KO.md)이다.
