//! Read-only profiling of generated Enter inputs using existing native phase timers.
use rhwp::document_core::DocumentCore;
use serde_json::json;
use std::time::Instant;

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "FIXTURE_DIR OUTPUT_DIR");
    std::fs::create_dir_all(&args[2]).unwrap();
    let mut rows = Vec::new();
    for scope in ["body", "cell"] {
        for count in [32, 512, 8192] {
            let bytes = std::fs::read(format!("{}/{}-{}.hwpx", args[1], scope, count)).unwrap();
            for trial in -1..2 {
                println!("PROFILE_PHASE scope={scope} paragraphs={count} trial={trial} phase=load");
                let start = Instant::now();
                let mut d = DocumentCore::from_bytes(&bytes).unwrap();
                let load_ms = start.elapsed().as_secs_f64() * 1000.0;
                let before_text = d.text_file_unicode_json();
                let start = Instant::now();
                let undo = d.save_snapshot_with_composition_native();
                let save_ms = start.elapsed().as_secs_f64() * 1000.0;
                let cache_bytes = d.snapshot_composition_cache_bytes_native();
                println!("PROFILE_PHASE scope={scope} paragraphs={count} trial={trial} phase=enter");
                let start = Instant::now();
                if scope == "body" {
                    d.split_paragraph_native_with_next_style(0, count - 1, 5, None, true).unwrap();
                } else {
                    d.split_paragraph_in_cell_native_with_next_style(0, 1, 0, 0, 0, 5, None, true).unwrap();
                }
                let enter_ms = start.elapsed().as_secs_f64() * 1000.0;
                let after_text = d.text_file_unicode_json();
                let start = Instant::now();
                let redo = d.save_snapshot_with_composition_native();
                let save_after_ms = start.elapsed().as_secs_f64() * 1000.0;
                println!("PROFILE_PHASE scope={scope} paragraphs={count} trial={trial} phase=undo");
                let start = Instant::now();
                d.restore_snapshot_native(undo).unwrap();
                let undo_ms = start.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(d.text_file_unicode_json(), before_text);
                println!("PROFILE_PHASE scope={scope} paragraphs={count} trial={trial} phase=redo");
                let start = Instant::now();
                d.restore_snapshot_native(redo).unwrap();
                let redo_ms = start.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(d.text_file_unicode_json(), after_text);
                let row = json!({"scope":scope,"paragraphs":count,"trial":trial,"warmup":trial<0,"loadMs":load_ms,"saveBeforeMs":save_ms,"saveAfterMs":save_after_ms,"enterMs":enter_ms,"undoMs":undo_ms,"redoMs":redo_ms,"cachedEstimatedBytes":cache_bytes,"pages":d.page_count()});
                println!("PROFILE_RESULT {row}");
                rows.push(row);
                d.discard_snapshot_native(undo);
                d.discard_snapshot_native(redo);
            }
        }
    }
    let proof = json!({"nativeDebugProfile":true,"existingInstrumentationOnly":true,"warmupTrials":1,"measuredTrials":2,"GUIVerified":false,"rows":rows});
    std::fs::write(format!("{}/native-profile-results.json", args[2]), serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
}
