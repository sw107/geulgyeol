//! Tiny self-contained PNGs. Compare literal metadata separately from geometry.
use rhwp::{
    document_core::DocumentCore,
    model::{
        bin_data::{BinDataBytes, BinDataResolver},
        control::Control,
        image::Picture,
    },
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

const PASSWORD: &[u8] = b"QA-image-dimension-only";
const PNG1: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 63, 229, 63, 0, 8,
    197, 3, 98, 106, 47, 76, 123, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];
const PNG2: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0,
    0, 0, 114, 182, 13, 36, 0, 0, 0, 20, 73, 68, 65, 84, 120, 156, 99, 248, 255, 63, 229, 63, 3,
    24, 51, 0, 9, 32, 6, 0, 96, 7, 9, 137, 14, 142, 239, 13, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
    96, 130,
];
fn hash(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn picture(d: &DocumentCore) -> &Picture {
    d.document().sections[0]
        .paragraphs
        .iter()
        .flat_map(|p| &p.controls)
        .find_map(|c| {
            if let Control::Picture(p) = c {
                Some(p)
            } else {
                None
            }
        })
        .unwrap()
}
fn picture_mut(d: &mut DocumentCore) -> &mut Picture {
    d.document_mut().sections[0]
        .paragraphs
        .iter_mut()
        .flat_map(|p| &mut p.controls)
        .find_map(|c| {
            if let Control::Picture(p) = c {
                Some(p)
            } else {
                None
            }
        })
        .unwrap()
}
// This mirrors the renderer's first two coordinate-reference choices. It does
// not rewrite IR or assert that the literal imgDim field survives conversion.
fn effective(p: &Picture) -> (u32, u32) {
    p.crop_reference_size()
        .unwrap_or((p.crop.right as u32, p.crop.bottom as u32))
}
fn geometry(p: &Picture) -> Value {
    json!({"width":p.common.width,"height":p.common.height,"crop":p.crop,
        "borderX":p.border_x,"borderY":p.border_y,"padding":p.padding,
        "originalWidth":p.shape_attr.original_width,"originalHeight":p.shape_attr.original_height,
        "currentWidth":p.shape_attr.current_width,"currentHeight":p.shape_attr.current_height,
        "image":p.image_attr,"reverse":p.reverse,"lock":p.lock})
}
fn svg(d: &DocumentCore) -> Vec<String> {
    assert_eq!(d.page_count(), 1, "one-page bounded fixture");
    let rendered = d.render_page_svg_native(0).unwrap();
    assert!(
        rendered.contains("data:image/png;base64,"),
        "SVG must contain the actual synthetic image"
    );
    vec![rendered]
}
fn resources(d: &DocumentCore) -> Vec<Vec<u8>> {
    d.document()
        .bin_data_content
        .iter()
        .map(|b| b.data.load().to_vec())
        .collect()
}
fn export(d: &DocumentCore, f: &str, protected: bool) -> rhwp::serializer::SerializedDocument {
    match (f, protected) {
        ("hwp", false) => d.export_hwp_with_adapter_snapshot_with_report().unwrap(),
        ("hwp", true) => d
            .export_hwp_with_adapter_snapshot_with_password_and_report(PASSWORD)
            .unwrap(),
        ("hwpx", false) => d.export_hwpx_native_with_report().unwrap(),
        ("hwpx", true) => d
            .export_hwpx_native_with_password_and_report(PASSWORD)
            .unwrap(),
        _ => panic!("bounded formats"),
    }
}
fn reopen(b: &[u8], protected: bool) -> DocumentCore {
    if protected {
        assert!(DocumentCore::from_bytes(b).is_err());
        assert!(DocumentCore::from_bytes_with_password(b, b"QA-wrong-image-only").is_err());
        DocumentCore::from_bytes_with_password(b, PASSWORD).unwrap()
    } else {
        DocumentCore::from_bytes(b).unwrap()
    }
}
#[derive(Debug)]
struct RefuseExport(Vec<u8>);
impl BinDataResolver for RefuseExport {
    fn resolve(&self, _key: &str) -> Vec<u8> {
        self.0.clone()
    }
    fn resolve_limited(&self, _key: &str, _limit: usize) -> Option<Vec<u8>> {
        None
    }
}
fn main() {
    let arg = std::env::args().nth(1).unwrap();
    let out = Path::new(&arg);
    std::fs::create_dir(out).expect("fresh evidence directory");
    let mut rows = vec![];
    let mut chains = vec![];
    let mut faults = vec![];
    let mut sensitivity = vec![];
    for (label, png, px, dims, clip, expected_hwp_dims) in [
        ("one-pixel-full", PNG1, 1, (75, 75), (0, 0, 75, 75), (0, 0)),
        ("non-75-full", PNG2, 2, (200, 300), (0, 0, 200, 300), (0, 0)),
        (
            "shortened-crop",
            PNG2,
            2,
            (200, 300),
            (0, 0, 50, 75),
            (200, 300),
        ),
        (
            "left-top-crop",
            PNG2,
            2,
            (200, 300),
            (150, 225, 200, 300),
            (0, 0),
        ),
    ] {
        let blank = rhwp::wasm_api::HwpDocument::create_empty();
        let mut factory =
            DocumentCore::from_bytes(&blank.export_hwpx_native_with_report().unwrap().into_bytes())
                .unwrap();
        factory
            .insert_picture_native(0, 0, 0, &[], png, 1500, 1800, px, px, "png", "", None, None)
            .unwrap();
        let p = picture_mut(&mut factory);
        p.img_dim = dims;
        p.crop.left = clip.0;
        p.crop.top = clip.1;
        p.crop.right = clip.2;
        p.crop.bottom = clip.3;
        // Reparse HWPX so the adapter is exercised with an actual HWPX source.
        let source_bytes = export(&factory, "hwpx", false).into_bytes();
        let source = DocumentCore::from_bytes(&source_bytes).unwrap();
        assert_eq!(picture(&source).img_dim, dims);
        assert_eq!(resources(&source), vec![png.to_vec()]);
        let source_svg = svg(&source);
        let before = format!("{:?}", source.document());
        for target in ["hwpx", "hwp"] {
            let baseline = export(&source, target, false);
            let expected = if target == "hwp" {
                expected_hwp_dims
            } else {
                dims
            };
            for protected in [false, true] {
                let artifact = export(&source, target, protected);
                let loss: Value = serde_json::from_str(&artifact.content_loss().to_json()).unwrap();
                let opened = reopen(&artifact.into_bytes(), protected);
                let p = picture(&opened);
                let plain = DocumentCore::from_bytes(baseline.bytes()).unwrap();
                let raw_extra_dims = if target == "hwp" {
                    assert!(p.raw_picture_extra.len() >= 17);
                    Some((
                        u32::from_le_bytes(p.raw_picture_extra[9..13].try_into().unwrap()),
                        u32::from_le_bytes(p.raw_picture_extra[13..17].try_into().unwrap()),
                    ))
                } else {
                    None
                };
                let passed = p.img_dim == expected
                    && effective(p) == dims
                    && resources(&opened) == resources(&source)
                    && geometry(p) == geometry(picture(&source))
                    && svg(&opened) == source_svg
                    && p.img_dim == picture(&plain).img_dim
                    && svg(&opened) == svg(&plain)
                    && loss["count"] == 0
                    && (target != "hwp" || raw_extra_dims == Some(expected));
                rows.push(json!({"case":label,"target":target,"protected":protected,"passed":passed,
                    "sourceImgDim":dims,"outputImgDim":p.img_dim,"literalMetadataEqual":p.img_dim==dims,
                    "effectiveReferenceEqual":effective(p)==dims,"rawExtraDims":raw_extra_dims,
                    "geometryEqual":geometry(p)==geometry(picture(&source)),"completeImageBytesEqual":resources(&opened)==resources(&source),
                    "fullSVGEqual":svg(&opened)==source_svg,"encryptedPlainParity":p.img_dim==picture(&plain).img_dim&&svg(&opened)==svg(&plain),
                    "loss":loss,"imageLength":png.len(),"imageSHA256":hash(png),"decodedPixels":[px,px],"sourceModelPreserved":format!("{:?}",source.document())==before,
                    "noPasswordRejected":if protected {Some(true)} else {None},"wrongPasswordRejected":if protected {Some(true)} else {None}}));
                if target == "hwp" && !protected {
                    let back = export(&opened, "hwpx", false);
                    let back_loss = back.content_loss().len();
                    let returned = DocumentCore::from_bytes(&back.into_bytes()).unwrap();
                    let chain_passed = picture(&returned).img_dim == expected
                        && effective(picture(&returned)) == dims
                        && resources(&returned) == resources(&source)
                        && svg(&returned) == source_svg
                        && back_loss == 0;
                    chains.push(json!({"case":label,"passed":chain_passed,"imgDimAfterHwpToHwpx":picture(&returned).img_dim,
                        "literalMetadataEqual":picture(&returned).img_dim==dims,"effectiveReferenceEqual":effective(picture(&returned))==dims,
                        "fullSVGEqual":svg(&returned)==source_svg,"completeImageBytesEqual":resources(&returned)==resources(&source),"lossCount":back_loss}));
                }
            }
        }
        assert_eq!(
            format!("{:?}", source.document()),
            before,
            "snapshot export cannot mutate live model"
        );
        if label == "shortened-crop" {
            let mut counter = DocumentCore::from_bytes(&source_bytes).unwrap();
            picture_mut(&mut counter).img_dim = (0, 0);
            let counter =
                DocumentCore::from_bytes(&export(&counter, "hwpx", false).into_bytes()).unwrap();
            sensitivity.push(
                json!({"case":label,"zeroReferenceChangesSVG":svg(&counter)!=source_svg,
                "zeroReferenceChangesEffectiveCoordinates":effective(picture(&counter))!=dims}),
            );
        }
        if label == "one-pixel-full" {
            for target in ["hwpx", "hwp"] {
                let mut fault = DocumentCore::from_bytes(&source_bytes).unwrap();
                let data = fault.document_mut().bin_data_content.first_mut().unwrap();
                data.data = BinDataBytes::Lazy {
                    key: "synthetic-read-refusal".into(),
                    resolver: std::sync::Arc::new(RefuseExport(png.to_vec())),
                };
                let artifact = export(&fault, target, false);
                let report: Value =
                    serde_json::from_str(&artifact.content_loss().to_json()).unwrap();
                let emptied = DocumentCore::from_bytes(artifact.bytes()).unwrap();
                let expected_reason = if target == "hwp" {
                    "rawPassthroughUnavailable"
                } else {
                    "resourceReadFailedOrLimitExceeded"
                };
                let fault_passed = artifact.content_loss().len() == 1
                    && report["losses"][0]["code"] == "binaryContentEmptied"
                    && report["losses"][0]["reason"] == expected_reason
                    && resources(&fault) == vec![png.to_vec()]
                    && resources(&emptied) == vec![Vec::<u8>::new()];
                faults.push(json!({"target":target,"passed":fault_passed,"outputResourceEmptied":resources(&emptied)==vec![Vec::<u8>::new()],
                    "actualNativeReport":report,"lossyBytesSaved":false,"sourceResourcePreserved":resources(&fault)==vec![png.to_vec()]}));
            }
        }
    }
    let passed = rows.len() == 16
        && chains.len() == 4
        && faults.len() == 2
        && sensitivity.len() == 1
        && rows
            .iter()
            .chain(&chains)
            .chain(&faults)
            .all(|r| r["passed"] == true)
        && sensitivity[0]["zeroReferenceChangesSVG"] == true;
    let proof = json!({"schema":"geulgyeol-picture-dimension-v1","syntheticOnly":true,"NativeExecuted":true,
        "MacUIExecuted":false,"bytesMemoryOnly":true,"passed":passed,"rows":rows,"chains":chains,
        "binaryFaults":faults,"cropSensitivity":sensitivity});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("Picture dimensions: 16 exports, 4 return chains, 2 binary faults, crop sensitivity; passed={passed}");
    if !passed {
        std::process::exit(1);
    }
}
