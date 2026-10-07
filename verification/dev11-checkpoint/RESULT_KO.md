# dev11 Mac 개발 후보 통합 검증

제품 소스 `573556d1e3ce24481d217061021441ec89ed53a0`를 별도 `GeulgyeolDev11.app` 하나에 통합했다. 버전 `0.4.4-dev.11`, bundle ID `org.geulgyeol.dev.checkpoint11`. 이전 dev10과 기본 앱·공개 beta.2·기존 후보/pkg는 보존했다. 새 ZIP·공개 push/release·계정/권한/인증서 변경 없음. 이 단계는 새 기능 구현 없이 패키징 검증과 기능 대조/다음 누락 재현만 수행했다.

## 소스·패키지 일치

검증된 `paragraph-band-ui-qa/pkg`의 WASM을 그대로 재사용했다. Rust/WASM 재빌드 없음; Native 검사는 기존 빌드 산출물을 재사용했다. 웹 자산은 현재 소스에서 새로 빌드했다.

- WASM SHA256: `cdb8171fbfbd20751c353d854b1cd6960bee345bdd8b0629e0021c0ccff39a99`
- ASAR SHA256: `cc93b8d25713cca6f354739d3db542b4c5027cc897eccda1d9b576e6a515aa6f`
- UI/wrapper 소스295개·엔진 소스1,147개 freeze 대조 불변. 직전 문단 띠 수정 소스8개와 빌드 WASM provenance 대조 불변.
- ASAR 모든 entry/block integrity·Info.plist/header hash·Helper4개 identity/내부 symlink 확인. 웹 자산 전체와 엔진 bindings4개 일치; hashed WASM asset도 동일.
- 컴파일된 UI의 너비 getter/setter·문단 띠 대상/명령·기존 삭제/주석 API 포함, 지원 문단 띠 메뉴 활성 확인.
- strict ad-hoc 서명은 패키징 후와 실행/검사 후 모두 통과. Developer ID/공증은 하지 않았다.

## 패키지 엔진 자동 검사

서명 앱의 Electron Node 모드에서 **ASAR 추출 bindings/WASM**을 초기화하고 실제 UI 명령·대화상자·registry/dispatcher·Bridge/InputHandler·snapshot/CommandHistory를 실행했다. DOM·커서·재화면/끌기는 어댑터이며 실제 Mac renderer 편집 검사가 아니다. 삽입/속성/삭제·텍스트/참조·저장/렌더 tree·SVG는 실제 엔진이다.

| 검사 | 결과 |
|---|---|
| 문단 띠 기본/편집/두 삭제 경로 | 지원 일반 본문 한 문단의 Para100%·1mm/검정/선없음, 두께2mm/면 색 변경·기존 개체 속성/삭제 연결 |
| 참조·이력·저장 | 각주/주석/인접 링크 필드·직접 글자 서식·다줄/탭·빈 문단6 fixture. HWP/HWPX 재열기132·undo/redo33쌍·거절/취소/무변경58. 실제 취소/Escape18·반복 확인6 |
| 너비 변화 | 문단 여백→쪽 폭/쪽 여백→2단/단 간격 변경 후 실제 띠 사용 폭, 저장/undo/redo 확인 |
| 독립 Native | 패키지 WASM 저장132개를 Native 명령 재실행·재열기 뒤 전체 SVG geometry/색/glyph·본문/필드/각주/직접 서식 참조로 대조 |
| 기존 사각형 너비/다른 개체 | 두 형식 재열기40·undo/redo20쌍·유효하지 않은 값20·비지원 경계6 무변경 거절. 이전 Native 저장 geometry40 대조. 기존4기준 SVG32·타원/회전/그룹/그림/셀 SVG10 일치 |
| TypeScript | 앱에서 추출한 현재 DTS를 사용한 TypeScript 검사 통과 |
| Mac 기본 기동 | 격리 프로필·문서 열기0·외부 링크0, 로컬 서버에서 JS/CSS/WASM7개 최신 hash 확인, 후보 경로로 정상 quit·exit0·잔류0 |

Native/WASM writer의 각주 헤더 선택적 끝0 패딩만 독립 저장 참조 비교에서 정규화한다. 비영 바이트·Memo 원시 데이터/필드/서식은 정규화하지 않는다. 실시간 편집/undo 상태 대조에도 정규화를 쓰지 않는다. 이번에는 기존 주석/셀 회귀 전체를 재실행하지 않았으며 같은 WASM에 대한 직전 [문단 띠 구현 검사](../paragraph-band-ui/RESULT_KO.md)를 별도 근거로 유지한다.

