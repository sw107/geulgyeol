# occurrence 전달 조사와 다음 Mac 편집 범위

조사 기준 HEAD `815c5ff394794a2406920b538499f331dd0d8708`, 시작 dirty 없음. 제품 소스 읽기, 실제 호환 API의 읽기 전용 문서 spy와 현재 명령의 제한된 재현만 수행했다. 새 엔진 빌드/패키징/공개/삭제 없음.

- 기본 Mac wrapper는 plugins 목록 없이 Studio를 시작한다. 일반 누름틀 UI는 fieldId/커서 경로이며 이름 occurrence를 선택하는 흐름이 아니다.
- HwpCtrl 플러그인은 Mac 빌드에도 포함된 선택형 SDK 경로다. 따라서 ‘Windows OCX 전용’이라고 단정하지 않는다. 기본 Mac 문서 작성보다 낮은 우선순위로 분류한다.
- 실제 OCX 구현+읽기 전용 문서 spy 한 사례: 목록의 `중복{{1}}`와 MoveToField는 두 번째를 가리키지만 GetFieldText는 첫 값, PutFieldText는 순번 없이 base name만 엔진에 전달한다. 실제 문서 변형이나 추가 필드 보존 행렬은 실행하지 않았다.
- WASM export는 이름만 받고 occurrence0을 쓰며 명시 occurrence는 Native/CLI에 있다. 기존 동작을 이번에 수정하지 않았다.

다음 범위는 **일반 본문의 외부 URL 하이퍼링크 삽입** 하나다. 현재 actual insertCommands/CommandRegistry/CommandDispatcher, 정상 본문과 기존 후보 WASM에서 enabled=false/disabled를 확인했다. 전후 HWPX 바이트·필드 동일, 명령 이벤트0. 메뉴 disabled, 툴바 data-cmd 없음. 이 관련 UI 소스가 dev8 빌드의 frozen hash와 같다는 점도 확인했다. Node 명령 검사이며 실제 Mac GUI 클릭/물리 IME 성공이 아니다.

후속 범위는 일반 본문 한 문단 선택 또는 캐럿의 표시 텍스트+외부 URL, 기존 HWP5/HWPX hyperlink 표현 확인, API/대화상자/메뉴/툴바 연결, 취소/비지원 무변경과 서식·참조/이력/저장재열기다. 외부 브라우저 열기와 복합/중첩 셀·하위 영역 확장을 먼저 섞지 않는다. 이번에는 구현하지 않았다.

현재 해결된 스타일/목록/각주/수식·회전/ClickHere/이름 셀 범위, dev8와 미연결 후보 차이, 세로 조판 및 GUI/라이브러리 검사 제한을 [현재 기능 대조](../CURRENT_FEATURE_AUDIT_KO.md)에 갱신했다. 기존 역사 문서는 보존했다.

증거는 `proof.json`과 `/Users/sw107/Documents/Codex/2026-10-06/task/editing-scope-research-qa/probe.mjs`, `probe.log`, `before.json`. 실제 엔진 SHA256 `89bd3c1b3bb7160e24c977c996460203740cffd36f4b2b8120f1fa02588cddaf`를 재사용했다. 최초 target 3.170GiB/여유22.96GiB. 최종 보존 및 상태는 인접 체크포인트에 남긴다.
