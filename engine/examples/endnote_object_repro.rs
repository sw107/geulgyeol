//! Synthetic object/unequal-column endnote observation; no GUI or Hancom claim.
use rhwp::{
    document_core::DocumentCore,
    model::control::Control,
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path};

fn semantic(d: &DocumentCore) -> Value {
    let s = &d.document().sections[0];
    let n = match &s.paragraphs[0].controls[2] {
        Control::Endnote(n) => n,
        _ => panic!("note"),
    };
    json!({"body":s.paragraphs.iter().map(|p|&p.text).collect::<Vec<_>>(),
        "note":n.paragraphs.iter().map(|p|json!({"text":p.text,"positions":p.logical_control_positions(),
            "equations":p.controls.iter().filter_map(|c|if let Control::Equation(e)=c {
                Some(json!({"script":e.script,"fontSize":e.font_size,"baseline":e.baseline,
                    "width":e.common.width,"height":e.common.height,"inline":e.common.treat_as_char,"attr":e.attr}))
            }else{None}).collect::<Vec<_>>() })).collect::<Vec<_>>()})
}
fn walk(n: &RenderNode, col: Option<u16>, body_count: usize, out: &mut Vec<Value>) {
    let col = if let RenderNodeType::Column(c) = n.node_type {
        Some(c)
    } else {
        col
    };
    match &n.node_type {
        RenderNodeType::TextRun(t) if t.para_index.is_some_and(|p| p >= body_count) => out.push(
            json!({"kind":"TextRun","section":t.section_index,"para":t.para_index,
                "start":t.char_start,"text":t.text,"bbox":n.bbox,"font":t.style.font_size,"baseline":t.baseline,"column":col}),
        ),
        RenderNodeType::Equation(e) => {
            out.push(json!({"kind":"Equation","section":e.section_index,
            "para":e.para_index,"control":e.control_index,"script":e.script,"note":e.note_ref,
            "bbox":n.bbox,"column":col}))
        }
        _ => {}
    }
    for c in &n.children {
        walk(c, col, body_count, out);
    }
}
fn view(d: &DocumentCore) -> Value {
    let body = d.document().sections[0].paragraphs.len();
    let pages:Vec<_>=(0..d.page_count()).map(|p|{
        let mut nodes=vec![];walk(&d.build_page_render_tree(p).unwrap().root,None,body,&mut nodes);
        json!({"info":serde_json::from_str::<Value>(&d.get_page_info_native(p).unwrap()).unwrap(),"nodes":nodes})
    }).collect();
    let n = match &d.document().sections[0].paragraphs[0].controls[2] {
        Control::Endnote(n) => n,
        _ => panic!(),
    };
    let mut queries = vec![];
    for (pi, p) in n.paragraphs.iter().enumerate() {
        let len = p.text.chars().count();
        let prefix = if pi == 0 { 3 } else { 0 };
        let mut offsets = BTreeSet::from([0, len / 2, len]);
        if len > 0 {
            offsets.insert(len - 1);
        }
        if p.controls
            .iter()
            .all(|c| matches!(c, Control::AutoNumber(_)))
        {
            let mut seen = BTreeSet::new();
            for (page, value) in pages.iter().enumerate() {
                for n in value["nodes"].as_array().unwrap() {
                    if n["kind"] != "TextRun" || n["para"].as_u64() != Some((body + pi) as u64) {
                        continue;
                    }
                    let col = n["column"].as_u64().unwrap_or(0);
                    if seen.insert((page, col)) {
                        let offset = (n["start"].as_u64().unwrap() as usize)
                            .saturating_sub(prefix)
                            .min(len);
                        offsets.insert(offset);
                        if offset > 0 {
                            offsets.insert(offset - 1);
                        }
                        if offset < len {
                            offsets.insert(offset + 1);
                        }
                    }
                }
            }
        }
        for offset in offsets {
            let mut row = json!({"source":[0,0,2,pi],"offset":offset});
            match d.get_cursor_rect_in_note_native(0, 0, 2, pi, offset) {
                Ok(s) => {
                    let r: Value = serde_json::from_str(&s).unwrap();
                    let hit = d.hit_test_native(
                        r["pageIndex"].as_u64().unwrap() as u32,
                        r["x"].as_f64().unwrap(),
                        r["y"].as_f64().unwrap() + r["height"].as_f64().unwrap() * 0.5,
                    );
                    row["rect"] = r;
                    row["hit"] = hit
                        .map(|s| serde_json::from_str::<Value>(&s).unwrap())
                        .unwrap_or_else(|e| json!({"error":e.to_string()}));
                }
                Err(e) => row["error"] = json!(e.to_string()),
            };
            queries.push(row);
        }
    }
    json!({"semantic":semantic(d),"pages":pages,"items":d.dump_page_items_json(None),"queries":queries,
        "entry":d.get_note_edit_info_native(0,0,2).map(|s|serde_json::from_str::<Value>(&s).unwrap()).unwrap_or_else(|e|json!({"error":e.to_string()}))})
}
fn checkpoint(d: &DocumentCore, out: &Path, label: &str) -> Value {
    let live = view(d);
    let bytes = d.export_hwpx_native().unwrap();
    fs::write(out.join(format!("{label}.hwpx")), &bytes).unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    let mut rebuilt = DocumentCore::new_empty();
    rebuilt.set_document(d.document().clone());
    json!({"live":live,"cold":view(&cold),"rebuilt":view(&rebuilt)})
}
fn seed(base: &Path, out: &Path) {
    fs::create_dir(out).unwrap();
    let bytes = fs::read(base).unwrap();
    let mut rows = vec![];
    for name in [
        "plain-single",
        "unequal-two",
        "inline-equation",
        "equation-after-text",
        "equation-before-text",
        "equation-after-text-two-columns",
        "equation-after-text-three-plain",
        "equation-after-text-fraction",
        "equation-after-text-short",
        "equation-after-text-long",
        "equation-after-text-line-mode",
        "equation-after-text-wide",
        "equation-after-text-two-equations",
    ] {
        let mut d = DocumentCore::from_bytes(&bytes).unwrap();
        let mut doc = d.document().clone();
        doc.sections[0].section_def.page_def.width = 32000;
        doc.sections[0].section_def.page_def.height = 22000;
        let sd = doc.sections[0].section_def.clone();
        for c in &mut doc.sections[0].paragraphs[0].controls {
            if let Control::SectionDef(s) = c {
                **s = sd.clone();
            }
            if let Control::ColumnDef(c) = c {
                c.column_count = if name == "unequal-two" || name.ends_with("two-columns") {
                    2
                } else {
                    1
                };
                c.same_width = name != "unequal-two";
                c.raw_attr = 0;
                if name == "unequal-two" {
                    c.widths = vec![9000, 19250];
                    c.gaps = vec![750, 0];
                    c.spacing = 750;
                    c.proportional_widths = false;
                }
            }
        }
        doc.sections[0].raw_stream = None;
        doc.sections[0].raw_provenance = None;
        d.set_document(doc);
        let mut note_para = 0;
        if name.contains("equation") {
            let mut tmp = DocumentCore::from_bytes(&d.export_hwpx_native().unwrap()).unwrap();
            let mut model = tmp.document().clone();
            let tail = &mut model.sections[0].paragraphs[1];
            let len = tail.text.chars().count();
            tail.delete_text_at(0, len);
            tail.insert_text_at(0, "EQ_END");
            tail.para_shape_id = 10;
            tmp.set_document(model);
            let (script, size) = if name.ends_with("fraction") {
                ("1 over 2", 1800)
            } else {
                ("x ^2", 900)
            };
            tmp.insert_equation_native(0, 1, 0, script, size, 0)
                .unwrap();
            if name.ends_with("two-equations") {
                tmp.insert_equation_native(0, 1, 3, "y ^2", 900, 0).unwrap();
            }
            let mut eq = tmp.document().sections[0].paragraphs[1].clone();
            if let Control::Equation(e) = &mut eq.controls[0] {
                if name.ends_with("line-mode") {
                    e.attr |= 1;
                    e.eqedit |= 1;
                }
                if name.ends_with("wide") {
                    e.common.width = 50000;
                }
            }
            assert!(matches!(eq.controls[0], Control::Equation(_)));
            let mut model = d.document().clone();
            let n = match &mut model.sections[0].paragraphs[0].controls[2] {
                Control::Endnote(n) => n,
                _ => panic!(),
            };
            if name == "inline-equation" {
                n.paragraphs[0] = eq;
            } else if name.starts_with("equation-after-text") {
                if name.ends_with("three-plain") {
                    for label in ["MIDDLE_END", "TAIL_END"] {
                        let mut p = n.paragraphs[0].clone();
                        let len = p.text.chars().count();
                        p.delete_text_at(0, len);
                        p.insert_text_at(0, label);
                        n.paragraphs.push(p);
                    }
                }
                n.paragraphs.push(eq);
            } else {
                n.paragraphs.insert(0, eq);
                note_para = 1;
            }
            d.set_document(model);
        }
        let file = out.join(format!("{name}.hwpx"));
        fs::write(&file, d.export_hwpx_native().unwrap()).unwrap();
        rows.push(json!({"case":name,"path":file,"targets":[{"section":0,"para":0,"control":2}],
            "actions":[{"section":0,"para":0,"control":2,"notePara":note_para,"text":"TEXT_한글😀 ".repeat(if name.ends_with("short") {0} else if name.ends_with("long") {480} else {160})}],"expectedPages":null}));
    }
    fs::write(
        out.join("manifest-unpinned.json"),
        serde_json::to_vec_pretty(&rows).unwrap(),
    )
    .unwrap();
}
fn main() {
    let a: Vec<_> = std::env::args().skip(1).collect();
    if a[0] == "seed" {
        seed(Path::new(&a[1]), Path::new(&a[2]));
        return;
    }
    let fspec: Vec<Value> = serde_json::from_slice(&fs::read(&a[0]).unwrap()).unwrap();
    let out = Path::new(&a[1]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    for f in fspec {
        let name = f["case"].as_str().unwrap();
        let mut d =
            DocumentCore::from_bytes(&fs::read(f["path"].as_str().unwrap()).unwrap()).unwrap();
        rows.push(json!({"case":name,"stage":"before","result":checkpoint(&d,out,&format!("{name}-before"))}));
        let initial = d.save_snapshot_native();
        for t in f["actions"].as_array().unwrap() {
            d.insert_text_in_footnote_native(
                0,
                0,
                2,
                t["notePara"].as_u64().unwrap() as usize,
                0,
                t["text"].as_str().unwrap(),
            )
            .unwrap();
        }
        rows.push(json!({"case":name,"stage":"grown","result":checkpoint(&d,out,&format!("{name}-grown"))}));
        let grown = d.save_snapshot_native();
        for (stage, snapshot) in [("undo", initial), ("redo", grown)] {
            d.restore_snapshot_native(snapshot).unwrap();
            rows.push(json!({"case":name,"stage":stage,"result":checkpoint(&d,out,&format!("{name}-{stage}"))}));
        }
        d.discard_snapshot_native(initial);
        d.discard_snapshot_native(grown);
    }
    fs::write(
        out.join("raw.json"),
        serde_json::to_vec(&json!({"GUIVerified":false,"rows":rows})).unwrap(),
    )
    .unwrap();
    println!("candidate observations={}", rows.len());
}
