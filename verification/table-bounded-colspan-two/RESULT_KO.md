# 제한된 colSpan=2 rectangular owner 검증

3열 표에서 본문 전체를 덮는 가로 2열·세로 여러 행 병합 셀 하나를 mixed-owner cut 경로에 추가했다. 저장 셀 폭은 그 셀이 덮는 paint 열 폭의 합과 정확히 같아야 하며, 원시 cell 배열의 모든 격자 칸을 정확히 한 셀만 덮는 것을 먼저 검사한다. 기존 2열·3열 colSpan=1 계약과 whole-span 경로는 유지한다.

시작점은 PR14 exact HEAD `e1c59bb87d29f4251f5a48943527456e710f5b28`, 병합 main은 `c3fc2bcd11a2483901c4a679e0a61c7330936a84`다. 이번 검증 소스 커밋은 `e892846b89eea35a919544fceb99799e841a5782`다. 새 WASM SHA256 `4128c152b6503430e845f4045b0b9a3b03860ab8da5ebbaf89c914d9067e96e1`, 통합 Native 검사기 SHA256 `3038f829a0083610937b6982a2be10a91a6bc3d3f580301e7ea377220832e4d9`을 사용했다. 최종 raw evidence는 `../table-colspan-two-painted-host-qa`에, 수정 전 성공·실패 및 공간 전환 증거는 `../table-colspan-two-owner-qa`에 보존한다.

## 지원 범위와 선행 조건

공유 `mixed_plain_owner_block` 판정과 제한 계약의 커서 후보 페이지 선택을 수정했다. scan/typeset, partial paint, merged-cell source snapshot이 같은 판정을 쓴다. 새 범위는 3열, 반복되는 첫 머리행 1개(3개의 colSpan=1 셀), 4..64개 본문 행, 본문 처음부터 끝까지 덮는 colSpan=2 rectangle 정확히 하나다. rectangle은 좌/우 두 열을 덮을 수 있고 나머지 열은 독립 행 또는 부분 rowspan owner를 가질 수 있다.

열별 동일한 양수 signed 범위의 저장 단일셀 폭에서 세 track을 얻고, 합이 표 폭과 정확히 같아야 한다. 모든 셀의 저장 폭은 덮는 track 합과 같아야 한다. gap/overlap·행/열 범위 초과는 parser의 last-writer lookup grid가 아닌 raw cell 배열에서 제외한다. plain paragraph, controls/raw break 부재, 기본 text direction/wrap, RowBreak, non-TAC/non-overlap, TopAndBottom, Page/Top/offset=0, spacing=0, caption·local resize 부재를 유지한다. 여러 rectangle, 부분 높이 rectangle, 복잡한/누락/중복 머리행, 미세 폭합 불일치는 신규 경로에 진입하지 않는다. 이 제외는 해당 문서의 모든 기존 fallback 편집 성공을 주장하는 검사가 아니다.

## 실제 결과

| 검증 | 결과 |
|---|---:|
| Mac Electron 44.3.0 완료 사례 | 244 |
| undo/redo 쌍 | 448 |
| 양형식 저장·재열기 / Native 대조 | 484 / 484 |
| Node=0·앱=0 정상 종료 단위 | 17 |
| 실제 paint / 쪽 합계 | 780 / 9322 |
| 최대 border / ink overflow | 0.0933333333337032 / -0.7866058603922284 px |
| hidden / partial text / Native overflow warning | 0 / 0 / 0 |
| 기준·새 엔진 scope query | 각각 68 (positive 10 + excluded 58) |
| 기존 3열 colSpan=1 scope 회귀 | 52 |
| 3·4·64·65 본문행 입력 / eligibility 재열기 | 8 / 16 |
| 본문 문단 시작·중간·끝 커서 / 양형식 재열기 포함 문서 | 12,690 / 30 |
| 새 엔진 desktop suite | 49 pass / 0 fail / 기존 private fixture 1 skip |

좌/우 rectangle, staggered sidebar, 4000/7000/10000 HWPUNIT의 좌/우 불균등 폭 5그룹을 양형식으로 검사했다. 각 긴 owner의 첫·중간·끝 입력·말미 입력, Shift+Enter·Delete, undo/redo 두 쌍을 실행했다. 표 조각 첫·중간·끝의 입력, 후행본문/찾기/바꾸기/취소, 4/64행 경계, 기존 2열과 3열 입력 회귀도 포함한다. 반복 머리행과 후행본문, 원래 스타일·문자 ID·본문 properties·topology를 보존하고 저장·재열기의 full SVG가 화면과 같음을 확인했다. 과거에 고친 redo 결함을 새 결함으로 보고하지 않는다.

