# 책갈피가 있는 본문 문단의 Enter·Backspace·Delete

기준 `9370adb`에서는 책갈피가 있는 문단의 분할·병합을 모두 거절했다. 기존 모델의 분할은 책갈피를 이동 대상으로 보지 않았고, 각주 등은 별도 논리 위치로 계산했다. 이번에는 **한 섹션의 일반 본문에서 소유권과 scalar 좌표를 확인한 문단**을 먼저 복제해 분할·병합한다. 기존의 비책갈피 경로와 UI snapshot 이력은 유지한다.

분할에서는 텍스트/문단 메타데이터를 나눈 다음 원래 위치에 따라 책갈피·필드·각주와 CTRL_DATA를 양쪽에 배치하고, field control index·8유닛 슬롯·control mask를 다시 계산한다. Enter 위치와 같은 책갈피는 새 문단 시작0으로 이동한다. 병합은 앞 문단의 속성을 유지하며 뒤 문단의 앵커를 앞 텍스트 길이만큼 옮긴다. 두 경로 모두 원래 생존 글자의 직접 서식을 복원한다. 각주가 있는 책갈피 문단의 끝에서도 다음 스타일 규칙을 적용한다. 문단 분할/병합 WASM API는 비정수·NaN·음수 입력을 강제 변환하지 않고 거절한다.

실제 Enter·Backspace·Delete가 사용하는 SplitParagraphCommand/MergeParagraphCommand/MergeNextParagraphCommand와 기존 InputHandler의 책갈피 snapshot 경로를 검사했다. 새 UI 경로나 별도의 역연산 이력을 만들지 않았다. 이 결과는 **소스와 검증 WASM 후보**이며 보존된 dev11 앱에는 통합하지 않았다.

## 최종 자동 검사

| 검사 | 통과 결과 |
|---|---|
| 실제 명령·이력 | 총222작업: 책갈피 준비85·분할64·Backspace 병합37·Delete 병합36. 시작/끝/빈 문단·emoji·동일 위치 책갈피·양쪽/한쪽만 책갈피가 있는 경우, undo/redo1,068쌍 |
| 참조 보존 | 편집 전후 전체 텍스트와 글자별 직접 서식, 주석/링크의 ID·내용·명령·소유 문단·scalar 범위, 각주 내용/서식 일치. 문단 이동에 따라 field paraInList도 갱신 |
| HWP/HWPX | 888 저장재열기, content-loss 0. 전체 SVG/참조/책갈피 좌표 일치. 두 형식에서 재열기 후 다시 분할·Backspace/Delete 병합하는 경로도 통과 |
| 원자 거절 | UI/API144회: 필드 안 분할·주석+각주 복합 문단·범위/비정수/NaN·첫 문단/범위 밖 병합·문단 간 선택 삭제. 문서와 pending redo 불변, 실제 명령 실패 snapshot 복원 |
| 독립 Native | 같은888 저장물에 명령을 재실행해 전체 SVG·문단/서식·DocInfo·BinData 대조, snapshot8,544쌍. 불명 CTRL_DATA·남는 참조 레코드·개체·범위 tag·추적 정보·다중 섹션·쪽/구역 경계 등20회 전체 Document 불변 거절 |
| 기존 책갈피 회귀 | 59작업·236재열기·261이력쌍·거절/취소/no-op341. Native 독립236·snapshot2,214쌍 |
| 캡션·주석·링크 회귀 | 캡션76재열기/91이력쌍 및 Native 독립76/498snapshot쌍. 주석64·앵커168·본문 링크22·셀 링크288 재열기, 셀 링크 거절444/layout12/다중쪽12 |
| 띠·너비·셀 회귀 | 띠132·너비40 재열기, 이력33/20쌍, 기존 너비 SVG32 일치. 셀 찾기/치환24사례·복원170·재열기82, 저장 SVG 일치 |
| 정적 검사 | 최종 WASM DTS TypeScript noEmit, lib+책갈피/너비 예제 Clippy `-D warnings`, 책갈피 query/새 예제 rustfmt check, git diff check |

