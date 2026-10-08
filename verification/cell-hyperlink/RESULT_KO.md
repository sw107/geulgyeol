# 단일 셀 하이퍼링크 구현·검증

기준 `0e68e38` 이후 **같은 셀 안 한 문단**에 링크 삽입, URL 편집, 텍스트 보존 해제를 구현했다. 일반·중첩 셀을 전체 `cellPath`로 선택하며 같은 이름/인덱스의 이웃 셀을 수정하지 않는다. 기본 앱·기존 앱/후보·공개 beta.2에는 연결하지 않았다.

본문과 셀의 문단 편집을 공통 staging/검증 함수로 처리한다. 모든 검증이 끝난 문단 사본만 반영하며 기존 문자·문단·스타일 ID와 필드/각주를 유지한다. 모든 상위 표와 저장 raw stream, 페이지 트리를 무효화한다. 전용 path 조회/삽입/URL 편집/해제 API4개를 추가하고, 기존 `insert:hyperlink` UI 명령을 연결했다. 실제 SnapshotCommand/CommandHistory로 처리한다.

선택은 같은 셀·문단이어야 하고 URL은 명시적 http/https만 허용한다. 빈/잘못된 path나 소수/음수 좌표를 기본 셀로 바꾸지 않는다. 셀/문단 경계 선택, 각주·머리말·글상자 저작, 셀 블록 선택, 겹친 필드/각주 앵커/불명 축, 다른 소유자 ID, 복합 매개변수·별도 참조 데이터는 편집 전에 거절한다. 기존 링크의 표시 문구는 읽기 전용이며 해제해도 텍스트와 직접 서식이 남는다. 대화상자 이후 문서/소유 셀 변경은 거절한다. 외부 URL 실행0.

| 검사 | 최종 결과 |
|---|---|
| Native 깊이1~3 × 병합/일반 셀6종 | 정상36, HWP/HWPX 재열기84, snapshot undo/redo36쌍, 전체 DebugDocument/raw/dirty/event 무변경 거절96 |
| 실제 후보 WASM + 현재 UI 명령/대화상자/dispatcher/Bridge/InputHandler/History | 정상84, 재열기288, undo/redo각84, 무변경 거절·취소444사례 |
| 상위 표 레이아웃 | 한 페이지 내 높이 증가12사례; 별도 긴 문구12사례에서 페이지 증가와 SVG 전체에 반복80개 출력 |
| UI 저장물 Native 독립 대조 | 264파일: 문자·문단·스타일 ID, 링크 URL/범위, 이웃 셀·본문·각주 참조와 해당 입력 정의 보존 |
| 본문 링크 회귀 | Native 정상5/재열기12/거절21; UI 정상6/재열기22/undo·redo각6/거절36; 저장물22 Native 독립 대조 |
| 기존 필드 회귀 | ClickHere 재열기54+추가4, undo·redo각24/거절14/셀6; 이름 셀 정상48/거절188/재열기96/undo·redo각72; 값 원자성 정상10/비지원18 모두 거절 |
| 컴파일·정적 검사 | Native/WASM release build, 후보 선언으로 TS, Clippy lib+두 example `-D warnings`, 신규 mutation 분류 통과 |

444는 **검사 사례 수**다. malformed path/index 사례는 각 사례 안에서 조회/삽입/URL 편집/해제4개의 원시 API를 모두 검사한다. 실패/취소는 전체 문서 모델·HWP/HWPX 출력 바이트·event log·undo/redo 스택이 동일하다. 같은 이름 셀, 독립 ClickHere, 혼합 직접 서식·스타일, 한글/emoji/비BMP, 인접 링크를 포함했다.

초기 검사 중 빈 필드 이름의 None/빈 문자열 저장 정규화와 새 Field 제어 추가를 예상 모델에 반영했다. 큰 표의 첫 페이지 bbox만 비교한 실패는 페이지 분할을 높이 감소로 오인한 검사 문제였다. 한 페이지 bbox 검사와 전체 페이지 SVG 검사를 분리해 모두 통과했다. 원시 실패 로그도 QA에 보존했다. 엔진의 검증 거절을 완화하지 않았다.

최종 별도 WASM SHA256 `b065061056644c753ad475fb16b330fef96108a8438dab2d6481482865ab7198`. 이전 앱/pkg8개와 본문 후보1개 해시가 전후 동일하다. target 최고 3.419GiB/최종 3.332GiB, 작업 시작 및 감시 여유 최저 21.858GiB로 4GiB/10GiB 기준을 지켰다. 캐시 삭제·의존성 설치·새 패키징·공개 작업 없음.

**실제 Mac GUI/물리 IME 미검증**이다. DOM·커서·repaint adapter를 사용한 실제 코드 자동 검사이며 화면 클릭 성공으로 주장하지 않는다. 기존 화면 캡처 실패/Accessibility 비활성 상태를 유지했고 권한 변경 없이 진행했다. 이번 Linux 실행 없음. 전체 Rust library test는 기존 누락 fixture3개로 막혀 있으며 복구·대체·제외로 우회하지 않았다. 전체 한컴 corpus/GUI 호환 인증은 아니다. 다음은 사용 가능한 GUI 환경에서 별도 후보를 연결해 메뉴/툴바·선택·IME·저장재열기를 확인하는 것이다.

근거 [proof.json](proof.json). 재현 소스 [cell_hyperlink_check.rs](../../engine/examples/cell_hyperlink_check.rs), [check-cell-hyperlink.mjs](../../scripts/check-cell-hyperlink.mjs). 원시 후보/문서/로그와 재현 명령은 `/Users/sw107/Documents/Codex/2026-10-06/task/cell-hyperlink-qa/CHECKPOINT_KO.md`에 있다. 앱 GUI 창을 열지 않았고 검증 프로세스는 정상 종료했다.
