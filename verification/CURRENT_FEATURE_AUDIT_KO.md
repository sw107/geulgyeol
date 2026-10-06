# 현재 개발 checkout 기능 상태

기준 엔진/pkg WASM은2d9599d, 독립 계산 모듈695f01e, adapter 설계4c587f8이다. 이 목록은 현재 checkout/pkg WASM과 자동 검증 기록의 상태이며, 기존 dev.7 앱이나 공개 beta.2가 아래 새 개발 변경을 포함한다는 뜻은 아니다. 과거 `dev7-checkpoint/FEATURE_AUDIT_KO.md`는 해당 패키지 시점 기록으로 그대로 보존했다.

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
| 일반 본문 누름틀(ClickHere) | 제한 합성 사례의 속성/앵커·저장/이력 자동검사 및 astral 캐럿/서식 범위 UI 수정 | **전체 보존 미완료**: 삽입 시 기존 혼합 글자 모양/각주 위치 손실, HWPX 추가 앵커 이동 재현. 엔진 수정은 빌드 예산 때문에 보류; 실제 GUI 미검증 |
| 실제 Mac GUI·물리 IME·Linux | 이번에는 검증하지 않음 | Electron Node API 결과를 실제 GUI 성공으로 부르지 않음 |

현재 새 변경은 `InsertTextCommand`의 캐럿/서식 끝·명령 병합 위치 두 계산을 Unicode scalar로 맞춘 UI 소스 수정이다. 엔진·WASM·앱 새 빌드는 하지 않았고 기존 앱은 이 수정을 포함하지 않는다. 자세한 범위/실패 증거는 [누름틀 결과](clickhere-preservation/RESULT_KO.md)와 [proof](clickhere-preservation/proof.json)에 있다. 엔진1141파일·기존 WASM·앱4개를 보존했고 target 자체3GiB 예산의 잔여 약31MiB도 그대로다. 큰 library 전체 suite의 누락 원본3개는 해결하거나 우회하지 않았다.

## 다음 독립 작업

누름틀 삽입 때 **기존 비필드 인라인 컨트롤 위치와 char_shapes 경계**를 원본 의미대로 보존하는 엔진 위치 재구성을 수정해야 한다. 불명 위치는 변경 전 원자적 거절이 필요하다. 삽입 시 이미 잃는 각주/서식을 두 저장 형식이 복구하지 않으므로 HWPX fallback만 고치는 것으로 충분하지 않다. Native 임시100–300MiB, WASM LTO200–500MiB 추가량은 계획 추정이며, 기존 자체 target 상한을 넘기기 전에 예산을 정해야 한다. 임의 cache 삭제/새 clone은 진행하지 않았다.

이번 제한 자동 통과는 재열기36회·undo/redo 각15회·거절14회·공유 입력 명령의 셀 회귀6개다. 각주 위치/혼합 서식 두 실패도 별도로 재현했으며 기능 완료로 표시하지 않는다. 실제 Mac GUI·물리IME와 긴 세로 셀 pagination/metric adapter는 기존 미검증/미지원·보류 상태를 유지한다.
