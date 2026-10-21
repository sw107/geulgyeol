//! Synthetic paired ClickHere regression; no external document fixtures.
#[path = "common/nested_cells.rs"]
mod nested_cells;
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
use std::path::Path;
fn paras<'a>(
    d: &'a DocumentCore,
    parent: usize,
    path: &[(usize, usize, usize)],
) -> &'a [Paragraph] {
    let mut p = &d.document().sections[0].paragraphs[parent];
    for (i, &(ci, cell, pi)) in path.iter().enumerate() {
        let Control::Table(t) = &p.controls[ci] else {
            panic!()
        };
        if i + 1 == path.len() {
            return &t.cells[cell].paragraphs;
        }
        p = &t.cells[cell].paragraphs[pi];
    }
    panic!()
}
fn view(d: &DocumentCore, parent: usize, path: &[(usize, usize, usize)]) -> Value {
    json!({"paras":paras(d,parent,path).iter().map(|p|json!({"text":p.text,"offsets":p.char_offsets,"count":p.char_count,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "style":p.style_id,"para":p.para_shape_id,"ranges":p.field_ranges,"positions":p.control_text_positions()})).collect::<Vec<_>>(),
        "fields":serde_json::from_str::<Value>(&d.get_field_list_json()).unwrap()})
}
fn fixture(depth: usize, value: &str) -> (DocumentCore, usize, Vec<(usize, usize, usize)>, u32) {
    let (mut d, parent, path) = nested_cells::fixture(depth, false);
    let template = paras(&d, parent, &path)[0].clone();
    let leaf = nested_cells::table_mut(&mut d.document_mut().sections[0].paragraphs[parent], &path);
    leaf.cells[path.last().unwrap().1].paragraphs = vec![Paragraph::new_empty_like(&template)];
    let doc = d.document().clone();
    d.set_document(doc);
    d.insert_text_in_cell_by_path(0, parent, &path, 0, "앞\t뒤🙂끝")
        .unwrap();
    let r: Value = serde_json::from_str(
        &d.insert_click_here_field_at_by_path(0, parent, &path, 2, "안내🙂", "메모", "필드", true)
            .unwrap(),
    )
    .unwrap();
    let id = r["fieldId"].as_u64().unwrap() as u32;
    d.set_field_value_by_id(id, value).unwrap();
    d.apply_char_format_in_cell_by_path(0, parent, &path, 0, 1, r#"{"italic":true}"#)
        .unwrap();
    let len = paras(&d, parent, &path)[0].text.chars().count();
    d.apply_char_format_in_cell_by_path(0, parent, &path, len - 1, len, r#"{"bold":true}"#)
        .unwrap();
    (d, parent, path, id)
}
fn split(
    d: &mut DocumentCore,
    parent: usize,
    path: &[(usize, usize, usize)],
    at: usize,
    flat: bool,
) {
    if flat {
        let (ci, cell, pi) = path[0];
        d.split_paragraph_in_cell_native(0, parent, ci, cell, pi, at, None)
            .unwrap();
    } else {
        d.split_paragraph_in_cell_by_path(0, parent, path, at, None)
            .unwrap();
    }
}
fn merge(d: &mut DocumentCore, parent: usize, path: &[(usize, usize, usize)], flat: bool) {
    if flat {
        let (ci, cell, _) = path[0];
        d.merge_paragraph_in_cell_native(0, parent, ci, cell, 1)
            .unwrap();
    } else {
        let mut p = path.to_vec();
        p.last_mut().unwrap().2 = 1;
        d.merge_paragraph_in_cell_by_path(0, parent, &p).unwrap();
    }
}
fn checkpoint(
    d: &mut DocumentCore,
    parent: usize,
    path: &[(usize, usize, usize)],
    id: u32,
    out: &Path,
    label: &str,
) {
    let before = view(d, parent, path);
    let snapshot = d.save_snapshot_native();
    d.set_field_value_by_id(id, "새🙂값").unwrap();
    d.restore_snapshot_native(snapshot).unwrap();
    assert_eq!(view(d, parent, path), before, "snapshot restore {label}");
    for (ext, bytes) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        std::fs::write(out.join(format!("{label}.{ext}")), &bytes).unwrap();
        let mut r = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(view(&r, parent, path), before, "reopen {label} {ext}");
        r.set_field_value_by_id(id, "재열기🙂").unwrap();
    }
}
fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).expect("output"));
    std::fs::create_dir_all(&out).unwrap();
    let mut rows = Vec::new();
    for depth in 1..=3 {
        for flat in [true, false] {
            if flat && depth > 1 {
                continue;
            }
            for value in ["", "값", "🙂𐐀"] {
                let (seed, parent, path, id) = fixture(depth, value);
                let len = paras(&seed, parent, &path)[0].text.chars().count();
                let mut offsets = vec![0, 1, 2, 2 + value.chars().count(), len];
                offsets.sort();
                offsets.dedup();
                for at in offsets {
                    let name = format!(
                        "d{depth}-{}-v{}-s{at}",
                        if flat { "flat" } else { "path" },
                        value.chars().count()
                    );
                    let seed_bytes = seed.export_hwpx_native().unwrap();
                    let input = out.join(format!("{name}-seed.hwpx"));
                    std::fs::write(&input, &seed_bytes).unwrap();
                    let mut d = DocumentCore::from_bytes(&seed_bytes).unwrap();
                    let before = view(&d, parent, &path);
                    checkpoint(&mut d, parent, &path, id, &out, &format!("{name}-before"));
                    split(&mut d, parent, &path, at, flat);
                    checkpoint(&mut d, parent, &path, id, &out, &format!("{name}-split"));
                    merge(&mut d, parent, &path, flat);
                    assert_eq!(
                        view(&d, parent, &path),
                        before,
                        "split/merge preserves {name}"
                    );
                    checkpoint(&mut d, parent, &path, id, &out, &format!("{name}-merge"));
                    rows.push(json!({"name":name,"file":input,"parent":parent,"path":path.iter().map(|&(ci,c,pi)|json!({"controlIndex":ci,"cellIndex":c,"cellParaIndex":pi})).collect::<Vec<_>>(),"id":id,"at":at,"flat":flat}));
                }
            }
        }
    }
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(&rows).unwrap(),
    )
    .unwrap();
    println!(
        "{} synthetic Native cases: split/merge, value edits, snapshots and HWP/HWPX reopen passed",
        rows.len()
    );
}
