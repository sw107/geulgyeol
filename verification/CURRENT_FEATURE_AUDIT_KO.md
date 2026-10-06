# 현재 개발 checkout 기능 상태

기준 production code는2d9599d, 독립 계산 모듈695f01e, adapter 설계4c587f8이다. 이 목록은 현재 checkout/pkg WASM과 자동 검증 기록의 상태이며, 기존 dev.7 앱이나 공개 beta.2가 아래 새 개발 변경을 포함한다는 뜻은 아니다. 과거 `dev7-checkpoint/FEATURE_AUDIT_KO.md`는 해당 패키지 시점 기록으로 그대로 보존했다.

| 기능 | 현재 상태와 근거 | 미지원/미검증 경계 |
|---|---|---|
| 스타일 모양 전파/삭제·다음 스타일 | 지원 본문·셀·중첩·머리말·각주 경로의 원본 참조/직접 서식 보존 및 누적 Native/WASM 검사 | 불명확/비지원 참조는 거절, 전체 원본 corpus·실제 GUI 미완료 |
| 본문 번호 목록 이어쓰기 | 9b85974에서 기존 번호 정의/이력 연결 수정 | 별도 source 변경이며 과거 dev.7 기능 목록의 ‘3 대신1’은 역사 기록 |
| 일반·중첩 셀의 번호 속성/이어쓰기 | 1ce7d49와 후속 자동 검증 | 세로 셀 **번호 glyph 표시 미지원**. 번호 데이터/저장 보존과 화면 지원은 다름 |
| 셀 방향1/2 HWP/HWPX 저장 보존·짧은 텍스트 회전 | 2d9599d에서 HWPX VERTICALALL 보존 수정, 자동 Native/WASM 대조 | 일반/중첩 데이터 보존 검사이지 모든 세로 조판 지원 인증이 아님 |
| 긴 세로 셀의 실제 페이지 분할 | **미지원**. 모델은 보존되나 조각마다 전체 재출력·clip 밖 글자 발생,06ba4dc 진단 | 문자1회/누락0/ink 경계/실제 조각 할당은 아직 해결되지 않음 |
| 세로 다문단/다열 shaping metric | **미검증·production 미연결**. 이번 기존 WASM 조사에서2개 단일 CJK 양성은6개 certified glyph leaf를 방출, 다문단·긴 여러 열은gate 밖 | 방향1/Latin/emoji/복잡cluster/다른font/bold/HWPX/default CharPr 등의 gate를 확대하지 않음 |
| 독립 세로 열·문자 소유권 계산 | 695f01e: 독립 테스트14·생성1,200회·HWP/HWPX 텍스트 투영8개 | 단순 supplied metric/frame 계산이며 실제 측정·pagination·renderer 미연결. 가상11조각을 앱 페이지로 주장하지 않음 |
| 공유 adapter | 4c587f8 설계에서 **보류 유지** | typed page payload, certified 다문단 metric, 실제 dynamic frame budget이 먼저 필요. 공용 RowCut 수정 없음 |
| 셀 다중 수식·회전 그룹 해제·중첩 서식 복사·각주 서식·검색 | 이전 지원 범위와 누적 자동 결과를 보존 | 비지원 개체/불명 슬롯 거절 경계, 실물 선택·물리IME·GUI 미검증 |
| 실제 Mac GUI·물리 IME·Linux | 이번에는 검증하지 않음 | Electron Node API 결과를 실제 GUI 성공으로 부르지 않음 |

현재 새 코드/adapter/앱 빌드는 하지 않았다. source/WASM/앱4개/직전 합성 원본 보존 및 target 용량 불변만 이번에 재확인했다. 기존 library 전체 suite의 누락된3원본 fixture도 해결하지 않았다.

## 큰 빌드 없이 가능한 다음 독립 점검 한 가지

**일반 본문 양식 누름틀(ClickHere)의 속성·앵커·원본 서식 왕복 보존 점검**을 제안한다. 이 기능의 현재 완전성은 아직 확인하지 않았으므로 완료 기능으로 표시하지 않는다.

기존 WASM에 `insertClickHereField`, `getFieldList`, `getClickHereProps`, `updateClickHereProps`, snapshot/export API가 이미 있다. 새 작은 합성 문서 한 개에 누름틀을 만들고 guide/memo/name/editable을 변경한 뒤 다음을 대조할 수 있다: 필드 ID/시작·끝 앵커 관계와 본문 문자열, 원본 직접서식/스타일·문서 참조, snapshot 복원/재적용, HWP/HWPX export content-loss report와 재열기 속성. 지원 밖 field ID/종류는 무변경 거절 여부를 읽어 확인한다. 중첩 셀/메모 UI/필드 합치기는 초기 범위에서 제외한다. 기존 문서를 고치거나 새 Rust/앱 빌드를 할 필요가 없고, 한컴 양식 작성의 실용적인 데이터 보존 경계를 확인하는 독립 작업이다.

이번에는 이 다음 점검을 실행하지 않았다. 조사/최소 계획은 `vertical-cell-resource-metric/METRIC_PLAN_KO.md`, 디스크/자체 예산 구분은 `vertical-cell-resource-metric/RESOURCES_KO.md`에 남겼다.
