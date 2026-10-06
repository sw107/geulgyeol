//! Distinguish uncommitted pagination from document-model/history corruption.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
    renderer::{
        composer::compose_section, height_measurer::HeightMeasurer, style_resolver::resolve_styles,
    },
};
use serde_json::{json, Value};
fn model(d: &DocumentCore) -> String {
    fn clear(ps: &mut [Paragraph]) {
        for p in ps {
            p.single_line_overflow_memo.clear();
            for c in &mut p.controls {
                if let Control::Table(t) = c {
                    t.dirty = false;
                    for c in &mut t.cells {
                        clear(&mut c.paragraphs);
                    }
                }
            }
        }
    }
    let mut doc = d.document().clone();
    for s in &mut doc.sections {
        clear(&mut s.paragraphs);
    }
    format!("{doc:?}")
}
fn live(d: &DocumentCore) -> Value {
    let styles = resolve_styles(&d.document().doc_info, 96.0);
    let section = &d.document().sections[0];
    let composed = compose_section(section);
    let profile = d.document().layout_profile();
    let m = HeightMeasurer::new(96.0)
        .with_native_hwp5(profile.native_hwp5_layout())
        .with_hwp3_variant(profile.hwp3_layout())
        .with_legacy_hwp3_stored_geometry(profile.legacy_hwp3_stored_geometry())
        .measure_section(&section.paragraphs, &composed, &styles, None);
    json!({"tables":m.tables.iter().map(|t|json!({"parent":t.para_index,"control":t.control_index,"rows":t.row_heights,"height":t.total_height})).collect::<Vec<_>>()})
}
fn svgs(d: &DocumentCore) -> Vec<String> {
    (0..d.page_count())
        .map(|i| d.render_page_svg_native(i).unwrap())
        .collect()
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let input = &args[0];
    let out = args.last().unwrap();
    std::fs::create_dir_all(out).unwrap();
    let data = std::fs::read(input).unwrap();
    let mut rows = vec![];
    for mode in ["bulk", "nth", "deferred", "ordinary"] {
        let mut d = DocumentCore::from_bytes(&data).unwrap();
        let h: Value =
            serde_json::from_str(&d.search_all_text_native("ia", false, true).unwrap()).unwrap();
        let h = &h[0];
        let c = &h["cellContext"];
        let num = |v: &Value, k: &str| v[k].as_u64().unwrap() as usize;
        let (pi, ci, cell, para, start, len) = (
            num(c, "parentPara"),
            num(c, "ctrlIdx"),
            num(c, "cellIdx"),
            num(c, "cellPara"),
            num(h, "charOffset"),
            num(h, "length"),
        );
        let before = model(&d);
        let undo = d.save_snapshot_native();
        match mode {
            "bulk" => {
                d.replace_all_native("ia", "Q", false).unwrap();
            }
            "nth" => {
                d.replace_nth_native("ia", "Q", false, 0).unwrap();
            }
            "deferred" => {
                d.replace_text_in_cell_native_deferred_pagination(
                    0, pi, ci, cell, para, start, len, "Q",
                )
                .unwrap();
            }
            _ => {
                d.delete_text_in_cell_native(0, pi, ci, cell, para, start, len)
                    .unwrap();
                d.insert_text_in_cell_native(0, pi, ci, cell, para, start, "Q")
                    .unwrap();
            }
        }
        let uncommitted = model(&d);
        let pending_svg = svgs(&d);
        let pending_pages = d.dump_page_items_json(None);
        let pending_live = live(&d);
        for (i, svg) in pending_svg.iter().enumerate() {
            std::fs::write(format!("{out}/{mode}-pending-{i}.svg"), svg).unwrap();
        }
        d.repaginate_if_needed();
        assert_eq!(
            model(&d),
            uncommitted,
            "pagination must not change document content"
        );
        let committed_svg = svgs(&d);
        let committed_pages = d.dump_page_items_json(None);
        let committed_live = live(&d);
        assert_eq!(committed_live, pending_live);
        let after = model(&d);
        let redo = d.save_snapshot_native();
        let mut stable = true;
        for _ in 0..3 {
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(model(&d), before);
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(model(&d), after);
            stable &= svgs(&d) == committed_svg;
        }
        let redo_svg = svgs(&d);
        let fresh_doc = d.document().clone();
        d.set_document(fresh_doc);
        let rebuilt_svg = svgs(&d);
        assert_eq!(model(&d), after);
        for (i, svg) in committed_svg.iter().enumerate() {
            std::fs::write(format!("{out}/{mode}-committed-{i}.svg"), svg).unwrap();
        }
        rows.push(json!({"mode":mode,"modelUnchangedByCommit":true,"uncommittedSVGDiffered":pending_svg!=committed_svg,"pendingPages":pending_pages,"committedPages":committed_pages,"pendingLiveMeasurement":pending_live,"committedLiveMeasurement":committed_live,"threeRedoLoopsStable":stable,"fullRebuildAgreesWithRedo":rebuilt_svg==redo_svg,"committedVersusFreshRebuildDiffers":committed_svg!=rebuilt_svg}));
        d.discard_snapshot_native(undo);
        d.discard_snapshot_native(redo);
    }
    let proof = json!({"input":input,"rows":rows,"GUIVerified":false});
    std::fs::write(
        format!("{out}/probe.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("cell commit probe: 4 modes, 12 redo loops recorded");
    if args.iter().any(|a| a == "--strict") {
        assert!(
            proof["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["threeRedoLoopsStable"] == true),
            "committed cell edit must match every redo"
        );
    }
}
