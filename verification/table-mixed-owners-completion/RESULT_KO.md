# 완료된 혼합 owner cut의 빈 꼬리 제거

PR12의 `b36479267b53440112af6364e3ba082936d98ced` 뒤에 적용하는 독립 검토 P2/P3 후속이다. 이전 커밋·250사례 검증문서·원시 로그·앱·빌드 산출물을 그대로 보존했다. 병합·후보 채택·릴리스는 하지 않았다.

## 실제 재현과 수정

`scan_block_table_split_rows`의 full-fit은 `full_height <= budget`을 검사하지만 unit cut은 기존 0.1px 허용치를 적용한다. 마지막 잔여 높이가 예산보다 조금 크면 모든 owner를 소비한 cut에도 양수 split_end_limit을 남겨 다음 쪽에 빈 표 꼬리를 만든다. 블록 start cut 경로는 기존 작은 빈 행 꼬리 제거의 대상도 아니다.

검증된 48×2 합성 mixed-large-left에서 cell 2의 47개 문단을 한 긴 문단으로 바꾸고 페이지 하단 여백만 조정해 실제로 재현했다. 사용자 원본은 사용·변경하지 않았다. 잔여 699.76px / 예산 699.746666667px인 입력에서 이전 Native와 실제 Mac Electron 모두 0부터 10쪽에 머리행만 남는 표 조각을 만들었다. 수정 후 표는 0~9쪽에서 끝난다. 반복 머리행 셀 인스턴스는 22→20, 후행 본문 시작은 같은 10쪽의 y=298→132.3px로 복구됐다. 본문 텍스트 순서와 전체 셀 owner 문단은 같다.

모든 owner를 소비한 cut이면 물리 높이를 한 번 소비하고 row cursor를 mixed_end로 이동한다. split_end_limit·end cut·새 continuation 표시는 남기지 않는다. 미완료 cut 분기, 기존 0.1px capacity epsilon, 2px 물리 본문 검사 허용치는 유지한다. 정확한 Native 잔여/예산 및 fully_consumed 진단은 환경변수를 지정했을 때만 출력한다.

## 경계와 회귀 결과

HWP 단위는 정수이므로 정확한 ±0.1px는 표현할 수 없다. 잔여−예산을 `−10/75, −8/75, −7/75, −1/75, 0, +1/75, +7/75, +8/75, +10/75`px로 조정했다. ±0.0933333px와 ±0.1066667px가 0.1px 경계를 양쪽에서 감싼다.

- 독립 Native 양형식 18입력, 이전·수정 엔진 각 18실행: +0.0133333/+0.0933333px의 이전 빈 꼬리만 제거된다. +0.1066667/+0.1333333px에는 본문을 담은 필요한 추가 fragment와 머리행이 유지된다. 모든 owner 문단/순서, cut 연결, 후행 본문 텍스트 해시, 머리행 수와 위치를 검사했고 LAYOUT_OVERFLOW는 0이다.
- 이전 실제 Mac Electron 재현 4사례: 두 양수 경계 × HWP/HWPX. 빈 표 꼬리가 실제 renderer에 있는 원시 initial state/paint 증거를 보존했다. 이 실행은 비교 baseline이며 저장·재열기 0회다.
- 수정 실제 Mac Electron 경계 18사례: 빈 조각·머리행 추가·후행 본문 이동을 검사하고 실제 IPC HWP/HWPX 저장·재열기 36회를 완료했다. no-op 셀 크기 확인은 새 이력을 만들지 않는다.
- 수정 실제 Mac Electron 혼합 owner 회귀 48사례: 세 원본의 첫·중간·끝 fragment 입력, 네 긴 owner와 마지막 독립 행의 **실제 끝 caret** 입력, 각 긴 owner 마지막 문단의 Shift+Enter/forward Delete. undo/redo 96쌍, 양형식 저장·재열기 96회가 통과했다. 원본 쪽 정의·격자·본문·문단/문자 속성·스타일·bounded snapshot·전체 SVG를 확인했다.
- 수정 앱 합계 **66사례 / undo·redo 96쌍 / 실제 저장·재열기 132회**. 그림 검사 230회/2576쪽, 숨김·부분 잘림·렌더러 오류 0. 최대 테두리 초과 +0.0933333px는 기존 cut 허용치 안이며, 실제 글자 경계는 본문 하단 안쪽 0.786586px다.
- 실제 저장 132파일 전부 독립 Native에서 전체 SVG·쪽 수/정의·전체 본문/셀 문단 및 문자 속성·스타일이 정확히 일치했고 LAYOUT_OVERFLOW 0이다. 위의 Native API 비교 18쌍을 실제 앱 저장 수에 더하지 않는다.

세 완료 앱 실행 각각 외부 Python wrapper가 받은 Node 종료 0, Electron 원시 lifecycle 종료 0과 normalQuit=true를 독립적으로 기록했다. 이전 중단 실행이나 이번 탐색 입력을 완료 건수로 집계하지 않는다. 마지막 조각 편집의 과거 redo 수정은 이번에 새 결함으로 보고하지 않는다.

최종 WASM 및 실제 앱 수신 SHA256: `e9cdd0cd9b2bb4c2205ae674305d19748ae6651a75da759f672b2233030d42f7`.
Native 저장 검사기 SHA256: `369fa9dc076cb2826c443f8e8902f24bb44d771391d295eea0181711dfe8eade`.
최종 offline Native/WASM 빌드 종료는 각각 0이다. 초기 수정 빌드도 통과했으며 후속 환경변수 진단 추가 뒤 다시 빌드했다. 두 빌드의 산출물·로그를 삭제 없이 보존했다. 최종 target 4764393472바이트는 4810363371바이트 제한 안이다. Python/Node 구문과 diff 공백 검사를 통과했다.

