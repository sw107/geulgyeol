//! Synthetic multi-secd ownership, edit/snapshot checks and inspectable disk roundtrips.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        document::Section,
        header_footer::{HeaderFooterApply, MasterPage},
        paragraph::Paragraph,
        provenance::SourceFormat,
    },
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn masters(ms: &[MasterPage]) -> Value {
    json!(ms.iter().map(|m| json!({"text":m.paragraphs.iter().map(|p|p.text.as_str()).collect::<Vec<_>>().join("|"),
        "apply":format!("{:?}",m.apply_to),"extension":m.is_extension,"width":m.text_width,
        "height":m.text_height,"direction":m.text_direction,"front":m.page_front})).collect::<Vec<_>>())
}
fn view(d: &DocumentCore) -> Value {
    json!(d.document().sections.iter().enumerate().map(|(si,s)| {
        let defs: Vec<_> = s.paragraphs.iter().enumerate().flat_map(|(pi,p)| p.controls.iter().filter_map(move |c| match c {
            Control::SectionDef(sd) => Some(json!({"para":pi,"width":sd.page_def.width,"masters":masters(&sd.master_pages)})), _=>None
        })).collect();
        json!({"section":si,"width":s.section_def.page_def.width,"outerMasters":masters(&s.section_def.master_pages),"controls":defs,"body":s.paragraphs.iter().map(|p|p.text.clone()).collect::<Vec<_>>()})
    }).collect::<Vec<_>>())
}
fn state(d: &DocumentCore) -> Value {
    // Rendering initializes the derived SingleLineOverflowMemo cache. Seal the
    // model after that initialization so refusal checks compare like states.
    let svg = (0..d.page_count())
        .map(|p| d.render_page_svg_native(p).unwrap())
        .collect::<Vec<_>>();
    json!({"model":format!("{:?}",d.document()),"svg":svg})
}
fn write_json(out: &Path, name: &str, data: &Value) {
    fs::write(out.join(name), serde_json::to_vec_pretty(data).unwrap()).unwrap();
}
fn section(original: &Section, number: usize) -> Section {
    let mut s = original.clone();
    let p = &mut s.paragraphs[0];
    let n = p.text.chars().count();
    p.delete_text_at(0, n);
    p.insert_text_at(0, &format!("BODY_{number}"));
    s.section_def.page_def.width = if number == 0 { 59528 } else { 42000 };
    let mut mp = Paragraph::new_empty_like(p);
    mp.insert_text_at(0, &format!("MASTER_{number}"));
    s.section_def.master_pages = vec![MasterPage {
        apply_to: HeaderFooterApply::Both,
        paragraphs: vec![mp],
        text_width: 20000,
        text_height: 5000,
        text_ref: 1,
        ..Default::default()
    }];
    s.section_def.flags = (s.section_def.flags & !(3 << 30)) | (1 << 30);
    for c in &mut p.controls {
        if let Control::SectionDef(sd) = c {
            **sd = s.section_def.clone();
        }
    }
    s.raw_stream = None;
    s
}
fn seed() -> (DocumentCore, Section, Section) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "SEED").unwrap();
    let original = d.document().sections[0].clone();
    (d, section(&original, 0), section(&original, 1))
}
fn install(d: &mut DocumentCore, sections: Vec<Section>) {
    d.document_mut().sections = sections;
    let document = d.document().clone();
    d.set_document(document);
}
fn roundtrips(d: &DocumentCore, out: &Path, label: &str) -> usize {
    let original = state(d);
    let mut count = 0;
    for ext in ["hwp", "hwpx"] {
        let bytes = if ext == "hwp" {
            d.export_hwp_native()
        } else {
            d.export_hwpx_native()
        };
        match bytes {
            Ok(bytes) => {
                fs::write(out.join(format!("{label}-export.{ext}")), &bytes).unwrap();
                match DocumentCore::from_bytes(&bytes) {
                    Ok(parsed) => {
                        write_json(out, &format!("{label}-{ext}-reopened.json"), &view(&parsed));
                        count += 1;
                    }
                    Err(e) => {
                        fs::write(
                            out.join(format!("{label}-{ext}-reopen-error.txt")),
                            e.to_string(),
                        )
                        .unwrap();
                    }
                }
            }
            Err(e) => {
                fs::write(out.join(format!("{label}-{ext}-error.txt")), e.to_string()).unwrap();
            }
        }
    }
    assert_eq!(
        state(d),
        original,
        "export must not rewrite live master owners"
    );
    count
}
fn guards(out: &Path) {
    let mut checks = 0;
    for extension_at in [0, 1] {
        let (mut d, a, b) = seed();
        let mut inline = a;
        inline.paragraphs.extend(b.paragraphs);
        install(&mut d, vec![inline]);
        let Control::SectionDef(sd) =
            &mut d.document_mut().sections[0].paragraphs[extension_at].controls[0]
        else {
            panic!()
        };
        sd.master_pages[0].is_extension = true;
        sd.master_pages[0].ext_flags = 2;
        sd.master_pages[0].replace_base = true;
        if extension_at == 0 {
            let cloned = (**sd).clone();
            d.document_mut().sections[0].section_def = cloned;
        }
        d.document_mut().provenance.format = SourceFormat::Hwpx;
        let before = state(&d);
        assert!(d.export_hwp_native().is_err());
        assert_eq!(state(&d), before);
        let bytes = d.export_hwpx_native().unwrap();
        fs::write(out.join(format!("extension-{extension_at}.hwpx")), &bytes).unwrap();
        let r = DocumentCore::from_bytes(&bytes).unwrap();
        assert!(r.export_hwp_native().is_err());
        checks += 1;
        if extension_at == 0 {
            d.document_mut().provenance.format = SourceFormat::Hwp5;
            let before = state(&d);
            assert!(d.export_hwpx_native().is_err());
            assert_eq!(state(&d), before);
            checks += 1;
        }
    }
    let (mut d, a, b) = seed();
    install(&mut d, vec![a]);
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::SectionDef(Box::new(b.section_def.clone())));
    let before = state(&d);
    assert!(d.export_hwpx_native().is_err());
    assert_eq!(state(&d), before);
    checks += 1;
    let (mut d, a, b) = seed();
    install(&mut d, vec![a]);
    let r: Value = serde_json::from_str(&d.create_table_native(0, 0, 0, 1, 1).unwrap()).unwrap();
    let pi = r["paraIdx"].as_u64().unwrap() as usize;
    let ci = r["controlIdx"].as_u64().unwrap() as usize;
    let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci] else {
        panic!()
    };
    t.cells[0].paragraphs = b.paragraphs.clone();
    for p in &mut t.cells[0].paragraphs {
        for c in &mut p.controls {
            if let Control::SectionDef(sd) = c {
                sd.master_pages.clear();
            }
        }
    }
    fs::write(
        out.join("nested-placeholder.hwpx"),
        d.export_hwpx_native().unwrap(),
    )
    .unwrap();
    let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci] else {
        panic!()
    };
    t.cells[0].paragraphs = b.paragraphs;
    let before = state(&d);
    assert!(d.export_hwpx_native().is_err());
    assert_eq!(state(&d), before);
    checks += 1;
    write_json(out, "guards.json", &json!({"unchangedRefusals":checks}));
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    if args[0] == "seed" {
        let (mut d, a, b) = seed();
        install(&mut d, vec![a.clone(), b.clone()]);
        fs::write(
            out.join("distinct-sections.hwpx"),
            d.export_hwpx_native().unwrap(),
        )
        .unwrap();
        fs::write(
            out.join("distinct-sections.hwp"),
            d.export_hwp_native().unwrap(),
        )
        .unwrap();
        let mut inline = a;
        inline.paragraphs.extend(b.paragraphs);
        install(&mut d, vec![inline]);
        write_json(out, "inline-model-before.json", &view(&d));
        roundtrips(&d, out, "inline-model");
    } else if args[0] == "guards" {
        guards(out);
    } else {
        let mut loads = 0;
        let mut reopens = 0;
        let mut restores = 0;
        for input in &args[2..] {
            let path = Path::new(input);
            let label = path.file_stem().unwrap().to_str().unwrap();
            match DocumentCore::from_bytes(&fs::read(path).unwrap()) {
                Ok(mut d) => {
                    loads += 1;
                    write_json(out, &format!("{label}-loaded.json"), &view(&d));
                    reopens += roundtrips(&d, out, label);
                    let before = state(&d);
                    let undo = d.save_snapshot_native();
                    let si = d.document().sections.len() - 1;
                    let pi = d.document().sections[si].paragraphs.len() - 1;
                    let at = d.document().sections[si].paragraphs[pi]
                        .text
                        .chars()
                        .count();
                    d.insert_text_native(si, pi, at, " EDIT").unwrap();
                    write_json(out, &format!("{label}-edited.json"), &view(&d));
                    reopens += roundtrips(&d, out, &format!("{label}-edited"));
                    let after = state(&d);
                    let redo = d.save_snapshot_native();
                    d.restore_snapshot_native(undo).unwrap();
                    assert_eq!(state(&d), before);
                    restores += 1;
                    d.restore_snapshot_native(redo).unwrap();
                    assert_eq!(state(&d), after);
                    restores += 1;
                    d.discard_snapshot_native(undo);
                    d.discard_snapshot_native(redo);
                }
                Err(e) => {
                    fs::write(out.join(format!("{label}-load-error.txt")), e.to_string()).unwrap();
                }
            }
        }
        write_json(
            out,
            "counts.json",
            &json!({"loads":loads,"reopens":reopens,"snapshotRestores":restores}),
        );
    }
}
