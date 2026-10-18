//! Explicit top-level secPr ownership; never distribute masters by manifest order.
use super::{
    content::PackageItem,
    reader::HwpxReader,
    utils::{attr_str, local_name},
    HwpxError,
};
use crate::model::{control::Control, document::Section};
use quick_xml::{events::Event, Reader};
use std::collections::{HashMap, HashSet};

#[derive(Default)]
struct Owner {
    paragraph: Option<usize>,
    refs: Vec<String>,
    explicitly_empty: bool,
    declares_masters: bool,
}

fn owners(xml: &str) -> Result<Vec<Owner>, HwpxError> {
    let mut reader = Reader::from_str(xml);
    let mut stack: Vec<Vec<u8>> = Vec::new();
    let mut result: Vec<Owner> = Vec::new();
    let (mut paragraph, mut next_paragraph, mut active) = (None, 0, None);
    loop {
        let event = reader.read_event()?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(&event, Event::Empty(_));
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"p" && stack.len() == 1 && stack[0] == b"sec" {
                    paragraph = Some(next_paragraph);
                    next_paragraph += 1;
                }
                if name == b"secPr" {
                    if active.is_some() {
                        return Err(HwpxError::ConversionError(
                            "nested secPr ownership is ambiguous".into(),
                        ));
                    }
                    let body = stack.len() == 3
                        && stack[0] == b"sec"
                        && stack[1] == b"p"
                        && stack[2] == b"run";
                    result.push(Owner {
                        paragraph: if body { paragraph } else { None },
                        refs: Vec::new(),
                        explicitly_empty: e.attributes().flatten().any(|a| {
                            a.key.as_ref().as_bytes() == b"masterPageCnt"
                                && attr_str(&a).parse::<u32>() == Ok(0)
                        }),
                        declares_masters: e.attributes().flatten().any(|a| {
                            a.key.as_ref().as_bytes() == b"masterPageCnt"
                                && attr_str(&a).parse::<u32>().is_ok_and(|n| n > 0)
                        }),
                    });
                    if !empty {
                        active = Some(result.len() - 1);
                    }
                } else if name == b"masterPage" {
                    if let Some(index) = active {
                        if stack.last().is_some_and(|n| n == b"secPr") {
                            for a in e.attributes().flatten() {
                                if a.key.as_ref().as_bytes() == b"idRef" {
                                    result[index].refs.push(attr_str(&a));
                                }
                            }
                        }
                    }
                }
                if !empty {
                    stack.push(name);
                }
            }
            Event::End(e) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"secPr" {
                    active = None;
                }
                if name == b"p" && stack.len() == 2 {
                    paragraph = None;
                }
                stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(result)
}

/// Returns false for the existing single-owner path, except an explicitly empty
/// owner cannot inherit another physical section's global manifest parts.
/// Multi-owner input needs explicit IDs, a first-paragraph root and one directly
/// represented secPr per owner.
pub(super) fn attach(
    reader: &mut HwpxReader,
    section: &mut Section,
    xml: &str,
    items: &[PackageItem],
    bins: &[PackageItem],
) -> Result<bool, HwpxError> {
    let groups = owners(xml)?;
    if groups.len() < 2 {
        return Ok(groups.first().is_some_and(|g| {
            g.paragraph == Some(0) && g.explicitly_empty && g.refs.is_empty() && !items.is_empty()
        }));
    }
    let invalid = |message: &str| {
        HwpxError::ConversionError(format!("inline master-page ownership: {message}"))
    };
    if !groups.iter().any(|g| !g.refs.is_empty()) {
        if groups.iter().all(|g| g.explicitly_empty) {
            // Global manifest items may belong to another physical section.
            // Explicitly empty owners cannot inherit that section's parts.
            return Ok(!items.is_empty());
        }
        return Err(invalid(
            "multiple secPr definitions have no explicit masterPage references",
        ));
    }
    if groups.first().and_then(|g| g.paragraph) != Some(0) {
        return Err(invalid(
            "first secPr is not a directly represented first-paragraph owner",
        ));
    }
    let mut by_id = HashMap::new();
    for item in items {
        if by_id.insert(item.id.as_str(), item.href.as_str()).is_some() {
            return Err(invalid("duplicate manifest master-page ID"));
        }
    }
    let mut seen_paragraphs = HashSet::new();
    // Validate every owner and target before binding any data.
    for group in &groups {
        if group.refs.is_empty() && group.declares_masters {
            return Err(invalid("masterPage count has no explicit owner references"));
        }
        let Some(pi) = group.paragraph else {
            if group.refs.is_empty() {
                continue;
            }
            return Err(invalid(
                "nested secPr master pages need an explicit supported owner path",
            ));
        };
        if !seen_paragraphs.insert(pi) {
            return Err(invalid("multiple secPr definitions in one paragraph"));
        }
        let count = section
            .paragraphs
            .get(pi)
            .map(|p| {
                p.controls
                    .iter()
                    .filter(|c| matches!(c, Control::SectionDef(_)))
                    .count()
            })
            .unwrap_or(0);
        if count != 1 {
            return Err(invalid("XML owner and parsed SectionDef do not match"));
        }
        for id in &group.refs {
            if !by_id.contains_key(id.as_str()) {
                return Err(invalid(&format!("unresolved masterPage idRef '{id}'")));
            }
        }
    }
    for group in groups {
        let Some(pi) = group.paragraph else { continue };
        let mut masters = Vec::new();
        let mut seen = HashSet::new();
        for id in group.refs {
            let href = by_id[id.as_str()];
            if !seen.insert(href) {
                continue;
            }
            let xml = reader.read_file(href)?;
            masters.push(super::section::parse_hwpx_master_page(
                &super::canonicalize_bin_item_refs(&xml, bins),
            )?);
        }
        let sd = section.paragraphs[pi]
            .controls
            .iter_mut()
            .find_map(|c| match c {
                Control::SectionDef(sd) => Some(sd),
                _ => None,
            })
            .unwrap();
        sd.master_pages = masters;
    }
    // The package-level definition mirrors the first paragraph, as required by
    // the HWP export adapter. A later definition cannot replace that first owner.
    section.section_def = section.paragraphs[0]
        .controls
        .iter()
        .find_map(|c| match c {
            Control::SectionDef(sd) => Some((**sd).clone()),
            _ => None,
        })
        .unwrap();
    Ok(true)
}
