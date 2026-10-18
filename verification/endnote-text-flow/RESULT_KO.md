# 긴 텍스트 미주의 줄 범위와 프레임 경계

기준은 main `2a9c13448fdf682f169e5d4ba025135432d36fd1`이다. PR85의 캐시 갱신은
포함되어 있으며, 미병합 PR86의 미주 진입 및 PR87의 HWP 저장 거절 코드는 포함하지
않는다. 이 변경에는 두 PR의 코드 의존성이 없다. 독립 검토·실제 앱 QA 전까지
Draft와 병합 보류를 유지한다.

## 결함과 변경

기존 단일 단 미주는 한 문단 전체가 한 쪽보다 길어도 `FullParagraph` 한 개로
방출했다. 다단의 기존 분할 경로도 첫 조각과 나머지 전체의 두 조각으로 제한된다.
따라서 live와 HWPX 재열기의 쪽 수가 같아도 수천 px 아래로 그릴 수 있었다.
순수 텍스트에 한해 다음 계약으로 별도 조판 경로를 사용한다.

- 번호 장식을 포함한 렌더 전용 문단을 실제 소유 구역의 단 폭으로 재조판한다.
  확정한 같은 줄 공간으로 측정·분할·재생하며, 조각을 그릴 때 다시 줄을 바꾸지 않는다.
- 남은 높이에 들어가는 `PartialParagraph` 범위를 방출하고 다음 단·쪽에서
  반복한다. 뒤 조각도 다시 분할하므로 세 쪽 이상인 한 문단을 처리한다.
- 앞 본문의 실제 렌더 끝을 시작점으로 사용한다. 다단 본문의 fit 계산에서 생략한
  후행 간격 때문에 미주가 아래로 밀리는 경우를 여기서 보정한다.
- 혼합 언어 run을 매번 정수 px로 반올림해 양쪽 정렬의 여유 폭을 만드는 대신,
  이 렌더 전용 문단은 기존 프레임의 소수 좌표 경로를 사용한다.
- 문단 앞뒤 간격·미주 사이 간격은 시작/마지막 조각에 한 번 적용한다.
  번호 접두사를 붙이면서 원문 선두 공백을 삭제하지 않는다.

원본 문단, source 주소, 저장 줄 캐시는 바꾸지 않는다. `sequential_endnote`는
렌더용 복사본에만 설정하는 내부 표식이며 HWP/HWPX·IR dump에 직렬화하지 않는다.
미주의 source map은 기존 물리 구역/문단/control/note paragraph 주소를 유지한다.
캐시 키와 미주 진입 정보 조회는 바꾸지 않는다. 후속 P2 수정은 아래와 같이
source offset에 맞는 미주 커서 조각을 별도로 찾는다.

## 회귀 계약과 재현

`prepare-endnote-text-flow.py`는 빈 문서에서 생성한 합성 입력만 사용한다. 긴 한
문단, 여러 문단·미주·donor, 양방향 구역 폭 차이, 작은 용지, 큰 여백, 같은 폭의
두 단, 빈 미주·중간 빈 문단, 구분선·미주 사이 간격, 문단 여백, 자동 번호,
원문 선두 공백, 정확한 경계와 한 줄 초과를 고정한다. 한글·이모지와 참조 전후
본문을 포함한다.

각 입력은 before → 확장 → snapshot undo → redo → 축소의 다섯 상태에서 HWPX
저장·재열기를 비교한다. Native는 모델 전체 재구성도 별도로 비교한다. snapshot
복원 검증이며 실제 앱의 키보드 undo를 인증하지 않는다.

공통 oracle은 원본+요청한 삽입 텍스트, 번호 장식을 제외한 원문 일치, 렌더 문자
범위의 연속성·정확히 한 번 배치, 모든 줄 조각의 연속성, source 주소, 단·본문·용지
경계, 본문이 정확히 한 번 포함됨을 검사한다. Native/WASM의 쪽 정보·run 텍스트와
좌표도 비교한다. JSON 좌표 반올림은 0.051px, 프레임 경계 허용 오차는 0.1px다.
쪽 수나 텍스트 해시만 같다는 이유로 성공으로 판단하지 않는다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example document_endnote_flow_check
python3 scripts/prepare-endnote-text-flow.py "$BINARY" "$FRESH_FIXTURES"
"$BINARY" "$FRESH_FIXTURES/manifest.json" "$FRESH_NATIVE"
node scripts/check-endnote-text-flow.mjs wasm "$WASM_PKG" \
  "$FRESH_FIXTURES/manifest.json" "$FRESH_WASM"
