# 셀 치환 후 redo 레이아웃 일치

`c0c7928`의 셀 redo SVG 차이를 같은 검색-span 수정 전 기준선에서도 재현했다. 기준선 WASM 두 개는 ASCII 셀 검사에서 동일한 UI 실패 6건과 렌더 추적 72건을 보였다. 엄격 검사 모두 exit 1, 네이티브 엄격 비교는 exit 101이었다. Unicode span 수정이 새로 만든 결함은 아니다.

실제 행 높이 차이는 긴 치환에서 27.76→91.76px였고, 48행 표는 redo 때 2→6페이지 또는 7→2페이지로 달라졌다. 이는 작은 부동소수점·메타데이터 차이가 아니다. 다만 기준선의 저장 문서 82개에서도 텍스트·문자 모양·문단 스타일·표 실제 크기/속성은 보존됐다. 문서 손실로 해석하지 않는다.

## 원인과 수정

검색 `replace_all_native`/`replace_nth_native`는 셀 문단을 직접 편집하면서 소유 표의 dirty 플래그를 갱신하지 않았다. `recompose_section`만으로는 `HeightMeasurer`의 MeasuredTable 캐시를 무효화하지 못했다. 명시적으로 페이지 계산을 완료해도 이전 행 높이를 복사했고, snapshot restore가 전체 캐시를 비우면 다른 높이가 나왔다. 일반 셀 편집은 기존 `mark_cell_control_dirty`를 호출해 정상적이었다.

`FindDialog`의 단일 셀 치환은 deferred API 결과를 SnapshotCommand에 전달하지만 InputHandler의 deferredPending 효과는 발행하지 않았다. 따라서 일반 afterEdit 경로가 계산을 완료하지 못했다. 전체 치환도 결과를 얻은 직후 완료 경계가 필요했다.

제품 수정은 두 파일이다.

- `engine/src/document_core/queries/search_query.rs`: 변경된 셀의 최상위 소유 컨트롤을 중복 제거하고 기존 재귀 dirty helper를 호출한다. 중첩 표에도 기존 helper 규칙을 적용한다.
- `rhwp-studio/src/ui/find-dialog.ts`: 단일 deferred 셀 치환과 전체 치환을 기존 `runInBatch`로 감싼다. `finally/endBatch`가 페이지 계산을 한 번 완료한 뒤 커서·렌더·이력 저장 경로가 실행된다. InputHandler 없는 fallback 경로도 같은 경계를 쓴다.

모든 편집에 전역 캐시 재생성을 추가하지 않았다. 엔진 벌크 API는 기존처럼 문서 계산 dirty를 남길 수 있으며 직접 소비자는 `repaginate_if_needed`로 완료해야 한다. 네이티브/Bridge 회귀 검사도 이 계약에 맞춰 수정했다. 원문, 직접 지정 서식, 다른 스타일, nextStyleId, 수식 참조를 다시 쓰는 변경은 없다.

## 검증

| 검사 | 결과 |
| --- | --- |
| 네이티브 bulk/nth/deferred/일반 셀 분리 | 4경로, redo 12회: 문서 모델·완료 후 SVG 일치 |
| 실제 WASM/API + FindDialog/Bridge/SnapshotCommand | 24건, undo/redo 170회, 비지원 deferred 4건 무변경 거절 |
| 위 셀 검사 HWP/HWPX 재열기 | 82건: 전체 페이지 SVG hash·셀 clip 직사각형·페이지 수 정확 일치 |
| 네이티브 저장 문서 속성 검사 | 82건: 실제 표 크기/여백/셀 속성·문자 모양 정의·스타일 참조·이웃 직접 서식 보존 |
| 기존 WASM 검색-span 행렬 | 408건(UI 272), undo/redo 640회, 무일치 120건, 두 형식 재열기 2,096건; 이력 SVG 차이 70→0건 |
| 위 WASM 저장 문서 네이티브 재검사 | 2,096건 통과 |
| 기존 네이티브 검색 | 170건, undo/redo 340회, 재열기 340건; SVG 차이 24→0건 |
| 수식 경계 | 12건, undo/redo 24회, 재열기 24건, 비지원/빈 입력 무변경 4건 |
| 고정 Unicode 검색 재현 | 12건 모두 통과(기존 9개 결함 사례 포함) |
| 기존 desktop 회귀 | pass 30, fail 0, skip 1, 기존 TODO 1; 스타일 범위 16건/두 형식 재열기 32건/복원 32회 포함 |
| next-style UI | 현재 TS 코드 11건, DOM mock |
| TypeScript / Vite / native·WASM Clippy | 모두 exit 0, Clippy `-D warnings` |

