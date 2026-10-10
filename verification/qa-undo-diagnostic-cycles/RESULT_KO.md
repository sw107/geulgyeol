# PR24 undo 차이 진단의 cycle 충돌 수정

PR24의 `5a2a639a7476280a340ca99ee3cb5bf948d37d89`에서 발견된 QA P2를 수정했다.
`check-electron-stored-edit-gaps.mjs`의 알려진 fallback 관찰 경로는 두 undo 모두
SVG 차이를 기록할 수 있으나, 진단명에 cycle이 없어 두 번째 immutable 쓰기가
EEXIST로 중단됐다. 제품 코드나 fallback 판정 자체는 변경하지 않았다.

이제 `undoSvgDiagnosticName(f.name,op.name,n)`을 사용한다. 같은 66행 HWPX Delete
조건의 진단은 `partial-row66-input.hwpx-direct-delete-0-undo0-svg-diff.json.gz`와
`partial-row66-input.hwpx-direct-delete-0-undo1-svg-diff.json.gz`로 따로 남는다.
같은 경로의 덮어쓰기 거절은 유지한다.

실제 helper를 사용하는 작은 synthetic 회귀 검사에서 두 반복 진단을 모두 쓰고
gzip 내용을 각각 확인했다. 첫 진단 경로에 다시 쓰는 시도는 EEXIST로 거절됐고,
첫 bytes는 유지됐다. 기존 settled/burst·cycle·undo/redo 여덟 이름 분리, 별도 실행
디렉터리 분리 및 기존 경로 충돌 거절도 통과했다. Node exit0이며 테스트 소스
전후 hash가 같다. 기존 synthetic을 삭제하거나 실제 원본 fixture를 가짜로 만들지 않았다.

다른 진단명도 확인했다. 저장 SVG 차이는 입력 fixture·입력 형식·연산·출력 형식으로
구분되며 출력 형식마다 한 번만 기록한다. Mixed 상태와 paint는 기존 새 operation
prefix 및 cycle/step을 포함한다. Failure/lifecycle은 fresh phase당 한 번이며 mutable
control 메시지 writer는 유지한다. 별도 `check-electron-excluded-linewrap-history.mjs`는
변경하지 않았고 SHA256 `798531af6161ed3d0911c0bdb8abf0561c20e9e0ee3f9928a836889234c80be1`을
유지한다. 이 수정이 전체 QA에 적용됐다고 주장하지 않는다.

이번에는 앱·Native·right mixed·제품 빌드를 실행하지 않았다. 원래 PR24의 성공 증거는
그 당시 소스로 실행된 right Delete 4쌍/8상태, Electron2흐름/4재열기, Native4건이다.
수정 뒤 같은 앱 검증을 다시 실행한 결과로 소급 표시하지 않았다. 기존 성공 phase와
공개 결과·pin index 등85파일, 과거 상태/manifest/process1920파일 해시가 유지됐다.
과거 proof·상태 파일을 덮거나 복원하지 않았다. PR23의 78 assertion 쌍 중 개별
남은 파일로 독립 대조 가능한 것은42쌍이라는 제한도 유지한다.

정상/실패 evidence 예산과 free floor를 유지했으며 상세 값은 proof.json에 기록했다.
Shared synthetic14,692,352B는 상한32,000,000B 안이다. 미완료 단계는 없다.
원본·기존 앱·beta.2·기존 dirty는 보존했고 캐시 정리·새 패키지·릴리스는 없다.
Rust unit의 기존 입력4개 누락 제한 및 기준 미판정인 기존 page12 형식 간 현상은
유지한다. 제품 수정과 right mixed 확장을 섞지 않았으며 PR24 재검토를 기다린다.
