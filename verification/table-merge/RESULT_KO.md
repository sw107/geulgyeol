# 표 셀 병합의 문단 참조 보존

기준 `317087a`에서 코드를 대조하고 작은2×2표로 **비주 셀 병합의 링크 소실 결함 하나**를 선택했다. 오른쪽 셀의 표시 글자는 남지만 링크 소유 정보가1개→0개가 됐다. `Table::merge_cells`의 일부 필드 재구성이 controls·field_ranges·CTRL_DATA·TAB/제목표시/문단 번호 메타데이터를 빠뜨리는 것이 원인이다. 기존 기본 병합과 완료 기능을 반복 구현하지 않았다.

## 수정 범위

의미 있는 비주 셀 문단을 `Paragraph::clone`으로 통째로 이관한다. 텍스트 없이 제어·필드/고아 끝·range tag·제목표시·CTRL_DATA만 가진 문단도 보존한다. 주 셀 문단은 유지하고 참조 없는 빈 비주 문단은 기존 생략 정책을 유지한다. 문단 내부 scalar/UTF-16 축·직접 서식·스타일 ID·참조 소유권을 함께 옮기며 기존 Native reflow와 UI snapshot을 이용한다.

같은 병합 API에서65536행·-0.5·NaN이 정상 병합으로 변환됨도 재현했다. positional 좌표는 유한·비음수 정수/행열u16 범위를 검증한다. options는 필요한7정수 좌표를 모두 요구하며 누락·오형식·범위 초과·추가 키를 변경 전에 거절한다. 기존 Native 범위/부분 겹침 검사 유지. 다른 표 API의 숫자 계약은 이번 범위 밖이다.

## 통과 결과

| 검사 | 결과 |
|---|---|
| Mac 현재 소스 병합 |7종×가로/세로/전체21편집·84이력쌍·HWP/HWPX84재열기 |
| HWP 원시 캐시 입력 |링크/다중 수식2편집·8이력쌍·두 형식8재열기 |
| Mac 인접 조작 |병합 뒤 행/열 추가·삭제 및 실제 셀 나누기 대화상자5편집·20쌍·20재열기 |
| 합계 |준비 병합 제외28검사 편집·112undo/redo쌍·112재열기. 각4회 반복, 모두 HWP/HWPX undo/redo 바이트와 전체 SVG 정확 일치 |
| Mac 잘못된 입력 |숫자49/options6/부분 겹침1 =56건, 문서 바이트/SVG·이력·pending redo 무변경 |
| 독립 Native 대조 |GUI 저장112파일. Native 편집 및 중간 저장재열기 순서를 재실행해 문단 IR·controls/field ownership·typed DocInfo·BinData·전체 SVG 비교 |
| Native 자체 검사 |병합21+인접5·snapshot104쌍·104재열기·잘못된 범위/대상147거절 |
| 기존 셀 링크 |84정상·288재열기·undo/redo각84·444거절/취소·레이아웃12/다중쪽12. 저장264 Native 독립 대조 |
| 기존 다중 수식 |72사례·288재열기·snapshot 이력 연산504·잘못된 입력10거절, 본문/이웃 보존 |
| 정적 검사 |WASM/Native 빌드·후보 선언 TypeScript noEmit·Clippy lib+3example `-D warnings`·새 example rustfmt·git diff --check 통과 |

7종은 혼합 서식, 링크, 누름틀, 다중 수식, 중첩 표 내용, 텍스트 없는 책갈피, TAB/제목표시/번호 메타데이터다. 중첩 내용을 가진 **루트 셀**의 병합을 검사했으며 중첩 표 자체의 모든 명령 경로를 인증한 것은 아니다.

Mac은 실제 DOM/Canvas2D/Cursor/dispatcher/InputHandler/CommandHistory다. 위치/셀 범위는 DEV Cursor, undo/redo는 Chrome 키 경로다. 행열4명령은 dispatcher, 셀 분할은 실제 대화상자의 나누기 버튼이다. 저장은 `baramHost.export` content-loss gate, 재열기는 실제 file-input/FileReader다. [확인한 화면](/Users/sw107/Documents/Codex/2026-10-06/task/table-merge-qa/adjacent-source-browser.png). 물리 IME·OS Cmd+V·마우스 hit-testing·설치 Electron host·네이티브 OS 저장·한컴·Linux는 미검증이다.