`getTableProperties`의 width/height/outer margin getter는 raw_ctrl_data를 읽는다. HWPX의 raw 데이터가 없을 때 0을 반환하고 HWP 재열기에서는 실제 값을 반환하므로, 이 여섯 raw getter 필드만 JS 비교에서 제외했다. 네이티브 검사는 실제 typed Table common width/height/margin을 포함해 모두 비교하므로 실제 크기 변경을 숨기지 않는다. 모델 비교에서 제외한 값도 overflow memo와 Table.dirty 두 캐시 항목뿐이다.

새 WASM SHA256: `2f63c208dca6ac986a75ceb351cbfc3fbe292311d7a8c2244f6b9506d94f1947`. 컴파일 당시 엔진 소스 hash와 최종 소스가 일치하며 Vite 결과에 같은 WASM이 들어 있다. 오프라인 Rust 1.93.1 aarch64 Mac release/LTO 빌드, 기존 target 재사용, jobs 2, debug 0, incremental off. 작업 중 target 최고 2,623,217,664 bytes로 3GiB 제한 이내였다.

증거는 인접 QA 루트 `../cell-redo-layout-qa`(checkout 기준)에 보존했다. 저장소 `proof.json`에는 주요 결과와 증거 SHA256을 기록했다. 현재 코드로 반복하려면 이 checkout에서 다음을 실행한다. 캐시된 Node 24는 `ELECTRON_RUN_AS_NODE=1 ../app-integration-qa/GeulgyeolDevEnter.app/Contents/MacOS/GeulgyeolDevEnter`로 실행할 수 있다.

```sh
node scripts/check-cell-layout-history.mjs pkg /tmp/geulgyeol-cell-layout-recheck
node scripts/check-search-span-wasm.mjs pkg ../cell-redo-layout-qa/behavior/fixed-search-span /tmp/geulgyeol-search-recheck --all --strict-ui-layout
node scripts/repro-search-casefold-span.mjs pkg /tmp/geulgyeol-frozen-recheck --verify
```

네이티브 Cargo examples: `cell_layout_commit_probe INPUT --strict OUT`, `cell_layout_saved_check EXPORT_MANIFEST OUT`, `search_span_check OUT`, `search_span_boundaries_check OUT`. 위 예제와 library는 strict Clippy 대상으로 포함했다. 전체 `cargo test --lib`는 기존 fixture 10개 누락의 include_bytes! 오류 28개로 실행 불가 상태다. 경로와 코드 출처는 `MISSING_LIBRARY_FIXTURES_KO.md`/JSON에 기록했다. 개인 문서로 대체하거나 업로드하지 않았다.

## 범위와 다음 확인

새 app/ZIP 패키징, 공개 push/release, 원격 권한·계정·인증서 변경은 하지 않았다. 이전 앱의 app.asar SHA는 유지됐다. 원본 문서와 이전 체크포인트를 변경하지 않았다. headless Electron은 Node 실행용이며 GUI 검증이 아니다. 실제 Mac GUI·한국어 IME·한컴 비교·Linux는 이번에 실행하지 않았다. 검증 창은 생성하지 않았다. 성능 측정도 다시 하지 않았으므로 기존 같은 조건 약 35% 결과를 이번 수정의 효과로 재해석하지 않는다.

다음 수동 확인은 Mac 개발 후보에서 좁은 셀 치환/전체 치환 후 표시·커서·5회 undo/redo·저장재열기와 한국어 IME다. 누락 fixture의 검증 가능한 원출처가 확보되면 library 단위 검사를 복구할 수 있다.
