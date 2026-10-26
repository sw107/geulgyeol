//! Synthetic malformed HWP inputs for native CLI/MCP adapter contracts.
use rhwp::{model::control::Control, wasm_api::HwpDocument};

pub(crate) fn cell_document(with_paragraph: bool) -> HwpDocument {
    let mut doc = HwpDocument::create_empty();
    let created: serde_json::Value = serde_json::from_str(
        &doc.create_table_native(0, 0, 0, 1, 1)
            .expect("create synthetic table"),
    )
    .unwrap();
    let para = created["paraIdx"].as_u64().unwrap() as usize;
    if with_paragraph {
        doc.insert_text_in_cell_native(0, para, 0, 0, 0, 0, "원본🙂")
            .unwrap();
    } else {
        let Control::Table(table) =
            &mut doc.document_mut().sections[0].paragraphs[para].controls[0]
        else {
            panic!("table expected");
        };
        table.cells[0].paragraphs.clear();
    }
    // Exercise data accepted by the real HWP reader, not just a mutated live model.
    let bytes = doc.export_hwp_native().expect("serialize synthetic HWP");
    let reopened = HwpDocument::from_bytes(&bytes).expect("parse synthetic HWP");
    let (_, _, _, _, lengths, _) = crate::resolve_table_cell(reopened.document(), 0, 0, 0)
        .unwrap_or_else(|_| panic!("table coordinate must resolve"));
    assert_eq!(lengths.len(), usize::from(with_paragraph));
    reopened
}

pub(crate) fn text(doc: &HwpDocument) -> String {
    crate::resolve_table_cell(doc.document(), 0, 0, 0)
        .unwrap_or_else(|_| panic!("table coordinate must resolve"))
        .5
}
