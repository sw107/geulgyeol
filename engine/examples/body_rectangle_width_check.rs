//! Body rectangle width basis: IO, real geometry, metadata, snapshots and refusals.
use rhwp::{
    document_core::DocumentCore,
    model::control::Control,
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::path::Path;
fn ci(d: &DocumentCore) -> usize {
    d.document().sections[0].paragraphs[0]
        .controls
        .iter()
        .position(|c| matches!(c, Control::Shape(_)))
        .unwrap()
}
fn refs(d: &DocumentCore) -> Value {
    json!(d.document().sections[0].paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"fields":p.field_ranges,"controls":p.controls.iter().filter(|c|!matches!(c,Control::Shape(_)|Control::SectionDef(_)|Control::ColumnDef(_))).map(|c|format!("{c:?}")).collect::<Vec<_>>()})).collect::<Vec<_>>())
}
fn rect(d: &DocumentCore) -> Value {
    fn walk(n: &RenderNode, ci: usize) -> Option<Value> {
        if let RenderNodeType::Rectangle(r) = &n.node_type {
            if r.para_index == Some(0) && r.control_index == Some(ci) {
                return Some(
                    json!({"x":n.bbox.x,"y":n.bbox.y,"width":n.bbox.width,"height":n.bbox.height}),
                );
            }
        }
        n.children.iter().find_map(|c| walk(c, ci))
    }
    (0..d.page_count())
        .find_map(|p| walk(&d.build_page_render_tree(p).unwrap().root, ci(d)))
        .unwrap()
}
fn expected(d: &DocumentCore, basis: &str, width: u32) -> f64 {
    let tree = d.build_page_render_tree(0).unwrap();
    fn find(n: &RenderNode, kind: &str) -> Option<f64> {
        let hit = matches!(
            (&n.node_type, kind),
            (RenderNodeType::Page(_), "Paper")
                | (RenderNodeType::Body { .. }, "Page")
                | (RenderNodeType::Column(_), "Column")
        );
        if hit {
            return Some(n.bbox.width);
        }
        n.children.iter().find_map(|n| find(n, kind))
    }
    if basis == "Absolute" {
        return width as f64 * 96.0 / 7200.0;
    }
    let col = find(&tree.root, if basis == "Para" { "Column" } else { basis }).unwrap();
    if basis == "Para" {
        let p: Value =
            serde_json::from_str(&d.get_para_properties_at_native(0, 0).unwrap()).unwrap();
        col - p["marginLeft"].as_f64().unwrap() - p["marginRight"].as_f64().unwrap()
    } else {
        col * width as f64 / 10000.0
    }
}
fn assert_width(d: &DocumentCore, basis: &str, width: u32) {
    let prop: Value =
        serde_json::from_str(&d.get_body_rectangle_width_native(0, 0, ci(d)).unwrap()).unwrap();
    assert_eq!(prop, json!({"width":width,"widthCriterion":basis}));
    let actual = rect(d)["width"].as_f64().unwrap();
    assert!(
        (actual - expected(d, basis, width)).abs() < 0.15,
        "{basis}: {actual} != {}",
        expected(d, basis, width)
    );
}
fn io(d: &DocumentCore, out: &Path, label: &str, basis: &str, width: u32) -> usize {
    for ext in ["hwp", "hwpx"] {
        let b = if ext == "hwp" {
            d.export_hwp_native().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        std::fs::write(out.join(format!("{label}.{ext}")), &b).unwrap();
        let r = DocumentCore::from_bytes(&b).unwrap();
        assert_width(&r, basis, width);
        assert_eq!(
            r.document().sections[0]
                .paragraphs
                .iter()
                .map(|p| (&p.text, p.style_id))
                .collect::<Vec<_>>(),
            d.document().sections[0]
                .paragraphs
                .iter()
                .map(|p| (&p.text, p.style_id))
                .collect::<Vec<_>>()
        );
    }
    std::fs::write(
        out.join(format!("{label}.svg")),
        d.render_page_svg_native(0).unwrap(),
    )
    .unwrap();
    2
}
fn main() {
    let a = std::env::args().skip(1).collect::<Vec<_>>();
    let out = Path::new(&a[0]);
    std::fs::create_dir_all(out).unwrap();
    if a[1] == "--verify-caption-history" || a[1] == "--verify-caption-text" {
        let manifest: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("manifest.json")).unwrap()).unwrap();
        let mut snapshot_pairs = 0;
        fn apply(d: &mut DocumentCore, para: usize, ci: usize, op: &Value) {
            match op["kind"].as_str().unwrap() {
                "props" => {
                    d.set_picture_properties_native(0, para, ci, &op["props"].to_string())
                        .unwrap();
                }
                "text" => {
                    d.insert_text_in_cell_native(
                        0,
                        para,
                        ci,
                        0,
                        0,
                        op["offset"].as_u64().unwrap() as usize,
                        op["text"].as_str().unwrap(),
                    )
                    .unwrap();
                    let f = &op["format"];
                    d.apply_char_format_in_cell_native(
                        0,
                        para,
                        ci,
                        0,
                        0,
                        f["start"].as_u64().unwrap() as usize,
                        f["end"].as_u64().unwrap() as usize,
                        &f["props"].to_string(),
                    )
                    .unwrap();
                }
                "delete" => {
                    d.delete_picture_control_native(0, para, ci).unwrap();
                }
                "captionRange" => {
                    let info: Value = serde_json::from_str(
                        &d.get_picture_caption_edit_info_native(0, para, ci).unwrap(),
                    )
                    .unwrap();
                    let sp = op["startPara"].as_u64().unwrap() as usize;
                    let ep = op["endPara"].as_u64().unwrap() as usize;
                    let at = op["start"].as_u64().unwrap() as usize;
                    let end = op["end"].as_u64().unwrap() as usize;
                    for (p, offset) in [(sp, at), (ep, end)] {
                        assert!(
                            offset >= info["paragraphs"][p]["editFrom"].as_u64().unwrap() as usize
                        );
                        assert!(
                            offset
                                <= info["paragraphs"][p]["text"]
                                    .as_str()
                                    .unwrap()
                                    .chars()
                                    .count()
                        );
                    }
                    let shape = if op["inheritSelection"] == true {
                        let props: Value = serde_json::from_str(
                            &d.get_cell_char_properties_at_native(0, para, ci, 0, sp, at)
                                .unwrap(),
                        )
                        .unwrap();
                        Some(props["charShapeId"].as_u64().unwrap() as u32)
                    } else {
                        None
                    };
                    if sp != ep || at != end {
                        d.delete_range_in_cell_by_path(0, para, &[(ci, 0, sp)], sp, at, ep, end)
                            .unwrap();
                    }
                    let text = op["text"]
                        .as_str()
                        .unwrap_or("")
                        .replace("\r\n", "\n")
                        .replace('\r', "\n");
                    let action = op["action"].as_str().unwrap();
                    let lines = if action == "break" {
                        vec!["\n"]
                    } else {
                        text.split('\n').collect::<Vec<_>>()
                    };
                    let mut p = sp;
                    let mut offset = at;
                    for (i, line) in lines.iter().enumerate() {
                        if !line.is_empty() {
                            d.insert_text_in_cell_native(0, para, ci, 0, p, offset, line)
                                .unwrap();
                            if let Some(id) = shape {
                                d.set_char_shape_id_in_cell_native(
                                    0,
                                    para,
                                    ci,
                                    0,
                                    p,
                                    offset,
                                    offset + line.chars().count(),
                                    id,
                                )
                                .unwrap();
                            }
                            offset += line.chars().count();
                        }
                        if i + 1 < lines.len() || action == "split" {
                            d.split_paragraph_in_cell_native(0, para, ci, 0, p, offset, None)
                                .unwrap();
                            p += 1;
                            offset = 0;
                        }
                    }
                }

                _ => panic!("Unknown caption history operation"),
            }
        }
        fn canonical(mut d: DocumentCore) -> Value {
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    if let Control::Footnote(n) = c {
                        for p in &mut n.paragraphs {
                            while p.raw_header_extra.last() == Some(&0) {
                                p.raw_header_extra.pop();
                            }
                        }
                    }
                }
            }
            let mut info = d.document().doc_info.clone();
            info.raw_stream = None;
            info.raw_stream_dirty = false;
            info.raw_provenance = None;
            json!({"paragraphs":d.document().sections[0].paragraphs,"docInfo":format!("{:?}", info),"binData":format!("{:?}", d.document().bin_data_content)})
        }
        for row in &manifest {
            let mut d =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let para = row["ref"]["ppi"].as_u64().unwrap() as usize;
            let ci = row["ref"]["ci"].as_u64().unwrap() as usize;
            for op in row["ops"].as_array().unwrap() {
                let before = format!("{:?}", d.document());
                let before_id = d.save_snapshot_native();
                apply(&mut d, para, ci, op);
                let after = format!("{:?}", d.document());
                let after_id = d.save_snapshot_native();
                for _ in 0..3 {
                    d.restore_snapshot_native(before_id).unwrap();
                    assert_eq!(format!("{:?}", d.document()), before);
                    d.restore_snapshot_native(after_id).unwrap();
                    assert_eq!(format!("{:?}", d.document()), after);
                    snapshot_pairs += 1;
                }
                d.discard_snapshot_native(before_id);
                d.discard_snapshot_native(after_id);
            }
            let file = Path::new(row["file"].as_str().unwrap());
            let saved = if file.extension().unwrap() == "hwp" {
                d.export_hwp_with_adapter_snapshot().unwrap()
            } else {
                d.export_hwpx_native().unwrap()
            };
            let expected = DocumentCore::from_bytes(&saved).unwrap();
            let actual = DocumentCore::from_bytes(&std::fs::read(file).unwrap()).unwrap();
            assert_eq!(actual.page_count(), expected.page_count());
            for page in 0..actual.page_count() {
                assert_eq!(
                    actual.render_page_svg_native(page).unwrap(),
                    expected.render_page_svg_native(page).unwrap(),
                    "{}",
                    file.display()
                );
            }
            assert_eq!(canonical(actual), canonical(expected), "{}", file.display());
        }
        let mut caption_refusals = 0;
        if a[1] == "--verify-caption-text" {
            let row = &manifest[0];
            let original =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap()
                    .document()
                    .clone();
            let para = row["ref"]["ppi"].as_u64().unwrap() as usize;
            let ci = row["ref"]["ci"].as_u64().unwrap() as usize;
            for kind in 0..10 {
                let mut d = DocumentCore::new_empty();
                d.set_document(original.clone());
                let Control::Picture(pic) =
                    &mut d.document_mut().sections[0].paragraphs[para].controls[ci]
                else {
                    panic!()
                };
                match kind {
                    0 => pic.common.treat_as_char = true,
                    1 => pic.shape_attr.rotation_angle = 30,
                    2 => {
                        pic.caption.as_mut().unwrap().direction =
                            rhwp::model::shape::CaptionDirection::Left
                    }
                    3 => pic.caption = None,
                    4 => pic.caption.as_mut().unwrap().paragraphs.clear(),
                    5 => pic.caption.as_mut().unwrap().paragraphs[0].controls.push(
                        Control::Bookmark(rhwp::model::control::Bookmark {
                            name: "protected".into(),
                        }),
                    ),
                    6 => pic.caption.as_mut().unwrap().paragraphs[0]
                        .controls
                        .push(Control::Field(Default::default())),
                    7 => pic.caption.as_mut().unwrap().paragraphs[0]
                        .range_tags
                        .push(Default::default()),
                    8 => pic.caption.as_mut().unwrap().paragraphs[0]
                        .orphan_field_ends
                        .push(Default::default()),
                    _ => {
                        let p = &mut pic.caption.as_mut().unwrap().paragraphs[0];
                        p.text.clear();
                        p.char_offsets.clear();
                    }
                }
                let before = format!("{:?}", d.document());
                assert!(d.get_picture_caption_edit_info_native(0, para, ci).is_err());
                assert_eq!(format!("{:?}", d.document()), before);
                caption_refusals += 1;
            }
            let d =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            for (sec, p, c) in [(999, para, ci), (0, 999, ci), (0, para, 999), (0, para, 0)] {
                let before = format!("{:?}", d.document());
                assert!(d.get_picture_caption_edit_info_native(sec, p, c).is_err());
                assert_eq!(format!("{:?}", d.document()), before);
                caption_refusals += 1;
            }
        }
        std::fs::write(out.join("native-caption-proof.json"),serde_json::to_vec_pretty(&json!({"independentSavedReopens":manifest.len(),"nativeCommandReexecution":true,"snapshotPairs":snapshot_pairs,"captionScopeReadonlyRefusals":caption_refusals,"fullSvgParagraphsStylesCaptionAndImageCompared":true,"noteHeaderTrailingZeroPaddingCanonicalized":true})).unwrap()).unwrap();
        return;
    }
    if a[1] == "--verify-band-ui" {
        let manifest: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("manifest.json")).unwrap()).unwrap();
        fn band_ci(d: &DocumentCore, para: usize) -> usize {
            d.document().sections[0].paragraphs[para].controls.iter().rposition(|c| matches!(c, Control::Shape(s) if s.common().width_criterion == rhwp::model::shape::SizeCriterion::Para && s.common().width == 10000)).unwrap()
        }
        fn canonical_refs(mut d: DocumentCore) -> Value {
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    if let Control::Footnote(n) = c {
                        for p in &mut n.paragraphs {
                            while p.raw_header_extra.last() == Some(&0) {
                                p.raw_header_extra.pop();
                            }
                        }
                    }
                }
            }
            refs(&d)
        }
        for row in &manifest {
            let mut d =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let original = refs(&d);
            for op in row["ops"].as_array().unwrap() {
                let para = op["para"].as_u64().unwrap_or(0) as usize;
                match op["kind"].as_str().unwrap() {
                    "insert" => {
                        let len = d.document().sections[0].paragraphs[para]
                            .text
                            .chars()
                            .count();
                        let result: Value = serde_json::from_str(
                            &d.create_shape_control_native(
                                0,
                                para,
                                len,
                                10000,
                                op["height"].as_u64().unwrap() as u32,
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
                        let ci = result["controlIdx"].as_u64().unwrap() as usize;
                        d.set_shape_properties_native(0,para,ci,&json!({"horzRelTo":"Para","vertRelTo":"Para","horzAlign":"Left","vertAlign":"Top","horzOffset":0,"vertOffset":0,"fillType":"solid","fillBgColor":op["color"],"fillPatType":-1,"fillAlpha":0,"lineType":0}).to_string()).unwrap();
                        d.set_body_rectangle_width_native(
                            0,
                            para,
                            ci,
                            r#"{"width":10000,"widthCriterion":"Para"}"#,
                        )
                        .unwrap();
                        assert_eq!(refs(&d), original);
                    }
                    "edit" => {
                        let ci = band_ci(&d, para);
                        d.set_shape_properties_native(
                            0,
                            para,
                            ci,
                            &json!({"height":op["height"],"fillBgColor":op["color"]}).to_string(),
                        )
                        .unwrap();
                        assert_eq!(refs(&d), original);
                    }
                    "remove" => {
                        let ci = band_ci(&d, para);
                        d.delete_shape_control_native(0, para, ci).unwrap();
                        assert_eq!(refs(&d), original);
                    }
                    "margins" => {
                        d.apply_para_format_native(
                            0,
                            0,
                            r#"{"marginLeft":2000,"marginRight":3000}"#,
                        )
                        .unwrap();
                    }
                    "page" => {
                        d.set_page_def_native(
                            0,
                            r#"{"width":66000,"marginLeft":9000,"marginRight":7000}"#,
                        )
                        .unwrap();
                    }
                    "columns" => {
                        d.set_column_def_native(0, 2, 0, true, 1000).unwrap();
                    }
                    other => panic!("unknown op {other}"),
                }
            }
            let file = Path::new(row["file"].as_str().unwrap());
            let bytes = if file.extension().unwrap() == "hwp" {
                d.export_hwp_native().unwrap()
            } else {
                d.export_hwpx_native().unwrap()
            };
            let expected = DocumentCore::from_bytes(&bytes).unwrap();
            let actual = DocumentCore::from_bytes(&std::fs::read(file).unwrap()).unwrap();
            // Full SVG includes the actual band geometry, fill and unchanged text glyphs.
            assert_eq!(
                actual.render_page_svg_native(0).unwrap(),
                expected.render_page_svg_native(0).unwrap(),
                "{}",
                file.display()
            );
            assert_eq!(
                canonical_refs(actual),
                canonical_refs(expected),
                "{}",
                file.display()
            );
        }
        std::fs::write(out.join("native-ui-proof.json"),serde_json::to_vec_pretty(&json!({"independentSavedReopens":manifest.len(),"nativeCommandReexecution":true,"fullSvgGeometryAndReferences":true,"noteHeaderTrailingZeroPaddingCanonicalized":true})).unwrap()).unwrap();
        return;
    }
    if a[1] == "--verify-wasm" {
        let manifest: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("wasm-manifest.json")).unwrap())
                .unwrap();
        for row in &manifest {
            let file = Path::new(row["file"].as_str().unwrap());
            let basis = row["basis"].as_str().unwrap();
            let width = row["width"].as_u64().unwrap() as u32;
            let mut expected = DocumentCore::from_bytes(&std::fs::read(&a[2]).unwrap()).unwrap();
            expected
                .set_body_rectangle_width_native(
                    0,
                    0,
                    ci(&expected),
                    &json!({"width":width,"widthCriterion":basis}).to_string(),
                )
                .unwrap();
            let change = file
                .file_stem()
                .unwrap()
                .to_str()
                .unwrap()
                .split('-')
                .nth(1)
                .unwrap();
            if change != "basis" {
                expected
                    .apply_para_format_native(0, 0, r#"{"marginLeft":2000,"marginRight":3000}"#)
                    .unwrap();
            }
            if ["page", "columns"].contains(&change) {
                expected
                    .set_page_def_native(
                        0,
                        r#"{"width":66000,"marginLeft":9000,"marginRight":7000}"#,
                    )
                    .unwrap();
            }
            if change == "columns" {
                expected.set_column_def_native(0, 2, 0, true, 1000).unwrap();
            }
            let bytes = if file.extension().unwrap() == "hwp" {
                expected.export_hwp_native().unwrap()
            } else {
                expected.export_hwpx_native().unwrap()
            };
            let canonical = DocumentCore::from_bytes(&bytes).unwrap();
            let actual = DocumentCore::from_bytes(&std::fs::read(file).unwrap()).unwrap();
            assert_width(&actual, basis, width);
            assert_eq!(rect(&actual), rect(&canonical));
            // HWP note headers differ only in optional trailing zero padding between
            // Native and WASM writers. Preserve every nonzero byte and all other refs.
            fn oracle_refs(mut d: DocumentCore) -> Value {
                for p in &mut d.document_mut().sections[0].paragraphs {
                    for c in &mut p.controls {
                        if let Control::Footnote(n) = c {
                            for p in &mut n.paragraphs {
                                while p.raw_header_extra.last() == Some(&0) {
                                    p.raw_header_extra.pop();
                                }
                            }
                        }
                    }
                }
                refs(&d)
            }
            assert_eq!(
                oracle_refs(actual),
                oracle_refs(canonical),
                "{}",
                file.display()
            );
        }
        std::fs::write(out.join("native-wasm-proof.json"),serde_json::to_vec_pretty(&json!({"independentSavedReopens":manifest.len(),"reexecutedWidthMarginsPageColumns":true,"actualGeometryAndReferences":true,"noteHeaderTrailingZeroPaddingCanonicalized":true})).unwrap()).unwrap();
        return;
    }
    let mut seed = DocumentCore::from_bytes(&std::fs::read(&a[1]).unwrap()).unwrap();
    seed.set_column_def_native(0, 1, 0, true, 0).unwrap();
    seed.insert_body_comment(0, 1, 0, 3, "이웃 주석 보존")
        .unwrap();
    let shape: Value = serde_json::from_str(
        &seed
            .create_shape_control_native(
                0,
                0,
                0,
                12000,
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
    let index = shape["controlIdx"].as_u64().unwrap() as usize;
    seed.set_shape_properties_native(0,0,index,r#"{"horzRelTo":"Para","vertRelTo":"Para","lineType":0,"fillType":"solid","fillBgColor":0}"#).unwrap();
    let input = seed.export_hwpx_native().unwrap();
    std::fs::write(out.join("seed.hwpx"), &input).unwrap();
    let mut saves = 0;
    let mut history = 0;
    let mut rows = vec![];
    for basis in ["Absolute", "Paper", "Page", "Column", "Para"] {
        let mut d = DocumentCore::from_bytes(&input).unwrap();
        let original = refs(&d);
        let width = if basis == "Absolute" { 12000 } else { 10000 };
        let before = d.save_snapshot_native();
        let before_svg = d.render_page_svg_native(0).unwrap();
        d.set_body_rectangle_width_native(
            0,
            0,
            ci(&d),
            &json!({"width":width,"widthCriterion":basis}).to_string(),
        )
        .unwrap();
        assert_eq!(refs(&d), original);
        assert_width(&d, basis, width);
        let changed = d.save_snapshot_native();
        d.restore_snapshot_native(before).unwrap();
        assert_eq!(d.render_page_svg_native(0).unwrap(), before_svg);
        d.restore_snapshot_native(changed).unwrap();
        assert_width(&d, basis, width);
        d.discard_snapshot_native(before);
        d.discard_snapshot_native(changed);
        history += 1;
        saves += io(&d, out, &format!("{basis}-basis"), basis, width);
        for (label, kind) in [("margins", 0), ("page", 1), ("columns", 2)] {
            let snap = d.save_snapshot_native();
            let bounds = rect(&d);
            match kind {
                0 => {
                    d.apply_para_format_native(0, 0, r#"{"marginLeft":2000,"marginRight":3000}"#)
                        .unwrap();
                }
                1 => {
                    d.set_page_def_native(
                        0,
                        r#"{"width":66000,"marginLeft":9000,"marginRight":7000}"#,
                    )
                    .unwrap();
                }
                _ => {
                    d.set_column_def_native(0, 2, 0, true, 1000).unwrap();
                }
            }
            assert_width(&d, basis, width);
            assert_eq!(refs(&d), original);
            let redo = d.save_snapshot_native();
            saves += io(&d, out, &format!("{basis}-{label}"), basis, width);
            rows.push(json!({"basis":basis,"change":label,"bounds":rect(&d)}));
            d.restore_snapshot_native(snap).unwrap();
            assert_eq!(rect(&d), bounds);
            d.restore_snapshot_native(redo).unwrap();
            assert_width(&d, basis, width);
            d.discard_snapshot_native(snap);
            d.discard_snapshot_native(redo);
            history += 1;
        }
    }
    let mut refusals = 0;
    for props in [
        r#"{"width":9999,"widthCriterion":"Para"}"#,
        r#"{"width":10000,"widthCriterion":"Bad"}"#,
        r#"{"width":0,"widthCriterion":"Absolute"}"#,
        r#"{"width":10001,"widthCriterion":"Column"}"#,
        r#"{"width":10000,"widthCriterion":"Para","height":283}"#,
        "{}",
        "null",
    ] {
        let mut d = DocumentCore::from_bytes(&input).unwrap();
        let before = format!("{:?}", d.document());
        let ev = d.serialize_event_log();
        assert!(d
            .set_body_rectangle_width_native(0, 0, ci(&d), props)
            .is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        assert_eq!(d.serialize_event_log(), ev);
        refusals += 1;
    }
    for mode in [
        "rotate", "tac", "flow", "textbox", "vertical", "style", "height", "flip", "scale",
    ] {
        let mut d = DocumentCore::from_bytes(&input).unwrap();
        match mode {
            "vertical" => d.document_mut().sections[0].section_def.text_direction = 1,
            "style" => d.document_mut().sections[0].paragraphs[0].style_id = u8::MAX,
            _ => {
                let i = ci(&d);
                let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[0].controls[i]
                else {
                    unreachable!()
                };
                match mode {
                    "rotate" => s.drawing_mut().unwrap().shape_attr.rotation_angle = 20,
                    "tac" => s.common_mut().treat_as_char = true,
                    "flow" => s.common_mut().text_wrap = rhwp::model::shape::TextWrap::Square,
                    "height" => s.common_mut().height = 0,
                    "flip" => s.shape_attr_mut().horz_flip = true,
                    "scale" => s.shape_attr_mut().render_sx = 2.0,
                    _ => s.drawing_mut().unwrap().text_box = Some(Default::default()),
                }
            }
        }
        let before = format!("{:?}", d.document());
        assert!(d
            .set_body_rectangle_width_native(
                0,
                0,
                ci(&d),
                r#"{"width":10000,"widthCriterion":"Para"}"#
            )
            .is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        refusals += 1;
    }
    // Synthesize a cell rectangle using existing IR solely as an old/new rendering fixture.
    // The body-only API must reject the parent table, leaving the whole model/events intact.
    let mut cell = DocumentCore::from_bytes(&input).unwrap();
    let table: Value =
        serde_json::from_str(&cell.create_table_native(0, 1, 0, 1, 1).unwrap()).unwrap();
    let table_para = table["paraIdx"].as_u64().unwrap() as usize;
    let mut rectangle = cell.document().sections[0].paragraphs[0].controls[ci(&cell)].clone();
    if let Control::Shape(s) = &mut rectangle {
        s.common_mut().width = 10000;
        s.common_mut().width_criterion = rhwp::model::shape::SizeCriterion::Para;
    }
    let table_ci = cell.document().sections[0].paragraphs[table_para]
        .controls
        .iter()
        .position(|c| matches!(c, Control::Table(_)))
        .unwrap();
    let Control::Table(t) =
        &mut cell.document_mut().sections[0].paragraphs[table_para].controls[table_ci]
    else {
        unreachable!()
    };
    t.cells[0].paragraphs[0].controls.push(rectangle);
    let before = format!("{:?}", cell.document());
    let events = cell.serialize_event_log();
    assert!(cell
        .set_body_rectangle_width_native(
            0,
            table_para,
            table_ci,
            r#"{"width":10000,"widthCriterion":"Para"}"#
        )
        .is_err());
    assert_eq!(format!("{:?}", cell.document()), before);
    assert_eq!(cell.serialize_event_log(), events);
    refusals += 1;
    for ext in ["hwp", "hwpx"] {
        let bytes = if ext == "hwp" {
            cell.export_hwp_native().unwrap()
        } else {
            cell.export_hwpx_native().unwrap()
        };
        std::fs::write(out.join(format!("legacy-cell.{ext}")), bytes).unwrap();
    }
    let p = json!({"nativeReopens":saves,"snapshotUndoRedoPairs":history,"atomicRefusals":refusals,"rows":rows,"bodyTextStyleNoteNeighborMemoPreserved":true,"GUIVerified":false});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&p).unwrap(),
    )
    .unwrap();
    println!("{p}");
}