node scripts/check-endnote-text-flow.mjs verify "$FRESH_NATIVE/raw.json" \
  "$FRESH_WASM/raw.json" "$FRESH_FIXTURES/manifest.json" "$FRESH_PROOF" fixed
```

출력은 새 경로여야 한다. 수정 전 main에 링크한 동일 producer와 main WASM으로
같은 입력의 실패를 보존한다. baseline WASM producer의 마지막 인자는 `baseline`,
oracle의 마지막 인자도 `baseline`이다. 최종 18문서·90상태에서 문자 범위·줄 구간·단/본문/용지 경계 위반이 모두 0이다.
수정 전 같은 입력은 기하 위반 30상태와 선두 공백 누락 3상태를 보였다. 원본 모델의
텍스트는 두 버전 모두 보존했다. 기존 main의 Native live는 모델 전체 재구성과
90상태 모두 같았지만, HWPX 재열기 렌더는 45상태에서 달랐다. 새 경로는 90상태
모두 동등하다. 이 차이를 PR85의 캐시 잔존 재현으로 분류하지 않는다.

이전 조사에 보존한 최소 2구역 입력과 단일 구역 316회/1200회 입력도 별도로
15상태를 Native/WASM에서 확인했으며 문자·줄 구간·경계 위반은 0이다.

기존 미주67·물리구역65·carry45회 비교도 Native/WASM 모두 통과했다. Cargo check와
네 standalone producer 빌드, Studio 및 새 SDK surface TypeScript 검사도 통과했다.
전체 Rust unit 컴파일은 main에서부터 누락된 include 4개로 차단됐으며 실행 성공을
주장하지 않는다. 현재 SDK는 `66c457f40a101cc40578dc539062fc95b3a5486920a3b1ae0f320cef94c42fc5`이다.
JS·두 선언 파일은 main SDK와 byte 단위로 동일하다. 정확한 계수·해시·범위는
`proof.json`에 기록한다.

## P2: continuation의 source offset과 커서

초기 head `1b488f4bb6bd09b5475a0ebd6230b8a9b4e6586e`는 위 렌더 계약을
통과했지만 `getCursorRectInNote`가 첫 쪽을 고른 뒤 요청 offset을 찾지 못하면
그 쪽 마지막 run으로 대체했다. 독립 검토의 `(0,0,2,0)` 미주 offset 10806은
실제로 0-based page 1에 있는데 page 0의 끝 좌표를 반환했다. HWPX 재열기와
snapshot redo에서도 재현됐다. 이전 렌더 검증은 이 커서 결함을 검출하지 않았다.

현재는 기존 source map에서 실제 렌더 소유 구역을 찾고, 해당 미주 문단이 있는
쪽의 실제 run 범위에 요청 offset이 들어가는지 확인한다. 순차 조판 문단의 줄
시작은 UTF-16에서 scalar 위치로 바꿔 후보를 줄인다. 경계 offset은 다음
줄·단·쪽의 시작 run을 우선하며, 전체 후보 조회 전에 첫 쪽 끝으로 대체하지
않는다. 번호 접두사 변환을 유지하고 다른 미주 문단의 접두사는 더하지 않는다.

PR86의 `getNoteEditInfo` 진입 정보 수정이나 PR87 코드는 포함하지 않았다.
커서 조회는 별도 helper로 소유 구역과 offset을 함께 해결하므로 PR86 커밋에
의존하지 않는다. 두 PR은 기존 커서 호출부가 겹쳐 병합 때 조정이 필요할 수 있다.
구역을 넘는 UI 미주 진입·dispatch의 인증은 여전히 PR86 및 실제 앱 QA 범위다.

`endnote_cursor_fragment_check.rs`와 `check-endnote-cursor-fragments.mjs`는
독립된 실제 render run으로 예상 쪽·문자 구간·좌표를 구한다. 분할 앞/경계/뒤,
문단 끝, 여러 문단·미주, 물리 구역 폭 차이, 두 단, 빈 문단, 번호 접두사,
한글·이모지를 before/확장/undo/redo에서 검사한다. 각 상태에서 Native live,
HWPX 재열기, 전체 모델 재구성 및 WASM live·재열기를 비교한다. 커서 좌표의
hit-test가 같은 render owner·문단·scalar offset으로 돌아오는지도 확인한다.
hit-test의 render 주소는 producer가 수집한 source map을 통해 검증하며 UI 진입
정보 API를 예상값으로 사용하지 않는다. 빈 문단의 전체 폭 placeholder는 글자
끝 좌표로 간주하지 않는다.

초기 head와 SDK `8c051920...`에서 같은 oracle은 18문서·72상태의 2,810건
실패를 검출했다. 전달받은 재열기 재현 파일(sha256 `694ebbf7c584989e06899fb3c1a8d21acc826f8990d61981d3778765ea490431`)을
추가한 현재 19문서·76상태는 Native 5,682건·WASM 3,788건에서 실패·상태 차이
0이다. 해당 offset 10806은 page 1을 반환하고 hit-test는 번호 접두사 3글자를
포함한 render offset 10809로 되돌아온다. 두 런타임의 커서·hit 결과도 동일하다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example endnote_cursor_fragment_check
"$CURSOR_BINARY" "$MANIFEST" "$FRESH_NATIVE"
node scripts/check-endnote-cursor-fragments.mjs wasm "$WASM_PKG" \
  "$MANIFEST" "$FRESH_NATIVE/raw.json" "$FRESH_WASM"
node scripts/check-endnote-cursor-fragments.mjs verify "$FRESH_NATIVE/raw.json" \
  "$FRESH_WASM/raw.json" "$FRESH_PROOF" fixed
```

