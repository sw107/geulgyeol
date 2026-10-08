# 그림 캡션 삽입 이력·삭제 참조·HWPX 재열기

기준 `55a71f0`의 일반 본문 단일 그림에서 캡션 넣기는 setter를 직접 호출해 undo 항목을 만들지 않았다. 새 캡션 추가를 기존 InputHandler/SnapshotCommand에 연결했다. 삽입·속성 변경·캡션 제거·그림 삭제는 각각 한 작업으로 되돌아가며, 이미 있는 캡션에 다시 들어가는 동작은 이력을 추가하거나 redo를 지우지 않는다. 기본 방향/크기/간격, 캡션 텍스트와 기존 자동 번호 규칙은 유지했다.

이번 결과는 **소스와 별도 검증 WASM 후보**다. 보존된 dev11 앱에는 통합하지 않았다. 새 앱/ZIP, 공개 푸시/릴리스, 파일 삭제·정리, 권한·계정·인증서 변경은 하지 않았다.

## 필요한 좁은 보완

- 새 그림 캡션의 AutoNumber placeholder는 8유닛 슬롯의 첫 유닛이다. 뒤 공백의 저장 좌표를11→10, `char_count`를13→12로 맞췄다. 기존 값은 HWP 재열기에서 마지막 보충 평면 글자의 직접 서식을 한 칸 밀었다.
- 문단 끝의 마지막 그림을 삭제할 때에는 뒤 글자가 없으므로 앞의 `char_offsets`를 이동하지 않는다. 기존 gap walk가 owner 없는 FIELD_END까지 세어 주석/필드 앞뒤 좌표를 손상시키던 사례를 보완했다. 중간 그림 삭제의 기존 경로는 유지한다.
- 캡션이 있는 그림 삭제에서도 기존 캡션 제거와 같은 `assign_auto_numbers`를 호출한다. 살아남은 캡션이 삭제 직후에는2, 재열기 후에는1로 보이던 차이를 해소했다. 번호 알고리즘·저장 텍스트를 새로 정의하지 않았다.
- 줄 정보가 없는 캡션도 저장된 글자 모양 경계로 런을 나눈다. 추가로 **떠 있는 그림의 Top/Bottom·텍스트/AutoNumber만 있는 문단·저장 줄 정보 없음**에 한해, 편집과 같은 그림 폭·문단 여백·reflow로 렌더링용 복제를 만든다. 원본 IR·저장 줄 정보와 HWPX synthetic LINE_SEG 생략 규칙은 보존한다. 그림과 캡션 높이 계산도 같은 복제를 사용한다.

## 자동 확인

| 검사 | 결과 |
|---|---|
| 실제 WASM/UI 명령 로직 | registry/dispatcher, object-props router, Bridge, InputHandler/history, PicturePropsDialog의 적용·patch 모델 실행. 대화상자 open/form·DOM·커서·repaint는 어댑터 |
| 캡션·그림 이력 | 주석/인접 필드/기존 혼합 서식 캡션/각주4 fixture, 합성1x1 PNG, 인접 번호 그림. 19작업·undo/redo91쌍. 각 단계4회 왕복과 전체 이력 왕복, 작업당 이력1개 확인 |
| 저장재열기 | HWP/HWPX76개. 텍스트·직접 서식(굵게/기울임/색/크기·emoji)·스타일·그림 바이트·저장 앵커·이웃 주석/필드·번호와 **전체 SVG 완전 일치** |
| 거절·반복·실패 복원 | 거절/무변경16, 기존 캡션 진입9회 이력 없음. 문서 없음/읽기 전용/양식·InputHandler form gate/다중 선택·수식/그룹 거절, setter가 생성 뒤 throw하는 주입 실패도 원자 복원 |
| 독립 Native | 같은76 저장물을 Native 명령 재실행 후 전체 SVG·문단/캡션·스타일/글자 모양·BinData로 대조. snapshot498쌍. 기존 writer 각주 헤더 끝0 패딩만 정규화 |
| 문단 띠·너비/기존 개체 회귀 | 재열기132+40, undo/redo33+20쌍. 기존4 너비 기준 SVG32와 타원·회전·그룹·그림·셀 두 형식10 SVG, 인접 그림 노드/glyph 불변 |
| 표·셀 회귀 | 셀 링크 재열기288·이력84쌍·거절444·layout12/다중쪽12. 셀 찾기/치환 이력24사례·복원170·재열기82, 저장 SVG 일치 |
| 주석 회귀 | 저작64·앵커168 재열기, 이력16+43쌍. 기존 author/time/ID·본문 서식·필드 참조 유지 |
| 정적 검사 | 최종 WASM DTS TypeScript, lib+기존 Native 예제 Clippy `-D warnings`, 예제/그림 명령 rustfmt와 `git diff --check` 통과 |

