# 책갈피 문단 간 본문 선택 삭제

`b9c9896`의 Enter·Backspace·Delete 및 앞선 서식/참조 보존을 유지하며, **한 섹션의 일반 본문에서 점 책갈피를 포함하는 문단 간 선택 삭제**를 지원한다. 삭제 대상 문단을 복제해 소유권·저장 참조를 검증한 후 한 번에 교체한다. 기존 DeleteSelectionCommand/FragmentDeleteCommand와 삭제 조각 이력을 사용하며 전체 snapshot 경로를 새로 만들지 않았다. 보존된 dev11 앱에는 통합하지 않은 소스·검증 WASM 후보다.

## 좌표·지원 경계

시작/끝은 같은 섹션의 정렬된 `(문단, Unicode scalar 위치)`이며 텍스트 선택은 `[start,end)`다. 두 문단 사이의 줄바꿈도 삭제하므로 앞 문단 끝→뒤 문단0은 실제 병합이다. 빈 동일 위치 선택은 문서·이벤트·선택·undo/redo를 변경하지 않는다. WASM은 모든 인덱스의 음수·소수·NaN·무한대·u32 범위 초과를 강제 변환하지 않고 거절한다.

삭제 앞 책갈피는 그대로, 삭제 범위 안과 양쪽 경계 책갈피는 삭제 시작점으로 모은다. 끝 문단의 삭제 뒤 책갈피는 `startOffset + oldOffset - endOffset`으로 옮긴다. 이름과 각 CTRL_DATA는 유지하며, 동일 위치에 모여도 서로 다른 책갈피로 남는다. 뒤 문단 인덱스는 제거한 문단 수만큼 줄어든다. 본문 전체를 선택해도 책갈피가 있는 빈 문단 하나를 남긴다.

생존 prefix/suffix 글자별 직접 서식과 삭제 밖의 온전한 필드/링크/주석 및 각주/미주 내용·서식을 보존한다. 필드 control index·범위·8유닛 슬롯·control mask를 재계산한다. 결과 문단은 첫 문단의 문단 속성과 스타일을 사용하며, 제거한 문단의 속성·원본 참조·꼬리 줄 좌표·raw/provenance·캐럿은 기존 삭제 조각 undo가 복원한다.

첫 문단의 필드 끝이 start와 같거나 끝 문단의 필드 시작이 end와 같으면 온전한 필드가 삭제 밖에 남는다. 빈 필드가 삭제 경계에 닿거나 각주/미주 위치가 삭제 경계에 닿는 경우는 보수적으로 거절한다. 선택이 필드/주석/각주를 포함하거나 자르는 경우, 중간 문단에 이런 참조가 있는 경우도 거절한다. 주석+각주 복합 구조·겹침·개체/표·범위 tag·불명 CTRL_DATA/추적 참조·확장 탭·고아 FIELD_END 등은 변경 전에 거절한다. 다중 섹션 문서, 제거할 문단의 구역/단/명시 쪽 경계·문단 속성 쪽 나눔·저장 vpos 리셋도 거절한다. 기존 하위 셀/캡션/머리말/각주 내부 구조 편집의 지원 범위를 넓힌 작업은 아니다. 실패하면 본문 선택과 pending redo를 유지한다.

## 최종 자동 검사

