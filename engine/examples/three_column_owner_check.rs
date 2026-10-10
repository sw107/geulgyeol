//! One bounded Native binary for source ledgers and actual saved-file checks.
//! Usage: three_column_owner_check INPUT_HWP_OR_HWPX_OR_MANIFEST_JSON FRESH_OUTPUT
#[path = "mixed_table_owner_probe.rs"]
mod probe;
#[path = "horizontal_table_saved_check.rs"]
mod saved;
fn main() {
    let input = std::env::args().nth(1).expect("input");
    if input.ends_with(".json") { saved::main(); } else { probe::main(); }
}
