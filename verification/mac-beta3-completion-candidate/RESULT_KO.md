# PR12 완료 cut 후속을 포함한 Mac beta.3 누적 후보

`main` dd7752874827f5dabf6ab1d0cebb85e9cb24fda5에 병합된 PR12/P2/P3 후속 1ddd4fd16b7adbd5b43d9b0eaf9a27586ce79c85을 담은 새 **GeulgyeolBeta3.app / 0.4.4-beta.3 / arm64**를 만들고 실제 signed 앱에서 재검증했다. 제품 소스는 **7b1c86e334f75d1f184a67797537da79daa1dd7c**, 실행 QA 도구 소스는 **4bc3e51f5c4443a613cb82c3949a2962eb9a624f**이다. 제품 이후 커밋은 검증 도구·기록이며 제품 바이너리와 구분한다. 소스 승인과 후보 채택은 별개다. 이 후보는 부모의 독립 검토용이며 ZIP·태그·릴리스·병합은 없다.

## 이번 후보와 변경 범위

이전 누적 후보 c74d71b7c356303392d26e06cbb3d0196ff0b9d8는 완료 owner의 빈 꼬리 수정 전 엔진을 담아 채택 보류였다. 이번 후보는 검증된 최종 WASM을 재사용하고 공식 Electron 44.3.0의 별도 새 경로에 production UI를 패키징했다. 이전 후보를 복사·덮어쓰기·재서명하지 않았다. 제품 변경은 네 파일의 beta.3 버전·앱명·bundle ID·프로필 명세뿐이며 추가 편집 엔진 변경은 없다. 아직 공개되지 않은 내부 beta.3 후보들은 제품 SHA·경로·ASAR로 구분한다.

반복 머리행·혼합 owner·완료 cut의 동작은 [이전 수정 검증](../table-mixed-owners-completion/RESULT_KO.md)에 설명돼 있다. 이번에는 그 소스 QA 결과를 signed 후보에 소급 적용하지 않고 아래 전체 범위를 새로 실행했다. 기존 cut 허용치 0.1px와 물리 본문 검사 허용치 2px는 유지한다.

## 실제 signed Mac 앱 검증

| 범위 | 새 후보 결과 |
|---|---|
| 초기 배치·혼합 owner 기본·이력·기존 병렬/짧은 블록·완료 경계 | 268사례: 초기 6 + 기본 74 + 네 owner 이력 80 + 회귀 90 + 경계 18 |
| 첫·중간·끝 fragment와 실제 마지막 caret 편집 | 셀 입력·호스트 입력·찾아 바꾸기·Shift+Enter·forward Delete·Tab 이동/행 추가·연속/빠른 이력 통과 |
| undo/redo | 604쌍. 쪽 정의·전체 본문·셀 문단/문자 속성·스타일·bounded snapshot·전체 SVG 복원 |
| HWP/HWPX 실제 IPC 저장·재열기 | 480회. 반복 머리행·후행 본문·전체 셀 owner 및 배치 보존 |
| 실제 저장 파일 독립 Native 대조 | 480파일 전부 전체 SVG·모델·쪽 수/정의·문단/문자 ID·스타일 정확히 일치, LAYOUT_OVERFLOW 0 |
| 부동소수점 완료 경계 | 9경계 × 양형식. ±7/75px·±8/75px로 기존 0.1px를 감싸며, 빈 머리행 꼬리 제거 및 필요한 본문 fragment 보존. 경계 저장 36회는 위 저장 합계에 포함 |
| 파일 수명 주기·재실행 복구·복구 안전성·pruning·최종 응답 경합 | 29 + 6 + 20 + 15 + 최종 응답 경합 11 = 81항목 |
| 어댑터 없는 일반 기동·정상 종료 | 1항목. main inspector/응답 어댑터 없이 실행·clean 상태·실제 엔진 수신 확인. 소유한 생존 PID의 네이티브 정상 종료, 강제 종료 없음 |
| 데스크톱 회귀 | 49통과·실패 0·기존 비공개 fixture 검사 1개 skip |

그림 검사 **806회 / 9132쪽**, 숨김·부분 잘림·렌더러 오류 0이다. 최대 테두리 초과 0.093333333px, 글자 경계 초과 -0.786585515px다. 34개 완료 하네스 실행의 독립 원시 Node 종료 0, 실제 앱 59회 종료 0을 확인했다. Native API fixture 비교를 실제 저장 수에 더하지 않는다. 과거에 고친 마지막 fragment redo를 새 결함으로 보고하지 않는다.

실제 .app의 production UI·WASM·IPC 파일 쓰기·IndexedDB·재실행을 사용했다. 표 조작은 UI/키보드/호스트 편집 경로이며 선택·모델 검사에만 실행 프로세스 메모리의 읽기 alias를 주입했다. 배포 ASAR에는 QA read globals가 없다. 일반 기동은 별도 어댑터 없이 확인했다. native 선택 응답·renderer crash·IndexedDB 실패/abort는 통제된 QA 조건이다. 요청 성공과 transaction 완료/abort를 구분하며 OS 시계는 변경하지 않았다.

