# 주석이 있는 본문의 앵커 안정화

기준 로컬 커밋 `365f7cd`의 단일 구역·본문 한 문단 주석 저작 범위를 유지한다. 기존 Field/FieldRange와 저장 구조를 사용하며 셀 주석, 문단 간 주석 범위, 주석 메타데이터 편집으로 확장하지 않았다. 새 후보는 `comment-anchor-qa/pkg`이다.

## 정상 편집

- 일반 본문에서 주석 앞·안·뒤 삽입/삭제, 한글·이모지·BMP 밖 문자와 local 교체를 검증한다. 주석 시작/끝 경계의 일반 입력은 선택 범위 밖에 둔다. 인접 주석 사이의 입력은 앞 주석을 늘리지 않고 뒤 주석의 시작을 이동한다. 삭제는 남은 본문에 맞춰 범위를 축소하며, 소유권이 모호해지지 않는 단일 빈 앵커는 유지한다. 그 빈 앵커에 새 본문을 입력하면 앵커가 입력 뒤로 이동하며 주석 내용은 바뀌지 않는다.
- 주석 내용·작성자·시각·필드 ID/index/parameters와 이웃 주석·각주·직접 글자 서식/스타일 참조를 유지한다. 일반 메모의 HWP/HWPX 저장재열기, 명시적 생성 시각·세로 메모의 HWPX 저장과 HWP 무변경 거절을 구분한다. 메타데이터 규칙은 이전 저작 후보와 같다.
- 주석과 구조/필드 제어만 있는 단순 텍스트 문단에서는 주석 범위 밖/시작/끝 및 인접 주석 경계의 분할과 합치기를 허용한다. Field control과 범위를 함께 이동하고 합친 뒤 저장 좌표를 재구성한다.
- 실제 InputHandler의 일반 입력/삭제/Enter/문단 합치기 명령이 주석 문단을 건드리면 snapshot CommandHistory를 사용한다. 역방향 입력만으로 복원할 수 없는 축소된 범위·혼합 서식·필드 참조를 정확히 되돌린다. 주석 문단의 이 명령들은 입력 합치기 대신 각각 이력에 기록한다. 일반 주석 없는 문단은 기존 이력 경로를 유지한다. 한 문단 선택 삭제는 기존 fragment 명령/복원을 사용한다.

## 편집 전 원자 거절

- 주석 내부의 문단 분할: 기존 split_at이 범위를 자르거나 내부 문구를 다른 문단으로 보냈으므로 거절한다.
- 주석과 각주/개체가 같이 있는 문단의 분할·합치기: 문자 좌표와 제어를 포함한 논리 좌표를 구분해야 하므로 현재 작은 범위에서는 거절한다. 같은 문단의 일반 텍스트 삽입/삭제는 별도 정상 경로다.
- 주석이 포함된 문단 간 선택 삭제, 중복 필드 ID/index, 겹친/중첩 필드 범위, 불명 소유/표식/고아 참조, 본문 range tag가 있는 주석 문단을 거절한다. 삭제로 여러 빈 앵커가 한 위치로 합쳐지거나 이웃 필드 경계와 모호해지는 경우도 거절한다.
- 거절 시 원문·본문 서식·주석 metadata·이벤트와 undo/redo 스택을 보존한다. 저장 시 처음 알리는 대신 편집 진입 전에 검사한다. 알려진 원본의 opaque 메타데이터를 HWP로 보존하는 계약과 미해석 앵커를 편집하는 것은 구분한다.

## 실제 수정과 검증

기존 내부 분할의 범위 유실과 각주 분할 좌표 차이를 이전 후보에서 재현했다. 합치기 뒤 두 번째 Memo control의 위치가 문단 끝으로 밀리는 결함은 해당 문단의 char_offsets를 다시 구성해 고쳤다. 시작 경계/빈 주석의 입력과 확장 제어 좌표 보정에 Memo를 포함했다. body insert/delete/local replace/split/merge/deleteRange의 변경 전 앵커 검사를 추가했다.

작은 합성 문서의 Native reader와 실제 WASM, 실제 InsertTextCommand/DeleteTextCommand/SplitParagraphCommand/MergeParagraphCommand/DeleteSelectionCommand·InputHandler·CommandHistory를 실행한다. DOM·geometry·paint만 adapter다. 주석 선택 범위·본문/주석 텍스트·ID/metadata·각주·서식 참조를 확인하고 WASM 저장물을 Native에서 독립 명령 재실행/재열기한다. 정상 편집 수와 원자 거절 수는 [proof.json](proof.json)에 따로 기록한다. 테스트는 `engine/examples/body_comment_anchor_check.rs`, `scripts/check-body-comment-anchor.mjs`, 합성 저장물/실패 경위/최종 로그는 `comment-anchor-qa`에 있다.

Native 정상 편집36건·재열기72회·원자 거절30건, 실제 WASM/UI 정상 명령43건·재열기168회·원자 거절36건·undo/redo각43회가 통과했다. 저장물168개를 Native에서 독립 명령 재실행/재열기했다. 기존 저작 Native40회·WASM/UI64회(독립 Native64), 본문 링크22·셀 링크288·누름틀54 및 TypeScript·Clippy도 통과했다.

최고 target 약3.700GiB/최종3.608GiB·최소 여유22.240GiB로 예산을 지켰다. 기존 앱/후보/엔진16개 기준 해시(15개 고유 경로)를 전후 보존했다. 초기 제품 결함 재현과 UI adapter 보완의 실패 로그는 최종 통과 결과와 구분해 남겼다.

## 한계와 다음 확인

Mac arm64 자동 검사다. 실제 GUI·물리 IME·전체 한컴 corpus·Linux 실행은 미검증이다. local 한글 교체를 실제 IME 성공으로 주장하지 않는다. 분할의 제어 좌표 통합, 문단 간 주석 범위 표현, 셀 주석은 후속 설계가 필요하며 이번에 확장하지 않았다. 단위 테스트 전체는 기존 include_bytes fixture3개 누락으로 차단되며 변경 경로 실행형 검사·Clippy·TypeScript와 구분한다.

기존 앱·원본 문서·dev3/dev9·공개 beta.2·이전 후보 엔진을 보존했다. 새 패키징/서명/GUI 기동·공개 push/release·보안/계정/권한 변경 없음. 다음은 별도 Mac 후보에서 실제 캐럿/선택·입력/삭제·대화상자와 허용된 실제 메모 corpus를 확인하는 것이다.
