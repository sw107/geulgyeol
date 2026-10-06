# 하이퍼링크 후속: GUI 가능성과 표 셀 편집 범위 조사

`d0e542ef9bb8d6851f22eef613bcd62bbcbfb90a`의 본문 링크 후보를 그대로 조사했다. 엔진/UI/API 구현 변경, Cargo 빌드, 앱/패키지 생성, 기존 앱 실행, 권한 변경, URL 열기, 공개 push/release는 하지 않았다.

## 실제 GUI 가능성

현재 제공된 도구에 로컬 화면 조작용 전용 GUI 도구는 없다. 호스트의 `osascript`, `screencapture`, `cliclick` 실행 파일은 존재한다. 한 번의 화면 캡처 시도는 `could not create image from display`로 실패했고 이미지가 생성되지 않았다. 입력 도구의 읽기 전용 위치 조회는 `Accessibility privileges not enabled`를 보고했다. 따라서 이 세션에서 사용할 수 있는 실제 화면/입력 검증 수단을 확인하지 못했다. 원인을 WindowServer 부재나 특정 화면 녹화 권한 하나로 단정하지 않는다. 보안/권한을 바꾸거나 새 앱을 만들어 우회하지 않았다. 실제 Mac GUI·물리 IME 미검증 상태를 유지한다.

원시 근거 `../hyperlink-cell-scope-qa/screen-probe.log`, `input-probe.log`. 사용 가능한 GUI 접근이 생기면 기존 앱을 덮어쓰지 않는 개발 후보와 합성 문서로 본문 메뉴/툴바 삽입·취소·URL 편집·텍스트 보존 해제·undo/redo·저장재열기를 실제 화면에서 확인해야 한다.

## 셀 지원의 현재 경계

최종 기존 WASM SHA256 `47ac09b97f1ce74df713e25453a6219e297b225d84e68f1c77986230f94744f4`를 사용했다. 기존 합성 표 fixture 사본에 기존 serializer의 최소 HYPERLINK begin/end 구조를 넣은 **가져오기용** HWPX 6개를 만들었다. 깊이1/2/3과 병합/비병합이다. 새 셀 링크 저작 기능을 구현한 것이 아니다.

실제 현재 CommandRegistry/CommandDispatcher/bodyHyperlinkCommand/InputHandler/WasmBridge와 기존 WASM을 연결했다. 셀 커서·DOM은 어댑터이고 실제 GUI는 아니다.

| 경로 | 조사 결과 |
|---|---|
| 삽입 메뉴·툴바 공통 `insert:hyperlink` | 일반·중첩 셀에서 `inTable`이 true여서 비활성. 실제 dispatch 6건 모두 `disabled` |
| 명령 직접 실행으로 UI gate 우회 | `getBodyHyperlinkTarget`가 `parentParaIndex`/`cellPath`를 거절. 6건 모두 본문 전용 안내, 대화상자/편집 연산0 |
| 실제 hyperlink WASM export 목록 | `getBodyHyperlinkAt`, `insertBodyHyperlink`, `updateBodyHyperlink`, `removeBodyHyperlink` 4개뿐. 셀 또는 path용 링크 저작 API 없음 |
| 본문 URL 편집·해제 API에 셀 링크 ID 전달 | 12호출 모두 소유 문단 불일치로 거절. HWP/HWPX 전후 전체 출력 바이트·필드/URL/범위·문서 정보·event log 동일 |
| 가져온 셀 링크의 기존 조회·저장 | `getFieldList`는 정확한 cell path/URL/표시 문구/스칼라 범위2..5를 읽음. HWP/HWPX 재열기12건에서 유지 |
| 기존 `getFieldInfoAtInCell`/`getFieldInfoAtByPath` 및 ClickHere 속성 조회 | 커서 필드 조회는 ClickHere 전용 필터라 이 셀 링크에서 `inField:false`; 속성 조회는 `ok:false`. 링크 편집 조회로 재사용할 수 없음 |

결론은 **셀 링크 모델/읽기·쓰기 기반은 있지만 일반 표 셀·중첩 셀의 하이퍼링크 저작 UI/API는 미지원**이다. 본문 API에 셀 문단 번호를 대신 넘기는 방식은 셀 경로를 전달하지 못하며 별도 본문을 잘못 선택할 수 있으므로 사용하지 않는다. 현재 guard는 이 우회를 막고 있다.

## 다음 범위 하나와 최소 변경

