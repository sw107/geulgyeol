# 누적 로컬 변경의 Mac dev.6 앱 체크포인트

`a6dee6a`까지의 최신 release WASM과 Studio 자산을 포함하는 별도 후보 `../dev6-checkpoint-qa/GeulgyeolDev6.app`(0.4.4-dev.6, `org.geulgyeol.dev.checkpoint6`) 한 개를 만들었다. 기존 dev.5·기본 앱·beta.2와 원본 문서는 유지했다. 검증된 기존 Electron 44.3.0 런타임과 target/의존성을 재사용했고, 소스 checkout을 복제하거나 ZIP을 만들지 않았다. 이번 변경은 패키징 옵션·패키지 검증 도구·후속 범위 재현 및 기록이다. 엔진/제품 UI의 다음 기능은 구현하지 않았다.

앱/4개 helper의 이름·실행 파일·bundle ID, 격리 프로필, 79개 ASAR 엔트리의 파일/블록 integrity와 헤더 hash, 새 binding 4개, 전체 Vite 자산의 byte-exact 일치를 확인했다. 앱 내부 symlink도 모두 후보 안으로 한정된다. 브라우저용 hashed WASM과 별도 엔진 WASM 모두 SHA256 `83e65b74de7e02134c33408a872b3832de2da38479eed04121f706a640bb3faa`다. 컴파일된 UI에 새 모양복사 API 4개가 있다. 전체 번들 ad-hoc codesign/deep/strict 검사 성공이며 Developer ID 인증서·Apple 공증은 수행하지 않았다.

패키지에서 binding/엔진만 추출하고 **이 새 앱의 Electron Node 24.20.0**으로 아래 대표 명령을 실행했다. 현재 UI 메서드·Bridge·명령 클래스를 사용하고 DOM·커서·명령 dispatch는 headless adapter다. 실제 CommandHistory 전체 화면 이벤트 성공으로 해석하지 않는다.

| 패키지 엔진 자동 검사 | 결과 |
|---|---|
| 중첩 모양복사 | 30건, 이력 복원180회, HWP/HWPX 재열기60건, 무변경 거절44건, 반복 복사/붙여넣기30회 |
| 검색 Unicode casefold 원문 범위 | 12건, 결함0, HWP/HWPX 재열기24건 |
| FindDialog 셀 검색/치환·표 redo | 24건, 이력 복원170회, 재열기82건, 거절4건; SVG·셀 행/쪽 형상 동일 |
| 전체 desktop 자동 테스트 | pass31 / fail0 / skip1 / TODO1, 자산 서버 검사 포함 |

skip은 private 복합 fixture 미지정, TODO는 앱이 사용하지 않는 createEmpty의 기본 스타일 없는 모델이다. TODO를 통과로 세지 않았다. 서명 이후 앱을 격리된 QA 프로필로 일반 실행했다. 로컬 자산 서버의 dev.6 HTML·제공 WASM hash를 확인하고 bundle ID에 정상 quit을 요청했다. quit 요청 exit0, 앱 exit0, 후보 main/helper 잔존0이다. 프로필은 QA 안에만 생성했다.

실제 Mac GUI 조작 도구는 이번 도구 목록에도 없었다. 실제 화면 렌더링·선택 이벤트·native 저장 대화상자·물리 한글 IME와 Linux 실행은 미검증이다. 일반 시작 로그의 `sandbox_extension_issue_file` renderer helper 경고와 headless 런타임의 `task_name_for_pid` 경고가 남아 있다. 서명·서버·headless 엔진 성공을 GUI 성공으로 주장하지 않으며 보안 설정·권한·인증서를 변경하지 않았다.

디스크는 시작 시 약27GiB 여유를 확인했다. 추가 후보/프로필/추출 엔진/대표 검사 산출물은 약354MiB(정확한 du는 proof.json)이고 기존 약2.48GiB Cargo target은 증가하지 않았다. 전체 라이브러리의 미복원 include fixture3개 차단은 이전 결과를 유지하며 재시도하지 않았다. 원본 dev.5 ASAR SHA `8e195e5527d38652705c308eef2ab40db47cae2c4d395fabe4870d6c6c6da0ed`, 기존 베타 ASAR SHA `95071ec51add351b31c9ca77e6589cc2f4afbfb0d0264600abfb9eb0a082941b` 유지. 원격 push/release·계정·인증서·보안 설정 변경 없음.

[기능 대조와 다음 범위](FEATURE_AUDIT_KO.md)의 제안은 **중첩 셀 문단 모양 직접 편집** 한 가지다. 일반 셀 대조군4건은 실행되지만, 중첩 셀의 정렬·줄간격·들여쓰기·셀 블록 요청8건은 현재 UI에서 대상0/명령0/HWPX 및 SVG 무변경이었다. 조회 값도 바깥 셀을 읽었다. 독립적인 일반 문단 모양 path WASM setter는 없고 native formatter는 존재한다. 이번에는 누락을 재현하고 범위를 선택했으며 구현은 하지 않았다.

## 재현

```sh
python3 scripts/package-local-mac-integration.py --source-app dist/GeulgyeolBetaNext.app --studio-dir ../nested-format-copy-qa/web/studio --output-app NEW_APP_PATH --product GeulgyeolDev6 --bundle-id org.geulgyeol.dev.checkpoint6 --version 0.4.4-dev.6
scripts/sign-mac-bundle.sh NEW_APP_PATH org.geulgyeol.dev.checkpoint6
python3 scripts/check-local-mac-checkpoint.py --app NEW_APP_PATH --studio-dir ../nested-format-copy-qa/web/studio --output-dir QA_OUTPUT_DIR
ELECTRON_RUN_AS_NODE=1 NEW_APP_PATH/Contents/MacOS/GeulgyeolDev6 scripts/check-nested-format-copy-wasm.mjs QA_OUTPUT_DIR/packaged-engine ../nested-format-copy-qa/behavior/native UI_OUTPUT_DIR
```

기존 후보를 덮어쓰는 출력은 거절한다. normal lifecycle 재현은 QA의 `mac-lifecycle.py`와 `basic-launch-proof.json`, 대표 명령 결과는 `nested-format-copy/`, `search/`, `table-redo/`, 다음 기능 근거는 `next-gap/proof.json`에 있다. 모든 기록·엔진 hash의 연결은 인접 QA와 이 폴더의 proof.json을 참고한다.
