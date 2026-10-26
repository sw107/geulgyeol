# Rust 검증 입력 복구와 실행 범위

Rust 테스트의 compile-time corpus 입력이 누락되면 관련이 없는 검사까지 컴파일하지 못했다. 해당 세 `#[cfg(test)]` 소비자가 원래 문서를 **같은 경로에서 실행 시 읽도록** 바꾼다. 입력이 없거나 읽을 수 없으면 테스트는 명시적으로 실패한다. 테스트/skip/ignore/기대값/assertion을 제거하거나 더미 파일로 바꾸지 않는다. 제품 빌드의 파서·저장·편집 코드는 변경하지 않는다.

CLI의 `include_str!` 입력인 RHWP 프로젝트 기술 문서 11개를 원본 바이트 그대로 복원한다. [고정 upstream commit](https://github.com/edwardkim/rhwp/tree/f1f9c6ae58344ee9368996d3543f76b9345cf227)의 소프트웨어 관련 문서이며 [MIT 고지](../../LICENSE)를 유지한다. 상세 blob/SHA-256/크기는 [출처 manifest](rust-test-input-provenance.json)에 있다. 이 MIT 프로젝트 문서 판단을 외부 문서·폰트 corpus의 배포 허가로 확대하지 않는다.

| 복구 경로 | upstream blob | SHA-256 |
|---|---|---|
| `engine/gym/README.md` | `bef3223c3742bf1698e136a662496c2b4d636e22` | `9d42146b097bda04135608ac3e85ff53fa8e240cbcd5f98a4bda585916234c42` |
| `engine/llms.txt` | `214af7722260890afa4e7fc1d22803fa35243205` | `84dfec42d572bc15bd21dcd740f8aa7a23e01c9b96e7ee37da5e6438eda92494` |
| `engine/mydocs/manual/agent_knowledge_map.md` | `38644649aad9f7806da866f48496c84f4c23f7cd` | `8c162a919bed6b319479080ef6dcbaedb30e3ad4c8f846937d889b5ba15c07b7` |
| `engine/mydocs/manual/agent_troubleshooting_guide.md` | `6b34f0a7ea2c5fc252343e8a1271d69b46ffc015` | `fa9a6ccc7d219fb1381914fab6a45a12d577e936adeec4dd2a0915385a27632f` |
| `engine/mydocs/manual/recipes/01_fill_form_and_submit.md` | `bc31f2ee5013bf7902c5d347b96595f0c588c429` | `24bec31d09587b35c8e52573807ffc2fb04a6c05aee70c693601afa905e7100b` |
| `engine/mydocs/manual/recipes/02_table_csv_roundtrip.md` | `1171c658c76f2ccc1fc36b5afe9f5b695be4e43b` | `0566dd60c9387134fc3aed9f85dc5a23e6febd7c0c5f4ecdf82d8ecebec1a785` |
| `engine/mydocs/manual/recipes/03_redact_before_sharing.md` | `f24f979acac9e3af5a099546008cb7a9e10f2f4f` | `3c59ad4df88c989c4e404fd6c64d3681ccc00cecb5b7d319c7d1c9f6f6ef5b8b` |
| `engine/mydocs/manual/recipes/04_safety_check_untrusted_doc.md` | `34a73b8c6ec2ee031298df72456a9724e0faf9a7` | `d65d228e4254eaae6b66232b60ca2958f19ba7bfceedff99d9ec25b8be1a4c46` |
| `engine/mydocs/manual/recipes/05_mail_merge_batch_fill.md` | `6cef39e01fc6bc277b7d304ce2c0d6a3321d15bf` | `c36b1b01d09bcba90b1204a88a26265c6d238d7633718eb7d570dce14e624f36` |
| `engine/mydocs/manual/recipes/06_visual_regression_before_after.md` | `97eb1e51dd7d3758d9438184b5d0e122cc1ace12` | `b334e9434a53b20032af4e7fefeb4c5aa00813efc14cbf442a76bc8fb0f4b5bd` |
| `engine/mydocs/tech/agent_roadmap/atlas_r1_r200.md` | `31c66a6162428889ed8956304f392ec3e79be6b5` | `02fb6f899c87816ebc60f7e619a7a32e5292169b8313bc3695d9e5e4fa2c1b1c` |

## 실행과 실제 결과

Rust 1.93.1, 고정 lockfile, offline 의존성, 단일 compiler job, 별도 타깃, debug 정보/incremental 비활성으로 검증했다. 테스트 기준은 `0b94b4561091b0aa1ecf8d68014256458ca0a376`와 이 패치다. 이후 JS 변경 main으로 검사를 다시 시작하지 않았다.

```sh
cargo test --offline --locked --manifest-path engine/Cargo.toml --workspace --exclude rhwp -- --test-threads=1
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib -- --test-threads=1
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --bins --no-fail-fast -- --test-threads=1
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --doc -- --test-threads=1
```

| 범위 | 관측 결과 |
|---|---|
| 독립 crate 4개 | 196 pass, fail/ignored 0. lib/doctest 0건은 성공 수에 더하지 않음 |
| 코어 lib 3,918건 | **원시 libtest** 3,762 pass, 입력 부재로 assertion 전 실패138, 비입력 assertion/계약 실패3, ignored13, native ABI abort2. pass는 아래 계약 검증 범위와 별도로 읽음 |
| 바이너리 타깃26개 | 12 pass, fail0. 테스트0건 타깃25개는 검사 통과로 세지 않음 |
| 코어 doctest11건 | 8 pass, ignored3 |

코어의 일괄 실행은 non-unwinding panic으로 종료됐다. 종료 전 결과를 보존하고 같은 바이너리에서 미완료 검사와 실패 진단을 개별 프로세스로 실행해 3,918개 이름을 모두 분류했다. 반복 실행을 고유 테스트 수에 더하지 않는다. 전체 성공이 아니며 ABI abort를 assertion 통과 또는 일반 입력 부재로 바꾸지 않는다.

별도 고정 upstream MIT Rust 검사 코드1,113개·suite policy·생성기로 현재 Cargo가 선언하지만 소스 스냅샷에 없던 통합 타깃48개를 **개인 검증 보조 입력**으로 구성했다. 그 소스/생성 하네스는 이 PR의 추적 파일에 포함하지 않는다. 보조 입력을 쓴 참조 검사의 **원시 libtest** 결과는 752 pass / 1,525 fail / ignored22였고, 타깃21개는 추가 compile-time 입력 부재, 1개는 기존 테스트 호출의 현재 API 타입 불일치로 컴파일되지 않았다. 나머지 2개 타깃은 기본 feature에서 테스트0건이라 통과로 세지 않았다. 입력/패키징 차이가 섞인 upstream 참조 실패를 실제 앱의 회귀로 일괄 판정하지 않는다. 컴파일되지 않은 타깃의 미실행 본문 수는 추정하지 않는다.

전체 workspace `--no-run`도 추가 입력 부재로 exit101이었다. 이 PR을 clone한 것만으로 통합 검사 소스/fixture가 전부 생기거나 전체 workspace 검사가 통과하지 않는다. 프로젝트 문서 복구와 개별 corpus 로딩 지연으로 코어·CLI의 검증 범위를 되살린 변경이다.

## pass와 실제 계약 검증 범위의 분리 (2026-10-26 보완)

이 절은 PR #116 head `e637b08128fab3719e7bab639efa93e89b90496e`의 기존 증거를 다시 읽은 결과다. 위 명령은 **과거 실행 기록**이며 이번 보완에서 Cargo 빌드·Rust 테스트·GUI를 재실행하지 않았다. 기존 증거 루트는 환경 변수 `EVIDENCE_ROOT`로 지정한다. 해당 디렉터리에는 원시 로그·결과 index·보조 소스가 포함된 기존 증거 묶음이 있어야 한다. 로그·보조 소스·원래 작성자의 tree·SDK·사용자 변경은 읽기 전용으로 유지했다. 이 보완은 엔진 실패 3건·ABI 중단 2건을 수정하거나 재분류하지 않는다.

원시 `ok`는 libtest가 해당 함수를 성공 반환으로 기록했다는 뜻이다. 그 함수가 입력 부재로 `return`하거나 모든 입력을 `continue`할 때도 `ok`다. 따라서 3,762 또는 752를 실제 corpus/계약 검증 완료 수로 표현하지 않는다. 아래 분류는 실패·ignored·abort와 별도인 **pass 내부의 증거 축**이며, 기존 테스트 기대값이나 원시 상태를 바꾸지 않는다.

### 코어 3,762 pass 재검토

`core-final-outcomes.json`의 고유 이름을 로그와 대조했다. 3,572 pass는 성공 stdout이 capture된 `core-library.log`, 190 pass는 `--nocapture` 개별 로그를 근거로 한다. 개별 pass 중 입력 부재/SKIP 흔적이 있는 61개를 모두 고정 소스 `engine/src/wasm_api/tests.rs`의 분기와 대조했다. 문자열 검색은 검토 후보를 찾는 수단이며 자체가 미실행 판정은 아니다.

| 분류 | 건수 | 관측과 해석 |
|---|---:|---|
| `early-return-before-contract` | 51 | 입력 guard에서 return. 시작 문구·선언·helper 정의 외 파싱/편집/저장 및 이후 계약 검증에 도달하지 않음 |
| `all-inputs-skipped` | 7 | 2·3·5개 고정 입력 모두 부재 메시지 후 continue. 반복 이후 완료 문구는 검증 증거가 아님 |
| `helper-inputs-skipped` | 2 | HWP/HWPX helper 호출 두 번 모두 입력 부재로 반환. 각 형식의 assertion 미도달 |
| `diagnostic-preflight-only` | 1 | 0178: 7개 파일의 조건부 read/parse 진단 루프는 시도했으나 성공 수치 출력은 없음. 이어 필수 p2 입력 읽기에 실패해 roundtrip assertion 미도달 |
| `unreviewed` | 3,701 | 나머지 pass의 계약 경로를 이 보완에서 입증하지 않음. marker가 없다는 이유로 검증 완료로 승격하지 않음 |

61건 모두 요청된 corpus 계약에 도달한 증거가 없지만, **61개 함수 전체가 호출되지 않았다**는 뜻은 아니다. 0178의 진단 선행 시도를 포함해 실행된 부분과 검증되지 않은 부분을 구분했다. `3,762 − 61 = 3,701`을 실제 검증 통과 수로 쓰지 않는다. 3,701에는 capture된 3,572건과 marker 없는 개별 129건이 포함되며, 숨은 조기 반환·진단 전용 본문 등은 추가 소스 검토가 필요하다.

61건의 전체 이름·로그·메시지·소스 행·판정 이유는 [고정 검토 manifest](rust-pass-coverage-review.json)에 있다. 아래 ID는 모두 `core-isolated/<ID>.log`이며 한 번씩만 센다.

| 분류 | 로그 ID |
|---|---|
| `early-return-before-contract` | `0136`, `0137`, `0138`, `0139`, `0147`, `0154`, `0155`, `0156`, `0166`, `0169`, `0170`, `0171`, `0174`, `0175`, `0183`, `0184`, `0197`, `0211`, `0219`, `0226`, `0236`, `0251`, `0252`, `0253`, `0260`, `0261`, `0262`, `0263`, `0264`, `0265`, `0266`, `0267`, `0268`, `0269`, `0270`, `0271`, `0275`, `0284`, `0285`, `0292`, `0293`, `0309`, `0310`, `0311`, `0312`, `0314`, `0316`, `0319`, `0320`, `0321`, `0325` |
| `all-inputs-skipped` | `0142`, `0143`, `0172`, `0176`, `0177`, `0259`, `0318` |
| `helper-inputs-skipped` | `0209`, `0210` |
| `diagnostic-preflight-only` | `0178` |

예를 들어 0136(`test_analyze_hancom_merged_file`, 소스 3914행 시작)은 `파일 없음 — 건너뜀` 뒤 return하고, 0137(`test_analyze_pic_in_table`, 16653행 시작)은 `SKIP: output/pic-in-tb-01.hwp 없음` 뒤 return한다. 0259(`test_roundtrip_all_controls`, 17135행 시작)는 5개 경로 모두를 continue한 뒤 `검증 완료`를 출력한다. 0209/0210은 바깥 test가 아니라 내부 helper에서 return하므로 두 helper 호출의 로그를 각각 확인했다. 0178(6723행 시작)은 선행 진단 루프 때문에 단순 조기 반환과 분리했다.

### 참조 통합 752 pass 재검토

`integration-target-results.json`의 **752개 pass 전부**를 해당 원시 로그의 이름·`ok`와 대조했다. `run-integration-targets.py`는 이 성공 사례들을 `--nocapture` 없이 실행했다. 따라서 성공한 함수의 SKIP 출력은 로그에 남지 않는다. 실패 진단 블록의 입력 부재 문자열을 이웃한 pass에 귀속하지 않았다. pass 구간에서 marker가 0개라는 관측은 SKIP 0건을 입증하지 않는다.

| 분류 | 건수 | 판단 범위 |
|---|---:|---|
| `contract-checked` | 13 | `cli_exit_codes` 8개, `issue_1144` 4개, `issue_2833_hml_adapter_row_sizes` 1개. 테스트와 helper를 대조해 입력 부재 성공 반환 없이 명명된 assertion에 도달해야 ok가 되는 경로를 확인 |
| `partial-contract-checked` | 1 | `equation_command_goldens::equation_command_goldens_lock_parse_layout_svg`: 카탈로그 크기·31종·필수 명령·중복 ID assertion은 무조건 실행. 이후 golden 루프는 `UPDATE_EQ_GOLDENS`에 따라 비교 대신 생성 가능하므로 전체 golden 비교를 인증하지 않음 |
| `guarded-path-unresolved` | 91 | 소스에서 입력/문서/helper 조건 뒤 return하는 88개와 반복 대상이 모두 건너뛰어질 수 있는 3개를 확인. 당시 stdout이 없어 전체·부분·0개 대상 실행 중 무엇인지 미확정 |
| `unreviewed` | 647 | 개별 계약 경로를 확정할 검토 증거가 없음. 성공·미실행 어느 쪽으로도 추정하지 않음 |

13건의 계약 도달 판단은 고정 소스와 libtest ok를 결합한 추론이며, 계측으로 assertion 개수를 직접 관측한 결과는 아니다. CLI의 의도한 입력 오류/기능 부재 응답 검증은 실제 오류 처리 계약의 통과다. 이를 corpus 없는 거짓 성공과 혼동하거나 정상 문서 변환 검증으로 확대하지 않는다. `issue_1144`는 메모리에서 문서를 만들고 filename 반영·캐시 무효화를 확인한다. HML 1건은 메모리 생성 입력, 500ms 상한과 row_sizes assertion을 확인하며 새로운 성능 측정은 아니다.

91건의 예로 `export_doclang_json_contract::export_doclang_json_envelope`는 표본 부재 시 return하고, `hwpx_to_hwp_adapter::stage2_hwp_source_unchanged`는 읽기 실패 시 return한다. `issue_6334_hwp5_extension_master_replaces_base::hwp5_extension_master_does_not_stack_on_base`는 두 helper가 모두 None이면 assertion 0개로 끝날 수 있다. `issue_1402_enum_token_whitelist`의 두 검사는 디렉터리를 읽어도 실제 대상이 0개이거나 read/parse/serialize 실패를 모두 continue할 수 있다. 현재 파일 존재 여부만으로 과거 실행 경로를 재구성하지 않는다. 이 91개를 미실행으로 차감하거나, 나머지 647개를 검증 완료로 간주하지 않는다.

참조 fail 1,525·ignored 22, compile 입력 부재 21타깃·API 타입 불일치 1타깃·0건 2타깃은 원래 상태로 보존한다. 미컴파일 타깃의 본문 개수를 추정하지 않는다. 이 통합 결과는 보조 upstream 소스를 쓴 별도 참조 관측이며 코어 결과에 합산하지 않는다.

### 재계산과 검증 한계

```sh
# 저장소 루트에서 실행. 기존 증거는 읽기만 하고 새 JSON은 별도 경로에 저장한다.
: "${EVIDENCE_ROOT:?기존 증거 루트의 경로를 지정하세요}"
REPORT_PATH="$(mktemp "${TMPDIR:-/tmp}/geulgyeol-rust-pass-coverage.XXXXXX")"
PYTHONDONTWRITEBYTECODE=1 python3 scripts/tests/rust-pass-coverage.test.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/audit-rust-pass-coverage.py \
  "$EVIDENCE_ROOT" > "$REPORT_PATH"
printf '%s\n' "$REPORT_PATH"
```

집계 도구는 원시 pass 상태를 보존하고 각 이름에 별도 coverage·근거·SHA-256을 붙인다. `return`/`SKIP` 문자열만으로 자동 차감하지 않고, 명시적 소스 검토 기록이 없으면 `unreviewed`로 둔다. 검토 manifest는 결과 index, 검토 대상 로그·소스와 실행 스크립트의 해시를 고정한다. 파일 누락·해시 불일치·원시 ok 부재·중복·검토 근거 불일치는 집계 오류로 종료한다. 추가 후보 marker는 검토 대기로 노출한다. 종료 코드 0은 **집계 완료**일 뿐 Rust 전체 통과 신호가 아니며, `passed` 같은 전체 성공 플래그를 만들지 않는다.

이 보완의 회귀 검사는 조기 반환·부분 검증·의도한 오류 처리·capture된 무출력 ok·실패 stdout의 잘못된 귀속·누락/변조 증거를 합성 입력으로 확인한다. 로그/소스 핀은 재검토의 재현성을 위한 것이며 과거 바이너리의 소스 일치나 assertion 도달을 새로 계측·인증하지 않는다. 보조 통합 소스는 기존 개인 증거 루트에서 읽으며 이 보완에도 복제·공개하지 않는다. 추가 검증은 권리 검토가 끝난 입력과 소스 경로 검토 또는 향후 명시적 실행 증거가 있어야 한다. PR #96 보류 자료 취득으로 불확실성을 메우지 않는다.

## 남은 차단

- 권리 보류 입력 `samples/3-09월_교육_통합_2022.hwp`, `samples/hwp3-sample16-hwp5.hwp`, `samples/hwpx/aift.hwpx`는 취득·복원·공개하지 않는다. 추가 외부 corpus도 임의로 가져오거나 대체하지 않았다.
- 입력과 무관한 코어 실패3개는 TAC 해제 뒤 빈 줄 높이, 빈 표 HWPX 내보내기의 기존 제한 기대, deferred 셀 누름틀 삽입 계약이다. 원인 조사·지원 범위 판단이 필요하며, 이번 변경에서 기대값을 고쳐 통과시키지 않았다.
- native ABI2개는 native 환경에서 wasm-bindgen 오류 경로가 non-unwinding panic으로 중단된 사례다. WASM 대상 검증을 수행한 것으로 표현하지 않는다.
- 추가 참조 통합 입력·현재 앱 패키징과의 경로/계약 차이·API 인자 타입 적응이 남는다. 기존 테스트 소스/fixture 부재, ignored, 0건, compile 실패를 성공으로 숨기지 않는다.
- 변경한 Rust 파일 전체 rustfmt 검사는 기준 main에도 있는 포맷 차이로 실패한다. 새 로더 부분은 formatter에 맞췄으며, 마지막 포맷 정리 전후 전체 파일의 rustfmt 정규 출력 해시는 동일했다. 대규모 무관 포맷 변경은 포함하지 않는다.
- GUI, 물리 IME, 앱 설치 교체, 배포, optional native-skia/GPU·WASM32 feature matrix와 CI는 실행하지 않았다. 이번 Rust 결과는 앱 전체 검증 통과를 뜻하지 않는다.
