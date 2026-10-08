# 이름 셀 값 교체의 독립 필드 소유권 보호

## 계약과 원인

기존 엔진은 셀의 `field_name`을 `ctrl_id == 0`인 가상 필드로 노출한다. 값은 **첫 문단 전체 텍스트**이며 셀의 나머지 문단까지 지우는 계약이 아니다. 실제 ClickHere는 `field_ranges`에 연결된 별도 범위 필드다. `set_field_value_by_name`은 문서 순서의 첫 일치, Native/CLI `set_field_value_by_name_at`은 명시한 occurrence 하나를 선택한다. 이 선택 계약은 그대로 유지했다.

확인한 호출 경로: `rhwp-studio/src/hwpctl/index.ts:PutFieldText`, `rhwp-studio/src/core/wasm-bridge.ts:setFieldValueByName`, `npm/hwpctrl-ocx/src/index.mjs:PutFieldText`, CLI `commands/edit/fields.rs`와 `protocol/plan/execution.rs`. 기존 OCX의 설명은 지정 필드의 기존 내용을 새 값으로 교체하는 것이다. UI와 OCX는 이름을 엔진에 전달하며 이번 수정에서 변하지 않았다. OCX의 `{{N}}` 토큰 occurrence 전달은 기존에 생략돼 있고 이번에 변경/인증하지 않았다. 다중 이름 OCX 호출도 기존처럼 개별 엔진 호출이며 새 batch transaction을 만들지 않았다.

실패 원인은 `set_cell_field_text`가 첫 문단 전체의 삭제·삽입을 하면서 독립적인 내부 ClickHere 범위까지 늘려 같은 셀 값을 갖게 만드는 것이다. dev8에서 빈 `inner` → `'새값🙂'` 변화와 HWP/HWPX 재열기 모두 재현됐고 loss report는 0이었다. 가상 필드의 범위 조회도 `field_range_index: 0`을 실제 내부 범위로 잘못 해석했다. ID setter는 가상 셀을 실제 ClickHere로 보내며, 합성 셀 ID는 표/깊이별로 중복될 수 있었다.

기준 엔진의 `baseline-failing-regression.mjs`는 expected refusal이 발생하지 않아 exit 1로 실패했다. 이전 재현 `../dev8-checkpoint-qa/next-gap-virtual-cell.json`과 이번 `baseline-failure.log`를 보존했다.

## 최소 수정

Production 변경은 `engine/src/document_core/queries/field_query.rs` 한 파일이다.

- 이름 셀의 첫 문단을 immutable 상태에서 먼저 조회한다. 정확한 UTF-16/control 축이 아니거나 첫 문단이 없으면 거절한다. 첫 문단 안의 필드·각주/개체·범위 태그·control data 참조가 있으면 **raw_stream 무효화와 mutable 접근 전에** 거절한다.
- 일반 텍스트 첫 문단 전체 교체는 기존 삭제·삽입 의미로 유지한다. 문단/스타일 참조, 다른 셀, 뒤 문단의 내부 각주와 서식을 보존한다. 내부 ClickHere 이름만 지정한 값 교체는 기존 ClickHere preflight를 거쳐 계속 지원한다.
- 가상 필드의 공개 문자 범위는 첫 문단 전체 `0..text.chars().count()`를 반환한다. 실제 ClickHere 범위를 빌리지 않는다. 기존 list/code-unit cursor 좌표는 변경하지 않았다.
- ID setter는 유일한 가상 셀을 셀 경로로 보낸다. 한 ID에 여러 소유자가 있으면 무변경 거절한다. 기존 ID **조회**의 첫 일치 동작은 변경하지 않았다. 이름/occurrence가 이미 있는 정확한 선택 경로를 유지했다.

UI·WASM API 표면·serializer·일반 타이핑·패키징 코드 변경 없음. 첫 문단 안의 복잡한 참조를 임의로 제거하거나 새 값의 일부 범위에 배정하지 않는다. 해당 whole-cell 요청은 비지원이며 독립적인 내부 이름 요청과 구분한다.

## 검증

| 검사 | 결과 |
|---|---|
| Native 일반 교체/빈값/이모지, 별도 내부 이름, 반복 셀 이름 occurrence, 셀+내부 같은 이름 occurrence | 정상 36, snapshot undo/redo 36쌍, HWP/HWPX 재열기 72 |
| Native 내부 필드·첫 문단 각주·불명 제어·잘못된 축·범위 참조·빈 문단 목록·중복 ID | 거절 호출 169, 전체 Debug Document/raw_stream/event log 무변경 |
| WASM + 현재 실제 WasmBridge/InputHandler/SnapshotCommand/CommandHistory | 정상 48, 거절 188, undo/redo 각 72, HWP/HWPX 재열기 96, 이름/ID 충돌 검사 20 |
| WASM 저장 파일 Native 재검사 | 96개 모두 전체 재귀 문단/셀 각주/필드 소유권/서식 참조 일치 |
| 이전 ClickHere 보존 회귀 | 재열기 54+별도 기존 실패 사례 4, undo/redo 각24, 거절14, 셀 회귀6 |
| 이전 값 교체 원자성 | 정상10, 비지원18 모두 거절, 저장재열기20 |

