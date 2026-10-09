# 긴 혼합 rowspan의 소유자별 분할

main `e3fda28355a78e121426e39c0160cc16e10d2f0b` 위의 후속이다. PR10/11 소스와 로컬 체크포인트 `778a1cf34e99060f2f3d02371b5db1a7bf3f13d9`, 기존 beta.3 후보를 보존했다.

## 재현과 최소 수정

기존 48×2 합성 표의 HWP/HWPX를 그대로 사용했다. 저장 객체 프레임 40000HU, 실제 셀/행 상자, LINESEG 태그 0x60000, 선행 머리행의 두 셀과 후행 본문을 보존한다. 14개 원본의 해시가 이전 검증과 같다. 한컴 직접 저장 부분 프레임 원본이나 한컴 화면 일치를 주장하지 않는다.

| 원본 | 긴 owner의 원본 행 범위(0부터, 끝 미포함) | 수정 전 | 수정 후 |
|---|---|---|---|
| mixed-large-left | cell 2: [1,48), 오른쪽 독립 행 셀 | 4쪽, owner 2867자 중 raw 665자만 배치 | 12쪽, 모든 문단 정확히 한 번 |
| mixed-large-right | cell 3: [1,48), 왼쪽 독립 행 셀 | 11쪽, raw 소유권은 같지만 실제 글자 부분 잘림 30건 | 11쪽, 부분 잘림 0 |
| mixed-staggered | cell 2: [1,33), cell 18: [16,48) | 9쪽, raw 소유권 불일치 31건, 숨김 1090·부분 잘림 42, 테두리 +1840.72px | 11쪽, 누락·중복·숨김·부분 잘림 0 |

서로 다른 시작·끝 행의 셀을 같은 누적 높이로 진행시키던 fallback을 좁게 대체한다. 연결된 rowspan 블록의 셀을 (row,col) 순서로 고정해 owner별 start/end cut을 다음 fragment로 전달한다. 각 owner가 선택한 줄의 높이와 패딩이 **그 owner의 원본 행 범위 안에서** 충족되도록 행 밴드를 배분한다. 스캔과 실제 partial-table paint가 같은 밴드를 사용한다. 이전 fragment에서 끝난 독립 행 owner는 다음 fragment의 시작 offset에 다시 더하지 않는다. Native 원장은 모든 원본 문단의 누락·중복·순서 및 이전 end cut과 다음 start cut의 정확한 연결을 별도로 검사한다.

새 경로는 2열, 연결 블록 4~64행, colSpan=1, cell spacing=0, 페이지 기준 Top/offset 0, 겹침 없음, TopAndBottom·RowBreak, 캡션·중첩 컨트롤·세로 텍스트·explicit raw paragraph break 없음으로 제한한다. 처음부터 한 쪽 안에 들어가는 작은 블록은 기존 full-table 경로를 유지한다. 기존 whole-span 병렬과 3행 짧은 병합 경로도 보존한다. 같은 판정을 source snapshot 이력이 공유하며 혼합 블록 안의 독립 행 셀 편집도 원본 줄/페이지 상태를 복원한다. 이력 예산 확대나 물리 본문 여백 clamp는 없다.

## 완료 검증

- 실제 공식 Mac Electron 44.3.0: 총 250사례 = 초기 화면 6 + 새 혼합 154(기본/이력 140 + 실제 꼬리 14) + 기존 표 회귀 90. undo/redo 604쌍, 실제 IPC 양형식 저장·재열기 444건이 통과했다. 완료 실행 7개 각각 Node 하네스와 Electron 앱이 따로 원시 종료 0을 기록했다.
- 그림 검사 740회/8408쪽: 수직 숨김 0·부분 잘림 0·렌더러 오류 0. 최대 테두리 초과는 +0.0266667px, 최대 실제 글자 경계는 본문 하단 안쪽 0.85327px다. 기존 본문 허용치 2px와 cut 계산 허용치 0.1px를 유지한다. 제품의 실제 deferred pagination idle 뒤 검사했다.
- 독립 Native: 새 실제 저장 444건 + 기존 실제 저장 808건 = 1252건 전부 전체 모델·SVG·쪽 정의·셀/본문 문단 및 문자 속성·스타일이 일치하고 LAYOUT_OVERFLOW 0이다. 별도 API 경계 16건을 합쳐 1268건이며, 기존 실제 초과 4사례·제외 계약 2사례의 진단도 동일하다. API 증거를 실제 앱 저장 수에 더하지 않는다.

긴 owner의 첫·중간·끝 문단 입력, Shift+Enter·forward Delete, Tab 이동/마지막 행 추가, 6단계 일반/빠른 연속 편집의 모든 중간 undo/redo를 검사했다. 반복 머리행·후행 본문, 쪽 정의, 격자, 문단/문자 속성·스타일, bounded snapshot 자원 및 저장 전/재열기 전체 SVG가 보존된다. 실제 마지막 fragment 꼬리도 별도 14사례로 검사한다. 왼쪽 마지막 문단은 10쪽에서 시작하지만 끝 caret은 11쪽이며, 그 11쪽에서 실제 입력했다. 오른쪽 owner 끝은 9쪽, staggered 두 owner 끝은 7·9쪽, 마지막 독립 행 끝은 10쪽이다. 쪽 번호는 모두 0부터다.

읽기 전용 snapshot 범위 37건(혼합 양형식/기존 wrap 9, 최소 범위 제외 11, 기존 병렬 17)이 통과했다. 65행 body 블록·3열·세로 텍스트·겹침·페이지 offset 등 제외 조건은 실제 API로 변경한 뒤 판정을 확인하고, 판정 전후 양형식 export와 전체 SVG가 변하지 않는 것을 검사했다.

