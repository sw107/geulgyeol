# 문단 띠 의미·저장 표현과 구현 범위 판정

공식 Mac/공통 도움말은 문단 띠를 문단 좌우 여백 사이에 한 번에 넣는 장식용 구분선으로 설명한다. 기본은 두께1mm, 문단 너비100%, 문단 기준 위치, 검정 면 색, 선 없음인 **사각형 개체**이며 삽입 후 개체 속성으로 고친다. 문단 테두리/배경과 기능·소유권이 다르다. [한컴 Mac 문단 띠](https://help.hancom.com/hoffice_mac/ko_kr/hwp/insert/line.htm), [공통 문단 띠](https://help.hancom.com/hoffice/multi/ko_kr/hwp/insert/line.htm), [별도 문단 테두리 기능](https://help.hancom.com/hoffice/multi/ko_kr/hwp/format/paragraph/paragraph(border).htm).

따라서 이전 제안의 문단 테두리/배경 대안은 문단 띠 구현으로 채택하지 않는다. 이번 판정은 **제품 구현 없이 설계·진단 재현까지만**이다. 기존 문단 모양 API만으로 구현할 수 있다는 조건이 성립하지 않는다. 의미는 확인됐고 새 광범위 개체 모델이 필수라고 판단하지도 않는다. 기존 사각형을 이용하는 별도 개체 API/조판/참조 작업이 필요하며 이를 이번 문단 모양 연결로 확대하지 않았다.

## 현재 소스 대조

| 층 | 확인한 표현/동작 | 부족한 계약 |
|---|---|---|
| 문단 모양 | `ParaShape.border_fill_id` + `BorderFill`, `apply_para_format_native`, UI 문단 모양 대화상자 | 문단 테두리를 바꾸며 개별 사각형/개체 ID를 만들지 않는다. 문단 띠 삽입·개체 선택/삭제 계약을 표현하지 못함 |
| 개체 모델 | `ShapeObject::Rectangle`, `CommonObjAttr.width_criterion=SizeCriterion::Para`, 위치 Para·색/선/크기 | 모델 신설은 불필요할 가능성이 높다. 문단 띠의 실제 한컴 파일 속성/앵커 corpus는 아직 없음 |
| HWP/HWPX | 공통 attr 의미 비트와 `hp:sz@widthRelTo`로 Para 너비 기준 보존 | 합성 모델의 두 형식 보존6회 확인은 실제 한컴 문단 띠 호환 인증이 아님 |
| 공개 개체 API | `createShapeControl`, `getShapeProperties`, `setShapeProperties`, `deleteShapeControl` 존재 | 생성은 절대 크기/Paper 위치/흰 채우기/실선 기본. getter/setter가 너비 기준을 노출/변경하지 않음. 제안 필드 `widthRelTo`/`widthCriterion`은 무시됨 |
| 조판 | `resolve_object_size`가 Para와 Column 모두 단 전체 폭으로 계산 | 문단 좌우 여백을 뺀 실제 문단 폭과 차이. 위치용 shape_container는 여백을 빼지만 크기는 이미 단 전체 폭으로 계산됨 |
| UI | `insert:para-band` 등록 stub `canExecute:false`; 개체 그리기는 별도 `insert:shape` | 문단 띠 고정 기본값/삽입·속성·삭제/참조/이력을 연결한 명령 없음 |

소스 근거: `engine/src/model/shape.rs` CommonObjAttr/SizeCriterion/RectangleShape; `engine/src/document_core/commands/formatting.rs` apply_para_format_body_impl; `engine/src/document_core/commands/object_ops/{common,shape}.rs`; `engine/src/serializer/{control.rs,hwpx/shape.rs}`; `engine/src/renderer/layout/{picture_footnote,shape_layout}.rs`; `rhwp-studio/src/{command/commands/insert,ui/para-shape-dialog}.ts`.

## 재현과 후속 계약

진단에서 문단 아래 테두리를 적용해도 기존 필드/본문/스타일·이웃 문단은 그대로이며 개체가 생기지 않는다. 사각형 API의 제안 너비 기준 변경은 절대값으로 남는다. 직접 IR에서 Para100%로 지정한 합성 사각형은 두 형식에서 저장되지만 문단 여백 변경 전후 너비가566.933px로 같다. x는118.253→126.720px로 움직인다. 새 여백13.3px/20.0px을 적용했으므로 문단에 맞는 폭은 단 폭보다 약33.3px 좁아야 한다. Native 렌더 트리와 실제 WASM의 HWP/HWPX 재열기/SVG가 같은 누락을 확인한다. 직접 IR 지정은 공개 기능 구현이 아니다.

후속 표현은 **기존 RectangleShape의 문단 상대 너비**, 독립 개체 ID·앵커·채우기/선이다. 일반 본문 한 문단/가로 단일 단부터 시작한다. 실제 한컴 생성 HWP/HWPX에서 기본 직렬화값·100% 정수 단위·offset·textWrap·앵커 위치·최소 높이와 margin 변경 동작을 확인한 뒤 공개 생성/조회/속성/삭제 API 계약을 고정한다. 합성 진단의283HWPUNIT≈1mm와 너비10000은 현재 모델/조판 단위에서의 후보값이며 실제 한컴 파일의 정답값이라고 주장하지 않는다. 크기 계산은 우선 지원 사각형/문단 기준에 한정하고 일반 그림·표·기존 Column 기준 동작을 섞지 않는다.

새 명령은 편집 전 문단·스타일·모든 저장 참조와 개체 소유/ID를 검증하고 정확한 snapshot undo/redo로 실행한다. 기존 일반 개체 삽입/삭제의 필드 range·char_shape 위치·control 저장 슬롯 보존은 주석이 있는 문단에서 별도 확인해야 한다. 불명 refs·복합 필드·다문단/셀/머리말/각주·회전/세로/여러 단·지원 밖 객체는 무변경 거절한다. 인접 문단의 주석/필드·다른 스타일/직접 서식을 보존한다. 지원 문단 안의 주석/필드와 안전한 공존을 검증할 때까지 활성화 범위를 넓히지 않는다.

완료 기준은 실제 Native/WASM/UI 삽입·속성 편집·삭제와 취소/거절, undo/redo, HWP/HWPX 재열기/참조 ID, 여백/쪽·단 폭 변경 및 다줄 문단의 render tree/SVG 폭·높이/위치 대조다. 한컴 실제 문서와 GUI 선택/개체 속성/삭제 확인은 자동 검사와 구분한다. 이번에는 메뉴를 활성화하거나 문단 테두리를 문단 띠로 이름 붙이지 않았다.