독립 Native source 10문서와 완료 경계 18문서, 4행 통짜 표 회귀 2문서에서 원문 순서·owner 범위·stable cut 연속성과 단조성·예산·세 머리행·빈 terminal fragment 부재·후행본문 위치를 확인했다. 반올림 paint 폭 2118회와 full-precision SVG clip 폭 1524회를 track 합과 대조했고 최대 clip 오차는 2.842170943040401e-14px다.

완료 fixture는 rectangle의 94문단을 한 문단으로 바꾸고 `가` 2078자와 marker를 넣어, bottom margin 1850HU에서 실제 residual=budget을 만들었다. -10,-8,-7,-1,0,+1,+7,+8,+10 HU의 실제 차이는 offset/75px와 1e-8 안에서 일치한다. +7까지 4개 table fragment, +8/+10은 실제 본문이 있는 5개 fragment이며 Mac 양형식 변경 없는 저장·재열기도 일치했다. 1909자 최초 탐색은 실제 중심이 아니었으므로 성공 경계에 포함하지 않고 보존했다.

## 커서 회귀와 제외 실행

불균등 오른쪽 표의 좁은 옆 열에서 마지막 셀 끝은 20번째 fragment에 그려졌지만 저장 line_segs로 좁힌 커서 후보가 첫 페이지 빈 셀 fallback으로 돌아가는 오류를 실제 Electron에서 재현했다. 중간 문자에서도 같은 오류가 확인됐다. 새 제한 계약에 한해 겹치는 모든 fragment를 후보로 유지하며 실제 TextRun의 문단·문자 범위가 위치를 결정한다. 시작·중간·끝 12,690개 커서 조회가 렌더 문자 범위와 일치하고 HWP/HWPX 재열기·export·full SVG가 읽기 전후 같았다.

수정 전 엔진의 성공 72건·이력 144쌍·재열기/Native 144건과 Node=1·앱=0인 커서 실패는 최종 건수에 포함하지 않았다. 새 런타임 첫 실행의 별도 asset WASM 누락도 기능 실행 전 Node=1·앱=0으로 종료해 증거를 보존하고 제외했다. 커서 전용 엔진의 성공 190건·이력 380쌍·재열기/Native 380건도 최종 건수와 별도로 보존한다. 이 엔진은 4행 표의 후행본문이 실제 표 테두리 안에 놓이는 문제로 다음 단계에서 실패했다.

4행 표의 조판 측정 높이 자체는 실제 paint와 일치했다. Page/Top 통짜 표를 page layer로 옮기는 경로가 후행본문 흐름을 저장 anchor 높이에 두는 것이 원인이었다. 새 제한 계약에서만 흐름을 실제 table bbox 하단+outer-bottom 이상으로 넘긴다. 기존 조판 코드는 유지하며, 조판 높이를 바꾸었던 중간 시도와 실패 Native 증거는 별도로 보존했다. 후행본문·다음 문단의 same-page 하단 검사도 Native 검사기에 추가했다. 최종 엔진으로 17개 phase를 처음부터 다시 실행했으며 과거 실행은 최종 건수에 합산하지 않는다.

## P3 출력 순서 보강

`check_ownership`에서 정렬을 제거하고 renderer가 낸 원래 run의 `(cellParaIdx,charStart)` 단조성을 먼저 검사한다. 본문 owner는 페이지 간 순서까지 유지하며 반복 머리행은 페이지마다 순서를 새로 시작한다. page 배열의 원래 순서도 검사한다. PR14의 보존 Native 28문서·2,556 owner가 강화 검사에 통과했다. 원래 PR14 ledger/log/proof는 바꾸지 않았다.

합성 run·문단·머리행 역순을 두 검사기에서 확인했다. 역사적 PR14 검사기는 같은 6개 음성 입력을 정렬해 통과시켰으나, 강화 검사기 worker는 각각 실제 exit 1과 순서 진단으로 거절했다. 정상 합성 입력 2개도 통과했다. 이는 실제 음성 실행 근거이며 기대값만 기록한 테스트가 아니다.

## 근거·공간·보존·한계

