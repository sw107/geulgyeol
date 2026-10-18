# 표시 실패 조사 — 병합 보류

앱 QA가 `570a374`에서 31회 관찰 중 23회 불일치와 CanvasView 오류 12건을
보고했다. 호스트 저장 후 Native 재읽기 20개는 소유권과 본문을 보존했다.
따라서 저장 보존 통과를 표시 성공으로 볼 수 없다. P2 수정본의 실제 앱
검증과 UI 담당의 main 앱 비교는 아직 대기이며 이 PR은 병합 보류다.

## 실제 SDK 비교

같은 원본 5종을 기준 main SDK, 기존 PR81 SDK, P2 SDK의 독립 Node 프로세스에서
읽고 `getPageInfo`, `getPageRenderTree`, 실제 SVG를 기록했다. P2는 정상 입력
5종의 페이지 정보·트리·SVG를 기존 PR81과 동일하게 유지한다.

| BODY_1 | main | PR81 및 P2 | 기대값 |
|---|---|---|---|
| explicit-distinct | 폭 560, MASTER_0 | 폭 793.7, MASTER_0 | 폭 560, MASTER_1 |
| same-geometry | 폭 793.7, MASTER_0 | 동일 | 폭 793.7, MASTER_1 |
| empty-first | 폭 560, MASTER_1 | 폭 793.7, 바탕쪽 없음 | 폭 560, MASTER_1 |
| shared-part | 폭 560, MASTER_0 | 폭 793.7, MASTER_0 | 폭 560, MASTER_0 |
| 물리 구역 HWP 대조군 | 폭 560, MASTER_1 | 동일 | 폭 560, MASTER_1 |

main은 마지막 구역 폭을 첫 페이지에도 적용하고, empty-first의 첫 페이지에도
MASTER_1을 그린다. PR81의 첫 소유자 미러 수정은 그 첫 페이지 오류를 고치지만,
후속 페이지에서는 표에 기록한 폭·빈 바탕쪽 표시 회귀를 만든다. 바탕쪽 첫 항목
반복은 main에도 있다. 따라서 전체를 기존 결함으로 분류할 수 없다.

사용한 WASM SHA-256:

- main: `0451d0994b759aff9c6ce19a6915ac729dcd0c05f8d6c61195b1e67743a73de6`
- PR81: `835556446e08a7d618ee006359cb99dae936c8d7ccb361dedde0bcd6ef81be95`
- P2: `35f3aac48519d119cdfda60c244e1354f557becfdbabab5078d30e14c7105d2d`

## 구역 렌더링 계약의 간극

해당 렌더러 소스는 main과 PR81/P2 사이에서 바뀌지 않았다.

- `document_core/queries/rendering.rs`의 `repaginate`는 물리 구역의
  `section.section_def.page_def`로 측정 폭과 페이지네이션을 구성한다.
- 같은 파일의 `apply_page_number_layouts_for_section`도 모든 페이지에 그
  루트 PageDef를 다시 적용한다.
- `assign_master_pages_for_section`은 루트 `master_pages`만 선택한다.
- `get_page_info_native`는 페이지의 물리 `section_index`로 루트 PageDef를
  조회하고, 활성 바탕쪽 조회도 같은 물리 구역의 루트 배열을 읽는다.
- `renderer/pagination.rs::MasterPageRef`에는 물리 구역과 바탕쪽 배열 인덱스만
  있고, 후속 문단의 `Control::SectionDef` 소유자를 표현할 키가 없다.

후속 논리 구역의 정의를 저장해도 현재 페이지 소비 경로가 그 정의를 사용하지
못한다. 수정하려면 문단 경계에서 활성 논리 소유자를 정하고 측정·줄바꿈·페이지
레이아웃·바탕쪽 참조·페이지 정보·그리기·히트테스트가 같은 정의를 사용해야 한다.
편집 API의 물리 section/paragraph 인덱스와 스냅샷 좌표를 보존해야 하므로,
저장 모델을 임의로 분할하거나 CSS 폭 또는 바탕쪽 페인트만 바꾸는 수정은 충분하지 않다.

이번 P2 커밋은 단일 소유자 거절 경계만 고친다. 표시 수정은 포함하지 않는다.
CanvasView 오류 12건은 이 SDK 조사로 원인을 확정하지 않았으며, 앱 문서 전환과
페이지 조회의 실행 근거를 별도로 확인해야 한다. 오류를 숨기거나 성공으로 처리하지 않았다.
