//! Equation-script consumers and unsupported header/note boundaries.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
fn scripts(d: &DocumentCore) -> Value {
    fn collect(ps: &[Paragraph], out: &mut Vec<Value>) {
        for p in ps {
            out.push(json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":p.char_shapes.iter().map(|c|json!([c.start_pos,c.char_shape_id])).collect::<Vec<_>>()}));
            for c in &p.controls {
                match c{Control::Equation(e)=>out.push(json!({"script":e.script,"fontSize":e.font_size,"color":e.color,"attr":e.attr})),Control::Table(t)=>for c in &t.cells{collect(&c.paragraphs,out)},_=>{}}
            }
        }
    }
    let mut out = vec![];
    for s in &d.document().sections {
        collect(&s.paragraphs, &mut out)
    }
    json!(out)
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut history, mut reopens, mut unchanged) = (0, 0, 0, 0);
    for cell in [false, true] {
        for (id, (text, q, expected, length)) in [
            ("İAB", "i\u{307}a", "QB", 2),
            ("İA😀TAIL", "i\u{307}a", "Q😀TAIL", 2),
            ("i\u{307}AB", "İA", "QB", 3),
        ]
        .iter()
        .enumerate()
        {
            for nth in [false, true] {
                let mut d = DocumentCore::new_empty();
                d.create_blank_document_native().unwrap();
                d.insert_text_native(0, 0, 0, "본문😀 보존").unwrap();
                d.apply_char_format_native(0, 0, 0, 2, "{\"bold\":true}")
                    .unwrap();
                if cell {
                    let r = d.create_table_native(0, 0, 0, 1, 1).unwrap();
                    let (pi, ci) = (idx(&r, "paraIdx"), idx(&r, "controlIdx"));
                    d.insert_text_in_cell_native(0, pi, ci, 0, 0, 0, "셀😀 보존")
                        .unwrap();
                    d.insert_equation_in_cell_native(0, pi, ci, 0, 0, 1, text, 1400, 0x123456)
                        .unwrap();
                } else {
                    d.insert_equation_native(0, 0, 1, text, 1400, 0x123456)
                        .unwrap();
                }
                let matches = d.grep(q, false, None);
                assert_eq!(matches.len(), 1);
                assert!(matches[0].equation.is_some());
                assert_eq!((matches[0].char_offset, matches[0].length), (0, *length));
                let hits: Value =
                    serde_json::from_str(&d.search_all_text_native(q, false, true).unwrap())
                        .unwrap();
                assert_eq!(hits[0]["length"], *length);
                let before = scripts(&d);
                let undo = d.save_snapshot_native();
                let r = if nth {
                    d.replace_nth_native(q, "Q", false, 0)
                } else {
                    d.replace_all_native(q, "Q", false)
                }
                .unwrap();
                assert_eq!(serde_json::from_str::<Value>(&r).unwrap()["count"], 1);
                d.repaginate_if_needed();
                let after = scripts(&d);
                let mut expected_state = before.clone();
                for p in expected_state.as_array_mut().unwrap() {
                    if p.get("script").is_some() {
                        p["script"] = json!(expected);
                    }
                }
                assert_eq!(after, expected_state);
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(undo).unwrap();
                assert_eq!(scripts(&d), before);
                history += 1;
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(scripts(&d), after);
                history += 1;
                d.discard_snapshot_native(undo);
                d.discard_snapshot_native(redo);
                for (fmt, bytes) in [
                    ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                    ("hwpx", d.export_hwpx_native().unwrap()),
                ] {
                    let file = format!("{out}/equation-{cell}-{id}-{nth}.{fmt}");
                    std::fs::write(file, &bytes).unwrap();
                    assert_eq!(scripts(&DocumentCore::from_bytes(&bytes).unwrap()), after);
                    reopens += 1;
                }
                cases += 1;
            }
        }
    }
    for kind in 0..2 {
        let mut d = DocumentCore::new_empty();
        d.create_blank_document_native().unwrap();
        d.insert_text_native(0, 0, 0, "지원 본문 보존🧪").unwrap();
        if kind == 0 {
            d.create_header_footer_native(0, true, 0).unwrap();
        } else {
            d.insert_footnote_native(0, 0, 0).unwrap();
        }
        for p in &mut d.document_mut().sections[0].paragraphs {
            for c in &mut p.controls {
                let ps = match c {
                    Control::Header(h) => Some(&mut h.paragraphs),
                    Control::Footnote(n) => Some(&mut n.paragraphs),
                    _ => None,
                };
                if let Some(ps) = ps {
                    ps[0].insert_text_at(0, "İAB");
                }
            }
        }
        let document = d.document().clone();
        d.set_document(document);
        for q in ["i\u{307}a", ""] {
            let before = format!("{:?}", d.document());
            let ev = d.serialize_event_log();
            assert!(d.grep(q, false, None).is_empty());
            assert_eq!(d.search_all_text_native(q, false, true).unwrap(), "[]");
            let r: Value =
                serde_json::from_str(&d.replace_all_native(q, "Q", false).unwrap()).unwrap();
            assert_eq!(r["count"], 0);
            assert_eq!(format!("{:?}", d.document()), before);
            assert_eq!(d.serialize_event_log(), ev);
            unchanged += 1;
        }
    }
    let proof = json!({"equationCases":cases,"historyRestores":history,"reopens":reopens,"unsupportedAndEmptyNoChange":unchanged,"regexSupported":false,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
