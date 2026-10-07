# 본문 일반 텍스트 붙여넣기 이력·서식 보존

기준 `66facdc`에서 일반 본문 선택에 한 줄 텍스트를 붙여넣으면 undo가 삽입만 취소하고 선택했던 원문을 잃었다. `가🙂나다𐐀마`의 `🙂나`를 `붙여🙂`로 대체한 뒤 undo하면 `가다𐐀마`가 남았다. 이제 선택 삭제와 한 줄/여러 줄 삽입을 기존 snapshot 명령 하나로 묶어 원문을 복원한다. 앞선 책갈피·캡션·스타일·셀·주석 기능을 유지한 소스/검증 WASM 후보이며 dev11 앱에는 미통합이다.

선택 삭제의 임시 조각을 성공/실패 모두 해제한다. 빈 텍스트/clipboardData 없음은 문서·선택·pending redo를 바꾸지 않는다. CRLF·단독 CR을 문단 나눔으로 처리하고, 잘못된 Unicode와 지원하지 않는 C0 문자는 변경 전에 거절한다. 중간 삽입 실패 시 전체 snapshot을 복원하고 기존 선택/캐럿과 redo를 유지한다. 일반 타이핑·연속 붙여넣기는 각각의 이력 항목으로 남는다.

검사 중 본문 필드 밖 선택 삭제가 생존 글자 서식을 잃는 문제와 비활성 링크 경계의 입력이 링크 값에 들어가는 문제도 재현했다. 일반 삽입/삭제와 짧은 입력 최적화 경로에서 필드 축을 검증하고 제어 토큰/생존 글자 모양을 재계산한다. 링크 시작·끝 경계 밖 입력은 기존 링크 ID·URL·표시 텍스트를 보존하며, 시작 앞 입력에 따른 범위 이동은 두 형식의 저장재열기에도 유지된다. 셀 링크의 기존 경계 규칙은 유지한다.

## 최종 자동 검사

| 검사 | 결과 |
|---|---|
| 실제 입력 처리 경로 | 실제 onPaste·Bridge·InputHandler·명령·CommandHistory, 19사례: 단일/문단 간 선택·전체·빈 문서·줄바꿈만·CRLF/CR/빈 줄·tab·emoji·재열기 재편집·삭제 밖 주석/링크/각주·링크 양 경계 |
| 이력·저장 | undo/redo78쌍, HWP/HWPX76재열기·content-loss0. 원문/캐럿·직접 서식·필드 ID/command/value/범위·각주 내용/서식 및 전체 SVG 대조. undo/redo의 두 형식 바이트도 정확 일치 |
| 취소·거절·실패 | 빈/null clipboard2회 no-op. 잘못된 Unicode/C0·양식 모드·범위/섹션/복합 참조·두 번째 입력 주입 실패12회. 기존 redo·문서·선택 보존. 임시 삭제 조각 capture17/discard17 |
| 독립 Native | 같은76저장물에 명령 재실행, 문단·DocInfo·BinData·전체 SVG 대조. 전체 Document snapshot114쌍. 기존 구조 거절36·비지원 이름 참조 거절11·하위 이름 범위14/중복 거절28 유지 |
| 기존 책갈피·캡션 회귀 | 선택 삭제68·구조888·저작236·캡션76재열기. 각각 독립 Native 대조, snapshot102/8,544/2,214/498쌍 및 선택 삭제 조각102쌍 |
| 인접 회귀 | 누름틀54·주석64·앵커168·본문 링크22·셀 링크288·띠132·너비40·셀82재열기. 필드 값 교체 지원10/거절18. 셀 layout24사례/복원170, 셀 링크 layout12/다중쪽12 |
| 정적 검사 | 최종 WASM DTS로 TypeScript noEmit, lib+독립 예제2개의 Clippy `-D warnings`, 변경한 Native 예제 rustfmt check, git diff check |

검사에서 DOM/커서/repaint 및 ClipboardEvent는 어댑터다. 실제 Mac GUI·OS 클립보드·물리 IME·한컴·Linux 검증은 아니다. 셀/각주/머리말 내부의 붙여넣기와 HTML/내부 rich clipboard의 지원 확대도 이번 범위에 없다. Native 저장 대조는 기존 각주 자식 헤더 끝0 padding만 정규화한다. 전체 lib unit test는 기존 include_bytes fixture3개가 없어 실행하지 않았으며 임의 대체/제외하지 않았다.

## 후보·보존·재현

QA `/Users/sw107/Documents/Codex/2026-10-06/task/plain-paste-qa`. 최종 `pkg-final/rhwp_bg.wasm` SHA256 `cef3ef66709627ee07284df957fb75f24f330f672b5b8df5fac1f79d3bcf8cf1`. 최종 저장물/Native 결과는 `ui-verified`, 회귀는 `final-reg-*`이다. [집계 proof](proof.json)에 원문 재현, 최종 소스 해시, 실행 인자와 자원/보존 결과를 기록했다. 기준/최종 소스 백업과 중간 실패 로그도 QA에 보존했다.

중간 실패에는 실제 서식 손실·링크 범위 확대·시작 경계 저장 오류가 포함된다. 오류 주입 검사가 실제 짧은 입력 경로를 거치도록 수정했고, 누름틀 검사의 오래된 로더에는 현재 문단 띠 의존성을 연결했다. 최종 소스와 최종 엔진에서 다시 실행한 검사는 모두 통과했다.

원본 문서/앱/이전 후보/QA 보호13,561파일 SHA256이 일치한다. target 최고4.057GiB, 실제 여유 최저20.103GiB로 target≤4.5GiB/여유≥15GiB를 지켰다. 새 target·앱/ZIP·캐시 삭제·공개 push/release·보안/계정/인증서/원격 권한 변경은 없다. 검증 CLI는 정상 종료했고 GUI 창은 열지 않았다.

[검사](../../scripts/check-plain-paste.mjs)에 `ENGINE_PKG FIXTURE_DIR OUTPUT_DIR`를 전달한다. [Native 예제](../../engine/examples/bookmark_preservation_check.rs)의 `prepare-paste NEW_FIXTURES PRIOR_SYNTHETIC_FIXTURES`로 작은 입력 하나를 만들고 `verify UI_OUTPUT_DIR`로 독립 대조한다. 다음은 별도 Mac 앱 통합 후 실제 선택/캐럿·Cmd+V·Cmd+Z/redo·물리 IME·HWP/HWPX 재열기와 한컴 호환 확인이다.
