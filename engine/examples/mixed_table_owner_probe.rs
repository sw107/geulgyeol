//! Synthetic mixed-rowspan source owners and per-page visible text ledger.
//! Usage: mixed_table_owner_probe INPUT_HWP_OR_HWPX FRESH_OUTPUT_DIR
use rhwp::{model::control::Control, wasm_api::HwpDocument};
use serde_json::{json, Value};
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(args.len(), 2);
    assert!(!std::path::Path::new(&args[1]).exists());
    std::fs::create_dir_all(&args[1]).unwrap();
    let mut d = HwpDocument::from_bytes(&std::fs::read(&args[0]).unwrap()).unwrap();
    d.set_clip_enabled(false);
    let (p, c, table) = d.document().sections[0].paragraphs.iter().enumerate().find_map(|(p, para)| {
        para.controls.iter().enumerate().find_map(|(c, control)| match control {
            Control::Table(table) => Some((p, c, table.as_ref())), _ => None,
        })
    }).unwrap();
    let owners: Vec<_> = table.cells.iter().enumerate().map(|(i, cell)| json!({
        "cell": i, "rowStart": cell.row, "rowEnd": cell.row as usize + cell.row_span as usize,
        "colStart": cell.col, "colEnd": cell.col as usize + cell.col_span as usize,
        "header": cell.is_header, "paragraphs": cell.paragraphs.iter().map(|p| p.text.clone()).collect::<Vec<_>>()
    })).collect();
    let mut pages = Vec::new();
    for page in 0..d.page_count() {
        let text: Value = serde_json::from_str(&d.get_page_text_layout_native(page).unwrap()).unwrap();
        let controls: Value = serde_json::from_str(&d.get_page_control_layout_native(page).unwrap()).unwrap();
        let info: Value = serde_json::from_str(&d.get_page_info_native(page).unwrap()).unwrap();
        std::fs::write(format!("{}/page-{page}.svg", args[1]), d.render_page_svg_native(page).unwrap()).unwrap();
        pages.push(json!({"page": page, "text": text, "controls": controls, "info": info}));
    }
    let result = json!({"target": {"para": p, "control": c}, "rows": table.row_count, "cols": table.col_count,
        "owners": owners, "pages": pages});
    std::fs::write(format!("{}/ledger.json", args[1]), serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    println!("{}", json!({"pages": d.page_count(), "cells": table.cells.len()}));
}
