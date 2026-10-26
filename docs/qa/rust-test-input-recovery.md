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
| 코어 lib 3,918건 | 3,762 pass, 입력 부재로 assertion 전 실패138, 비입력 assertion/계약 실패3, ignored13, native ABI abort2 |
| 바이너리 타깃26개 | 12 pass, fail0. 테스트0건 타깃25개는 검사 통과로 세지 않음 |
| 코어 doctest11건 | 8 pass, ignored3 |

코어의 일괄 실행은 non-unwinding panic으로 종료됐다. 종료 전 결과를 보존하고 같은 바이너리에서 미완료 검사와 실패 진단을 개별 프로세스로 실행해 3,918개 이름을 모두 분류했다. 반복 실행을 고유 테스트 수에 더하지 않는다. 전체 성공이 아니며 ABI abort를 assertion 통과 또는 일반 입력 부재로 바꾸지 않는다.

별도 고정 upstream MIT Rust 검사 코드1,113개·suite policy·생성기로 현재 Cargo가 선언하지만 소스 스냅샷에 없던 통합 타깃48개를 **개인 검증 보조 입력**으로 구성했다. 그 소스/생성 하네스는 이 PR의 추적 파일에 포함하지 않는다. 보조 입력을 쓴 참조 검사 결과는 752 pass / 1,525 fail / ignored22였고, 타깃21개는 추가 compile-time 입력 부재, 1개는 기존 테스트 호출의 현재 API 타입 불일치로 컴파일되지 않았다. 나머지 2개 타깃은 기본 feature에서 테스트0건이라 통과로 세지 않았다. 입력/패키징 차이가 섞인 upstream 참조 실패를 실제 앱의 회귀로 일괄 판정하지 않는다. 컴파일되지 않은 타깃의 미실행 본문 수는 추정하지 않는다.

전체 workspace `--no-run`도 추가 입력 부재로 exit101이었다. 이 PR을 clone한 것만으로 통합 검사 소스/fixture가 전부 생기거나 전체 workspace 검사가 통과하지 않는다. 프로젝트 문서 복구와 개별 corpus 로딩 지연으로 코어·CLI의 검증 범위를 되살린 변경이다.

## 남은 차단

- 권리 보류 입력 `samples/3-09월_교육_통합_2022.hwp`, `samples/hwp3-sample16-hwp5.hwp`, `samples/hwpx/aift.hwpx`는 취득·복원·공개하지 않는다. 추가 외부 corpus도 임의로 가져오거나 대체하지 않았다.
- 입력과 무관한 코어 실패3개는 TAC 해제 뒤 빈 줄 높이, 빈 표 HWPX 내보내기의 기존 제한 기대, deferred 셀 누름틀 삽입 계약이다. 원인 조사·지원 범위 판단이 필요하며, 이번 변경에서 기대값을 고쳐 통과시키지 않았다.
- native ABI2개는 native 환경에서 wasm-bindgen 오류 경로가 non-unwinding panic으로 중단된 사례다. WASM 대상 검증을 수행한 것으로 표현하지 않는다.
- 추가 참조 통합 입력·현재 앱 패키징과의 경로/계약 차이·API 인자 타입 적응이 남는다. 기존 테스트 소스/fixture 부재, ignored, 0건, compile 실패를 성공으로 숨기지 않는다.
- 변경한 Rust 파일 전체 rustfmt 검사는 기준 main에도 있는 포맷 차이로 실패한다. 새 로더 부분은 formatter에 맞췄으며, 마지막 포맷 정리 전후 전체 파일의 rustfmt 정규 출력 해시는 동일했다. 대규모 무관 포맷 변경은 포함하지 않는다.
- GUI, 물리 IME, 앱 설치 교체, 배포, optional native-skia/GPU·WASM32 feature matrix와 CI는 실행하지 않았다. 이번 Rust 결과는 앱 전체 검증 통과를 뜻하지 않는다.
