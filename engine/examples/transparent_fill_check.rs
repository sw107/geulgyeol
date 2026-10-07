//! Native oracle and targeted API checks without unavailable lib fixtures.
use rhwp::model::{
    control::Control,
    style::{Fill, FillType, SolidFill},
};
use rhwp::wasm_api::HwpDocument;
use serde_json::{json, Value};
use std::path::Path;

fn parsed(s: String) -> Value {
    serde_json::from_str(&s).unwrap()
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
fn fill_props(p: &Value, kind: &str) -> Value {
    if kind == "template" {
        return json!({"char":fill_props(&p["char"],"cell"),"para":fill_props(&p["para"],"cell")});
    }
    if kind == "shape" {
        if p["fillType"] == "solid" {
            return json!({"fillType":p["fillType"],"fillBgColor":p["fillBgColor"],"fillPatColor":p["fillPatColor"],"fillPatType":p["fillPatType"]});
        }
        return json!({"fillType":p["fillType"]});
    }
    json!({"fillType":p["fillType"],"fillColor":p["fillColor"],"patternColor":p["patternColor"],"patternType":p["patternType"]})
}
fn query(d: &HwpDocument, kind: &str, p: usize, c: usize) -> Value {
    let props = match kind {
        "template" => {
            json!({"char":parsed(d.get_char_properties_at_native(0,0,0).unwrap()),"para":parsed(d.get_para_properties_at_native(0,0).unwrap())})
        }
        "cell" => parsed(d.get_cell_properties(0, p as u32, c as u32, 0).unwrap()),
        "table" => parsed(d.get_table_properties(0,p as u32,c as u32).unwrap()),
        "shape" => parsed(d.get_shape_properties_native(0, p, c).unwrap()),
        _ => panic!("unsupported test kind"),
    };
    fill_props(&props, kind)
}
fn raw_brushes(d: &HwpDocument) -> Value {
    fn capture(fill: &Fill) -> Value {
        json!({"solid":fill.solid,"alpha":fill.alpha})
    }
    let border: Vec<_> = d
        .document()
        .doc_info
        .border_fills
        .iter()
        .map(|b| capture(&b.fill))
        .collect();
    let shape: Vec<_> = d
        .document()
        .sections
        .iter()
        .flat_map(|s| &s.paragraphs)
        .flat_map(|p| &p.controls)
        .filter_map(|c| {
            if let Control::Shape(s) = c {
                s.drawing().map(|d| capture(&d.fill))
            } else {
                None
            }
        })
        .collect();
    json!({"border":border,"shape":shape})
}
fn self_check() {
    // Partial cell fills must retain both referenced and sentinel-zero borders.
    for id in [2, 0] {
        let mut t = HwpDocument::create_empty();
        t.create_blank_document_native().unwrap();
        let created = parsed(t.create_table_native(0, 0, 0, 1, 1).unwrap());
        let p = created["paraIdx"].as_u64().unwrap() as usize;
        let c = created["controlIdx"].as_u64().unwrap() as usize;
        let ids = json!({"cells":[{"cellIdx":0,"id":id}],"zones":[]}).to_string();
        if id == 0 {
            let original = format!("{:?}",t.document());
            assert!(t.apply_cell_border_fill_ids_native(0,p,c,&ids).is_err());
            assert_eq!(original,format!("{:?}",t.document()));
            // The property/serialized model supports the no-border sentinel;
            // the undo ID API deliberately accepts only actual resource IDs.
            t.set_cell_properties_native(0,p,c,0,r#"{"borderFillId":0}"#).unwrap();
            t=HwpDocument::from_bytes(&save(&t,"hwp")).unwrap();
        } else {
            t.apply_cell_border_fill_ids_native(0,p,c,&ids).unwrap();
        }
        let mut before = parsed(t.get_cell_properties(0, p as u32, c as u32, 0).unwrap());
        let svg = t.render_page_svg_native(0).unwrap();
        t.set_cell_properties_native(0, p, c, 0, r#"{"fillType":"none"}"#)
            .unwrap();
        let mut after = parsed(t.get_cell_properties(0, p as u32, c as u32, 0).unwrap());
        before.as_object_mut().unwrap().remove("borderFillId");
        after.as_object_mut().unwrap().remove("borderFillId");
        assert_eq!(before, after);
        assert_eq!(svg, t.render_page_svg_native(0).unwrap());
    }
    let transparent = Fill {
        fill_type: FillType::Solid,
        solid: Some(SolidFill {
            background_color: u32::MAX,
            pattern_color: 0x999999,
            pattern_type: -1,
        }),
        alpha: 97,
        ..Default::default()
    };
    assert_eq!(transparent.effective_type(), FillType::None);
    let mut patterned = transparent.clone();
    patterned.solid.as_mut().unwrap().pattern_type = 1;
    assert_eq!(patterned.effective_type(), FillType::Solid);
    let mut white = transparent.clone();
    white.solid.as_mut().unwrap().background_color = 0x00ffffff;
    assert_eq!(white.effective_type(), FillType::Solid);
    let mut d = HwpDocument::create_empty();
    d.create_blank_document_native().unwrap();
    let before = format!("{:?}", d.document());
    assert_eq!(query(&d, "template", 0, 0)["char"]["fillType"], "none");
    assert_eq!(query(&d, "template", 0, 0)["para"]["fillType"], "none");
    assert_eq!(
        before,
        format!("{:?}", d.document()),
        "getters must not alter raw model"
    );
    let created = parsed(
        d.create_shape_control_native(
            0,
            0,
            0,
            7200,
            7200,
            0,
            0,
            true,
            "Square",
            "rectangle",
            false,
            false,
            &[],
        )
        .unwrap(),
    );
    let p = created["paraIdx"].as_u64().unwrap() as usize;
    let c = created["controlIdx"].as_u64().unwrap() as usize;
    d.set_shape_properties_native(
        0,
        p,
        c,
        r#"{"fillType":"solid","fillBgColor":-1,"fillPatColor":10066329,"fillPatType":-1}"#,
    )
    .unwrap();
    assert_eq!(query(&d, "shape", p, c)["fillType"], "none");
    let undo = d.save_snapshot_native();
    d.set_shape_properties_native(
        0,
        p,
        c,
        r#"{"fillType":"solid","fillBgColor":16777215,"fillPatColor":0,"fillPatType":-1}"#,
    )
    .unwrap();
    assert_eq!(query(&d, "shape", p, c)["fillType"], "solid");
    let redo = d.save_snapshot_native();
    d.restore_snapshot_native(undo).unwrap();
    assert_eq!(query(&d, "shape", p, c)["fillType"], "none");
    d.restore_snapshot_native(redo).unwrap();
    assert_eq!(query(&d, "shape", p, c)["fillType"], "solid");
    // Stale hidden controls must not reinstate paint alongside explicit none.
    d.set_shape_properties_native(
        0,
        p,
        c,
        r#"{"fillType":"none","fillBgColor":16777215,"fillPatType":1,"gradientType":1}"#,
    )
    .unwrap();
    let Control::Shape(shape) = &d.document().sections[0].paragraphs[p].controls[c] else {
        panic!("shape missing")
    };
    let fill = &shape.drawing().unwrap().fill;
    assert_eq!(fill.fill_type, FillType::None);
    assert!(fill.solid.is_none() && fill.gradient.is_none() && fill.image.is_none());
    for first in ["hwp", "hwpx"] {
        let one = HwpDocument::from_bytes(&save(&d, first)).unwrap();
        assert_eq!(query(&one, "shape", p, c)["fillType"], "none");
        for second in ["hwp", "hwpx"] {
            let two = HwpDocument::from_bytes(&save(&one, second)).unwrap();
            assert_eq!(query(&two, "shape", p, c)["fillType"], "none");
        }
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    self_check();
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut resaves = 0;
    let mut diagnostics = Vec::new();
    for row in &rows {
        let d = HwpDocument::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        let kind = row["kind"].as_str().unwrap();
        let p = row["context"]["paraIdx"].as_u64().unwrap() as usize;
        let c = row["context"]["controlIdx"].as_u64().unwrap() as usize;
        assert_eq!(query(&d, kind, p, c), row["fill"], "{}", row["file"]);
        let svg: Vec<_> = (0..d.page_count())
            .map(|p| d.render_page_svg_native(p).unwrap())
            .collect();
        assert_eq!(
            json!(svg),
            row["svg"],
            "full same-byte Native/WASM SVG {}",
            row["file"]
        );
        let payload = raw_brushes(&d);
        let model = format!("{:?}", d.document());
        for format in ["hwp", "hwpx"] {
            let next = HwpDocument::from_bytes(&save(&d, format)).unwrap();
            assert_eq!(query(&next, kind, p, c), row["fill"]);
            assert_eq!(
                raw_brushes(&next),
                payload,
                "dormant brush payload {format} {}",
                row["file"]
            );
            resaves += 1;
        }
        assert_eq!(
            format!("{:?}", d.document()),
            model,
            "save must not mutate source model"
        );
        let border_models: Vec<_> = d
            .document()
            .doc_info
            .border_fills
            .iter()
            .map(|b| &b.fill)
            .collect();
        let shape_models: Vec<_> = d
            .document()
            .sections
            .iter()
            .flat_map(|s| &s.paragraphs)
            .flat_map(|p| &p.controls)
            .filter_map(|c| {
                if let Control::Shape(s) = c {
                    s.drawing().map(|d| &d.fill)
                } else {
                    None
                }
            })
            .collect();
        diagnostics.push(json!({"file":row["file"],"rawBrushes":payload,"borderStoredModels":border_models,"shapeStoredModels":shape_models}));
    }
    std::fs::write(
        out.join("raw-brushes.json"),
        serde_json::to_vec_pretty(&diagnostics).unwrap(),
    )
    .unwrap();
    let proof = json!({"sameByteFullSVGAndFillGettersExact":rows.len(),"nativeTwoFormatResaves":resaves,"dormantSolidPayloadAndAlphaExact":true,"getterAndSaveNoMutation":true,"explicitNoneClearsStaleSolidGradientImage":true,"nativeUndoRedo":true,"patternedSentinelAndRealWhiteRemainSolid":true});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
#[test]
fn fill_semantics_and_explicit_clear_preserve_snapshots() {
    self_check();
}