[공개 proof](proof.json)는 완료 phase마다 실제 raw Node/app 종료와 lifecycle, leaf source 전후 hash, received/종료 후 WASM hash, compressed/복원 JSON manifest hash, 실제 saved bytes, 모든 Native log/proof/index를 확인한다. Native 대조는 full SVG·page count/definition·본문/셀·문단/문자 ID·스타일을 비교한다. 전체 gzip manifest가 정본이며 scratch는 비정본이다. 이번 새 phase가 만든 scratch만 마지막 hash가 index와 같고 Native가 성공한 뒤 제거했다. 각 case는 immutable manifest에서 같은 JSON 바이트로 복원할 수 있다. 새 own profile cache도 정상 앱 종료와 Native 성공 뒤에만 정리했다. 과거·실패 증거/캐시는 삭제하지 않았다.

Native/WASM offline/locked 빌드 모두 실제 exit 0이며 제품 Rust는 빌드 직전 checkpoint와 같다. target 관측 최대 4918628352B, 한도 5,078,798,827B다. 빌드·완료 QA의 최소 관측 free 16866144256B는 15GiB+256MiB reserve 합 16,374,562,816B 이상이다. 최종 집계 시점 target 4810293248B, free 16942833664B다. 기존 14개 앱 ASAR, PR14 Native·4 bindings·최종 summary/process와 승인 ZIP 등 22개 file pin이 그대로다. 승인 ZIP SHA는 `e7cbb06e72596249d7b6256602eb567b8c81eaf4cc749c405d9cd5f2b9fa28de`다. 기존 source checkpoint와 새 패키지를 혼합하지 않았으며 새 .app/ZIP·tag·release를 만들지 않았다.

빌드가 공간 하한으로 중단된 이전 증거를 보존했다. 승인된 비활성 WASM 캐시 16쌍의 32개 원래 경로와 추가 debug 라이브러리 14개를 디스크 gzip 재읽기·원본 바이트/SHA 비교 후 복원 가능한 표현으로 전환했다. 원래 경로·mode·크기·SHA·압축 SHA와 복원 스크립트가 보관 색인에 남아 있다. 추가 논리 절감은 1,213,691,743B로 2GB 상한 이내였고, 실제 목표 공간에 도달해 중단했다. 증거가 불충분한 추가 후보 3개는 전환하지 않았다. 기존 proof 88개와 확대 확인 107개, 보호 22개, 당시 활성 target의 불변을 확인한 뒤 새 빌드를 실행했다. 최종 건수와 최소 공간은 성공한 새 빌드·Mac 단계만 집계하며 이전 예산 중단을 성공으로 바꾸지 않는다.

선택 상태 읽기 노출과 native 응답은 전용 source-QA runtime에서만 제어한다. **OS 선택창·물리 IME·수동 GUI·clipboard·한컴·Linux는 미검증**이다. 전체 Rust suite는 기존 include_bytes 원본 3개 누락으로 통과를 주장하지 않는다. 기존 beta.3 승인 후보의 저장/종료/복구 결과를 새 source-QA로 대체하지 않는다. 개인 원본·전체 SVG·저장 파일·바이너리·캐시는 공개 커밋에 넣지 않았다.

## 재실행과 다음 후보

각 공개 스크립트 Usage대로 fresh 출력만 사용한다. Native ledger는 `RHWP_DIAG_MIXED_OWNER=1 RHWP_DIAG_MIXED_OWNER_SCAN=1`과 stdout/stderr를 같은 `<label>-<format>.log`에 기록하고 같은 root의 `<label>-<format>/`에 둔다. source QA는 `GEULGYEOL_QA_GZIP_MANIFEST=1 GEULGYEOL_QA_GZIP_EVIDENCE=1`로 `scripts/run-electron-table-qa.py`를 실행하고 `scripts/shard-electron-table-manifest.py --scratch`로 실제 저장을 대조한다. 전체 완료 증거는 `scripts/summarize-colspan-two-owner-qa.py`로 fresh summary에 집계한다.

다음 후보는 **부분 높이 또는 복수 colSpan=2 rectangle**이다. 서로 다른 시작/끝 행과 같은 열을 공유하는 owner의 원문 범위·cut·폭 합·paint를 먼저 Native에서 입증하고 Mac 첫/중간/끝·이력·양형식 재열기와 제외 fixture를 검증해야 한다. 이번 작은 계약의 완료를 전체 개발 중단 조건으로 해석하지 않는다.
