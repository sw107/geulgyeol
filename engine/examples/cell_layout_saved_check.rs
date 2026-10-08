//! Check typed table geometry/attributes and formatting after WASM two-format exports.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph, table::Table},
};
use serde_json::{json, Value};
fn table(d: &DocumentCore, pi: usize, ci: usize) -> &Table {
    let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
        panic!()
    };
    t
}
fn properties(t: &Table) -> Value {
    json!({"rows":t.row_count,"cols":t.col_count,"spacing":t.cell_spacing,"padding":t.padding,"border":t.border_fill_id,"zones":t.zones,"pageBreak":t.page_break,"repeatHeader":t.repeat_header,"common":{"width":t.common.width,"height":t.common.height,"margin":t.common.margin,"offsets":[t.common.horizontal_offset,t.common.vertical_offset],"z":t.common.z_order,"preventPageBreak":t.common.prevent_page_break,"treatAsChar":t.common.treat_as_char,"flowWithText":t.common.flow_with_text,"overlap":t.common.allow_overlap,"affectLineSpacing":t.common.affect_line_spacing,"vertRelTo":t.common.vert_rel_to,"vertAlign":t.common.vert_align,"horzRelTo":t.common.horz_rel_to,"horzAlign":t.common.horz_align,"textWrap":t.common.text_wrap,"textFlow":t.common.text_flow,"widthCriterion":t.common.width_criterion,"heightCriterion":t.common.height_criterion},"cells":t.cells.iter().map(|c|json!({"row":c.row,"col":c.col,"rowSpan":c.row_span,"colSpan":c.col_span,"width":c.width,"height":c.height,"padding":c.padding,"border":c.border_fill_id,"textDirection":c.text_direction,"lineWrap":c.line_wrap,"verticalAlign":c.vertical_align,"innerMargin":c.apply_inner_margin,"header":c.is_header,"field":c.field_name})).collect::<Vec<_>>()})
}
fn per_char(p: &Paragraph) -> Vec<(char, u32)> {
    p.text
        .chars()
        .enumerate()
        .map(|(i, c)| {
            let pos = p.char_offsets[i];
            (
                c,
                p.char_shapes
                    .iter()
                    .rev()
                    .find(|s| s.start_pos <= pos)
                    .unwrap()
                    .char_shape_id,
            )
        })
        .collect()
}
fn defs(d: &DocumentCore) -> Value {
    let mut chars = serde_json::to_value(&d.document().doc_info.char_shapes).unwrap();
    for c in chars.as_array_mut().unwrap() {
        c.as_object_mut().unwrap().remove("raw_data");
        c.as_object_mut().unwrap().remove("attr");
    }
    json!({"charShapes":chars,"styles":d.document().doc_info.styles.iter().map(|s|json!({"name":s.local_name,"english":s.english_name,"type":s.style_type,"next":s.next_style_id,"char":s.char_shape_id,"para":s.para_shape_id,"lang":s.lang_id})).collect::<Vec<_>>()})
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[0]).unwrap()).unwrap();
    let out = args.last().unwrap();
    std::fs::create_dir_all(out).unwrap();
    let mut result = vec![];
    for r in &rows {
        let source =
            DocumentCore::from_bytes(&std::fs::read(r["input"].as_str().unwrap()).unwrap())
                .unwrap();
        let d =
            DocumentCore::from_bytes(&std::fs::read(r["file"].as_str().unwrap()).unwrap()).unwrap();
        let pi = r["parent"].as_u64().unwrap() as usize;
        let ci = r["control"].as_u64().unwrap() as usize;
        let a = table(&source, pi, ci);
        let b = table(&d, pi, ci);
        assert_eq!(
            properties(b),
            properties(a),
            "typed table properties: {}",
            r["file"]
        );
        assert_eq!(
            defs(&d),
            defs(&source),
            "character shape definitions and style references"
        );
        for (i, c) in b.cells.iter().enumerate() {
            let p = &c.paragraphs[0];
            let old = &a.cells[i].paragraphs[0];
            assert_eq!(p.text, r["expected"][i].as_str().unwrap());
            assert_eq!(
                (p.style_id, p.para_shape_id),
                (old.style_id, old.para_shape_id)
            );
            let x = per_char(p);
            let y = per_char(old);
            if p.text == old.text {
                assert_eq!(x, y);
            } else {
                assert_eq!(&x[..2], &y[..2]);
                assert_eq!(&x[x.len() - 2..], &y[y.len() - 2..]);
            }
        }
        assert_eq!(
            d.document().sections[0]
                .paragraphs
                .iter()
                .map(|p| p.text.as_str())
                .collect::<Vec<_>>(),
            source.document().sections[0]
                .paragraphs
                .iter()
                .map(|p| p.text.as_str())
                .collect::<Vec<_>>()
        );
        result.push(json!({"file":r["file"],"typedTablePropertiesPreserved":true,"characterShapesAndStylesPreserved":true,"paragraphsAndNeighborTextPreserved":true,"pages":d.page_count(),"livePages":r["liveGeometry"]["pageCount"],"reopenedPages":r["reopenedGeometry"]["pageCount"]}));
    }
    let proof = json!({"nativeVerifiedExports":rows.len(),"typedPropertiesIncludeGeometryRawGetterOmitted":true,"rows":result,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("native verified {} table/format exports", rows.len());
}
