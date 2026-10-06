# 일반·중첩 표 셀 문단 번호 수정

기준 `9b859745d68030c5a422d1b5cd105ad35a1d3030`, branch `dev/style-propagation`. 개발 후보만 수정했다. 상세 입력·저장물·로그는 `../cell-numbering-qa/`에 보존했고 원본/dev7/기존 앱의 4개 ASAR 해시를 확인했다.

## 재현과 변경

기존 실제 UI/WASM 12경우에서 앞/이전 목록 이어쓰기가 새 번호 정의를 만들고 1로 리셋되었다. 수준 1이 0으로 바뀌고 undo에도 추가 정의가 남았다. 본문·다른 셀과 같은 정의를 공유한 셀은 첫 번호가 2,3이고 이웃은 4,5로 시작했다. 재현 기록은 `../cell-numbering-qa/baseline/proof.json`이다.

각 셀은 별도의 번호 카운터를 갖는다. 같은 번호 정의 ID는 번호 모양을 공유하며 셀 사이 번호 순서를 연결하지 않는다. 본문과 셀 getter는 공통 번호 메타데이터 계산을 사용하되 셀은 자신의 문단만 조회한다. 일반/페이지 분할/내장 표 렌더링은 전체 셀 문단으로 계산한 카운터를 사용한다. 페이지에 보이지 않는 이전 문단도 포함한다.

`captureCellNumbering`은 대화상자를 열 때 정확한 일반·중첩 셀 경로, 셀 전체 문단 속성/텍스트, 문서 세대와 정의를 저장한다. 단일 셀에서는 자기 셀 이전 목록을 선택할 수 있고, 여러 셀은 각자 이전 목록과 수준을 유지한다. 새 시작의 정의 생성과 서식 적용을 한 snapshot으로 묶었다. 해제, 무변경, 실패 rollback과 잘못되거나 오래된 대상 거절도 동일 경로를 사용한다. 기존 정의를 수정하거나 본문/이웃 셀의 문단 ID를 바꾸지 않는다. 머리말/각주 번호 UI는 이번 변경 범위에 포함하지 않았다.

## 검증

- 실제 NumberingDialog body/listeners, format command, InputHandler, CommandHistory와 fresh WASM: 일반 및 2·3단 중첩/병합 셀 78경우. 이어쓰기, 다른 이전 목록 선택, 수준 유지, 새 시작 5, 범위/여러 셀, 해제 포함.
- HWP/HWPX 재열기 156건. Native가 별도로 동일 저장물 156건의 문단/공유 정의/번호 표시와 본문·셀 텍스트, 글자·스타일 참조, 셀 위치·크기·패딩·테두리를 대조했다. Native 잘못된 경로 원자 거절 156건.
- undo 210, redo 204, 거절 258, no-op 18, 중간 실패 rollback 6. snapshot의 HWPX 바이트와 전체 SVG를 비교했고 no-op 뒤 redo 기록도 보존했다.
- 124문단/4페이지 단일 셀의 번호 1~124, undo/redo, HWP/HWPX 재열기를 WASM으로 추가 확인했다. 이 추가 4페이지 사례는 별도 Native 대조 대상에 포함하지 않았다.
- 본문 번호 20경우/재열기44건 및 Native44건 재통과. 기존 스타일 전파48/삭제16/셀 수식72/회전 그룹 해제108/nextStyle Enter162 Native 회귀와 각주 글자·문단·입력 대기/중첩 문단·서식 복사/검색/셀 레이아웃 UI 7종 재통과.
- TypeScript, Vite, Native/WASM Clippy `-D warnings` 통과. 엔진 소스868개가 release 빌드 해시와 일치하고 Vite의 엔진 WASM도 pkg와 일치한다. CanvasKit WASM은 별도 자산이다.

`proof.json`은 간결한 결과/해시, QA 폴더는 상세 증거다. `scripts/check-cell-numbering.mjs ENGINE_DIR OUTPUT_DIR`, `scripts/check-cell-numbering-pages.mjs ENGINE_DIR OUTPUT_DIR`, `cell_numbering_check UI_MANIFEST OUTPUT_DIR`로 재검증한다. Native/Cargo는 기존 toolchain·Cargo home·`../style-lint-qa/target` 재사용, debug0/incrementaloff/jobs2, 3GiB 제한을 적용했다. 모든 빌드 정상 종료했고 제한으로 중단한 작업은 없다.

## 한계와 다음 확인

Electron은 Node 모드로만 사용했다. DOM/cursor geometry/화면 갱신은 테스트 어댑터이며 실제 Mac GUI, 물리 IME, Linux 실행 성공으로 주장하지 않는다. 세로쓰기 셀은 검증하지 않았다. 새 앱 패키징, 공개 push/release, 권한·보안·인증서 변경은 하지 않았다. 전체 library suite는 원본 fixture3개 부족으로 여전히 막혀 있다(확인11/복원0); 대체나 skip으로 통과시키지 않았다.

다음 Mac GUI 확인은 F5 일반/중첩 셀에서 앞/이전/새 시작/해제와 다중 셀 선택, 다단계 번호, 4페이지 셀, undo/redo 후 HWP/HWPX 저장·재열기다. 기존 dev7은 이번 수정이 들어간 새 앱이 아니므로 GUI 확인에는 별도 개발 후보를 사용해야 한다.
