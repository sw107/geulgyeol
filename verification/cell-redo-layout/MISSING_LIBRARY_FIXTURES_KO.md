# 라이브러리 단위 검사 fixture 누락

이전 `cargo test --lib`는 10개 파일 누락으로 28개 include_bytes! 컴파일 오류가 났다. 이번 작업에서도 누락 상태가 같다. 전체 단위 검사를 통과했다고 주장하지 않는다. 이번 검증은 별도 synthetic fixture를 사용한 엔진 examples와 실제 WASM 검사이며, 이 누락 파일을 대체하지 않았다.

출처는 저장소의 아래 include 위치까지만 확인했다. 파일의 외부 원출처·다운로드 URL·라이선스는 검증하지 않았다. 원본 작업 루트에서도 파일 존재 여부만 확인했다. 개인 문서를 대체물로 사용하거나 업로드하지 않았다.

| 필요한 경로 | include 위치 |
| --- | --- |
| `engine/samples/3-09월_교육_통합_2022.hwp` | `engine/src/document_core/commands/document.rs:2808` |
| `engine/samples/hml/formatting_table.hml` | `engine/src/document_core/commands/document.rs:2834`, `engine/src/parser/mod.rs:2894`, `engine/src/wasm_api/tests.rs:24950`, `engine/src/wasm_api/tests.rs:24970`, `engine/src/wasm_api/tests.rs:24990`, `engine/src/wasm_api/tests.rs:25025`, `engine/src/wasm_api/tests.rs:25044`, `engine/src/wasm_api/tests.rs:25085` |
| `engine/samples/hwp3-sample16-hwp5.hwp` | `engine/src/document_core/commands/formatting.rs:2444` |
| `engine/samples/render-p35-font-native-bitmap.hwpx` | `engine/src/document_core/queries/rendering.rs:8409`, `engine/src/document_core/queries/rendering.rs:8693` |
| `engine/tests/fixtures/fonts/RHWPBitmapSvgGlyphSmoke.ttf` | `engine/src/document_core/queries/rendering.rs:8619`, `engine/src/paint/builder.rs:381`, `engine/src/paint/font_glyph.rs:1004` |
| `engine/tests/fixtures/fonts/RHWPExactFaceSmoke.ttc` | `engine/src/paint/font_glyph.rs:1013`, `engine/src/paint/json.rs:3174`, `engine/src/paint/text_v2.rs:840`, `engine/src/renderer/layer_renderer.rs:1066` |
| `engine/assets/logo/logo-32.png` | `engine/src/renderer/canvaskit_policy.rs:2270`, `engine/src/renderer/layer_renderer.rs:1065` |
| `engine/ttfs/opensource/NotoSansKR-Regular.ttf` | `engine/src/renderer/font_metrics_data.rs:317` |
| `engine/samples/hwpx/aift.hwpx` | `engine/src/serializer/hwpx/header.rs:1495` |
| `engine/samples/hwpx/ref/ref_empty.hwpx` | `engine/src/serializer/hwpx/header.rs:1517`, `engine/src/serializer/hwpx/header.rs:1530`, `engine/src/serializer/hwpx/header.rs:1556`, `engine/src/serializer/hwpx/header.rs:1576`, `engine/src/serializer/hwpx/header.rs:1741` |

상세 기록: `missing-library-fixtures.json`. 기존 오류 로그: `../search-span-qa/unit-run.log` (QA 루트 기준).
