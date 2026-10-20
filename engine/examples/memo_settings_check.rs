//! Synthetic-only memo/settings metadata and actual body comment save/reopen contract.
use rhwp::{document_core::DocumentCore, model::control::FieldType};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn state(d: &DocumentCore) -> Value {
    let info = &d.document().doc_info;
    json!({"memoShapeCount":info.memo_shape_count,
        "headerRecords":info.extra_records.iter().map(|r|json!({"tag":r.tag_id,"level":r.level,"bytes":r.data})).collect::<Vec<_>>(),
        "body":d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|p.text.clone()).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "comments":d.collect_all_fields().iter().filter(|f|f.field.field_type==FieldType::Memo).map(|f|json!({"id":f.field.field_id,"command":f.field.command,"parameters":f.field.parameters,"paragraphs":f.field.memo_paragraphs.iter().map(|p|p.text.clone()).collect::<Vec<_>>()})).collect::<Vec<_>>()})
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    for f in &fixtures {
        let mut bytes = fs::read(f["path"].as_str().unwrap()).unwrap();
        let original = state(&DocumentCore::from_bytes(&bytes).unwrap());
        assert_eq!(original["comments"].as_array().unwrap().len(), 1);
        let mut states = vec![];
        for cycle in 0..6 {
            let d = DocumentCore::from_bytes(&bytes).unwrap();
            assert_eq!(state(&d), original);
            bytes = d.export_hwpx_native().unwrap();
            let file = out.join(format!(
                "{}--cycle{cycle}.hwpx",
                f["case"].as_str().unwrap()
            ));
            fs::write(&file, &bytes).unwrap();
            assert_eq!(
                state(&DocumentCore::from_bytes(&bytes).unwrap()),
                original,
                "memo style records, settings flags and comment content must survive reopening"
            );
            states.push(json!({"stage":format!("cycle{cycle}"),"file":file}));
        }
        rows.push(json!({"case":f["case"],"original":original,"states":states}));
    }
    fs::write(out.join("raw.json"),serde_json::to_vec(&json!({"cases":fixtures.len(),"exports":rows.len()*6,"GUIVerified":false,"sourceMemoAndSettingsModelPreserved":true,"rows":rows})).unwrap()).unwrap();
    println!("Native: {} cases, {} save/reopen cycles; memo style/settings records and body comments preserved",fixtures.len(),fixtures.len()*6);
}