## 실행 중단과 증거 정확성

완료 경계의 raw Node/app 종료 0 및 Native 36개 대조 뒤 private phase runner의 공간 조건만 실패해 외부 실행은 종료 1이었다. 실패 당시 free 수치는 기록되지 않았으며 새 관측과 구분한다. 150MiB의 다음 표 phase reserve를 남은 호스트 검사에도 요구한 조건이었다. 기존 signed 호스트 suite의 최대 실측은 2482176바이트다. 다음 실행부터 호스트 phase reserve를 8MiB로 적용하고 15GiB 하한·ZIP reserve 256MiB·2GiB 새 root 한도는 유지했다. 이전 종료 1 기록을 0으로 소급 수정하지 않았다. 남은 20개 호스트 phase를 각각 실행 전후 측정하며 진행했고 기존 증거·cache는 추가 삭제하지 않았다.

최초 장기 matrix 실행은 첫 세 묶음의 정상 종료·Native 대조 뒤 네 번째 이력 묶음의 9개 개별 PASS에서 도구 세션이 소실됐다. 최종 proof/manifest/lifecycle/원시 종료 코드는 없고 원인은 미확정이다. 그 9개를 완료 집계에 넣지 않았다. 소유한 두 loopback 포트가 닫혔음을 확인하고 원시 로그를 보존한 뒤 `table-mixed-4-complete`의 전체 20사례 및 나머지를 독립 실행으로 완료했다. 중단 앱의 정상 종료를 추정하지 않는다.

패키지 검증기 첫 시도는 Git 미추적 font 자산을 git show로 조회해 종료 1이었다. 도구의 출처 분류 오류이며 제품 실패가 아니다. 초기 스크립트/상태를 보존하고 Git 추적 제품 파일은 정확한 제품 커밋 바이트로, generated/미추적 자산은 패키지 SHA pin으로 확인하도록 고쳤다. 수정 후 실행 전·후 모두 통과했다. 결과 집계 첫 시도도 ordinary의 이전 schema에 네 binding pin이 있다고 가정해 KeyError/종료 1이었다. 초기 집계기/상태를 보존하고 실제 WASM-only 기록을 지원하도록 고쳤으며 historical raw record는 수정하지 않았다. 초기 원시 도구 출력 외에 소급 만든 실행 로그는 없다.

모든 완료 실행은 실행 전/후 public wrapper·실제 MJS·호출/import하는 QA helper·native adapter bootstrap·해당 seed JSON·WASM을 독립 해시했고 각 실행에서 동일했다. 최초 ordinary 실행은 WASM pin만 있다. 그 뒤 표와 호스트 실행에는 네 엔진 binding 파일의 before/after pin이 있으며 동일했다. ordinary는 엔진 binding JS를 import하지 않는다. 어댑터 없는 일반 기동, imported source pin 추가 및 최종 응답 경합 wrapper 추가의 실제 source epoch 차이는 proof에 보존했다. 과거 QA의 종료 후 해시만 있는 기록을 실행 중 불변 증거로 소급하지 않는다. private orchestration 스크립트의 SHA는 최종 집계 시점 값이며 전후 실행 불변 증거로 주장하지 않는다.

새 manifest는 처음부터 gzip 한 벌로 기록하고 파일 fsync 뒤 디스크에서 다시 읽어 복원 JSON 바이트·SHA를 확인했다. Native 스트리밍 검사도 압축 파일 SHA와 복원 바이트 SHA를 독립 계산한다. 새 전체 manifest 1926388658바이트가 압축 40348828바이트로 보존되며 raw JSON 중복본은 없다. scratch 한 파일은 비정본 재사용 공간이고 전체 gzip·각 저장 파일·Native 개별 log/proof·인덱스가 정본 증거다. 집계 시 480개 실제 저장 파일과 개별 Native 로그도 다시 확인했다.

## 산출물·서명·보존

- 앱: `../mac-beta3-completion-candidate-qa/GeulgyeolBeta3.app`
- 제품 SHA: `7b1c86e334f75d1f184a67797537da79daa1dd7c`
- ASAR SHA256: `bd7331abd570fd1d4a67657111ea5758cef6a5825e8c3d3029f0ac0a58962ca4`
- ASAR header SHA256: `7a78fa5bd44e85571dee02251db36c7437ef1df92d2a0be99208888ceb7d7f92`
- WASM SHA256: `e9cdd0cd9b2bb4c2205ae674305d19748ae6651a75da759f672b2233030d42f7`
- bundle tree SHA256: `7360a8abaac4b5900a723e99729e0f5b33a3a2288b914ee707fa0d22578c0687`
- CodeResources SHA256: `47cccd7ae5b19a64c9f6a2613aa75316ddf812efc72b371e5a6c7b9f193a86ca`
- CDHash: `138a0224d81c1bf776ef99e59462784972288d6e` — CodeDirectory의 20바이트 hash이며 전체 SHA256과 구분한다.
- bundle ID `org.geulgyeol.beta.0443`, 프로필 `GeulgyeolBeta3`. QA는 새 root 아래 전용 프로필만 사용한다.

