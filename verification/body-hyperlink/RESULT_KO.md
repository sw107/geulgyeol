# 일반 본문의 하이퍼링크 삽입·URL 편집·해제

일반 본문 한 문단의 선택 텍스트에 URL을 붙이거나, 선택이 없으면 표시 문구와 URL을 삽입한다. 기존 링크는 URL 편집과 링크 해제를 지원한다. 해제는 표시 텍스트를 삭제하지 않는다. 삽입 메뉴·툴바·Ctrl+K,H 명령을 실제 대화상자와 공통 snapshot 이력에 연결했다. 기존 링크 표시 문구는 편집 대화상자에서 읽기 전용으로 유지한다.

기준 로컬 HEAD `da1e75232a87f936c827035955f1bd57eb488dd8`. 기존 HWP5/HWPX `Control::Field(FieldType::Hyperlink)`와 짝 있는 `FieldRange`를 사용하며 URL은 기존 `command`/HWPX `Command` 문자열에 저장한다. serializer·문서 형식을 새로 만들지 않았다. HWP3 전용 `Control::Hyperlink`는 사용하지 않는다.

## 보존과 거절

선택을 감쌀 때 표시 텍스트·글자/문단/스타일 참조를 유지한다. 표시 문구 삽입은 기존 텍스트와 바깥 각주 앵커를 이동하고 이웃 필드가 새 텍스트를 흡수하지 않게 한다. URL 편집은 오래된 HWPX parameter 원문 캐시를 비워 새 URL을 저장한다. 해제는 해당 paired tokens와 소유 필드만 제거한다. 삽입과 해제는 복제한 문단에서 검증한 뒤 한 번에 반영한다. ID 할당은 기존 본문/하위 필드와 각주·머리말/꼬리말의 최대 ID를 피한다.

본문 한 문단의 독립 범위와 명시적 http:// 또는 https:// URL만 지원한다. 필드 겹침, 내부 각주/개체/범위 참조, 잘못된 UTF-16/control 축, 복합 parameter/CTRL_DATA 참조, 잘못된 ID/좌표는 쓰기 전에 거절한다. WASM API는 음수·소수·NaN·무한대·u32 초과 좌표를 잘라 받지 않는다. 셀·각주·머리말/꼬리말 또는 여러 문단 선택은 UI에서 거절한다. 대화상자 취소·문서/편집 모드 변경·실패한 편집은 문서와 기존 redo를 보존한다. URL을 실행하거나 브라우저를 여는 기능은 추가하지 않았다.

실제 UI 검사에서 링크 끝 캐럿이 기존 링크 편집으로 잘못 넘어가는 첫 후보 결함을 발견했다. 조회를 `[start,end)`로 통일해 끝에서는 새 표시 문구 삽입이 되도록 수정하고 회귀를 추가했다. 초기 실패 로그와 후보 해시는 `../body-hyperlink-qa/wasm-boundary-failure.log`, `boundary-failure.json`에 보존했다.

## 검증

| 검사 | 결과 |
|---|---|
| Native 엔진, 한글·이모지·혼합 직접 서식·바깥 각주·붙어 있는 링크 | 정상5, HWP/HWPX 재열기12, snapshot undo/redo 1쌍 |
| Native 비지원 범위/참조/URL | 21호출 거절, 전체 Debug Document/raw_stream/event log 무변경 |
| 최종 WASM + 실제 HyperlinkDialog/CommandDispatcher/WasmBridge/InputHandler/SnapshotCommand/CommandHistory | 정상6, undo/redo 각6, 재열기22, 취소/거절37, URL 실행0 |
| WASM 저장물의 독립 Native 교차 검사 | 22파일의 전체 글자/문단/스타일 참조, paired field 범위·URL·표시 문구·각주 트리 일치 |
| 이전 ClickHere 회귀 | 재열기54+별도 보존 사례4, undo/redo 각24, 거절14, 셀 회귀6 |
| 이전 이름 셀 회귀 | 정상48, 거절188, 재열기96, undo/redo 각72, 충돌20 |
| 이전 필드 값 원자성 회귀 | 정상10, 비지원18 모두 거절, 재열기20 |
| 컴파일·정적 검사 | Native/WASM release, 후보 d.ts를 사용하는 TypeScript, library+새 Native example Clippy `-D warnings` 통과 |

대상 문단은 가운데 정렬/왼쪽 여백의 직접 문단 서식, 이웃 문단은 style ID 1과 별도 오른쪽 정렬/여백/기울임 서식을 갖는다. 모든 명령 뒤 이웃 문단의 전체 속성이 그대로임을 확인했다.

문서 읽기 형식에 따른 raw DocInfo 캐시 차이를 편집 손실로 비교하지 않는다. 각 적재 문서에서 편집 전후 DocInfo 전체가 동일함을 검사하며 저장물에서는 실제 글자/문단/스타일 ID 참조를 독립 Native 예상 문서와 정확히 비교했다. UI fixture의 기존 빈 BorderFill 차이는 편집 **전** 한 번 정규화하고 fillType/patternColor/patternType만 달라졌음을 검사한다. 편집/이력/재열기 비교에는 필터가 없다.

## 후보·자원·한계

별도 `../body-hyperlink-qa/pkg/rhwp_bg.wasm` SHA256 `47ac09b97f1ce74df713e25453a6219e297b225d84e68f1c77986230f94744f4`. 기본 연결 `pkg`, dev8/dev7/dev6/DevEnter/BetaNext 및 이전 후보 WASM의 보호 해시8개 모두 보존했다. 원본 문서/기본 앱/기존 공개 앱에 쓰지 않았고 새 앱·ZIP·패키징·공개 push/release는 없다.

Cargo offline+locked, 기존 의존성/target 재사용, jobs2, debug/incremental 비활성화. Cargo는 순차 실행하고 빌드 중 엔진 소스를 수정하지 않았다. 2초 감시 기준 target4GiB/free10GiB. 관측 target 최고3.358GiB·최종3.264GiB, 최소 여유22.736GiB. 예산 중지·캐시 삭제·설치·대형 clone·보안/계정/인증서/원격 권한 변경 없음.

Mac arm64의 보존된 dev8 Electron을 Node 모드로 사용했다. DOM/커서 geometry/refresh는 어댑터이며 실제 Mac GUI·물리 IME·이번 Linux 검사·새 패키징은 미검증이다. GUI 창을 열지 않았고 검사 프로세스는 종료했다. 전체 Rust library unit test는 기존 누락 include_bytes fixture3개 때문에 차단돼 있으며 대체·검사 제외로 우회하지 않았다. 복잡한 가져온 링크 전체나 한컴 한글 전체 대체 완료를 인증하지 않는다.

다음 확인은 후보를 별도 Mac 개발 앱에 연결해 메뉴·툴바·키보드·실제 선택/캐럿·대화상자 취소/해제·물리 IME 이후 이력과 저장재열기를 보는 것이다. 셀/각주/머리말의 링크 저작, 기존 표시 문구 편집, URL 실제 열기는 별도 범위다. 세로 조판과 선택형 OCX occurrence 누락은 변경하지 않았다.

원시 fixture/저장물/log: `/Users/sw107/Documents/Codex/2026-10-06/task/body-hyperlink-qa`. 집계 근거 [proof.json](proof.json). 재현 코드 `engine/examples/body_hyperlink_check.rs`, `scripts/check-body-hyperlink.mjs`. 재개 checkout `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, branch `dev/style-propagation`.
