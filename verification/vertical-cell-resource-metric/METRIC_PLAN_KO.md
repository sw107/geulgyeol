# 다문단 세로 shaping metric: 기존 WASM 조사와 최소 검증 계획

이번에는 새 adapter/빌드 없이 기존 `pkg/rhwp_bg.wasm`과 저장소 font를 사용했다. 엔진 SHA256은 `015e64b941e60f85fb10a86810aaef0909cd4a0f8de3992246b49c13d2a262c7`, NotoSansKR-Regular.ttf는2,519,996bytes/SHA256 `6e06a7fe5d696ca719894a23f36bb2b1be8c816a5937cd4ad0f23ca67780dd74`이다. 원본 문서가 아닌 새1×1 합성 셀만 만들었다. 기본 CharPr의 borderFillIDRef2가 gate를 막으므로 양성 대조용 합성 HWPX 사본에서 이 속성만0으로 만든 뒤 HWP로 저장했다. 생산 문서나 파서/gate를 바꾼 것이 아니다.

기존 공개 API `registerExactFontSource`로 실험 문서의 정확한 slot에 위 바이트를 등록하고 `getPageLayerTreeWithProfile(...,'screen',true,true)`의 glyph publication을 읽었다. font payload는 생략하고 metadata/key만 관측했다. 저장된 family alias는 별개이며 **실제 앱의 자동 폰트 선택이 검증됐다는 뜻은 아니다.** registry/cache 파생 상태만 임시 문서에 변하며 등록·렌더 읽기 전후 HWPX 모델 바이트가 동일했다.

## 조사 결과: 양성2·gate 음성10

| 새 합성자료 | scalar 수 | certified verticalGlyphRun leaf |
|---|---:|---:|
| HWP 방향2·한 문단 ‘가나다’ | 3 | 3 |
| HWP 방향2·한 문단 ‘라마바’ | 3 | 3 |
| 두 문단 ‘가나다’/‘라마바’ | 6 | 0 |
| 세 문단·빈 문단 포함 | 4 | 0 |
| 한 문단120문자·여러 열 필요 | 120 | 0 |
| 방향1 | 3 | 0 |
| 한글+Latin | 3 | 0 |
| 결합악센트+ZWJ/emoji | 8 | 0 |
| bold | 3 | 0 |
| HWPX 양성 대조와 동일 source | 3 | 0 |
| exact font 등록 없음 | 3 | 0 |
| 원래 default CharPr borderFillIDRef2 | 3 | 0 |

양성6개 leaf는 glyph ID>0, 원본 UTF8/UTF16 cluster span, `vertical-rl/vertical-upright`, 실제 ink bbox/positions, `boundedVerticalHwp5TableCellV1` reason과 exact/portable 진단을 가진다. leaf bbox는 실제 셀bbox 안에 있다. 예: ‘가’ ink bbox11.12×12.053px는 fontsize13.333px 정사각형과 다르다. 음성의0은 **certified 경로를 사용하지 않는다**는 뜻이며 문자가 없거나 정상 페이지 분할됐다는 뜻이 아니다. legacy TextRun/clip 결과를 shaping 보증으로 대체하지 않았다.

12자료 모두 생성 텍스트/scalar가 HWP/HWPX 입력에서 보존됐고 registry 등록·API 읽기 전후 모델 HWPX bytes도 동일하다. 이 조사에는 새 pagination·undo 기능 검증, 실물 GUI/Native 실행/Linux가 없다. native 검증은 새 metric harness가 준비되는 다음 단계의 조건이다. 직전 독립 모듈의 Native/WASM 통과를 이 새로운 통합의 통과로 사용하지 않는다.

## 새로 확인한 metric 구분

공개 leaf의 `advances`는 **다음 glyph origin까지의 차이**이며 마지막 leaf에서는 `next_inline_origin - glyph.origin`이다(`renderer/shaping_vertical.rs:923~929`). raw shaped glyph의 advance를 그대로 복사한 필드가 아니다. ‘가나다’의 첫 두 leaf는 `(dx0,dy13.333333)`이지만 마지막은 `(dx6.133333,dy1.6)`이다. 이를 scalar별 세로 피치로 더하거나 `dx=0`이어야 한다고 판단하면 잘못된다.

