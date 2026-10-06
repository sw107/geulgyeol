# 단순 세로 셀 공유 adapter: 구현 전 설계·위험 보고

기준 `695f01e4801c6743a12cf05db33b6668d0df3ee4`, branch `dev/style-propagation`. 요청의 **“광범위 기존 테이블 페이지 할당 수정이 필요하면 구현 전 최소 설계와 위험 보고”** 조건을 적용하여 이번에는 production 연결을 보류했다. 독립 모듈은 유지하며 측정·페이지 할당·renderer/API/UI를 변경하지 않았다. 이 문서는 구현이나 실제 pagination 성공의 증거가 아니다.

## 확인된 공용 계약 경계

| 위치 | 현재 의미 | 연결에 필요한 변경 |
|---|---|---|
| `renderer/height_measurer.rs:1635`, `:2504` | 세로 셀 높이=max 저장 segment_width, 없으면400HU | page-independent 문자/metric source를 측정에 공급하고, 실제 page budget에 따른 fragment 높이는 allocator에서 확정해야 함 |
| `renderer/layout/table_layout.rs:4132`, `:8946` | 세로 전체 높이와 일반 CellUnit 구성이 별도. 유닛은 가로 줄/중첩 atom 및 y축 높이 | 세로 소유권을 기존 유닛 숫자로 위장하지 않는 별도 타입 필요 |
| `renderer/layout/table_layout.rs:1607`, `:1636` | RowCut은 셀별 소비한 CellUnit 수; CellUnit은 para/줄 범위·빈 spacer·중첩 cursor·hard break 등을 함께 가짐 | 문자 수·열 수를 RowCut으로 넣으면 기존 의미가 충돌하므로 변경 금지 |
| `renderer/typeset.rs:22588`, `:24109` | 기본 TypesetEngine의 block-table 진입 후 LayoutEngine/row_cut_content_height로 fit·split 예산 결정 | supported gate 이후에 전용 vertical allocation branch가 필요. 기존 fit/whole-row 판단에 잘못된 총높이를 흘리지 않아야 함 |
| `renderer/typeset.rs:25004` | continuation은 row/cell-unit cursor, 행 높이 보정, 각주 queue와 별도 prepared state를 소비 | vertical plan의 source cursor와 page footprint를 새 계약으로 전달해야 함 |
| `renderer/pagination.rs:577` | 공용 PartialTable은 RowCut과 rowspan/nested 도메인, 빈 밴드 높이만 전달 | typed vertical payload 또는 별도 variant 추가가 필요. 기존 컷 배열의 재해석 금지 |
| `renderer/layout.rs:8865`, `renderer/layout/table_partial.rs:1311` | 공용 항목을 renderer에 전달하나 세로 분기는 선택 범위를 읽지 않고 전체 문단 재compose | 확정한 fragment owner만 전달/방출하고 원본 pi/char_start를 유지해야 함 |

`PartialTable`을 참조하는 소스 파일은21개다. 모두를 바꾼다는 뜻은 아니지만 clone/index remap, 페이지 높이 cursor, item 분류/overflow, JSON dump, 편집/hit-test 소유권 등의 공용 소비자를 조사해야 한다. 단일1×1 gate만으로 공용 전달 계약을 생략할 수 없다.

레거시 `renderer/pagination/engine.rs`는 기본 allocator가 아니다. 기본 경로는 `renderer/typeset.rs`이다. 별도의 resumable job은 `typeset.rs:6128`에서 현재1행 표를 제외(`row_count <= 1`)한다. 최초1×1 adapter에는 기존 resumable 다행 job을 재설계하지 말고 현재 fallback을 유지하는 것이 좁은 선택이다. 추후 gate 확장 때에는 `BlockTableContinuationContext`와 deferred publication/revision도 별도로 검증해야 한다.

## 가장 좁은 구현 범위와 형태

초기 gate는 본문 최상위1행1열·row_span/col_span=1·RowBreak·비TAC·TopAndBottom·빈 host·캡션/머리행반복/셀간격/별도 offset 없는 단일 셀로 한정한다. 섹션은 단일 column, 정상 page rectangle이며 표 이외 겹침/어울림 배치와 page-zone 변경이 없어야 한다. 특수 저장 vpos/reset, keep-with-next/줄 보호·미구현 정렬·SQUEEZE, 각주/각종control/range tag를 포함하면 셀 전체 기존 경로다. 원본 모델의 스타일/직접 서식/번호 ID와 줄 저장값을 adapter 때문에 다시 쓰지 않는다.

