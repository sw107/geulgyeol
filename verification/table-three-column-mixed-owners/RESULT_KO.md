# 3열 colSpan=1 mixed owner 검증

3열 표에서 시작·끝 행이 다른 세로 병합 셀을 편집하면 owner별 원본 행 범위와 화면 조각의 폭을 함께 유지하도록 지원 범위를 넓혔다. 기존 2열의 안정된 cut ledger를 공유하되, 3열은 각 열의 모든 저장 셀 폭이 같고 세 열 폭의 합이 표 폭과 정확히 같은 경우에만 진입한다. 첫·중간·끝 조각의 입력·줄바꿈·삭제 후 화면, undo/redo, HWP/HWPX 저장·재열기가 같고 반복 머리행·후행 본문이 보존됨을 실제 Mac Electron에서 확인했다. 기존에 고친 redo 결함을 새로운 결함으로 집계하지 않았다.

- 검토 시작점: `166deb11997ce81cd524e26691ed2541f9e9c1cd` (PR13 reviewed head). 당시 main은 `cb733aafef4a3404c63442ecc5509432b8b5b66d`.
- 이번 소스·검증 도구 커밋: `57333bc02b5dec131c3e99e0a5dd471179e2e39f`.
- 새 문서 WASM SHA256: `3af7d9b6d4a90d25e17a687f7604843b73c453030850e6df69207f70d8bf9232`.
- 새 통합 Native 검사기 SHA256: `3d572da7ac165809b08660d3c137210aea5a3d1e8e9de5df22f2c436e51abb2d`.
- 증거 root: `../table-three-column-mixed-owner-qa`. 원본·전체 SVG·저장 파일·로그·바이너리는 로컬에 보존하며 공개 proof에는 해시와 건수만 담았다.

## 지원 계약

제품 변경은 `renderer/float_placement.rs`의 공유 `mixed_plain_owner_block` 판정에 한정된다. scanner/typeset, partial paint, merged-cell snapshot eligibility가 같은 판정을 사용한다. 3열의 저장 셀 폭과 paint의 resolved column 폭이 같도록 양수 signed 범위, 열별 동일 폭, 정확한 표 폭 합, local resize 부재를 요구한다. 비대칭 폭 4000/7000/10000 HWPUNIT도 포함한다.

본문 owner 연결 block은 4..64행, 모든 셀 colSpan=1, 행·열 single cover, 평문 문단이며 RowBreak, non-TAC, non-overlap, TopAndBottom, Page/Top/offset=0, cell spacing=0, caption 부재 조건을 유지한다. 3열 머리행은 rowSpan=1, 일반 가로쓰기·기본 wrap·내부 control/raw break 부재로 제한한다. 기존 2열과 whole-span 경로의 계약은 유지했다. colSpan=2, 복잡한 머리행, width residual·local resize는 이번 지원에 포함하지 않았다.

원본 소유권과 그림 폭을 분리해 검사했다. Native API의 반올림된 cell 폭 3946회와 SVG clip의 전체 정밀도 폭 3166회를 대조했고 최대 clip 폭 오차는 `4.263256414560601e-14px`였다. 기본 fixture 10개와 완료 경계 18개에서 원본 문단 순서, stable cut 연속성·단조 증가·예산, 반복 머리행, 빈 머리행 전용 마지막 조각 부재, 후행 본문 위치, overflow warning=0을 확인했다. control layout의 cellIdx는 fragment-local일 수 있으므로 폭 검사에서는 안정된 열 좌표를 사용한다.

## 실제 검증

| 검증 | 결과 |
|---|---:|
| Mac Electron 44.3.0 완료 사례 | 296 |
| undo/redo 쌍 | 536 |
| HWP/HWPX 저장·재열기 / 독립 Native 대조 | 572 / 572 |
| Node harness·앱 정상 종료 완료 단위 | 23 |
| 실제 Mac paint 검사 / 쪽 수 합계 | 924 / 10910 |
| hidden / partial text | 0 / 0 |
| 최대 border / ink body overflow | 0.0933333333337032 / -0.7866058603922284 px |
| 지원/기준 엔진의 읽기 전용 scope query | 각각 52 (positive 10 + excluded 42) |
| 3·4·64·65 본문 행 eligibility / 양형식 재열기 | 4 / 8 |
| 새 엔진 desktop 테스트 | 49 pass, 0 fail, 기존 private fixture 1 skip |

