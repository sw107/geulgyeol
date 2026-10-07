//! Strict owner isolation, exact snapshots, saved reopens and stale-token refusals.
use super::*;
fn triples(path: &Value) -> Vec<(usize, usize, usize)> {
    path.as_array()
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
fn isolation(d: &DocumentCore, p: usize, path: &Value) -> Value {
    let mut ps = d.document().sections[0].paragraphs.clone();
    *nested_cells::table_mut(&mut ps[p], &triples(path)) = Default::default();
    content(&ps)
}
// HWPX rewrites paragraph instance IDs when inserted paragraphs shift traversal
// order. Keep them strict in memory and in the independent Native saved oracle.
fn saved_isolation(d: &DocumentCore, p: usize, path: &Value) -> Value {
    fn clear(v: &mut Value) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(clear),
            Value::Object(o) => {
                if let Some(Value::Array(a)) = o.get_mut("raw_header_extra") {
                    for b in a.iter_mut().skip(6).take(4) {
                        *b = json!(0);
                    }
                }
                for v in o.values_mut() {
                    clear(v)
                }
            }
            _ => {}
        }
    }
    let mut v = isolation(d, p, path);
    clear(&mut v);
    v
}
fn cell_owners(t: &rhwp::model::table::Table) -> Vec<Value> {
    t.cells
        .iter()
        .map(|c| {
            let mut v = serde_json::to_value(c).unwrap();
            v.as_object_mut().unwrap().remove("row");
            v["paragraphs"] = content(&c.paragraphs);
            v
        })
        .collect()
}
fn reject(d: &mut DocumentCore, p: usize, options: &str) {
    let before = whole(d);
    let svg = nested_cells::svg(d);
    let hwp = save(d, "hwp");
    let hwpx = save(d, "hwpx");
    let events = d.serialize_event_log();
    assert!(
        d.edit_nested_table_row_native(0, p, options).is_err(),
        "must refuse {options}"
    );
    assert_eq!(whole(d), before);
    assert_eq!(nested_cells::svg(d), svg);
    assert_eq!(save(d, "hwp"), hwp);
    assert_eq!(save(d, "hwpx"), hwpx);
    assert_eq!(d.serialize_event_log(), events);
}
pub fn run(out: &Path) {
    let seed_dir = out.join("scope-fixtures");
    std::fs::create_dir_all(&seed_dir).unwrap();
    nested_command_fixtures(&seed_dir);
    let source: Vec<Value> =
        serde_json::from_slice(&std::fs::read(seed_dir.join("nested-fixtures.json")).unwrap())
            .unwrap();
    let mut fixtures = vec![];
    let mut cases = vec![];
    let mut pairs = 0;
    let mut reopens = 0;
    let mut refusals = 0;
    // Unsupported geometry/regions/protection and minimum-row invariants.
    for f in source
        .iter()
        .filter(|f| f["depth"] == 2 && f["merged"] == false)
    {
        for change in [
            "width",
            "height",
            "local-row",
            "local-col",
            "local-width",
            "local-height",
            "zone",
            "protected-cell",
            "protected-parent",
            "last-row",
        ] {
            let mut d =
                DocumentCore::from_bytes(&std::fs::read(f["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let p = f["ref"]["ppi"].as_u64().unwrap() as usize;
            let path = f["path"].clone();
            let t = nested_cells::table_mut(
                &mut d.document_mut().sections[0].paragraphs[p],
                &triples(&path),
            );
            match change {
                "width" => t.cells[2].width += 100,
                "height" => t.cells[3].height += 100,
                "local-row" => t.local_resize_rows.push(1),
                "local-col" => t.local_resize_cols.push(0),
                "local-width" => t.local_resize_cell_widths.push((0, 100)),
                "local-height" => t.local_resize_cell_heights.push((0, 100)),
                "zone" => t.zones.push(rhwp::model::table::TableZone::default()),
                "protected-cell" => t.cells[2].set_cell_protect(true),
                "last-row" => t.delete_row(0).unwrap(),
                "protected-parent" => {}
                _ => unreachable!(),
            }
            if change == "protected-parent" {
                let Control::Table(root) = &mut d.document_mut().sections[0].paragraphs[p].controls
                    [path[0]["controlIndex"].as_u64().unwrap() as usize]
                else {
                    panic!()
                };
                root.cells[path[0]["cellIndex"].as_u64().unwrap() as usize].set_cell_protect(true);
            }
            d.document_mut().sections[0].raw_stream = None;
            let doc = d.document().clone();
            d.set_document(doc);
            let token = if change == "last-row" {
                let target: Value = serde_json::from_str(
                    &d.get_nested_table_row_target_native(0, p, &path.to_string())
                        .unwrap(),
                )
                .unwrap();
                assert_eq!(target["canDelete"], false);
                target["token"].clone()
            } else {
                assert!(d
                    .get_nested_table_row_target_native(0, p, &path.to_string())
                    .is_err());
                json!("")
            };
            reject(&mut d,p,&json!({"path":path,"action":if change=="last-row" {"delete"}else{"insertAbove"},"expectedToken":token}).to_string());
            refusals += 1;
        }
    }
    for f in source
        .iter()
        .filter(|f| f["depth"] == 2 && f["merged"] == false)
    {
        for sibling in [false, true] {
            let mut seed =
                DocumentCore::from_bytes(&std::fs::read(f["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let p = f["ref"]["ppi"].as_u64().unwrap() as usize;
            let mut path = f["path"].clone();
            if sibling {
                let (plain, pp, pc) = make("plain");
                let mut side = table(&plain, pp, pc).clone();
                side.cells[0].field_name = Some("보존할 형제 셀".into());
                let root = table(&seed, p, path[0]["controlIndex"].as_u64().unwrap() as usize);
                let mut root = root.clone();
                let host = &mut root.cells[path[0]["cellIndex"].as_u64().unwrap() as usize]
                    .paragraphs[path[0]["cellParaIndex"].as_u64().unwrap() as usize];
                host.controls.insert(0, Control::Table(Box::new(side)));
                host.char_count += 8;
                host.align_ctrl_data_records();
                seed.document_mut().sections[0].paragraphs[p].controls
                    [path[0]["controlIndex"].as_u64().unwrap() as usize] =
                    Control::Table(Box::new(root));
                seed.document_mut().sections[0].raw_stream = None;
                let doc = seed.document().clone();
                seed.set_document(doc);
                path[1]["controlIndex"] = json!(1);
            }
            let source_ext = f["input"].as_str().unwrap().rsplit('.').next().unwrap();
            let label = format!("{}-sibling{sibling}", f["label"].as_str().unwrap());
            let input = out.join(format!("{label}-input.{source_ext}"));
            std::fs::write(&input, save(&seed, source_ext)).unwrap();
            fixtures.push(json!({"label":label,"input":input,"ref":f["ref"],"path":path,"depth":2,"merged":false}));
            for (name, action, anchor) in [
                ("above-first", "insertAbove", 0),
                ("below-first", "insertBelow", 0),
                ("above-last", "insertAbove", 2),
                ("below-last", "insertBelow", 2),
                ("delete-text-last", "delete", 2),
                ("insert-delete", "insertAbove", 0),
            ] {
                let mut d = DocumentCore::from_bytes(&std::fs::read(&input).unwrap()).unwrap();
                let mut target = path.clone();
                target[1]["cellIndex"] = json!(anchor);
                let op = json!({"kind":"nestedRow","path":target,"action":action});
                let before = whole(&d);
                let before_svg = nested_cells::svg(&d);
                let isolate = isolation(&d, p, &path);
                let info = typed_info(&d);
                let field = fields(&d);
                let before_cells = cell_owners(nested_cells::table(
                    &d.document().sections[0].paragraphs[p],
                    &triples(&path),
                ));
                let undo = d.save_snapshot_with_composition_native();
                operation(&mut d, p, 0, &op);
                let mut operations = vec![op];
                if name == "insert-delete" {
                    let mut blank = path.clone();
                    blank[1]["cellIndex"] = json!(0);
                    let op = json!({"kind":"nestedRow","path":blank,"action":"delete"});
                    operation(&mut d, p, 0, &op);
                    operations.push(op);
                }
                assert_eq!(
                    isolation(&d, p, &path),
                    isolate,
                    "host/sibling/body isolation {label} {name}"
                );
                assert_eq!(typed_info(&d), info);
                assert_eq!(fields(&d), field);
                let after_table =
                    nested_cells::table(&d.document().sections[0].paragraphs[p], &triples(&path));
                let after_cells = cell_owners(after_table);
                if action == "delete" {
                    assert_eq!(&after_cells[..], &before_cells[..2]);
                } else if name == "insert-delete" {
                    assert_eq!(after_cells, before_cells);
                } else {
                    let row = anchor / 2 + usize::from(action == "insertBelow");
                    let kept = after_table
                        .cells
                        .iter()
                        .zip(&after_cells)
                        .filter(|(c, _)| usize::from(c.row) != row)
                        .map(|(_, v)| v.clone())
                        .collect::<Vec<_>>();
                    assert_eq!(kept, before_cells, "retained whole cells {label} {name}");
                    for c in after_table
                        .cells
                        .iter()
                        .filter(|c| usize::from(c.row) == row)
                    {
                        assert!(c.field_name.is_none());
                        for p in &c.paragraphs {
                            assert!(
                                p.text.is_empty()
                                    && p.controls.is_empty()
                                    && p.field_ranges.is_empty()
                            );
                        }
                    }
                }
                let after = whole(&d);
                let after_svg = nested_cells::svg(&d);
                let redo = d.save_snapshot_with_composition_native();
                for _ in 0..4 {
                    d.restore_snapshot_native(undo).unwrap();
                    assert_eq!(whole(&d), before);
                    assert_eq!(nested_cells::svg(&d), before_svg);
                    d.restore_snapshot_native(redo).unwrap();
                    assert_eq!(whole(&d), after);
                    assert_eq!(nested_cells::svg(&d), after_svg);
                    pairs += 1;
                }
                for (stage, id) in [("after", redo), ("undo", undo)] {
                    d.restore_snapshot_native(id).unwrap();
                    for format in ["hwp", "hwpx"] {
                        let result = if format == "hwp" {
                            d.export_hwp_with_adapter_snapshot_with_report().unwrap()
                        } else {
                            d.export_hwpx_native_with_report().unwrap()
                        };
                        assert!(result.content_loss().is_empty());
                        let file = out.join(format!("{label}-{name}-{stage}.{format}"));
                        std::fs::write(file, result.bytes()).unwrap();
                        let opened = DocumentCore::from_bytes(result.bytes()).unwrap();
                        assert_eq!(nested_cells::svg(&opened), nested_cells::svg(&d));
                        assert_eq!(fields(&opened), fields(&d));
                        // Same-format baseline captures serializer defaults before any edit.
                        let baseline = DocumentCore::from_bytes(&save(
                            &DocumentCore::from_bytes(&std::fs::read(&input).unwrap()).unwrap(),
                            format,
                        ))
                        .unwrap();
                        assert_eq!(typed_info(&opened), typed_info(&baseline));
                        let got = saved_isolation(&opened, p, &path);
                        let want = saved_isolation(&baseline, p, &path);
                        if got != want {
                            std::fs::write(out.join("isolation-diagnostic.json"),json!({"label":label,"name":name,"stage":stage,"format":format,"got":got,"want":want}).to_string()).unwrap();
                            panic!("saved isolation mismatch {label} {name} {stage} {format}; see diagnostic");
                        }
                        assert_eq!(
                            format!("{:?}", opened.document().bin_data_content),
                            format!("{:?}", d.document().bin_data_content)
                        );
                        reopens += 1;
                    }
                }
                d.discard_snapshot_native(undo);
                d.discard_snapshot_native(redo);
                cases.push(json!({"label":label,"case":name,"operations":operations}));
            }
            let load = || DocumentCore::from_bytes(&std::fs::read(&input).unwrap()).unwrap();
            let mut d = load();
            let t: Value = serde_json::from_str(
                &d.get_nested_table_row_target_native(0, p, &path.to_string())
                    .unwrap(),
            )
            .unwrap();
            let valid = json!({"path":path,"action":"insertAbove","expectedToken":t["token"]});
            // Invalid options and aliases must never silently default to root/cell zero.
            let mut bad = vec![
                "{}".to_string(),
                "[]".into(),
                "null".into(),
                "{broken".into(),
            ];
            for value in [
                json!(null),
                json!(-1),
                json!(0.5),
                json!("0"),
                json!(4294967296u64),
            ] {
                let mut x = valid.clone();
                x["path"][0]["cellIndex"] = value;
                bad.push(x.to_string());
            }
            for depth in [0, 1, 3] {
                let mut x = valid.clone();
                let mut a = path.as_array().unwrap().clone();
                a.resize(depth, path[0].clone());
                x["path"] = json!(a);
                bad.push(x.to_string());
            }
            for key in ["controlIndex", "cellIndex", "cellParaIndex"] {
                for level in [0, 1] {
                    let mut x = valid.clone();
                    x["path"][level].as_object_mut().unwrap().remove(key);
                    bad.push(x.to_string());
                }
            }
            for key in ["expectedToken", "action"] {
                let mut x = valid.clone();
                x.as_object_mut().unwrap().remove(key);
                bad.push(x.to_string());
            }
            for key in ["expectedToken", "action"] {
                let mut x = valid.clone();
                x[key] = json!("invalid");
                bad.push(x.to_string());
            }
            let mut x = valid.clone();
            x["unknown"] = json!(true);
            bad.push(x.to_string());
            for level in [0, 1] {
                for key in ["controlIndex", "cellIndex", "cellParaIndex"] {
                    let mut x = valid.clone();
                    x["path"][level][key] = json!(999999);
                    bad.push(x.to_string());
                }
            }
            let mut x = valid.clone();
            x["path"][1]["cellIndex"] = json!(2);
            bad.push(x.to_string());
            let mut x = valid.clone();
            x["action"] = json!("delete");
            bad.push(x.to_string()); // row with owners
            for options in bad {
                reject(&mut d, p, &options);
                refusals += 1;
            }
            for change in [
                "outer-row",
                "inner-row",
                "host-text",
                "reload",
                "undo-epoch",
            ] {
                let mut d = load();
                let t: Value = serde_json::from_str(
                    &d.get_nested_table_row_target_native(0, p, &path.to_string())
                        .unwrap(),
                )
                .unwrap();
                let options =
                    json!({"path":path,"action":"insertBelow","expectedToken":t["token"]});
                match change {
                    "outer-row" => {
                        d.insert_table_row_native(
                            0,
                            p,
                            path[0]["controlIndex"].as_u64().unwrap() as usize,
                            1,
                            true,
                        )
                        .unwrap();
                    }
                    "inner-row" => operation(
                        &mut d,
                        p,
                        0,
                        &json!({"kind":"nestedRow","path":path,"action":"insertBelow"}),
                    ),
                    "host-text" => {
                        d.document_mut().sections[0].paragraphs[p].insert_text_at(0, "changed");
                    }
                    "reload" => {
                        let doc = d.document().clone();
                        d.set_document(doc);
                    }
                    "undo-epoch" => {
                        let id = d.save_snapshot_native();
                        operation(
                            &mut d,
                            p,
                            0,
                            &json!({"kind":"nestedRow","path":path,"action":"insertBelow"}),
                        );
                        d.restore_snapshot_native(id).unwrap();
                        d.discard_snapshot_native(id);
                    }
                    _ => unreachable!(),
                }
                reject(&mut d, p, &options.to_string());
                refusals += 1;
            }
        }
    }
    for f in source
        .iter()
        .filter(|f| f["depth"] != 2 || f["merged"] != false)
    {
        let mut d = DocumentCore::from_bytes(&std::fs::read(f["input"].as_str().unwrap()).unwrap())
            .unwrap();
        let p = f["ref"]["ppi"].as_u64().unwrap() as usize;
        assert!(d
            .get_nested_table_row_target_native(0, p, &f["path"].to_string())
            .is_err());
        reject(
            &mut d,
            p,
            &json!({"path":f["path"],"action":"insertAbove","expectedToken":""}).to_string(),
        );
        refusals += 1;
    }
    std::fs::write(
        out.join("nested-row-fixtures.json"),
        serde_json::to_vec_pretty(&fixtures).unwrap(),
    )
    .unwrap();
    std::fs::write(out.join("nested-row-proof.json"),serde_json::to_vec_pretty(&json!({"cases":cases.len(),"checks":cases,"snapshotPairs":pairs,"savedReopens":reopens,"atomicRefusals":refusals,"outsideTargetAndRetainedOwnersPreserved":true,"contentLossReports":0})).unwrap()).unwrap();
    println!(
        "PASS nested rows {} cases {pairs} pairs {reopens} reopens {refusals} atomic refusals",
        cases.len()
    );
}
