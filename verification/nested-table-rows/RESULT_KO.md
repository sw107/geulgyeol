# 깊이 2 중첩 표의 줄 추가·삭제

기준 `e815159`에서 모든 안쪽 구조 명령을 안전하게 거절하던 상태에 작은 행 편집 지원을 추가했다. 본문 표의 셀 안에 있는 **깊이 2 비병합 직사각형 표**에서 위/아래 줄 추가와 줄 삭제를 실제 명령 경로로 실행한다. 열 편집·병합·분할·줄/칸 대화상자와 깊이 3 이상은 기존 거절을 유지한다. 로컬 개발 후보이며 새 push/release/앱/ZIP은 없다.

## 지원 범위와 구현

본문 Table → 셀 문단 → Table 경로만 허용한다. 안쪽 표는 빈틈 없는 단일 셀 그리드, 열별 동일 폭·행별 동일 저장 높이여야 한다. 보호된 셀/부모 셀, 영역 속성, 독립 resize 힌트, 직접 포함한 더 깊은 표는 거절한다. 셀/텍스트/표 객체 선택을 하지 않은 단일 캐럿 위치만 지원한다.

삭제할 줄에 이름 셀·필드 범위·제어 개체·고아 필드 끝·범위 태그·제목 표시·CTRL_DATA 소유자가 있거나 마지막 줄이면 무변경 거절한다. 일반 텍스트가 있는 줄과 추가한 빈 줄은 삭제할 수 있다. 남는 줄의 이름 셀·링크·수식·직접 서식과 바깥 표·형제 셀·본문 참조를 보존한다.

새 `getNestedTableRowTarget`/`editNestedTableRow` API는 필수 정수 경로 두 항목과 action/token을 엄격하게 파싱한다. 경로·본문 부모 문단 전체·문서 epoch/구역 revision에 묶인 토큰을 변경 직전에 비교한다. 안쪽 표 복제에서 작업을 준비한 뒤 한 번에 교체하고 부모 표 트리와 구역 조판을 갱신한다. UI는 같은 조회로 enabled 상태를 정하고 지연 snapshot 실행 때 문서 generation·커서/선택·토큰을 다시 확인한다. 삽입 후 원래 내용 셀, 삭제 후 남는 셀의 정확한 경로로 캐럿을 옮긴다. 기존 root API와 snapshot 이력은 유지했다.

## 검증 결과

합성 문서는 바깥2×2/안쪽2×2 표, 여러 문단, 혼합 직접 서식, 이름 셀, 링크·수식2개, 인접 본문 책갈피를 포함한다. 안쪽 표 제어 인덱스0과 형제 표 뒤 인덱스1, HWP/HWPX 원본을 조합했다. 생성기는 이전 QA 없이 자체 fixture를 만든다. 기존 fixture와 바이트가 같은 것도 확인했다.

| 검사 | 최종 결과 |
|---|---|
| Native 중첩 행 | 24사례·96snapshot쌍·96재열기·170원자거절. 대상 밖 전체 문단/제어·남는 셀·typed DocInfo/스타일·필드 소유·BinData·전체 SVG 보존. 내용 손실 보고0 |
| 실제 Mac Chrome 중첩 행 | 현재 소스+후보 WASM, 실제 dispatcher/명령/Bridge/InputHandler/history. 24사례·28편집·112명령 undo/redo쌍·96재열기. 캐럿 경로 재배치, 모든 안쪽 셀 표시 및 부모 셀 frame 안 포함 검증 |
| 비지원 명령·오래된 대상 | disabled dispatch368 + 직접 execute368회에서 HWP/HWPX 바이트·전체 SVG·history·대기 redo 보존. 지연 snapshot20/원시 API40=60거절. 기존 root 대화상자/선택 컨텍스트/flat축 불일치38검사도 무변경 |
| 독립 Native 대조 | Mac 중첩 저장물96개를 Native에서 동일 경로 명령 재실행·같은 형식 재직렬화/재파싱. 전체 문단/제어/필드 소유·typed DocInfo·BinData·전체 SVG 일치 |
| 일반 표 회귀 | Mac24사례·30편집·120이력쌍·96재열기·원자거절281/no-op3, 독립 Native96. Native 자체24/96쌍/96재열기/23거절/no-op4 |
| 링크·다중 수식 회귀 | 후보 WASM/UI 어댑터 링크84/288재열기/84이력쌍/444거절·layout12·multipage12 및 독립 Native264. Native 수식72/288재열기/504snapshot동작/10거절 |
| 정적 검사 | 후보 DTS TypeScript, Clippy(lib/example3개 `-D warnings`), diff 검사 통과 |

실제 Mac 정상 합계 **48사례·58편집·232명령 이력쌍·192재열기**, 독립 Native192다. 모든 실제 Mac 페이지의 오류0이며 받아 실행한 WASM 해시는 아래와 같다.

`be687504aee74e10d4e0278def36d291dcb82f739e49cfb5491f2204330b1eeb`

## 제한과 보존

DEV Cursor API로 위치를 놓고 실제 DOM/Canvas/명령을 자동 검증했다. 물리 pointer hit-test/IME·OS 클립보드·설치 Electron IPC/네이티브 파일 대화상자·한컴·Linux 성공을 주장하지 않는다. 큰 실제 문서 corpus/성능·모든 중첩 구조·머리말/각주/글상자 표도 미검증이다. 다음 범위는 독립 경계/병합 표의 경로 이동과 참조가 있는 줄 삭제 계약을 먼저 정하는 것이다.

HWPX 저장기는 삽입한 문단 수에 따라 뒤쪽 문단의 내부 instance ID를 다시 부여한다. 저장 전후 바깥 내용 비교에서 이 생성 ID만 별도 처리했고, 메모리 보존/이력과 독립 Native 저장물 대조에서는 엄격한 비교를 유지했다. 기존 HWP metadata3 차이와 형식 변환 기본값 차이는 해결을 주장하지 않는다. library 표 unit test를 시도했지만 기존 include_bytes 샘플3개 누락으로 컴파일 실패했다. 샘플 대체/검사 제외는 하지 않았다.

보호 파일27,691개 변경0·누락0. 검증 Chrome은 `browser.close()`로 정상 종료했고 서버는 SIGTERM(exit143), 소유 Chrome 잔류0/포트32171닫힘을 확인했다. 기존 원본·기본 앱·dev.3·beta.2·이전 QA·클립보드·권한을 보존했다. 수동 삭제/정리·새 target·앱/ZIP·추가 push/release·보안/계정/인증서/원격 변경 없음.

전체 시도에서 target 최고4.139GiB(한도4.5), QA 최고158.75MiB(추가 한도1GiB), 실제 여유 최소17.237GiB(하한15). 최종 target4.042GiB. [집계 proof](proof.json), 원시 로그/저장물/매니페스트는 `/Users/sw107/Documents/Codex/2026-10-06/task/nested-table-row-qa`에 보존했다.
