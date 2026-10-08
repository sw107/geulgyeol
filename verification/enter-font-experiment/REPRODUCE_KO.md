# Enter 글꼴 분류 캐시 실험 재현

> 이 파일은 2bdf2e9 시점의 실험 기록입니다. 후속 단일 통제 비교 후 로컬 채택한 현재 상태는 [통제 비교 결과](../enter-controlled-comparison/NOTES_KO.md)를 참조하세요.

Mac arm64, Rust 1.93.1, wasm-bindgen 0.2.127, Node 24.20.0에서 기존 오프라인 의존성을 사용했다. target은 debug info/incremental을 끄고 jobs=2, 3GiB 상한으로 감시했다. 기존 원본 문서/앱 대신 합성 입력과 별도 checkout을 사용한다.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --emit-runtime-fixtures /tmp/font-fixtures
python3 scripts/make-enter-performance-fixtures.py /tmp/font-fixtures /tmp/font-inputs
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example font_family_classification_check -- /tmp/font-fixtures/scope0-direct0.hwpx /tmp/font-golden
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --cached-snapshots /tmp/font-native
cargo build --offline --locked --release --target wasm32-unknown-unknown --lib --manifest-path engine/Cargo.toml
wasm-bindgen /path/to/target/wasm32-unknown-unknown/release/rhwp.wasm --target web --out-dir pkg
node scripts/check-current-wasm-integration.mjs pkg /tmp/font-fixtures /tmp/font-runtime
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --verify-runtime /tmp/font-runtime
node --expose-gc --max-old-space-size=192 scripts/check-large-enter-history.mjs pkg /tmp/font-inputs /tmp/font-large
node --expose-gc --max-old-space-size=192 scripts/measure-enter-performance.mjs pkg /tmp/font-inputs /tmp/font-timings current
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --example font_family_classification_check --example enter_pagination_profile --example enter_snapshot_cache_check --example next_style_enter_check -- -D warnings
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --target wasm32-unknown-unknown -- -D warnings
```

기준 엔진은 b8e14bf의 WASM4ff4199b…이며 실험 후보는 c258e847…이다. 후보의 캐시 수정은 성능 이점이 확인되지 않아 채택하지 않았다. 저장소의 프로덕션 엔진은 기준으로 복원한다. 후보 엔진과 변경 전 글꼴 corpus는 저장소 밖 QA 폴더에 보존했고, zero-context 후보 패치도 이 폴더에 있다. 위 명령은 현재 엔진의 검사를 재현하며, 후보는 격리 checkout에서 `git apply --unidiff-zero verification/enter-font-experiment/candidate-font-cache.patch`를 적용한 뒤 같은 명령으로 빌드한다. 동일한 typed Bridge/Command를 사용한다. font-family corpus의 각 family/variant JSON을 기준과 완전히 비교한다. SVG뿐 아니라 모든 글자 폭 판단 trace가 일치해야 한다. 큰 문서는 large-history-parity.json의 모든 페이지 SHA256 및 전체 텍스트/스타일의 semantic SHA256을 두 엔진 사이에서 비교한다. 각 엔진에서 undo/redo와 HWP/HWPX 재열기도 독립 검증한다.

성능은 기존과 같은 6입력×4모드×예열3/측정12, 실행 순서 교대/GC를 사용하고 다른 빌드·검사와 겹치지 않게 실행한다. 문서 파싱은 Enter/undo 타이머에서 제외한다. Node heap192MiB, RSS768MiB/WASM512MiB 관측 상한을 유지한다. 32/512/8192는 본문 문단 수다. 셀 입력에는 고정1×1 표와 배경 본문이 있으므로 큰 표 성능으로 해석하지 않는다. 샘플링 CPU 진단 수치와 비계측 성능 자료는 별도로 다룬다.

실제 GUI/IME와 Linux 실기는 별도 확인 대상이다. 이번 요청은 로컬 개발 커밋만 허용하므로 공개 push/release 및 새 앱 패키지는 진행하지 않는다.

실행 패턴의 영향을 분리한 한 모드 검사는 아래처럼 수행한다. MODES_CSV를 생략하면 기존 네 모드 순서/예열/측정/GC가 유지된다. 한 모드와 네 모드는 별개 프로토콜이며 시간을 섞어 개선율을 계산하지 않는다. 캐시 후보 실험 시점의 한 모드 제어 스크립트는 같은 측정 본문에서 모드 배열만 줄인 별도 복사본을 사용했고, 최종 도구는 이를 명시적 인자로 재현한다. 두32문단 입력에서 기본 네 모드/한 모드/잘못된 인자 거절을 실제 복원된 WASM으로 검증했다.

```sh
node --expose-gc --max-old-space-size=192 scripts/measure-enter-performance.mjs /tmp/font-baseline-engine /tmp/font-inputs /tmp/font-control baseline next-command
node --expose-gc --max-old-space-size=192 scripts/measure-enter-performance.mjs /tmp/font-candidate-engine /tmp/font-inputs /tmp/font-control candidate next-command
```