공유 불변 source에는 원본 section/host/control/cell/paragraph/scalar 범위, 문서 revision, 원본 char/para style 참조, 방향, 불가분 shaped unit, 회전 뒤 ink extents와 advance, 열 폭/간격, 유효 padding을 둔다. 앞서 만든 독립 crate의 `Paragraph/Unit`는 계산 입력 부분이며, 원본 참조와 검증된 shaping/padding adapter가 아직 없다. style/font/source/geometry revision이 달라지면 전체 plan을 버리고 다시 계산한다.

권장 공용 전달은 **기존 RowCut 유지 + 새 typed vertical item/payload**이다. `Arc`로 불변 source와 완성 plan을 공유하고 각 page item에 해당 fragment index, 원본 source 범위, 실제 cell rectangle/소비 높이를 명시한다. 공용 item 생성·clone/remap·분류·높이/overflow·dump 경로를 한 번에 처리해야 하므로 단순 renderer patch보다 넓은 구조 변경이다. 이 단계에서 일반 CellUnit/RowCut allocator의 axis와 기존 helper 조건은 변경하지 않는다.

측정기는 이 source의 실제 glyph/column 요구량을 공유한다. 아직 page budget을 받지 않은 측정기에서 임의 scalar 총수나 저장 segment_width를 ‘전체 표 높이’로 환산하지 않는다. typesetter의 gate를 기존 legacy height 기반 whole-fit/declared-fit 판단보다 앞에 놓고, supported source에서만 전용 page allocation을 수행해야 한다. 완성된 fragment의 실제 footprint가 해당 표의 높이/flow 소비 권위가 된다.

## 고정 조각 수 없는 실제 할당 절차

1. 현재 TypesetState의 page/column rectangle, current_height, page tolerance, 기존 footnote/exclusion 예약, host/outer margin과 선언 셀 크기를 읽는다. 최초 cell rectangle은 현재 물리 영역의 잔여높이 이내이며 continuation은 해당 새 page의 실제 영역을 사용한다. padding을 뺀 각 usable rectangle의 네 모서리를 안쪽으로 quantize한다. 작은 첫 영역에서 한 unit/열도 못 넣으면 기존 page 전환 규칙으로 첫 유효 page를 요청한다.
2. shadow pagination state에 실제 page/column 전환 규칙을 적용하여 다음 frame을 얻는다. 현재 page budget을 독립 planner에 공급한다. `InsufficientFrames { paragraph_index, char_start }`면 allocator에 **다음 실제 frame 한 개**를 요청하고 다시 계획한다. 셀 width/height 제한을 page마다 적용하며 모든 문자를 배정할 때까지 반복한다. ‘7개’나 기존 가로4컷을 상수로 넣지 않는다. 무진행/페이지수·unit수 상한과 oversized ink는 명시적 오류다.
3. planner가 성공한 후 독립 소유권/순서/bbox 검증을 수행하고, shadow state의 실제 생성 page 수·각 fragment rectangle/소비 높이와 일치하는지 확인한다. 전량 성공하기 전에는 공개 page/cache/tree/ID cursor를 변경하지 않는다. 실제 frame마다 다른 높이나 footnote 예약이 생기면 해당 budget을 사용해야 하며 단순 full-height clone을 생산 frame이라고 주장하지 않는다.
4. 성공 plan을 typed page item으로 publish한다. 각 fragment는 선택한 원본 문자 unit만 방출한다. cell border/clip·문단 끝 marker·캐럿/편집 경로는 그 fragment의 실제 좌표에 대응한다. 마지막 fragment 뒤 후행 본문도 계획된 footprint로 이동한다. 실패하면 모든 shadow 결과를 버리고 **셀 전체** 기존 경로를 사용한다.

124문단의 조각 수는 위 절차의 결과다. page 크기/셀 폭/앞 본문 높이를 바꾸면 수가 달라져야 한다. 직전 독립 투영의 ‘추가7개/총11조각’은 보수적 공급 metric과 기존 geometry로 계산한 실험값일 뿐 실제 allocator 입력이나 기대값 상수가 아니다.

## shaping 범위와 아직 없는 보증

