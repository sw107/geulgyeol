# 본문 책갈피 위치·서식·이력 보존

기준 `054ba17`에서 합성 문단 `가🙂나다𐐀마`의 offset 0/2/5/999에 책갈피를 추가하면 모두 문단 끝6에 저장됐고, 범위 밖999도 성공했다. 본문 책갈피의 scalar 위치를 실제 8유닛 제어 슬롯으로 재구성하고 문단의 CTRL_DATA·필드 control index·서식 좌표·control mask를 함께 갱신하도록 보완했다. 책갈피 변경 뒤 페이지의 각주 control index도 즉시 갱신한다.

기존 BookmarkDialog의 snapshot 이력을 유지하면서, 일반 본문 편집 목표와 선택 레코드의 최신 여부를 검사한다. 실패는 snapshot 복원, 이름 정규화 no-op은 이력/redo 보존으로 처리한다. 책갈피가 있는 본문의 실제 삽입·삭제 명령도 snapshot으로 되돌려 축소된 앵커와 혼합 서식을 복원한다. 삭제 전 생존 글자 서식을 보관해 제어 슬롯 경계의 서식 손실을 보완했다. 동일 위치에 입력하면 책갈피는 새 글자 앞에 남고, 앞에서 입력하면 뒤로 이동하며, 삭제 안의 책갈피는 삭제 시작으로 모인다.

이 결과는 **소스와 별도 검증 WASM 후보**다. dev11 앱에는 통합하지 않았다. 새 target·앱·ZIP, 공개 푸시/릴리스, 정리/삭제, 보안·계정·인증서·권한 변경은 없다.

## 실제 자동 검사

| 검사 | 통과 결과 |
|---|---|
| 실제 UI 로직 | 전체 BookmarkDialog·실제 Bridge·InputHandler·InsertTextCommand/DeleteTextCommand·local replace·SnapshotCommand/CommandHistory. DOM·커서·repaint는 어댑터 |
| 책갈피 작업 | 추가/이름 변경/삭제/텍스트 편집59작업, undo/redo261쌍. 본문·주석/필드 이웃·각주·빈 문단·emoji·동일 위치 다중 책갈피·재열기 후 재편집 |
| HWP/HWPX | 236 저장재열기. 책갈피 scalar 위치·본문/하위 문단 참조·직접 서식·전체 SVG 일치, content-loss 0 |
| 거절·취소·no-op | 341회. 범위/비정수/NaN·손상 UTF-16·제어 문자·길이 초과·중복 이름·비지원 모드/경로·오래된 목록·닫힌 대화상자, 기존 redo 불변. Bridge가 일부 변경 뒤 false를 반환하는 주입 실패도 복원 |
| 독립 Native | 동일236 저장물에 명령을 재실행해 전체 문단/서식·DocInfo·BinData·SVG 대조. snapshot2,214쌍, 직접 원자 거절11회. 하위 참조14종 이름 조회·중복 생성/이름 변경28회 무변경 거절 |
| 캡션 회귀 | 19작업·76 재열기·91이력쌍. Native 독립76·snapshot498쌍, 전체 SVG/참조 유지 |
| 주석·링크 회귀 | 주석64·앵커168·본문 링크22·셀 링크288 재열기. 이력16/43/6/84쌍, 셀 링크 거절444·layout12/다중쪽12 |
| 띠·너비·셀 회귀 | 띠132·너비40 재열기, 이력33/20쌍, 기존 너비 SVG32 일치. 셀 찾기/치환24사례·복원170·재열기82, 저장 SVG 일치 |
| 정적 검사 | 최종 WASM DTS로 TypeScript noEmit, lib+책갈피/기존 너비 Native 예제 Clippy `-D warnings`, 책갈피 query/새 Native 예제 rustfmt check, git diff check |

Native 대조는 기존 writer의 각주 헤더 끝0 패딩만 정규화한다. UI 검사는 저장 바이트를 이용한 history 상태와 실제 저장재열기의 전체 SVG/참조를 따로 비교한다. 일반 타이핑의 생존 글자 서식은 편집 전 값과 직접 대조한다.

## 지원 경계와 남은 확인

저작은 일반 본문의 소유권이 명확한 점 책갈피다. 새 추가가 필드/주석 경계에 겹치거나 범위 tag가 있으면 거절한다. 알 수 없는 책갈피 CTRL_DATA는 덮어쓰거나 삭제하지 않는다. 책갈피가 있는 문단의 분할·병합·문단 간 삭제는 현재 무변경 거절하며, 해당 기능을 새로 지원했다고 주장하지 않는다.

표/중첩 셀·글상자/그룹·그림/표/도형 캡션·주석 본문·머리말/꼬리말·각주/미주·바탕쪽의 기존 책갈피는 조회와 중복 이름 보호에 포함한다. `editable:false` 항목은 본문 좌표로 변경하지 않는다. 하위 항목 이동은 기존 호스트 문단 힌트이며 정확한 하위 경로 탐색/저작 인증은 아니다.

실제 Mac GUI 클릭·물리 IME·한컴 앱·Linux는 미검증이다. 앱 패키징/기동 검사를 이번에 실행하지 않았다. 전체 lib unit test도 실행하지 않았다: 실제 `include_bytes!` 경로의 기존 누락3개(`hwp3-sample16-hwp5.hwp`, `3-09월_교육_통합_2022.hwp`, `hwpx/aift.hwpx`)를 확인했으며 가짜 fixture나 임의 제외로 우회하지 않았다. 다음은 Mac GUI/IME에서 책갈피 추가와 입력·삭제·undo를 확인하고, 문단 구조 편집 및 하위 경로 지원을 별도 설계하는 것이다.

## 후보와 재현 근거

QA는 `/Users/sw107/Documents/Codex/2026-10-06/task/bookmark-preservation-qa`다. 최신 후보는 `pkg-final/rhwp_bg.wasm`, SHA256 `a43b05118288fd34ec71800d5f4784b27024ea1bffc84b4af1b16ce17eec4c17`. 실제 최종 책갈피 저장물·검증은 `ui-glyph-final`, 합성 입력은 `fixtures-final`, 최종 로그는 `glyph-ui.log`·`glyph-native-verify.log`와 `reg-*.log`다. 중간 실패와 기존 미완료 patch/checkpoint도 보존했다. 이전 `candidate.patch`로 복원하지 않았고 최신 텍스트 편집 수정을 이어갔다.

보호 목록4,687항목의 절대 경로 중복8개를 제외한 고유4,679파일 SHA256이 불변이다. 이전 체크포인트의 고유 수 계산을 바로잡았다. 재개 후 target 최고4.056GiB·최종3.959GiB, 실제 여유 최저19.531GiB로 4.5GiB/15GiB 조건을 지켰다. QA는 결과 기록 전 약90MiB이며 1GiB 이하다. 잔류 빌드/검증 프로세스와 GUI 창은 없다.

개발 checkout에서 [UI 검사](../../scripts/check-bookmark-preservation.mjs)에 `ENGINE_PKG FIXTURE_DIR OUTPUT_DIR`를 전달한다. [Native 예제](../../engine/examples/bookmark_preservation_check.rs)는 `prepare OUTPUT_FIXTURES SYNTHETIC_SEED_HWpx`, `verify UI_OUTPUT_DIR` 모드다. 기존 입력은 읽기 전용으로 사용하고 출력은 별도 QA로 둔다. [proof.json](proof.json)에 실행 인자·최종 source hash·자원 감시 결과를 기록했다.
