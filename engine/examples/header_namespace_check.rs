//! Native full-document save/reopen contract. XML namespaces are checked independently in Python.
use rhwp::document_core::DocumentCore;
use serde_json::{json, Value};
use std::{fs, path::Path};
fn state(d: &DocumentCore) -> Value {
    let info = &d.document().doc_info;
    let numberings: Vec<_> = info.numberings.iter().map(|n| json!({
        "heads":n.heads,"formats":n.level_formats,"start":n.start_number,"levelStarts":n.level_start_numbers
    })).collect();
    let body: Vec<Vec<_>> = d
        .document()
        .sections
        .iter()
        .map(|s| s.paragraphs.iter().map(|p| p.text.clone()).collect())
        .collect();
    json!({"numberings":numberings,"bullets":info.bullets.iter().map(|b|json!({"char":b.bullet_char.to_string(),"width":b.width_adjust,"offset":b.text_distance,"style":b.char_shape_id})).collect::<Vec<_>>(),"body":body})
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let manifest: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = vec![];
    for f in &manifest {
        let mut bytes = fs::read(f["path"].as_str().unwrap()).unwrap();
        let original = state(&DocumentCore::from_bytes(&bytes).unwrap());
        for cycle in 0..6 {
            let d = DocumentCore::from_bytes(&bytes).unwrap();
            assert_eq!(state(&d), original);
            bytes = d.export_hwpx_native().unwrap();
            fs::write(
                out.join(format!("{}-cycle{cycle}.hwpx", f["case"].as_str().unwrap())),
                &bytes,
            )
            .unwrap();
            assert_eq!(state(&DocumentCore::from_bytes(&bytes).unwrap()), original);
        }
        rows.push(json!({"case":f["case"],"cycles":6,"sourceAndNumberingModelPreserved":true,"model":original}));
    }
    fs::write(
        out.join("raw.json"),
        serde_json::to_vec(
            &json!({"cases":manifest.len(),"saves":rows.len()*6,"GUIVerified":false,"rows":rows}),
        )
        .unwrap(),
    )
    .unwrap();
    println!(
        "Native: {} cases, {} save/reopen cycles, numbering/source unchanged",
        manifest.len(),
        rows.len() * 6
    );
}
