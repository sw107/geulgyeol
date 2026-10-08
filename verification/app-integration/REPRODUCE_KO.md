# 재검증

checkout: /Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation
QA: ../app-integration-qa
기존 target: ../style-lint-qa/target

정확한 절대 경로/명령/소스·로그 해시는 proof.json에 있다. Rust 1.93.1과 wasm-bindgen 0.2.127, 기존 Cargo 캐시를 지정한다. 새 checkout·의존성 설치가 필요하지 않다.

```sh
export CARGO_TARGET_DIR=/path/to/style-lint-qa/target
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_INCREMENTAL=0
export CARGO_BUILD_JOBS=2
cargo build --offline --locked --release --target wasm32-unknown-unknown --lib --manifest-path engine/Cargo.toml
wasm-bindgen "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rhwp.wasm" --target web --out-dir pkg
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --emit-runtime-fixtures /path/to/qa/fixtures
node rhwp-studio/node_modules/typescript/bin/tsc --project rhwp-studio/tsconfig.json --pretty false
```

pkg/package.json은 기존 `{"type":"module"}`를 유지한다. rhwp-studio에서 다음 Vite 명령을 실행한다. 공유 node_modules가 읽기 전용이므로 native config loader를 사용한다.

```sh
node node_modules/vite/bin/vite.js build --config vite.geulgyeol-beta.config.mjs --configLoader native --outDir /path/to/qa/web/studio --emptyOutDir
```

Node 24(이번에는 기존 beta1 Electron의 ELECTRON_RUN_AS_NODE=1)에서 실제 엔진 검사를 수행한다.

```sh
node scripts/check-current-wasm-integration.mjs /path/to/pkg /path/to/qa/fixtures /path/to/qa/runtime
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example next_style_enter_check -- --verify-runtime /path/to/qa/runtime
python3 scripts/package-local-mac-integration.py --source-app dist/GeulgyeolBetaNext.app --studio-dir /path/to/qa/web/studio --output-app /path/to/qa/GeulgyeolDevEnter.app
scripts/sign-mac-bundle.sh /path/to/qa/GeulgyeolDevEnter.app org.geulgyeol.dev.enter
```

패키징 스크립트는 보존된 beta1 ASAR hash를 검사하고 기존 경로를 덮어쓰지 않는다. 새 출력 경로가 이미 있으면 중단한다. 앱 추출 binding/엔진과 Vite 산출물 hash를 확인한 뒤 위 runtime 검사를 추출된 엔진으로 재실행한다. 추출 증거는 QA의 packaged-engine/ 및 package-verification.json이다.

전체 desktop suite는 GEULGYEOL_QA_ENGINE_DIR=추출pkg, GEULGYEOL_QA_FIXTURES=../style-lint-qa/behavior/final-enter-propagation을 지정하고 `node --test desktop/tests/*.test.cjs`로 실행한다. 자산 서버 검사는 localhost listen이 가능한 환경이 필요하다. fresh와 최종 패키지의 검사는 서로 다른 runtime 결과 폴더를 사용했다.

Mac lifecycle에서는 GEULGYEOL_DEV_PROFILE_ROOT를 QA/profile로 지정해 별도 후보 실행 → localhost 버전/엔진 hash 확인 → bundle ID org.geulgyeol.dev.enter에 정상 quit 요청 → 앱 exit0 확인을 수행했다. 이 동작은 GUI 편집 검증이 아니다. 재현 스크립트 current-mac-lifecycle.py와 current-desktop-tests.py는 QA 폴더에 보존했다.
