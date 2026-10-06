# Enter/undo 성능 재현

Mac arm64에서 Rust 1.93.1, wasm-bindgen 0.2.127, Node 24.20.0으로 검사했다. 네트워크 설치 없이 기존 Cargo/Node 의존성을 재사용했다. 원본 문서를 사용하지 않는다. Cargo target은 debug info와 incremental을 끄고 jobs=2, 3GiB 상한으로 감시했다.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --emit-runtime-fixtures /tmp/enter-fixtures
python3 scripts/make-enter-performance-fixtures.py /tmp/enter-fixtures /tmp/enter-inputs
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example enter_snapshot_cache_check -- /tmp/enter-inputs /tmp/cache-policy
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --cached-snapshots /tmp/enter-native
cargo build --offline --locked --release --target wasm32-unknown-unknown --lib --manifest-path engine/Cargo.toml
wasm-bindgen /path/to/target/wasm32-unknown-unknown/release/rhwp.wasm --target web --out-dir pkg
node --expose-gc --max-old-space-size=192 scripts/measure-enter-performance.mjs pkg /tmp/enter-inputs /tmp/enter-measure current
node --expose-gc --max-old-space-size=192 scripts/check-large-enter-history.mjs pkg /tmp/enter-inputs /tmp/enter-history
node scripts/check-current-wasm-integration.mjs pkg /tmp/enter-fixtures /tmp/enter-runtime
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --verify-runtime /tmp/enter-runtime
node scripts/check-next-style-ui.mjs
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --example enter_snapshot_cache_check --example next_style_enter_check -- -D warnings
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --target wasm32-unknown-unknown -- -D warnings
```

측정 스크립트는 generated WASM과 현재 Studio의 실제 Bridge/Command 구현을 실행한다. Node 24의 stripTypeScriptTypes로 문법만 제거하므로 별도로 전체 Studio tsc와 Vite를 검사한다. 기준 측정은 94177e4 소스의 명령과 보존한 dev.5 WASM(5964e2fe…)을 사용했다. 최종 소스에 구형 WASM을 연결하는 방식으로 기준 측정을 재현하면 새 API가 없으므로 실패한다. 소스와 WASM을 함께 보존한 체크아웃을 사용해야 한다.

각 문서·모드에 예열 3회와 측정 12회, 모드 실행 순서 교대, 실행 사이 GC를 적용한다. 문서 파싱은 Enter/undo 타이머에서 제외하고 별도 측정한다. 각 시도는 새 문서를 열고 명령을 discard한 뒤 native 문서를 free한다. Node 힙 192MiB, 실행 후 RSS 768MiB·WASM 선형 메모리 512MiB 상한을 검사한다. 다른 빌드·검사와 겹치지 않게 실행한다.

본문과 셀 각각 32/512/8192개의 **본문 문단**을 가진 합성 문서다. 셀 문서는 고정된 1×1 표와 본문 배경 문단을 갖는다. 큰 표나 많은 셀의 측정으로 해석하면 안 된다. 입력에는 폰트·사진이 없고 한국어·ASCII·숫자가 섞여 있다. 본문 끝 또는 표 셀의 끝에서 A22.next=B23을 적용한다.

legacy-core/next-core는 split/merge 자체 비용, legacy-command/next-command는 실제 UI 명령 비용이다. legacy의 merge는 속도 비교용이며 완전한 문서 상태 복원 증거가 아니다. 정확한 undo/redo는 별도의 전체 Document 및 모든 페이지 SVG 검사와 저장재열기 비교로 검증한다. 합성 입력·원시 측정·로그는 저장소 밖 enter-performance-qa에 보관한다.

큰 문서 검사는 별도 프로세스에서 모든 페이지 SVG의 SHA-256을 비교하고, HWP/HWPX 재열기 후 전체 텍스트와 모든 본문·활성 셀 문단의 스타일 ID를 비교한다. 한 번에 모든 SVG 문자열을 보관한 최초 검증기에서 Node 192MiB 힙이 소진되어 타이밍 완료 뒤 종료됐으며, 최종 검증기는 페이지별 해시와 GC로 같은 힙 제한을 유지한다. 원시 타이밍 24그룹/288건은 모두 완료되어 보존했다. 역사적 측정 스크립트의 상위 중간값 대신 두 가운데 값의 평균으로 중앙값을 재계산했고 원시 시간은 변경하지 않았다.
