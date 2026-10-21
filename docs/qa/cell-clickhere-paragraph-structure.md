# 표 셀 누름틀의 문단 분할·병합

## 문제와 수정 범위

앱과 같은 `createBlankDocument` → `createTable` 경로에서 누름틀을 넣고 값을 입력한 뒤, 누름틀 밖에서 Enter로 셀 문단을 나누면 기존 누름틀의 값 변경이 제어 토큰 오류로 거절된다. Backspace로 문단을 합쳐도 편집 가능 상태가 복원되지 않는다. 일부 경계에서는 저장·재열기 중 글자 모양 차이도 관찰됐다.

셀 경로의 `Paragraph::split_at`/`merge_from` 호출 뒤에 완전히 짝지어진 일반 ClickHere 필드의 문자 축을 다시 구성한다. 필드 소유 컨트롤 외에 별도로 존재하는 FIELD_END 슬롯도 반영한다. 기존 축 검사를 통과하는 텍스트·ClickHere 문단에서만 적용하며 필드 내부를 가르는 분할은 이 수정 범위에서 제외한다. 다른 컨트롤·범위 태그·불명확한 축은 기존 경로를 유지한다. 표 캡션·그림 캡션·글상자·본문 경로는 변경하지 않는다.

## 실행한 검사

- 수정 전 SDK: 일반 새 문서의 누름틀 입력·치환·삭제 20개 조합 통과. 기존 단위 테스트의 셀은 `char_count`에 문단 끝 슬롯이 빠져 있어 같은 실패를 제품 결함으로 간주하지 않았다. 기존 테스트와 검증 조건은 바꾸지 않았다.
- 수정 전 SDK와 현재 앱 명령·CommandHistory: 다음 스타일 적용 유무, 빈 값·한글·보조 평면 문자, 필드 양쪽 경계 및 문단 끝의 28개 사례, 196개 상태. 값 편집 거절 154건, 재열기·이력 비교 차이 98개 비교 묶음을 관측했다. HWP/HWPX 재열기 관측은 392회이며 전체 통과 수치가 아니다.
- 새 Native 바이너리: 56개 합성 사례 통과. 일반 셀 및 깊이 2~3 중첩 셀, flat/ByPath API, 필드 앞뒤와 문단 끝의 분할·병합, 값 편집, 스냅샷 복원, HWP/HWPX 저장·재열기를 검사했다. 168개 상태에서 336회 저장·재열기 및 168회 스냅샷 복원을 수행했다.
- Studio TypeScript `--noEmit`, JavaScript 구문 검사, Rust 구문 파싱 및 새 예제의 rustfmt 검사 통과. 저장·이력·문서 버전·자동저장 관련 호스트 검사 20건 통과. Rust 타입 검증은 새 Native 예제 빌드 범위에 한정된다.

## 미완료 및 재실행

**수정 후 WASM 검증은 미완료다.** WASM 빌드는 공간 보호 검사에 의해 중단됐으며 이를 빌드 성공이나 테스트 통과로 계산하지 않았다. 기존 SDK와 수정 후 SDK를 혼동하지 않도록 새 산출물 디렉터리를 사용해야 한다. 독립 검토와 새 WASM·앱 검증 전 병합을 보류한다.

전체 Rust 검사는 이번 분기에서 실행하지 않았다. 누락된 upstream 입력, 기존 assertion 실패와 Native ABI 중단을 해결하거나 통과로 취급하지 않는다. 새 Mac GUI, 물리 IME 및 한글 앱 왕복 비교도 미실행이다. CI 성공 주장도 하지 않는다.

충분한 공간을 확보한 뒤, 기존 프로젝트의 도구 버전·공간 보호 지침을 지켜 실행한다. 아래 OUTPUT은 기존 증거와 겹치지 않는 새 폴더여야 한다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml --example cell_field_structure_check
# 선택한 Cargo target 디렉터리의 바이너리로 실행
TARGET/debug/examples/cell_field_structure_check OUTPUT/native
node scripts/build-wasm-release.mjs OUTPUT/pkg
node scripts/check-cell-field-structure.mjs fixed OUTPUT/pkg OUTPUT/sdk-basic
node scripts/check-cell-field-structure.mjs fixed OUTPUT/pkg OUTPUT/sdk-nested OUTPUT/native/manifest.json
```

SDK 검사는 현재 앱의 분할·병합 명령, WasmBridge 메서드와 CommandHistory를 사용한다. DOM·화면·플랫폼 입력을 실제 조작한 검사는 아니다. `baseline` 모드는 수정 전 관측용이며, `fixed` 모드는 편집 거절이나 모델·글자 모양 차이가 하나라도 있으면 실패한다. 필드·하이퍼링크·메타데이터·미주 회귀 및 실제 앱 저장·재열기를 추가로 완료해야 한다.
