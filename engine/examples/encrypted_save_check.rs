//! Synthetic Native password-save regression. No user documents or passwords.
use rhwp::wasm_api::HwpDocument;
use serde_json::{json, Value};
use std::path::Path;
// Public, non-secret fixture values, never printed or passed as CLI arguments.
const INPUT_PASSWORD: &[u8] = b"QA-fixture-input-only";
const OUTPUT_PASSWORD: &[u8] = b"QA-fixture-output-only";
const WRONG_PASSWORD: &[u8] = b"QA-fixture-incorrect";

fn protected(d: &HwpDocument, format: &str) -> Vec<u8> {
    let artifact = match format {
        "hwp" => d.export_hwp_with_adapter_snapshot_with_password_and_report(OUTPUT_PASSWORD),
        "hwpx" => d.export_hwpx_native_with_password_and_report(OUTPUT_PASSWORD),
        _ => unreachable!(),
    }.expect("reported encrypted export");
    assert!(artifact.content_loss().is_empty(), "no silent content loss");
    artifact.into_bytes()
}
fn svg(d: &HwpDocument) -> Vec<String> {
    assert!(d.page_count() <= 2, "bounded synthetic layout");
    (0..d.page_count()).map(|i| d.render_page_svg_native(i).unwrap()).collect()
}
fn main() {
    let output = std::env::args().nth(1).expect("fresh private QA output");
    let out = Path::new(&output);
    std::fs::create_dir(out).expect("fresh native evidence directory");
    if let Some(manifest) = std::env::args().nth(2) {
        let records: Value = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
        assert_eq!(records["schema"], "geulgyeol-synthetic-encrypted-save-v1");
        let rows=records["rows"].as_array().unwrap();
        assert_eq!(rows.len(),4);
        for row in rows {
            let bytes=std::fs::read(row["file"].as_str().unwrap()).unwrap();
            let expected=std::fs::read(row["reference"].as_str().unwrap()).unwrap();
            assert!(HwpDocument::from_bytes(&bytes).is_err());
            assert!(HwpDocument::from_bytes_with_password(&bytes,WRONG_PASSWORD).is_err());
            let actual=HwpDocument::from_bytes_with_password(&bytes,OUTPUT_PASSWORD).unwrap();
            let reference=HwpDocument::from_bytes_with_password(&expected,OUTPUT_PASSWORD).unwrap();
            assert_eq!(actual.get_text_file_text(),reference.get_text_file_text());
            assert_eq!(svg(&actual),svg(&reference),"complete independent Native SVG of host output");
            let wasm_svg: Vec<String> = serde_json::from_value(row["wasmSvg"].clone()).unwrap();
            assert!(svg(&actual) == wasm_svg, "complete Native/WASM SVG comparison for synthetic host output");
        }
        std::fs::write(out.join("proof.json"),serde_json::to_vec_pretty(&json!({
            "syntheticOnly":true,"verifiedHostOutputs":rows.len(),"fullNativeSVG":true,"nativeWasmFullSVG":true,
            "correctPasswordReopen":true,"wrongPasswordRejected":true,"plaintextOpenRejected":true,
            "NativeExecuted":true,"MacUIExecuted":false,"passwordsLogged":false,
        })).unwrap()).unwrap();
        println!("PASS independent Native encrypted host outputs: 4 format pairs");
        return;
    }
    let mut seed = HwpDocument::create_empty();
    seed.create_blank_document_native().unwrap();
    seed.insert_text_native(0, 0, 0, "암호 저장 합성 문서 한글 ABC123🙂").unwrap();
    seed.apply_char_format_native(0, 0, 0, 5, r#"{"bold":true,"fontSize":1400}"#).unwrap();
    let mut rows: Vec<Value> = vec![];
    for source in ["hwp", "hwpx"] {
        let artifact = match source {
            "hwp" => seed.export_hwp_with_adapter_snapshot_with_password_and_report(INPUT_PASSWORD),
            _ => seed.export_hwpx_native_with_password_and_report(INPUT_PASSWORD),
        }.unwrap();
        assert!(artifact.content_loss().is_empty());
        let input = artifact.into_bytes();
        let input_name = format!("input-{source}.{source}");
        std::fs::write(out.join(&input_name), &input).unwrap();
        assert!(HwpDocument::from_bytes(&input).is_err(), "input requires password");
        assert!(HwpDocument::from_bytes_with_password(&input, WRONG_PASSWORD).is_err(), "wrong input password rejected");
        let mut d = HwpDocument::from_bytes_with_password(&input, INPUT_PASSWORD).unwrap();
        d.insert_text_native(0, 0, 0, "SAVED_EDIT ").unwrap();
        let expected_text = d.get_text_file_text();
        let expected_svg = svg(&d);
        let model_before = format!("{:?}", d.document());
        for target in ["hwp", "hwpx"] {
            let bytes = protected(&d, target);
            let name = format!("saved-{source}-to-{target}.{target}");
            std::fs::write(out.join(&name), &bytes).unwrap();
            assert!(HwpDocument::from_bytes(&bytes).is_err(), "saved output still requires password");
            assert!(HwpDocument::from_bytes_with_password(&bytes, WRONG_PASSWORD).is_err(), "wrong saved password rejected");
            assert!(HwpDocument::from_bytes_with_password(&bytes, INPUT_PASSWORD).is_err(), "explicit new password applied");
            let reopened = HwpDocument::from_bytes_with_password(&bytes, OUTPUT_PASSWORD).unwrap();
            assert_eq!(reopened.get_text_file_text(), expected_text, "edited text survives encrypted save");
            assert_eq!(svg(&reopened), expected_svg, "complete Native SVG after encrypted reopen");
            assert!(format!("{:?}", d.document()) == model_before, "reported export preserves full source model");
            assert_eq!(std::fs::read(out.join(&input_name)).unwrap(), input, "original fixture unchanged");
            rows.push(json!({"source":source,"target":target,"file":name,"pages":reopened.page_count(),
                "correctPasswordReopen":true,"wrongPasswordRejected":true,"plaintextOpenRejected":true,
                "explicitNewPasswordApplied":true,"fullNativeSVG":true,"sourceModelPreserved":true,"originalPreserved":true}));
        }
    }
    std::fs::write(out.join("proof.json"), serde_json::to_vec_pretty(&json!({
        "syntheticOnly":true,"maxPages":2,"rows":rows,"userDocumentsUsed":false,
        "NativeExecuted":true,"MacUIExecuted":false,"passwordsLogged":false
    })).unwrap()).unwrap();
    println!("PASS Native encrypted save: 4 format pairs, protected reopen and source preservation");
}
