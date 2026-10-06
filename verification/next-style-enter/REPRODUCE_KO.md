# 재검증 명령

Mac arm64/Rust 1.93.1 환경에서 기존 engine Cargo.lock과 캐시를 사용했다. 아래 TARGET_DIR은 다른 문서·배포 파일과 분리된 쓰기 가능한 검증 폴더로 지정한다. 전체 빌드 출력은 1.5 GiB 한도에서 감시했다.

```sh
export CARGO_TARGET_DIR=/path/to/qa/target
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_INCREMENTAL=0
export CARGO_BUILD_JOBS=2
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- /path/to/qa/next-style-enter
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --example style_metadata_check --example lint_behavior_check --example next_style_enter_check -- -D warnings
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --target wasm32-unknown-unknown -- -D warnings
```

기존 split 경로 비교는 같은 예제에 `--baseline`을 OUTPUT_DIR 앞에 넣는다. 이는 수정된 소스의 구조 split 경로 비교다. 공개 beta1의 실제 WASM 재현은 baseline-packaged.json 및 저장소 밖 ../next-style-enter-qa/의 재현 자료와 구분한다.

회귀 예제는 style_propagation_check, style_deletion_check, cell_equation_check, stored_row_ungroup_check, style_metadata_check, lint_behavior_check이며 각각 위 run 명령의 example과 출력 폴더를 바꿔 실행했다. stored_row_ungroup_check는 출력 폴더 앞에 FIXTURE_DIR을 추가해야 한다. 이번 입력은 원본 /Users/sw107/Documents/Codex/2026-09-08/new-chat/outputs/Baram-QA/generated의 native-rotated-resize-120x130.hwp 및 .hwpx이며 읽기만 했다.

Node 24의 stripTypeScriptTypes를 제공하는 런타임에서 UI mock을 실행한다.

```sh
node scripts/check-next-style-ui.mjs
```

Mac에서는 기존 beta1 Electron 실행 파일을 ELECTRON_RUN_AS_NODE=1로 사용했다. 앱을 수정하거나 GUI 창을 띄우지 않았으며 이 검사는 11개 current-source mock이고 실제 WASM binding·GUI·tsc 확인이 아니다. 새 API를 실제 앱에 사용하려면 최신 WASM과 생성 binding을 함께 빌드해야 한다.
