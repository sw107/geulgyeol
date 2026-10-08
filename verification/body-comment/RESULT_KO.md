# 제한된 본문 검토 주석 저작

기준은 기존 메모 저장 보존 커밋 `2c60318`이다. 기존 Field/FieldRange와 메모 꼬리 표현, snapshot CommandHistory를 재사용해 본문 주석 저작을 연결했다. 새 엔진 후보는 `comment-authoring-qa/pkg`이며 기본 앱·공개 beta.2·dev9 앱에는 통합하지 않았다.

## 지원 계약

- 단일 구역 문서의 일반 본문 한 문단에서 비어 있지 않은 선택에 주석을 추가한다. 주석 안의 캐럿 또는 전체 범위 선택으로 조회·내용 수정·삭제한다. 여러 개의 인접 주석과 이웃 필드를 유지한다. 내용은 본문 텍스트와 분리된 일반 텍스트이며 최대4096 UTF-16 단위·32문단이다. 빈 중간/마지막 문단과 한글·이모지·BMP 밖 문자를 지원한다.
- 기존 작성자·명시적 생성 시각·parameters/command는 내용 수정 중 유지한다. 새 주석은 작성자 빈 값, 생성 시각 없음으로 만든다. 현재 사용자·기존 작성자를 추정하거나 사칭하지 않으며 대화상자에 이 규칙을 표시한다. 메타데이터 편집 기능은 추가하지 않았다.
- 일반 새 주석과 재구성 가능한 기존 수평 메모는 HWP/HWPX로 저장한다. HWP가 보존하지 못하는 명시적 생성 시각/추가 parameters 또는 세로 메모는 HWPX만 허용하며 UI에 안내한다. 형식 변환의 실패를 성공으로 처리하지 않는다.
- 완전히 해석되고 유일하게 소유된 HWP 메모 꼬리/제어만 저작용 모델로 옮긴다. 불명 레코드·시각·변경 추적 참조, 중복 필드/메모/문단 ID, index 불일치, 복합 메모 서식·내부 제어, 비본문 메모가 있으면 저작 전에 거절한다. 복수 구역의 기존 읽기/보존은 유지하지만 저작은 거절한다.
- 셀·중첩 셀·머리말·각주·개체·여러 문단/구역·겹친 필드 선택은 지원하지 않는다. 경계의 각주와 이웃 필드는 보존하고 선택 내부 제어/범위 참조는 거절한다. 삭제로 비어 있는 주석 앵커도 인접 필드 소유권이 모호하지 않으면 조회·내용 수정·삭제할 수 있다.

## 구현과 검증 방법

Native/WASM에 getBodyCommentAt/insertBodyComment/updateBodyComment/removeBodyComment를 추가하고 삽입 메뉴·CommentDialog·WasmBridge·InputHandler의 snapshot 이력에 연결했다. 본문 선택 텍스트는 읽기 전용으로 표시하며 메모 textarea만 수정한다. 대화상자를 연 뒤 선택·문서·모드가 바뀌면 다시 선택하도록 거절한다. 취소·동일 내용·닫힌 대화상자 재적용은 이력을 추가하지 않는다. JavaScript 원본 UTF-16을 먼저 검사해 손상된 surrogate가 변환 중 대체되지 않도록 했다.

메모 문단 ID를 HWP 저장에서 덮어쓰던 부분을 resize로 고치고, HWPX에서는 기존 메모 하위 문단의 양수 ID를 예약해 재출력한다. 다른 새 문단 ID 발급은 예약 ID를 피한다. 문서 전체 문단 ID 정책을 다시 설계하지 않았다.

검사는 합성 문서와 허용된 이전 fixture에 한정한다. 실제 Native reader, WASM exportWithReport, 실제 UI 대화상자/dispatcher/bridge/InputHandler/SnapshotCommand/CommandHistory를 사용했다. DOM·커서 geometry·화면 그리기만 adapter다. 본문·메모 내용·필드 범위/ID·작성자/시각·각주·스타일/직접 서식을 대조하고 WASM 저장물을 Native에서 독립 재열기/명령 재실행으로 확인한다. content-loss count만으로 성공을 판정하지 않는다.

Native 주석 저장재열기 40회와 별도 문단 ID 1/42 재열기 4회, 실제 WASM/UI 주석 변경14회·저장재열기64회·거절/취소55회·undo/redo각16회가 통과했다. WASM 저장물64개를 Native에서 독립 명령 재실행·재열기했다. 기존 메모 Native32/WASM37(독립 Native37), 본문 링크22·셀 링크288·누름틀54, 값 교체 정상10/거절18 회귀와 TypeScript·Clippy도 통과했다.

target 최고3.631GiB/최종3.541GiB, 여유 공간 최저22.240GiB로 4GiB/10GiB 기준을 지켰다. 기존 앱/후보/엔진 15개 기준 해시(14개 고유 경로)를 보존했다.

최종 수치·WASM SHA256·로그·소스 및 보존 해시·자원 측정은 [proof.json](proof.json)에 기록한다. 테스트 원본은 `engine/examples/body_comment_check.rs`, `scripts/check-body-comment.mjs`; 자동 검사 저장물·로그·패치 백업은 작업 루트 `comment-authoring-qa`에 있다.

## 한계와 다음 확인

Mac arm64 자동 검사이며 실제 Mac GUI·물리 IME·한컴 GUI 호환성·실제 메모 corpus·Linux 실행은 미검증이다. 새 앱 패키징·서명·GUI 기동·공개 push/release·보안/계정/권한 변경을 하지 않았다. 사용하지 않는 검증 GUI 창은 열지 않았으며 Node 실행은 모두 정상 종료한다.

전체 lib 단위 테스트는 기존 include_bytes fixture 3개(교육 통합 HWP, HWP3 sample16 변환본, aift.hwpx)가 없어 컴파일되지 않는다. 대체 파일이나 검사 제외로 우회하지 않았다. 변경 경로의 실행형 검사·Clippy·TypeScript 결과와 이 한계를 구분한다. 다음은 별도 Mac 후보 통합 후 실제 선택/캐럿·대화상자·IME와 허용된 한컴 메모 corpus 대조다.
