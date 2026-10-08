//! Diagnostic only: paragraph border != a paragraph-relative rectangle object.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        shape::{ShapeObject, SizeCriterion},
    },
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::path::Path;
fn shape(d: &DocumentCore, ci: usize) -> &ShapeObject {
    match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Shape(s) => s,
        _ => panic!("expected rectangle"),
    }
}
fn semantic(d: &DocumentCore) -> Value {
    json!(d.document().sections[0]
        .paragraphs
        .iter()
        .map(|p| json!({
            "text":p.text,"style":p.style_id,"chars":p.char_shapes,
            "fields":format!("{:?}",p.controls),"ranges":p.field_ranges
        }))
        .collect::<Vec<_>>())
}
fn bounds(d: &DocumentCore, ci: usize) -> Value {
    fn find(n: &RenderNode, ci: usize) -> Option<Value> {
        if let RenderNodeType::Rectangle(r) = &n.node_type {
            if r.para_index == Some(0) && r.control_index == Some(ci) {
                return Some(
                    json!({"x":n.bbox.x,"y":n.bbox.y,"width":n.bbox.width,"height":n.bbox.height}),
                );
            }
        }
        n.children.iter().find_map(|n| find(n, ci))
    }
    (0..d.page_count())
        .find_map(|p| find(&d.build_page_render_tree(p).unwrap().root, ci))
        .unwrap()
}
fn save(d: &DocumentCore, out: &Path, label: &str, ci: usize) {
    for ext in ["hwp", "hwpx"] {
        let bytes = if ext == "hwp" {
            d.export_hwp_native().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        std::fs::write(out.join(format!("{label}.{ext}")), &bytes).unwrap();
        let back = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(
            shape(&back, ci).common().width_criterion,
            shape(d, ci).common().width_criterion
        );
        assert_eq!(shape(&back, ci).common().width, shape(d, ci).common().width);
        assert_eq!(shape(&back, ci).common().height, 283);
    }
    std::fs::write(
        out.join(format!("{label}.svg")),
        d.render_page_svg_native(0).unwrap(),
    )
    .unwrap();
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    if args[1] == "--verify-wasm" {
        for ext in ["hwp", "hwpx"] {
            let d = DocumentCore::from_bytes(
                &std::fs::read(out.join(format!("wasm-absolute.{ext}"))).unwrap(),
            )
            .unwrap();
            let object = d.document().sections[0].paragraphs[0]
                .controls
                .iter()
                .find_map(|c| {
                    if let Control::Shape(s) = c {
                        Some(s)
                    } else {
                        None
                    }
                })
                .unwrap();
            assert_eq!(object.common().width_criterion, SizeCriterion::Absolute);
            assert_eq!(object.common().width, 10000);
            assert_eq!(object.common().height, 283);
        }
        std::fs::write(
            out.join("native-wasm-proof.json"),
            serde_json::to_vec_pretty(
                &json!({"independentSavedReopens":2,"widthBasisStillAbsolute":true}),
            )
            .unwrap(),
        )
        .unwrap();
        return;
    }
    let bytes = std::fs::read(&args[1]).unwrap();
    let mut border = DocumentCore::from_bytes(&bytes).unwrap();
    let before = semantic(&border);
    border
        .apply_para_format_native(
            0,
            0,
            r##"{"borderBottom":{"type":1,"width":7,"color":"#000000"},"fillType":"none"}"##,
        )
        .unwrap();
    assert_eq!(
        semantic(&border),
        before,
        "border changes no object/field/text/style ownership"
    );
    let border_props: Value =
        serde_json::from_str(&border.get_para_properties_at_native(0, 0).unwrap()).unwrap();
    assert_eq!(border_props["borderBottom"]["type"], 1);
    std::fs::write(
        out.join("paragraph-border.svg"),
        border.render_page_svg_native(0).unwrap(),
    )
    .unwrap();
    let mut d = DocumentCore::from_bytes(&bytes).unwrap();
    let response: Value = serde_json::from_str(
        &d.create_shape_control_native(
            0,
            0,
            0,
            10000,
            283,
            0,
            0,
            false,
            "InFrontOfText",
            "rectangle",
            false,
            false,
            &[],
        )
        .unwrap(),
    )
    .unwrap();
    let ci = response["controlIdx"].as_u64().unwrap() as usize;
    assert_eq!(
        shape(&d, ci).common().width_criterion,
        SizeCriterion::Absolute
    );
    d.set_shape_properties_native(0,0,ci,r#"{"widthRelTo":"Para","widthCriterion":"Para","vertRelTo":"Para","horzRelTo":"Para","fillType":"solid","fillBgColor":0,"lineType":0}"#).unwrap();
    assert_eq!(
        shape(&d, ci).common().width_criterion,
        SizeCriterion::Absolute,
        "unknown width basis ignored by existing API"
    );
    let properties: Value =
        serde_json::from_str(&d.get_shape_properties_native(0, 0, ci).unwrap()).unwrap();
    assert!(properties.get("widthRelTo").is_none() && properties.get("widthCriterion").is_none());
    save(&d, out, "absolute-api", ci);
    // Direct IR assignment attests existing storage capability, not a new public command.
    if let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[0].controls[ci] {
        s.common_mut().width_criterion = SizeCriterion::Para;
    }
    let canonical = d.export_hwpx_native().unwrap();
    let mut relative = DocumentCore::from_bytes(&canonical).unwrap();
    let b0 = bounds(&relative, ci);
    save(&relative, out, "relative-before", ci);
    relative
        .apply_para_format_native(0, 0, r#"{"marginLeft":2000,"marginRight":3000}"#)
        .unwrap();
    let b1 = bounds(&relative, ci);
    save(&relative, out, "relative-margins", ci);
    assert!(
        (b0["width"].as_f64().unwrap() - b1["width"].as_f64().unwrap()).abs() < 0.01,
        "existing Para width uses column width despite paragraph margin change"
    );
    let margins: Value =
        serde_json::from_str(&relative.get_para_properties_at_native(0, 0).unwrap()).unwrap();
    assert!(margins["marginLeft"].as_f64().unwrap() > 10.0);
    assert!(margins["marginRight"].as_f64().unwrap() > 15.0);
    let proof = json!({"diagnosticOnly":true,"productImplementationChanged":false,"paragraphBorderPreservesSemanticReferences":true,"paragraphBorderAddsNoObject":true,"existingShapeApiIgnoresWidthBasis":true,"shapeGetterOmitsWidthBasis":true,"existingIRStoresParaRelativeRectangle":true,"directIRAssignmentIsNotPublicFeature":true,"nativeSavedReopens":6,"beforeBounds":b0,"afterMarginsBounds":b1,"appliedMargins":margins,"paragraphRelativeWidthIgnoresMargins":true,"GUIVerified":false});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
