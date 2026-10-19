# 불균등 단의 일반 텍스트 미주

기준 main은 `8a9d963d1c465454157e26cf61be8f5d0dfc848c`다. 독립 검토와 실제
앱 QA 전에는 Draft를 유지한다. 이 결과는 엔진 검사이며 병합·배포나 한글 호환성
인증을 뜻하지 않는다. 최종 SDK와 검증 수치는 같은 폴더의 `proof.json`에 기록한다.

## 세 원인과 수정

기존 합성 두 단 입력의 긴 미주는 번호를 포함한 1,451자 중 1,199자만 표시됐다.
좁은 단의 범위 `[0,129)` 다음에 넓은 단이 `[381,1451)`을 그려 252자가 빠졌다.
원문 1,448자는 모델과 저장 파일에 남아 있었다. `PartialParagraph`의 줄 번호를
폭이 다른 재줄바꿈 결과에 그대로 적용한 것이 원인이다.

별도로 `emit_endnote_split`은 한 번만 단을 이동하고 남은 줄을 모두 방출해
171개 TextRun이 프레임을 벗어났다. 새 경로는 매 단의 실제 폭과 남은 높이로
원문의 미소비 구간을 조판한다. 소비한 UTF-16 위치를 다음 구간에 넘기고,
완성된 줄에는 전체 문단 기준 위치를 부여한다. 여러 단과 쪽에 걸쳐 반복한다.

저장 전후 최대 12px 차이는 글꼴 크기 변경이 아니다. 두 상태의 글꼴은 12px로
같다. 저장 전 복사본의 원본 LineSeg는 33개인데 재줄바꿈한 줄은 더 많다.
34번째 줄부터 원본 줄이 없으면 `renders_synthetic_wrap_trailing_space`는 거짓,
원본 줄 자체가 없는 재열기 상태에서는 참이 되어 Justify의 공백 배분이 달랐다.
새 경로는 렌더 복사본의 전체 canonical 줄과 기존 `sequential_endnote` 계약을
사용한다. 일반 저장 줄 정책이나 전역 좌표 허용 오차를 변경하지 않는다.

원본 미주에는 내어쓰기가 있다. 다음 단의 첫 줄은 문단 첫 줄이 아니므로
suffix reflow의 `initial_is_first_line`을 거짓으로 넘긴다. 기존 호출들은 모두
참을 유지한다. 공개 API·커서 코드·serializer·파일 인코딩은 변경하지 않는다.

## 지원 조건과 한계

새 경로는 불균등한 양수 단 폭, 일반 본문, 하나의 미주에 하나의 일반 텍스트
문단으로 제한한다. 문자는 연속된 UTF-16 위치를 가져야 한다. 개체·필드·범위 태그·
문단 나눔·목록·keep/widow 설정을 제외한다. 0 또는 음수 들여쓰기를 허용하며,
모든 단에서 여백과 내어쓰기를 적용한 뒤 양수 폭이 남아야 한다.

양수 들여쓰기, 지나치게 좁은 단, 수식, 여러 미주 문단은 기존 경로를 유지한다.
그 제외 사례의 기존 실패는 수정 성공으로 세지 않는다. 한 줄 자체가 빈 프레임보다
큰 경우에는 기존 indivisible-line overflow 정책을 따르며 한글과의 배치 일치를
주장하지 않는다. 수식 문단의 기존 source/object-slot 커서 문제와 한글의 SHORT
손상 거절도 미해결이다. 실제 앱·키보드·IME·메뉴·한글 왕복은 별도 QA가 필요하다.

## 재현

두 seed는 빈 문서에서 만든 합성 자료다. 사용자 원본은 사용하지 않는다.
출력 경로는 매번 새 경로를 지정한다. 필요한 Native examples는 offline/locked로
빌드하고, 기준 main과 후보는 서로 다른 SDK·실행 파일을 사용한다.

```sh
python3 scripts/make-unequal-endnote-fixtures.py "$FRESH_FIXTURES"
"$NATIVE_REPRO" "$FRESH_FIXTURES/manifest.json" "$FRESH_NATIVE"
node scripts/check-endnote-tail-equation.mjs wasm "$FIXED_PKG" \
  "$FRESH_FIXTURES/manifest.json" "$FRESH_NATIVE/raw.json" "$FRESH_WASM"
node scripts/check-unequal-endnote-source-continuation.mjs fixed \
  "$FRESH_NATIVE/raw.json" "$FRESH_WASM/raw.json" "$FRESH_PROOF" seed
node scripts/check-unequal-endnote-matrix.mjs "$FRESH_FIXTURES/manifest.json" \
  "$BASE_NATIVE/raw.json" "$FRESH_NATIVE/raw.json" \
  "$BASE_WASM/raw.json" "$FRESH_WASM/raw.json" "$FRESH_MATRIX_PROOF_DIR"
python3 scripts/check-unequal-endnote-archives.py "$FRESH_ARCHIVE_PROOF" \
  "$BASE_NATIVE" "$FRESH_NATIVE" "$BASE_WASM" "$FRESH_WASM"
```

지원 8사례 각각에 fixed 검사를 실행한다: seed, unique, reverse, three, long,
unicode, mixed-style, zero-indent. 고유 문자열, 단 폭 반전, 3단, 10쪽 장문,
비 BMP 문자와 혼합 서식을 포함한다. 각 사례의 before/grown/snapshot undo/redo를
Native live/cold/rebuilt와 WASM live/cold에서 비교한다. 이는 실제 앱 undo가 아니다.

Native의 실제 `char_start`로 누락·중복을 검사하고 WASM의 순서·텍스트·좌표와
대조한다. WASM JSON의 `start`는 방출 스트림에서 계산한 값이므로 원문 위치의
독립 근거로 사용하지 않는다. Native 재열기 비교의 1e-9는 부동소수점 잡음 한계다.
Native/WASM 좌표는 기존 JSON의 0.1px 직렬화에 맞춘 0.051px 한계를 유지한다.
12px 차이를 이 한계에 흡수하지 않는다.

`endnote_cursor_fragment_check`는 새 단·쪽 경계의 앞/현재/뒤, 기존 누락 구간의
126/127/377/378/379, 비 BMP 문자 근처를 추가로 탐침한다. 기존 일반 텍스트·
정적 수식 꼬리·미주 진입·donor 이력·HWP 원자적 저장 거절·쪽 문맥 회귀와
Studio/SDK 타입·host/UI 검사를 함께 실행한다. 전체 Rust unit은 저장소의 기존
누락 include 파일 4개로 막혀 있으며, CI 부재를 성공으로 표현하지 않는다.