이 절의 기계 판독 기록은 `cursor-proof.json`이다. 이전 실패·검토 근거는
덮어쓰지 않고 별도 동결 경로에 보존했다. 기존 90상태 및 최소 입력 15상태의
텍스트·줄·기하 계약도 현재 SDK로 다시 통과했다.

## 지원 범위와 남은 검증

새 경로는 같은 렌더 묶음의 모든 미주가 순수 텍스트이고 단 폭이 동일할 때다.
미주 자체 자동 번호는 허용한다. 중첩 표·그림·수식, 필드·링크, 서로 다른 단 폭,
탭·문단 내 강제 줄바꿈, 별도 문단 머리 번호/글머리표와 명시적 페이지/단 나누기,
문단 keep/widow 규칙은 기존 경로로 남긴다. 지원하지 않는 개체 미주가 한 개 섞인
묶음도 기존 경로다. 이들의 긴 문단 경계 문제까지 해결했다는 주장이 아니다.

글자 한 줄이나 문단/미주 간격 자체가 빈 프레임보다 큰 불가능한 기하는 인증하지
않는다. 진행할 수 없는 한 줄은 `TEXT_ENDNOTE_UNSPLITTABLE_LINE`을 기록하고 문자
보존을 우선한다. 임의 문자 삭제·clip 축소로 성공을 만들지 않는다.

실제 Mac 글결·정품 한글의 열기/편집/저장·시각적 동일성은 미검증이다. UI 자료
전달은 승인 대기이며 다른 작업에 전송하지 않는다. 웹 편집기 개발·배포·앱 창 조작·
사용자 문서 변경은 하지 않았다. CI 부재는 통과로 표시하지 않는다.

기존 HWP 재열기 검사는 렌더 문맥 회귀이며 HWP 구조 보존이나 한글 정합의 인증이
아니다. PR87의 별도 미지원 범위는 이 브랜치에서 해결하지 않는다. 앞 본문의 복잡한
표·부동 개체 및 각주/미주 혼합 배치는 새 18종 행렬의 검증 범위 밖이다.
