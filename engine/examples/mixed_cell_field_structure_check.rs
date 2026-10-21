//! Public-factory regression for ClickHere and Hyperlink in one table paragraph.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
use std::path::Path;

fn paras(d: &DocumentCore, parent: usize, ci: usize) -> &[Paragraph] {
    let Control::Table(t) = &d.document().sections[0].paragraphs[parent].controls[ci] else {
        panic!()
    };
    &t.cells[0].paragraphs
}
fn view(d: &DocumentCore, parent: usize, ci: usize) -> Value {
    json!({"paras":paras(d,parent,ci).iter().map(|p|json!({"text":p.text,"offsets":p.char_offsets,"count":p.char_count,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "style":p.style_id,"para":p.para_shape_id,"ranges":p.field_ranges,"positions":p.control_text_positions()})).collect::<Vec<_>>(),
        "fields":serde_json::from_str::<Value>(&d.get_field_list_json()).unwrap()})
}
fn fixture(link_first: bool, value: &str) -> (DocumentCore, usize, usize, u32) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    let t: Value = serde_json::from_str(&d.create_table_native(0, 0, 0, 1, 2).unwrap()).unwrap();
    let parent = t["paraIdx"].as_u64().unwrap() as usize;
    let ci = t["controlIdx"].as_u64().unwrap() as usize;
    let path = [(ci, 0, 0)];
    d.insert_text_in_cell_native(0, parent, ci, 0, 0, 0, "앞 A 중 B 끝🙂")
        .unwrap();
    d.insert_text_in_cell_native(0, parent, ci, 1, 0, 0, "옆 셀 보존")
        .unwrap();
    let at = if link_first { 6 } else { 2 };
    let r: Value = serde_json::from_str(
        &d.insert_click_here_field_at_in_cell(
            0, parent, ci, 0, 0, at, false, "안내", "메모", "입력", true,
        )
        .unwrap(),
    )
    .unwrap();
    let id = r["fieldId"].as_u64().unwrap() as u32;
    d.set_field_value_by_id(id, value).unwrap();
    let marker = if link_first { 'A' } else { 'B' };
    let at = paras(&d, parent, ci)[0]
        .text
        .chars()
        .position(|c| c == marker)
        .unwrap();
    d.insert_cell_hyperlink_by_path(
        0,
        parent,
        &path,
        at,
        at + 1,
        "https://example.invalid/qa",
        "",
    )
    .unwrap();
    d.apply_char_format_in_cell_by_path(0, parent, &path, 0, 1, r#"{"italic":true}"#)
        .unwrap();
    let len = paras(&d, parent, ci)[0].text.chars().count();
    d.apply_char_format_in_cell_by_path(0, parent, &path, len - 1, len, r#"{"bold":true}"#)
        .unwrap();
    (d, parent, ci, id)
}
fn checkpoint(d: &mut DocumentCore, parent: usize, ci: usize, id: u32, out: &Path, label: &str) {
    for p in paras(d, parent, ci) {
        let expected =
            p.text.encode_utf16().count() + 8 * (p.controls.len() + p.field_ranges.len()) + 1;
        assert_eq!(p.char_count as usize, expected, "paired field axis {label}");
    }
    let before = view(d, parent, ci);
    let snapshot = d.save_snapshot_native();
    d.set_field_value_by_id(id, "새🙂값").unwrap();
    d.restore_snapshot_native(snapshot).unwrap();
    assert_eq!(view(d, parent, ci), before, "snapshot {label}");
    for (ext, bytes) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        std::fs::write(out.join(format!("{label}.{ext}")), &bytes).unwrap();
        let mut r = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(view(&r, parent, ci), before, "reopen {label} {ext}");
        r.set_field_value_by_id(id, "재열기🙂").unwrap();
    }
}
fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).expect("output"));
    std::fs::create_dir_all(&out).unwrap();
    let mut rows = Vec::new();
    for link_first in [false, true] {
        for value in ["", "값", "🙂𐐀"] {
            let (seed, parent, ci, id) = fixture(link_first, value);
            let bytes = seed.export_hwpx_native().unwrap();
            let p = &paras(&seed, parent, ci)[0];
            // Diagnostic of the unchanged low-level fallback: it omits both end slots.
            let mut fallback = p.clone();
            fallback.split_at(p.text.chars().count());
            assert_eq!(p.char_count - fallback.char_count, 16);
            let mut offsets = vec![0, p.text.chars().count()];
            for f in &p.field_ranges {
                offsets.extend([f.start_char_idx, f.end_char_idx]);
            }
            offsets.sort();
            offsets.dedup();
            for flat in [true, false] {
                for &at in &offsets {
                    let name = format!(
                        "linkfirst{link_first}-v{}-flat{flat}-s{at}",
                        value.chars().count()
                    );
                    let file = out.join(format!("{name}-seed.hwpx"));
                    std::fs::write(&file, &bytes).unwrap();
                    let mut d = DocumentCore::from_bytes(&bytes).unwrap();
                    let initial = view(&d, parent, ci);
                    checkpoint(&mut d, parent, ci, id, &out, &format!("{name}-before"));
                    if flat {
                        d.split_paragraph_in_cell_native(0, parent, ci, 0, 0, at, None)
                            .unwrap();
                    } else {
                        d.split_paragraph_in_cell_by_path(0, parent, &[(ci, 0, 0)], at, None)
                            .unwrap();
                    }
                    checkpoint(&mut d, parent, ci, id, &out, &format!("{name}-split"));
                    if flat {
                        d.merge_paragraph_in_cell_native(0, parent, ci, 0, 1)
                            .unwrap();
                    } else {
                        d.merge_paragraph_in_cell_by_path(0, parent, &[(ci, 0, 1)])
                            .unwrap();
                    }
                    assert_eq!(view(&d, parent, ci), initial, "split/merge {name}");
                    checkpoint(&mut d, parent, ci, id, &out, &format!("{name}-merge"));
                    rows.push(json!({"name":name,"file":file,"parent":parent,"path":[{"controlIndex":ci,"cellIndex":0,"cellParaIndex":0}],"id":id,"at":at,"flat":flat}));
                }
            }
        }
    }
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(&rows).unwrap(),
    )
    .unwrap();
    println!("{} mixed-field Native cases passed", rows.len());
}