캡션 텍스트·서식의 테스트 준비에는 실제 Bridge API를 snapshot 안에서 사용했다. 실제 타이핑·IME 이벤트를 검증한 결과는 아니다. Native에서는 캡션 문단 전체와 서식/스타일 참조를 대조하고, WASM에서는 지원되는 캡션 텍스트·style/char getter를 사용한다. 표 전용 legacy 문단 속성 getter를 그림 캡션 getter로 오인하지 않는다.

## HWPX 위치 차이와 한계

중간 후보에서 짧은 캡션은 기준선1.0667px, 기존 혼합 서식 캡션은 줄바꿈 차이로 최대 x109px/y36.2667px가 달랐다. 저장 데이터/글자 서식 일치만으로 성공 처리하지 않았다. 위 렌더링용 reflow 보완 후 최종76 재열기에서 **SVG 전체가 일치**하며 재현한 차이는 해소됐다. 중간 실패·위치 대조 로그는 QA 경로에 보존했다.

성공 범위는 검사한 일반 본문 그림 캡션이다. 실제 Mac 메뉴 클릭/선택·끌기·물리 IME, 한컴 앱, Linux Native는 미검증이다. Left/Right·인라인·회전/그룹·복합 캡션/참조의 새 조판 일치나 방향 메뉴 전체 지원으로 확대하지 않는다. 저장 줄 정보가 있는 원본 캡션은 기존 경로를 따른다.

전체 lib unit test는 실행하지 않았다. 현재 `include_bytes!`의 실제 경로 존재 확인에서 기존 누락3개(`hwp3-sample16-hwp5.hwp`, `3-09월_교육_통합_2022.hwp`, `hwpx/aift.hwpx`)가 남아 있다. 가짜 fixture나 임의 제외를 추가하지 않았다. 저장소 전체 fmt의 기존 차이도 이 작업에서 일괄 수정하지 않았다.

## 후보·보존·재현

최종 WASM은 `caption-history-qa/pkg-layout/rhwp_bg.wasm`, SHA256 `b2a3010c21c145d87603ac91b3d9660e6a3a54163a5761bc83e886bfdd9af97f`다. dev11 앱·원본 후보/pkg 등20개와 이전 QA artifact2779개, 총2799개 해시가 불변이다. target 최고3.849GiB·최종약3.751GiB, 실제 여유 최저21.019GiB로 target4GiB·여유10GiB 상한/하한을 지켰다. 추가 QA는 약90MiB이며 앱/ZIP 복사본을 만들지 않았다.

QA: `/Users/sw107/Documents/Codex/2026-10-06/task/caption-history-qa`. 최종 UI 저장물은 `ui-color-final`, Native 결과는 그 안의 `native-caption-proof.json`이다. 빌드/바인딩/검사 인자는 [proof.json](proof.json)의 `finalChecks`에 그대로 있다. Node는 보존된 dev11 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 사용했고 GUI 창을 열지 않았다.

개발 checkout에서 [캡션 검사](../../scripts/check-caption-history.mjs)에 `ENGINE_PKG FIXTURE_DIR OUTPUT_DIR`를 전달한다. Native는 기존 `body_rectangle_width_check OUTPUT_DIR --verify-caption-history` 모드를 사용한다. fixture/출력은 별도 QA 경로를 사용하고 기존 앱·원본 문서를 덮어쓰지 않는다. 다음 확인은 실제 Mac GUI·IME의 캡션 진입/편집·undo와 지원 밖 캡션의 별도 조판/한컴 재열기다.
