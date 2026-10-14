//! Native render checks against four head combinations observed in Hancom.
//! Synthetic input; this executable does not claim native-app UI coverage.
use rhwp::document_core::DocumentCore;
use serde_json::{json, Value};
use std::{fs, path::Path};
fn observe(d: &DocumentCore) -> Value {
    let pages: Vec<Value> = (0..d.page_count()).map(|p| {
        serde_json::from_str(&d.get_page_text_layout_native(p).unwrap()).unwrap()
    }).collect();
    json!({"pages":pages,"text":d.document().sections[0].paragraphs.iter()
        .map(|p| &p.text).collect::<Vec<_>>(),"heads":d.document().doc_info.numberings, "properties":(0..4).map(|p|
        serde_json::from_str::<Value>(&d.get_para_properties_at_native(0,p).unwrap()).unwrap()).collect::<Vec<_>>()})
}
fn check(v: &Value) -> Value {
    let runs: Vec<&Value> = v["pages"].as_array().unwrap().iter()
        .flat_map(|p| p["runs"].as_array().unwrap()).collect();
    let mut rows = Vec::new();
    for (p,bits) in [0,4,8,12].iter().enumerate() {
        let props=&v["properties"][p];
        let id=props["numberingId"].as_u64().unwrap() as usize;
        let level=props["paraLevel"].as_u64().unwrap() as usize;
        assert_eq!(v["heads"][id-1]["heads"][level]["attr"].as_u64().unwrap() & 12,*bits);
    }
    for p in 0..4 {
        let body: Vec<_> = runs.iter().copied().filter(|r| r["paraIdx"] == p
            && r["charStart"].is_number() && !r["text"].as_str().unwrap_or("").is_empty()).collect();
        let first = body.iter().find(|r| r["charStart"] == 0).unwrap();
        let continuation = body.iter().find(|r| r["y"] != first["y"]).unwrap();
        rows.push(json!({"paragraph":p,"firstX":first["x"],"continuationX":continuation["x"],
            "lineCount":body.iter().map(|r| r["y"].to_string()).collect::<std::collections::BTreeSet<_>>().len()}));
    }
    let x = |p: usize, key: &str| rows[p][key].as_f64().unwrap();
    let near = |a:f64,b:f64| assert!((a-b).abs()<0.11,"{a} != {b}");
    near(x(0,"continuationX"),x(1,"continuationX"));
    near(x(0,"firstX"),x(2,"firstX")); near(x(1,"firstX"),x(3,"firstX"));
    near(x(2,"firstX"),x(2,"continuationX")); near(x(3,"firstX"),x(3,"continuationX"));
    assert!(x(0,"firstX") > x(0,"continuationX"));
    assert!(x(1,"firstX") > x(0,"firstX")+1.0);
    json!(rows)
}
fn main() {
    let args: Vec<_> = std::env::args().collect(); assert_eq!(args.len(),3,"INPUT_HWPX FRESH_OUTPUT");
    let out=Path::new(&args[2]); assert!(!out.exists()); fs::create_dir_all(out).unwrap();
    let original=fs::read(&args[1]).unwrap(); let mut d=DocumentCore::from_bytes(&original).unwrap();
    let initial=observe(&d); fs::write(out.join("initial.json"),serde_json::to_vec_pretty(&initial).unwrap()).unwrap();
    let rows=check(&initial); let mut stages=Vec::new();
    for (i,format) in ["hwpx","hwp","hwpx","hwp"].iter().enumerate() {
        let artifact=if *format=="hwp" {d.export_hwp_with_adapter_snapshot_with_report()} else {d.export_hwpx_native_with_report()}.unwrap();
        assert!(artifact.content_loss().is_empty()); let bytes=artifact.into_bytes();
        fs::write(out.join(format!("roundtrip-{i}.{format}")),&bytes).unwrap();
        d=DocumentCore::from_bytes(&bytes).unwrap(); let v=observe(&d); let r=check(&v);
        assert_eq!(r,rows); assert_eq!(v["text"],initial["text"]);
        fs::write(out.join(format!("roundtrip-{i}.json")),serde_json::to_vec_pretty(&v).unwrap()).unwrap();
        stages.push(json!({"format":format,"layoutAndTextEqual":true}));
    }
    fs::write(out.join("proof.json"),serde_json::to_vec_pretty(&json!({"rows":rows,"stages":stages,"nativeAppUI":false})).unwrap()).unwrap();
    println!("{}",json!({"fourHeadCombinations":true,"saveReopens":4,"rows":rows}));
}
