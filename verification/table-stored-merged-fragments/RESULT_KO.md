# 부분 저장 프레임과 병합 셀의 조각 경계

PR 7의 소스 `23681741320f8ac51ea775ede2b2863d1760ea54`를 보존하고 병합 main `795f93cf48c86cf0f9b52d1ce60c10f7b411664b`에 후속 수정한다. 이전 검증문서의 65.4px 진단은 요청대로 `LAYOUT_OVERFLOW type=PartialParagraph`로 정정했다.

## 재현과 수정

기존 합성 HWP를 바탕으로 객체 높이만 짧게 저장한 7종의 HWP/HWPX를 만들었다. 셀 높이와 저장 LINESEG는 유지하며, 일반 표·중간/끝/긴 rowspan·머리행 rowspan·colspan을 포함한다. 별도 짧은 행 사례는 셀 높이 1300HU 안에 실제 저장 줄 높이 1000HU가 들어가고 객체 프레임 31200HU는 24행 경계에 해당한다. 나머지는 객체 높이 40000HU인 스트레스 사례다. Native 원본 모델에서 14개 파일 모두 셀 격자가 중복·누락 없이 덮이고 저장 LINESEG 태그 0x60000이 남음을 확인했다. 이들은 저장 데이터 계약을 검사하는 합성 파일이며, 한컴에서 직접 저장한 부분 프레임 원본이나 한컴 화면 일치의 증거로 취급하지 않는다.

1~47행을 하나의 수평 셀로 합친 사례에서 수정 전 페이지 2의 테두리가 본문을 5657.36px 넘었고, 페이지 1에는 숨겨진 글자 2324개와 부분 잘림 11개가 있었다. 같은 셀 내용이 조각 사이에서 반복되기도 했다. 긴 병합 블록의 행별 높이 fallback은 마지막 물리 행에 내용 높이를 몰아 거대한 끝 조각을 강제로 배치했다. 독립 행별 텍스트 소유자가 없는 한 열·전체 rowspan·수평·일반 텍스트·RowBreak·자리 차지·캡션 없음 블록만 기존 cell-unit 블록 분할 경로로 보낸다. 기존 쪽 여백, 원본 셀 높이, 2px 기하 허용치를 바꾸지 않는다.

배치만 수정한 첫 중간 버전에서는 중간 조각 입력 후 undo가 셀 clip 높이를 14.4px 바꿨다. 역방향 삭제만으로 원본 저장 줄 프레임을 복원할 수 없는 별도 결함이다. 과거 해결된 redo 결함을 다시 보고한 것이 아니다. 배치와 같은 읽기 전용 판정 함수를 추가하고, 최상위 해당 셀의 insertText/deleteText/insertTab만 기존 bounded SnapshotCommand로 처리한다. 이력 예산은 늘리지 않고 composition cache를 추가하지 않는다. 머리행·보통 셀·짧은 병합·nested/HF/FN은 기존 경로를 유지한다.

## 최종 검증

- 실제 Mac Electron 44.3.0에서 114개 사례: 100개 변경과 14개 no-op. undo/redo 200쌍, 실제 호스트 IPC를 통한 HWP/HWPX 저장·재열기 200건. 전체 SVG, 페이지 수, 셀/본문 텍스트와 순서, 반복 머리행, 후행 본문, 표/문단/문자 속성, 쪽 정의를 비교했다. 긴 병합 셀의 첫·중간·끝 대상은 0·5·10쪽이다. 긴 블록은 수정 후 12쪽으로 정상 분할된다.
- 그림 기하 314회 / 3366쪽: 숨김 0·부분 잘림 0. 최대 테두리 하단은 본문 안쪽 0.3733px, 글자 하단은 안쪽 5.2532px다. 실제 제품 deferred pagination 완료 뒤 검사했다. 렌더러 오류 0, 정상 종료 코드 0.
- 최종 Native에서 새 실제 저장 파일 200개와 이전 실제 저장 파일 296개가 전체 모델·SVG 일치하고 LAYOUT_OVERFLOW 0개다. PR 7 경계 16개도 통과해 합계 512개다. API 경계의 실제 초과 네 경고와 제외 계약 두 경고는 그대로 남는다. API 파생 파일을 실제 앱 편집 건수로 세지 않는다.
- 읽기 전용 snapshot 판정 17건: 양형식 14개에서 긴 병합 셀 하나만 대상으로 선택하며 저장 바이트와 전체 SVG를 바꾸지 않는다. Square/BehindText/InFrontOfText 제외 계약 세 건도 false다. 실제 셀 입력은 변경 직후 before snapshot 한 개와 이력 한 항목을 보유하고 undo/redo 뒤 정확한 원본을 복원한다.
- WASM SHA256 `b5b5b2fc52dedbd0140322497e7fe792c9a34f8568ed8bc8f02dbd341a67474b`는 실제 앱 수신 바이트와 일치한다. 오프라인 Native/WASM 빌드, TypeScript, Node 구문 검사, diff 공백 검사를 통과했다. target 4.48GiB 이하와 가용 공간 15GiB 이상을 유지했다.

## 재실행과 남은 범위

`prepare-stored-merged-table-fragments.mjs <새 seed 경로> <WASM pkg> <기존 split-before.hwp>`로 재현 파일을 만든다. 인접 `whole-before.hwp`가 필요하다. 기존 build-current QA 도구로 런타임을 만들고 `GEULGYEOL_HOST_SEEDS=<seeds.json> node scripts/check-electron-stored-merged-fragments.mjs <QA 경로> <WASM pkg>`를 실행한다. `check-merged-cell-snapshot-scope.mjs <WASM pkg> <seeds.json> <새 경로>`와 Native `horizontal_table_saved_check <manifest.json> <새 경로>`가 독립 확인이다. 원본, 중간 실패, 빌드 체크포인트, 모든 raw QA는 저장소 밖 `../table-stored-merged-fragments-qa/`에 보존하며 공개 문서에는 합성 출처·해시·요약만 기록했다.

재현된 긴 병합 셀 넘침과 원본 프레임 undo 변화는 다음 Mac 베타 후보의 차단 결함으로 분류했고 최종 범위에서 해결했다. 실제 한컴 부분 프레임 원본 비교는 자료 부재로 남아 있다. 병렬/혼합 소유자 rowspan·세로 글쓰기·캡션·중첩 컨트롤은 이번 판정 밖의 다음 구현 후보다. 전체 Rust lib 테스트는 기존 include_bytes 샘플 세 개 누락으로 실행 불가하며 Linux·물리 IME·OS 파일 선택창·수동 GUI·한컴 앱 비교는 검증하지 않았다. 별도 beta.3 후보 앱의 저장·종료·복구와 독립 검토가 공개 릴리스의 다음 단계이며, 이 묶음의 통과를 전체 개발 완료로 취급하지 않는다.