현재 bounded shaping gate는 `renderer/layout/table_cell_content.rs:284`에 있다. Native HWP5, 방향2, 단일 셀/문단/줄/run/열, 순수 CJK upright, 제한된 서식, 정확한 Noto Sans KR font SHA256 등이다(:312~402). 이는 **다문단/다열/다page, HWPX, 방향1, 영문/emoji**의 font metric 검증이 아니다. `shaping_vertical.rs`의 certificate는 font/source/geometry 계약을 가지므로 단지 정사각 fontsize를 계산해 그 certificate를 대체하면 안 된다.

첫 구현은 이 검증된 CJK/font/방향2 계약을 새 source adapter로 충분히 확장·검증할 수 있는 경우에만 켠다. 새 문단마다 certificate와 scalar/cluster mapping, 회전 뒤 ink bounds/advance를 확인하고, frame마다 다른 metric을 생성하지 않는다. 한 문자라도 font/source/shaping 검증이 불가능하면 셀 전체 fallback이다. 방향1·영문·emoji·복잡 cluster·다른 폰트는 검증 전 제외한다. 독립 모듈의 mixed-script 테스트를 실제 font/화면 지원 증거로 사용하지 않는다. HWPX가 gate에서 제외되면 그 저장재열기는 모델 보존·fallback 불변으로 검증해야 하며 실제 HWPX 세로 pagination 지원으로 주장하지 않는다.

## 구현 전 주요 위험과 통합 합격 조건

- **flow/높이 순환**: 기존 전체 세로높이가 실제 열의 폭 요구를 표현하지 않는다. 측정치를 먼저 기존 whole-fit에 흘리면 전용 branch에 도달하기 전에 잘못된 통배치가 결정될 수 있다. early gate와 실제 page-frame footprint 계약이 함께 필요하다.
- **도메인 충돌**: scalar·열 번호를 RowCut 값으로 넣거나 기존 문단을slice하면 cut/empty marker/편집 identity가 손상된다. typed payload와 원본 index 보존이 필수다.
- **동적 page budget**: 각주·겹침·다단·머리말/꼬리말/존이 가용 영역을 바꾼다. 초기 gate 밖 조건은 전체 fallback이며 이후 확장에는 shadow page allocation/revision 검증이 필요하다.
- **저장/서식 권위**: 원본 lineSeg·para style·직접서식·방향·셀 크기/padding을 plan 결과로 덮어쓰지 않는다. unsupported source는 기존 PageItem/RenderTree/저장값과 같아야 한다.
- **shape certification**: 독립 planner의 bound는 입력 metric에 대한 보증이다. 실제 shaped ink/font fallback/문자 mapping을 별도로 증명해야 한다. 기존 bounded single-run certification을 무조건 다문단으로 확대하지 않는다.
- **자원**: 직전 target는3,188,535,296bytes로3GiB까지32,690,176bytes가 남았다. 이 공간으로 새 rhwp dependency/전체 Native·WASM 링크를 무조건 시작하지 않는다. 생산 코드 구현 전 재사용할 기존 산출물과 정리 가능한 **소유한 재생성 cache**만 조사해 예산을 확보해야 한다. 기존 앱·WASM·QA/원본은 삭제하지 않는다. 새target/다운로드/checkout/패키징 없이 순차 빌드하며 모니터링한다.

합격 검사는 다음을 함께 통과해야 한다. 단순 CJK1/124문단 및 긴/빈 문단, 다양한 page/cell width/height·앞 본문 길이에서 실제 PageItem 할당 수와 각 scalar 정확히1회·누락0·순서·방향·ink bbox·원본 pi/char_start를 대조한다. 원본 모델/직접서식/방향/크기/padding/참조, 편집undo/redo, HWP/HWPX 재열기, 후행 본문 흐름을 확인한다. 가로/번호/병합·중첩/수식·이미지/미검증 shaping 등에서는 저장 모델뿐 아니라 기존 page cut/render tree가 동일한지 비교한다. Native와 fresh WASM의 증거를 분리하고 실제 GUI 검증은 따로 수행한다.

## 이번 보고의 검증·보존

코드 위치와 기본/legacy/resumable 경로를 읽어 확인했다. 독립 계산 모듈은695f01e의 테스트14개/생성1,200회/Native·WASM Clippy 증거를 그대로 유지한다. 새 adapter나 통합 Native/WASM 테스트는 없다. 기존 생산 소스·WASM·앱4개·합성 원본의 SHA256이 직전과 동일함을 읽기 전용으로 대조했다. 이번 생산 build/target 증가/문서수정/패키징/공개/권한변경/GUI 실행은 없다. 작업 세션은 정상 종료했다.
