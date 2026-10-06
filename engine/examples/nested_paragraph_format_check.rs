//! Full reference/content preservation, exact snapshot/layout and saved paragraph format probes.
#[path = "common/nested_cells.rs"]
pub mod nested_cells;
use nested_cells::*;
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn target(p: &[(usize, usize, usize)], c: usize, n: usize) -> Vec<(usize, usize, usize)> {
    let mut p = p.to_vec();
    let last = p.last_mut().unwrap();
    last.1 = c;
    last.2 = n;
    p
}
fn content(
    d: &DocumentCore,
    paths: &[Vec<(usize, usize, usize)>],
    parent: usize,
    old: &DocumentCore,
) -> String {
    fn clear(ps: &mut [Paragraph]) {
        for p in ps {
            p.line_segs.clear();
            p.single_line_overflow_memo.clear();
            for c in &mut p.controls {
                if let Control::Table(t) = c {
                    t.dirty = false;
                    for c in &mut t.cells {
                        clear(&mut c.paragraphs)
                    }
                }
            }
        }
    }
    let mut doc = d.document().clone();
    for path in paths {
        let last = path.last().unwrap();
        table_mut(&mut doc.sections[0].paragraphs[parent], path).cells[last.1].paragraphs[last.2]
            .para_shape_id = 0;
    }
    for s in &mut doc.sections {
        s.raw_stream = None;
        clear(&mut s.paragraphs)
    }
    let before = &old.document().doc_info;
    doc.doc_info.para_shapes.truncate(before.para_shapes.len());
    doc.doc_info.tab_defs.truncate(before.tab_defs.len());
    doc.doc_info
        .border_fills
        .truncate(before.border_fills.len());
    doc.doc_info.raw_stream_dirty = before.raw_stream_dirty;
    format!("{doc:?}")
}
fn leaf_semantic(d: &DocumentCore, parent: usize, path: &[(usize, usize, usize)]) -> Value {
    let t = table(&d.document().sections[0].paragraphs[parent], path);
    json!(t.cells.iter().map(|c|json!({"geometry":[c.row,c.col,c.row_span,c.col_span,c.width,c.height],"padding":format!("{:?}",c.padding),"border":c.border_fill_id,"paras":c.paragraphs.iter().map(|p|json!({"text":p.text,"offsets":p.char_offsets,"positions":p.logical_control_positions(),"style":p.style_id,"chars":p.char_shapes.iter().map(|r|json!([r.start_pos,r.char_shape_id])).collect::<Vec<_>>(),"objects":p.controls.iter().map(|c|match c{Control::Equation(e)=>json!([e.script,e.font_size,e.color,e.common.instance_id,e.common.treat_as_char]),_=>panic!("unexpected leaf object")}).collect::<Vec<_>>()})).collect::<Vec<_>>()})).collect::<Vec<_>>())
}
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--verify-ui") {
        let manifest = std::env::args().nth(2).unwrap();
        let out = std::env::args().nth(3).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
        for row in &rows {
            let old =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let saved =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            let p: Vec<(usize, usize, usize)> = row["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| {
                    (
                        p["controlIndex"].as_u64().unwrap() as usize,
                        p["cellIndex"].as_u64().unwrap() as usize,
                        p["cellParaIndex"].as_u64().unwrap() as usize,
                    )
                })
                .collect();
            let parent = row["parent"].as_u64().unwrap() as usize;
            assert_eq!(
                leaf_semantic(&saved, parent, &p),
                leaf_semantic(&old, parent, &p),
                "UI saved style IDs, character runs, equation references and logical positions: {}",
                row["file"]
            );
            let styles = |d: &DocumentCore| {
                let mut styles = d.document().doc_info.styles.clone();
                for s in &mut styles {
                    s.raw_data = None;
                }
                serde_json::to_value(styles).unwrap()
            };
            assert_eq!(styles(&saved), styles(&old), "global styles preserved");
            // Compare binary/XML representation metadata against an unedited roundtrip
            // in the same format; HWP materializes control masks and raw header bytes.
            let reference_bytes = if row["file"].as_str().unwrap().ends_with(".hwp") {
                old.export_hwp_native().unwrap()
            } else {
                old.export_hwpx_native().unwrap()
            };
            let reference = DocumentCore::from_bytes(&reference_bytes).unwrap();
            let body = |d: &DocumentCore| {
                let mut ps = d.document().sections[0].paragraphs[..parent].to_vec();
                // Native/WASM HWP writers reserve different trailing zero padding.
                for p in &mut ps {
                    while p.raw_header_extra.last() == Some(&0) {
                        p.raw_header_extra.pop();
                    }
                    for c in &mut p.controls {
                        if let Control::SectionDef(s) = c {
                            while s.raw_ctrl_extra.last() == Some(&0) {
                                s.raw_ctrl_extra.pop();
                            }
                        }
                    }
                }
                paragraph_content(&ps)
            };
            assert_eq!(
                body(&saved),
                body(&reference),
                "outer body compared against unedited same-format roundtrip"
            );
        }
        let proof = json!({"verifiedUIExports":rows.len(),"GUIVerified":false});
        std::fs::write(
            format!("{out}/proof.json"),
            serde_json::to_vec_pretty(&proof).unwrap(),
        )
        .unwrap();
        println!("{proof}");
        return;
    }
    let out = std::env::args().nth(1).unwrap();
    std::fs::create_dir_all(&out).unwrap();
    let mut fixtures = vec![];
    let (mut cases, mut restores, mut reopens, mut rejects) = (0, 0, 0, 0);
    for depth in 1..=3 {
        for merged in [false, true] {
            for equations in [false, true] {
                let (d, parent, path) = fixture_variant(depth, merged, equations);
                let input = d.export_hwpx_native().unwrap();
                let file = format!("{out}/depth{depth}-merged{merged}-equations{equations}.hwpx");
                std::fs::write(&file, &input).unwrap();
                let cell_count = table(&d.document().sections[0].paragraphs[parent], &path)
                    .cells
                    .len();
                fixtures.push(json!({"file":file,"depth":depth,"merged":merged,"equations":equations,"parent":parent,"control":path[0].0,"path":serde_json::from_str::<Value>(&path_json(&path)).unwrap(),"cellCount":cell_count}));
                for (id, props) in [
                    ("align", json!({"alignment":"center"})),
                    (
                        "spacing",
                        json!({"lineSpacing":200,"lineSpacingType":"Percent"}),
                    ),
                    (
                        "indent",
                        json!({"indent":900,"marginLeft":2100,"spacingBefore":300}),
                    ),
                    (
                        "dialog",
                        json!({"tabStops":[{"position":1500,"type":0,"fill":0}],"tabAutoLeft":true,"fillType":"solid","fillColor":"#CCFF99","patternType":-1,"borderLeft":{"type":1,"width":0,"color":"#000000"},"borderSpacing":[100,200,300,400]}),
                    ),
                ] {
                    let mut d = DocumentCore::from_bytes(&input).unwrap();
                    let old = DocumentCore::from_bytes(&input).unwrap();
                    let paths = vec![
                        target(&path, 1, 0),
                        target(&path, 1, 1),
                        target(&path, 2, 0),
                    ];
                    let paths_json = format!(
                        "[{}]",
                        paths
                            .iter()
                            .map(|p| path_json(p))
                            .collect::<Vec<_>>()
                            .join(",")
                    );
                    let before = model(&d);
                    let before_svg = svg(&d);
                    let expected = leaf_semantic(&d, parent, &path);
                    for invalid in [
                        "[]".to_string(),
                        "[[]]".into(),
                        format!(
                            "[{},{}]",
                            path_json(&paths[0]),
                            path_json(&target(&path, 999, 0))
                        ),
                        format!(
                            "[{},{}]",
                            path_json(&paths[0]),
                            path_json(&target(&path, 1, 999))
                        ),
                        "[[{\"controlIndex\":0,\"cellIndex\":0}]]".into(),
                        "[[{\"controlIndex\":0,\"cellIndex\":0,\"cellParaIndex\":-1}]]".into(),
                    ] {
                        assert!(d
                            .apply_para_format_in_cells_by_paths_native(
                                0,
                                parent,
                                &invalid,
                                &props.to_string()
                            )
                            .is_err());
                        assert_eq!(model(&d), before);
                        assert_eq!(svg(&d), before_svg);
                        rejects += 1;
                    }
                    for invalid in [
                        json!({"numberingId":65535}),
                        json!({"paraShapeId":1}),
                        json!({"borderFillId":65535}),
                        json!({"marginLeft":2147483648_i64}),
                        json!({"alignment":"bad"}),
                        json!({"lineSpacing":"x"}),
                        json!({"tabStops":[{"position":-1,"type":0,"fill":0}]}),
                        json!({"borderSpacing":[0,0,0,40000]}),
                    ] {
                        assert!(d
                            .apply_para_format_in_cells_by_paths_native(
                                0,
                                parent,
                                &paths_json,
                                &invalid.to_string()
                            )
                            .is_err());
                        assert_eq!(model(&d), before);
                        assert_eq!(svg(&d), before_svg);
                        rejects += 1;
                    }
                    assert!(d
                        .apply_para_format_in_cells_by_paths_native(
                            0,
                            0,
                            "[[{\"controlIndex\":0,\"cellIndex\":0,\"cellParaIndex\":0}]]",
                            &props.to_string()
                        )
                        .is_err());
                    assert_eq!(model(&d), before);
                    rejects += 1;
                    let undo = d.save_snapshot_native();
                    d.begin_batch_native().unwrap();
                    d.apply_para_format_in_cells_by_paths_native(
                        0,
                        parent,
                        &paths_json,
                        &props.to_string(),
                    )
                    .unwrap();
                    d.end_batch_native().unwrap();
                    assert_eq!(
                        content(&d, &paths, parent, &old),
                        content(&old, &paths, parent, &old),
                        "all unedited content and existing document definitions preserved"
                    );
                    assert_eq!(leaf_semantic(&d, parent, &path), expected);
                    let after = model(&d);
                    let after_svg = svg(&d);
                    let redo = d.save_snapshot_native();
                    for _ in 0..3 {
                        d.restore_snapshot_native(undo).unwrap();
                        assert_eq!(model(&d), before);
                        assert_eq!(svg(&d), before_svg);
                        d.restore_snapshot_native(redo).unwrap();
                        assert_eq!(model(&d), after);
                        assert_eq!(svg(&d), after_svg);
                        restores += 2;
                    }
                    for (format, bytes) in [
                        ("hwp", d.export_hwp_native().unwrap()),
                        ("hwpx", d.export_hwpx_native().unwrap()),
                    ] {
                        let r = DocumentCore::from_bytes(&bytes).unwrap();
                        assert_eq!(leaf_semantic(&r, parent, &path), expected);
                        for p in &paths {
                            let actual: Value = serde_json::from_str(
                                &r.get_cell_para_properties_by_path_native(
                                    0,
                                    parent,
                                    &path_json(p),
                                )
                                .unwrap(),
                            )
                            .unwrap();
                            match id {
                                "align" => assert_eq!(actual["alignment"], "center"),
                                "spacing" => {
                                    assert_eq!(actual["lineSpacing"].as_f64(), Some(200.0))
                                }
                                "indent" => {
                                    assert_eq!(actual["indent"].as_f64(), Some(6.0));
                                    assert_eq!(actual["marginLeft"].as_f64(), Some(14.0));
                                }
                                "dialog" => {
                                    assert_eq!(actual["fillColor"], "#ccff99");
                                    assert_eq!(
                                        actual["borderSpacing"],
                                        json!([100, 200, 300, 400])
                                    );
                                }
                                _ => panic!(),
                            }
                        }
                        std::fs::write(format!("{out}/depth{depth}-merged{merged}-equations{equations}-{id}.{format}"),bytes).unwrap();
                        reopens += 1;
                    }
                    d.discard_snapshot_native(undo);
                    d.discard_snapshot_native(redo);
                    cases += 1;
                }
            }
        }
    }
    let proof = json!({"fixtures":fixtures,"cases":cases,"historyRestores":restores,"reopens":reopens,"rejections":rejects,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
