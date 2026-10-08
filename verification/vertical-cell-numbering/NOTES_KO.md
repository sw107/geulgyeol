# 세로쓰기 표 셀 검증과 HWPX 방향 보존 수정

기준 `1ce7d49c6a490a5ad4cba6de41ec827254797db5`, checkout `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, branch `dev/style-propagation`. 상세 로그/입력/저장물은 `../vertical-cell-numbering-qa/`에 별도로 보존했다.

## 실제 결함과 최소 수정

일반 및 2·3단 중첩 합성 셀에서 영문 세움 세로쓰기(code2)를 HWPX로 재열면 가로쓰기(code0)가 됐다. HWP는2를 보존한다. 이전 `9b85974` 엔진과 기준1ce 엔진에서도 같은 저장 결함을 재현했고, VERTICALALL이 들어 있는 새 HWPX를 이전9b로 읽어도 6문서 모두0이 됐다. 이번 셀 번호 변경에서 새로 생긴 회귀는 아니다.

`serializer/hwpx/table.rs`에서2를 `VERTICALALL`로 방출하고, 셀 `subList` 및 기존 호환 `tcPr`/`cellPr` 파서가 이를2로 읽도록 수정했다. 0/HORIZONTAL과1/VERTICAL은 보존한다. 모델 주석에0/1/2를 명시했다. 번호 엔진/API/UI의 동작을 추가로 확장하지 않았다.

## 자동 검증 결과

- 방향0/1/2 × 일반·2·3단 중첩 × 병합 여부:18경우, HWP/HWPX 재열기36건. 실제 SVG의 영문A 회전과 셀 자체 속성 보존 확인.
- 실제 NumberingDialog body/listeners, format command, InputHandler, CommandHistory와 fresh WASM: 세로 방향1/2에서156경우. 이어쓰기/이전 목록 선택/새 시작5/다단계 수준/범위/여러 셀/해제, undo420/redo408, 거절516, no-op36, 실패 rollback12.
- 위 저장물312건을 Native에서 별도 대조했다. 정확한 셀 경로의 렌더 트리로 영문 회전(90/0)을 검사했다. 본문 번호 표시/카운터, 본문·이웃 셀의 속성, 텍스트·글자·스타일 참조, 셀 크기·방향·테두리·패딩·공유 정의를 보존했다. 잘못된 경로 원자 거절312건.
- 긴 세로 셀124문단: 단독1페이지 및 긴 가로 이웃 셀 때문에 표가4페이지로 나뉘는 두 경우, 방향1/2, 이어쓰기/새 시작/해제12경우. undo/redo12회씩, 두 형식 재열기24건 및 Native24건. 문서 데이터와 현재 출력의 상태 보존을 확인했으며 페이지 렌더링 정상 지원으로 판정하지 않았다.
- 일반 가로 셀78/본문 번호20 UI 회귀 및 Native 저장물156/44건 재통과. 기존 각주 글자·문단·입력 대기, 중첩 문단·서식 복사, 검색, 셀 레이아웃 UI7종 통과. 스타일 전파48/삭제16/셀 수식72/회전 그룹 해제108/nextStyle Enter162 Native 회귀 통과.
- TypeScript/Vite, Native/WASM Clippy `-D warnings` 통과. 소스868개 release 해시 및 Vite 엔진 WASM 일치. target/도구체인/Cargo home 재사용, debug0/incrementaloff/jobs2와3GiB 제한 유지. 원본 fixture11개 확인/복원0,3개 부족. 전체 library 검사는 대체/skip/복원으로 통과시키지 않았다.

최종 WASM `015e64b941e60f85fb10a86810aaef0909cd4a0f8de3992246b49c13d2a262c7`. 재검증: `scripts/check-cell-direction-roundtrip.mjs ENGINE_DIR OUTPUT_DIR`, `scripts/check-vertical-cell-numbering.mjs ENGINE_DIR OUTPUT_DIR`, `scripts/check-vertical-cell-numbering-pages.mjs ENGINE_DIR OUTPUT_DIR`, `cell_numbering_check UI_MANIFEST OUTPUT_DIR`. `proof.json`은 간결한 증거이며 QA 폴더에 상세 출력이 있다.

## 기존 미지원과 다음 실제 누락

세로쓰기 문단 번호는 메타데이터가 저장되어도 번호 글리프가 표시되지 않는다. 검사 결과의 `visibleVerticalNumberingSupported:false` 및 Native `displayLabels:false`를 유지했다. 번호 데이터를 바꾸고 undo/redo해도 문서와 기존 출력이 복원된다는 결과이지, 세로 번호를 정상 표시한다는 결과가 아니다.

긴 단독 세로 셀은1페이지에 남고 페이지 왼쪽 밖의 글자가 생긴다(방향1 사례:음수x 글리프872개). 표가4페이지로 나뉘면124문단 각각이3번 방출된다(방향1:음수x3146개). 이전9b 엔진의 방향1 여섯 경우와 현재 엔진의 페이지 수/반복 수/넘침 수가 정확히 같았다. 화면에서 실제 보이는 글자 수와 SVG에 방출된 글자 수는 다르므로 출력 텍스트 존재를 가시성 성공으로 판단하지 않았다. 방향2는 이전 엔진의 HWPX 방향 손실 때문에 같은 저장 비교를 적용하지 않았다.

다음 실제 기능 누락 하나는 **긴 세로쓰기 셀의 페이지 조각 레이아웃**이다. 전체 셀을 매 조각마다 재출력하는 경로를 고쳐 문단을 한 번씩 배치하고 페이지 밖으로 넘치지 않게 하는 작업을 권한다. 세로 번호 표시도 여전히 미지원이지만 이번 작업에서 새 기능으로 확장하지 않았다.

GUI 도구 메타데이터를 한 번 확인했으며 실제 Mac GUI 조작 기능이 없었다. Electron은 Node 모드로만 사용했고 우회 GUI/물리 IME/Linux 실행 검증을 시도하지 않았다. 일반·중첩 표의 합성 텍스트 경로만 검사했으며 모든 글상자/세로쓰기 개체를 지원한다고 주장하지 않는다. 기존 앱4개 ASAR 해시는 보존했고 새 앱 패키징·push·release·권한/보안/인증서 변경이 없다. 도구 세션은 정상 종료한다.
