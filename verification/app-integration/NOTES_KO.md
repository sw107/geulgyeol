# 최신 로컬 엔진의 Mac 개발 앱 통합 검증 — 2026-10-06

2f27fce(스타일 메타데이터 guard), 08b30c1(Mac 업데이트 안내), 8dc84ee(문단 끝 다음 스타일·빈 문단 글자 모양 복원)가 포함된 최신 로컬 엔진을 실제 release WASM으로 빌드했다. 엔진 라이브러리 소스는 8dc84ee와 동일하며 이번 변경은 생성 타입을 사용하는 Bridge와 검증·패키징 도구다. 공개 push/PR/태그/릴리스 갱신 없이 기존 checkout과 target을 사용했다.

## 빌드와 실제 binding

Mac arm64/Rust 1.93.1, offline/locked, 기존 Cargo 캐시·target, release 기본 LTO/codegen-units=1, debug/incremental OFF, jobs=2로 3분 2초에 빌드했다. wasm-bindgen 0.2.127로 web binding 및 선언을 생성했다. 새 WASM은 11,764,997바이트, SHA256 `5964e2fe21c7dd3965a18601431a6a2314b1c8638aca9fcb41fe27a29f77e12d`다. 기존 pkg는 저장소 밖 QA 폴더에 백업했고 기존 앱 내부 엔진은 교체하지 않았다.

Bridge의 5개 WithNextStyle 호출에서 임시 any cast를 제거했다. 최신 생성 선언으로 전체 Studio TypeScript strict 검사(tsc 7.0.2)를 통과했고 Vite 8.2.2로 전체 UI를 새 출력 폴더에 빌드했다. 첫 Vite 시도는 공유 node_modules의 읽기 전용 .vite-temp 쓰기가 막혔다. configLoader=native로 임시 설정 파일을 쓰지 않고 재시도하여 통과했다. 의존성 재설치나 기존 캐시의 권한 변경은 하지 않았다. CanvasKit의 fs/path externalization 및 큰 chunk 경고는 있었으며 실제 GUI 렌더링 완료로 해석하지 않는다.

새 fixture 모드는 본문/셀/중첩 셀/머리말/꼬리말/각주/미주/글상자/표 캡션 × 직접 서식 4종 × HWP/HWPX 입력으로 합성 파일 72개를 만든다. 끝 Enter/중간 Enter/구조 split/removed_meta 복원의 네이티브 기준 288개를 생성하고, 실제 WASM binding과 현재 Bridge·명령 소스로 같은 호출을 수행한다. 명령 소스 실행에는 Node 24의 TS 변환을 사용하며 전체 Studio DOM을 조작하는 GUI 검사는 아니다.

최신 pkg와 최종 앱에서 추출한 pkg를 각각 실행했다. 아래 수치는 최종 앱의 실제 추출 엔진 한 번의 결과이며 두 실행을 합산하지 않는다.

- 5개 Enter export 전체 실행, 288개 동작 검사. 끝 Enter는 B, 중간·구조·메타 복원은 기존 스타일 유지.
- 현재 UI 명령과 실제 엔진 연결 72개, snapshot undo/redo 576회, 실제 merge→역분할 72개.
- 메타데이터 잘못된 입력 12개와 다음 글자 스타일 미지원 9개 = 무변경 거절 21개. 스타일 목록/텍스트/이벤트/해당 SVG 보존을 검사했다. 앞선 Native 거절126개를 이번 WASM 실행 수치로 바꾸지 않는다.
- 실제 WASM에서 저장한 HWP/HWPX 결과 576개, undo/redo HWPX 결과576개, merge 역분할 HWPX72개 = 재열기 비교1,224개. 모든 지원 하위 문단의 텍스트·스타일·문단 모양·글자 run과 스타일 정의의 참조/언어/잠금 값이 네이티브 기준과 일치했다.
- 새 fixture·검증 예제의 native lib/example strict Clippy 통과.

