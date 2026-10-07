# 본문 사각형 너비 기준 API·문단100% 계산

가로 본문 루트의 단순 사각형에 `getBodyRectangleWidth` / `setBodyRectangleWidth`와 Bridge를 추가했다. 너비와 기준을 함께 명시하고 편집 전에 대상·값·서식 참조를 검사한다. 지원 사각형의 `Para / 10000`은 **현재 단의 폭에서 해당 문단의 양쪽 여백을 뺀 폭**으로 그린다. 공유 `resolve_object_size`는 변경하지 않았다. 기존 일반 개체/셀 속성 API, 그림, 다른 도형과 Absolute/Paper/Page/Column 계산은 유지한다.

문단 띠 삽입/제거 명령과 메뉴 연결은 구현하지 않았다. `insert:para-band`는 실제 registry/dispatcher/menu 상태 검사에서도 disabled다. 기존 dev10 앱/엔진과 이전 후보는 보존했고 새 앱을 패키징하거나 공개하지 않았다.

## API 계약

- 대상: 직접 본문 문단의 Rectangle. 가로 구역, 비인라인, InFrontOfText 또는 BehindText, 둥근 모서리/글상자/캡션/회전/뒤집기/비단위 affine 변환/불명 너비 sentinel 없음.
- 인자: `(section, paragraph, controlIndex, {width, widthCriterion})`. 정확히 두 속성을 함께 지정한다. getter는 읽기 전용이고 setter만 mutation registry에 등록했다.
- `Absolute`: HWPUNIT 정수200~i32::MAX. `Paper/Page/Column`: 1/100% 단위200~10000(2~100%). `Para`: 현재100%(`10000`)만 허용.
- 셀/중첩 셀/머리말/각주/그룹·그림·타원/인라인·흐름 개체의 이 API 편집은 지원하지 않는다. 기존 API와 조판 경로를 사용한다. 잘못된 값·대상·문단 서식 참조는 문서/이벤트 변경 전에 거절한다.
- 모양의 공통 너비/기준, 원본·현재 너비와 사각형 x 좌표를 함께 갱신하고 기존 재조판·snapshot 이력 경로를 사용한다. 텍스트나 제어 앵커를 삽입/삭제하지 않는다.

## 확인 결과

| 검사 | 결과 |
|---|---|
| Native 새 API·실제 geometry | 다섯 기준 각각 기준 지정→문단 여백→쪽 폭/쪽 여백→2단 간격 변경. HWP/HWPX 재열기40·snapshot undo/redo20쌍·원자 거절17 |
| WASM + 실제 Bridge/SnapshotCommand/History | 같은40 재열기·undo/redo20쌍·잘못된 속성 거절20·지원 밖 대상 읽기/쓰기 무변경 거절6 |
| 독립 Native/WASM | Native 저장40개를 WASM에서 실제 폭 대조, WASM 저장40개를 Native 명령 재실행/geometry/참조 대조 |
| 기존 개체 출력 | 기존4 기준의 SVG32개 dev10과 완전 일치. 타원·회전 사각형·그룹·그림·셀 Para 사각형 두 형식 SVG10개 완전 일치. Para 변경 옆 그림 노드/본문 glyph 불변 |
| 참조/직접 서식 보존 | 본문·다른 스타일 문단·effective 글자 모양·각주·이웃 Memo/필드 범위, 실제 undo/redo 및 저장재열기 대조 |
| 기존 주석 저작/본문 앵커 | 실제 명령/UI 어댑터 저장재열기64+168, 각각 undo/redo16+43쌍. 저장232개 Native 독립 대조 |
| 셀 링크 회귀 | 실제 경로 재열기288·undo/redo84쌍·거절444·상위 표 layout12·페이지 분할12 |
| TypeScript/Clippy | 최종 후보 DTS의 `tsc --noEmit`, lib+새 Native 예제 `clippy -D warnings` 통과 |
| 보존 검사 | 보호 대상17개 및 dev10 기존 QA artifact314개 SHA256 일치 |

Native/WASM 모두 문단100% 폭이 문단 여백 변경 후533.6px, 쪽 변경 후633.333px, 2단 변경 후293.333px로 바뀐다. 같은 최종 상태의 Absolute160px·Paper880px·Page666.667px·Column326.667px은 기존 계산과 같다.

독립 저장 대조의 HWP 각주 헤더에 Native/WASM writer 간 선택적인 끝0 패딩 두 바이트 차이가 있었다. 각주 헤더의 **끝0만** 정규화한 뒤 모든 나머지 참조/비영 바이트를 대조했다. Memo 원시 메타데이터는 이 정규화 대상이 아니다. 현재 문서 내 mutation/undo/redo 무변경 검사는 정규화하지 않는다.

## 한계와 후속

새 메뉴/개체 배치 UI/띠 삭제의 사용자 흐름을 연결하거나 확인한 결과가 아니다. 새 API 이력 검사는 실제 Bridge/명령/History를 사용하지만 DOM·Mac 화면과 물리 IME는 검사하지 않았다. 새 앱 패키징/기동/서명·Linux 실행도 이번 범위에서 하지 않았다. 기존 API와의 저장 비교는 합성 fixture/이전 개발 fixture 기준이며 한컴 원본 문단 띠 corpus·한컴 실제 열기 검증은 남았다. 다음 작업은 이 지원 범위 위에 단일 본문 문단의 삽입/제거/선택 이력과 취소/비지원 참조 거절을 연결하는 것이다.

전체 lib 단위 테스트는 기존 missing `include_bytes!` fixture3개(`3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`) 제한 때문에 재실행하지 않았다. 대체 fixture나 테스트 제외를 도입하지 않았다.

초기 Native 검사 작성 중 enum 패턴/스타일 ID 타입/표 삽입 반환 위치 가정을 수정했고 실패 로그를 남겼다. 회귀 실행기의 앱 바이너리 이름 오타도 수정했다. 최초 WASM 컴파일은 완료됐지만 자원 감시기가 사라진 Cargo 임시 파일을 읽다가 중단되어 그 실행의 완전한 자원 증거는 없다. 감시기 오류 처리와 유효한 du 총량 읽기를 보완한 뒤 동일 소스 강제 재빌드·바이트 일치 및 최종 소스 재빌드를 감시해 확인했다. 최종 자원/엔진 해시와 원시 근거는 [proof](proof.json), 별도 `../body-rectangle-width-qa` 체크포인트에 있다.