| 검사 | 통과 결과 |
|---|---|
| 실제 선택 삭제·조각 이력 | 17작업: 부분/전체/줄바꿈만/빈 문단/emoji, 첫·중간·마지막만 책갈피, 삭제 앞뒤 주석·링크·각주, 두 형식 재열기 후 재편집. undo/redo68쌍에서 HWP/HWPX 바이트·전체 SVG·참조 일치, 선택/캐럿/F3 단계 복원 |
| 저장재열기 | HWP/HWPX68회, content-loss0. 생존 직접 서식·이름/좌표·주석/링크 ID/명령/내용/소유 문단/범위·각주 본문/서식 및 전체 SVG 비교 |
| 원자 거절·no-op | API/UI49회, pending redo·이벤트·문서 불변. UI/엔진 빈 선택2회 no-op. 복합 참조 실패 시 선택/캐럿도 복원 |
| 독립 Native | 같은68저장물에 명령 재실행, 전체 SVG·문단·DocInfo·BinData 대조. 조각102쌍에서 전체 Document/전체 SVG 정확 복원, snapshot102쌍. 복합 저장 참조·다중 섹션·쪽/구역/단·강제 쪽 속성/vpos 리셋 등36회 전체 모델 불변 거절 |
| 이전 책갈피 구조/저작 회귀 | 구조222작업·888재열기·1,068이력쌍·Native888/8,544snapshot쌍. 저작59작업·236재열기·261이력쌍·341거절/no-op·Native236/2,214snapshot쌍 |
| 캡션·주석·링크 회귀 | 캡션76재열기/91이력쌍·Native76/498snapshot쌍. 주석64·앵커168·본문 링크22·셀 링크288재열기, 셀 링크444거절/layout12/다중쪽12 |
| 띠·너비·셀 회귀 | 띠132·너비40재열기, 이력33/20쌍, 기존 너비 SVG32일치. 셀24사례·복원170·재열기82·거절4 |
| 정적 검사 | 최종 생성 WASM DTS로 TypeScript noEmit, lib+책갈피/너비 예제 Clippy `-D warnings`, 변경한 독립 예제/query/새 stage의 rustfmt check, git diff check |

DOM/커서/repaint 및 선택은 어댑터이며 실제 Mac GUI·키보드·물리 IME·한컴·Linux 검증은 아니다. Native canonical 대조는 기존 writer의 각주 자식 헤더 끝0 패딩만 정규화한다. 전체 lib unit test는 기존 include_bytes fixture3개가 없어 실행하지 않았고 임의 대체/제외하지 않았다. 앱 패키징/기동은 이번 범위에 없고 dev11 앱은 CLI Node 실행에만 사용했다.

## 후보·보존·재현

QA `/Users/sw107/Documents/Codex/2026-10-06/task/bookmark-range-qa`. 최종 `pkg-final/rhwp_bg.wasm` SHA256 `614ac6f48199e3cac3c15b1e203a21800b18fcef1aecdf1f1b011cc612b1e4f2`. 최종 입력10개는 `fixtures-final`, 저장물과 독립 Native 결과는 `ui-final`. 기존 회귀는 `reg-*`, 최종 주석/앵커 회귀는 `reg-comment-isolated-final`/`reg-anchor-isolated-final`이다. 소스 백업과 최종 source hash, 실행 인자/자원 감시/한계는 [proof](proof.json)에 남겼다.

첫 회귀 실행이 이전 QA 입력 폴더의 검증용 manifest2개를 잠시 덮어썼다. 원본 해시와 일치하는 내용으로 정확히 복원했고 해당 검사는 작은 합성 입력만 새 QA 폴더에 옮겨 다시 통과했다. 문서/앱은 변경되지 않았고, 최종 보호10,764파일 SHA256이 모두 일치하며 이전 QA에 새 파일도 없다. 실패/중간 로그는 남겼다.

기존 target 최고4.154GiB·최종3.960GiB, 실제 여유 최저19.340GiB로 target≤4.5GiB/여유≥15GiB를 지켰다. 결과 기록 전 추가 QA는 약67MiB다. 삭제/정리·새 target·앱/ZIP·공개 push/release·보안/계정/인증서/원격 권한 변경은 없다. 빌드/검증 CLI는 정상 종료했고 GUI 창은 열지 않았다.

개발 checkout에서 [검사](../../scripts/check-bookmark-range.mjs)에 `ENGINE_PKG FIXTURE_DIR OUTPUT_DIR`를 전달한다. [Native 예제](../../engine/examples/bookmark_preservation_check.rs)의 `prepare-range NEW_FIXTURES PRIOR_SYNTHETIC_FIXTURES`로 입력을 만들고 `verify UI_OUTPUT_DIR`로 독립 대조한다. 추가 확인은 Mac GUI에서 실제 선택·캐럿/F3·undo/redo·물리 IME와 두 형식 재열기, 한컴 호환 검증이다. 복합 참조를 포함하는 선택 삭제의 지원 확대는 별도 작업이다.
