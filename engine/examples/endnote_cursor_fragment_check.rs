//! Public note caret/hit contracts against actual render fragments, without a GUI.
use rhwp::{
    document_core::DocumentCore,
    model::control::Control,
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Clone)]
struct Run {
    page: u32,
    column: Option<u16>,
    owner: usize,
    para: usize,
    start: usize,
    text: String,
    bbox: [f64; 4],
    baseline: f64,
    font: f64,
}
fn collect(n: &RenderNode, page: u32, column: Option<u16>, out: &mut Vec<Run>) {
    let column = if let RenderNodeType::Column(c) = n.node_type {
        Some(c)
    } else {
        column
    };
    if let RenderNodeType::TextRun(t) = &n.node_type {
        if let (Some(owner), Some(para), Some(start)) =
            (t.section_index, t.para_index, t.char_start)
        {
            out.push(Run {
                page,
                column,
                owner,
                para,
                start,
                text: t.text.clone(),
                bbox: [n.bbox.x, n.bbox.y, n.bbox.width, n.bbox.height],
                baseline: t.baseline,
                font: t.style.font_size,
            });
        }
    }
    for c in &n.children {
        collect(c, page, column, out);
    }
}
fn queries(d: &DocumentCore) -> Value {
    let mut map = BTreeMap::new();
    for p in d.dump_page_items_json(None).as_array().unwrap() {
        for c in p["columns"].as_array().unwrap() {
            for it in c["items"].as_array().unwrap() {
                let s = &it["endnoteSource"];
                if !s.is_null() {
                    map.insert(
                        (
                            p["section"].as_u64().unwrap() as usize,
                            it["paraIndex"].as_u64().unwrap() as usize,
                        ),
                        (
                            s["section"].as_u64().unwrap() as usize,
                            s["para"].as_u64().unwrap() as usize,
                            s["controlIndex"].as_u64().unwrap() as usize,
                            s["noteParaIndex"].as_u64().unwrap() as usize,
                        ),
                    );
                }
            }
        }
    }
    let mut all = vec![];
    for p in 0..d.page_count() {
        collect(
            &d.build_page_render_tree(p).unwrap().root,
            p,
            None,
            &mut all,
        );
    }
    let mut grouped: BTreeMap<_, Vec<Run>> = BTreeMap::new();
    for r in all {
        if let Some(src) = map.get(&(r.owner, r.para)) {
            grouped.entry(*src).or_default().push(r);
        }
    }
    let mut result = vec![];
    for (src, runs) in grouped {
        let note = match &d.document().sections[src.0].paragraphs[src.1].controls[src.2] {
            Control::Endnote(n) => n,
            _ => continue,
        };
        let text = &note.paragraphs[src.3].text;
        let source_len = text.chars().count();
        let rendered = runs.iter().map(|r| r.text.as_str()).collect::<String>();
        assert!(rendered.ends_with(text));
        let prefix = rendered.chars().count() - source_len;
        assert!(src.3 == 0 || prefix == 0);
        let mut offsets = BTreeSet::from([0, source_len]);
        if source_len > 0 {
            offsets.insert(source_len - 1);
        }
        if source_len > 1 {
            offsets.insert(source_len - 2);
        }
        for (i, r) in runs.iter().enumerate() {
            let boundary = i == 0
                || i + 1 == runs.len()
                || runs[i - 1].page != r.page
                || runs[i - 1].column != r.column
                || i == 1;
            if boundary {
                let p = r.start.saturating_sub(prefix).min(source_len);
                offsets.insert(p);
                if p > 0 {
                    offsets.insert(p - 1);
                }
                if p < source_len {
                    offsets.insert(p + 1);
                }
            }
        }
        for offset in offsets {
            let ro = offset + prefix;
            let target = runs
                .iter()
                .find(|r| r.start == ro)
                .or_else(|| {
                    runs.iter()
                        .find(|r| r.start <= ro && ro < r.start + r.text.chars().count())
                })
                .or_else(|| {
                    runs.iter()
                        .rev()
                        .find(|r| ro == r.start + r.text.chars().count())
                })
                .unwrap();
            let rect = d.get_cursor_rect_in_note_native(src.0, src.1, src.2, src.3, offset);
            let mut row = json!({"source":[src.0,src.1,src.2,src.3],"offset":offset,"renderOffset":ro,"expected":{"page":target.page,"column":target.column,"owner":target.owner,"para":target.para,"start":target.start,"end":target.start+target.text.chars().count(),"bbox":target.bbox,"caretY":target.bbox[1]+target.baseline-target.font*0.8,"font":target.font,"atRunStart":ro==target.start,"atRunEnd":ro==target.start+target.text.chars().count()}});
            match rect {
                Ok(s) => {
                    let r: Value = serde_json::from_str(&s).unwrap();
                    let hit = d.hit_test_native(
                        r["pageIndex"].as_u64().unwrap() as u32,
                        r["x"].as_f64().unwrap(),
                        r["y"].as_f64().unwrap() + r["height"].as_f64().unwrap() * 0.5,
                    );
                    row["rect"] = r;
                    match hit {
                        Ok(s) => row["hit"] = serde_json::from_str(&s).unwrap(),
                        Err(e) => row["hitError"] = json!(e.to_string()),
                    }
                }
                Err(e) => row["error"] = json!(e.to_string()),
            };
            result.push(row);
        }
    }
    json!({"pages":d.page_count(),"queries":result})
}
fn checkpoint(d: &DocumentCore, out: &Path, name: &str) -> Value {
    let live = queries(d);
    let bytes = d.export_hwpx_native().unwrap();
    fs::write(out.join(format!("{name}.hwpx")), &bytes).unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    let mut rebuilt = DocumentCore::new_empty();
    rebuilt.set_document(d.document().clone());
    json!({"live":live,"cold":queries(&cold),"rebuilt":queries(&rebuilt)})
}
fn main() {
    let a: Vec<_> = std::env::args().skip(1).collect();
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&a[0]).unwrap()).unwrap();
    let out = Path::new(&a[1]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    for f in fixtures {
        let case = f["case"].as_str().unwrap();
        let mut d =
            DocumentCore::from_bytes(&fs::read(f["path"].as_str().unwrap()).unwrap()).unwrap();
        let initial = d.save_snapshot_native();
        rows.push(json!({"case":case,"stage":"before","result":checkpoint(&d,out,&format!("{case}-before"))}));
        for t in f["actions"].as_array().unwrap() {
            d.insert_text_in_footnote_native(
                t["section"].as_u64().unwrap() as usize,
                t["para"].as_u64().unwrap() as usize,
                t["control"].as_u64().unwrap() as usize,
                t["notePara"].as_u64().unwrap() as usize,
                0,
                t["text"].as_str().unwrap(),
            )
            .unwrap();
        }
        let grown = d.save_snapshot_native();
        rows.push(json!({"case":case,"stage":"grown","result":checkpoint(&d,out,&format!("{case}-grown"))}));
        for (stage, snapshot) in [("undo", initial), ("redo", grown)] {
            d.restore_snapshot_native(snapshot).unwrap();
            rows.push(json!({"case":case,"stage":stage,"result":checkpoint(&d,out,&format!("{case}-{stage}"))}));
        }
        d.discard_snapshot_native(initial);
        d.discard_snapshot_native(grown);
    }
    fs::write(
        out.join("raw.json"),
        serde_json::to_vec(&json!({"GUIVerified":false,"rows":rows})).unwrap(),
    )
    .unwrap();
    println!("cursor stages={}", rows.len());
}