샌드박스 앱 초기 기동은 exit -6으로 막혀 실패 로그를 보존했다. 이후 기동 검사 helper의 quit 대상 ID가 dev10으로 남은 오류로 dev11 quit 대기가 실패했다. 그 시도는 fallback 종료(exit0)했고, helper에서 plist ID를 먼저 확인하고 dev11 앱 경로를 지정한 최종 검사는 정상 quit/exit0이었다. 제품 소스/서명 권한을 변경하지 않았다. 최초 상대 경로 실행 오류는 웹 빌드 시작 전에 올바른 cwd 경로로 수정했다. 최종 통과와 초기 실패를 구분해 기록했다.

## 다음 실제 편집 누락 하나: 그림 캡션 넣기의 실행 취소

일반 본문에서 그림 하나를 선택한 기존 `insert:caption-toggle` 명령은 활성이고 캡션을 실제로 만든다. HWP/HWPX 저장재열기에서도 캡션이 있다. 그러나 실제 object-props 라우터/Bridge로 직접 적용하고 `document-changed`를 내보내며 InputHandler snapshot/command 실행 호출은0이다. actual CommandHistory에 undo 항목이 없고 actual InputHandler undo를 호출해도 캡션과 두 저장 형식 바이트가 유지된다. 선택/커서/재화면은 어댑터를 쓴 한 사례 재현이며 물리 GUI 성공을 주장하지 않는다. [재현 proof](next-gap-caption-undo.json).

다음은 **일반 본문 단일 그림의 기존 캡션 추가를 한 번의 undo/redo에 연결**하는 작은 범위를 제안한다. 자동 번호·그림/인접 필드·직접 서식·문서 참조, 비지원 대상 무변경, 두 형식 재열기를 검증해야 한다. 방향 메뉴 `insert:caption-bottom`이 스텁인 것도 조사했으나 별도의 캡션 넣기/개체 속성 경로가 이미 있어 캡션 기능 전체 부재로 설명하지 않는다. 표/셀·그룹·각주 저작/새 방향 메뉴 확장은 이 제안과 분리한다. **이번에는 수정하지 않았다.**

## 보존·디스크·한계

보호 파일19개, dev10 QA314개·직전 너비 QA771개·문단 띠 QA940개(합계2,025)의 hash가 일치했다. 원본 문서는 복사/메모리 검사에만 사용했다. 이전 앱/pkg/ZIP 삭제나 교체 없음.

새 앱은336.32MiB이며 이번 QA 전체 추가량은 약378.5MiB로1GiB 안이다. target 최고/최종3.749GiB(새 엔진 빌드 없음), 최소 free21.32GiB로 target4GiB/free10GiB 중지 기준을 지켰다. 감시 중단 없음. 정확한 bytes는 [proof](proof.json)의 resources와 QA budget JSON을 따른다.

누적 후보 inventory는 현재 작업 폴더·원래 프로젝트 `/Users/sw107/Documents/Codex/2026-09-08/new-chat`·이전 `/Users/sw107/Documents/Codex/2026-10-05/task-2`에서 글결/Baram 이름의 최상위 앱과 ZIP을 집계했다. helper 앱을 중복 집계하지 않는다. APFS 공유 clone extents는 중복 제거하지 않은 `du` 할당량이며 실제 고유 공간과는 다르다.

| 범위 | 앱/ZIP | 할당량 합계 |
|---|---|---|
| 현재 작업 폴더 | 앱9·ZIP3 | 3.364GiB |
| 원래 프로젝트 | 앱110·ZIP9 | 35.472GiB |
| 이전 작업 폴더 | 앱2·ZIP5 | 1.332GiB |
| 누적 합계 | 앱121·ZIP17 | 40.168GiB(앱38.474GiB·ZIP1.694GiB) |

측정 시 현재 workspace 전체8.799GiB, 디스크 사용439.069GiB/여유21.362GiB였다. 상세 경로/bytes는 `../dev11-checkpoint-qa/disk-inventory.json`에 있다. 기존 누적물을 삭제하지 않았다.

실제 Mac 메뉴 클릭/선택/끌기·물리 IME, Chromium renderer 엔진 준비 완료/편집, 한컴 생성 corpus/한컴 앱 저장열기, Linux는 미검증이다. Node 엔진 초기화·실행과 Mac 자산 서버 기동을 GUI 성공으로 부르지 않는다. 기존 누락 include_bytes fixture3개 때문에 전체 lib unit test는 재실행하지 않았고 대체/제외도 하지 않았다. 중간 앵커/복잡 문단 띠 등 기존 거절 경계를 유지한다.

재현 명령·원시 로그·후보/추출 엔진·서명/기동·자원·보존 해시는 `../dev11-checkpoint-qa`의 체크포인트/recipe/proof/artifact-manifest에 남겼다. 최종 문서만 로컬 커밋하고 공개하지 않는다.