깊이 1/2/3, 병합/비병합의 6가지 셀 구조를 사용했다. 대상 첫 문단 style1, 이웃 style2, 뒤 각주 문단 style14 및 별도 글자/문단 직접 서식 참조가 유지된다. 본문 각주와 셀 뒤 문단의 각주를 포함한다. 같은 이름의 virtual cell이 먼저면 그 전체 교체를 거절하며 내부 필드로 우회하지 않는다. Native/CLI occurrence1은 같은 이름의 내부 필드나 두 번째 셀을 정확히 선택한다. WASM 이름 API는 기존대로 첫 일치만 선택한다. 합성 ID가 상위·중첩 셀 사이에 겹치면 바이트 동일하게 거절한다. 실패한 실제 SnapshotCommand가 기존 redo를 지우지 않는 것도 확인했다.

정상 fixture는 기존 빈 BorderFill 기본값의 형식 차이를 **편집 전** HWPX로 정규화하며 차이가 fillType/patternColor/patternType뿐임을 검사한다. 변경/undo/redo/재열기 비교에는 필터를 적용하지 않는다. 불명 제어의 HWPX 변환 지원을 인증하지 않는다. 비지원 문서의 전후 두 형식 바이트 일치는 이번 거절이 새 변경을 만들지 않았다는 증거다.

## 후보·보존·자원

별도 후보 `../named-cell-value-qa/pkg/rhwp_bg.wasm`, SHA256 `89bd3c1b3bb7160e24c977c996460203740cffd36f4b2b8120f1fa02588cddaf`. 기존 dev8/dev7/dev6/DevEnter/BetaNext, 연결된 `pkg`, 이전 값 교체 후보 WASM 해시 보존. 새 앱/ZIP/공개 push/release 없음.

기존 Cargo target/의존성 재사용, offline+locked 및 jobs2, incremental/debug 비활성화. Cargo는 순차 실행했고 빌드 중 엔진 소스를 수정하지 않았다. 2초 주기 target/free 감시로 target4GiB 또는 실제 free10GiB 기준을 넘으면 중지한다. 관측 target 최고3.252GiB, 최종3.170GiB. 최소 실제 여유22.774GiB 이상. 캐시 삭제·설치·대형 clone·보안/계정/인증서/원격 권한 변경 없음.

Mac arm64의 기존 dev8 Electron을 `ELECTRON_RUN_AS_NODE=1`로 실행했다. DOM/커서/refresh는 어댑터이며 실제 Mac GUI·물리 IME는 미검증. 이번에 GUI 창을 열지 않았고 실행한 도구 프로세스는 종료했다. Linux 및 새 패키징 검증 없음. 인접 빈 ClickHere 경계로 값 비우기 거절과 세로 셀 pagination 비지원은 유지된다. 전체 Rust library 테스트는 기존 누락 include_bytes fixture 3개로 차단된 상태이며 복구/대체/검사 약화 없음.

## 재개/증거

Checkout `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, branch `dev/style-propagation`, 기준 `6f576bdca0202850bd2d7ba733cc119b9a903daa`. 후보/fixture/proof/build log는 `/Users/sw107/Documents/Codex/2026-10-06/task/named-cell-value-qa`. 핵심 집계 사본 `verification/named-cell-value/proof.json`. 생산 소스 hash와 보존 hash는 source-freeze.json/before.json 및 집계 proof에 있다.

재현/검사 명령:

```sh
python3 /tmp/geulgyeol-namedcell-build.py native-final run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example named_cell_value_check -- ../named-cell-value-qa/native
python3 /tmp/geulgyeol-namedcell-build.py wasm-candidate build --offline --locked --release --target wasm32-unknown-unknown --manifest-path engine/Cargo.toml -p rhwp --lib
# wasm-bindgen 0.2.127 --target web, 별도 named-cell-value-qa/pkg 출력
ELECTRON_RUN_AS_NODE=1 ../dev8-checkpoint-qa/GeulgyeolDev8.app/Contents/MacOS/GeulgyeolDev8 scripts/check-named-cell-value.mjs ../named-cell-value-qa/pkg ../named-cell-value-qa/native/manifest.json ../named-cell-value-qa/wasm
python3 /tmp/geulgyeol-namedcell-build.py native-ui-reopen-final run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example named_cell_value_check -- --verify-ui ../named-cell-value-qa/wasm/manifest.json
```
