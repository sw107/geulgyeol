//! Table outMargin owners, raw-field precedence, snapshots and saved reopens.
//! Standalone because unrelated missing include_bytes fixtures block lib tests.
use rhwp::{model::control::Control, wasm_api::HwpDocument};
use serde_json::{json, Value};
use std::path::Path;

const KEYS: [&str; 4] = ["outerLeft", "outerRight", "outerTop", "outerBottom"];
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
fn table(d: &HwpDocument) -> &rhwp::model::table::Table {
    let (p, c) = target(d);
    let Control::Table(t) = &d.document().sections[0].paragraphs[p].controls[c] else {
        unreachable!()
    };
    t
}
fn table_mut(d: &mut HwpDocument) -> &mut rhwp::model::table::Table {
    let (p, c) = target(d);
    let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c] else {
        unreachable!()
    };
    t
}
fn props(d: &HwpDocument) -> Value {
    let (p, c) = target(d);
    serde_json::from_str(&d.get_table_properties(0, p as u32, c as u32).unwrap()).unwrap()
}
fn margins(d: &HwpDocument) -> Vec<i16> {
    let v = props(d);
    KEYS.iter().map(|k| v[k].as_i64().unwrap() as i16).collect()
}
fn owners(d: &HwpDocument) -> Value {
    let t = table(d);
    json!({"typed":[t.outer_margin_left,t.outer_margin_right,t.outer_margin_top,t.outer_margin_bottom],
        "common":[t.common.margin.left,t.common.margin.right,t.common.margin.top,t.common.margin.bottom],
        "rawLength":t.raw_ctrl_data.len()})
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
fn set(d: &mut HwpDocument, side: usize, value: i16) {
    let (p, c) = target(d);
    let mut patch = json!({});
    patch[KEYS[side]] = json!(value);
    d.set_table_properties_native(0, p, c, &patch.to_string())
        .unwrap();
}
fn svg(d: &HwpDocument) -> Vec<String> {
    (0..d.page_count())
        .map(|p| d.render_page_svg_native(p).unwrap())
        .collect()
}
fn protected(d: &HwpDocument) -> Value {
    let mut ps = d.document().sections[0].paragraphs.clone();
    let (p, c) = target(d);
    let Control::Table(t) = &mut ps[p].controls[c] else {
        unreachable!()
    };
    t.outer_margin_left = 0;
    t.outer_margin_right = 0;
    t.outer_margin_top = 0;
    t.outer_margin_bottom = 0;
    t.common.margin = Default::default();
    t.raw_ctrl_data.clear();
    t.dirty = false;
    // Only runtime layout caches are refreshed by the setter.
    fn strip(v: &mut Value) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(strip),
            Value::Object(o) => {
                for k in [
                    "line_segs",
                    "dirty",
                    "hwpx_axis_shift",
                    "layout_only_fill_lines",
                    "single_line_overflow_memo",
                ] {
                    o.remove(k);
                }
                o.values_mut().for_each(strip);
            }
            _ => {}
        }
    }
    let mut v = serde_json::to_value(ps).unwrap();
    strip(&mut v);
    v
}
fn raw_contract(input: &Path) -> usize {
    let seed = HwpDocument::from_bytes(&std::fs::read(input).unwrap()).unwrap();
    let bytes = save(&seed, "hwp");
    let mut checks = 0;
    for length in [0, 24, 25, 26, 27, 28, 29, 30, 31, 32] {
        for side in 0..4 {
            let mut d = HwpDocument::from_bytes(&bytes).unwrap();
            let t = table_mut(&mut d);
            let typed = [13, 0, -283, 32767];
            let raw = [0_i16, -32768, 17, -7];
            t.outer_margin_left = typed[0];
            t.outer_margin_right = typed[1];
            t.outer_margin_top = typed[2];
            t.outer_margin_bottom = typed[3];
            t.common.margin.left = typed[0];
            t.common.margin.right = typed[1];
            t.common.margin.top = typed[2];
            t.common.margin.bottom = typed[3];
            for (i, value) in raw.iter().enumerate() {
                t.raw_ctrl_data[24 + i * 2..26 + i * 2].copy_from_slice(&value.to_le_bytes());
            }
            t.raw_ctrl_data.truncate(length);
            let before = format!("{:?}", d.document());
            let expected: Vec<_> = (0..4)
                .map(|i| {
                    if length >= 26 + i * 2 {
                        raw[i]
                    } else {
                        typed[i]
                    }
                })
                .collect();
            assert_eq!(margins(&d), expected);
            assert_eq!(
                format!("{:?}", d.document()),
                before,
                "read must not mutate"
            );
            let before_raw = table(&d).raw_ctrl_data.clone();
            let value = [-32768, -13, 0, 32767][side];
            set(&mut d, side, value);
            assert_eq!(
                table(&d).raw_ctrl_data.len(),
                length,
                "never grow a raw header"
            );
            let mut expected_raw = before_raw;
            if length >= 26 + side * 2 {
                expected_raw[24 + side * 2..26 + side * 2].copy_from_slice(&value.to_le_bytes());
            }
            assert_eq!(
                table(&d).raw_ctrl_data,
                expected_raw,
                "only available field patched"
            );
            let mut expected = expected;
            expected[side] = value;
            assert_eq!(margins(&d), expected);
            let owner = owners(&d);
            assert_eq!(owner["typed"][side], json!(value));
            assert_eq!(owner["common"][side], json!(value));
            checks += 1;
        }
    }
    checks
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    let seeds: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut rows = vec![];
    let (mut pairs, mut reopens) = (0, 0);
    let raw_checks = raw_contract(Path::new(seeds[0]["file"].as_str().unwrap()));
    for seed in &seeds {
        for origin in ["hwpx", "hwp"] {
            let d =
                HwpDocument::from_bytes(&std::fs::read(seed["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            let bytes = save(&d, origin);
            for side in 0..4 {
                let mut d = HwpDocument::from_bytes(&bytes).unwrap();
                d.set_clip_enabled(false);
                assert_eq!(margins(&d), vec![283; 4]);
                let before = d.save_snapshot_native();
                let outside = protected(&d);
                let doc_info = format!("{:?}", d.document().doc_info);
                let bin_data = format!("{:?}", d.document().bin_data_content);
                let cells = serde_json::to_value(&table(&d).cells).unwrap();
                let before_svg = svg(&d);
                set(&mut d, side, 850);
                let mut expected = vec![283; 4];
                expected[side] = 850;
                assert_eq!(margins(&d), expected);
                assert_eq!(owners(&d)["typed"], json!(expected));
                assert_eq!(owners(&d)["common"], json!(expected));
                assert_eq!(protected(&d), outside, "outside table margin preserved");
                assert_eq!(
                    format!("{:?}", d.document().doc_info),
                    doc_info,
                    "all typed DocInfo preserved"
                );
                assert_eq!(
                    format!("{:?}", d.document().bin_data_content),
                    bin_data,
                    "all BinData preserved"
                );
                assert_eq!(
                    serde_json::to_value(&table(&d).cells).unwrap(),
                    cells,
                    "cell owners/format exact"
                );
                let after = d.save_snapshot_native();
                let after_svg = svg(&d);
                d.restore_snapshot_native(before.clone()).unwrap();
                assert_eq!(margins(&d), vec![283; 4]);
                assert_eq!(svg(&d), before_svg);
                d.restore_snapshot_native(after).unwrap();
                assert_eq!(margins(&d), expected);
                assert_eq!(svg(&d), after_svg);
                pairs += 1;
                for format in ["hwp", "hwpx"] {
                    let saved = save(&d, format);
                    let mut reopened = HwpDocument::from_bytes(&saved).unwrap();
                    reopened.set_clip_enabled(false);
                    assert_eq!(margins(&reopened), expected);
                    assert_eq!(owners(&reopened)["typed"], json!(expected));
                    assert_eq!(owners(&reopened)["common"], json!(expected));
                    assert_eq!(svg(&reopened), after_svg, "saved whole SVG");
                    std::fs::write(
                        out.join(format!(
                            "{}-{origin}-side{side}.{format}",
                            seed["label"].as_str().unwrap()
                        )),
                        saved,
                    )
                    .unwrap();
                    reopens += 1;
                }
                rows.push(json!({"label":seed["label"],"origin":origin,"side":side,"expected":expected,"owners":owners(&d)}));
            }
        }
    }
    if let Some(manifest) = args.get(2) {
        let files: Vec<Value> = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
        for row in &files {
            let mut d =
                HwpDocument::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            d.set_clip_enabled(false);
            assert_eq!(json!(margins(&d)), row["margins"]);
            assert_eq!(props(&d), row["props"]);
            assert_eq!(json!(svg(&d)), row["svg"]);
        }
        std::fs::write(
            out.join("electron-oracle.json"),
            serde_json::to_vec_pretty(
                &json!({"sameBytesFiles":files.len(),"getterAndFullSVGExact":true}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    std::fs::write(out.join("proof.json"),serde_json::to_vec_pretty(&json!({"cases":rows.len(),"pairs":pairs,"savedReopens":reopens,"rawChecks":raw_checks,"rows":rows})).unwrap()).unwrap();
    println!(
        "PASS {} cases/{pairs} snapshot pairs/{reopens} reopens/{raw_checks} raw contracts",
        rows.len()
    );
}
