//! Synthetic bookmark coordinates, independent UI-save oracle and atomic refusals.
use rhwp::{
    document_core::DocumentCore,
    model::control::{Bookmark, Control},
};
use serde_json::{json, Value};
use std::path::Path;
fn json_result(s: String) -> Value {
    serde_json::from_str(&s).unwrap()
}
fn bookmarks(d: &DocumentCore) -> Vec<Value> {
    serde_json::from_str(&d.get_bookmarks_native().unwrap()).unwrap()
}
fn owner(d: &DocumentCore, name: &str) -> (usize, usize, usize) {
    let b = bookmarks(d)
        .into_iter()
        .find(|b| b["name"] == name && b["editable"] == true)
        .unwrap();
    (
        b["sec"].as_u64().unwrap() as usize,
        b["para"].as_u64().unwrap() as usize,
        b["ctrlIdx"].as_u64().unwrap() as usize,
    )
}
fn apply(d: &mut DocumentCore, op: &Value) {
    let para = op["para"].as_u64().unwrap_or(0) as usize;
    let r = match op["kind"].as_str().unwrap() {
        "add" => d.add_bookmark_native(
            0,
            para,
            op["at"].as_u64().unwrap() as usize,
            op["name"].as_str().unwrap(),
        ),
        "rename" => {
            let (s, p, c) = owner(d, op["name"].as_str().unwrap());
            d.rename_bookmark_native(s, p, c, op["newName"].as_str().unwrap())
        }
        "delete" => {
            let (s, p, c) = owner(d, op["name"].as_str().unwrap());
            d.delete_bookmark_native(s, p, c)
        }
        "textInsert" => d.insert_text_native(
            0,
            0,
            op["at"].as_u64().unwrap() as usize,
            op["text"].as_str().unwrap(),
        ),
        "textDelete" => d.delete_text_native(
            0,
            0,
            op["at"].as_u64().unwrap() as usize,
            op["count"].as_u64().unwrap() as usize,
        ),
        "textLocal" => d.replace_body_text_local_native(
            0,
            0,
            op["at"].as_u64().unwrap() as usize,
            op["count"].as_u64().unwrap() as usize,
            op["text"].as_str().unwrap(),
        ),
        "split" => d.split_paragraph_native_with_next_style(
            0,
            para,
            op["at"].as_u64().unwrap() as usize,
            None,
            op["nextStyle"].as_bool().unwrap_or(false),
        ),
        "merge" => d.merge_paragraph_native(0, para),
        _ => panic!("Unknown operation"),
    }
    .unwrap();
    assert_eq!(json_result(r)["ok"], true);
}
fn refs(d: &DocumentCore) -> Value {
    json!({"paragraphs":d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"paraShape":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"controls":p.controls.iter().filter(|c|!matches!(c,Control::Bookmark(_))).map(|c|format!("{c:?}")).collect::<Vec<_>>(),"fields":p.field_ranges.iter().map(|r|json!({"start":r.start_char_idx,"end":r.end_char_idx,"owner":format!("{:?}",p.controls[r.control_idx]),"inner":r.inner_slot_count})).collect::<Vec<_>>()})).collect::<Vec<_>>()).collect::<Vec<_>>(),"styles":format!("{:?}",d.document().doc_info),"images":format!("{:?}",d.document().bin_data_content)})
}
fn canonical(mut d: DocumentCore) -> Value {
    for s in &mut d.document_mut().sections {
        for p in &mut s.paragraphs {
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
    }
    json!({"paragraphs":d.document().sections.iter().map(|s|&s.paragraphs).collect::<Vec<_>>(),"docInfo":format!("{:?}",d.document().doc_info),"binData":format!("{:?}",d.document().bin_data_content)})
}
fn empty_core() -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    let mut section = rhwp::model::document::Section::default();
    section.section_def.page_def = rhwp::model::page::PageDef::a4_default();
    section
        .paragraphs
        .push(rhwp::model::paragraph::Paragraph::new_empty());
    let mut document = rhwp::model::document::Document::default();
    document.sections.push(section);
    d.set_document(document);
    d
}
fn fixture_core(reference: &DocumentCore) -> DocumentCore {
    let mut d = empty_core();
    let mut doc = d.document().clone();
    // Reuse known synthetic seed's registered styles; an unregistered preview DocInfo
    // is not a valid editable HWPX fixture (especially for empty paragraphs).
    doc.doc_info = reference.document().doc_info.clone();
    doc.doc_info.raw_stream = None;
    d.set_document(doc);
    d
}
fn nested_name_guards() -> usize {
    use rhwp::model::{
        control::Field,
        header_footer::MasterPage,
        paragraph::Paragraph,
        shape::{Caption, GroupShape, RectangleShape, ShapeObject, TextBox},
        table::{Cell, Table},
    };
    fn leaf(name: &str) -> Paragraph {
        let mut p = Paragraph::new_empty();
        p.controls
            .push(Control::Bookmark(Bookmark { name: name.into() }));
        p.char_count = 9;
        p
    }
    let cap = |name| Caption {
        paragraphs: vec![leaf(name)],
        ..Default::default()
    };
    let rect = RectangleShape {
        drawing: rhwp::model::shape::DrawingObjAttr {
            text_box: Some(TextBox {
                paragraphs: vec![leaf("textbox")],
                ..Default::default()
            }),
            caption: Some(cap("rectangle-caption")),
            ..Default::default()
        },
        ..Default::default()
    };
    let group = ShapeObject::Group(GroupShape {
        children: vec![ShapeObject::Rectangle(rect)],
        caption: Some(cap("group-caption")),
        ..Default::default()
    });
    let mut d = empty_core();
    d.add_bookmark_native(0, 0, 0, "body").unwrap();
    let mut host = Paragraph::new_empty();
    host.controls = vec![
        Control::Shape(Box::new(group)),
        Control::Picture(Box::new(rhwp::model::image::Picture {
            caption: Some(cap("picture-caption")),
            ..Default::default()
        })),
        Control::Field(Field {
            memo_paragraphs: vec![leaf("memo-body")],
            ..Default::default()
        }),
        Control::Table(Box::new(Table {
            cells: vec![Cell {
                paragraphs: vec![leaf("cell")],
                ..Default::default()
            }],
            caption: Some(cap("table-caption")),
            ..Default::default()
        })),
        Control::Header(Box::new(rhwp::model::header_footer::Header {
            paragraphs: vec![leaf("header")],
            ..Default::default()
        })),
        Control::Footer(Box::new(rhwp::model::header_footer::Footer {
            paragraphs: vec![leaf("footer")],
            ..Default::default()
        })),
        Control::Footnote(Box::new(rhwp::model::footnote::Footnote {
            paragraphs: vec![leaf("footnote")],
            ..Default::default()
        })),
        Control::Endnote(Box::new(rhwp::model::footnote::Endnote {
            paragraphs: vec![leaf("endnote")],
            ..Default::default()
        })),
        Control::Shape(Box::new(ShapeObject::Chart(Box::new(
            rhwp::model::shape::ChartShape {
                caption: Some(cap("chart-caption")),
                ..Default::default()
            },
        )))),
        Control::Shape(Box::new(ShapeObject::Ole(Box::new(
            rhwp::model::shape::OleShape {
                caption: Some(cap("ole-caption")),
                ..Default::default()
            },
        )))),
    ];
    d.document_mut().sections[0].paragraphs.push(host);
    d.document_mut().sections[0]
        .section_def
        .master_pages
        .push(MasterPage {
            paragraphs: vec![leaf("master-page")],
            ..Default::default()
        });
    let nested = bookmarks(&d)
        .into_iter()
        .filter(|b| b["editable"] == false)
        .collect::<Vec<_>>();
    assert_eq!(nested.len(), 14);
    for b in &nested {
        let before = format!("{:?}", d.document());
        let name = b["name"].as_str().unwrap();
        assert_eq!(
            json_result(d.add_bookmark_native(0, 0, 0, name).unwrap())["ok"],
            false
        );
        assert_eq!(
            json_result(d.rename_bookmark_native(0, 0, 0, name).unwrap())["ok"],
            false
        );
        assert_eq!(format!("{:?}", d.document()), before);
    }
    nested.len()
}
fn structural_native_refusals() -> usize {
    let mut base = empty_core();
    base.insert_text_native(0, 0, 0, "가🙂나다").unwrap();
    base.add_bookmark_native(0, 0, 0, "구조").unwrap();
    base.document_mut().sections[0]
        .paragraphs
        .push(rhwp::model::paragraph::Paragraph::new_empty());
    let mut count = 0;
    for kind in 0..9 {
        let mut d = empty_core();
        d.set_document(base.document().clone());
        match kind {
            0 => d.document_mut().sections[0].paragraphs[0]
                .range_tags
                .push(Default::default()),
            1 => d.document_mut().sections[0].paragraphs[0]
                .raw_header_extra
                .resize(11, 1),
            2 => d.document_mut().sections[0].paragraphs[0].ctrl_data_records[0] = Some(vec![0xff]),
            3 => {
                let section = d.document().sections[0].clone();
                d.document_mut().sections.push(section);
            }
            4 => {
                let p = &mut d.document_mut().sections[0].paragraphs[0];
                p.controls.push(Control::Picture(Box::default()));
                p.char_count += 8;
            }
            5 => d.document_mut().sections[0].paragraphs[0]
                .tab_extended
                .push([0; 7]),
            6 => d.document_mut().sections[0].paragraphs[0]
                .ctrl_data_records
                .push(Some(vec![0xab])),
            7 => {
                let p = &mut d.document_mut().sections[0].paragraphs[0];
                p.raw_header_extra.resize(12, 0);
                p.raw_header_extra[10] = 1;
            }
            _ => d.document_mut().sections[0].paragraphs[0]
                .orphan_field_ends
                .push(Default::default()),
        }
        for merge in [false, true] {
            let before = format!("{:?}", d.document());
            assert!(if merge {
                d.merge_paragraph_native(0, 1)
            } else {
                d.split_paragraph_native(0, 0, 2, None)
            }
            .is_err());
            assert_eq!(format!("{:?}", d.document()), before);
            count += 1;
        }
    }
    for kind in 0..2 {
        let mut d = empty_core();
        d.set_document(base.document().clone());
        let p = &mut d.document_mut().sections[0].paragraphs[1];
        if kind == 0 {
            p.column_type = rhwp::model::paragraph::ColumnBreakType::Page;
        } else {
            p.controls.push(Control::SectionDef(Box::default()));
            p.char_count += 8;
        }
        let before = format!("{:?}", d.document());
        assert!(d.merge_paragraph_native(0, 1).is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        count += 1;
    }
    count
}
fn main() {
    let a = std::env::args().skip(1).collect::<Vec<_>>();
    let out = Path::new(&a[1]);
    std::fs::create_dir_all(out).unwrap();
    if a[0] == "prepare" {
        let reference = DocumentCore::from_bytes(&std::fs::read(&a[2]).unwrap()).unwrap();
        let mut d = fixture_core(&reference);
        d.insert_text_native(0, 0, 0, "가🙂나다𐐀마").unwrap();
        d.apply_char_format_native(
            0,
            0,
            1,
            3,
            r##"{"bold":true,"fontSize":1600,"textColor":"#345678"}"##,
        )
        .unwrap();
        std::fs::write(out.join("blank.hwpx"), d.export_hwpx_native().unwrap()).unwrap();
        let mut empty = fixture_core(&reference);
        std::fs::write(out.join("empty.hwpx"), empty.export_hwpx_native().unwrap()).unwrap();
        let mut nested = DocumentCore::from_bytes(&std::fs::read(&a[2]).unwrap()).unwrap();
        let mut sub = fixture_core(&reference);
        sub.insert_text_native(0, 0, 0, "각주 책갈피🙂").unwrap();
        sub.add_bookmark_native(0, 0, 2, "하위 책갈피").unwrap();
        let para = sub.document().sections[0].paragraphs[0].clone();
        let Control::Footnote(note) =
            &mut nested.document_mut().sections[0].paragraphs[0].controls[2]
        else {
            panic!("Synthetic note seed expected")
        };
        note.paragraphs = vec![para];
        nested.document_mut().sections[0].raw_stream = None;
        std::fs::write(
            out.join("nested.hwpx"),
            nested.export_hwpx_native().unwrap(),
        )
        .unwrap();
        let mut styled = DocumentCore::from_bytes(&std::fs::read(&a[2]).unwrap()).unwrap();
        let doc = styled.document_mut();
        let id = doc.doc_info.styles.len() as u8;
        let mut target = doc.doc_info.styles[0].clone();
        target.local_name = "책갈피 다음".into();
        target.english_name = "Bookmark successor".into();
        target.next_style_id = id;
        target.raw_data = None;
        doc.doc_info.styles.push(target);
        doc.doc_info.styles[0].next_style_id = id;
        doc.doc_info.styles[0].raw_data = None;
        doc.doc_info.raw_stream_dirty = true;
        doc.doc_info.raw_stream = None;
        doc.sections[0].raw_stream = None;
        std::fs::write(
            out.join("next-style-notes.hwpx"),
            styled.export_hwpx_native().unwrap(),
        )
        .unwrap();
        return;
    }
    let rows: Vec<Value> =
        serde_json::from_slice(&std::fs::read(out.join("manifest.json")).unwrap()).unwrap();
    let mut pairs = 0;
    for row in &rows {
        let mut d =
            DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                .unwrap();
        let mut preserved = refs(&d);
        for op in row["ops"].as_array().unwrap() {
            let before = format!("{:?}", d.document());
            let b = d.save_snapshot_native();
            apply(&mut d, op);
            if op["kind"].as_str().unwrap().starts_with("text")
                || matches!(op["kind"].as_str(), Some("split" | "merge"))
            {
                preserved = refs(&d);
            } else {
                assert_eq!(refs(&d), preserved, "reference preservation");
            }
            let after = format!("{:?}", d.document());
            let e = d.save_snapshot_native();
            for _ in 0..3 {
                d.restore_snapshot_native(b).unwrap();
                assert_eq!(format!("{:?}", d.document()), before);
                d.restore_snapshot_native(e).unwrap();
                assert_eq!(format!("{:?}", d.document()), after);
                pairs += 1;
            }
            d.discard_snapshot_native(b);
            d.discard_snapshot_native(e);
        }
        let file = Path::new(row["file"].as_str().unwrap());
        let bytes = if file.extension().unwrap() == "hwp" {
            d.export_hwp_with_adapter_snapshot().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        let expected = DocumentCore::from_bytes(&bytes).unwrap();
        let actual = DocumentCore::from_bytes(&std::fs::read(file).unwrap()).unwrap();
        assert_eq!(actual.page_count(), expected.page_count());
        for p in 0..actual.page_count() {
            assert_eq!(
                actual.render_page_svg_native(p).unwrap(),
                expected.render_page_svg_native(p).unwrap(),
                "{}",
                file.display()
            );
        }
        assert_eq!(canonical(actual), canonical(expected), "{}", file.display());
    }
    let mut d = empty_core();
    d.insert_text_native(0, 0, 0, "가🙂나").unwrap();
    let mut refusals = 0;
    for at in [4, usize::MAX] {
        let before = format!("{:?}", d.document());
        assert!(d.add_bookmark_native(0, 0, at, "잘못된 위치").is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        refusals += 1;
    }
    for name in ["", " ", "bad\0", "bad\t", "bad\n", "bad\u{ffff}"] {
        let before = format!("{:?}", d.document());
        assert!(d.add_bookmark_native(0, 0, 0, name).is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        refusals += 1;
    }
    d.add_bookmark_native(0, 0, 1, "보존").unwrap();
    d.document_mut().sections[0].paragraphs[0].ctrl_data_records[0] = Some(vec![0xaa, 0xbb]);
    for rename in [false, true] {
        let before = format!("{:?}", d.document());
        assert!(if rename {
            d.rename_bookmark_native(0, 0, 0, "새 이름")
        } else {
            d.delete_bookmark_native(0, 0, 0)
        }
        .is_err());
        assert_eq!(format!("{:?}", d.document()), before);
        refusals += 1;
    }
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::Bookmark(Bookmark {
            name: "불명".into(),
        }));
    let before = format!("{:?}", d.document());
    assert!(d.add_bookmark_native(0, 0, 2, "축 불명").is_err());
    assert_eq!(format!("{:?}", d.document()), before);
    refusals += 1;
    let nested_scopes = nested_name_guards();
    let structural_refusals = structural_native_refusals();
    std::fs::write(out.join("native-proof.json"),serde_json::to_vec_pretty(&json!({"independentSavedReopens":rows.len(),"nativeOperationReexecution":true,"snapshotPairs":pairs,"atomicNativeRefusals":refusals,"atomicNativeStructuralRefusals":structural_refusals,"readOnlyNestedNameScopes":nested_scopes,"duplicateNameRefusalsAcrossNestedScopes":nested_scopes*2,"fullSvgParagraphsStylesAndBinDataCompared":true,"noteHeaderTrailingZeroPaddingCanonicalized":true})).unwrap()).unwrap();
    println!(
        "{} independent reopens; {pairs} snapshot pairs; {refusals} refusals",
        rows.len()
    );
}
