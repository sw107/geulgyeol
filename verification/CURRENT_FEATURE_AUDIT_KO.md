# 현재 개발 checkout 기능 대조

기준 소스 HEAD는 `815c5ff394794a2406920b538499f331dd0d8708`이다. 이번 후속 조사는 소스 읽기·기존 엔진의 제한된 명령 재현·문서 갱신만 수행했다. 새 엔진 빌드, 패키징, 공개, 삭제는 없다. 자동 검사와 실제 GUI 확인을 구분하며 한컴 한글 전체 대체 완료를 뜻하지 않는다.

## 소스·후보·앱 구분

| 대상 | 포함 범위 |
|---|---|
| 현재 엔진 소스 / `named-cell-value-qa/pkg` | `815c5ff`까지. 이름 셀의 독립 내부 필드 보호 포함. WASM SHA256 `89bd3c1b3bb7160e24c977c996460203740cffd36f4b2b8120f1fa02588cddaf` |
| 별도 `GeulgyeolDev8.app`, `0.4.4-dev.8` | `6f576bd` 통합 기록. 엔진 소스는 `a59a13c`, WASM SHA256 `592806b2b8f8c3e0f3736512bc17d72e8c919bdb03c71135490957f5f84b4fe1`. 이름 셀 후속 보호는 **미포함** |
| 기존 연결 `pkg` | 이전 `2d9599d` 기준, SHA256 `015e64b941e60f85fb10a86810aaef0909cd4a0f8de3992246b49c13d2a262c7`. 후속 필드 수정은 미연결 |
| dev7 이하 / 공개 beta.2 / 기본 앱 | 기존 기록과 원본을 보존. 아래 새 개발 후보 결과를 이 앱들의 기능으로 주장하지 않음 |

## 일반 편집 기능

