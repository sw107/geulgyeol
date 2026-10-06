# 현재 개발 checkout 기능 상태

기존 pkg WASM은2d9599d 기준이며, 현재 엔진 소스에는 일반 본문 누름틀의 서식·각주 보존 수정이 추가됐다. 새 WASM은 별도 clickhere-engine-qa 후보에서 검증했고 pkg/앱에는 연결하지 않았다. 독립 계산 모듈695f01e, adapter 설계4c587f8이다. 이 목록은 현재 checkout/pkg WASM과 자동 검증 기록의 상태이며, 기존 dev.7 앱이나 공개 beta.2가 아래 새 개발 변경을 포함한다는 뜻은 아니다. 과거 `dev7-checkpoint/FEATURE_AUDIT_KO.md`는 해당 패키지 시점 기록으로 그대로 보존했다.

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
| 일반 본문 누름틀(ClickHere) | UI scalar 수정 및 별도 엔진/WASM 후보의 기존 혼합 서식·각주 보존/반복 redo 수정. Native 재열기66회, WASM54회 및 기존 실패 사례 추가4회 | 일반 본문 합성 지원 범위 검증. 복잡한 소유권·중첩 필드·필드 병합·실제 GUI는 미검증, 기존 pkg/앱에는 미연결 |
| 실제 Mac GUI·물리 IME·Linux | 이번에는 검증하지 않음 | Electron Node API 결과를 실제 GUI 성공으로 부르지 않음 |

현재 누름틀 엔진 수정은3개 production 파일에 한정한다. 비필드 참조 위치를 편집 전 확보하고 FIELD_END 소유권, UTF-16 폭, 제어 간격 안의 서식 경계를 보존한다. 기존 UI scalar 수정은 유지했고 이번 UI production 변경은 없다. 과거 [누름틀 실패/제한 기록](clickhere-preservation/RESULT_KO.md)은 보존했으며, 현재 [엔진 후보 결과](clickhere-engine-preservation/RESULT_KO.md)와 [proof](clickhere-engine-preservation/proof.json)에 전후 대조와 누적 회귀검사를 기록했다.

기존 Native 각주/검색/스타일 전파와 WASM 각주/검색 회귀 및 저장 산출물의 Native 교차 검증을 통과했다. 기존 pkg·앱4개 ASAR는 그대로고 앱 통합·교체·패키징·공개 푸시/릴리스는 없다. 이번 단계 승인 target4GiB에서 최고 약3.226GiB/최종 약3.036GiB, disk 여유10GiB 이상을 유지했다. 캐시 삭제/새 clone은 하지 않았다.

## 다음 독립 작업

별도 앱 후보에 검증된 WASM을 연결한 실제 Mac 입력/선택/누름틀 이동/undo·redo·저장 재열기와 물리IME 확인이 필요하다. 이번 Electron Node 결과는 실제 GUI 성공이 아니다. Linux는 미검증이며 Mac 작업을 지연시키지 않았다. 중첩 필드/필드 병합과 복잡한 제어 소유권은 전체 인증 전이다. 긴 세로 셀 pagination/metric adapter의 기존 미지원·보류 상태도 그대로다.

library unit test는 기존 include_bytes! 원본3개의 누락으로 컴파일이 막힌다. 원본 복원/대체/검사 제외로 우회하지 않았으며 Native 예제 결과를 해당 suite 통과로 주장하지 않는다.
