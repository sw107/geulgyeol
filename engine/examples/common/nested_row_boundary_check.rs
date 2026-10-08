//! A second row oracle: right-column/nonzero paragraph cursors and manual
//! survivor mapping, rather than only the prior left-column two-row matrix.
use super::*;
fn path_tuples(v: &Value) -> Vec<(usize, usize, usize)> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["controlIndex"].as_u64().unwrap() as usize,
                p["cellIndex"].as_u64().unwrap() as usize,
                p["cellParaIndex"].as_u64().unwrap() as usize,
            )
        })
        .collect()
}
fn outside(d: &DocumentCore, p: usize, path: &Value) -> Value {
    let mut ps = d.document().sections[0].paragraphs.clone();
    *nested_cells::table_mut(&mut ps[p], &path_tuples(path)) = Default::default();
    content(&ps)
}
fn survivor(c: &rhwp::model::table::Cell) -> Value {
    let mut v = serde_json::to_value(c).unwrap();
    v.as_object_mut().unwrap().remove("row");
    v["paragraphs"] = content(&c.paragraphs);
    v
}
fn unchanged(d: &mut DocumentCore, p: usize, path: &Value) {
    let before = whole(d);
    let svg = nested_cells::svg(d);
    let events = d.serialize_event_log();
    let hwp = save(d, "hwp");
    let hwpx = save(d, "hwpx");
    let target: Value = serde_json::from_str(
        &d.get_nested_table_row_target_native(0, p, &path.to_string())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(target["canDelete"], false);
    assert!(d
        .edit_nested_table_row_native(
            0,
            p,
            &json!({"path":path,"action":"delete","expectedToken":target["token"]}).to_string()
        )
        .is_err());
    assert_eq!(whole(d), before);
    assert_eq!(nested_cells::svg(d), svg);
    assert_eq!(d.serialize_event_log(), events);
    assert_eq!(save(d, "hwp"), hwp);
    assert_eq!(save(d, "hwpx"), hwpx);
}
fn add_external_reference(d: &mut DocumentCore, p: usize, path: &Value) {
    let t = nested_cells::table(&d.document().sections[0].paragraphs[p], &path_tuples(path));
    let mut para = t.cells[3].paragraphs[0].clone();
    for c in &mut para.controls {
        if let Control::Field(f) = c {
            f.field_type = rhwp::model::control::FieldType::CrossRef;
            f.ctrl_id = rhwp::parser::tags::FIELD_CROSSREF;
            f.field_id = 900_001;
            f.command = "boundary-row-owner".into();
            f.parameters = Default::default();
            f.raw_parameters_xml = None;
            f.instance_id = Some(700_001);
        }
    }
    for r in &mut para.ctrl_data_records {
        *r = None;
    }
    d.document_mut().sections[0].paragraphs.push(para);
    d.document_mut().sections[0].raw_stream = None;
    let doc = d.document().clone();
    d.set_document(doc);
}
pub fn run(out: &Path) {
    let seeds = out.join("seeds");
    std::fs::create_dir_all(&seeds).unwrap();
    nested_command_fixtures(&seeds);
    let source: Vec<Value> =
        serde_json::from_slice(&std::fs::read(seeds.join("nested-fixtures.json")).unwrap())
            .unwrap();
    let seed = source
        .iter()
        .find(|f| {
            f["depth"] == 2
                && f["merged"] == false
                && f["input"].as_str().unwrap().ends_with(".hwpx")
        })
        .unwrap();
    let p = seed["ref"]["ppi"].as_u64().unwrap() as usize;
    let path = seed["path"].clone();
    let mut fixtures = vec![];
    let mut cases = vec![];
    let mut refs = vec![];
    let mut pairs = 0;
    let mut reopens = 0;
    let mut refused = 0;
    for kind in ["one-empty", "three-unicode"] {
        let mut d =
            DocumentCore::from_bytes(&std::fs::read(seed["input"].as_str().unwrap()).unwrap())
                .unwrap();
        let t = nested_cells::table_mut(
            &mut d.document_mut().sections[0].paragraphs[p],
            &path_tuples(&path),
        );
        let owners = t.cells[..2].to_vec();
        if kind == "one-empty" {
            t.delete_row(1).unwrap();
        } else {
            t.insert_row(1, true).unwrap();
        }
        for (i, c) in t.cells.iter_mut().enumerate() {
            let template = c.paragraphs[0].clone();
            c.field_name = None;
            c.paragraphs = (0..if kind == "one-empty" { 1 } else { 3 })
                .map(|n| {
                    let mut para = Paragraph::new_empty_like(&template);
                    if kind != "one-empty" && !(i == 0 || (i == 1 && n == 0)) {
                        para.insert_text_at(0, &format!("앞😀e\u{301}한글𝄞セル{i}문단{n} 끝🧪"));
                    }
                    para
                })
                .collect();
        }
        if kind == "three-unicode" {
            t.cells[2].paragraphs = owners[0].paragraphs.clone();
            t.cells[2].field_name = Some("boundary-row-owner".into());
            t.cells[3].paragraphs = owners[1].paragraphs.clone();
        }
        d.document_mut().sections[0].raw_stream = None;
        let doc = d.document().clone();
        d.set_document(doc);
        if kind == "three-unicode" {
            add_external_reference(&mut d, p, &path);
        }
        for format in ["hwp", "hwpx"] {
            let file = out.join(format!("{kind}-input.{format}"));
            std::fs::write(&file, save(&d, format)).unwrap();
            let label = format!("{kind}-{format}");
            let rows = if kind == "one-empty" { 1 } else { 3 };
            fixtures.push(
                json!({"label":label,"input":file,"ref":seed["ref"],"path":path,"rows":rows}),
            );
            for (name, action, row) in [
                ("above-first", "insertAbove", 0),
                ("below-first", "insertBelow", 0),
                ("above-last", "insertAbove", rows - 1),
                ("below-last", "insertBelow", rows - 1),
                ("delete-first", "delete", 0),
                ("delete-last", "delete", rows - 1),
            ] {
                let mut x = DocumentCore::from_bytes(&std::fs::read(&file).unwrap()).unwrap();
                let t = nested_cells::table(
                    &x.document().sections[0].paragraphs[p],
                    &path_tuples(&path),
                );
                let cell = row * 2 + 1;
                let cp = t.cells[cell].paragraphs.len() - 1;
                let off = t.cells[cell].paragraphs[cp].text.chars().count();
                let mut target = path.clone();
                target[1]["cellIndex"] = json!(cell);
                target[1]["cellParaIndex"] = json!(cp);
                if action == "delete" && rows == 1 {
                    unchanged(&mut x, p, &target);
                    refused += 1;
                    continue;
                }
                let before = whole(&x);
                let before_svg = nested_cells::svg(&x);
                let exterior = outside(&x, p, &path);
                let info = typed_info(&x);
                let field = fields(&x);
                let old = nested_cells::table(
                    &x.document().sections[0].paragraphs[p],
                    &path_tuples(&path),
                )
                .cells
                .clone();
                let undo = x.save_snapshot_with_composition_native();
                let op = json!({"kind":"nestedRow","path":target,"action":action});
                operation(&mut x, p, 0, &op);
                assert_eq!(outside(&x, p, &path), exterior);
                assert_eq!(typed_info(&x), info);
                assert_eq!(fields(&x), field);
                let table = nested_cells::table(
                    &x.document().sections[0].paragraphs[p],
                    &path_tuples(&path),
                );
                let insertion = row + usize::from(action == "insertBelow");
                for old_cell in &old {
                    if action == "delete" && usize::from(old_cell.row) == row {
                        continue;
                    }
                    let new_row = if action == "delete" {
                        usize::from(old_cell.row) - usize::from(usize::from(old_cell.row) > row)
                    } else {
                        usize::from(old_cell.row)
                            + usize::from(usize::from(old_cell.row) >= insertion)
                    };
                    let new_cell = table
                        .cells
                        .iter()
                        .find(|c| usize::from(c.row) == new_row && c.col == old_cell.col)
                        .unwrap();
                    assert_eq!(survivor(new_cell), survivor(old_cell));
                }
                let after = whole(&x);
                let after_svg = nested_cells::svg(&x);
                let redo = x.save_snapshot_with_composition_native();
                for _ in 0..4 {
                    x.restore_snapshot_native(undo).unwrap();
                    assert_eq!(whole(&x), before);
                    assert_eq!(nested_cells::svg(&x), before_svg);
                    x.restore_snapshot_native(redo).unwrap();
                    assert_eq!(whole(&x), after);
                    assert_eq!(nested_cells::svg(&x), after_svg);
                    pairs += 1;
                }
                for (stage, id) in [("after", redo), ("undo", undo)] {
                    x.restore_snapshot_native(id).unwrap();
                    for ext in ["hwp", "hwpx"] {
                        let result = if ext == "hwp" {
                            x.export_hwp_with_adapter_snapshot_with_report().unwrap()
                        } else {
                            x.export_hwpx_native_with_report().unwrap()
                        };
                        assert!(result.content_loss().is_empty());
                        let opened = DocumentCore::from_bytes(result.bytes()).unwrap();
                        assert_eq!(nested_cells::svg(&opened), nested_cells::svg(&x));
                        assert_eq!(fields(&opened), fields(&x));
                        let saved = out.join(format!("{label}-{name}-{stage}.{ext}"));
                        std::fs::write(saved, result.bytes()).unwrap();
                        reopens += 1;
                    }
                }
                x.discard_snapshot_native(undo);
                x.discard_snapshot_native(redo);
                cases.push(json!({"fixture":label,"name":name,"action":action,"row":row,"cell":cell,"cellParaIndex":cp,"charOffset":off,"path":target,"operations":[op]}));
            }
            if rows == 3 {
                let mut x = DocumentCore::from_bytes(&std::fs::read(&file).unwrap()).unwrap();
                let mut owned = path.clone();
                owned[1]["cellIndex"] = json!(3);
                unchanged(&mut x, p, &owned);
                refused += 1;
                let outside_before = outside(&x, p, &path);
                let binding_before = x.get_field_value_by_name("boundary-row-owner").is_ok();
                assert!(binding_before);
                // Deliberately bypass the supported API, in this disposable synthetic
                // document only, to show why whole-row drop is not a reference contract.
                nested_cells::table_mut(
                    &mut x.document_mut().sections[0].paragraphs[p],
                    &path_tuples(&path),
                )
                .delete_row(1)
                .unwrap();
                let doc = x.document().clone();
                x.set_document(doc);
                assert_eq!(outside(&x, p, &path), outside_before);
                let binding_after = x.get_field_value_by_name("boundary-row-owner").is_ok();
                assert!(!binding_after);
                let outside_fields=x.collect_all_fields().iter().filter(|f|f.field.field_type==rhwp::model::control::FieldType::CrossRef).map(|f|json!({"id":f.field.field_id,"command":f.field.command,"instanceId":f.field.instance_id})).collect::<Vec<_>>();
                assert_eq!(outside_fields.len(), 1);
                refs.push(json!({"fixture":label,"supportedAPIDeleteRefusedUnchanged":true,"privateModelDropOnly":true,"namedBindingBefore":binding_before,"namedBindingAfter":binding_after,"outsideCrossRef":outside_fields,"outsideParagraphsUnchanged":true}));
            }
        }
    }
    std::fs::write(
        out.join("boundary-fixtures.json"),
        serde_json::to_vec_pretty(&fixtures).unwrap(),
    )
    .unwrap();
    std::fs::write(
        out.join("boundary-cases.json"),
        serde_json::to_vec_pretty(&cases).unwrap(),
    )
    .unwrap();
    std::fs::write(out.join("boundary-proof.json"),serde_json::to_vec_pretty(&json!({"cases":cases.len(),"snapshotPairs":pairs,"savedReopens":reopens,"atomicRefusals":refused,"manualSurvivorCoordinateMapping":true,"outsideDataStylesAndFieldOwnersPreserved":true,"referenceScopeEvidence":refs})).unwrap()).unwrap();
    println!(
        "PASS boundary {} cases {pairs} pairs {reopens} reopens {refused} refusals",
        cases.len()
    );
}
