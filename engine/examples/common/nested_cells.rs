//! Shared synthetic nested-table fixtures and model projections.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        paragraph::{CharShapeRef, Paragraph},
        table::Table,
    },
};
use serde_json::{json, Value};
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
pub fn path_json(path: &[(usize, usize, usize)]) -> String {
    serde_json::to_string(
        &path
            .iter()
            .map(|p| json!({"controlIndex":p.0,"cellIndex":p.1,"cellParaIndex":p.2}))
            .collect::<Vec<_>>(),
    )
    .unwrap()
}
pub fn table<'a>(p: &'a Paragraph, path: &[(usize, usize, usize)]) -> &'a Table {
    let Control::Table(t) = &p.controls[path[0].0] else {
        panic!()
    };
    if path.len() == 1 {
        t
    } else {
        table(&t.cells[path[0].1].paragraphs[path[0].2], &path[1..])
    }
}
pub fn table_mut<'a>(p: &'a mut Paragraph, path: &[(usize, usize, usize)]) -> &'a mut Table {
    let Control::Table(t) = &mut p.controls[path[0].0] else {
        panic!()
    };
    if path.len() == 1 {
        t
    } else {
        table_mut(&mut t.cells[path[0].1].paragraphs[path[0].2], &path[1..])
    }
}
pub fn model(d: &DocumentCore) -> String {
    fn clear(ps: &mut [Paragraph]) {
        for p in ps {
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
    let mut x = d.document().clone();
    for s in &mut x.sections {
        clear(&mut s.paragraphs)
    }
    format!("{x:?}")
}
pub fn svg(d: &DocumentCore) -> Vec<String> {
    (0..d.page_count())
        .map(|i| d.render_page_svg_native(i).unwrap())
        .collect()
}
pub fn fixture(depth: usize, merged: bool) -> (DocumentCore, usize, Vec<(usize, usize, usize)>) {
    fixture_variant(depth, merged, false)
}
pub fn fixture_variant(
    depth: usize,
    merged: bool,
    equations: bool,
) -> (DocumentCore, usize, Vec<(usize, usize, usize)>) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "본문 보존😀").unwrap();
    let r = d.create_table_native(0, 0, 0, 2, 2).unwrap();
    let pi = idx(&r, "paraIdx");
    let ci = idx(&r, "controlIdx");
    if merged {
        d.merge_table_cells_native(0, pi, ci, 1, 0, 1, 1).unwrap();
    }
    d.set_cell_properties_native(0,pi,ci,0,r##"{"paddingLeft":400,"paddingRight":600,"paddingTop":200,"paddingBottom":300,"verticalAlign":1,"applyInnerMargin":true,"fillType":"solid","fillColor":"#CBFF99","fieldName":"synthetic-copy","editableInForm":true}"##).unwrap();
    let mut cs = d.document().doc_info.char_shapes[0].clone();
    cs.bold = true;
    cs.base_size = 1800;
    cs.raw_data = None;
    let char_id = d.document().doc_info.char_shapes.len() as u32;
    d.document_mut().doc_info.char_shapes.push(cs);
    let mut ps = d.document().doc_info.para_shapes[0].clone();
    ps.margin_left = 1200;
    ps.indent = 600;
    ps.raw_data = None;
    let para_id = d.document().doc_info.para_shapes.len() as u16;
    d.document_mut().doc_info.para_shapes.push(ps);
    let body = d.document().sections[0].paragraphs[pi + 1].clone();
    let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
        panic!()
    };
    let mut leaf = t.clone();
    for (i, c) in leaf.cells.iter_mut().enumerate() {
        c.paragraphs = (0..2)
            .map(|n| {
                let mut p = Paragraph::new_empty_like(&body);
                p.insert_text_at(0, &format!("앞😀셀{i}문단{n} 뒤🧪"));
                p.char_shapes = vec![CharShapeRef {
                    start_pos: 0,
                    char_shape_id: if i == 0 { char_id } else { 0 },
                }];
                p.para_shape_id = if i == 0 { para_id } else { body.para_shape_id };
                p
            })
            .collect();
    }
    if equations {
        d.document_mut().sections[0].paragraphs[pi].controls[ci] = Control::Table(leaf);
        let doc = d.document().clone();
        d.set_document(doc);
        d.apply_char_format_in_cell_native(
            0,
            pi,
            ci,
            1,
            0,
            0,
            2,
            r#"{"italic":true,"fontSize":1200}"#,
        )
        .unwrap();
        d.insert_equation_in_cell_native(0, pi, ci, 1, 0, 2, "a over b", 1000, 0)
            .unwrap();
        d.insert_equation_in_cell_native(0, pi, ci, 1, 0, 5, "x _1 ^2", 1200, 0)
            .unwrap();
        let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
            panic!()
        };
        leaf = t.clone();
        leaf.cells[1].paragraphs[0].style_id = 1;
        leaf.cells[2].paragraphs[0].style_id = 2;
    }
    let mut root = leaf.clone();
    let mut path = vec![(ci, 0, 0)];
    for _ in 1..depth {
        let mut outer = leaf.clone();
        let mut host = Paragraph::new_empty_like(&body);
        host.controls = vec![Control::Table(root)];
        host.char_count += 8;
        host.align_ctrl_data_records();
        outer.cells[1].paragraphs = vec![body.clone(), host];
        root = outer;
        path.insert(1, (0, 0, 0));
    }
    for p in path.iter_mut().take(depth - 1) {
        p.1 = 1;
        p.2 = 1;
    }
    d.document_mut().sections[0].paragraphs[pi].controls[ci] = Control::Table(root);
    d.document_mut().sections[0].raw_stream = None;
    d.document_mut().doc_info.raw_stream_dirty = true;
    let doc = d.document().clone();
    d.set_document(doc);
    (d, pi, path)
}
pub fn paragraph_content(ps: &[Paragraph]) -> String {
    let mut ps = ps.to_vec();
    for p in &mut ps {
        p.line_segs.clear();
        p.single_line_overflow_memo.clear();
    }
    format!("{ps:?}")
}
