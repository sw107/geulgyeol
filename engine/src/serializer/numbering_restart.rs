//! Export-only lowering of body-list NewStart into standard numbering definitions.
//! Hancom stores a new list as a new NUMBERING + PARA_SHAPE reference, not `nwno`.
use super::SerializeError;
use crate::model::{document::Document, paragraph::NumberingRestart, style::HeadType};
use quick_xml::{events::Event, Reader, Writer};
use std::{borrow::Cow, collections::HashMap};

/// No restart means no clone, rewritten bytes, or provenance changes.
pub(crate) fn document_for_export(doc: &Document) -> Result<Cow<'_, Document>, SerializeError> {
    if !doc
        .sections
        .iter()
        .flat_map(|s| &s.paragraphs)
        .any(|p| matches!(p.numbering_restart, Some(NumberingRestart::NewStart(_))))
    {
        return Ok(Cow::Borrowed(doc));
    }
    let mut projected = doc.clone();
    let mut active_ids = HashMap::<u16, u16>::new();
    let mut shapes = HashMap::<(u16, u16), u16>::new();
    for section in &mut projected.sections {
        for para in &mut section.paragraphs {
            let source_shape = doc
                .doc_info
                .para_shapes
                .get(para.para_shape_id as usize)
                .ok_or_else(|| unsupported("missing paragraph shape"))?;
            if let Some(NumberingRestart::NewStart(value)) = para.numbering_restart {
                // The installed Hancom oracle proves a new top-level numbered
                // list, including following lower levels. Do not invent an
                // outline/sublevel restart record that the format does not define.
                if source_shape.head_type != HeadType::Number || source_shape.para_level != 0 {
                    return Err(unsupported(
                        "only level-1 body NUMBER list restarts are supported",
                    ));
                }
                let source = source_shape
                    .numbering_id
                    .checked_sub(1)
                    .and_then(|i| doc.doc_info.numberings.get(i as usize))
                    .ok_or_else(|| unsupported("missing numbering definition"))?;
                // Preserve current runtime semantics: the counter is relative
                // to the definition's per-level start, with zero advancing to 1.
                let start = source.level_start_numbers[0]
                    .saturating_sub(1)
                    .checked_add(value.max(1))
                    .and_then(|v| u16::try_from(v).ok())
                    .ok_or_else(|| unsupported("restart exceeds HWP numbering start range"))?;
                let mut number = source.clone();
                number.start_number = start;
                number.level_start_numbers[0] = u32::from(start);
                number.raw_data = None;
                number.raw_para_heads = source
                    .raw_para_heads
                    .as_deref()
                    .map(|raw| replace_first_start(raw, start))
                    .transpose()?;
                let id = u16::try_from(projected.doc_info.numberings.len() + 1)
                    .map_err(|_| unsupported("too many numbering definitions"))?;
                projected.doc_info.numberings.push(number);
                active_ids.insert(source_shape.numbering_id, id);
            }
            // ContinuePrevious has the existing ID/history semantics and needs
            // no wire field. Mapping follows that logical list across ID switches.
            para.numbering_restart = None;
            if source_shape.head_type != HeadType::Number {
                continue;
            }
            if let Some(&id) = active_ids.get(&source_shape.numbering_id) {
                let key = (para.para_shape_id, id);
                let shape_id = if let Some(&shape_id) = shapes.get(&key) {
                    shape_id
                } else {
                    let mut shape = source_shape.clone();
                    shape.numbering_id = id;
                    shape.raw_data = None;
                    let shape_id = u16::try_from(projected.doc_info.para_shapes.len())
                        .map_err(|_| unsupported("too many paragraph shapes"))?;
                    projected.doc_info.para_shapes.push(shape);
                    shapes.insert(key, shape_id);
                    shape_id
                };
                para.para_shape_id = shape_id;
                section.raw_stream = None;
            }
        }
    }
    projected.doc_info.raw_stream_dirty = true;
    Ok(Cow::Owned(projected))
}
fn unsupported(reason: &str) -> SerializeError {
    SerializeError::UnsupportedInput(format!("paragraph numbering restart: {reason}"))
}

/// Change only the standard level-1 `start` attribute. Preserve all other
/// events/tokens, including unmodeled HWPX heads 8–10 and lexical boolean flags.
fn replace_first_start(raw: &str, start: u16) -> Result<String, SerializeError> {
    let mut reader = Reader::from_str(raw);
    let mut writer = Writer::new(Vec::new());
    let mut changed = false;
    loop {
        let event = reader
            .read_event()
            .map_err(|e| unsupported(&e.to_string()))?;
        match event {
            Event::Eof => break,
            Event::Start(ref tag) | Event::Empty(ref tag)
                if tag.local_name().as_ref() == "paraHead"
                    && tag
                        .try_get_attribute("level")
                        .map_err(|e| unsupported(&e.to_string()))?
                        .map_or(false, |a| a.value.as_ref() == "1") =>
            {
                if changed {
                    return Err(unsupported("duplicate HWPX level-1 head"));
                }
                let mut replacement = tag.to_owned();
                replacement.clear_attributes();
                let value = start.to_string();
                for attr in tag.attributes() {
                    let attr = attr.map_err(|e| unsupported(&e.to_string()))?;
                    if attr.key.as_ref() != "start" {
                        replacement.push_attribute(attr);
                    }
                }
                replacement.push_attribute(("start", value.as_str()));
                let replacement = if matches!(event, Event::Empty(_)) {
                    Event::Empty(replacement)
                } else {
                    Event::Start(replacement)
                };
                writer
                    .write_event(replacement)
                    .map_err(|e| unsupported(&e.to_string()))?;
                changed = true;
            }
            event => writer
                .write_event(event)
                .map_err(|e| unsupported(&e.to_string()))?,
        }
    }
    if !changed {
        return Err(unsupported("missing HWPX level-1 head"));
    }
    String::from_utf8(writer.into_inner()).map_err(|e| unsupported(&e.to_string()))
}
