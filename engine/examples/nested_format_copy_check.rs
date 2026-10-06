//! Synthetic nested tables; exact model/history comparisons and real WASM/UI fixtures.
#[path = "common/nested_cells.rs"]
pub mod nested_cells;
use nested_cells::*;
use rhwp::{document_core::DocumentCore, model::table::TableZone};
use serde_json::{json, Value};
fn main() {
    let out = std::env::args().nth(1).unwrap();
    std::fs::create_dir_all(&out).unwrap();
    let mut fixtures = vec![];
    let mut histories = 0;
    let mut rejections = 0;
    let mut saved = 0;
    for depth in 1..=3 {
        for merged in [false, true] {
            let (d, parent, path) = fixture(depth, merged);
            let input = d.export_hwpx_native().unwrap();
            let file = format!("{out}/depth{depth}-merged{merged}.hwpx");
            std::fs::write(&file, &input).unwrap();
            let mut d = DocumentCore::from_bytes(&input).unwrap();
            let before = model(&d);
            let initial_svg = svg(&d);
            let props: Value = serde_json::from_str(
                &d.get_cell_own_properties_by_path_native(0, parent, &path_json(&path))
                    .unwrap(),
            )
            .unwrap();
            let keys = [
                "paddingLeft",
                "paddingRight",
                "paddingTop",
                "paddingBottom",
                "applyInnerMargin",
                "verticalAlign",
                "textDirection",
                "isHeader",
                "cellProtect",
                "fieldName",
                "editableInForm",
                "borderFillId",
            ];
            let copied: serde_json::Map<String, Value> = keys
                .iter()
                .map(|k| ((*k).to_string(), props[*k].clone()))
                .collect();
            let copied = serde_json::to_string(&copied).unwrap();
            let mut target = path.clone();
            target.last_mut().unwrap().1 = 1;
            let paths = format!("[{}]", path_json(&target));
            let invalid = [
                "[]".to_string(),
                "[[]]".into(),
                format!("[{},{}]", path_json(&target), path_json(&[(999, 0, 0)])),
                "[[{\"controlIndex\":0,\"cellIndex\":0}]]".into(),
                "[[{\"controlIndex\":0,\"cellIndex\":0,\"cellParaIndex\":-1}]]".into(),
            ];
            for p in invalid {
                assert!(d
                    .apply_cell_own_properties_by_paths_native(0, parent, &p, &copied)
                    .is_err());
                assert_eq!(model(&d), before);
                assert_eq!(svg(&d), initial_svg);
                rejections += 1;
            }
            for p in [
                r#"{"borderFillId":65535}"#,
                r#"{"paddingLeft":40000}"#,
                r#"{"verticalAlign":3}"#,
                r#"{"width":10}"#,
                r#"{"paddingLeft":"x"}"#,
            ] {
                assert!(d
                    .apply_cell_own_properties_by_paths_native(0, parent, &paths, p)
                    .is_err());
                assert_eq!(model(&d), before);
                assert_eq!(svg(&d), initial_svg);
                rejections += 1;
            }
            // The blank body paragraph contains a SectionDef, which is deliberately not a table path.
            assert!(d
                .apply_cell_own_properties_by_paths_native(
                    0,
                    0,
                    "[[{\"controlIndex\":0,\"cellIndex\":0,\"cellParaIndex\":0}]]",
                    &copied
                )
                .is_err());
            assert_eq!(model(&d), before);
            assert_eq!(svg(&d), initial_svg);
            rejections += 1;
            let undo = d.save_snapshot_native();
            let original = d.document().clone();
            d.apply_cell_own_properties_by_paths_native(0, parent, &paths, &copied)
                .unwrap();
            d.repaginate_if_needed();
            assert_eq!(
                format!("{:?}", original.doc_info),
                format!("{:?}", d.document().doc_info),
                "cell-own copying must not allocate or alter document definitions"
            );
            let new = model(&d);
            let new_svg = svg(&d);
            let a = table(&original.sections[0].paragraphs[parent], &path);
            let b = table(&d.document().sections[0].paragraphs[parent], &path);
            for (i, c) in a.cells.iter().enumerate() {
                assert_eq!(
                    paragraph_content(&c.paragraphs),
                    paragraph_content(&b.cells[i].paragraphs),
                    "cell properties preserve all paragraph content except derived line layout"
                );
                if i != 1 {
                    assert_eq!(
                        format!("{:?}", c.padding),
                        format!("{:?}", b.cells[i].padding)
                    );
                    assert_eq!(c.border_fill_id, b.cells[i].border_fill_id);
                }
            }
            let redo = d.save_snapshot_native();
            for _ in 0..3 {
                d.restore_snapshot_native(undo).unwrap();
                assert_eq!(model(&d), before);
                assert_eq!(svg(&d), initial_svg);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(model(&d), new);
                assert_eq!(svg(&d), new_svg);
                histories += 2;
            }
            for (format, bytes) in [
                ("hwp", d.export_hwp_native().unwrap()),
                ("hwpx", d.export_hwpx_native().unwrap()),
            ] {
                std::fs::write(
                    format!("{out}/depth{depth}-merged{merged}-props.{format}"),
                    &bytes,
                )
                .unwrap();
                let reopened = DocumentCore::from_bytes(&bytes).unwrap();
                let actual: Value = serde_json::from_str(
                    &reopened
                        .get_cell_own_properties_by_path_native(0, parent, &path_json(&target))
                        .unwrap(),
                )
                .unwrap();
                for k in keys {
                    assert_eq!(actual[k], props[k], "saved {k}");
                }
                saved += 1;
            }
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            let mut text = DocumentCore::from_bytes(&input).unwrap();
            let mut end = target.clone();
            end.last_mut().unwrap().2 = 1;
            let old = model(&text);
            assert!(text
                .apply_format_copy_in_cell_native(
                    0,
                    parent,
                    &path_json(&target),
                    &path_json(&end),
                    2,
                    999,
                    r#"{"bold":true}"#,
                    r#"{"alignment":"center"}"#
                )
                .is_err());
            assert_eq!(model(&text), old);
            rejections += 1;
            let mut wrong_pool = DocumentCore::from_bytes(&input).unwrap();
            let bullet_limit = wrong_pool.document().doc_info.bullets.len();
            while wrong_pool.document().doc_info.numberings.len() <= bullet_limit {
                wrong_pool
                    .document_mut()
                    .doc_info
                    .numberings
                    .push(Default::default());
            }
            let wrong_before = model(&wrong_pool);
            let wrong_svg = svg(&wrong_pool);
            assert!(wrong_pool
                .apply_format_copy_in_cell_native(
                    0,
                    parent,
                    &path_json(&target),
                    &path_json(&end),
                    2,
                    4,
                    r#"{"bold":true}"#,
                    &format!(
                        "{{\"headType\":\"Bullet\",\"numberingId\":{}}}",
                        bullet_limit + 1
                    )
                )
                .is_err());
            assert_eq!(model(&wrong_pool), wrong_before);
            assert_eq!(svg(&wrong_pool), wrong_svg);
            rejections += 1;
            let text_undo = text.save_snapshot_native();
            let text_svg = svg(&text);
            text.apply_format_copy_in_cell_native(
                0,
                parent,
                &path_json(&target),
                &path_json(&end),
                2,
                4,
                r#"{"bold":true}"#,
                r#"{"alignment":"center","marginLeft":1200}"#,
            )
            .unwrap();
            text.repaginate_if_needed();
            let leaf = table(&text.document().sections[0].paragraphs[parent], &path);
            assert_eq!(
                leaf.cells[1].paragraphs[0].text,
                a.cells[1].paragraphs[0].text
            );
            assert_eq!(
                leaf.cells[1].paragraphs[1].text,
                a.cells[1].paragraphs[1].text
            );
            assert_eq!(
                format!("{:?}", leaf.cells[1].padding),
                format!("{:?}", a.cells[1].padding)
            );
            let cs = &text.document().doc_info.char_shapes;
            assert!(!cs[leaf.cells[1].paragraphs[0].char_shape_id_at(0).unwrap() as usize].bold);
            assert!(cs[leaf.cells[1].paragraphs[0].char_shape_id_at(2).unwrap() as usize].bold);
            for (i, cell) in leaf.cells.iter().enumerate() {
                for (n, paragraph) in cell.paragraphs.iter().enumerate() {
                    let original = &a.cells[i].paragraphs[n];
                    assert_eq!(paragraph.text, original.text);
                    assert_eq!(paragraph.char_offsets, original.char_offsets);
                    assert_eq!(paragraph.style_id, original.style_id);
                    assert_eq!(
                        format!("{:?}", paragraph.controls),
                        format!("{:?}", original.controls)
                    );
                    if i != 1 {
                        assert_eq!(
                            paragraph_content(&cell.paragraphs),
                            paragraph_content(&a.cells[i].paragraphs)
                        );
                    }
                }
            }
            let mut retained_info = text.document().doc_info.clone();
            retained_info
                .char_shapes
                .truncate(original.doc_info.char_shapes.len());
            retained_info
                .para_shapes
                .truncate(original.doc_info.para_shapes.len());
            retained_info.raw_stream_dirty = original.doc_info.raw_stream_dirty;
            assert_eq!(
                format!("{:?}", retained_info),
                format!("{:?}", original.doc_info),
                "text format copy preserves existing definitions and all other references"
            );
            let text_after = model(&text);
            let text_after_svg = svg(&text);
            let text_redo = text.save_snapshot_native();
            for _ in 0..3 {
                text.restore_snapshot_native(text_undo).unwrap();
                assert_eq!(model(&text), old);
                assert_eq!(svg(&text), text_svg);
                text.restore_snapshot_native(text_redo).unwrap();
                assert_eq!(model(&text), text_after);
                assert_eq!(svg(&text), text_after_svg);
                histories += 2;
            }
            for bytes in [
                text.export_hwp_native().unwrap(),
                text.export_hwpx_native().unwrap(),
            ] {
                let reopened = DocumentCore::from_bytes(&bytes).unwrap();
                let actual = table(&reopened.document().sections[0].paragraphs[parent], &path);
                for (i, cell) in actual.cells.iter().enumerate() {
                    for (n, p) in cell.paragraphs.iter().enumerate() {
                        let original = &a.cells[i].paragraphs[n];
                        assert_eq!(p.text, original.text);
                        assert_eq!(p.style_id, original.style_id);
                        if i == 1 {
                            let ps =
                                &reopened.document().doc_info.para_shapes[p.para_shape_id as usize];
                            assert_eq!(ps.margin_left, 1200);
                            for o in 0..p.text.chars().count() {
                                let selected = if n == 0 { o >= 2 } else { o < 4 };
                                assert_eq!(
                                    reopened.document().doc_info.char_shapes
                                        [p.char_shape_id_at(o).unwrap() as usize]
                                        .bold,
                                    selected
                                );
                            }
                        }
                    }
                }
                saved += 1;
            }
            text.discard_snapshot_native(text_undo);
            text.discard_snapshot_native(text_redo);
            // Copy cell-own border IDs, ignoring source zones; preserve a matching destination overlay.
            let mut zoned = DocumentCore::from_bytes(&input).unwrap();
            let own_before = a.cells[1].border_fill_id;
            let incoming = props["borderFillId"].as_u64().unwrap() as u16;
            let zones = vec![
                TableZone {
                    start_col: 0,
                    start_row: 0,
                    end_col: 0,
                    end_row: 0,
                    border_fill_id: own_before,
                },
                TableZone {
                    start_col: 1,
                    start_row: 0,
                    end_col: 1,
                    end_row: 0,
                    border_fill_id: incoming,
                },
            ];
            table_mut(
                &mut zoned.document_mut().sections[0].paragraphs[parent],
                &path,
            )
            .zones = zones.clone();
            let doc = zoned.document().clone();
            zoned.set_document(doc);
            let read: Value = serde_json::from_str(
                &zoned
                    .get_cell_own_properties_by_path_native(0, parent, &path_json(&path))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(read["borderFillId"], props["borderFillId"]);
            zoned
                .apply_cell_own_properties_by_paths_native(0, parent, &paths, &copied)
                .unwrap();
            zoned.repaginate_if_needed();
            let t = table(&zoned.document().sections[0].paragraphs[parent], &path);
            assert_eq!(t.cells[1].border_fill_id, own_before);
            assert_eq!(format!("{:?}", t.zones), format!("{:?}", zones));
            assert_eq!(t.cells[1].padding.left, 400);
            for bytes in [
                zoned.export_hwp_native().unwrap(),
                zoned.export_hwpx_native().unwrap(),
            ] {
                let r = DocumentCore::from_bytes(&bytes).unwrap();
                let t = table(&r.document().sections[0].paragraphs[parent], &path);
                assert_eq!(t.cells[1].border_fill_id, own_before);
                assert_eq!(format!("{:?}", t.zones), format!("{:?}", zones));
                saved += 1;
            }
            fixtures.push(json!({"file":file,"depth":depth,"merged":merged,"parent":parent,"control":path[0].0,"path":serde_json::from_str::<Value>(&path_json(&path)).unwrap(),"cellCount":a.cells.len()}));
        }
    }
    let proof = json!({"fixtures":fixtures,"historyRestores":histories,"rejections":rejections,"reopens":saved,"zoneOverlayCases":6,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
