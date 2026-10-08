//! Declared table sizes and raw/common preservation, independent of missing lib fixtures.
use rhwp::model::control::Control;
use rhwp::wasm_api::HwpDocument;
use serde_json::{json, Value};
use std::path::Path;

fn target(d: &HwpDocument) -> (usize, usize) {
    for (p, para) in d.document().sections[0].paragraphs.iter().enumerate() {
        for (c, ctrl) in para.controls.iter().enumerate() {
            if matches!(ctrl, Control::Table(_)) {
                return (p, c);
            }
        }
    }
    panic!("fixture table missing");
}
fn size(d: &HwpDocument) -> Value {
    let (p, c) = target(d);
    let v: Value =
        serde_json::from_str(&d.get_table_properties(0, p as u32, c as u32).unwrap()).unwrap();
    json!([v["tableWidth"], v["tableHeight"]])
}
fn cells(d: &HwpDocument) -> Value {
    let (p, c) = target(d);
    let Control::Table(t) = &d.document().sections[0].paragraphs[p].controls[c] else {
        unreachable!()
    };
    json!(t
        .cells
        .iter()
        .map(|c| vec![c.width, c.height])
        .collect::<Vec<_>>())
}
fn save(d: &HwpDocument, format: &str) -> Vec<u8> {
    let report = if format == "hwp" {
        d.export_hwp_with_adapter_snapshot_with_report()
    } else {
        d.export_hwpx_native_with_report()
    }
    .unwrap();
    assert!(report.content_loss().is_empty());
    report.into_bytes()
}
fn self_check() {
    let mut d = HwpDocument::create_empty();
    d.create_blank_document_native().unwrap();
    d.create_table_ex_native(0, 0, 0, 1, 1, true, Some(&[14400]), Some(&[3600]))
        .unwrap();
    let (p, c) = target(&d);
    for declared in [(14400, 3600), (0, 3600), (14400, 0), (0, 0)] {
        {
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c]
            else {
                unreachable!()
            };
            t.raw_ctrl_data.clear();
            t.common.width = declared.0;
            t.common.height = declared.1;
        }
        let before = format!("{:?}", d.document());
        assert_eq!(size(&d), json!([declared.0, declared.1]));
        assert_eq!(
            format!("{:?}", d.document()),
            before,
            "query must not mutate automatic/declared size"
        );
        for format in ["hwp", "hwpx"] {
            let reopened = HwpDocument::from_bytes(&save(&d, format)).unwrap();
            assert_eq!(
                size(&reopened),
                json!([declared.0, declared.1]),
                "zero must not become cell aggregate"
            );
            assert_eq!(cells(&reopened), json!([[14400, 3600]]));
        }
    }
    // An available HWP raw field retains precedence, including an explicit zero.
    {
        let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c] else {
            unreachable!()
        };
        t.common.width = 14400;
        t.common.height = 3600;
        t.raw_ctrl_data = vec![0; 16];
    }
    assert_eq!(
        size(&d),
        json!([0, 3600]),
        "partial raw header: width available, height from common"
    );
    {
        let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c] else {
            unreachable!()
        };
        t.raw_ctrl_data.clear();
    }
    let before = d.save_snapshot_native();
    d.set_cell_properties_native(0, p, c, 0, r#"{"width":18000,"height":7200}"#)
        .unwrap();
    let after = d.save_snapshot_native();
    assert_eq!(size(&d), json!([18000, 7200]));
    d.restore_snapshot_native(before).unwrap();
    assert_eq!(size(&d), json!([14400, 3600]));
    d.restore_snapshot_native(after).unwrap();
    assert_eq!(size(&d), json!([18000, 7200]));
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    self_check();
    if args.len() < 2 {
        println!("PASS declared/automatic/raw precedence/query mutation/explicit resize/undo redo");
        return;
    }
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut diagnostics = Vec::new();
    let mut reopens = 0;
    for row in &rows {
        let mut d = HwpDocument::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        if let Some(enabled) = row["clipEnabled"].as_bool() {
            d.set_clip_enabled(enabled);
        }
        assert_eq!(size(&d), row["size"]);
        assert_eq!(cells(&d), row["cells"]);
        let svg: Vec<_> = (0..d.page_count())
            .map(|p| d.render_page_svg_native(p).unwrap())
            .collect();
        assert_eq!(
            json!(svg),
            row["svg"],
            "same-byte standalone WASM/Native SVG"
        );
        let model = format!("{:?}", d.document());
        let (p, c) = target(&d);
        let Control::Table(t) = &d.document().sections[0].paragraphs[p].controls[c] else {
            unreachable!()
        };
        diagnostics.push(json!({
            "file": row["file"], "getter": size(&d),
            "commonSize": [t.common.width, t.common.height], "rawBytes": t.raw_ctrl_data.len(),
            "widthCriterion": format!("{:?}", t.common.width_criterion),
            "heightCriterion": format!("{:?}", t.common.height_criterion),
            "baseColumns": t.base_grid_column_widths(), "rawRows": t.get_raw_row_heights(),
            "cells": t.cells.iter().map(|c|json!({"row":c.row,"col":c.col,"rowSpan":c.row_span,"colSpan":c.col_span,"width":c.width,"height":c.height})).collect::<Vec<_>>()
        }));
        for format in ["hwp", "hwpx"] {
            let reopened = HwpDocument::from_bytes(&save(&d, format)).unwrap();
            assert_eq!(size(&reopened), row["size"]);
            assert_eq!(cells(&reopened), row["cells"]);
            reopens += 1;
        }
        assert_eq!(
            format!("{:?}", d.document()),
            model,
            "query/save does not change source"
        );
    }
    std::fs::write(
        out.join("models.json"),
        serde_json::to_vec_pretty(&diagnostics).unwrap(),
    )
    .unwrap();
    let proof = json!({"sameByteWasmNativeFiles":rows.len(),"nativeTwoFormatResaves":reopens,"declaredAndAutomaticSizesPreserved":true,"queryAndSaveNoMutation":true,"nativeExplicitResizeUndoRedo":true});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