긴 owner 좌·중·우, 세 열의 시작·끝이 엇갈린 owner, 비대칭 열 폭의 5개 합성 fixture 그룹을 양형식으로 검사했다. 각 긴 owner의 첫·중간·끝 문단 입력과 조각 말미 입력, Shift+Enter·Delete, undo/redo 두 쌍과 저장·재열기, 후행 host 입력, replace one/all, 취소된 size dialog를 다뤘다. 4/64행 양 끝도 실제 Mac에서 입력·history·양형식 재열기를 확인했고 기존 2열 두 fixture의 첫·중간·끝 입력을 회귀 검사했다.

완료 경계는 공통 bottom margin 중심 1850 HWPUNIT에 -10,-8,-7,-1,0,+1,+7,+8,+10을 더한 18개 양형식 fixture로 확인했다. 실제 Native residual-budget 차이는 `offset/75px`와 1e-8 이내로 같다. +7까지 8개 표 조각이고 +8,+10에서는 실제 본문을 가진 9번째 조각이 생긴다. 경계 0은 실제 residual과 budget이 같다. 각 fixture를 Mac에서 변경 없는 저장으로 양형식 재열기·완전한 SVG 일치까지 대조했다. 이전 2열의 5850 중심을 그대로 적용한 탐색 기록은 이 성공 집계에서 제외했다.

scope 제외 사례에는 TAC·overlap·다른 wrap/anchor/offset·spacing/page break·세로쓰기·caption·colSpan2·65행·4열·열별 폭 불일치·runtime local width·표 폭 잔차를 포함한다. 별도 HWPX 조작으로 gap/overlap/행 범위 초과/열 범위 초과를 실제 파싱한 뒤 제외를 확인했다. 각 query 전후 HWP·HWPX 바이트와 전체 SVG hash가 같다. 이 excluded 검사는 eligibility 범위 검증이며 해당 복잡한 표의 전체 편집 성공을 주장하지 않는다.

## 증거·실행 경계와 보존

[공개 proof](proof.json)는 23개의 완료 phase에서 실제 Node=0, 앱=0·normal quit, leaf QA 소스 전후 SHA 동일, received WASM과 실행 후 WASM SHA 동일, 두 wrapper 종료=0을 확인한다. 각 압축 manifest의 디스크 SHA와 복원 JSON SHA, 실제 저장 파일 전체 바이트, 개별 Native log/proof/index를 다시 읽어 대조했다. Native는 full SVG·page count·page definition·본문/셀 문단·문자 ID·스타일을 정확히 대조한다. scratch는 비정본 재사용 공간이며 gzip manifest와 실제 저장 파일·각 Native log/proof/index가 정본이다. auxiliary JSON도 처음부터 gzip으로 기록해 raw 중복을 늘리지 않았다.

제품 Rust 파일은 빌드 직전 보존한 checkpoint와 바이트가 같다. Native와 WASM offline/locked 빌드는 종료 0이다. build target 관측 최대 `4,869,459,968B`는 승인 한도 `5,078,798,827B` 안이다. 빌드·완료 QA 관측 최소 free는 `16513536000B`로 15GiB 하한과 256MiB reserve 합 `16,374,562,816B` 이상이다. 최종 집계 시점 target `4764389376B`, free `16799916032B`다. Native build의 역사적 startedUTC 필드는 종료 시각에 기록됐으므로 정확한 시작 시각 증거로 사용하지 않는다. 샘플·소요 시간·exit code·최소 free는 원시 기록 그대로다.

