use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, footnote::FootnotePlacement},
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn walk(n: &RenderNode, runs: &mut Vec<Value>, clips: &mut Vec<Value>) {
    if let RenderNodeType::TextRun(t) = &n.node_type {
        runs.push(json!({"section":t.section_index,"para":t.para_index,"start":t.char_start,"text":t.text,"display":t.display_text,"bbox":[n.bbox.x,n.bbox.y,n.bbox.width,n.bbox.height],"visible":n.visible,"cell":t.cell_context}));
    }
    if let RenderNodeType::Body { clip_rect } = &n.node_type {
        clips.push(json!({"bbox":n.bbox,"clip":clip_rect}));
    }
    for c in &n.children {
        walk(c, runs, clips);
    }
}
fn view(d: &DocumentCore) -> Value {
    let mut notes = vec![];
    for (si, s) in d.document().sections.iter().enumerate() {
        for (pi, p) in s.paragraphs.iter().enumerate() {
            for (ci, c) in p.controls.iter().enumerate() {
                let (kind, ps) = match c {
                    Control::Endnote(n) => ("endnote", &n.paragraphs),
                    Control::Footnote(n) => ("footnote", &n.paragraphs),
                    _ => continue,
                };
                notes.push(json!({"section":si,"para":pi,"control":ci,"kind":kind,"paragraphs":ps.iter().map(|p|json!({"text":p.text})).collect::<Vec<_>>()}));
            }
        }
    }
    let pages:Vec<_>=(0..d.page_count()).map(|p|{let mut runs=vec![];let mut clips=vec![];walk(&d.build_page_render_tree(p).unwrap().root,&mut runs,&mut clips);json!({"info":serde_json::from_str::<Value>(&d.get_page_info_native(p).unwrap()).unwrap(),"runs":runs,"clips":clips})}).collect();
    json!({"body":d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|p.text.clone()).collect::<Vec<_>>()).collect::<Vec<_>>(),"notes":notes,"pages":pages,"items":d.dump_page_items_json(None)})
}
fn check(d: &DocumentCore, out: &Path, name: &str) -> Value {
    let live = view(d);
    let bytes = d.export_hwpx_native().unwrap();
    fs::write(out.join(format!("{name}.hwpx")), &bytes).unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    let fresh = view(&cold);
    let mut rebuilt = DocumentCore::new_empty();
    rebuilt.set_document(d.document().clone());
    let rebuild = view(&rebuilt);
    assert!(live["body"] == fresh["body"], "body changed on export");
    assert!(
        live["notes"] == fresh["notes"],
        "note texts changed on export"
    );
    assert!(view(d) == live, "export mutated live layout");
    json!({"stage":name,"live":live,"cold":fresh,"rebuilt":rebuild,"exactViewEqual":live==fresh,"rebuildEqual":live==rebuild,"exportReadOnly":true})
}
fn seed(out: &Path) {
    fs::create_dir(out).unwrap();
    for count in [2, 3] {
        let mut d = DocumentCore::new_empty();
        d.create_blank_document_native().unwrap();
        d.insert_text_native(0, 0, 0, "SEED").unwrap();
        let original = d.document().sections[0].clone();
        let mut sections = Vec::new();
        for i in 0..count {
            let mut s = original.clone();
            let p = &mut s.paragraphs[0];
            let len = p.text.chars().count();
            p.delete_text_at(0, len);
            p.insert_text_at(0, &format!("BODY_{i}"));
            s.section_def.page_def.width = if i == 0 { 59528 } else { 42000 };
            s.section_def.master_pages.clear();
            s.section_def.endnote_shape.placement = FootnotePlacement::EachColumn;
            s.section_def.endnote_shape.attr &= !0x300;
            for c in &mut p.controls {
                if let Control::SectionDef(sd) = c {
                    **sd = s.section_def.clone();
                }
            }
            s.raw_stream = None;
            sections.push(s);
        }
        let mut doc = d.document().clone();
        doc.sections = sections;
        d.set_document(doc);
        let inserted: Value =
            serde_json::from_str(&d.insert_endnote_native(0, 0, 0).unwrap()).unwrap();
        let ci = inserted["controlIdx"].as_u64().unwrap() as usize;
        d.insert_text_in_footnote_native(0, 0, ci, 0, 0, "note")
            .unwrap();
        fs::write(
            out.join(format!("seed-{count}.hwpx")),
            d.export_hwpx_native().unwrap(),
        )
        .unwrap();
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args[0] == "seed" {
        seed(Path::new(&args[1]));
        return;
    }
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    for f in &fixtures {
        let case = f["case"].as_str().unwrap();
        let mut d =
            DocumentCore::from_bytes(&fs::read(f["path"].as_str().unwrap()).unwrap()).unwrap();
        let initial = d.save_snapshot_native();
        let before = check(&d, out, &format!("{case}-before"));
        let initial_view = before["live"].clone();
        rows.push(json!({"case":case,"result":before}));
        for a in f["actions"].as_array().unwrap() {
            d.insert_text_in_footnote_native(
                a["section"].as_u64().unwrap() as usize,
                0,
                a["control"].as_u64().unwrap() as usize,
                a["notePara"].as_u64().unwrap() as usize,
                0,
                a["text"].as_str().unwrap(),
            )
            .unwrap();
        }
        let grown = d.save_snapshot_native();
        let after = check(&d, out, &format!("{case}-grown"));
        let grown_view = after["live"].clone();
        rows.push(json!({"case":case,"result":after}));
        for (stage, snapshot, expected) in [
            ("undo", initial, &initial_view),
            ("redo", grown, &grown_view),
        ] {
            d.restore_snapshot_native(snapshot).unwrap();
            let r = check(&d, out, &format!("{case}-{stage}"));
            assert_eq!(&r["live"], expected);
            rows.push(json!({"case":case,"result":r}));
        }
        for a in f["actions"].as_array().unwrap() {
            d.delete_text_in_footnote_native(
                a["section"].as_u64().unwrap() as usize,
                0,
                a["control"].as_u64().unwrap() as usize,
                a["notePara"].as_u64().unwrap() as usize,
                0,
                a["text"].as_str().unwrap().chars().count(),
            )
            .unwrap();
        }
        let r = check(&d, out, &format!("{case}-shrunk"));
        assert_eq!(r["live"]["notes"], initial_view["notes"]);
        rows.push(json!({"case":case,"result":r}));
        d.discard_snapshot_native(initial);
        d.discard_snapshot_native(grown);
    }
    fs::write(
        out.join("raw.json"),
        serde_json::to_vec(&json!({"GUIVerified":false,"rows":rows})).unwrap(),
    )
    .unwrap();
    println!("rows={}", rows.len());
}
