# 일반 텍스트 뒤의 정적 수식 한 줄을 포함한 미주

기준 main은 `8ee45e36aa049c6d583819abe82e6e1e12ce063a`이다. 기존 순수 텍스트
미주 분할을 아주 좁은 개체 포함 사례로 확장한다. 독립 검토와 실제 앱 QA 전까지
Draft를 유지하며 병합·배포하지 않는다.

## 결함과 변경 범위

하나의 미주에서 긴 일반 텍스트 문단 뒤에 작은 인라인 수식 문단이 있으면,
개체가 있다는 이유로 미주 전체가 기존 경로를 사용했다. 합성 입력의 확장 상태는
3쪽이어도 텍스트·수식 177개가 소유 프레임 밖에 놓였다. 수정 후 같은 입력의
이탈은 0개다. 긴 4,328자 텍스트 사례는 7쪽에 나뉘고 마지막 수식을 한 번 그린다.

새 경로는 단 폭이 같고 미주가 하나이며, 마지막 문단에 수식 하나만 있는 경우에
한한다. 앞 문단은 기존 순수 텍스트 계약을 만족해야 한다. 수식은 글자처럼 취급,
CHAR 모드, 위치 오프셋 0, 양수인 선언 크기를 요구한다. 실제 문단 폭으로 재조판한
마지막 문단이 한 줄이고 줄·간격 전체가 빈 프레임에 들어가야 한다. 수식 문단은
나누지 않고, 앞 텍스트만 기존 canonical 줄 범위로 반복 분할한다.

원본 모델을 고치지 않는다. 렌더 전용 복사본의 `sequential_endnote`를 사용한다.
파일 포맷 인코딩, serializer, 수식 속성, 공개 API와 커서 코드는 변경하지 않는다.

## 지원하지 않는 경우와 알려진 결함

- 서로 다른 단 폭, 같은 문단의 장문과 수식 혼합, 첫 문단의 수식, 여러 수식,
  LINE 모드, 과대 수식, 다른 종류의 개체는 기존 경로를 유지한다.
- 서로 다른 두 단의 확장 입력은 기존과 동일하게 171개 이탈이 남는다. 원본
  모델의 1,451자(번호 포함) 중 렌더 스트림에는 1,199자만 나오는 기존 표시 누락도
  보존된 실패로 기록한다. 이번 수정으로 해결했다고 주장하지 않는다.
- 수식 문단 **자체의 텍스트 커서**에는 기존 source offset과 합성 개체 슬롯 사이의
  불일치가 남는다. `EQ_END`의 source offset 0이 끝 슬롯으로 연결되는 문제다.
  기준 main에서도 같은 오류를 확인한다. 앞 일반 텍스트의 커서와 구분하며,
  수식 문단 텍스트 편집을 새로 지원한다고 주장하지 않는다.
- 별도 실제 앱 QA에서 기준 main의 짧은 합성 HWPX를 정품 한글 12.30.0으로 열 때
  파일 손상 안내가 확인됐다. 입력·출력·화면·로그는
  `/Users/sw107/Documents/Codex/2026-10-17/task/hancom-access-retry-20261019`에 보존했다.
  이 renderer 변경은 그 상호운용 실패를 수정하거나 한글 호환성을 인증하지 않는다.

## 재현과 판정

`endnote_object_repro`는 빈 문서에서 만든 합성 base를 읽고, 공개 수식 삽입 API로
테스트 수식을 만든다. 사용자 문서는 수정하지 않는다. 일반 텍스트 대조군과 좁은
지원 범위 6개, 제외 범위 6개를 만들어 총 13사례를 관찰한다. 각 사례의
before → 삽입 → snapshot undo → redo를 기록하며, Native는 live·HWPX 재열기·모델
재구성을, WASM은 live·HWPX 재열기를 대조한다. 실제 앱 키보드 undo 인증은 아니다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example document_endnote_flow_check --example endnote_object_repro
python3 scripts/prepare-endnote-text-flow.py "$FLOW_BINARY" "$FRESH_BASE"
"$REPRO_BINARY" seed "$FRESH_BASE/single-long.hwpx" "$FRESH_MATRIX"
"$REPRO_BINARY" "$FRESH_MATRIX/manifest.json" "$FRESH_NATIVE"
node scripts/check-endnote-tail-equation.mjs wasm "$FIXED_PKG" \
  "$FRESH_MATRIX/manifest.json" "$FRESH_NATIVE/raw.json" "$FRESH_WASM"
```

기준 Native producer는 같은 관찰 example을 main 8ee의 별도 checkout에서 빌드한다.
기준 WASM도 그 main에서 빌드한 SDK를 사용한다. 두 WASM 관찰은 동일한 수정 Native
raw를 **query template으로만** 사용한다. 렌더 텍스트·좌표와 수식 속성은 각 WASM에서
직접 읽는다. 수정 SDK 대신 기존 SDK를 사용하는 것은 수정 검증이 아니다.

```sh
node scripts/check-endnote-tail-equation.mjs wasm "$BASE_PKG" \
  "$FRESH_MATRIX/manifest.json" "$FRESH_NATIVE/raw.json" "$FRESH_BASE_WASM"
