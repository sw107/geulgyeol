//! Font-family classification parity corpus: render, decision trace, history and reopens.
use rhwp::document_core::DocumentCore;
use serde_json::json;

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "SOURCE_HWPX OUTPUT_DIR");
    std::fs::create_dir_all(&args[2]).unwrap();
    let bytes = std::fs::read(&args[1]).unwrap();
    let mut names: Vec<String> = [
        "HCR Batang",
        "KoPub돋움체 Light",
        "KoPub바탕체 Medium",
        "kOpUb DoTuM",
        "KOPUB BATANG",
        "KoPub돋움체 KoPub바탕체",
        "KoPuB DoTuM",
        "Unknown Sans",
        "한양신명조",
        "한양중고딕",
        "'KoPub Batang'",
        "KoPub Dotum, fallback",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    names.push(format!("{}KoPub Dotum", "x".repeat(256)));
    names.push(format!("{}KoPub바탕체", "한".repeat(100)));
    let text = "가나다 한글 ABC abc 0123 () ,.·ㆍ ‘“「」〈〉─…\tﾊﾟ カナ ＡＢ\u{2007} 󰊰□ 😀 á 각 ";
    let (mut cases, mut history, mut reopens) = (0, 0, 0);
    for (family, name) in names.iter().enumerate() {
        for variant in 0..4 {
            let mut d = DocumentCore::from_bytes(&bytes).unwrap();
            let mut doc = d.document().clone();
            for font in doc.doc_info.font_faces.iter_mut().flatten() {
                font.name = name.clone();
            }
            for shape in &mut doc.doc_info.char_shapes {
                shape.raw_data = None;
                shape.bold = variant & 1 != 0;
                shape.italic = variant & 2 != 0;
                shape.base_size = if variant & 1 != 0 { 1600 } else { 850 };
                shape.spacings = [if variant >= 2 { -9 } else { 0 }; 7];
                shape.superscript = variant == 3;
            }
            d.set_document(doc);
            d.insert_text_native(0, 0, 0, text).unwrap();
            let before_text = d.text_file_unicode_json();
            let before_views: Vec<_> = (0..d.page_count())
                .map(|p| d.render_page_svg_native(p).unwrap())
                .collect();
            let trace: Vec<_> = (0..d.page_count())
                .map(|p| d.get_font_decision_trace_native(p, "{}").unwrap())
                .collect();
            let id = d.save_snapshot_with_composition_native();
            d.insert_text_native(0, 0, 0, "next ").unwrap();
            d.restore_snapshot_native(id).unwrap();
            assert_eq!(d.text_file_unicode_json(), before_text);
            assert_eq!(
                (0..d.page_count())
                    .map(|p| d.render_page_svg_native(p).unwrap())
                    .collect::<Vec<_>>(),
                before_views
            );
            d.discard_snapshot_native(id);
            history += 1;
            for exported in [
                d.export_hwp_with_adapter_snapshot().unwrap(),
                d.export_hwpx_native().unwrap(),
            ] {
                let reopened = DocumentCore::from_bytes(&exported).unwrap();
                assert_eq!(reopened.text_file_unicode_json(), before_text);
                reopens += 1;
            }
            let output = json!({"family":name,"variant":variant,"svg":before_views,"trace":trace});
            std::fs::write(
                format!("{}/family-{family}-variant-{variant}.json", args[2]),
                serde_json::to_vec(&output).unwrap(),
            )
            .unwrap();
            cases += 1;
        }
    }
    let proof = json!({"fontFamilies":names.len(),"cases":cases,"snapshotRestores":history,"twoFormatReopens":reopens,"UnicodeCaseFoldAndOversizedNames":true,"GUIVerified":false});
    std::fs::write(
        format!("{}/font-corpus-proof.json", args[2]),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