WASM 및 실제 앱 수신 SHA256: `6f98907e4d41136c62a2f8c8c7bd3c0e62a5ccc2fe0695491248faf3024f6b24`. Native SHA256: `57e0daa685408f4239e42827766601e1327fd25edede2df54bbfbbd6bdf1459c`. offline Native/WASM 빌드가 각각 0으로 끝났다. 최종 target 4764418048바이트는 제한 4810363371바이트(4.48GiB) 안이다. 새 WASM 선언을 지정한 TypeScript 검사와 Node/Python 구문·diff 공백 검사도 통과했다. 기본 설정의 오래된 로컬 pkg 선언은 기존 API 7개가 빠져 실패했으므로 덮어쓰지 않고 별도 설정으로 검사했다. 저장소의 portable QA builder 출력 52개 파일과 bootstrap도 실제 runtime과 바이트가 같다.

## 중단·종료 증거

regression-3은 62개 개별 PASS 후 실행 세션이 소실됐다. 최종 proof/manifest/lifecycle/harness-process가 없고 loopback endpoint가 닫혀 있었으므로 원래 Node와 앱 종료 코드는 **미확인**, 원인은 미확정이다. 이 62건을 완료 건수에 더하지 않는다. 원시 기록을 보존하고 네 개의 새 variant 실행으로 전체 90사례를 다시 검증했다.

이번 완료 실행은 run-electron-table-qa.py의 외부 subprocess wrapper가 Node 종료 값을 직접 받아 harness-process.json에 저장하고, Electron lifecycle의 앱 종료 값과 분리한다. 이전 PR10/11의 exitCode는 앱 값이며 Node 0은 작성자 wrapper 보고였다는 설명만 보정했다. 옛 proof/원시 파일을 변경하거나 과거 원시 Node 증거를 소급 생성하지 않았다.

초기 Native 빌드는 probe 링크 후 target이 약 23MiB 제한을 넘었다. 다음 monitor는 프로세스 그룹 신호에서 PermissionError로 종료됐고 원래 Cargo 종료 코드는 남지 않았다. 거절을 재시도하거나 우회하지 않았다. 자신의 새 probe·이전 WASM 아티팩트만 QA checkpoint로 이동해 공간을 확보했고, 최종 Native/WASM 재실행의 정상 종료·실측 용량 증거를 남겼다. 초기 scope 스크립트의 cols/colCount 오기와 원장 검사의 0.01px 오기도 실패 기록을 보존하고 수정해 재검증했다. 엔진의 기존 cut 부동소수점 허용치는 0.1px, 화면 본문 허용치는 2px이며 확대하지 않았다.

## 증거와 재실행

공개 proof.json은 원본 내용·SVG·캐시 대신 소스/엔진/원시 증거/실제 저장 파일의 해시, owner 행 범위·fragment 원장 요약, 정확한 건수와 한계를 담는다. 원시 증거는 ../table-mixed-owner-pagination-qa의 native-fixed-3-*/owner-proof-2.json, full-3, tail-3, regression-*-4 및 각 shards-*/index.json에 있다. baseline/중단/checkpoint도 보존한다. 기존 ../table-parallel-merged-fragments-qa의 mixed baseline과 원본 Native 격자 증거를 함께 읽는다.

1. prepare-parallel-merged-table-fragments.mjs로 검증된 합성 7종을 만들거나 기존 seeds-2/seeds.json을 그대로 사용한다.
2. `node scripts/prepare-mixed-owner-history.mjs <source seeds.json> <새 seed 경로>`가 동일한 혼합 7그룹·154사례를 만든다. 한 번에 실행하거나 source별로 나누어 검사한다.
3. `node scripts/build-electron-table-qa.mjs <QA root> <새 phase> <WASM pkg>`로 별도 runtime을 만든다. GEULGYEOL_QA_REUSE_UI를 이전 runtime/web/studio로 지정하면 같은 자산을 하드링크한다.
4. `python3 scripts/run-electron-table-qa.py <QA phase> <WASM pkg> <seeds.json> all`이 실제 공식 Mac Electron을 실행하고 두 프로세스 종료 기록을 남긴다.
5. `python3 scripts/shard-electron-table-manifest.py <완성 manifest.json> <새 분할 경로> <Native checker>`가 각 실제 저장의 독립 모델/SVG 비교와 해시 인덱스를 남긴다. Native mixed_table_owner_probe와 check-mixed-owner-ledger.py로 원본 owner 및 cut 연결을 확인한다.

기존 beta.3 ASAR `e94f2bfc1b0cb1911c358fe16e036935c7ad8514ee4923bff89555f05990e15e`, PR9 source와 공개 보류를 유지한다. 새 앱 패키지·ZIP·태그·릴리스는 만들지 않았다. 물리 IME·OS 선택창·수동 GUI·한컴 비교·Linux는 미검증이고 전체 Rust lib 테스트는 기존 include_bytes 원본 세 개 누락으로 실행 불가다. 복잡한 머리행 rowspan과 지원 범위 밖 표도 미검증/제외다. 다음 구현 후보는 3열·colspan 혼합 owner의 행/열 범위 제약 확장이며, 새 beta 후보는 부모의 독립 검토·병합 조율 뒤 제품 소스로 별도 검증한다. 이 묶음을 전체 개발 종료로 해석하지 않는다.
