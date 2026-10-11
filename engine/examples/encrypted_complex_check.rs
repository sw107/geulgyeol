//! Existing synthetic fixtures only; encrypted/plain parity stays in memory.
use rhwp::{document_core::DocumentCore, model::{paragraph::Paragraph, control::Control,
    bin_data::{BinDataBytes, BinDataResolver}}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

const INPUT: &[u8] = b"QA-fixture-input-only";
const OUTPUT: &[u8] = b"QA-fixture-output-only";
const WRONG: &[u8] = b"QA-fixture-incorrect";

fn hash(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect() }
fn write(out: &Path, name: &str, value: &Value) {
    std::fs::write(out.join(name), serde_json::to_vec_pretty(value).unwrap()).unwrap();
}
// Representation caches/packed attributes have typed semantic counterparts.
// Never remove text, typed geometry, image/caption data, or format references.
fn canonical(v: &mut Value) {
    match v {
        Value::Array(a) => a.iter_mut().for_each(canonical),
        Value::Object(o) => {
            o.retain(|k, _| !k.starts_with("raw_") && !matches!(k.as_str(),
                "attr" | "dirty" | "line_segs" | "hwpx_axis_shift" |
                "layout_only_fill_lines" | "single_line_overflow_memo" |
                "text_reflowed_after_edit" | "char_count_msb" | "control_mask" |
                "ctrl_data_records" | "list_header_width_ref"));
            for x in o.values_mut() { canonical(x); }
        }
        _ => {}
    }
}
fn paragraphs(ps: &[Paragraph]) -> Value {
    json!(ps.iter().map(|p| {
        let mut controls = serde_json::to_value(&p.controls).unwrap();
        canonical(&mut controls);
        json!({"text":p.text,"style":p.style_id,"paraShape":p.para_shape_id,
            "perCharShape":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
            "controls":controls})
    }).collect::<Vec<_>>())
}
fn projection(d: &DocumentCore) -> Value {
    let info = &d.document().doc_info;
    let mut chars = serde_json::to_value(&info.char_shapes).unwrap();
    let mut paras = serde_json::to_value(&info.para_shapes).unwrap();
    canonical(&mut chars); canonical(&mut paras);
    json!({"paragraphsControls":d.document().sections.iter().map(|s|paragraphs(&s.paragraphs)).collect::<Vec<_>>(),
        "charDefinitions":chars,"paraDefinitions":paras,
        "styles":info.styles.iter().map(|s|json!({"name":s.local_name,"english":s.english_name,
            "type":s.style_type,"next":s.next_style_id,"char":s.char_shape_id,"para":s.para_shape_id,"lang":s.lang_id})).collect::<Vec<_>>(),
        "binData":d.document().bin_data_content.iter().map(|b|{let bytes=b.data.load();
            json!({"id":b.id,"extension":b.extension,"length":bytes.len(),"sha256":hash(&bytes)})}).collect::<Vec<_>>()})
}
fn differences(a: &Value, b: &Value) -> Vec<String> {
    a.as_object().unwrap().iter().filter(|(key,value)|b.get(*key)!=Some(*value))
        .map(|(key,_)|key.clone()).collect()
}
fn detailed_diff(a: &Value, b: &Value) -> Vec<Value> {
    fn walk(a: &Value, b: &Value, path: String, out: &mut Vec<Value>) {
        if a == b || out.len() >= 32 { return; }
        match (a,b) {
            (Value::Object(x),Value::Object(y)) => {
                let keys: std::collections::BTreeSet<_> = x.keys().chain(y.keys()).collect();
                for k in keys { walk(x.get(k).unwrap_or(&Value::Null),y.get(k).unwrap_or(&Value::Null),format!("{path}/{k}"),out); }
            }
            (Value::Array(x),Value::Array(y)) if x.len()==y.len() => {
                for (i,(a,b)) in x.iter().zip(y).enumerate() { walk(a,b,format!("{path}/{i}"),out); }
            }
            _ => out.push(json!({"path":path,"before":a,"after":b})),
        }
    }
    let mut out=vec![];
    for (key,value) in a.as_object().unwrap() {
        let mut component=vec![];
        walk(value,b.get(key).unwrap_or(&Value::Null),format!("/{key}"),&mut component);
        out.extend(component);
    }
    out
}
fn features(d: &DocumentCore) -> Value {
    fn walk(ps: &[Paragraph], text: &mut Vec<Value>, tables: &mut Vec<Value>, pictures: &mut Vec<Value>) {
        for p in ps {
            text.push(json!({"text":p.text,"style":p.style_id,"paraShape":p.para_shape_id,
                "perCharShape":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>() }));
            for c in &p.controls { match c {
                Control::Table(t) => {
                    tables.push(json!({"rows":t.row_count,"cols":t.col_count,"repeatHeader":t.repeat_header,
                        "pageBreak":t.page_break,"spacing":t.cell_spacing,"padding":t.padding,
                        "width":t.common.width,"height":t.common.height,"margin":t.common.margin,
                        "cells":t.cells.iter().map(|c|json!({"row":c.row,"col":c.col,"rowSpan":c.row_span,
                            "colSpan":c.col_span,"width":c.width,"height":c.height,"header":c.is_header,"padding":c.padding})).collect::<Vec<_>>() }));
                    for c in &t.cells { walk(&c.paragraphs,text,tables,pictures); }
                    if let Some(caption)=&t.caption { walk(&caption.paragraphs,text,tables,pictures); }
                }
                Control::Picture(p) => {
                    pictures.push(json!({"width":p.common.width,"height":p.common.height,"crop":p.crop,
                        "image":p.image_attr,"reverse":p.reverse,"lock":p.lock}));
                    if let Some(caption)=&p.caption { walk(&caption.paragraphs,text,tables,pictures); }
                }
                _ => {}
            }}
        }
    }
    let (mut text,mut tables,mut pictures)=(vec![],vec![],vec![]);
    for s in &d.document().sections { walk(&s.paragraphs,&mut text,&mut tables,&mut pictures); }
    json!({"textAndFormat":text,"tables":tables,"pictures":pictures})
}
#[derive(Debug)]
struct RejectBoundedResource(Vec<u8>);
impl BinDataResolver for RejectBoundedResource {
    fn resolve(&self, _key: &str) -> Vec<u8> { self.0.clone() }
    fn resolve_limited(&self, _key: &str, _max_bytes: usize) -> Option<Vec<u8>> { None }
    // No raw passthrough. Only this QA clone refuses bounded export reads.
}
fn svg(d: &DocumentCore) -> Vec<String> {
    assert!((1..=16).contains(&d.page_count()), "bounded synthetic pages");
    (0..d.page_count()).map(|i|d.render_page_svg_native(i).unwrap()).collect()
}
fn svg_hash(d: &DocumentCore) -> Vec<String> { svg(d).iter().map(|s|hash(s.as_bytes())).collect() }
fn password_checks(bytes: &[u8], password: &[u8]) -> DocumentCore {
    assert!(DocumentCore::from_bytes(bytes).is_err(), "encrypted file requires password");
    assert!(DocumentCore::from_bytes_with_password(bytes, WRONG).is_err(), "wrong fixture password rejected");
    DocumentCore::from_bytes_with_password(bytes, password).expect("correct fixture password reopens")
}
fn plain(d: &DocumentCore, format: &str) -> rhwp::serializer::SerializedDocument {
    if format == "hwp" { d.export_hwp_with_adapter_snapshot_with_report().unwrap() }
    else { d.export_hwpx_native_with_report().unwrap() }
}
fn protected(d: &DocumentCore, format: &str, password: &[u8]) -> rhwp::serializer::SerializedDocument {
    if format == "hwp" { d.export_hwp_with_adapter_snapshot_with_password_and_report(password).unwrap() }
    else { d.export_hwpx_native_with_password_and_report(password).unwrap() }
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let out = Path::new(&args[0]); std::fs::create_dir(out).expect("fresh evidence");
    let manifest: Value = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut rows = vec![];
    if manifest["schema"] == "geulgyeol-encrypted-complex-host-v1" {
        assert_eq!(manifest["rows"].as_array().unwrap().len(),12);
        let mut pairs=std::collections::BTreeSet::new();
        for r in manifest["rows"].as_array().unwrap() {
            let label=r["label"].as_str().unwrap();let source=r["source"].as_str().unwrap();let target=r["target"].as_str().unwrap();
            assert!(["repeat-table","merged-repeat-table","caption-pictures"].contains(&label));
            assert!(["hwp","hwpx"].contains(&source)&&["hwp","hwpx"].contains(&target));
            assert!(pairs.insert((label,source,target)),"unique matrix pair");
        }
        let mut failures = 0;
        for r in manifest["rows"].as_array().unwrap() {
            if r["status"] != "saved" { rows.push(r.clone()); continue; }
            let bytes = std::fs::read(r["file"].as_str().unwrap()).unwrap();
            assert_eq!(hash(&bytes),r["sha256"].as_str().unwrap());
            let actual = password_checks(&bytes, OUTPUT);
            let reference = password_checks(&std::fs::read(r["reference"].as_str().unwrap()).unwrap(), OUTPUT);
            let actual_projection = projection(&actual);
            let diff = differences(&projection(&reference), &actual_projection);
            let native_svg_equal = svg(&actual) == svg(&reference);
            let wasm_svg_equal = json!(svg_hash(&actual)) == r["wasmSvgSHA256"];
            let passed = diff.is_empty() && native_svg_equal && wasm_svg_equal;
            if !passed { failures += 1; }
            rows.push(json!({"label":r["label"],"source":r["source"],"target":r["target"],
                "status":if passed {"passed"} else {"preservation-failed"},"semanticDifferences":diff,
                "fullNativeSVGEqual":native_svg_equal,"nativeWasmFullSVGEqual":wasm_svg_equal,
                "correctPasswordReopen":true,"noPasswordRejected":true,"wrongPasswordRejected":true,
                "pages":actual.page_count(),"binData":actual_projection["binData"]}));
        }
        write(out,"proof.json",&json!({"syntheticOnly":true,"NativeExecuted":true,"MacUIExecuted":false,
            "phase":"host-reopen","rows":rows,"preservationFailures":failures,"passwordsLogged":false}));
        println!("Native complex host reopen: {} rows, {failures} preservation failures",rows.len());
        if failures > 0 { std::process::exit(1); }
        return;
    }
    assert_eq!(manifest["schema"],"geulgyeol-encrypted-complex-fixtures-v1");
    assert_eq!(manifest["rows"].as_array().unwrap().len(),3);
    let labels: std::collections::BTreeSet<_>=manifest["rows"].as_array().unwrap().iter().map(|r|r["label"].as_str().unwrap()).collect();
    assert_eq!(labels,std::collections::BTreeSet::from(["repeat-table","merged-repeat-table","caption-pictures"]));
    let mut inputs = vec![]; let mut encryption_failures = 0; let mut loss_checks=vec![];
    for fixture in manifest["rows"].as_array().unwrap() {
        let label = fixture["label"].as_str().unwrap();
        let original = std::fs::read(fixture["file"].as_str().unwrap()).unwrap();
        assert_eq!(hash(&original),fixture["sha256"].as_str().unwrap());
        let seed = DocumentCore::from_bytes(&original).unwrap();
        let original_projection = projection(&seed);
        if label=="caption-pictures" {
            let mut fault=DocumentCore::from_bytes(&original).unwrap();
            let bytes=fault.document().bin_data_content[0].data.load();
            fault.document_mut().bin_data_content[0].data=BinDataBytes::Lazy {
                resolver:std::sync::Arc::new(RejectBoundedResource(bytes)),key:"existing-synthetic-image".into() };
            let before=projection(&fault);let model=format!("{:?}",fault.document());
            for target in ["hwp","hwpx"] {
                let a=protected(&fault,target,OUTPUT);let b=plain(&fault,target);
                assert!(!a.content_loss().is_empty(),"bounded resource failure must be reported");
                assert_eq!(a.content_loss(),b.content_loss());
                let loss:Value=serde_json::from_str(&a.content_loss().to_json()).unwrap();
                assert!(projection(&fault)==before&&format!("{:?}",fault.document())==model);
                loss_checks.push(json!({"target":target,"loss":loss,"boundedResourceFaultInjected":true,
                    "liveResourceBytesPreserved":true,"lossyBytesSaved":false,"plaintextFallback":false}));
            }
        }
        for source in ["hwp","hwpx"] {
            let a = protected(&seed, source, INPUT);
            let input_loss: Value = serde_json::from_str(&a.content_loss().to_json()).unwrap();
            if !a.content_loss().is_empty() {
                inputs.push(json!({"label":label,"source":source,"status":"content-loss-rejected","loss":input_loss}));
                for target in ["hwp","hwpx"] { rows.push(json!({"label":label,"source":source,
                    "target":target,"status":"input-content-loss-rejected","loss":input_loss})); }
                continue;
            }
            let input_bytes = a.into_bytes();
            let input_file = out.join(format!("{label}-input.{source}"));
            std::fs::write(&input_file,&input_bytes).unwrap();
            let mut d = password_checks(&input_bytes, INPUT);
            let input_diff = differences(&original_projection,&projection(&d));
            let plain_input=DocumentCore::from_bytes(&plain(&seed,source).into_bytes()).unwrap();
            assert!(projection(&d)==projection(&plain_input)&&svg(&d)==svg(&plain_input),"input encryption/plain parity");
            inputs.push(json!({"label":label,"source":source,"status":"prepared","file":input_file,
                "sha256":hash(&input_bytes),"inputSemanticDifferences":input_diff,"pages":d.page_count()}));
            d.insert_text_native(0,0,0,"SAVED_EDIT ").unwrap();
            let before = projection(&d); let before_svg = svg(&d);let core_before=features(&d);
            let model_before = format!("{:?}",d.document());
            for target in ["hwp","hwpx"] {
                let baseline = plain(&d,target); let a = protected(&d,target,OUTPUT);
                let loss: Value = serde_json::from_str(&a.content_loss().to_json()).unwrap();
                assert_eq!(baseline.content_loss(),a.content_loss(),"encrypted/plain loss reports match");
                if !a.content_loss().is_empty() {
                    rows.push(json!({"label":label,"source":source,"target":target,
                        "status":"content-loss-rejected","loss":loss})); continue;
                }
                // Plain bytes never become a saved file or a host fallback.
                let baseline_open = DocumentCore::from_bytes(&baseline.into_bytes()).unwrap();
                let bytes = a.into_bytes(); let opened = password_checks(&bytes,OUTPUT);
                assert!(DocumentCore::from_bytes_with_password(&bytes,INPUT).is_err(),"explicit new password");
                let after = projection(&opened);
                let parity = after == projection(&baseline_open) && svg(&opened) == svg(&baseline_open);
                if !parity { encryption_failures += 1; }
                let diff = differences(&before,&after); let exact_svg = svg(&opened)==before_svg;
                let core_after=features(&opened);
                let file = out.join(format!("{label}-{source}-to-{target}.{target}"));
                std::fs::write(&file,&bytes).unwrap();
                let source_model_equal = format!("{:?}",d.document())==model_before;
                assert!(source_model_equal,"export preserves source model");
                rows.push(json!({"label":label,"source":source,"target":target,"file":file,
                    "status":if !parity {"encryption-parity-failed"} else if !diff.is_empty() || !exact_svg {"format-roundtrip-limit"} else {"passed"},
                    "encryptedPlainParity":parity,"sourceSemanticDifferences":diff,"sourceFullSVGEqual":exact_svg,
                    "formatDifferenceDetails":detailed_diff(&before,&after),
                    "bodyCellCaptionTextAndFormatEqual":core_before["textAndFormat"]==core_after["textAndFormat"],
                    "tableHeaderAndGeometryEqual":core_before["tables"]==core_after["tables"],
                    "pictureGeometryAttributesEqual":core_before["pictures"]==core_after["pictures"],
                    "completeImageBytesEqual":before["binData"]==after["binData"],
                    "correctPasswordReopen":true,"noPasswordRejected":true,"wrongPasswordRejected":true,
                    "previousPasswordRejected":true,"sourceModelPreserved":source_model_equal,
                    "pages":opened.page_count(),"binData":after["binData"],"loss":loss}));
            }
        }
        assert_eq!(std::fs::read(fixture["file"].as_str().unwrap()).unwrap(),original);
    }
    write(out,"manifest.json",&json!({"schema":"geulgyeol-encrypted-complex-native-v1","inputs":inputs,"rows":rows}));
    write(out,"proof.json",&json!({"syntheticOnly":true,"NativeExecuted":true,"MacUIExecuted":false,
        "phase":"native-format-matrix","inputs":inputs,"rows":rows,"encryptionFailures":encryption_failures,
        "originalFixturesPreserved":true,"passwordsLogged":false,"plainBaselineMemoryOnly":true,
        "contentLossFaultChecks":loss_checks}));
    println!("Native complex encrypted matrix: {} prepared/rejected inputs, {} output rows, {encryption_failures} encryption failures",inputs.len(),rows.len());
    if encryption_failures > 0 { std::process::exit(1); }
}