## 별도 개발 앱

`../app-integration-qa/GeulgyeolDevEnter.app`, 버전 `0.4.4-dev.5`, bundle ID `org.geulgyeol.dev.enter`다. 기본 beta1 앱에서 검증된 Electron 런타임만 별도로 복사하고 Studio·WASM·binding을 최신 산출물로 바꿨다. 앱/4개 helper의 이름·실행 파일·bundle ID를 일치시키고 별도 `GeulgyeolDevEnter` userData를 사용한다. 실제 lifecycle 검사 프로필은 QA 폴더 안에만 만들었다. ZIP은 만들지 않았다.

ASAR 모든 엔트리의 integrity, 헤더 hash, 생성 binding과 Vite 산출물 hash, 브라우저가 쓰는 hashed WASM과 별도 pkg WASM의 동일성을 확인했다. 컴파일된 UI에 5개 export가 모두 있다. 테스트와 node_modules는 앱에 들어 있지 않다. 완성 bundle의 ad-hoc codesign/deep/strict 검사 통과이며 Developer ID 서명·공증은 수행하지 않았다.

Desktop의 엔진 검사들이 모두 GEULGYEOL_QA_ENGINE_DIR을 선택하도록 정리했다(기존 BARAM_ENGINE_DIR fallback 보존). 최종 앱에서 추출한 엔진으로 전체 desktop suite는 33개 중 pass31/fail0/skip1/TODO1이다. 지원 영역 전파 입력16개와 재열기32/undo-redo32도 통과했다. skip은 별도 private 복합 레이아웃 fixture가 지정되지 않은 검사이고 TODO는 앱이 쓰지 않는 createEmpty의 기본 DocInfo 없는 상태다. 이 둘은 통과로 세지 않았다.

첫 sandbox desktop 실행의 localhost listen EPERM은 로컬 loopback 권한을 허용한 검증 호출로 해결했다. 별도 후보 앱을 실행해 localhost HTML의 dev.5 버전과 제공 WASM hash를 확인하고, 후보 bundle ID에 정상 quit을 요청했다. quit 요청 exit0, 앱 exit0이다. 검증 창은 정상 종료됐고 후보 경로의 main/helper 프로세스가 남지 않았음을 읽기 전용 확인했다. 시작 로그에 sandbox_extension_issue_file 경고가 남아 있어 asset server 시작만으로 renderer의 정확성까지 확인했다고 주장하지 않는다.

## 보존과 디스크

전체 target은 1.37 GiB에서 약1.90 GiB로 증가했다. 기존 target 재사용, 전체 target 한도3 GiB 감시, 제한 중단 없음. QA 폴더/앱/백업/합성 결과까지 포함한 추가 사용량 추정은 약0.93 GiB이며 정확한 크기는 proof.json에 있다. 기존 node_modules와 wasm-bindgen을 읽기 전용 재사용했다.

원본 문서, 기본 앱, dev3/dev4, 공개 beta1/beta2, main·태그·릴리스, 계정·인증서·보안 설정은 유지했다. 원래 beta1 ASAR SHA256 `95071ec51add351b31c9ca77e6589cc2f4afbfb0d0264600abfb9eb0a082941b`가 그대로다. 공개 push는 부모의 직접 승인 대기 지시대로 시도하지 않았으며 Linux 실행·원격 전송도 하지 않았다.

## 남은 확인

실제 Mac GUI Enter/undo/redo/저장 대화상자·닫기재열기, 물리 한글 IME, 한컴의 중간 Enter·직접 서식 비교, 큰 문서의 연속 Enter snapshot 비용은 미검증이다. 현재 도구 목록에 실제 Mac GUI 조작 도구가 없었다. 이번 결과는 실제 WASM/패키지/타입 검사/프로세스와 자산 서버 lifecycle까지다. 다음 단계는 이 별도 후보 앱에서 실제 GUI와 IME를 확인하는 것이다.