node scripts/check-endnote-tail-equation.mjs verify \
  "$FRESH_MATRIX/manifest.json" "$BASE_NATIVE/raw.json" "$FRESH_NATIVE/raw.json" \
  "$FRESH_BASE_WASM/raw.json" "$FRESH_WASM/raw.json" "$FRESH_PROOF"
python3 scripts/check-endnote-equation-xml.py \
  "$FRESH_MATRIX/manifest.json" "$FRESH_XML_PROOF" \
  "$BASE_NATIVE" "$FRESH_NATIVE" "$FRESH_BASE_WASM" "$FRESH_WASM"
```

모든 출력 경로는 새 경로여야 한다. 판정은 source 텍스트·논리 개체 위치·수식 속성,
렌더 문자 정확히 한 번 배치, 소유 단/본문 경계, 수식 주소·개수, Native/WASM 좌표,
일반 텍스트 커서와 hit-test 역변환을 확인한다. JSON 좌표 허용 오차는 0.051px,
프레임 경계는 0.1px다. 수식 XML은 속성 순서를 제외한 태그·속성값·텍스트·자식이
입력과 같은지 검사한다.

WASM JSON에는 `char_start`가 없다. 관찰 파일의 WASM `start`는 방출된 텍스트와 개체
슬롯을 센 값이다. 지원하는 수정 사례에서는 Native의 실제 source 범위와 일치를
요구한다. 기존 실패 사례의 source 구멍을 이 값으로 덮어 정규화하지 않는다.
기준의 렌더 시작 주소 불일치와 표시 누락을 별도 기록하고, 제외 경로는 수정 전후 렌더와 실제
커서 API 결과가 같은지 검사한다.

## 증거와 한계

검증 원본·실행 파일·SDK·실패 로그의 작업 루트는
`/Users/sw107/Documents/Codex/2026-10-14/task/endnote-candidate-repro-20261019`이다.
기존 원본과 동결된 회귀 입력은 보존한다. 이전 컴파일 실패 후 옛 binary를 사용한
무효 prototype 기록, Cargo 임시 파일 조회 race, 용량 보호 중단, 판정 스크립트의
잘못된 기대값과 변수 이름 충돌도 삭제하지 않는다. 무효 기록을 성공 근거로 쓰지 않는다.

전체 Rust unit compile은 기존 누락 include 4개 때문에 실행하지 못한다. 현재
production 소스는 7개 Native example의 실제 빌드로 타입 검사했고 그 실행 파일을
해시로 고정했다. 이후 변경은 관찰 checker와 문서뿐이다. Studio/SDK 타입 검사와
기존 엔진·host/UI 회귀 결과는 함께 제공하는 proof에 기록한다. CI가 없거나
등록되지 않은 상태를 CI 통과로 표현하지 않는다. 새 head의 실제 앱, 물리 IME,
정품 한글 교차 편집·저장, 서명된 배포 패키지와 인쇄 일치는 별도 검증이 필요하다.

최종 로컬 판정은 13사례·52상태이며, 지원 7사례의 이탈·표시 누락은 0이다.
일반 텍스트 커서 Native 882회와 대응 WASM 588회, 수식 렌더 Native 72회를
대조했다. 수식 문단 자체의 기존 offset 0 오류 72회는 지원 통과 수에 넣지 않았다.
수식 XML 비교는 208파일에서 일치했다. 새 SDK WASM SHA-256은
`8d0c4391720d5fdf692881ee6f742c16c0b59c914e74db3b5059e4e528b9702f`다.

기존 회귀 20명령: 미주 진입 Native 98/WASM 109 query, 190 DOM adapter 진입,
flow 20사례·100상태와 보존 최소 재현 3사례·15상태, 긴 커서 Native 6,558/WASM
4,372회, donor 입력·이력 6사례·24상태, 과거 blocked donor 5대상·40관찰, HWP
거절 19사례, 기존 cache/physical/carry 각각 67/65/45 비교가 통과했다.
physical HWP 계약은 정상 재열기 5회와 명시적 거절 25회이며 30회 재열기 성공이 아니다.
Studio와 SDK 타입 검사 2개, host/UI unit 110개도 통과했다.
원본 dirty diff와 untracked 9개, 동결 증거 11루트·23,047파일, 한글 실패 증거
15파일의 해시를 재확인했다. 실제 앱을 실행하지 않은 비계측 UI bundle은 빌드했으며
폰트/public 설치·서명 패키지는 만들지 않았다. Vite의 기존 externalized module 및
큰 chunk 경고와 Node experimental 경고는 로그에 남아 있다.
