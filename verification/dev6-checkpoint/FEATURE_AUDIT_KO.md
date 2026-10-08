# 한컴 대체 기능 대조와 다음 실제 누락 한 가지

2026-10-06 로컬 `a6dee6a` 엔진/Studio와 dev.6 패키지를 기준으로 README·DEV_CHANGES_KO·누적 검증 기록을 대조했다. 아래는 일반 문서 작성 흐름의 주요 기능군이며 한컴 전체 기능 명세나 실제 GUI 인증 목록은 아니다. 공개 앱과 이 개발 후보의 지원 범위를 합쳐 세지 않았다.

| 문서 작성 기능 | 현재 로컬 구현과 근거 | 남은 경계 |
|---|---|---|
| HWP/HWPX 읽기·사본 저장 | 파일 호스트·두 serializer, 패키지 엔진의 반복 저장재열기 | 암호 저장/64MB 초과 제외, 전체 corpus·한컴 GUI 비교 미완료 |
| 본문 입력·글자/문단 모양·undo/redo | InputHandler/ApplyCharFormatCommand/ApplyParaFormatCommand, 본문 모양복사 자동 검사 | 빠른 물리 한글 IME·실제 화면 캐럿/선택 미검증 |
| 표·병합·셀 속성 | table_ops, F5 범위·제외 셀·두 형식 저장, 실제 FindDialog 셀 치환 redo/SVG 검사 | 긴 행/복합 쪽 분할 미완료, 중첩 문단 직접편집 누락 |
| 모양복사 | 일반/중첩 셀 자체 모양, 같은 셀의 글자 선택·문단 모양; dev.6 실엔진 30건 | GUI 선택 이벤트 미검증, 다른 셀을 가로지르는 텍스트 선택 거절 |
| 스타일·다음 문단 스타일 | 생성/메타데이터/삭제/모양 전파/nextStyle Enter와 참조 보존, 관련 native/WASM 검증 | 바탕쪽·불명확한 참조 거절; 모든 UI 적용 문맥 완료로 해석하지 않음 |
| 찾기·바꾸기 | 본문/지원 셀의 Unicode casefold·원문 scalar span, FindDialog 하나/전체 치환 | 정규식 미지원, 지원 밖 개체·헤더/노트의 검색·치환 경계 유지 |
| 셀 수식 | 일반 1단계 표 셀의 여러 인라인 수식 개별 삽입/조회/편집/삭제 | 중첩 표·글상자 및 혼합 개체/필드 삽입·삭제 제외 |
| 그림·도형·그룹 | 기존 그림 편집과 유효한 단일 저장 줄의 회전 그룹 해제 | 중첩/기울기/불명 슬롯 그룹 해제 등 거절 경계 유지 |
| 머리말·각주·쪽 조판 | 기존 모드 편집과 하위 문단 스타일 전파/Enter 경로 | 복합 조판·바탕쪽 전체 보존·GUI 저장 대화상자 추가 확인 필요 |

## 선택한 후속 범위: 중첩 셀 문단 모양 직접 편집

문단 정렬·줄 간격·들여쓰기는 표의 제목·설명·신청서/보고서 양식을 다듬는 기본 동작이다. 2·3단계 중첩 셀에서도 툴바/단축키와 문단 모양 대화상자가 올바른 문단을 조회하고 편집해야 한다. 이번 모양복사는 별도 경로로 연결됐지만 직접 문단 편집의 대상 산출·조회에는 누락이 남아 있다.

실제 UI/API 근거:

- `rhwp-studio/src/command/commands/format.ts:201`: 가운데 정렬 명령이 `applyParaAlign`을 호출한다. `:90` 줄 간격, `:274` 문단 모양 대화상자도 이미 노출돼 있다.
- `rhwp-studio/src/engine/input-handler.ts:2445`: `getParaFormatTargetsForRange`가 cellPath 깊이>1이면 빈 배열을 반환한다. `:2436` 셀 블록 대상도 cellPath가 있으면 빈 배열을 반환한다.
- `input-handler.ts:5703`: 일반 `getParaProperties`는 cellPath의 최내곽 주소를 쓰지 않고 flat control/cell/paragraph 주소로 조회한다. 합성 입력에서 표시 marginLeft=0, 실제 최내곽=8px이었다.
- `engine/src/document_core/commands/formatting.rs:1699`: native 경로 기반 문단 formatter는 존재한다. 독립적인 일반 `applyParaFormatInCellByPath` WASM/Bridge setter는 없으며, 새 모양복사 API는 복사 범위/지원 항목에 한정된다. 엔진 전체를 새로 만들 필요는 없다.

`check-nested-paragraph-gap.mjs`는 dev.6에서 추출한 실제 WASM과 현재 InputHandler 메서드/ApplyParaFormatCommand로 실행했다. 커서·DOM·dispatch는 headless adapter다. 일반 셀 4개 대조군(정렬/줄간격/대화상자 들여쓰기/셀 블록 정렬)은 실제 문단을 변경했다. 2·3단계 중첩의 8개 요청은 명령 호출0, HWPX 바이트 및 전체 SVG 무변경이었다. 실패한 테스트를 새 기능으로 이름 붙인 것이 아니라, 노출된 기본 작성 명령의 명시적 빈 대상 분기와 잘못된 조회를 재현한 것이다.

후속 완료 기준은 최내곽 문단의 정확한 조회, 캐럿/텍스트 선택/다중 문단/F5 블록·제외 셀 대상 산출, 정렬·줄 간격·여백·들여쓰기의 직접 적용이다. 이웃·본문·텍스트·글자 run·스타일/문서 참조를 보존하고, 대상 경로·참조를 모두 사전 검사한 단일 명령으로 undo/redo 및 HWP/HWPX 재열기를 확인한다. 본문/일반 셀·머리말/각주 경로도 보존한다. GUI 도구가 없으면 실제 화면 이벤트·IME 성공을 주장하지 않는다.

이번 턴에는 후속 기능을 구현하지 않았다. 제안은 위 한 가지이며, 미복원 corpus 3개로 막힌 전체 라이브러리 검사를 반복하지 않았다.
