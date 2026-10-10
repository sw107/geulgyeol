# 부분높이 단일 colSpan=2 rectangle 검증

세 열의 비병합 반복 머리행 아래 단일 두 열 rectangle이 본문의 일부만 차지하는
배치를 기존 bounded mixed-owner 경로로 처리한다. 첫·중간·끝에서 편집하고 다시
열어도 fragment, 원본 서식, 반복 머리행과 후행 본문을 보존한다.

## 변경 범위
float_placement의 full-body 전용 조건을 제거하되 원본 raw grid의 단일 cover,
정확한 stored track 폭, 단일 rectangle, table 최대 65행, owner block 최대 64행,
기존 BLOCK_UNIT_MAX_ROWS 초과 조건을 유지한다. page-top/RowBreak/TopAndBottom,
반복 머리행, 비중첩 plain paragraph, 가로쓰기·기본 줄바꿈 조건을 벗어나면 제외한다.
multiple rectangle·caption·local width override·gap/overlap 등은 확장하지 않는다.

mergedCellNeedsTextSnapshot은 이 검증된 table의 모든 body cell에 기존 source
snapshot history를 적용한다. partial block 밖 일반 셀에도 이전 track 폭의 stored
줄 배치가 남을 수 있어 inverse typing만으로는 원본 화면을 복원할 수 없기 때문이다.
머리행은 이 추가 history 대상에 포함하지 않는다. layout 자체의 owner block은
기존 연결 range를 그대로 사용한다.

기존 private fixture/scope/caret 파일은 보존하고 successor 검사를 추가했다.
cell API가 노출하지 않는 lineWrap 변형은 실제 HWPX SQUEEZE 속성을 만들어 재열기
후 export에서도 확인한다. 이전 scope에서 제외됐던 partial-body-rectangle 하나만
positive로 승격하며 다른 제외 조건은 유지한다.

## 실제 검증
48행 synthetic fixture 5종(중간/상단/하단 및 양쪽 unequal tracks), HWP/HWPX 입력을 사용했다.

- 실제 Mac Electron 44.3.0: 44개 작업, undo/redo pair 88개, 양형식 저장·재열기 88개
- 첫·중간·끝 fragment 및 각 긴 owner의 fragment tail 편집
- 고정 Native 저장 비교 88개: full SVG·page count·body·cell/paragraph·character ID·style exact
- Native source 10개, rounded paint width 확인 1,302개, ownership 문제·overflow 경고 0개
- Native TextRun + SVG painted-baseline 좌표: 30개 문서·12,690개 query
  최대 x 0.10px, y 0.047px, 높이 0.034px (허용 0.11px)
- physical paint 142회·1,868페이지: border/ink overflow 0, hidden 0, partial 0
- 새 scope: positive 10 / excluded 62 / read-only 72, source 파일 10개 불변
- 기존 scope successor: positive 12 / excluded 56 / read-only 68
- Node harness·앱 exit 0, 정상 종료, 받은 engine hash가 고정 WASM과 일치
- 컴파일 source 4개, 실행 runtime, Native와 manifest의 전후 hash 일치
- 기존 보호파일 22개·과거 proof 23개 불변

WASM: 444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988
Native: 1801e456363aa79de62e96f60d846a30d8d37251e0bfef72bb2a2dff686ad250
소스 runtime: b7eb305b39bafd720dab6a0911c75771a36bd1c364e6f48a96f4019d08c9c2dd
Electron host executable: 588478afc5f2bc73b6433d6e565a214dc830144be39a3d79805723292754ccd8

새 앱 패키지를 만들지 않고 기존 Electron host와 동일 UI asset의 hardlink를 재사용했다.
소스 runtime hash는 일반 runtime 파일의 상대 경로/hash map에 대한 digest이며,
새 signed/packaged app archive의 hash로 주장하지 않는다.

## 제외한 시도와 예산
첫 후보는 26개 작업 뒤 unequal-left의 마지막 일반 셀 undo에서 stored wrap 차이를
보였다. 위 source history 보완 후 이 한 사례가 먼저 2 pair·2 reopen·Native 2개를
통과했으며, 이후 전체 44개 묶음을 다시 통과했다. 이전 PR15 엔진 비교는 이 unsupported
fixture의 fragment/ownership 단계에서 먼저 중단되어 새 회귀의 근거로 사용하지 않았다.
이미 수정된 과거 redo 결함을 새 결함으로 보고하지 않는다.

과거 lineWrap getter 단정 실패, 첫 후보 및 baseline 진단, 의도된 partial 승격을
모르는 기존 scope의 실패는 모두 보존하며 최종 성공 묶음으로 대체하지 않았다.
사용자 원본·기존 앱·공개 beta.2·BaramDesktop/node_modules를 변경하지 않았다.
추가 정리·릴리스·새 zip은 실행하지 않았다.

같은 전체-run root에서 정상 증거 약 229MB / 실패 증거 약 94MB로
768MiB / 256MiB 제한 안이다. 두 빌드의 target 최대는 약 4.915GB,
제한 5.079GB, 최소 관측 free는 약 44.94GB로 안전하한 16.375GB 이상이었다.
상세 해시·예산·실행 집계는 proof.json에 기록했다. SVG·원본·profile/cache는 공개하지 않는다.

저장 manifest는 승인된 streaming writer/독립 계획을 사용했다. Native wrapper/producer의
도구 검토 SHA는 c3f77fe51a3ce114acd7c008e850355fc3ba8c1e이며 PR17 독립 검토는 별도다.
이 제품 실행 성공을 PR17 병합 승인으로 취급하지 않는다.

OS native chooser는 QA response로 통제했다. 물리 IME·수동 GUI·새 packaged candidate·
Linux·CI는 검증 범위에 포함하지 않는다. 다음 후보는 Native metadata consumer를
통합해 compatibility hardlink를 없애고, 독립 검토 후 다음 제한된 table shape를 선정하는 것이다.
