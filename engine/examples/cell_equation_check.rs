//! Synthetic native save/reopen + targeting regression (no private documents).
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        paragraph::{CharShapeRef, Paragraph},
    },
};
use serde_json::{json, Value};
fn idx(s: &str, key: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[key]
        .as_u64()
        .unwrap() as usize
}
fn cell(d: &DocumentCore, p: usize, t: usize, c: usize) -> &Paragraph {
    match &d.document().sections[0].paragraphs[p].controls[t] {
        Control::Table(t) => &t.cells[c].paragraphs[0],
        _ => panic!("table"),
    }
}
fn semantic(d: &DocumentCore, p: usize, t: usize) -> Value {
    let cells: Vec<_> = (0..4).map(|c| {
        let p = cell(d,p,t,c);
        let styles: Vec<_> = (0..p.text.chars().count()).map(|i| {
            let s = &d.document().doc_info.char_shapes[p.char_shape_id_at(i).unwrap() as usize];
            json!([s.bold,s.base_size])
        }).collect();
        let equations: Vec<_> = p.controls.iter().map(|c| match c {
            Control::Equation(e) => json!([e.script,e.font_size,e.color,e.common.instance_id,e.common.treat_as_char]), _ => panic!("unexpected cell control")
        }).collect();
        json!({"text":p.text,"styles":styles,"equations":equations,"positions":p.logical_control_positions()})
    }).collect();
    let body: Vec<_> = d.document().sections[0]
        .paragraphs
        .iter()
        .flat_map(|p| &p.controls)
        .filter_map(|c| match c {
            Control::Equation(e) => Some(json!([e.script, e.font_size, e.common.instance_id])),
            _ => None,
        })
        .collect();
    json!({"cells":cells,"body":body})
}
fn transition(
    d: &mut DocumentCore,
    p: usize,
    t: usize,
    f: impl FnOnce(&mut DocumentCore),
    count: &mut usize,
) {
    let before = semantic(d, p, t);
    let undo = d.save_snapshot_native();
    f(d);
    let after = semantic(d, p, t);
    let redo = d.save_snapshot_native();
    assert_ne!(before, after, "operation changed semantic state");
    d.restore_snapshot_native(undo).unwrap();
    assert_eq!(semantic(d, p, t), before, "undo");
    d.restore_snapshot_native(redo).unwrap();
    assert_eq!(semantic(d, p, t), after, "redo");
    *count += 1;
}
fn reopen(
    d: &DocumentCore,
    p: usize,
    t: usize,
    out: &str,
    case: usize,
    stage: &str,
    count: &mut usize,
) {
    let expected = semantic(d, p, t);
    for (format, bytes) in [
        ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        let mut r = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(
            semantic(&r, p, t),
            expected,
            "{format} reopened {stage} case {case}"
        );
        // Exercise editing after reopen as well as merely parsing the saved file.
        let old: Value = serde_json::from_str(
            &r.get_equation_properties_in_cell_native(0, p, t, 0, 0, 1)
                .unwrap(),
        )
        .unwrap();
        r.set_equation_properties_in_cell_native(0, p, t, 0, 0, 1, "{\"script\":\"reopened ^2\"}")
            .unwrap();
        let new: Value = serde_json::from_str(
            &r.get_equation_properties_in_cell_native(0, p, t, 0, 0, 1)
                .unwrap(),
        )
        .unwrap();
        assert_ne!(new["script"], old["script"]);
        assert_eq!(semantic(&r, p, t)["body"], expected["body"]);
        if case == 0 {
            std::fs::write(format!("{out}/cell-equations-{stage}.{format}"), bytes).unwrap();
        }
        *count += 1;
    }
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut history, mut reopens, mut rejected) = (0, 0, 0, 0);
    for source in ["hwp", "hwpx"] {
        for text in ["", "앞😀\t뒤 한글", "abcdef"] {
            for anchor_kind in 0..3 {
                for target_cell in 0..4 {
                    let mut blank = DocumentCore::new_empty();
                    blank.create_blank_document_native().unwrap();
                    let input = if source == "hwp" {
                        blank.export_hwp_with_adapter_snapshot().unwrap()
                    } else {
                        blank.export_hwpx_native().unwrap()
                    };
                    let mut d = DocumentCore::from_bytes(&input).unwrap();
                    let table = d.create_table_native(0, 0, 0, 2, 2).unwrap();
                    let p = idx(&table, "paraIdx");
                    let t = idx(&table, "controlIdx");
                    let body_result = d
                        .insert_equation_native(0, p + 1, 0, "body = 123", 1000, 0)
                        .unwrap();
                    let bp = idx(&body_result, "paraIdx");
                    let bi = idx(&body_result, "controlIdx");
                    let body_before = d
                        .get_equation_properties_native(0, bp, bi, None, None)
                        .unwrap();
                    for c in 0..4 {
                        d.insert_text_in_cell_native(0, p, t, c, 0, 0, text)
                            .unwrap();
                    }
                    let mut bold = d.document().doc_info.char_shapes[0].clone();
                    bold.bold = true;
                    bold.base_size = 1400;
                    bold.raw_data = None;
                    let id = d.document().doc_info.char_shapes.len() as u32;
                    d.document_mut().doc_info.char_shapes.push(bold);
                    if let Control::Table(table) =
                        &mut d.document_mut().sections[0].paragraphs[p].controls[t]
                    {
                        for c in &mut table.cells {
                            let cp = &mut c.paragraphs[0];
                            if !cp.char_offsets.is_empty() {
                                cp.char_shapes = vec![CharShapeRef {
                                    start_pos: 0,
                                    char_shape_id: 0,
                                }];
                                if cp.char_offsets.len() > 1 {
                                    cp.char_shapes.push(CharShapeRef {
                                        start_pos: *cp.char_offsets.last().unwrap(),
                                        char_shape_id: id,
                                    });
                                }
                            }
                        }
                    }
                    let text_len = text.chars().count();
                    let anchor = match anchor_kind {
                        0 => 0,
                        1 => text_len / 2,
                        _ => text_len,
                    };
                    let styles_before = semantic(&d, p, t)["cells"][target_cell]["styles"].clone();
                    for (k, script) in ["a over b", "x _1 ^2", "matrix {1 # 2 ; 3 # 4}"]
                        .iter()
                        .enumerate()
                    {
                        transition(
                            &mut d,
                            p,
                            t,
                            |d| {
                                let r = d
                                    .insert_equation_in_cell_native(
                                        0,
                                        p,
                                        t,
                                        target_cell,
                                        0,
                                        anchor + k,
                                        script,
                                        1000,
                                        0,
                                    )
                                    .unwrap();
                                assert_eq!(idx(&r, "controlIdx"), k);
                            },
                            &mut history,
                        );
                    }
                    // Insert before an existing adjacent equation, then remove it.
                    transition(
                        &mut d,
                        p,
                        t,
                        |d| {
                            assert_eq!(
                                idx(
                                    &d.insert_equation_in_cell_native(
                                        0,
                                        p,
                                        t,
                                        target_cell,
                                        0,
                                        anchor,
                                        "before",
                                        1000,
                                        0
                                    )
                                    .unwrap(),
                                    "controlIdx"
                                ),
                                0
                            );
                        },
                        &mut history,
                    );
                    transition(
                        &mut d,
                        p,
                        t,
                        |d| {
                            d.delete_equation_control_in_cell_native(0, p, t, target_cell, 0, 0)
                                .unwrap();
                        },
                        &mut history,
                    );
                    // Body insertion must also avoid IDs already used in cells.
                    d.insert_equation_native(0, p + 1, 1, "body after cells", 1000, 0)
                        .unwrap();
                    let before = semantic(&d, p, t);
                    assert_eq!(before["cells"][target_cell]["styles"], styles_before);
                    transition(
                        &mut d,
                        p,
                        t,
                        |d| {
                            d.set_equation_properties_in_cell_native(0,p,t,target_cell,0,1,"{\"script\":\"sqrt {alpha + beta}\",\"fontSize\":1300,\"color\":255}").unwrap();
                        },
                        &mut history,
                    );
                    let after = semantic(&d, p, t);
                    assert_eq!(
                        before["cells"][target_cell]["equations"][0],
                        after["cells"][target_cell]["equations"][0]
                    );
                    assert_eq!(
                        before["cells"][target_cell]["equations"][2],
                        after["cells"][target_cell]["equations"][2]
                    );
                    assert_eq!(
                        d.get_equation_properties_native(0, bp, bi, None, None)
                            .unwrap(),
                        body_before
                    );
                    // Layout click targets must use the *inner* equation index and table path.
                    let mut targets = vec![];
                    for page in 0..d.page_count() {
                        let layout: Value = serde_json::from_str(
                            &d.get_page_control_layout_native(page as u32).unwrap(),
                        )
                        .unwrap();
                        for c in layout["controls"].as_array().expect("controls") {
                            if c["type"] == "equation" && c["cellIdx"] == target_cell {
                                assert_eq!(c["outerTableControlIdx"], t);
                                assert_eq!(c["cellPath"].as_array().unwrap().len(), 1);
                                targets.push(c["controlIdx"].as_u64().unwrap());
                            }
                        }
                    }
                    targets.sort();
                    assert_eq!(targets, vec![0, 1, 2], "precise cell layout targets");
                    // Reopen checks always target cell 0; additional cell is kept independent.
                    if target_cell != 0 {
                        for (k, s) in ["other0", "other1", "other2"].iter().enumerate() {
                            d.insert_equation_in_cell_native(0, p, t, 0, 0, k, s, 1000, 0)
                                .unwrap();
                        }
                    }
                    reopen(&d, p, t, &out, cases, "edited", &mut reopens);
                    let neighbor = semantic(&d, p, t)["cells"][(target_cell + 1) % 4].clone();
                    transition(
                        &mut d,
                        p,
                        t,
                        |d| {
                            d.delete_equation_control_in_cell_native(0, p, t, target_cell, 0, 1)
                                .unwrap();
                        },
                        &mut history,
                    );
                    let deleted = semantic(&d, p, t);
                    assert_eq!(
                        deleted["cells"][target_cell]["equations"][0],
                        after["cells"][target_cell]["equations"][0]
                    );
                    assert_eq!(
                        deleted["cells"][target_cell]["equations"][1],
                        after["cells"][target_cell]["equations"][2]
                    );
                    assert_eq!(deleted["cells"][(target_cell + 1) % 4], neighbor);
                    assert_eq!(deleted["cells"][target_cell]["styles"], styles_before);
                    assert_eq!(
                        d.get_equation_properties_native(0, bp, bi, None, None)
                            .unwrap(),
                        body_before
                    );
                    reopen(&d, p, t, &out, cases, "deleted", &mut reopens);
                    let ids: Vec<_> = deleted["cells"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .flat_map(|c| {
                            c["equations"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|e| e[3].as_u64().unwrap())
                        })
                        .chain(
                            deleted["body"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|e| e[2].as_u64().unwrap()),
                        )
                        .collect();
                    assert_eq!(
                        ids.iter().collect::<std::collections::HashSet<_>>().len(),
                        ids.len(),
                        "unique instance IDs"
                    );
                    if cases == 0 {
                        for n in 0..10 {
                            let before = format!("{:?}", d.document());
                            let result = match n {
                                0 => d.insert_equation_in_cell_native(
                                    99, p, t, 0, 0, 0, "x", 1000, 0,
                                ),
                                1 => d.insert_equation_in_cell_native(
                                    0, p, t, 99, 0, 0, "x", 1000, 0,
                                ),
                                2 => d.insert_equation_in_cell_native(
                                    0, p, t, 0, 0, 999, "x", 1000, 0,
                                ),
                                3 => d.insert_equation_in_cell_native(0, p, t, 0, 0, 0, "x", 0, 0),
                                4 => d.insert_equation_in_cell_native(
                                    0,
                                    p,
                                    t,
                                    0,
                                    0,
                                    0,
                                    &"😀".repeat(4001),
                                    1000,
                                    0,
                                ),
                                5 => d.set_equation_properties_in_cell_native(
                                    0,
                                    p,
                                    t,
                                    0,
                                    0,
                                    1,
                                    "{\"treatAsChar\":false}",
                                ),
                                6 => d.set_equation_properties_in_cell_native(
                                    0,
                                    p,
                                    t,
                                    0,
                                    0,
                                    1,
                                    "{\"fontSize\":-1}",
                                ),
                                7 => d.set_equation_properties_in_cell_native(
                                    0,
                                    p,
                                    t,
                                    0,
                                    0,
                                    1,
                                    "{\"width\":4294967295}",
                                ),
                                8 => d.set_equation_properties_in_cell_native(
                                    0, p, t, 0, 0, 99, "{}",
                                ),
                                _ => d.delete_equation_control_in_cell_native(0, p, t, 0, 0, 99),
                            };
                            assert!(result.is_err(), "rejected {n}");
                            assert_eq!(
                                format!("{:?}", d.document()),
                                before,
                                "atomic rejection {n}"
                            );
                            rejected += 1;
                        }
                    }
                    cases += 1;
                }
            }
        }
    }
    let proof = json!({"cases":cases,"snapshot_undo_redo_operations":history,"hwp_hwpx_reopens":reopens,"atomic_rejections":rejected,"precise_cell_layout_targets":true,"body_and_neighbor_preserved":true,"native_GUI_verified":false,"physical_IME_verified":false});
    std::fs::write(
        format!("{out}/native-equation-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