새 QA의 임시 profile cache만 해당 실행의 앱 정상 종료와 Native 성공 후 정리했다. 실패·중단·과거 profile과 unique 원시 증거는 보존한다. 기존 14개 앱 ASAR와 승인된 beta.3 ZIP SHA `e7cbb06e72596249d7b6256602eb567b8c81eaf4cc749c405d9cd5f2b9fa28de`가 그대로다. frozen beta.3의 문서 WASM은 기존 `e9cdd0…`이며 이번 3열 WASM과 구분한다. 이번 작업에서 새 .app/ZIP을 패키징하거나 tag/release를 만들거나 업로드하지 않았다.

초기 scope의 HWPX getter offset assertion과 초기 Native의 fragment-local cellIdx 폭 assertion은 검사기 오류를 바로잡은 뒤 fresh evidence로 재실행했다. 기본 desktop 명령은 보존된 옛 bundled engine을 사용해 46 pass/3 fail/1 skip이었고, 명시적 새 엔진 디렉터리로 49 pass/0 fail/1 skip을 얻었다. 기존 로그는 덮어쓰지 않았다. 연결 중단 phase `three-long-middle-all-history`의 부분 PASS 11건은 정상 종료·proof가 없어 집계에서 제외하고 보존했다. 복구 후 fresh `…-complete`에서 12건을 실제 완료했다. 프로세스 조회·signal 접근 거절을 재시도하거나 우회하지 않았다.

Mac의 실제 product input/history/save/reopen 경로를 사용했으며 선택 상태 읽기 노출과 Native 응답 adapter는 QA 전용이다. **OS 선택창·물리 한글 IME·수동 GUI·clipboard·한컴 대조·Linux는 미검증이다.** 전체 Rust suite는 기존 include_bytes 원본 3개 누락으로 통과를 주장하지 않는다. 기존 beta.3 후보의 저장·종료·복구 성공을 이번 3열 source-QA 결과로 대체하지 않는다. 이 기록만으로 새 packaged app 또는 전체 개발 완료를 주장하지 않는다.

## 재실행·다음 후보

```sh
node scripts/prepare-three-column-owner-fixtures.mjs "$FRESH_SEEDS" "$BASELINE_WASM_PKG" "$SYNTHETIC_SOURCE"
node scripts/check-three-column-owner-snapshot-scope.mjs "$NEW_WASM_PKG" "$SEEDS_JSON" "$FRESH_SCOPE" supported
python3 scripts/check-three-column-owner-native-evidence.py "$SEEDS_JSON" "$NATIVE_LEDGER_ROOT" "$FRESH_PROOF"
GEULGYEOL_QA_GZIP_MANIFEST=1 GEULGYEOL_QA_GZIP_EVIDENCE=1 \
python3 scripts/run-electron-table-qa.py "$FRESH_PHASE" "$NEW_WASM_PKG" "$PHASE_SEEDS_JSON" all
python3 scripts/shard-electron-table-manifest.py "$FRESH_PHASE/manifest.json.gz" "$FRESH_NATIVE_OUTPUT" "$NATIVE_CHECKER" --scratch
python3 scripts/summarize-three-column-owner-qa.py "$COMPLETED_QA_ROOT" "$FRESH_SUMMARY_JSON"
```

출력 이름은 fresh여야 하며 과거 실패 기록을 덮어쓰지 않는다. Native ledger 생성에는 `RHWP_DIAG_MIXED_OWNER=1 RHWP_DIAG_MIXED_OWNER_SCAN=1`을 설정하고 stderr도 같은 `<label>-<format>.log`로 보존한다. 각 ledger 출력은 같은 root의 `<label>-<format>/`이어야 한다. 자세한 row/completion fixture 인자는 각 공개 스크립트 Usage에 있다. root의 `plan.json`은 수행된 owner별 입력/history·행 경계·완료 경계·2열 회귀·body/find phase를 지정한다.

다음 구현 후보는 **제한된 colSpan=2의 rectangular rowspan×colspan owner 계약**이다. resolved column 폭 합과 cell-unit 폭, 원본 owner 범위·stable cut을 먼저 독립 Native fixture에서 입증한 뒤 실제 Mac 양형식 편집·이력을 검증한다. 복잡한 머리행·runtime resize·width residual은 별도 계약과 제외 fixture가 필요하다. 이 묶음 완료를 전체 개발 중단 조건으로 해석하지 않는다.
