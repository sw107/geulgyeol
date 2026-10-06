use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::LineSeg, shape::ShapeObject},
    renderer::render_tree::{RenderNode, RenderNodeType},
};
fn visit(n: &RenderNode, images: &mut Vec<(u16, [f64; 8])>, text: &mut Vec<String>) {
    if let RenderNodeType::Image(i) = &n.node_type {
        let b = i.transform.effective_image_bbox(&n.bbox);
        let (cx, cy) = (b.x + b.width / 2., b.y + b.height / 2.);
        let (s, c) = i.transform.rotation.to_radians().sin_cos();
        let fx = if i.transform.horz_flip { -1. } else { 1. };
        let fy = if i.transform.vert_flip { -1. } else { 1. };
        let mut p = [0.; 8];
        for (k, (x, y)) in [(0., 0.), (b.width, 0.), (b.width, b.height), (0., b.height)]
            .into_iter()
            .enumerate()
        {
            let (dx, dy) = (fx * (x - b.width / 2.), fy * (y - b.height / 2.));
            p[2 * k] = cx + c * dx - s * dy;
            p[2 * k + 1] = cy + s * dx + c * dy;
        }
        images.push((i.bin_data_id, p));
    }
    if let RenderNodeType::TextRun(t) = &n.node_type {
        if !t.text.is_empty() {
            text.push(format!("{}|{:?}", t.text, n.bbox));
        }
    }
    for child in &n.children {
        visit(child, images, text)
    }
}
fn snap(d: &DocumentCore) -> (Vec<(u16, [f64; 8])>, Vec<String>, Vec<String>) {
    let (mut images, mut text) = (vec![], vec![]);
    for p in 0..d.page_count() {
        text.push(format!("PAGE{p}"));
        visit(
            &d.build_page_render_tree(p).unwrap().root,
            &mut images,
            &mut text,
        )
    }
    fn crop(s: &ShapeObject, out: &mut Vec<String>) {
        match s {
            ShapeObject::Picture(p) => {
                out.push(format!("{}:{:?}", p.image_attr.bin_data_id, p.crop))
            }
            ShapeObject::Group(g) => {
                for c in &g.children {
                    crop(c, out)
                }
            }
            _ => {}
        }
    }
    let mut crops = vec![];
    for p in &d.document().sections[0].paragraphs {
        for c in &p.controls {
            match c {
                Control::Picture(p) => {
                    crops.push(format!("{}:{:?}", p.image_attr.bin_data_id, p.crop))
                }
                Control::Shape(s) => crop(s, &mut crops),
                _ => {}
            }
        }
    }
    crops.sort();
    (images, text, crops)
}
fn compare(
    a: &(Vec<(u16, [f64; 8])>, Vec<String>, Vec<String>),
    b: &(Vec<(u16, [f64; 8])>, Vec<String>, Vec<String>),
) -> f64 {
    assert_eq!(a.1, b.1, "body text layout");
    assert_eq!(a.2, b.2, "crop");
    assert_eq!(a.0.len(), b.0.len());
    let mut max = 0f64;
    for (id, p) in &a.0 {
        let q = &b.0.iter().find(|(i, _)| i == id).unwrap().1;
        for k in 0..8 {
            let e = (p[k] - q[k]).abs();
            max = max.max(e);
            assert!(e < 0.04, "image{id} corner{k}:{} vs {}", p[k], q[k]);
        }
    }
    max
}
fn semantic_styles(d: &DocumentCore) -> Vec<(bool, i32)> {
    let p = &d.document().sections[0].paragraphs[0];
    (0..p.text.chars().count())
        .map(|i| {
            let id = p.char_shape_id_at(i).unwrap() as usize;
            let cs = &d.document().doc_info.char_shapes[id];
            (cs.bold, cs.base_size)
        })
        .collect()
}
fn binary_data(d: &DocumentCore) -> Vec<(u16, Vec<u8>)> {
    d.document()
        .bin_data_content
        .iter()
        .map(|b| (b.id, b.data.load()))
        .collect()
}
fn reject(d: &mut DocumentCore, label: &str) {
    let before = format!("{:?}", d.document());
    assert!(d.ungroup_shape_native(0, 0, 2).is_err(), "accepted {label}");
    assert_eq!(
        format!("{:?}", d.document()),
        before,
        "mutated rejected {label}"
    );
    println!("REJECT {label}: atomic");
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(
        args.len(),
        3,
        "usage: stored_row_ungroup_check FIXTURE_DIR OUTPUT_DIR"
    );
    let (r, q) = (&args[1], &args[2]);
    std::fs::create_dir_all(q).unwrap();
    let (mut cases, mut count, mut max) = (0, 0, 0f64);
    let mut representative = vec![];
    for source in ["hwp", "hwpx"] {
        for (height, y, width) in [(1000, 0, 42520), (3600, 720, 40000), (18000, 1440, 38000)] {
            for angle in [15, 90, -15] {
                for flip in [false, true] {
                    for anchor in [0usize, 10, usize::MAX] {
                        let bytes =
                            std::fs::read(format!("{r}/native-rotated-resize-120x130.{source}"))
                                .unwrap();
                        let mut d = DocumentCore::from_bytes(&bytes).unwrap();
                        // The original fixture deliberately mixes an inline image
                        // with floating images. The supported fixture removes only
                        // that image, retaining body text and the other objects.
                        d.delete_picture_control_native(0, 0, 5).unwrap();
                        let end = d.document().sections[0].paragraphs[0].text.chars().count();
                        d.insert_text_native(0, 0, end, " 😀 끝").unwrap();
                        d.set_shape_properties_native(
                            0,
                            0,
                            2,
                            &format!("{{\"rotationAngle\":{angle},\"horzFlip\":{flip}}}"),
                        )
                        .unwrap();
                        let mut bold = d.document().doc_info.char_shapes[0].clone();
                        bold.raw_data = None;
                        bold.bold = true;
                        bold.attr |= 2;
                        let bold_id = d.document().doc_info.char_shapes.len() as u32;
                        d.document_mut().doc_info.char_shapes.push(bold);
                        let p = &mut d.document_mut().sections[0].paragraphs[0];
                        let anchor = anchor.min(p.text.chars().count());
                        // Explicit synthetic PARA_TEXT: two structural controls
                        // lead; group and two other images share the chosen gap.
                        let mut raw = 16;
                        p.char_offsets = p
                            .text
                            .chars()
                            .enumerate()
                            .map(|(i, ch)| {
                                if i == anchor {
                                    raw += 24;
                                }
                                let offset = raw;
                                raw += ch.len_utf16() as u32;
                                offset
                            })
                            .collect();
                        if anchor == p.text.chars().count() {
                            raw += 24;
                        }
                        p.char_count = raw + 1;
                        p.char_shapes = vec![
                            rhwp::model::paragraph::CharShapeRef {
                                start_pos: 0,
                                char_shape_id: 0,
                            },
                            rhwp::model::paragraph::CharShapeRef {
                                start_pos: p.char_offsets[3],
                                char_shape_id: bold_id,
                            },
                            rhwp::model::paragraph::CharShapeRef {
                                start_pos: p.char_offsets[15],
                                char_shape_id: 0,
                            },
                        ];
                        p.line_segs = vec![LineSeg {
                            text_start: 0,
                            vertical_pos: y,
                            line_height: height,
                            text_height: 800,
                            baseline_distance: 640,
                            line_spacing: 0,
                            column_start: 0,
                            segment_width: width,
                            tag: 0,
                        }];
                        let input = if source == "hwp" {
                            d.export_hwp_with_adapter_snapshot().unwrap()
                        } else {
                            d.export_hwpx_native().unwrap()
                        };
                        let mut d = DocumentCore::from_bytes(&input).unwrap();
                        let p = &d.document().sections[0].paragraphs[0];
                        assert!(!p.text.is_empty());
                        assert_eq!(p.controls.len(), 5);
                        let rows = format!("{:?}", p.line_segs);
                        let before_offsets = p.char_offsets.clone();
                        let styles = semantic_styles(&d);
                        let images = binary_data(&d);
                        assert!(styles.iter().any(|(bold, _)| *bold), "styled fixture");
                        let before = snap(&d);
                        let pages = d.page_count();
                        let undo = d.save_snapshot_native();
                        d.ungroup_shape_native(0, 0, 2).unwrap();
                        let p = &d.document().sections[0].paragraphs[0];
                        assert_eq!(p.controls.len(), 6);
                        assert!(!p.stored_text_partition_is_dirty());
                        let expected_offsets: Vec<_> = before_offsets
                            .iter()
                            .enumerate()
                            .map(|(i, &pos)| pos + if i >= anchor { 8 } else { 0 })
                            .collect();
                        assert_eq!(p.char_offsets, expected_offsets, "UTF16 stream ownership");
                        assert_eq!(semantic_styles(&d), styles, "live character formatting");
                        let after = snap(&d);
                        let redo = d.save_snapshot_native();
                        d.restore_snapshot_native(undo).unwrap();
                        compare(&before, &snap(&d));
                        assert_eq!(
                            d.document().sections[0].paragraphs[0].char_offsets,
                            before_offsets
                        );
                        assert_eq!(semantic_styles(&d), styles);
                        d.restore_snapshot_native(redo).unwrap();
                        compare(&after, &snap(&d));
                        assert_eq!(semantic_styles(&d), styles);
                        assert_eq!(
                            format!("{:?}", d.document().sections[0].paragraphs[0].line_segs),
                            rows
                        );
                        max = max.max(compare(&before, &snap(&d)));
                        for (format, bytes) in [
                            ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                            ("hwpx", d.export_hwpx_native().unwrap()),
                        ] {
                            let saved = DocumentCore::from_bytes(&bytes).unwrap();
                            assert_eq!(binary_data(&saved), images, "embedded image bytes");
                            assert_eq!(
                                format!(
                                    "{:?}",
                                    saved.document().sections[0].paragraphs[0].line_segs
                                ),
                                rows,
                                "saved rows"
                            );
                            assert_eq!(saved.page_count(), pages);
                            assert_eq!(
                                semantic_styles(&saved),
                                styles,
                                "saved character formatting"
                            );
                            max = max.max(compare(&before, &snap(&saved)));
                            if source == "hwpx"
                                && height == 1000
                                && angle == 15
                                && !flip
                                && anchor == 0
                            {
                                std::fs::write(format!("{q}/after-ungroup.{format}"), &bytes)
                                    .unwrap();
                            }
                            count += 1;
                        }
                        if source == "hwpx" && height == 1000 && angle == 15 && !flip && anchor == 0
                        {
                            representative = input;
                            std::fs::write(
                                format!("{q}/representative-stored.hwpx"),
                                &representative,
                            )
                            .unwrap();
                        }
                        cases += 1;
                        println!("PASS CASE {source}/{height}/{angle}/{flip}/anchor{anchor}");
                    }
                }
            }
        }
    }
    let mut rejected = 0;
    for variant in 0..13 {
        let mut d = DocumentCore::from_bytes(&representative).unwrap();
        let p = &mut d.document_mut().sections[0].paragraphs[0];
        let label = match variant {
            0 => {
                let mut row = p.line_segs[0].clone();
                row.text_start = 8;
                p.line_segs.push(row);
                "multiple stored rows"
            }
            1 => {
                p.line_segs[0].text_start = 8;
                "nonzero first row"
            }
            2 => {
                p.line_segs[0].segment_width = 0;
                "invalid row width"
            }
            3 => {
                p.invalidate_layout_inputs();
                "dirty stored partition"
            }
            4 => {
                p.char_offsets[0] += 1;
                "partial control gap"
            }
            5 => {
                p.char_count += 1;
                "inconsistent stream length"
            }
            6 => {
                p.char_count = u32::MAX;
                "overflowing stream length"
            }
            7 => {
                p.char_shapes.insert(
                    1,
                    rhwp::model::paragraph::CharShapeRef {
                        start_pos: 17,
                        char_shape_id: 0,
                    },
                );
                "style inside control slot"
            }
            8 => {
                p.range_tags.push(rhwp::model::paragraph::RangeTag {
                    start: 40,
                    end: 45,
                    tag: 1,
                });
                "unmapped HWPX range tag"
            }
            9 => {
                if let Control::Shape(s) = &mut p.controls[2] {
                    if let ShapeObject::Group(g) = s.as_mut() {
                        g.children[0].shape_attr_mut().render_b += 0.1;
                    }
                }
                "sheared child"
            }
            10 => {
                if let Control::Shape(s) = &mut p.controls[2] {
                    let nested = s.as_ref().clone();
                    if let ShapeObject::Group(g) = s.as_mut() {
                        g.children.push(nested);
                    }
                }
                "nested group"
            }
            12 => {
                p.align_ctrl_data_records();
                p.ctrl_data_records[2] = Some(vec![1, 2, 3]);
                "opaque group control data"
            }
            _ => {
                p.text.insert(0, '\t');
                "tab host"
            }
        };
        reject(&mut d, label);
        rejected += 1;
    }
    let mut mixed = DocumentCore::from_bytes(
        &std::fs::read(format!("{r}/native-rotated-resize-120x130.hwp")).unwrap(),
    )
    .unwrap();
    mixed.document_mut().sections[0].paragraphs[0].line_segs =
        DocumentCore::from_bytes(&representative)
            .unwrap()
            .document()
            .sections[0]
            .paragraphs[0]
            .line_segs
            .clone();
    let mixed_bytes = mixed.export_hwpx_native().unwrap();
    let mut mixed = DocumentCore::from_bytes(&mixed_bytes).unwrap();
    reject(&mut mixed, "stored mixed inline fixture");
    rejected += 1;
    let proof = serde_json::json!({"cases": cases, "two_format_reopens": count, "snapshot_undo_redo_cases": cases, "atomic_rejections": rejected, "maximum_corner_error_px": max, "physical_IME_verified": false, "native_GUI_save_verified": false});
    std::fs::write(
        format!("{q}/native-proof.json"),
        serde_json::to_string_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
