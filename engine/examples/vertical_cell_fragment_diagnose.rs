//! Read-only model/fragment diagnostics; intentionally does not repair unsupported layout.
use rhwp::{
    document_core::DocumentCore,
    model::control::Control,
    renderer::render_tree::{BoundingBox, RenderNode, RenderNodeType},
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
fn bbox(b: &BoundingBox) -> Value {
    json!({"x":b.x,"y":b.y,"width":b.width,"height":b.height})
}
fn contains(b: &BoundingBox, r: &BoundingBox) -> bool {
    r.x >= b.x - 0.5
        && r.y >= b.y - 0.5
        && r.x + r.width <= b.x + b.width + 0.5
        && r.y + r.height <= b.y + b.height + 0.5
}
fn target_cell<'a>(n: &'a RenderNode, result: &mut Vec<&'a RenderNode>) {
    if let RenderNodeType::TableCell(c) = &n.node_type {
        if c.model_cell_index == Some(0) {
            result.push(n);
        }
    }
    for child in &n.children {
        target_cell(child, result);
    }
}
fn runs(
    n: &RenderNode,
    result: &mut BTreeMap<usize, String>,
    boxes: &mut Vec<(usize, BoundingBox)>,
) {
    if let RenderNodeType::TextRun(r) = &n.node_type {
        if let Some(p) = r.para_index {
            result.entry(p).or_default().push_str(&r.text);
            boxes.push((p, n.bbox.clone()));
        }
    }
    for child in &n.children {
        runs(child, result, boxes);
    }
}
fn compact_svg(d: &DocumentCore, page: u32) -> String {
    let s = d.render_page_svg_native(page).unwrap();
    s.split("<text")
        .skip(1)
        .filter_map(|s| {
            s.split_once('>')
                .and_then(|(_, s)| s.split_once("</text>").map(|(s, _)| s))
        })
        .collect::<String>()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let source: Value = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut all = Vec::new();
    for fixture in source["fixtures"].as_array().unwrap() {
        for file in fixture["outputs"].as_array().unwrap() {
            let file = file.as_str().unwrap();
            let d = DocumentCore::from_bytes(&std::fs::read(file).unwrap()).unwrap();
            let parent = fixture["parent"].as_u64().unwrap() as usize;
            let ci = fixture["ci"].as_u64().unwrap() as usize;
            let Control::Table(t) = &d.document().sections[0].paragraphs[parent].controls[ci]
            else {
                panic!("table")
            };
            let cell = &t.cells[0];
            let texts = cell
                .paragraphs
                .iter()
                .map(|p| p.text.clone())
                .collect::<Vec<_>>();
            let unique = texts.iter().collect::<BTreeSet<_>>().len();
            assert_eq!(texts.len(), fixture["count"].as_u64().unwrap() as usize);
            assert_eq!(unique, texts.len());
            assert_eq!(
                u64::from(cell.text_direction),
                fixture["direction"].as_u64().unwrap()
            );
            let old = d.export_hwpx_native().unwrap();
            let mut pages = Vec::new();
            let dump = d.dump_page_items_json(None);
            let mut emitted = vec![0usize; texts.len()];
            let mut complete = vec![0usize; texts.len()];
            for page in 0..d.page_count() {
                let tree = d.build_page_render_tree(page).unwrap();
                let mut cells = Vec::new();
                target_cell(&tree.root, &mut cells);
                let mut map = BTreeMap::new();
                let mut boxes = Vec::new();
                for c in &cells {
                    runs(c, &mut map, &mut boxes);
                }
                let cell_box = cells.first().map(|c| &c.bbox);
                let clip = cells.first().and_then(|c| {
                    if let RenderNodeType::TableCell(tc) = &c.node_type {
                        Some((tc.clip, tc.page_fragment))
                    } else {
                        None
                    }
                });
                let text = compact_svg(&d, page);
                for (p, s) in texts.iter().enumerate() {
                    complete[p] += text.matches(s).count();
                    if map.contains_key(&p) {
                        emitted[p] += 1;
                    }
                }
                let items=dump[page as usize]["columns"].as_array().unwrap().iter().flat_map(|col|col["items"].as_array().unwrap()).filter(|i|matches!(i["kind"].as_str(),Some("table"|"partialTable"))).map(|i|json!({"kind":i["kind"],"startRow":i["startRow"],"endRow":i["endRow"],"startCut":i["startCut"],"endCut":i["endCut"],"isContinuation":i["isContinuation"]})).collect::<Vec<_>>();
                // CellUnit indices use the horizontal paragraph/line ledger. The synthetic case has
                // one stored line per paragraph; compare that allocation's width if reused as columns.
                let pitch = cell
                    .paragraphs
                    .first()
                    .and_then(|p| p.line_segs.first())
                    .map(|l| f64::from(l.line_height + l.line_spacing) * 96.0 / 7200.0)
                    .unwrap_or(0.0);
                let range=items.first().map(|i|{let start=i["startCut"].get(0).and_then(Value::as_u64).unwrap_or(0) as usize;let end=i["endCut"].get(0).and_then(Value::as_u64).map(|n|n as usize).unwrap_or(texts.len()).min(texts.len());json!({"startUnit":start,"endUnit":end,"singleLineParagraphCountUpperBound":end.saturating_sub(start),"columnPitchFromStoredLinePx":pitch,"naiveColumnsWidthPx":end.saturating_sub(start) as f64*pitch})});
                let outside = boxes
                    .iter()
                    .filter(|(_, r)| cell_box.is_some_and(|b| !contains(b, r)))
                    .count();
                let wholly_outside = boxes
                    .iter()
                    .filter(|(_, r)| {
                        cell_box.is_some_and(|b| {
                            r.x + r.width <= b.x
                                || r.x >= b.x + b.width
                                || r.y + r.height <= b.y
                                || r.y >= b.y + b.height
                        })
                    })
                    .count();
                pages.push(json!({"page":page,"bodyArea":dump[page as usize]["bodyArea"],"fragmentItems":items,"cellBox":cell_box.map(bbox),"clipFlags":clip,"renderedParaIds":map.keys().collect::<Vec<_>>(),"runsOutsideCell":outside,"runsWhollyOutsideCell":wholly_outside,"firstParaRunBox":boxes.iter().find(|(p,_)|*p==0).map(|(_,b)|bbox(b)),"lastParaRunBox":boxes.iter().find(|(p,_)|*p==texts.len()-1).map(|(_,b)|bbox(b)),"horizontalCutAsNaiveColumns":range}));
            }
            assert_eq!(
                old,
                d.export_hwpx_native().unwrap(),
                "read-only rendering must not mutate saved model"
            );
            let expected = fixture["renderOccurrences"][0].as_u64().unwrap() as usize;
            assert!(complete.iter().all(|n| *n == expected));
            all.push(json!({"id":fixture["id"],"file":file,"modelParagraphs":texts.len(),"modelDuplicates":texts.len()-unique,"direction":cell.text_direction,"pageCount":d.page_count(),"renderedParaOwnerCounts":emitted.into_iter().collect::<BTreeSet<_>>(),"completeTextCounts":complete.into_iter().collect::<BTreeSet<_>>(),"paragraph0StoredLines":cell.paragraphs[0].line_segs.iter().map(|l|json!({"vpos":l.vertical_pos,"height":l.line_height,"spacing":l.line_spacing,"segmentWidth":l.segment_width,"charStart":l.text_start})).collect::<Vec<_>>(),"pages":pages}));
        }
    }
    std::fs::create_dir_all(&args[2]).unwrap();
    let proof = json!({"cases":all.len(),"observations":all,"productionEngineChanged":false,"GUIVerified":false,"verticalPaginationSupported":false,"visibleVerticalNumberingSupported":false});
    std::fs::write(
        format!("{}/proof.json", args[2]),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("Native read-only model/fragment cases: {}", proof["cases"]);
}