DOM·커서·repaint는 어댑터이며 키보드 하드웨어 이벤트를 실행한 결과는 아니다. 저장 바이트의 history 상태와 저장재열기의 SVG/참조를 따로 대조했다. Native canonical 비교에서는 기존 writer의 각주 헤더 끝0 패딩만 정규화한다.

## 지원 경계와 실제 재열기 보완

문단 내 필드/주석의 시작·끝 경계에서는 소유 필드를 온전히 한쪽으로 이동할 수 있다. **필드 내부 분할**은 거절한다. 일반 본문의 기존 점 책갈피만 구조 편집하며, 셀·글상자·캡션·머리말/각주 내부 책갈피의 구조 편집을 새로 지원한 것은 아니다.

편집 대상의 개체/표·범위 tag·고아 FIELD_END·제목 표식·확장 탭·불명 참조/추적 정보, 주석과 각주가 함께 있는 복합 문단은 무변경 거절한다. 책갈피가 있는 다중 섹션 문서와 뒤 문단의 구역/단/쪽 경계 병합도 거절한다. 문단 간 선택 삭제는 기존 거절을 유지한다. 병합으로 사라지는 문단의 스타일/속성은 snapshot undo가 정확히 복원한다.

최종 재편집 검사에서 HWP 저장기가 만든 0값 헤더 suffix를 추적 정보로 오인해 거절하는 문제를 발견했다. 알려진0값 패딩은 삭제하지 않고 보존하며 허용했다. 길이/비영값이 불명확한 suffix는 계속 거절한다. 실패한 후보/로그를 보존했고, 이 보완 후 HWP와 HWPX 재열기 후 편집까지 통과했다.

실제 Mac GUI·선택/캐럿·물리 IME·한컴 앱·Linux는 미검증이다. 앱 패키징/기동 검사를 이번에 실행하지 않았다. 전체 lib unit test는 기존 누락 fixture3개(`hwp3-sample16-hwp5.hwp`, `3-09월_교육_통합_2022.hwp`, `hwpx/aift.hwpx`) 때문에 실행하지 않았으며 임의 대체나 제외는 없다. 다음 확인은 Mac GUI/IME에서 Enter·Backspace/Delete와 undo를 확인하고, 복합 구조 및 문단 간 선택 삭제를 별도 설계하는 것이다.

## 후보·보존·재현

QA: `/Users/sw107/Documents/Codex/2026-10-06/task/bookmark-structure-qa`. 최종 후보는 `pkg-header-final/rhwp_bg.wasm`, SHA256 `17a530697fd11257f1c0a083a625b26ff152ef5029654c1e6e3ba0269965c363`. 최종 저장물/Native 결과는 `ui-header-final`, 검사 로그는 `header-ui.log`·`header-native-verify.log`·`reg-*.log`다. [proof.json](proof.json)에 실행 인자·source hash·자원 감시와 보호 해시를 기록했다.

기존 보호4,679파일과 `9370adb` 책갈피 QA1,914파일, 총6,593파일의 SHA256이 불변이다. target 최고4.101GiB·최종약3.960GiB, 실제 여유 최저19.493GiB로 기존 target4.5GiB/여유15GiB 조건을 지켰다. 추가 QA는 결과 기록 전 약83MiB로 1GiB 이하다. 정리/삭제·새 target·앱/ZIP·공개 push/release·보안/계정/인증서/권한 변경은 없다. 잔류 빌드/검증 프로세스와 GUI 창은 없다.

개발 checkout에서 [구조 검사](../../scripts/check-bookmark-structure.mjs)에 `ENGINE_PKG FIXTURE_DIR OUTPUT_DIR`를 전달한다. 기존 [Native 예제](../../engine/examples/bookmark_preservation_check.rs)의 `prepare OUTPUT_FIXTURES SYNTHETIC_SEED_HWpx`로 합성 입력을 만들고 `verify UI_OUTPUT_DIR`로 저장물을 독립 대조한다. 입력과 출력은 별도 QA를 사용한다.