읽기 전용 SFNT 테이블 조사에서 위 여섯 glyph의 vmtx nominal vertical advance는 모두1000font units, unitsPerEm1000이라13.333333px이다. 이는 마지막 공개 delta와 다르다. vmtx는 nominal font metric이며 GSUB/GPOS·cluster/offset을 포함한 **전체 shaped advance certificate**는 아니다. 마지막 delta가 다르다는 사실 자체를 엔진 결함으로 분류하지 않았다.

다문단에 필요한 값은 같은 font/source/shape request로 계산한 **raw shaped advance + glyph origin/ink bearing + run inline_advance_px + cluster partition**의 일관성이다. 현재 공개 API는 gated 단일 열의 publication을 보여주지만, unpublished 다문단 transaction/raw advance/run geometry를 직접 조회하는 API는 없다. 내부 생산 함수 `prepare_dormant`/`finish_dormant_vertical_shaping_transaction`를 임의로 공개하거나 gate를 넓히지 않았다.

## 다음 최소 검증 계획 — 아직 구현하지 않음

1. 처음은 exact 위 font/face0, 순수 CJK, HWP5 방향2, 단일1×1 regular/fill-only·정상 정렬로 한정한다. 번호/불릿/control/range tag·병합/중첩·이미지/수식·미검증 폰트/방향1/Latin/emoji는 셀 전체 기존 경로다. 같은 source/font/revision의 불변 metric 데이터와 원본 para/scalar index를 먼저 만든다. default CharPr border0과 실제 host font-slot 선택도 명시하여 실험용 폰트 주입을 제품 자동선택과 혼동하지 않는다.
2. 각 문단의 생산 shaping request와 동일한 font size/script/language/features/variations/direction로 문자를 shape하는 **독립 metric oracle**를 만든다. 기존 offline rustybuzz/ttf-parser를 이용하는 작은 검증 harness가 한 선택지다. 이는 adapter 구현이나 공용RowCut 변경과 분리하며 추가 빌드는 다음 허가된 단계에서만 한다. raw y_advance/x_advance·offset/ink bbox, source UTF8→scalar cluster 범위, run inline advance를 얻고 현재 단일 문단 positive API 출력/nominal vmtx와 비교한다. publication의 next-origin delta를 raw metric으로 쓰지 않는다.
3. 두/세 문단, 빈 문단,124개 서로 다른 순수 CJK 문단, 긴 한 문단, font size 차이와 style 참조 차이를 검사한다. 문단별 shape와 동일 source의 재요청이 metric/cluster를 보존하는지, 마지막 glyph 종료 advance와 다음 문단의 새 열 원점이 독립적인지 확인한다. 문단을 합쳐 reshape하여 문단 경계·원본 index를 잃지 않는다. 부정 source는 정상 거절되고 기존 출력/저장값이 같은지 확인한다.
4. 독립 planner에는 실제 post-rotation advance와 **ink offset/bearing을 반영해 보증한 예약 상자**를 공급한다. adapter metadata에 실제 glyph origin/bbox transform을 남긴다. 예약 상자에 ink를 넣을 수 없으면 fontSize 정사각형으로 위장하거나 style 피치를 늘려 통과시키지 말고 fallback한다. 폭/높이40·80·400px, 폭 변화·첫 frame 잔여높이·continuation 높이 변화에서 각 scalar1회/순서/cluster 불가분/실제 ink bounds를 독립 확인한다. 여기까지도 실제 page allocation 완료는 아니다.
5. 위 metric 계약을 통과한 뒤에만4c587f8의 typed payload/shadow page allocation 설계를 검토한다. 실제 측정·allocator·renderer의 source와 footprint를 공유하고 동적 frame budget으로 조각 수를 구한다. 그때 Native/fresh WASM, source 속성/원본 참조, undo/redo·HWP/HWPX 재열기, 가로 및 모든 unsupported fallback 불변을 검증한다. 실제 Mac GUI는 별도 단계다.

원시12자료, layer JSON, font table metric과 matrix proof는 `../vertical-cell-resource-metric-qa/`에 있다. 이 폴더의 `proof.json`은 요약 증거다. 생산 source와 RowCut 계약, 독립 planner 코드, 기존 앱/WASM/원본 문서는 모두 그대로다.
