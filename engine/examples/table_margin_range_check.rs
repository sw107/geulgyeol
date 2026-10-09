//! Atomic signed table-margin validation, standalone Native regression.
use rhwp::{model::control::Control, wasm_api::HwpDocument};
use serde_json::{json, Value};
fn svg(d: &mut HwpDocument) -> Vec<String> {
    (0..d.page_count())
        .map(|p| d.render_page_svg_native(p).unwrap())
        .collect()
}
fn target(d: &HwpDocument) -> (usize, usize) {
    d.document().sections[0]
        .paragraphs
        .iter()
        .enumerate()
        .find_map(|(p, para)| {
            para.controls
                .iter()
                .position(|c| matches!(c, Control::Table(_)))
                .map(|c| (p, c))
        })
        .unwrap()
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    std::fs::create_dir_all(&args[1]).unwrap();
    let seed = HwpDocument::from_bytes(&std::fs::read(&args[0]).unwrap()).unwrap();
    let fields = [
        "outerLeft",
        "outerRight",
        "outerTop",
        "outerBottom",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "cellSpacing",
        "captionSpacing",
    ];
    let invalid = [
        json!(32768),
        json!(-32769),
        json!(34016),
        json!(2147483648_i64),
        json!(1.5),
        Value::Null,
        json!("32767"),
        json!(true),
    ];
    let mut rejected = 0;
    let mut valid = 0;
    let mut reopens = 0;
    for origin in ["hwp", "hwpx"] {
        let bytes = if origin == "hwp" {
            seed.export_hwp_with_adapter_snapshot().unwrap()
        } else {
            seed.export_hwpx_native().unwrap()
        };
        for key in fields {
            for value in &invalid {
                let mut d = HwpDocument::from_bytes(&bytes).unwrap();
                d.set_clip_enabled(false);
                let (pi, ci) = target(&d);
                let before_svg = svg(&mut d);
                let before = format!("{:?}", d.document());
                let before_hwp = d.export_hwp_with_adapter_snapshot().unwrap();
                let before_hwpx = d.export_hwpx_native().unwrap();
                let mut patch = json!({"cellSpacing":13,"treatAsChar":true,"outerLeft":850,"hasCaption":true,"horzOffset":1200});
                patch[key] = value.clone();
                assert!(
                    d.set_table_properties_native(0, pi, ci, &patch.to_string())
                        .is_err(),
                    "{key}: {value}"
                );
                assert_eq!(
                    format!("{:?}", d.document()),
                    before,
                    "entire typed document/raw/cache unchanged"
                );
                assert_eq!(svg(&mut d), before_svg);
                assert_eq!(d.export_hwp_with_adapter_snapshot().unwrap(), before_hwp);
                assert_eq!(d.export_hwpx_native().unwrap(), before_hwpx);
                rejected += 1;
            }
        }
        for &key in &fields[..4] {
            for value in [-32768_i16, -32767, 0, 32766, 32767] {
                let mut d = HwpDocument::from_bytes(&bytes).unwrap();
                d.set_clip_enabled(false);
                let (pi, ci) = target(&d);
                let patch = json!({key:value});
                d.set_table_properties_native(0, pi, ci, &patch.to_string())
                    .unwrap();
                let props: Value =
                    serde_json::from_str(&d.get_table_properties(0, pi as u32, ci as u32).unwrap())
                        .unwrap();
                assert_eq!(props[key], json!(value));
                for bytes in [
                    d.export_hwp_with_adapter_snapshot().unwrap(),
                    d.export_hwpx_native().unwrap(),
                ] {
                    let r = HwpDocument::from_bytes(&bytes).unwrap();
                    let (rpi, rci) = target(&r);
                    let p: Value = serde_json::from_str(
                        &r.get_table_properties(0, rpi as u32, rci as u32).unwrap(),
                    )
                    .unwrap();
                    assert_eq!(p[key], json!(value));
                    reopens += 1;
                }
                valid += 1;
            }
        }
    }
    std::fs::write(format!("{}/proof.json",args[1]),serde_json::to_vec_pretty(&json!({"atomicRejections":rejected,"validBoundaries":valid,"savedReopens":reopens,"wholeDocumentRawSVGAndBytesUnchanged":true})).unwrap()).unwrap();
    println!("PASS {rejected} atomic rejections/{valid} boundaries/{reopens} reopens");
}