다음 범위는 **기존 표의 단일 셀 안 한 문단, 전체 cellPath를 사용하는 하이퍼링크 삽입·URL 편집·텍스트 보존 해제**다. depth1을 같은 path 경로로 처리해 일반 셀과 중첩 셀에 별도 로직을 늘리지 않는다. 본문과 같은 선택 감싸기/선택 없는 표시 문구+URL, 기존 http/https 정책·취소·snapshot undo/redo를 유지한다. 여러 셀/여러 문단 선택, 새 병합 연산, 각주/머리말/글상자 저작, 표시 문구 변경, 실제 URL 열기는 이 다음 범위에 포함하지 않는다.

필요한 최소 구현은 다음과 같다.

1. 기존 `Field/FieldRange` 표현과 본문의 문단 복제·축 검증·URL 갱신/텍스트 보존 해제 동작을 공유하고, `section + parentParaIndex + cellPath`로 정확한 leaf 문단을 먼저 읽기 전용 검증한다. 링크 조회/삽입/URL 편집/해제를 위한 path API를 연결한다. 이름 셀 전체 값 API로 우회하지 않는다.
2. 성공한 셀 변경에만 leaf/ancestor 조판, 표 dirty, section raw_stream 무효화와 셀 변경 이벤트를 적용한다. 기존 `reflow_cell_paragraph_by_path`, `recalculate_cell_paragraph_vpos_by_path`, `mark_cell_control_dirty` 패턴을 사용한다. 본문 finalize를 셀에 직접 적용하지 않는다.
3. 기존 대화상자·명령에서 본문 또는 단일 셀의 정확한 대상과 선택을 캡처한다. 기존 snapshot 이력에 전체 cellPath 커서를 넘기고 undo/redo 뒤 같은 셀로 돌아오는지 확인한다. 셀 guard를 제거하는 것만으로 지원됐다고 간주하지 않는다.

## 문서 참조 위험과 다음 검증 조건

- 셀/중첩 부모 번호와 leaf 문단 번호를 혼동하면 다른 셀이나 본문에 쓰게 된다. 잘못된/빈 path, 다른 셀/문단에 걸친 선택, stale 대화상자는 쓰기 전 거절하고 fallback하지 않아야 한다.
- 이모지의 스칼라 범위와 UTF-16/control 축, paired FIELD_BEGIN/END, control index 이동을 함께 보존해야 한다. 선택 안의 내부 필드·각주/개체·범위 태그·복합 parameter/CTRL_DATA 소유권이 불명확하면 무변경 거절한다. 지원 범위 바깥 각주·이웃 필드·스타일/직접 서식·셀 이름·뒤 문단은 유지해야 한다.
- `field_name` 가상 셀과 실제 Hyperlink/ClickHere는 별도 소유자다. 앞선 `815c5ff`의 전체 셀 값 거절 계약을 유지한다. 같은 ID의 여러 소유자와 imported link의 parameter/instance/raw cache 참조를 임의로 새 링크에 합치지 않는다.
- 기존 `removeFieldAtInCell`은 ClickHere만 처리하고 표시 텍스트도 삭제한다. 링크 해제로 재사용할 수 없다. Bridge의 기존 제거 경로는 nested path도 전달하지 않으므로 새 path 링크 해제에서 우회 사용하지 않는다. `updateClickHereProps`는 종류가 맞지 않는 요청도 순회 시작에서 raw_stream을 무효화하므로 새 URL 편집의 실패 경로로 재사용하지 않는다. 이 기존 API들을 이번 조사에서 변경하지 않았다.
- 셀/상위 표의 dirty와 높이/조판 갱신이 빠지면 화면과 저장 결과가 달라질 수 있다. 다음 구현 검사는 depth1/2/3, 기존 병합 표의 단일 소유 셀, 한글/이모지·혼합 직접 글자/문단 서식·이웃 다른 스타일·독립 필드/바깥 각주, 취소/실패 redo 보존, HWP/HWPX 재열기에서 URL·표시 문구·범위·전체 참조 대조를 포함해야 한다. 긴 세로 셀 조판은 기존 미지원 상태를 유지한다.

이번 조사 target은 전후 `3504779264` bytes로 동일(약3.264GiB), 실제 여유 검사 전 약22.85GiB/후21.97GiB로 4GiB/10GiB 기준을 지켰다. 보호 앱/pkg/기존 후보 해시8개, 본문 후보 WASM 및 생산 소스 해시, 원본 합성 fixture를 모두 보존했다. GUI 창을 열지 않았고 조회/Node 검사 프로세스는 종료했다. 새 Linux·패키징·GUI 검증 없음. 증거 [proof.json](proof.json), 원시 조사 `/Users/sw107/Documents/Codex/2026-10-06/task/hyperlink-cell-scope-qa/probe.mjs`, `manifest.json`, `probe-final.log`, `final-proof.json`.
