# signed 범위 초과의 원자 거절

독립 검토의 P2를 `0db4b7d` 이후 실제 API와 Mac Electron에서 재현했다. 기존 UI의 120.0mm는 34016 HWPUNIT를 unchecked i16로 변환해 -31520으로 저장했고, API 32768/-32769도 부호가 감겼다. 기존 14/28/56 증거는 보존했다.

표 setter는 JSON 객체의 signed 필드 10개(바깥/안 여백·셀 간격·캡션 간격)를 모두 검증한 뒤에만 모델을 변경한다. 제공 값은 정수 -32768…32767이어야 하며 문자열·null·boolean·소수·큰 수도 거절한다. 유효한 여백·셀 간격·배치·캡션 변경을 섞은 patch라도 어느 필드도 먼저 적용하지 않는다. 검증한 정수를 읽으므로 여백의 raw 우선순위/길이·typed/common 소유 계약은 유지한다. 전역 json_i16 helper나 다른 setter는 변경하지 않았다.

UI 바깥 여백에는 signed 표시 범위를 지정하고, 실제 HWPUNIT를 확인 전에 검사한다. 반올림된 경계 표시가 i16 범위를 벗어날 수 있으므로 HTML min/max에만 의존하지 않는다. 범위 초과면 해당 입력에 오류를 표시하고 대화상자를 유지하며 셀/표 명령과 이력을 시작하지 않는다. 변경하지 않은 정밀 경계 표시는 원래 값을 보존한다.

- Native: 혼합 patch 원자 거절 160건에서 전체 typed 문서/raw·SVG·HWP/HWPX 바이트 불변. 유효 경계 40건/양형식 재열기80 통과.
- 실제 Electron: API 거절 160건과 실제 SnapshotCommand/이력 경로 거절2건, UI 범위 초과16건에서 바이트·전체 SVG·dirty·이력 불변. 유효 편집2쌍/실제 저장재열기4 통과.
- 새 엔진으로 기존 실제 Electron 행렬14사례/28이력쌍/56재열기 재실행 통과. Native 자체48편집/48복원쌍/96재열기/raw40과 새 저장물 동일 바이트56 getter/전체SVG 대조 통과.
- desktop49pass/1skip/0fail, 현재 엔진 TS·Clippy·WASM release·별도 생산 Vite 및 생산 JS QA globals 부재 확인. 검증 앱 모두 정상 종료0.

원본73368·이전QA6548·캐시579 및 이전 여백 증거·공개beta.2 앱/ZIP 불변. 빌드 중 target 모니터는 4.5GiB 상한보다 약25MB 큰 4,856,729,600bytes를 잠시 기록해 그 budget 검사는 실패했다. 새 소유 Native 출력물을 별도 QA에 보존하고 기존 캐시11파일을 복원했으며 최종 target은 상한 이내다. 이 과정을 성공한 peak 검사로 바꾸어 기록하지 않는다.

실제 Electron 자동 검증은 private 선택/읽기 노출·OS 응답 adapter·소유 창의 background throttling 제어를 사용한다. 새 설치 앱·수동GUI·물리IME·OS선택창·클립보드·한컴·Linux는 미검증이며 전체 Rust lib fixture 누락 제약도 유지한다. 새 태그/릴리스는 만들지 않았다. [실행·보존 증거](range-proof.json), 전체 로컬 기록 `/Users/sw107/Documents/Codex/2026-10-06/task/table-margin-range-qa`.

긴 가로 표 작업은 중단 전 실제 Electron에서 높이만 편집할 때 너비7000→7002가 반올림되는 별도 결함을 재현했다. 그 증거와 수정 초안은 `../horizontal-table-fragment-qa`에 보존했고 이 범위 수정 커밋에 섞지 않았다. 후속 단계에서 그 생산 UI 경로와 fragment 입력·검색치환·반복머리행·후행본문·이력·저장 왕복을 계속 검증한다.
