# 같은 블록 전체를 소유하는 병렬 병합 셀

PR10 source `fe10c48ababba88bd49827e883c2a7e9cc746b4e` 위의 후속이다. 이전 로컬 체크포인트 `778a1cf34e99060f2f3d02371b5db1a7bf3f13d9`를 그대로 보존한다. PR10의 Shift+Enter·직접 Delete effect 전달 수정도 포함한 실제 UI를 검증한다.

## 좁은 재현과 수정

기존 합성 split-before.hwp에 두 번째 열을 만들고 각각 1~47행을 병합했다. 동일한 긴 내용을 가진 두 소유자와 한쪽이 짧은 내용인 두 소유자, 3행 짧은 병렬 병합을 검사한다. 저장 객체 프레임만 40000HU로 바꾸고 원본 행/셀 상자와 LINESEG를 보존했다. Native가 14개 합성 HWP/HWPX 원본의 48×2 격자 중복·누락 없음, 저장 LINESEG 태그 0x60000과 객체 높이 40000HU를 확인했다. 한컴 작성 쪽 나눔 증거나 한컴 화면 일치를 주장하지 않는다.

수정 전 긴 병렬 표는 4쪽이고 raw 소유자 불일치 85건, 길이가 다른 병렬 표는 4쪽/72건이었다. 실제 긴 병렬 baseline에서 테두리가 본문을 5657.36px 넘고 숨긴 글자 5093개·부분 잘림 22개가 있었다. 기존 whole-cell unit 경로의 shared predicate가 한 열로 제한되어 이 구조를 행별 fallback으로 보내던 누락이었다. 모든 겹치는 셀이 같은 시작 행·전체 rowspan·수평 일반 텍스트를 소유한다는 기존 계약을 유지하면서 col_count == 1 제한만 제거한다. 블록 크기 >3, RowBreak, 자리 차지, 캡션 없음 및 중첩 컨트롤 없음 조건은 유지한다. 같은 판정을 배치와 bounded source snapshot 이력이 공유한다. 새 분할 알고리즘·쪽 여백 clamp·이력 예산 확대는 없다.

독립 행 셀이나 다른 시작 행의 병합 셀이 섞인 구조는 제외한다. 그 8개 양형식 파일은 PR8과 새 엔진에서 전체 SVG·HWP/HWPX export가 그대로 같고 모든 snapshot 대상이 false다. 확인된 누락·부분 잘림·넘침은 [KNOWN_MIXED_KO.md](KNOWN_MIXED_KO.md)에 별도 기록했다.

## 완료된 Mac 검증

- 최종 parallel-final-3: 실제 Mac Electron 44.3.0의 152사례, undo/redo 436쌍, 호스트 IPC 양형식 저장·재열기 276건. 모든 모델/전체 SVG/쪽 정의/셀 격자/문단·문자 속성/반복 머리행/후행 본문 검사가 통과하고 정상 Quit·종료 코드 0이다.
- 병렬 기본 편집 72사례와 양쪽 긴 소유자의 이력 80사례다. 각 소유자 문단 0·23·46을 편집한다. 긴 왼쪽은 0·5·10쪽, 긴 오른쪽은 0·4·9쪽이며 짧은 오른쪽은 0·1·2쪽이다. Shift+Enter·forward Delete, Tab 셀 이동과 마지막 셀의 행 추가, 6단계 일반/빠른 연속 편집의 모든 중간 undo/redo를 포함한다. 연속 입력 중 마지막 셀의 Tab 행 추가는 명시적 커서 선택으로 실행하며 이력이나 문서를 재로드하지 않는다. Tab 문자 입력으로 세지 않는다.
- 그림 검사 468회/5548쪽: 숨김 0·부분 잘림 0·렌더러 오류 0. 최대 테두리는 본문 하단 안쪽 6.3200px, 글자는 안쪽 6.2999px다. 기존 2px 허용치를 유지하며 실제 제품 deferred pagination 완료 뒤 검사했다. snapshot 자원은 기존 bounded 계약을 유지한다.
- 파일별 독립 Native 비교: 새 실제 저장 276건 및 이전 532건 = 실제 808건 전부 전체 모델·SVG 일치, LAYOUT_OVERFLOW 0이다. 별도 API 경계 16건까지 총 824건이며 실제 초과 경고 네 건·제외 계약 두 건이 보존된다. API 파생 파일은 실제 앱 저장 건수에 더하지 않는다. 읽기 전용 snapshot 판정 17건과 혼합 제외 계약 8건도 통과한다.