| 기능 | 해결·지원된 개발 범위와 근거 | 남은 제한 |
|---|---|---|
| HWP/HWPX 읽기·저장, undo/redo | 지원 명령의 두 형식 저장재열기와 실제 CommandHistory 자동 대조. dev8 통합 재열기278회 | 원본 corpus 전체·한컴 GUI 비교 미완료. 저장이 모든 비지원 제어를 무손실 변환한다는 인증은 아님 |
| 본문 입력·글자/문단 서식 | 기존 InputHandler와 서식·이력 경로 유지 | 실제 Mac 선택/캐럿·물리 IME 미검증 |
| 스타일 모양 전파·삭제·다음 스타일 | 지원 본문·셀·중첩 셀·머리말·각주 경로, 원본 참조/직접 서식·nextStyle 참조 보존, 누적 Native/WASM 및 다음 문단 Enter 검사 | 바탕쪽/불명확 참조 등 지원 밖 경로는 거절. 전체 corpus와 GUI 미완료 |
| 본문 번호 목록 이어쓰기 | `9b85974`에서 기존 정의/이력 연결 수정. dev8 실제 번호 명령20사례·재열기44 | 과거 dev7의 ‘3 대신1’은 이미 해결된 역사 기록. 복잡 조판/실제 화면 확인은 별도 |
| 일반·중첩 셀의 번호 속성/이어쓰기 | `1ce7d49`, dev8 실제 명령78사례·재열기156 | 세로 셀 번호 glyph 표시 미지원. 데이터/저장 보존과 화면 지원을 구분 |
| 표/병합·중첩 문단, 서식 복사 | 지원 셀 경로의 선택/문단 속성·복사/redo 및 참조 보존 누적 검사 | 지원 밖 개체/불명 슬롯 거절, 큰 복합 표 반응성과 GUI 미검증 |
| 각주·미주 서식, 검색/치환 | 지원 글자/문단 서식·다음 입력 예약·조합/삭제·이력 및 Unicode 원문 span 검사 완료 | 정규식/지원 밖 영역 검색, 물리 IME와 대화상자 실제 이벤트 미검증 |
| 셀 다중 수식·회전 그룹 해제 | 일반 셀 다중 수식 정확 조회/편집/삭제, 지원 회전 그룹 해제 참조 보존 | 중첩 개체·불명 저장 슬롯 등의 거절 경계 유지 |
| 일반 ClickHere 삽입/값/제거·이력 | 본문 혼합 서식·각주 앵커와 UTF-16/이웃 필드 소유권 보호. dev8 및 후속 후보에서 기존 회귀 재열기54+4, undo/redo각24, 거절14, 셀 회귀6 | 복잡한 내부/중첩 필드·병합 전체 인증 없음. 값 비우기가 인접 빈 필드 경계에 겹치면 무변경 거절. 일반 타이핑 전체 소유권 확장 인증 아님 |
| 이름 붙은 셀의 값 교체 | `815c5ff`: 일반 텍스트 **첫 문단 전체** 교체 유지. 뒤 문단/이웃 셀/각주·서식 참조 보존. 별도 내부 이름 교체 지원, 가상 셀 범위 조회/ID 경로 분리 | 교체할 첫 문단에 필드·각주/개체·범위 참조 또는 불명 좌표가 있으면 원자 거절. 중복 ID 쓰기 거절, ID 읽기의 기존 첫 일치 동작 유지. dev8 앱에는 미연결 |
| 중복 이름 occurrence | Native/CLI 명시 순번은 `815c5ff` 검사에서 서로 다른 셀/내부 필드 선택 확인. WASM 이름 API는 기존 첫 일치 | 선택형 HwpCtrl 호환 API의 순번 읽기/쓰기 전달 누락. 기본 Mac UI는 이 이름 호출 경로를 사용하지 않음. 아래 우선순위 조사 참고 |
| 셀 방향1/2 저장·짧은 텍스트 회전 | `2d9599d`에서 HWPX VERTICALALL 보존 및 Native/WASM 대조 | 긴 세로 셀의 실제 페이지 분할·세로 번호 glyph 미지원 |
| 세로 다문단/다열 metric·공유 adapter | 독립 계산 `695f01e` 테스트14/생성1,200 및 텍스트 투영8, `4c587f8` adapter 설계 | production 미연결·보류. supplied metric 계산/가상 조각을 실제 앱 페이지로 부르지 않음. 긴 세로 셀 반복 출력·clip 경계 미해결 |
| 쪽/구역·머리말/꼬리말 | 기존 설정 대화상자·API와 지원 하위 문단 스타일 전파 | GUI 조작·복합 조판·바탕쪽 전체 호환 미완료 |
| **하이퍼링크 새 삽입** | HWP5/HWPX hyperlink 모델/읽기·쓰기 기반은 존재 | 현재 `insert:hyperlink`는 disabled stub, 툴바 미연결. 다음 한 가지 편집 범위로 선정 |

이름 셀 후속 검사: Native 정상36/원자 거절169회/재열기72, WASM 정상48/거절188/undo·redo각72/재열기96, WASM 저장물96개를 Native 재귀 문단·셀 각주·필드/서식 참조로 교차 확인했다. [이름 셀 결과](named-cell-value/RESULT_KO.md), [값 교체 결과](field-value-atomic/RESULT_KO.md), [누름틀 보존 결과](clickhere-engine-preservation/RESULT_KO.md), [dev8 통합](dev8-checkpoint/RESULT_KO.md)를 근거로 하며 이번 턴에 이 행렬을 다시 확장하거나 빌드하지 않았다.

## occurrence 조사와 우선순위

기본 Mac wrapper는 `desktop/web/baram.js`에서 `createStudio`를 **plugins 목록 없이** 호출한다. 일반 UI의 누름틀 고치기는 캐럿의 fieldId를 사용하고, 직접 입력은 커서/셀 경로를 사용한다. 이름 occurrence를 고르는 UI 또는 `PutFieldText` 호출은 기본 편집 경로에서 발견하지 못했다.

선택형 SDK는 `plugins.load('hwpctrl')` 뒤 `studio.hwpctrl.invoke/batch`를 제공하고, 이 플러그인은 Mac 빌드에 포함된다. 따라서 Windows OCX에만 국한된 문제가 아니다. 현재 기본 사용자 편집기를 막는 누락과는 구분되는 **선택형 호환/자동화 기능**으로 우선순위를 낮춘다.

