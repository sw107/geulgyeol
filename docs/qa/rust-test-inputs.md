# Restored upstream Rust test inputs

Four compile-time inputs omitted from the Geulgyeol source snapshot are restored
verbatim from its documented RHWP baseline, `f1f9c6ae58344ee9368996d3543f76b9345cf227`:

- `engine/samples/3-09월_교육_통합_2022.hwp`
- `engine/samples/hwp3-sample16-hwp5.hwp`
- `engine/samples/hwpx/aift.hwpx`
- `engine/mydocs/tech/agent_runtime/version_policy.md`

`engine/samples/UPSTREAM_TEST_INPUTS.json` records the upstream paths, Git blob
IDs, sizes and SHA-256 values. The policy document's registry source matches the
baseline byte for byte. The upstream MIT copyright/license remains in `LICENSE`.
The document files are data, so their executable bits are not enabled.

Verify provenance from the repository root:

```sh
python3 scripts/verify-restored-rust-inputs.py
cargo test --offline --locked --manifest-path engine/Cargo.toml --workspace --lib
```

The restored picture-band, HWP3 formatting, memo-properties and policy-path checks
run successfully. This restores compilation inputs, not the complete corpus.
No test condition was deleted or disabled, and no dummy input was substituted.

The workspace library attempt compiles and starts 3,918 engine tests. Before a
native `wasm-bindgen::JsValue` abort, its log records 3,581 passing, 98 failing and
5 ignored tests; these are partial observations, not a completed suite result.
Isolated reruns classify 95 failures as additional missing runtime inputs and
three as reproducible non-missing-input failures:

- TAC picture toggle: empty-line height is 900, expected 1000.
- `create_empty_table_hwpx_export_known_limitation`: export succeeds while the
  test expects an error.
- `deferred_cell_replace_preserves_clickhere_range_and_offsets`: the current
  field-token guard returns `InvalidField`.

The aborting API test calls a non-wasm32-unimplemented `JsValue` path. Its
underlying API error is not resolved here. The other workspace crates complete
182 unit tests successfully. Further all-target compilation is blocked by the
local reserved free-space preflight. Full Rust success and CI success are not
claimed. Runtime fixtures, assertion expectations and target-specific test
execution need separate follow-up; this change adds no CI configuration.