## 비교와 준비 오류

이관 전후는 조판 캐시와 재생성 count를 제외하고 문단 controls·범위·원시 소유 데이터/메타데이터·문자 축을 비교한다. HWPX→HWP의 생성 raw/packed 레코드·마지막 문단 bit, 빈 이름·중복 Command parameter는 저장 표현으로 구분했다. 독립 Native는 같은 형식 저장재열기의 전체 canonical 문단 IR·typed DocInfo·이미지·SVG를 대조하고 DocInfo raw/provenance 캐시를 제외한다. 이름 셀 fieldId는 위치 기반 locator여서 이동 때 바뀔 수 있고, 저장 Field ID와 이름/값은 별도로 보존한다.

초기 준비 오류는 빈 이웃 문단의 offset1, 존재하지 않는 Cursor exitCellMode, 빈 비주 문단 기대값, raw 저장 표현 전체 동일 가정, 위치/list 번호와 계산된 셀 ID를 불변 ID로 비교한 것이다. 인접 Native 재실행에는 GUI 중간 HWPX 재열기를 명시했다. 제품 결함으로 세거나 거절을 완화하지 않았으며 실패 로그를 보존했다.

## 보존·한계

보호23371파일 변경/누락0. 추가 QA 최대76.22MiB, 공유 target 최대4.118GiB/최종4.036GiB, 실제 여유 최저18.997GiB. 추가1GiB/target4.5GiB/free15GiB 한도 유지. 이전 후보·앱·문서·프로필·클립보드·권한을 보존했다. 새 target·앱/ZIP·공개·삭제/정리·보안/계정/인증서 변경 없음. Chrome finally close, 자체 서버83646 SIGTERM 뒤 도구 종료143, 잔류0/포트32168닫힘 확인.

이번 표 바이트 일치는 [이전 Mac 검사](../mac-source-ui/RESULT_KO.md)의 HWP 줄/캐럿 메타데이터 차이3건의 해결 주장이 아니다. 해당 한계와 `317087a` 혼합 캡션 기능 유지. 전체 lib unit test는 기존 fixture3개 누락으로 미실시다. 모든 복합/손상 표와 중첩 명령 대상·외부 한컴 전체 호환 인증은 아니다.

다음 확인은 Electron 후보 연결·OS 저장/물리 입력과 중첩 표 자체의 명령 대상/셀 선택 경로다. 이번 소스를 앱에 통합하거나 공개하지 않았다.

## 재현 자료

QA `/Users/sw107/Documents/Codex/2026-10-06/task/table-merge-qa`에 재현 전후·실패 로그·저장물·후보·보존/예산/종료 증거를 유지한다. WASM SHA256 `10bee4f8edc18df7c581a9cc5cc4364fb4d4773aa82ce1831597b4739485135e`. [집계·해시](proof.json). [Native 검사](../../engine/examples/table_merge_preservation_check.rs), [현재 소스 Mac 검사](../../scripts/check-table-merge.mjs)를 소스에 포함했다.

```sh
python3 ../table-merge-qa/run-budgeted.py native-check ../style-lint-qa/target/debug/examples/table_merge_preservation_check ../table-merge-qa/native
python3 ../table-merge-qa/run-budgeted.py native-ui ../style-lint-qa/target/debug/examples/table_merge_preservation_check ../table-merge-qa --verify-wasm
python3 ../table-merge-qa/run-budgeted.py native-adj ../style-lint-qa/target/debug/examples/table_merge_preservation_check ../table-merge-qa --verify-adjacent-wasm
```

Mac 드라이버는 공식 Vite 설정/localhost32168/QA 캐시/pkg를 연결한 `serve.mjs`와 함께 쓴다. 기존 dev11 실행 파일은 Node CLI로만 사용했으며 설치 앱 엔진 성공으로 주장하지 않는다.
