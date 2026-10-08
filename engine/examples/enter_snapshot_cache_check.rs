//! Exact document history, appearance, fallback and bounded composition memory.
use rhwp::document_core::DocumentCore;
use serde_json::json;

fn open(root: &str, name: &str) -> DocumentCore {
    DocumentCore::from_bytes(&std::fs::read(format!("{root}/{name}.hwpx")).unwrap()).unwrap()
}
fn views(d: &DocumentCore) -> Vec<String> {
    (0..d.page_count())
        .map(|p| d.render_page_svg_native(p).unwrap())
        .collect()
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "FIXTURE_DIR OUTPUT_DIR");
    let (root, out) = (&args[1], &args[2]);
    std::fs::create_dir_all(out).unwrap();
    let mut cached_cases = 0;
    for scope in ["body", "cell"] {
        for count in [32, 512] {
            let mut d = open(root, &format!("{scope}-{count}"));
            let before_views = views(&d);
            let before = format!("{:?}", d.document());
            let undo = d.save_snapshot_with_composition_native();
            let bytes = d.snapshot_composition_cache_bytes_native();
            assert!(bytes > 0 && bytes <= 16 * 1024 * 1024);
            if scope == "body" {
                d.split_paragraph_native_with_next_style(0, count - 1, 5, None, true)
                    .unwrap();
            } else {
                d.split_paragraph_in_cell_native_with_next_style(0, 1, 0, 0, 0, 5, None, true)
                    .unwrap();
            }
            let after_views = views(&d);
            let after = format!("{:?}", d.document());
            let redo = d.save_snapshot_with_composition_native();
            for _ in 0..3 {
                d.restore_snapshot_native(undo).unwrap();
                assert_eq!(views(&d), before_views);
                assert_eq!(format!("{:?}", d.document()), before);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(views(&d), after_views);
                assert_eq!(format!("{:?}", d.document()), after);
            }
            for bytes in [d.export_hwp_with_adapter_snapshot().unwrap(), d.export_hwpx_native().unwrap()] {
                let reopened = DocumentCore::from_bytes(&bytes).unwrap();
                assert_eq!(reopened.text_file_unicode_json(), d.text_file_unicode_json());
            }
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            assert_eq!(d.snapshot_composition_cache_bytes_native(), 0);
            cached_cases += 1;
        }
    }
    // A session DPI change invalidates stored composition and uses the old rebuild.
    let mut normal = open(root, "body-32");
    let mut cached = open(root, "body-32");
    let a = normal.save_snapshot_native();
    let b = cached.save_snapshot_with_composition_native();
    normal.set_dpi(144.0);
    cached.set_dpi(144.0);
    normal.restore_snapshot_native(a).unwrap();
    cached.restore_snapshot_native(b).unwrap();
    assert_eq!(views(&normal), views(&cached));
    let mut normal = open(root, "body-32");
    let mut cached = open(root, "body-32");
    let a = normal.save_snapshot_native();
    let b = cached.save_snapshot_with_composition_native();
    normal.set_hangul2024_compat(true);
    cached.set_hangul2024_compat(true);
    normal.restore_snapshot_native(a).unwrap();
    cached.restore_snapshot_native(b).unwrap();
    assert_eq!(views(&normal), views(&cached));

    // Pending batch edits must never snapshot stale paragraph measurements.
    let mut batch = open(root, "body-32");
    batch.begin_batch_native().unwrap();
    batch.insert_text_native(0, 31, 5, " pending").unwrap();
    let batch_text = batch.text_file_unicode_json();
    let id = batch.save_snapshot_with_composition_native();
    assert_eq!(batch.snapshot_composition_cache_bytes_native(), 0);
    batch.end_batch_native().unwrap();
    batch.restore_snapshot_native(id).unwrap();
    assert_eq!(batch.text_file_unicode_json(), batch_text);
    batch.discard_snapshot_native(id);

    // Complex font/shaping/numbering routes keep the existing document snapshot.
    let mut embedded = open(root, "body-32");
    embedded.document_mut().doc_info.font_faces[0][0].is_embedded = true;
    embedded.save_snapshot_with_composition_native();
    assert_eq!(embedded.snapshot_composition_cache_bytes_native(), 0);
    let mut note = open(root, "body-32");
    note.insert_footnote_native(0, 31, 5).unwrap();
    let note_views = views(&note);
    let id = note.save_snapshot_with_composition_native();
    assert_eq!(note.snapshot_composition_cache_bytes_native(), 0);
    note.restore_snapshot_native(id).unwrap();
    assert_eq!(views(&note), note_views);

    // Cache eviction preserves the underlying document snapshots and their IDs.
    let mut large = open(root, "body-8192");
    let mut ids = vec![];
    let initial = format!("{:?}", large.document());
    let mut entry_bytes = 0;
    for i in 0..12 {
        ids.push(large.save_snapshot_with_composition_native());
        if i == 0 {
            entry_bytes = large.snapshot_composition_cache_bytes_native();
            assert!(entry_bytes > 0 && entry_bytes * 12 > 32 * 1024 * 1024);
        }
        assert!(large.snapshot_composition_cache_bytes_native() <= 32 * 1024 * 1024);
    }
    large.restore_snapshot_native(ids[0]).unwrap();
    assert_eq!(format!("{:?}", large.document()), initial);
    for id in ids { large.discard_snapshot_native(id); }
    assert_eq!(large.snapshot_composition_cache_bytes_native(), 0);
    let events = large.serialize_event_log();
    assert!(large.restore_snapshot_native(u32::MAX).is_err());
    assert_eq!(format!("{:?}", large.document()), initial);
    assert_eq!(large.serialize_event_log(), events);

    // Oversized optional composition must fall back without losing the document.
    let mut oversized = open(root, "body-32768");
    let oversized_text = oversized.text_file_unicode_json();
    let oversized_id = oversized.save_snapshot_with_composition_native();
    assert_eq!(oversized.snapshot_composition_cache_bytes_native(), 0);
    oversized.restore_snapshot_native(oversized_id).unwrap();
    assert_eq!(oversized.text_file_unicode_json(), oversized_text);
    oversized.discard_snapshot_native(oversized_id);

    let proof = json!({"cachedScopeCases":cached_cases,"exactDocumentAndEveryPageSvgHistoryOperations":24,"twoFormatReopens":8,"dpiFallbackMatchesNormal":true,"compatibilityFallbackMatchesNormal":true,"pendingBatchFallback":true,"embeddedAndFootnoteFallbacks":2,"retainedSnapshotBudgetCases":12,"largeEntryEstimatedBytes":entry_bytes,"compositionEntryLimitBytes":16*1024*1024,"compositionStoreLimitBytes":32*1024*1024,"oversizedEntryFallbackParagraphs":32768,"discardReturnsCacheToZero":true,"invalidSnapshotAtomic":true,"GUIVerified":false});
    std::fs::write(format!("{out}/cache-policy-proof.json"), serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
    println!("{proof}");
}