실제 `npm/hwpctrl-ocx/src/index.mjs`를 읽기 전용 문서 spy에 연결해 한 사례만 조사했다. `GetFieldList(1,2)`는 `중복{{0}}`·`중복{{1}}`를 낸다. `GetFieldText('중복{{1}}')`는 첫 값을 반환하고, `PutFieldText('중복{{1}}','셋째')`는 실제 엔진에 `setFieldValueByName('중복','셋째')`만 전달한다. `MoveToField('중복{{1}}',...)`는 두 번째 문단으로 이동한다. 읽기·쓰기와 이동의 순번 처리에 불일치가 있다. 실제 문서 변경/필드 corpus 검사 없이 호출 전달만 관찰했다.

WASM에 `setFieldValueByNameAt` export가 없고 기존 `setFieldValueByName`은 엔진 occurrence0으로 간다. 별도 legacy `src/hwpctl/index.ts`는 순번 토큰을 그대로 이름으로 전달하며 기본 main 진입점에서는 그 클래스 호출이 보이지 않는다. 후속 호환 작업 시 OCX 정렬과 Native 문서 순서가 다른 점도 고려해야 한다. 이번에 API 선택 계약/동작을 바꾸지 않았다.

## 다음 범위 하나: 일반 본문의 외부 URL 하이퍼링크 삽입

정상 문서 `보고서 참고 자료`에서 현재 실제 `insertCommands`, `CommandRegistry`, `CommandDispatcher`를 실행했다. `isEnabled`는 false, dispatch는 `{ok:false, reason:'disabled'}`, 문서 HWPX SHA256 전후 동일, 필드/command 이벤트 변화 없음. 삽입 메뉴 HTML은 disabled이고 툴바 하이퍼링크 버튼에는 data-cmd가 없다. 관련 UI 소스 해시는 dev8 빌드 provenance와 일치한다. 기존 `named-cell-value-qa/pkg` 엔진을 초기화했으며 새 엔진을 만들지 않았다. 실제 GUI 클릭 검사는 아니다.

제안 범위는 지원 일반 본문 한 문단의 선택 텍스트에 외부 URL을 연결하거나, 캐럿에 표시 텍스트와 URL을 넣는 기능이다. 기존 HWP5/HWPX FieldType::Hyperlink 표현을 먼저 확인해 API·대화상자·삽입 메뉴/툴바를 연결하고, 취소/유효하지 않은 URL/비지원 대상 무변경, 텍스트·직접 서식·이웃 스타일/문서 참조, undo/redo와 두 형식 재열기를 검증한다. 링크를 생성하는 기능과 외부 브라우저를 실제 여는 권한/동작은 분리해 범위를 확정한다. 첫 구현에서는 중첩 셀·머리말/각주·필드 중첩/복합 선택을 섞지 않고 거절 경계를 명시한다. 기존 ClickHere/이름 셀 보존 검증을 계속 확대하는 작업으로 대체하지 않는다. **이번 턴에는 구현하지 않았다.**

조사 원시 근거: `../editing-scope-research-qa/probe.mjs`, `probe.log`, [집계 proof](editing-scope-research/proof.json). 해당 스크립트는 repository production/test 코드로 추가하지 않았다.

## 현재 검증 한계·자원

Mac 실제 GUI/물리 IME·이번 Linux 검증 없음. dev8의 strict ad-hoc 서명·자산 서빙·정상 종료는 통과했던 패키징 기록이며 실제 편집 GUI 성공으로 확대하지 않는다. 전체 library unit test는 기존 누락 include_bytes fixture3개로 막혀 있으며 복구/대체/검사 제외로 우회하지 않았다.

조사 시작 HEAD `815c5ff`, dirty 없음. target은 이전 최종3.170GiB 그대로, 실제 디스크 여유 약22.96GiB. 이번 엔진 빌드/패키징/공개/삭제/캐시 정리 없음. 후보 WASM, dev8 ASAR, 연결 pkg를 보존한다. 이 문서와 조사 증거만 로컬 커밋하며 과거 dev7/dev6 등의 기능 기록은 수정하지 않는다.
