# 검증 계획과 결과 집계

PR #104의 `scripts/test-studio.mjs`는 빈 테스트 그룹을 거절하고 Node 종료 코드를 전달한다. 이 탐색/실행 동작은 그대로 사용한다. 별도 보고 도구는 실행 전 작성한 계획과 결과를 대조한다. 전체 성공은 **그 계획의 필수 항목 모두**를 검증했다는 뜻이며, 저장소의 모든 검사나 제품 호환성을 자동으로 인증하지 않는다.

필요성이 확인된 사례: Node 22.18은 테스트를 등록하지 않은 파일도 합성 파일 테스트 1개 통과/exit 0으로 출력한다. import 또는 fixture 로드 오류 역시 실제 assertion 실패와 같은 상위 실패 수에 섞인다. 최상위 TAP 합계만으로 실행된 본문 수를 집계하면 오해할 수 있다.

## 기록

Node 22.18에서 확인했다. `node-validation-reporter.mjs`는 테스트를 실행/탐색하지 않고 reporter 이벤트만 읽는다. 기존 runner에 선택적으로 추가한다. 파일별 `test:summary`와 최종 요약을 기록하며, Node가 합성한 파일 통과/실패를 본문 통과/실패 수에 더하지 않는다. 원본 오류와 stdout/stderr는 **TAP 로그도 함께** 보존한다. 항상 새 증거 디렉터리를 사용한다.

저장소 루트에서, 이미 계획한 파일 목록 또는 기존 기본 runner를 사용한다. 아래 기본 runner는 Studio 작업 디렉터리에서 자식을 시작하므로 reporter는 절대 경로를 준다.

```sh
QA_REPORT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/geulgyeol-validation.XXXXXX")
node scripts/test-studio.mjs \
  --test-reporter=tap --test-reporter-destination=stdout \
  --test-reporter="$PWD/scripts/node-validation-reporter.mjs" \
  --test-reporter-destination="$QA_REPORT_DIR/studio.json" \
  > "$QA_REPORT_DIR/studio.tap" 2>&1
QA_NODE_EXIT=$?
```

`QA_NODE_EXIT`를 결과 JSON의 `exitCode`에 그대로 기록한다. `set -e` 환경에서는 실패 후에도 종료 코드와 증거를 기록하도록 호출자가 처리해야 한다. reporter 자체는 원래 Node의 종료 코드를 바꾸지 않으며, 최종 판정은 아래 집계 CLI의 종료 코드다. 테스트 worker 안에서 별도 Node CLI를 실행하는 회귀 fixture는 자식 환경의 `NODE_TEST_CONTEXT`를 제거해야 재귀 검사 생략을 피한다.

## 계획과 관측 결과를 분리

실행 전에 `plan.json`에 **모든 필수 항목**과 Node 파일 목록을 적는다. 파일 경로는 plan.json 기준이다. `required`는 생략할 수 없다. 다음은 구조 예시이며 이 두 항목만으로 전체 제품 검증을 주장하지 않는다.

```json
{
  "version": 1,
  "checks": [
    {"id": "studio", "required": true, "kind": "node-test", "files": ["/checkout/rhwp-studio/tests/document-diagnostics.test.mjs"]},
    {"id": "types", "required": true, "kind": "command"},
    {"id": "native-fixtures", "required": true, "kind": "command"},
    {"id": "physical-ime", "required": false, "kind": "command"}
  ]
}
```

`results.json`에는 실제 관측 결과를 적는다. `report`/`evidence` 경로는 results.json 기준이다. 종료 코드·사유를 추정하거나 실패 로그를 이전 성공 로그로 바꾸지 않는다. `command`는 타입 검사처럼 **테스트 수가 없는 명령**의 종료 코드와 증거 존재만 검증한다. Cargo/브라우저/자체 E2E 테스트를 `command`로 넣고 exit 0만으로 본문 통과를 주장하면 안 된다. 단일 Rust libtest 검사는 아래 `rust-libtest` 어댑터를 사용한다. 아직 대응되는 구조화 보고가 없는 테스트는 이 도구에서 통과 수를 추정하지 말고 별도 검증으로 유지하거나 `unavailable` 사유로 기록한다.

