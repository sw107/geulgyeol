# dev.12 Mac 통합 후보 검증

제품 소스 `30601b18ab81aeddc51ea059c6980003706ad1b8`의 새 웹 자산과 검증된
`nested-row-boundary-qa/pkg` 엔진을 **독립 Mac 후보 하나**에 통합했다.
이미 생성한 후보를 검증 재개 때 그대로 사용했다. 제품 엔진/API/UI/desktop 소스 수정은
필요하지 않았다. 검증 스크립트와 결과만 이 로컬 커밋에 포함한다.

후보: `/Users/sw107/Documents/Codex/2026-10-06/task/dev12-integration-qa/GeulgyeolDev12.app`

| 매핑 | 값 |
|---|---|
| 내부 개발 버전 / bundle ID | `0.4.4-dev.12` / `org.geulgyeol.dev.checkpoint12` |
| 재사용 Electron runtime | 보존된 dev11 / Electron `44.3.0` |
| RHWP 엔진 version() / WASM SHA256 | `0.8.6` / `3a9e736e1025bf3c9c72bda67e1d9ca4a1665bfb3e2f06b5ab172932bc7f1a86` |
| 후보 ASAR SHA256 | `7cb9e475d25d3ed7ec7d7a95b1b28e278547c3d32bd3dbc885d336ea0a113d36` |
| 후보 ASAR header SHA256 | `88b952189e0c22626713312f5993c5e8dc984deb001e141e013acbc641db0e2a` |
| 현재 소스에서 빌드한 UI JS SHA256 | `bf7cb0f04bb58c294638334b3e6d03dc8f90ba3d23b14ec66d8b8ac7349a44bd` |
| 재사용 dev11 ASAR SHA256 | `cc93b8d25713cca6f354739d3db542b4c5027cc897eccda1d9b576e6a515aa6f` |

웹 전체 자산, bindings4개, Native executable3개 및 소스 freeze1,470개의 정확한 매핑은
[proof.json](proof.json)에 있다. Native와 WASM은 기존 검증 산출물을 재사용했으며
이번 단계에 Rust 재빌드/새 target이 없다. Native 책갈피·캡션 실행 파일은 이전 빌드이고,
`30601b1`의 마지막 JS section/parent 타입 검사는 해당 Native 경로를 변경하지 않았다.
이번 통합 단계에서 전체 Native를 다시 빌드했다는 주장은 하지 않는다.

개발 자동검증용으로 `NODE_ENV=development` 웹을 빌드해 기존 DEV Cursor globals를
유지했다. 공개 릴리스 빌드가 아니다. ASAR entry/block integrity·Info.plist·Helper4개
identity·내부 symlink·fresh assets/bindings·실제 renderer가 로드한 WASM hash가 일치했다.
패키징 직후와 실행 후 **strict ad-hoc 서명**이 통과했다. Developer ID/공증은 하지 않았다.
추출된 동일 엔진의 `version()`도 `0.8.6`이다. 첫 버전 검사 helper는 기대 문자열에
제품명 `RHWP`를 붙여 실패했으며, 올바른 버전 값으로 검사한 최종 실행은 통과했다.
두 로그를 보존했다.

## 실제 Electron renderer 검증

후보의 실제 Electron 실행 파일/창·preload IPC·embed SDK·studio iframe을 사용했다.
별도 Chromium/Vite 서버 검사가 아니다. 실제 IPC 버전은 `0.4.4-dev.12`/`darwin`,
renderer에는 Node `require`가 노출되지 않았다. 커서 배치는 DEV globals, 키 입력은
CDP, 붙여넣기는 synthetic ClipboardEvent를 사용했다. 실제 메뉴 dispatcher·대화상자·
InputHandler·snapshot/CommandHistory·WASM 편집/렌더를 거쳤다.

| 대표 편집 | 사례 | undo/redo 쌍 | HWP/HWPX 저장 재열기 |
|---|---:|---:|---:|
| 본문 지정 위치 책갈피 추가 | 1 | 4 | 4 |
| 선택 교체 일반 텍스트 / 여러 줄 붙여넣기 | 2 | 8 | 8 |
| 그림 캡션 넣기 / 혼합 서식 캡션 선택 교체 | 2 | 8 | 8 |
| 링크 셀·다중 수식 셀 병합 / 2×2 셀 분할 | 3 | 12 | 12 |
| 깊이2 중첩 표 마지막 줄 아래 추가·첫 줄 위 추가·마지막 줄 삭제 | 3 | 12 | 12 |
| 합계 | **11** | **44** | **44** |

각 사례에서 실제 undo 저장물을 따로 내보냈다. 커서 배치 후의 편집 전 상태를 기준으로
undo의 HWP/HWPX 바이트·전체 SVG·텍스트·스타일/필드/책갈피가 모두 일치했고,
redo의 전체 상태도 일치했다. 두 형식의 편집 후/undo 저장 재열기는 전체 SVG와 텍스트가
일치했다. renderer pageerror0. 실제 앱에서 Mac Meta-Z/Meta-Shift-Z 경로를 거쳤다.

최초 시도는 검증 fixture 이름 `equation-row`가 실제 `equations-row`와 달라 6사례 뒤
중단됐다. 또 최초 baseline을 커서 이동 전에 기록해 HWP 저장 캐럿 비교가 달랐다.
검증 helper만 바로잡고 최종11사례를 재실행했다. 최초 실패 JSON/로그와 최종 로그를
모두 남겼다. 제품 수정이나 과거 HWP metadata 결함 해결로 설명하지 않는다.

## 독립 Native 대조 및 엄격 비교의 한계

