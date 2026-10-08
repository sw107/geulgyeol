# 병합 기반 Mac beta.2 후보

`main` 병합 `35fdcd0b6c0f9c648c534da8300eacb2494d9623`에서 이어 만든 **0.4.4-beta.2 / Mac arm64** 로컬 후보다. 공개 태그·릴리스는 만들지 않았다. 앱에 포함된 제품 소스는 `ef82f168bf2637f8b5682617436d9e6914dfa183`이며, 이후 검증 스크립트와 기록 변경은 제품 바이트를 변경하지 않는다.

## 산출물

- 앱: `/Users/sw107/Documents/Codex/2026-10-06/task/mac-beta2-candidate-qa/GeulgyeolBeta2.app`
- 최종 ZIP 하나: 같은 폴더의 `Geulgyeol-0.4.4-beta.2-mac-arm64.zip` — 154,411,022바이트
- ZIP SHA256: `fa2989926cb4850ca7d1fd76ebf13b2b27c253c266417cb6c1126fedcfe6dc9c`
- ASAR SHA256: `e5818ffe34b92779ec788388a5faa3146f68dfc1e57ac174ebe5dbf3255e2e25`
- WASM SHA256: `e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45`
- 별도 bundle ID `org.geulgyeol.beta.0442`, 기본 프로필 `GeulgyeolBeta2`. QA는 `GEULGYEOL_PROFILE_ROOT`로 새 전용 폴더를 사용했다.

공식 Electron 44.3.0 런타임을 바이트 복사하여 별도 앱을 만들고 현재 추적된 데스크톱 코드·SDK·라이선스를 모두 새 ASAR에 넣었다. 검증된 `table-size-qa/pkg` 엔진과 현재 소스로 빌드한 production Studio, 보존된 글꼴만 재사용했다. 이전 dev.12/beta.1의 코드·ASAR는 상속하지 않았다. 기본 `desktop/web/studio`의 이전 산출물은 보존했으며, 이번 후보는 별도 자산 경로를 명시하는 `scripts/package-merged-mac-beta.py`로 생성했다. package.json·메인 창·헤더·도움말·Info.plist 버전이 일치한다. ASAR 80개 항목의 전체/블록 해시와 소스 출처, 번들 279개 파일 및 링크·모드와 ZIP 내용을 대조했다. 앱에 테스트·node_modules·문서·프로필은 없다. 서명은 **strict deep 검증을 통과한 ad-hoc**이며 Developer ID·공증은 제공하지 않는다.

## 실제 패키지에서 발견해 수정한 복구 누락

기존 앱은 매 실행 다른 로컬 포트를 사용했다. IndexedDB는 포트를 포함한 origin에 저장되어 이전 실행의 복구본이 새 실행에서 보이지 않았다. 임베드 화면의 시작 복구 안내도 비활성화되어 있었다.

새 후보는 프로필에 로컬 포트를 기록하고 다음 실행에서 같은 origin을 연다. 기록된 포트가 사용 중이면 명시적으로 실행을 거절하여 새 origin 아래 복구본이 숨겨지는 것을 방지한다. 데스크톱이 시작 문서 준비를 기다리는 경로에서만 복구 안내를 명시적으로 활성화했다. 복구하면 수정 상태를 유지하고, 빈 문서 초기화가 복구 결과를 덮어쓰지 않는다. 기존 BetaNext 프로필이나 과거 임시 origin의 복구본을 자동 이관하지는 않는다.

## 검증 결과와 범위

| 검사 | 결과 |
|---|---|
| 실제 서명된 패키지 문서 수명 주기 | 29개 통과. HWP/HWPX 실제 IPC·atomic write·재열기, 저장 취소/실패, 새 문서/열기/닫기의 버전 경합, IndexedDB 정리 실패·복구 재개 |
| 종료 최종 응답 경합 | 11개 통과. public/빌린 핸들 쓰기, 실제 파일 읽기·이미지 디코드의 지연 완료, finalize 응답 실패 취소, pending render 거절·재시도 |
| 프로세스 재실행 복구 | 6개 통과. 실제 draft 생성, 제어된 renderer crash 후 명시적 정상 종료, 같은 origin의 실제 복구 안내창, 복구/추가 편집/저장, 세 번째 실행의 저장 파일 재열기 |
| 일반 패키지 기동 | 메인 inspector·네이티브 응답 어댑터 없이 기동·현재 버전/엔진·빈 문서 준비 확인. AppleScript의 앱 quit으로 정상 종료 |
| 데스크톱 자동 회귀 | 현재 엔진을 지정하여 46개 통과·기존 private 경로 1개 skip. origin 재시작/프로필 분리/포트 충돌 검사 포함 |
| 현재 엔진 TypeScript / production Vite | 통과. Rust/WASM을 다시 빌드하지 않음 |

