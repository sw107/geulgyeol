//! Original scalar spans, literal matching policy, direct formatting and two-format history.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph, shape::TextBox},
};
use serde_json::{json, Value};
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
fn fixture(kind: usize, text: &str) -> (DocumentCore, usize, usize) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, text).unwrap();
    d.apply_char_format_native(0, 0, 0, 2, "{\"bold\":true}")
        .unwrap();
    let n = text.chars().count();
    d.apply_char_format_native(0, 0, n - 2, n, "{\"italic\":true,\"fontSize\":1800}")
        .unwrap();
    let original = d.document().sections[0].paragraphs[0].clone();
    if kind == 0 {
        return (d, 0, 0);
    }
    let mut p = Paragraph::new_empty_like(&original);
    p.insert_text_at(0, text);
    p.char_shapes.clear();
    for i in 0..text.chars().count() {
        let id = char_shape(&original, i);
        if p.char_shapes.last().is_none_or(|c| c.char_shape_id != id) {
            p.char_shapes.push(rhwp::model::paragraph::CharShapeRef {
                start_pos: p.char_offsets[i],
                char_shape_id: id,
            });
        }
    }
    d.delete_text_native(0, 0, 0, n).unwrap();
    d.insert_text_native(0, 0, 0, "바깥 보존🧪").unwrap();
    let r = if kind <= 2 {
        d.create_table_native(0, 0, 0, 1, 1).unwrap()
    } else {
        d.create_shape_control_native(
            0,
            0,
            0,
            12000,
            6000,
            0,
            0,
            false,
            "TopAndBottom",
            "rectangle",
            false,
            false,
            &[],
        )
        .unwrap()
    };
    let (pi, ci) = (idx(&r, "paraIdx"), idx(&r, "controlIdx"));
    if kind <= 2 {
        let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
        else {
            panic!()
        };
        t.cells[0].paragraphs = vec![p];
        if kind == 2 {
            let nested = t.clone();
            let p = &mut t.cells[0].paragraphs[0];
            *p = Paragraph::new_empty_like(p);
            p.controls = vec![Control::Table(nested)];
            p.char_count += 8;
            p.align_ctrl_data_records();
        }
    } else {
        let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
        else {
            panic!()
        };
        s.drawing_mut().unwrap().text_box = Some(TextBox {
            paragraphs: vec![p],
            ..Default::default()
        });
    }
    let document = d.document().clone();
    d.set_document(document);
    (d, pi, ci)
}
fn target(d: &DocumentCore, kind: usize, pi: usize, ci: usize) -> &Paragraph {
    let p = &d.document().sections[0].paragraphs[pi];
    if kind == 0 {
        return p;
    }
    if kind == 3 {
        let Control::Shape(s) = &p.controls[ci] else {
            panic!()
        };
        return &s.drawing().unwrap().text_box.as_ref().unwrap().paragraphs[0];
    }
    let Control::Table(t) = &p.controls[ci] else {
        panic!()
    };
    let p = &t.cells[0].paragraphs[0];
    if kind == 1 {
        p
    } else {
        let Control::Table(t) = &p.controls[0] else {
            panic!()
        };
        &t.cells[0].paragraphs[0]
    }
}
fn char_shape(p: &Paragraph, i: usize) -> u32 {
    let pos = p.char_offsets[i];
    p.char_shapes
        .iter()
        .rev()
        .find(|c| c.start_pos <= pos)
        .unwrap()
        .char_shape_id
}
fn check(
    d: &DocumentCore,
    k: usize,
    pi: usize,
    ci: usize,
    text: &str,
    shapes: &[u32; 4],
    style: u8,
    para: u16,
) {
    let p = target(d, k, pi, ci);
    assert_eq!(p.text, text);
    let n = p.text.chars().count();
    assert_eq!(
        [
            char_shape(p, 0),
            char_shape(p, 1),
            char_shape(p, n - 2),
            char_shape(p, n - 1)
        ],
        *shapes
    );
    assert_eq!((p.style_id, p.para_shape_id), (style, para));
    if k != 0 {
        assert!(d.document().sections[0]
            .paragraphs
            .iter()
            .any(|p| p.text == "바깥 보존🧪"));
    }
}
fn preserved_char_shapes(
    p: &Paragraph,
    original: &[(char, u32)],
    ranges: &[(usize, usize)],
    replacement_length: usize,
) {
    let actual = p.text.chars().collect::<Vec<_>>();
    let (mut old, mut new) = (0, 0);
    for &(start, length) in ranges {
        for &(c, shape) in &original[old..start] {
            assert_eq!((actual[new], char_shape(p, new)), (c, shape));
            new += 1;
        }
        old = start + length;
        new += replacement_length;
    }
    for &(c, shape) in &original[old..] {
        assert_eq!((actual[new], char_shape(p, new)), (c, shape));
        new += 1;
    }
    assert_eq!(
        new,
        actual.len(),
        "all untouched scalar shapes and replacement extent"
    );
}
// Composition may populate this memo during restore; it is not document content.
fn history_state(d: &DocumentCore) -> String {
    fn clear(ps: &mut [Paragraph]) {
        for p in ps {
            p.single_line_overflow_memo.clear();
            for c in &mut p.controls {
                match c {
                    Control::Table(t) => {
                        for c in &mut t.cells {
                            clear(&mut c.paragraphs);
                        }
                    }
                    Control::Shape(s) => {
                        if let Some(b) = s.drawing_mut().and_then(|s| s.text_box.as_mut()) {
                            clear(&mut b.paragraphs);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let mut doc = d.document().clone();
    for s in &mut doc.sections {
        clear(&mut s.paragraphs);
    }
    format!("{doc:?}")
}
fn svgs(d: &DocumentCore) -> Vec<String> {
    (0..d.page_count())
        .map(|i| d.render_page_svg_native(i).unwrap())
        .collect()
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("--verify-files") {
        let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
        for row in &rows {
            let d =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            let c = &row["case"];
            let mut shapes = [0; 4];
            for (i, v) in c["shapes"].as_array().unwrap().iter().enumerate() {
                shapes[i] = v.as_u64().unwrap() as u32;
            }
            check(
                &d,
                c["kind"].as_u64().unwrap() as usize,
                c["parent"].as_u64().unwrap() as usize,
                c["control"].as_u64().unwrap() as usize,
                row["expected"].as_str().unwrap(),
                &shapes,
                c["style"].as_u64().unwrap() as u8,
                c["para"].as_u64().unwrap() as u16,
            );
            let original = c["originalChars"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| {
                    (
                        v[0].as_str().unwrap().chars().next().unwrap(),
                        v[1].as_u64().unwrap() as u32,
                    )
                })
                .collect::<Vec<_>>();
            let ranges = c["ranges"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| {
                    (
                        v[0].as_u64().unwrap() as usize,
                        v[1].as_u64().unwrap() as usize,
                    )
                })
                .collect::<Vec<_>>();
            let changed = if row["expected"] == c["original"] {
                vec![]
            } else if row["expected"] == c["expectedAll"] {
                ranges
            } else {
                ranges.into_iter().take(1).collect()
            };
            preserved_char_shapes(
                target(
                    &d,
                    c["kind"].as_u64().unwrap() as usize,
                    c["parent"].as_u64().unwrap() as usize,
                    c["control"].as_u64().unwrap() as usize,
                ),
                &original,
                &changed,
                c["replacement"].as_str().unwrap_or("Q").chars().count(),
            );
        }
        println!("{{\"nativeVerifiedWasmExports\":{}}}", rows.len());
        return;
    }
    let out = args.first().expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let corpus = [
        ("İAB", "i\u{307}a", "QB", "QB", vec![(0, 2)], false),
        (
            "İA😀TAIL",
            "i\u{307}a",
            "Q😀TAIL",
            "Q😀TAIL",
            vec![(0, 2)],
            false,
        ),
        ("i\u{307}AB", "İA", "QB", "QB", vec![(0, 3)], false),
        ("IAB", "ia", "QB", "QB", vec![(0, 2)], false),
        (
            "가나가나",
            "가나",
            "Q가나",
            "QQ",
            vec![(0, 2), (2, 2)],
            false,
        ),
        (
            "İA X İA",
            "i\u{307}a",
            "Q X İA",
            "Q X Q",
            vec![(0, 2), (5, 2)],
            false,
        ),
        ("😀İA🧪", "i\u{307}a", "😀Q🧪", "😀Q🧪", vec![(1, 2)], false),
        ("ẞß", "ß", "Qß", "QQ", vec![(0, 1), (1, 1)], false),
        ("ß", "SS", "ß", "ß", vec![], false),
        ("é", "e\u{301}", "é", "é", vec![], false),
        ("İAB", "i\u{307}a", "İAB", "İAB", vec![], true),
        (
            "i\u{307}AB",
            "i\u{307}a",
            "i\u{307}AB",
            "i\u{307}AB",
            vec![],
            true,
        ),
        ("İAB", "", "İAB", "İAB", vec![], false),
        ("(A)+ $1", "(a)+", "Q $1", "Q $1", vec![(0, 4)], false),
        ("İX", "i", "QX", "QX", vec![(0, 1)], false),
        ("İX", "\u{307}", "QX", "QX", vec![(0, 1)], false),
        (
            "i\u{307}i\u{307}i\u{307}i\u{307}i\u{307}AB",
            "İİİİİA",
            "QB",
            "QB",
            vec![(0, 11)],
            false,
        ),
    ];
    let (mut cases, mut history, mut reopens, mut unchanged) = (0, 0, 0, 0);
    let mut manifest = vec![];
    let mut history_svg_differences = vec![];
    for (k, case) in (0..4).flat_map(|k| corpus.iter().enumerate().map(move |c| (k, c))) {
        let (id, (source, query, one, all, ranges, sensitive)) = case;
        for api in 0..if k == 0 { 4 } else { 2 } {
            let original = format!("앞😀{source}뒤🧪");
            let (mut d, pi, ci) = fixture(k, &original);
            let p = target(&d, k, pi, ci);
            let n = p.text.chars().count();
            let shapes = [
                char_shape(p, 0),
                char_shape(p, 1),
                char_shape(p, n - 2),
                char_shape(p, n - 1),
            ];
            let (style, para) = (p.style_id, p.para_shape_id);
            let original_chars = p
                .text
                .chars()
                .enumerate()
                .map(|(i, c)| (c, char_shape(p, i)))
                .collect::<Vec<_>>();
            let hits: Value =
                serde_json::from_str(&d.search_all_text_native(query, *sensitive, true).unwrap())
                    .unwrap();
            let actual = hits
                .as_array()
                .unwrap()
                .iter()
                .map(|h| {
                    (
                        h["charOffset"].as_u64().unwrap() as usize,
                        h["length"].as_u64().unwrap() as usize,
                    )
                })
                .collect::<Vec<_>>();
            let expected = ranges.iter().map(|(a, n)| (a + 2, *n)).collect::<Vec<_>>();
            assert_eq!(actual, expected, "search k{k} case{id}");
            let g = d.grep_with_context(query, *sensitive, None, Some(1));
            assert_eq!(
                g.iter()
                    .map(|h| (h.char_offset, h.length))
                    .collect::<Vec<_>>(),
                expected,
                "grep k{k} case{id}"
            );
            let before_svg = svgs(&d);
            let before = format!("{:?}", d.document());
            let before_history = history_state(&d);
            let ev = d.serialize_event_log();
            let undo = d.save_snapshot_native();
            let input = format!("{out}/k{k}-c{id}-a{api}-input.hwpx");
            std::fs::write(&input, d.export_hwpx_native().unwrap()).unwrap();
            let result = match api {
                0 => d.replace_all_native(query, "Q", *sensitive),
                1 => d.replace_nth_native(query, "Q", *sensitive, 0),
                2 => d.replace_one_native(query, "Q", *sensitive),
                _ => {
                    if let Some(h) = hits.as_array().unwrap().first() {
                        d.replace_text_native(
                            0,
                            pi,
                            h["charOffset"].as_u64().unwrap() as usize,
                            h["length"].as_u64().unwrap() as usize,
                            "Q",
                        )
                    } else {
                        d.replace_one_native(query, "Q", *sensitive)
                    }
                }
            }
            .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&result).unwrap()["ok"],
                api < 2 || !ranges.is_empty()
            );
            if !ranges.is_empty() {
                d.repaginate_if_needed();
            }
            let expected_text = format!("앞😀{}뒤🧪", if api == 0 { all } else { one });
            check(&d, k, pi, ci, &expected_text, &shapes, style, para);
            let replaced_ranges = if api == 0 {
                expected.clone()
            } else {
                expected.iter().take(1).copied().collect()
            };
            preserved_char_shapes(target(&d, k, pi, ci), &original_chars, &replaced_ranges, 1);
            if ranges.is_empty() {
                assert_eq!(format!("{:?}", d.document()), before);
                assert_eq!(d.serialize_event_log(), ev);
                unchanged += 1;
            }
            let after = history_state(&d);
            let after_svg = svgs(&d);
            let redo = d.save_snapshot_native();
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(history_state(&d), before_history);
            if svgs(&d) != before_svg {
                history_svg_differences.push(json!({"kind":k,"case":id,"api":api,"stage":"undo"}));
            }
            history += 1;
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(history_state(&d), after);
            if svgs(&d) != after_svg {
                history_svg_differences.push(json!({"kind":k,"case":id,"api":api,"stage":"redo"}));
            }
            history += 1;
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            for (fmt, bytes) in [
                ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                ("hwpx", d.export_hwpx_native().unwrap()),
            ] {
                let file = format!("{out}/k{k}-c{id}-a{api}.{fmt}");
                std::fs::write(&file, &bytes).unwrap();
                let reopened = DocumentCore::from_bytes(&bytes).unwrap();
                check(&reopened, k, pi, ci, &expected_text, &shapes, style, para);
                preserved_char_shapes(
                    target(&reopened, k, pi, ci),
                    &original_chars,
                    &replaced_ranges,
                    1,
                );
                reopens += 1;
            }
            manifest.push(json!({"id":format!("k{k}-c{id}-a{api}"),"kind":k,"input":input,"parent":pi,"control":ci,"query":query,"sensitive":sensitive,"original":original,"expectedOne":format!("앞😀{one}뒤🧪"),"expectedAll":format!("앞😀{all}뒤🧪"),"replacement":"Q","matches":ranges.len(),"ranges":expected,"shapes":shapes,"originalChars":original_chars,"style":style,"para":para}));
            cases += 1;
        }
    }
    std::fs::write(
        format!("{out}/manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    let proof = json!({"cases":cases,"historyRestores":history,"reopens":reopens,"unchanged":unchanged,"historySvgDifferences":history_svg_differences,"regexSupported":false,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