기존 Native 실행 파일로 명령을 독립 재실행한 뒤 저장물을 다시 열었다.

- 표/중첩 행 **24건**: 전체 재귀 문단·control/필드 owner·typed DocInfo·BinData·SVG 일치.
- 캡션 **8건**: 전체 SVG·문단·스타일·캡션·그림 일치, Native snapshot12쌍.
  기존 oracle은 각주 헤더의 알려진 끝0 padding을 정규화한다.
- 책갈피/붙여넣기 **12건**: 기존 엄격 oracle7건 통과. HWP5건은 전체 SVG 검사를
  통과한 뒤 DocInfo raw stream의 저장 캐럿 및 provenance digest 차이로 엄격 비교 실패.

후자의 실패를 통과로 바꾸거나 저장 파일을 수정하지 않았다. 각 파일을 별도로 실행하고
엄격 실패 로그를 보존했다. 제한적 추가 비교는 전체 canonical 모델과 typed DocInfo를
동일하게 요구하고, raw DocInfo 레코드를 직접 읽어 **tag16 DOCUMENT_PROPERTIES의
26바이트 중 끝12바이트 저장 캐럿만** 달라짐을 확인했다. 앞14바이트의 번호/구역 수,
모든 다른 raw record, 문단·참조·서식·BinData, 캐럿 이외 record seal은 정확히 일치한다.
분리한 seal은 `model_digest`, `raw_digest`, `record_seals.props`뿐이다.

| HWP 파일 | renderer 저장 캐럿 `[list, para, char]` | Native 기대 캐럿 |
|---|---|---|
| bookmark-add-after | `[0,0,28]` | `[0,0,0]` |
| bookmark-add-undo | `[0,0,20]` | `[0,0,0]` |
| paste-selected-undo | `[0,0,20]` | `[0,0,0]` |
| paste-multiline-after | `[0,3,0]` | `[0,2,3]` |
| paste-multiline-undo | `[0,2,1]` | `[0,0,0]` |

이 제한적 비교가 문단/참조·typed DocInfo·문서 번호·다른 raw record·다른 provenance
변경 및 캐럿 차이 없는 provenance-only 변화를 거절하는 메모리 검사6개도 통과했다.
**44건 내용/참조 대조 완료이며, 모든 HWP raw DocInfo가 정확히 같다는 주장은 하지 않는다.**
책갈피 Native 엄격 실패를 제품 오류 수정이나 원래 oracle 전체 통과로 표시하지 않는다.

## 일반 실행·보존·자원

진단용 loopback DevTools 플래그를 쓴 편집 실행은 정상 quit/exit0이었다. 별도로 같은
후보를 **디버깅 플래그 없이** 실행해 버전·웹 자산9개와 WASM hash를 확인하고 정상
quit/exit0으로 종료했다. 후보 관련 프로세스0, 편집 실행의 자산/DevTools 포트도 닫혔다.
dev.12에서 추출한 DTS를 사용하는 TypeScript 검사 통과.

보호 파일 **37,113개**, 제품 소스 **1,470개**, 기존 shared target 및 Native 실행 파일3개의
hash가 불변이다. dev11·기본 앱·공개 beta.2·이전 dev 후보와 원본 문서를 보존했다.
OS 클립보드를 읽거나 쓰지 않았다. 계정/권한/보안 설정/인증서 변경·삭제 정리 없음.
새 앱은 이 후보1개, ZIP0, 새 target0, Rust 재빌드0.

단계별 모니터와 소량 검증 기록을 합친 추가 사용량은 **약389MiB**, 재개 시의 실제 측정을 포함한
최소 디스크 여유 **17.34GiB**로 추가1GiB/실제여유15GiB 기준을 지켰다. shared target은
**4.0422GiB**로 불변, 감시 중단0이다. 저장된 검증 기록/로컬 커밋의 소량 추가분도
최종 자원 기록에 반영한다. 정확한 bytes와 각 단계 실패/성공은 proof의 budgets를 따른다.

이번 worker 작업에서 사용자가 직접 **“푸시 좀 해줄래”**라고 요청했고, `30601b1`을
`origin/dev/style-propagation`으로 푸시했다. 실제 push reflog는 **2026-10-07 19:33:42 UTC**.
메시지 자체의 정확한 타임스탬프는 전달되지 않아 추정하지 않았다. 당시 미커밋 renderer
검증 스크립트는 제외했다. 그 이후 추가 푸시는 하지 않았고 이 통합 결과는 로컬 커밋이다.

## 남은 확인

실제 Electron renderer의 자동 편집은 확인했지만 물리 포인터·한글 IME·실제 클립보드
붙여넣기·OS 열기/저장 대화상자와 host atomicWrite는 미검증이다. 저장은 실제 app export와
studio file-input으로 수행했다. 한컴 앱/한컴 생성 corpus·Linux 검사는 이번 Mac 통합에
추가하지 않았다. 전체 lib unit test는 이전부터 include_bytes 샘플3개 누락으로 컴파일이
막혀 있으며 이번 단계에 샘플을 조작하거나 Rust 테스트를 재빌드하지 않았다.

다음 확인은 이 동일 후보에서 실제 한글 IME·클립보드·OS 저장 대화상자 사용 후 두 형식
저장열기와 한컴 호환 확인이다. 새 후보 복제나 공개 릴리스가 필요한 상태로 설명하지 않는다.

원시 증거와 실행 명령은 `../dev12-integration-qa/CHECKPOINT_KO.md`,
`evidence-manifest.json`, 각 budget/log 및 Native 실패/제한 비교 JSON에 남겼다.