## P3와 공간·증거 보존

`run-electron-table-qa.py`는 앞으로 실행 전에 wrapper·실제 실행 MJS·task bootstrap·seed 해시를 기록하고, 종료 후 독립적으로 다시 읽어 각각 저장한다. 새 세 실행은 모두 전후 해시가 동일하다. 기존 호환 필드 qaSourceSHA256은 여전히 종료 후 값이며, 새 Before/After 필드를 함께 읽어야 한다.

PR12의 기존 첫 두 완료 실행(geometry-3/full-3) 해시는 `a9f4f0f37acd4d0e3828f43a0ffd3d1dadb56d80424b3170e0eec7bd1edb7030`, 나머지 다섯 실행 해시는 `05a77d36b26af2e30be1a8e890022b65df67859eb2f19dbb4792cc147654b119`다. 그 기록은 종료 후 해시만 있으므로 실행 중 파일 불변을 소급 증명하지 않는다. 이전 원시 파일과 해시 차이를 그대로 proof에 남겼다.

새 Native 비교의 `--scratch` 모드는 원본 전체 manifest를 보존하고 자신의 비정본 scratch 한 파일을 순서대로 재사용한다. 각 record의 JSON 해시·실제 저장 파일 해시·Native 정상 종료·개별 log/proof 및 원본 manifest 전체 해시를 인덱스에 남긴다. 기존 기본 retained-shards 모드는 유지한다. 원본 472815978바이트의 SVG manifest를 한 벌 더 복제하지 않으므로 검증 범위를 줄이지 않고 공간을 아낀다. scratch 마지막 파일만으로 전체 증거를 대신하지 않는다.

집계 시 free 16432893952바이트, 15GiB 하한까지 약 312MiB이며 후보 빌드의 256MiB reserve를 적용하면 약 56MiB만 쓸 수 있다. 별도 앱 복사본은 기존 후보 기준 약 336MiB라 하한을 지키며 만들 수 없다. 앱·이전 QA·빌드 캐시를 임의 삭제하지 않았다. read-only ps 호출도 접근 거절되어 재시도·우회하지 않았고 검증에 사용하지 않았다.

기존 PR9 beta.3 ASAR `e94f2bfc1b0cb1911c358fe16e036935c7ad8514ee4923bff89555f05990e15e`와 새 누적 후보의 이전 엔진 ASAR `f67a7795978e0bdf7f2c28f217e076c60026a197b9d8fdd6fd77bdd3ac0e22a3`가 그대로다. 새 후보 product SHA는 `c74d71b7c356303392d26e06cbb3d0196ff0b9d8`이며 후보 QA 도구 체크포인트 `2afbdf6`도 별도 브랜치에 보존했다. 이 후보는 **수정 전 WASM 6f98907...을 담고 있어 계속 채택 보류**다. 이번 수정은 공식 Mac Electron의 source-QA runtime에서 검증했으며 새 signed candidate에 대한 재검증으로 주장하지 않는다. ZIP·태그·릴리스·병합은 없다.

## 재실행과 다음 묶음

원시 기록은 `../table-mixed-owner-completion-qa`의 baseline-app, boundary-app, regression-app, native-boundary-final 및 native-saved-*/index.json에 있다. 공개 proof는 원본·전체 SVG·캐시 대신 소스/엔진/원시 기록의 해시와 건수·소유권/배치 비교를 담는다.

1. `prepare-mixed-owner-completion.mjs <이전 WASM pkg> <검증된 mixed-large-left.hwp> <새 seed 경로>`가 같은 9경계·양형식 입력을 만든다.
2. `check-mixed-owner-completion.py <seeds.json> <수정 Native probe> <이전 Native probe> <새 출력>`이 독립 비교한다. 환경변수 진단이 있는 최종 Native를 사용한다.
3. `build-electron-table-qa.mjs <QA root> <새 phase> <최종 WASM pkg>` 뒤 `run-electron-table-qa.py <phase> <pkg> <seeds.json> all`로 실제 Mac을 검사한다. 이전 baseline은 over-1/over-7만 선택하고 baseline 인자를 붙였다.
4. 혼합 회귀는 prepare-mixed-owner-history의 7그룹에서 원본 세 그룹의 input-0/1/2+각 fragment-tail, 네 history owner의 shift-enter-2/direct-delete-2를 선택한 48사례다.
5. `shard-electron-table-manifest.py <manifest.json> <새 출력> <Native 저장 검사기> --scratch`가 모든 실제 저장을 대조한다.

부모의 PR12 후속 SHA 독립 검토가 다음 선행 조건이다. 이어서 확보 가능한 공간을 먼저 확인하고 수정 엔진을 담은 새 경로의 누적 beta 후보를 만들며, 실제 signed 앱의 최신 표/Shift+Enter/Delete/혼합 owner와 저장 실패·취소·late edit·종료·복구·pruning, bundle/서명/소스 정합성을 검증한다. 이전 앱을 덮어쓰거나 증거를 삭제하지 않는다.

그 다음 구현 후보는 3열·colspan의 owner 행/열 범위 및 단일 cover 제약 확장이다. 먼저 합성 owner/끝 경계와 Native 순서·본문 예산 증거를 마련하고, 현재 좁은 계약을 넓히기 전에 양형식 실제 Mac 편집 이력을 검증한다. 물리 IME·OS 선택창·수동 GUI·한컴 비교·Linux와 복잡한 머리행 rowspan은 미검증이다. 전체 Rust lib suite는 기존 include_bytes 원본 세 개 누락으로 실행 불가이며 통과를 주장하지 않는다. 이 후속 완료를 전체 개발 중단으로 해석하지 않는다.