```json
{
  "version": 1,
  "results": [
    {"id": "studio", "exitCode": 0, "report": "studio.json"},
    {"id": "types", "exitCode": 0, "evidence": "types.log"},
    {"id": "native-fixtures", "status": "unavailable", "reason": "필수 compile-time 입력 누락; 원본 로그 참조"},
    {"id": "physical-ime", "status": "excluded", "reason": "이번 자동 실행 범위 밖; 별도 수동 QA 대기"}
  ]
}
```

```sh
node scripts/summarize-validation.mjs plan.json results.json > summary.json
```

- `passed`: 확인된 통과. `failed`: 실행한 검사 실패. `unavailable`: 결과/파일/입력/완료 요약 부재, 취소, 손상된 증거. `excluded`: 명시적 제외 또는 Node skip/TODO.
- `counts`는 계획 항목, `fileCounts`는 Node 파일, `tests`는 완료된 파일별 Node 본문 요약과 Rust 계획 테스트의 상태 수다. Rust 상세는 `testCases`와 `filteredOut`, 각 검사의 `kind`로 구분한다. 계층이 다르므로 서로 더하지 않는다. `testCountsComplete: false`이면 누락/로드 실패 파일의 본문 수 또는 Rust 실행 범위가 불완전하며 0건 실행으로 단정하지 않는다. Rust 이름 목록으로 알려진 누락 테스트만 `tests.unavailable`로 세며, 로그 파싱 자체가 불가능하면 본문 수를 추정하지 않는다. 실패와 실행 불가가 한 묶음에 공존하면 항목 상태는 실패를 우선하되 `fileCounts`와 상세에서 둘 다 드러난다.
- `exitCode`는 증거 파일 누락/파싱 실패나 명시적 제외와 별개로 보존한다. 유효한 비영 종료 코드가 관측된 항목은 `failedProcesses`에 남으며, 선택 항목이어도 전체 성공을 막는다. 이때 증거 상태는 `unavailable`/`excluded`일 수 있다. 로그 누락을 assertion 실패로 추정하거나 실패 본문 수를 만들지 않는다. 실제 실패 종료 관측이 없는 선택 항목의 미실행/제외 정책은 그대로다.
- 필수 항목 하나라도 제외/미실행/실패하면 `passed:false`, **exit 1**. 계획에서 결과가 빠져도 실행 불가로 남는다. 필수 항목 0개인 계획도 성공하지 않는다. 선택 항목의 실제 실패도 전체 성공을 막는다.
- 필수 Node 파일에 skip/TODO가 하나라도 있으면 그 항목 전체 성공을 막는다. 선택 범위는 실행 전에 계획에서 명시한다. 제외를 통과로 바꾸지 않는다.
- 결과 ID 중복/미등록, 계획 필수 필드 누락, 파일 목록 중복은 전체 성공 판정을 막는다. 미계획 파일, 깨진 보고서 JSON, 완료 요약 부재는 해당 항목의 통과 판정을 막으며 필수 항목이면 전체 성공도 막는다. 선택 항목도 관측한 비영 종료 코드가 있으면 증거 상태와 관계없이 전체 성공을 막는다. macOS `/var`·`/private/var` 등 동일 파일 경로는 realpath로 대조한다.
- 이 도구는 기존 증거를 읽고 stdout으로만 집계한다. 빌드·앱 실행·fixture 확보·SDK 복제·원본 로그 변경·자동 삭제를 하지 않는다. 입력 JSON의 출처/SHA/실제 종료 코드 진위는 실행 담당자가 보존해야 하며, 서명된 증거 인증 도구는 아니다.

## 단일 Rust libtest 검사

실제 경량 검사 경로인 `rhwp-contracts --lib`에 `rust-libtest` 종류를 사용한다. [고정 계획](../../scripts/validation-plans/rhwp-contracts.json)은 native 테스트 15개의 이름을 실행 전에 선언한다. 이름이 추가·변경되면 코드 검토와 함께 계획도 갱신한다. 실행 결과로 계획을 자동 축소하면 미실행 검사를 감출 수 있으므로 그렇게 하지 않는다.

