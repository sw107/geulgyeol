//! Source-scalar caret versus the actual inserted glyph in synthetic endnotes.
//! MODE(observe|fixed) MANIFEST FRESH_OUTPUT. No application/IME claim.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
    renderer::render_tree::{RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn note<'a>(d: &'a DocumentCore, source: &[usize; 4]) -> &'a Paragraph {
    match &d.document().sections[source[0]].paragraphs[source[1]].controls[source[2]] {
        Control::Endnote(n) => &n.paragraphs[source[3]],
        _ => panic!("endnote"),
    }
}
fn equations(p: &Paragraph) -> Value {
    json!(p.controls.iter().filter_map(|c| if let Control::Equation(e)=c {
        Some(json!({"script":e.script,"width":e.common.width,"height":e.common.height,
            "fontSize":e.font_size,"baseline":e.baseline,"attr":e.attr,"inline":e.common.treat_as_char}))
    } else {None}).collect::<Vec<_>>())
}
fn caret(d: &DocumentCore, source: &[usize; 4], offset: usize) -> Value {
    match d.get_cursor_rect_in_note_native(source[0], source[1], source[2], source[3], offset) {
        Ok(s) => serde_json::from_str(&s).unwrap(),
        Err(e) => json!({"error":e.to_string()}),
    }
}
fn glyph(node: &RenderNode, page: usize, found: &mut Vec<Value>) {
    if let RenderNodeType::TextRun(t) = &node.node_type {
        if let Some(i) = t.text.chars().position(|c| c == '◆') {
            assert_eq!(i, 0, "marker has its own symbol-font run");
            found.push(json!({"pageIndex":page,"x":node.bbox.x,
                "y":node.bbox.y+t.baseline-t.style.font_size*0.8,
                "height":t.style.font_size,"owner":t.section_index,"virtualPara":t.para_index,
                "logicalSlot":t.char_start.map(|s|s+i),"runText":t.text}));
        }
    }
    for child in &node.children {
        glyph(child, page, found)
    }
}
fn inserted_glyph(d: &DocumentCore) -> Value {
    let mut result = vec![];
    for page in 0..d.page_count() {
        glyph(
            &d.build_page_render_tree(page).unwrap().root,
            page as usize,
            &mut result,
        );
    }
    assert_eq!(result.len(), 1, "unique synthetic marker glyph");
    result.remove(0)
}
fn body(d: &DocumentCore) -> Vec<Vec<String>> {
    d.document()
        .sections
        .iter()
        .map(|s| s.paragraphs.iter().map(|p| p.text.clone()).collect())
        .collect()
}
fn reference(d: &DocumentCore, source: &[usize; 4], offset: usize) -> Value {
    fn walk(
        n: &RenderNode,
        source: &[usize; 4],
        eqs: &mut Vec<Value>,
        texts: &mut Vec<(usize, usize)>,
    ) {
        match &n.node_type {
            RenderNodeType::Equation(e)
                if e.note_ref.as_ref().is_some_and(|s| {
                    [
                        s.section_index,
                        s.para_index,
                        s.control_index,
                        s.note_para_index,
                    ] == *source
                }) =>
            {
                eqs.push(json!({"ci":e.control_index,"pi":e.para_index,"x":n.bbox.x}));
            }
            RenderNodeType::TextRun(t) if t.cell_context.is_none() => {
                if let (Some(s), Some(p)) = (t.section_index, t.para_index) {
                    texts.push((s, p));
                }
            }
            _ => {}
        }
        for c in &n.children {
            walk(c, source, eqs, texts)
        }
    }
    let p = note(d, source);
    let positions = p.control_text_positions();
    let slot = offset
        + p.controls
            .iter()
            .enumerate()
            .filter(|(i, c)| c.is_logical_inline() && positions[*i] < offset)
            .count()
        + if source[3] == 0 { 3 } else { 0 };
    for page in 0..d.page_count() {
        let mut eqs = vec![];
        let mut texts = vec![];
        walk(
            &d.build_page_render_tree(page).unwrap().root,
            source,
            &mut eqs,
            &mut texts,
        );
        if eqs.is_empty() {
            continue;
        }
        let pi = eqs[0]["pi"].as_u64().unwrap() as usize;
        let owner = texts
            .iter()
            .find(|(_, p)| *p == pi)
            .map(|(s, _)| *s)
            .or_else(|| {
                texts
                    .iter()
                    .find(|(s, p)| *p >= d.document().sections[*s].paragraphs.len())
                    .map(|(s, _)| *s)
            })
            .unwrap();
        let before_equation = eqs
            .iter()
            .filter(|e| positions[e["ci"].as_u64().unwrap() as usize] == offset)
            .filter_map(|e| e["x"].as_f64())
            .min_by(|a, b| a.total_cmp(b));
        let general: Value =
            serde_json::from_str(&d.get_cursor_rect_native(owner, pi, slot).unwrap()).unwrap();
        return json!({"pageIndex":page,"x":before_equation.unwrap_or(general["x"].as_f64().unwrap()),
            "owner":owner,"virtualPara":pi,"logicalSlot":slot,"general":general,
            "beforeEquationBBoxUsed":before_equation.is_some()});
    }
    panic!("source equation missing from render tree")
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(args[0] == "observe" || args[0] == "fixed");
    let cases: Vec<Value> = serde_json::from_slice(&fs::read(&args[1]).unwrap()).unwrap();
    let out = Path::new(&args[2]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    let mut failures = vec![];
    for c in &cases {
        let bytes = fs::read(c["path"].as_str().unwrap()).unwrap();
        let source = [
            c["section"].as_u64().unwrap() as usize,
            c["para"].as_u64().unwrap() as usize,
            c["control"].as_u64().unwrap() as usize,
            c["notePara"].as_u64().unwrap() as usize,
        ];
        let original = DocumentCore::from_bytes(&bytes).unwrap();
        let text = note(&original, &source).text.clone();
        assert_eq!(text, c["expectedText"].as_str().unwrap());
        assert!(!text.contains('◆'));
        let positions = note(&original, &source).control_text_positions();
        let actual: Vec<_> = note(&original, &source)
            .controls
            .iter()
            .enumerate()
            .filter_map(|(i, c)| matches!(c, Control::Equation(_)).then_some(positions[i]))
            .collect();
        let mut expected: Vec<_> = c["expectedEquationPositions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap() as usize)
            .collect();
        let mut sorted = actual.clone();
        sorted.sort();
        expected.sort();
        assert_eq!(sorted, expected);
        for offset in 0..=text.chars().count() {
            let mut d = DocumentCore::from_bytes(&bytes).unwrap();
            let initial = d.save_snapshot_native();
            let original_body = body(&d);
            let eq = equations(note(&d, &source));
            let before_model = format!("{:?}", d.document());
            let before = caret(&d, &source, offset);
            let expected_caret = reference(&d, &source, offset);
            assert_eq!(
                format!("{:?}", d.document()),
                before_model,
                "query is read-only"
            );
            let old_hit = if before["error"].is_null() {
                d.hit_test_native(
                    before["pageIndex"].as_u64().unwrap() as u32,
                    before["x"].as_f64().unwrap(),
                    before["y"].as_f64().unwrap() + before["height"].as_f64().unwrap() * 0.5,
                )
                .map(|s| serde_json::from_str::<Value>(&s).unwrap())
                .unwrap_or_else(|e| json!({"error":e.to_string()}))
            } else {
                Value::Null
            };
            d.insert_text_in_footnote_native(
                source[0], source[1], source[2], source[3], offset, "◆😀",
            )
            .unwrap();
            let expected_text: String = text
                .chars()
                .take(offset)
                .chain("◆😀".chars())
                .chain(text.chars().skip(offset))
                .collect();
            assert_eq!(
                note(&d, &source).text,
                expected_text,
                "API edits requested scalar"
            );
            assert_eq!(equations(note(&d, &source)), eq);
            assert_eq!(body(&d), original_body);
            let actual_glyph = inserted_glyph(&d);
            let aligned = before["pageIndex"] == expected_caret["pageIndex"]
                && before["x"]
                    .as_f64()
                    .zip(expected_caret["x"].as_f64())
                    .is_some_and(|(a, b)| (a - b).abs() <= 0.11);
            let reference_glyph_delta =
                (expected_caret["x"].as_f64().unwrap() - actual_glyph["x"].as_f64().unwrap()).abs();
            let shown_glyph_delta = before["x"]
                .as_f64()
                .map(|x| (x - actual_glyph["x"].as_f64().unwrap()).abs());
            if args[0] == "fixed" {
                assert_eq!(before["pageIndex"], actual_glyph["pageIndex"]);
                assert!(
                    shown_glyph_delta.is_some_and(|x| x <= reference_glyph_delta + 0.11),
                    "insertion glyph alignment must be no worse than the existing body caret"
                );
            }
            if !aligned {
                failures.push(json!({"case":c["case"],"offset":offset,"before":before,"actualInsertedGlyph":actual_glyph}));
            }
            let saved = d.export_hwpx_native().unwrap();
            fs::write(
                out.join(format!("{}-{offset}.hwpx", c["case"].as_str().unwrap())),
                &saved,
            )
            .unwrap();
            let cold = DocumentCore::from_bytes(&saved).unwrap();
            assert_eq!(note(&cold, &source).text, expected_text);
            assert_eq!(equations(note(&cold, &source)), eq);
            assert_eq!(body(&cold), original_body);
            let cold_glyph = inserted_glyph(&cold);
            let cold_y_delta =
                (cold_glyph["y"].as_f64().unwrap() - actual_glyph["y"].as_f64().unwrap()).abs();
            // Current main's saved note line boxes already differ by 2/3 px.
            // Keep that known baseline limit visible; all other glyph fields match.
            let mut cold_without_y = cold_glyph.clone();
            let mut live_without_y = actual_glyph.clone();
            cold_without_y.as_object_mut().unwrap().remove("y");
            live_without_y.as_object_mut().unwrap().remove("y");
            assert_eq!(cold_without_y, live_without_y);
            assert!(cold_y_delta <= 0.7, "existing note line-box rounding bound");
            let edited = d.save_snapshot_native();
            d.restore_snapshot_native(initial).unwrap();
            assert_eq!(note(&d, &source).text, text);
            assert_eq!(caret(&d, &source, offset), before);
            d.restore_snapshot_native(edited).unwrap();
            assert_eq!(note(&d, &source).text, expected_text);
            assert_eq!(inserted_glyph(&d), actual_glyph);
            d.discard_snapshot_native(initial);
            d.discard_snapshot_native(edited);
            rows.push(json!({"case":c["case"],"source":source,"offset":offset,"sourceText":text,
                "controlTextPositions":actual,"caretBeforeEdit":before,"genericHitBeforeEdit":old_hit,
                "referenceCaret":expected_caret,
                "shownCaretToInsertedGlyphDeltaX":shown_glyph_delta,
                "existingBodyReferenceToInsertedGlyphDeltaX":reference_glyph_delta,
                "coldGlyphYDeltaPx":cold_y_delta,
                "sourceAfterEdit":expected_text,"actualInsertedGlyph":actual_glyph,
                "sourceScalarAndRenderCaretAligned":aligned,"dataPreserved":true,"coldAndHistoryPreserved":true}));
        }
    }
    fs::write(out.join("raw.json"),serde_json::to_vec(&json!({"mode":args[0],"GUIVerified":false,
        "scope":"Native source-scalar note API and actual inserted glyph; generic hitTest remains a logical-slot text lookup, not a source-scalar inverse at equation boundaries.",
        "cases":cases.len(),"queries":rows.len(),"failures":failures,"rows":rows})).unwrap()).unwrap();
    println!(
        "cases={} scalar/glyph queries={} geometry failures={}",
        cases.len(),
        rows.len(),
        failures.len()
    );
    if args[0] == "fixed" {
        assert!(
            failures.is_empty(),
            "source-scalar caret must match actual insertion glyph"
        );
    }
}