## 증거 오류를 해결한 최종 실행

앞선 parallel-final-2는 152개 개별 PASS와 정상 앱 Quit 0 뒤 대형 manifest를 JSON.stringify 하다가 Node 문자열 한도의 RangeError를 냈다. 종료된 frame의 진단 호출도 detached Frame 오류를 냈다. 최종 proof가 없었으므로 그 실행은 전체 완료로 취급하지 않았다. raw 실패와 종료 기록을 그대로 보존했다.

QA 하네스는 manifest를 행별로 저장하고 앱 종료 후 frame 진단을 하지 않도록 고쳤다. 전체 152사례를 다시 실행한 parallel-final-3은 하네스 종료도 0이며 proof/manifest를 완전히 남겼다. manifest는 1,074,263,609바이트다. 별도 스트리밍 도구가 이를 저장 파일별 276개 증거로 나누고 각 전체 모델/SVG manifest와 실제 저장 파일의 SHA256·페이지 수·Native 일치 결과를 작은 index.json에 기록했다. 기존 실제 36건 manifest에서 분할 전후 모든 데이터와 해시가 일치하는 검사도 통과했다. 원본 대형 manifest와 이전 실패 기록은 변경하거나 삭제하지 않았다. 공개 proof는 해시·건수·요약을 담고 원본 내용이나 캐시는 포함하지 않는다.

WASM/실제 앱 수신 SHA256: `751a0bfa25867e117abb462e50db583ecc602f6ef8a5bfb94160f6e4b6564c0b`. Native SHA256: `d61fe9e8934b81d941ee0f2b2f151b9012fef3b6fdc3bb7fef611f6cb2cacaf3`. 이전 offline 빌드의 보존 아티팩트이며 현재 Rust 소스가 보존 체크포인트와 정확히 같다. 새 Rust 빌드나 패키징을 주장하지 않는다. 현재 UI 빌드, TypeScript·Node·Python 구문 및 diff 공백 검사도 통과했다. 기존 beta.3 ASAR `e94f2bfc1b0cb1911c358fe16e036935c7ad8514ee4923bff89555f05990e15e`와 PR9 SHA를 보존했고 새 앱·ZIP·태그·릴리스는 만들지 않았다.

## 재실행과 다음 구현

prepare-parallel-merged-table-fragments.mjs <새 seed 경로> <WASM pkg> <기존 split-before.hwp>로 7종 합성 매트릭스를 만든다. prepare-parallel-owner-history.mjs <그 seeds.json> <새 history 경로>로 이 묶음의 152사례를 선택한다. 기존 build-current 도구로 현재 UI와 위 엔진의 별도 QA runtime을 만든 뒤 GEULGYEOL_HOST_SEEDS=<history seeds.json> 환경에서 check-electron-stored-merged-fragments.mjs <QA 경로> <WASM pkg>를 실행한다. scripts/shard-electron-table-manifest.py <완성 manifest.json> <새 분할 경로> <Native 검사기>가 파일별 검증과 해시 인덱스를 만든다. raw 증거는 ../table-parallel-merged-fragments-qa의 parallel-final-3, shards-final-276/index.json, source-native-pairs 및 source-native-proof.json, 이전 baseline/checkpoint에 보존한다.

긴 혼합 rowspan의 소유자별 시작 행 offset·cut 관리가 다음 구현 대상이며 현재 미해결이다. 한컴 직접 저장 부분 프레임 원본 부재, 물리 IME·OS 선택창·수동 GUI·한컴 비교·Linux 미검증도 남는다. 전체 Rust lib 테스트는 기존 include_bytes 원본 세 개 누락으로 실행 불가다. 기존 beta.3 공개 보류를 유지하고 독립 검토된 새 제품 소스로 후보를 다시 검증해야 한다. 이 묶음의 완료를 전체 개발 중단으로 해석하지 않는다.