기존 도구는 Node 본문만 해석하므로 이 경로는 별도 수동 집계가 필요했다. 새 어댑터는 **단일 libtest 실행의 pretty 출력**만 읽는다. 한 개의 시작/완료 요약, 개별 이름/결과, 요약 수 일치를 검증한다. 필터 때문에 exit 0·0건 또는 일부 테스트만 실행한 경우에도 필수 성공이 되지 않는다. 계획 밖/중복 이름, 여러 타깃을 이어 붙인 로그, 잘린 로그, 컴파일 실패, 지원하지 않는 형식은 `unavailable`이다. `ignored`는 `excluded`, 실제 assertion 실패는 `failed`다. 비영 process exit는 #105의 `failedProcesses` 규칙에 따라 증거 파싱 실패와 별개로 보존한다.

새 증거 디렉터리에서 전체 stdout/stderr와 **실제 cargo 종료 코드**를 보존한다. 다음은 이미 준비된 Rust 1.93.1 도구·오프라인 의존성이 있는 환경의 실행 예시이며, 집계기가 빌드나 도구 설치를 대신하지 않는다. 리소스 하한·실행 시간 제한은 기존 실행 담당자의 정책을 적용한다.

```sh
QA_RUST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/geulgyeol-rust-validation.XXXXXX")
# if 구문으로 set -e에서도 실패 종료를 기록한다. 파이프/tee의 종료 코드를 쓰지 않는다.
if cargo test --offline --locked --manifest-path engine/Cargo.toml \
  -p rhwp-contracts --lib -- --test-threads=1 --format=pretty --color=never \
  > "$QA_RUST_DIR/contracts.log" 2>&1; then
  QA_RUST_EXIT=0
else
  QA_RUST_EXIT=$?
fi
node --input-type=module - "$QA_RUST_DIR" "$QA_RUST_EXIT" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [directory, exitCode] = process.argv.slice(2);
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({version: 1, results: [
  {id: 'rhwp-contracts-lib', exitCode: Number(exitCode), evidence: 'contracts.log'},
]}, null, 2));
JS
node scripts/summarize-validation.mjs scripts/validation-plans/rhwp-contracts.json \
  "$QA_RUST_DIR/results.json" > "$QA_RUST_DIR/summary.json"
```

다른 전체 검증 계획에 포함할 때는 고정 계획의 항목을 복사한다. 실행하지 못했다면 결과를 생략하거나 `status: "unavailable"`와 실제 차단 사유를 적는다. 필수 항목이면 전체 exit 1이다. 선택 항목 미실행은 기존 정책대로 전체 성공을 막지 않지만 상세와 `testCountsComplete: false`에 남는다.

범위는 이 native lib 타깃의 테스트 목록이다. Cargo 전체 workspace, doctest, benchmark, libtest terse/JSON, `--nocapture`/`--show-output`, 사용자 정의 harness, 브라우저·물리 IME는 지원·검증하지 않는다. 기본 캡처 모드를 사용한다. 로그의 출처·실제 종료 코드·소스 SHA는 실행 담당자가 함께 기록한다. 예전 로그를 읽은 결과는 현재 소스를 새로 실행했다는 증거가 아니다.

## 집중 회귀

```sh
node --test scripts/tests/validation-report.test.mjs scripts/tests/rust-validation-report.test.mjs
```

실제 소형 Node 자식 프로세스로 assertion 성공/실패, import 실패, 빈 파일, skip/TODO, 취소를 재현한다. 누락 계획 항목, 필수 제외, 깨진 증거, 종료 코드, CLI 경로와 exit 1도 확인한다. 실제 자식 exit 7을 사용해 선택 항목의 로그 누락·JSON 손상·완료 요약 부재·명시적 제외가 실패 종료를 가리지 못하는지도 확인한다. 합성 입력만 사용하고 출력 위치를 기록한다. 기본 테스트 탐색 파일과 E2E entry/helper는 수정하지 않는다.

Rust 회귀는 합성 libtest 로그로 0건/부분 필터/이름 누락/ignored/실패/컴파일 오류/잘린 출력/모순된 합계/중복 타깃/CLI 상대 경로를 검사한다. Rust 설치나 외부 문서를 요구하지 않는다. 실제 Rust 실행 검증은 별도 명령·원본 로그·종료 코드와 함께 기록한다.
