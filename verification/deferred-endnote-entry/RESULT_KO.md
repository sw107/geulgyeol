# 문서 끝 미주 편집 대상과 렌더 구역

기준 main은 PR85 병합 `2a9c13448fdf682f169e5d4ba025135432d36fd1`이다. 두 독립
검토의 exact head `22ca50bbee587d35013c699b39f607bb439e0515`와 병합 tree가 같고,
PR83 UI도 포함한다. 병합 후 Native/WASM 미주 캐시67회·carry45회·물리 구역65회와
UI90·타입 검사를 다시 통과했다. PR85의 donor5종 snapshot 경로 승인은 캐시·이력·
저장 통합 범위이며, 직접 입력은 대조군4종만 확인한 범위로 유지한다.

## 최소 재현과 수정

머리말·바탕쪽 없는 합성2구역·본문2문단·미주1개에서 첫 구역의 문서 끝 미주는
마지막 구역에 보인다. 하지만 `getNoteEditInfo(0,0,2)`와
`getCursorRectInNote(0,0,2,0,2)`는 모두 “미주 렌더 위치를 찾을 수 없습니다”를
반환했다. 기존 UI bridge는 이 오류를 null로 바꾸므로 `enterNoteEditing`이 반환해
미주 입력 모드로 들어가지 못했다. PR85의 캐시 수정과 독립적인 기존 결함이다.

`find_endnote_edit_target`은 원본 구역의 pagination만 조회했다. 이제 pagination의
`endnote_para_sources`에서 원본 section/paragraph/control/note-paragraph 튜플을
찾는다. 전역 page 번호, 렌더 구역 및 그 구역의 본문 문단 수를 기준으로 한 가상
미주 문단 번호를 함께 결정한다. 커서 렌더 트리 조회도 실제 렌더 구역을 사용한다.
원본 미주 주소, 공개 JSON/API 형태, 조판·저장·캐시 무효화·UI 소스는 바꾸지 않는다.

## 검증 계약

합성11종: PR85의9종에 원본/렌더 구역의 본문 문단 수가 다른2구역 대조군과,
마지막 구역에 자기 미주도 있는 혼합 대조군을 더했다. 새 추가 본문 문단에는
secPr·column control이 없음을 생성기에서 보장한다. 기존 검토 입력은 선택 인자로
복사할 수 있고, 생략 시 자체 생성10종을 사용한다.

- Native: 98회 편집 진입/커서 조회 실패63→0. HWPX 재열기77회, snapshot 복원33회.
- WASM: 새 미주 삽입 직후의 진입을 더해109회 조회 실패71→0. HWPX 재열기88회,
  snapshot 복원33회. 각각 잘못된 section/paragraph/control/비미주 거절44회 유지.
- 작은 입력, 두 미주/두 donor의 주소 구분, 문단 분할 후 두번째 내부 문단 커서,
  병합, undo/redo, 재열기 결과를 비교한다. 입력 후 원본 note 문자열과 본문 보존도
  확인한다. 렌더 가상 문단과 caret의 같은 줄을 확인하고, 내용이 있는 미주는
  TextRun의 가로 범위도 비교한다.
- WASM 검사에는 현재 UI의 `enterNoteEditing`, bridge 및 cursor의 실제 메서드를
  타입 제거 후 그대로 불러 DOM 대역과 연결했다. 성공190회는 live/cold 반복을
  포함한 **어댑터 호출 횟수**다. 실제 앱·물리 키 입력 횟수가 아니다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example document_endnote_cache_check --example deferred_endnote_entry_check
python3 scripts/prepare-deferred-endnote-entry.py "$CACHE_BINARY" "$FIXTURES" "$OPTIONAL_REVIEW_SEED"
"$ENTRY_BINARY" "$FIXTURES/manifest.json" "$NATIVE_OUTPUT" fixed
node scripts/check-deferred-endnote-entry.mjs "$WASM_PKG" \
  "$FIXTURES/manifest.json" "$WASM_OUTPUT" fixed
```

출력은 새 폴더여야 한다. 수정 전 바이너리/SDK에는 `baseline` 모드를 쓴다.
정확한 소스·바이너리·WASM 해시와 최종 회귀 계수는 `proof.json`에 기록한다.

## 실제 앱 담당자에게 전달할 입력 계약

1. 고정된 WASM 패키지와 이 head의 UI bundle 해시를 확인한다. 원본 donor5종과
   대조군4종을 각각 열고, 기존 `getNoteEditInfo` 기반 진입 경로를 사용한다.
   임의의 note-mode 강제 설정이나 snapshot 교체로 진입 성공을 대신하지 않는다.
2. 입력 인자는 **원본 미주**의 section/paragraph/control이다. `pageNum`은 렌더된
   전역 페이지 번호이고 `virtualParaIndex`는 렌더 구역의 가상 주소다. 화면 page의
   sectionIndex로 원본 section을 바꾸면 다른 미주를 편집할 수 있으므로 변경하지 않는다.
3. 진입 성공, focus, cursor의 원본 튜플, `getCursorRectInNote`의 pageIndex/좌표를
   확인하고 실제 앱 textarea에 trusted 키 입력으로 한 글자와 짧은 문자열을 넣는다.
   원본 미주만 바뀌고 이웃 미주·본문이 보존되는지 검사한다. 기존에 입력이 되던
   구역 끝/마지막 구역/단일 구역/각주 대조군도 유지한다.
4. 실제 note 입력 command/history로 undo/redo와 문서 전환을 확인한다. 추가2종은
   렌더 본문 길이와 자기 미주가 섞인 주소 구분을 확인한다. 새 `insert:endnote` 명령도
   반환된 새 controlIdx로 즉시 진입하는지 확인한다.
5. HWPX 실제 저장, 동일·새 프로세스 재열기와 live/fresh 페이지·내용을 비교하고,
   source/bundle/WASM/output 해시 및 raw audit·renderer 오류·정상 종료를 고정한다.
   포인터/marker 경로가 실패하면 별도 기록한다. 이 API 계약만으로 모든 포인터
   경로가 통과했다고 표현하지 않는다.

## 한계 및 보존

첫 추가 문단 생성기는 root secPr까지 복제해 의도하지 않은 논리 구역이 생겼다.
그 입력·로그를 보존하고 생성기를 고쳐 새 canonical `entry-fixtures-3`를 만들었다.
초기 WASM 추가 삽입 검사에서 빈 미주 caret x=129.8과 표시 marker의 오른쪽
129.4 간 기존0.4px 차이도 보존했다. 빈 미주는 placeholder가 그려지지 않으므로
가로 ink 범위 검사는 내용이 있는 경우에만 적용한다. API 성공, 유한한 양수 caret,
렌더 문단/줄, UI 메서드 진입, live/fresh 동등성 조건은 유지한다.

실제 앱 키 입력 QA는 인계 대기다. 물리 IME·정품 한글·서명 패키지는 검사하지
않았다. 기존 overflow·미주 분할·여러 쪽에 걸친 같은 문단 내 offset별 caret page
선택·글리프 전체 표시·HWP 바탕쪽 상속은 이 변경의 해결/인증 범위 밖이다. 새
진입 행렬은 HWPX이고 기존65회 행렬의 HWP30회는 새 미주의 HWP 인증이 아니다.
전체 Rust 단위 테스트는 기존 include 파일4개 누락으로 실행 전 컴파일이 막히며,
고정 도구에 Clippy가 없다. CI 등록0은 CI 통과가 아니다. 원본·기존 증거를 보존하고
새 PR은 독립 검토 전 병합·배포하지 않는다.