ASAR 80항목의 전체/블록 hash, 추적 제품 32파일의 Git 제품 바이트, generated/미추적 자산 47파일의 SHA pin, 전체 번들 279항목의 바이트·symlink·mode가 실행 전/후 정확히 같다. arm64 및 strict deep codesign 종료 0을 재확인했다. 서명은 ad-hoc이며 Developer ID·공증은 없다. 이전 앱 13개의 ASAR hash도 전부 유지된다. 기존 PR9 및 이전 c74 후보의 공개/채택 보류는 해제하지 않았다.

부모가 특정한 두 중복 raw manifest만 원본 SHA·크기·metadata·복원 명령을 작은 archive index에 남기고 무손실 gzip 표현으로 전환했다. 디스크 readback 일치 확인 뒤 해당 raw 표현만 대체했으며 원본 inode는 복원되지 않는다. 기존 shard 인덱스 SHA는 그대로다. 두 원본 합계 2123157942바이트, gzip 합계 45298054바이트이며 세부 SHA는 proof에 있다. 변환 전 free 16465920000바이트는 당시 도구 출력 측정, 변환 후 18562781184바이트는 archive 기록이다. unique source QA manifest·저장 파일·과거 proof·로그·원본·다른 cache는 삭제하지 않았다. 이전 read-only ps 접근 거절도 재시도·우회하지 않았다.

최종 새 QA root 1373708288바이트는 2GiB 이내, Rust target 4764311552바이트는 4810363371바이트 제한 이내다. Rust 재빌드는 없었다. free 17088933888바이트이며 15GiB 하한과 향후 ZIP reserve 256MiB를 제외해도 714371072바이트가 남는다. reserve만 확인했고 ZIP은 생성하지 않았다.

## 재실행과 다음 구현 후보

완료 원시 기록은 새 QA root의 ordinary/table-*/document-lifecycle/recovery*/pruning*/final-ack-* 각 `harness-process.json`, `lifecycle.json`, `proof.json`과 native-table-*/index.json에 있다. [공개 proof](proof.json)는 원시 증거와 saved bytes의 hash·건수·실제 source epochs를 담으며 개인 원본·전체 SVG·캐시·바이너리를 공개하지 않는다.

```sh
GEULGYEOL_HOST_SEEDS="$SEEDS_JSON" GEULGYEOL_QA_GZIP_MANIFEST=1 \
GEULGYEOL_QA_STUDIO_DIR="$PRODUCTION_STUDIO" \
python3 scripts/run-packaged-qa.py "$FRESH_PHASE" \
  check-electron-stored-merged-fragments.mjs "$APP_EXECUTABLE" "$WASM_PKG"
python3 scripts/shard-electron-table-manifest.py \
  "$FRESH_PHASE/manifest.json.gz" "$FRESH_NATIVE_OUTPUT" "$NATIVE_CHECKER" --scratch
python3 scripts/verify-mac-candidate.py "$CANDIDATE_ROOT" after
```

위 after phase는 fresh 이름이어야 한다. 호스트 suite는 같은 wrapper에 check-packaged-document-lifecycle.mjs, check-packaged-recovery.mjs, check-packaged-recovery-safety.mjs [8시나리오], check-packaged-pruning-safety.mjs [5시나리오], check-packaged-final-ack.mjs [public/file-read/image-decode/cancel/pending-render]를 지정한다. 각 앱 묶음은 독립 완료 후 다음을 실행하며 중단 파일을 덮어쓰지 않는다.

**OS 선택창·물리 한글 IME·수동 GUI·클립보드·한컴 대조·Linux 실행은 미검증이다.** 전체 Rust lib suite는 기존 include_bytes 원본 세 개 누락으로 통과를 주장하지 않는다. 이번에 과거 Native 1252검사를 새 엔진으로 재실행했다고 주장하지 않으며 후보의 실제 저장 480파일만 새 대조했다. 지원 범위 밖 복잡한 표·머리행 rowspan도 남는다.

다음 구현 후보는 **3열 colSpan=1의 정확한 행/열 single-cover 계약**, 이후 제한된 colSpan=2 확장이다. 먼저 paint의 resolved column 폭과 cell unit 폭을 일치시키고 owner 원본 행 범위·stable cut을 typeset/paint/history가 공유하게 한다. 긴 owner 좌/중/우·엇갈린 rowspan·rectangular rowspan×colspan·독립 행 인접·비대칭 폭·완료 FP 경계 fixture와 gap/overlap/range/width 불일치 제외 fixture를 독립 Native에서 마련한 뒤 실제 Mac 양형식 첫/중간/끝 편집·저장·이력을 검증한다. 아직 이 확장을 구현하거나 성공으로 집계하지 않았다. 후보 완료를 전체 개발 종료로 해석하지 않는다.