46개 패키지 시나리오는 실제 `.app/Contents/MacOS/GeulgyeolBeta2`를 실행했다. 주 프로세스 inspector로 QA 전용 응답 어댑터를 넣었지만 앱 ASAR는 변경하지 않았다. 네이티브 IPC·디스크 쓰기·IndexedDB·렌더러·생산용 문서 엔진은 실제이며, 선택창 응답은 제어했다. 화면 버튼은 CDP DOM 조작, 한글 편집은 공개 plugin API로 수행했다. 기본 창 크기를 유지하고 시나리오 창은 사용자 키보드를 받지 않도록 비활성 표시했다. 검증 실행과 일반 실행은 모두 정상 종료했고 잔류 프로세스·열린 전용 포트가 없다.

**OS 선택창 조작, 물리 한글 IME·클립보드, 한컴에서 열기, 수동 GUI 검증은 하지 않았다.** 접근성 조회가 응답하지 않아 해당 조회 프로세스를 종료했으며 보안/접근성 설정을 변경하지 않았다. `recovery/recovery-dialog.png`, `recovery/reopened-document.png`, `ordinary-startup.png`는 실제 앱 렌더러의 CDP 화면 증거이지 OS 대화상자나 물리 입력 증거가 아니다. 일반 기동의 CDP는 읽기와 화면 기록에만 사용했다.

## 보존·Linux·다음 확인

보호 대상 원본 73,368개·이전 QA 6,548개·기존 캐시 579개가 불변이다. 기본 앱·기존 개발 후보·공개 beta.2를 보존했다. 실패한 패키징 시도도 별도 백업으로 보존하고 영구 삭제하지 않았다. Rust target은 4,690,055,168바이트로 4.5 GiB 이내이고 새 패키지/QA는 2 GiB 이내, 여유 공간은 15 GiB 이상이다.

Linux는 Electron 44.3.0 x64/arm64의 기존 캐시 ZIP과 ELF 아키텍처·해시를 읽기 전용으로 확인했다. 같은 검증된 ASAR/엔진을 `resources/app.asar`에 넣는 준비 경로가 있다. Mac에서 Linux 런타임을 실행하거나 Linux 배포물을 만들지는 않았고 Linux 성공으로 계산하지 않는다.

다음 확인은 후보 앱에서 실제 OS 저장/열기 선택창과 물리 한글 조합·undo/redo·클립보드, 한컴 독립 재열기, Linux 런타임 검사다. 공개 전 부모의 후보 검토가 남아 있다. 현재 후보의 기능 전체 완성률이나 전체 한컴 호환을 테스트 수로 추정하지 않는다.

후속 읽기 전용 확인에서는 Mac 화면 제어 도구 없음·현재 프로세스 접근성 `false` 때문에 OS 선택창/물리 IME 경로를 진행하지 않았다. 한컴 Viewer는 설치되어 있지만 소유가 확인되지 않은 기존 실행 인스턴스를 보존했으며 문서 대조를 하지 않았다. [현재 사용자 경로 확인·정확한 차단 사유](USER_PATH_CHECK_KO.md).

## 재현 경로

현재 엔진 경로를 `GEULGYEOL_QA_ENGINE_DIR`에 지정하고, 새 QA 폴더와 `files/`를 준비한다.

```sh
node scripts/check-packaged-document-lifecycle.mjs "$QA_DIR" "$APP_EXECUTABLE"
GEULGYEOL_QA_PACKAGED_APP="$APP_EXECUTABLE" node scripts/check-electron-final-ack.mjs "$QA_DIR" public
node scripts/check-packaged-recovery.mjs "$QA_DIR" "$APP_EXECUTABLE"
```

최종 응답 시나리오는 `public`, `file-read`, `image-decode`, `cancel`, `pending-render` 각각 새 QA 폴더를 사용한다. 원본 실행별 JSON/로그·보존 명세·패키지 검증 스크립트는 산출물 폴더에 보존했고 요약은 [proof.json](proof.json)에 있다.
