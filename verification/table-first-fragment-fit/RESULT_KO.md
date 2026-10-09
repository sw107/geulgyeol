# 긴 셀 단일 치환 뒤 첫 fragment의 10.8px 초과 수정

기준 UI/정밀값·빈여백 수정 f2423db182555d7a73cf06974fbcfeb19067cd96, 원래 엔진 WASM 14c6978c7712faf84846c65619adc137bd923b17c3d47fd715544dc76fd1ec99. 부모 main은 PR #3 병합 3d00e9a20e51c84c49cd70a7e299e982e342392c다. 공개 beta.2와 이전 증거를 변경하지 않았다.

## 재현과 원인

48행 긴 셀의 첫 반복 머리행에서 ia 24쌍을 SINGLE🙂로 단일 치환한다. 첫 행 높이가 155.76→108.83px로 줄어든다. 저장 셀 선언 높이 1300 HWPUNIT ×48 = 표 전체 저장 높이 62400 HWPUNIT이다. 페이지네이터는 이 전체 객체 프레임을 저장된 첫 physical fragment 프레임으로 간주했고, 남은 프레임 여유를 더해 887.63px인 첫 6행을 본문 높이 876.83px에 수용했다.

실제 Mac Electron에서 첫 페이지 본문 하단은 1009.0933px, 테두리 하단 1019.8933px, 렌더러 글꼴의 글자 bbox 하단 1019.9135px였다. 첫 페이지에는 이를 가리는 clip도 없었다. 따라서 모델 소유권은 맞았지만 실제 테두리와 글자 경계가 하단을 넘는 결함이었다. Native도 10.8px LAYOUT_OVERFLOW를 출력했다. 예전 redo 결함이나 deferred pagination 중간 상태를 새 결함으로 취급하지 않았다.

## 변경

모든 저장 행 프레임을 덮는 전체 표 객체는 첫 fragment 저장 프레임 후보에서 제외한다. 기존 구조 판별 함수 table_declared_object_covers_cell_row_frames를 재사용한다. 셀 내부 줄 분할·렌더링·clip·문자열·진단을 변경하지 않고, 실제 부분 프레임을 가진 표의 기존 source-frame 경로를 유지한다. 문서명·행 수·특정 px 값을 조건으로 쓰지 않는다.

문제 치환 뒤 첫 조각이 863.63px의 줄 분할로 배치되어 테두리 하단 995.8933px, 글자 bbox 하단 987.0134px가 됐다. 마지막 부분 행의 나머지는 다음 조각에서 재개한다. 페이지 수는 편집 전 11→편집 후 10으로 유지했다.

## 실제 검증

Mac Electron 44.3.0에서 numbered 단일 긴 셀/48행 growth/48행 shrink, 각각 HWP/HWPX 입력을 사용했다. 첫·중간·끝 fragment 입력, 단일/전체 치환, 크기 무변경 확인, 높이 증가·감소의 총 44개 경우, undo/redo 76쌍, 실제 호스트 HWP/HWPX 저장·재열기 76회를 통과했다. 전체 SVG, 페이지 수, 모든 셀 문단/문자 스타일 ID, 본문, 반복 머리행, 후행 AFTER_TABLE_END 소유권을 비교했다. 저장 바이트 SHA는 현재 export와 일치했다.

편집 직후와 양형식 재열기 114회, 합계 690페이지를 실제 Electron DOM에 엔진 SVG로 그려 수직 글자 bbox·테두리·clip을 측정했다. 본문 경계 오차 상한은 기존 엔진 진단과 같은 2px다. 실제 전체 표 테두리 하단은 가장 가까운 경우에도 본문 안 0.28px, 글자 하단은 8.22px 안이었다. 수직 clip으로 숨겨지거나 1px 이상 잘린 글자는 0. 원시 텍스트와 clip 뒤 가시 텍스트 모두의 비공백 스칼라 개수가 모델과 정확히 일치했고, 반복 머리행/자동 번호만 의도된 반복으로 허용했다. 기존 deferred pagination pending→idle을 기다렸으며 테스트 전용 강제 flush를 추가하지 않았다.

같은 실제 저장 바이트 76개를 새 Native 엔진에서도 전체 SVG·페이지 수·모델·스타일로 독립 비교했고 모두 통과, LAYOUT_OVERFLOW 진단 0이다. 최종 renderer 오류 0, 정상 앱 종료 0, TypeScript와 git diff --check 통과. 초기 Native smoke는 기존 SVG를 기대값으로 사용해 수정된 분할과 의도적으로 불일치했으며, 그 로그는 재분할 근거로만 보존했다. 성공 판정은 최종 76개 비교다.

## 산출물·한계·다음 후보

새 WASM SHA: 84efddd2392e1f0faa6fade59ec642f21785b7cc05b07b59a0e3c42fe8a10b8b. 오프라인 Native와 release WASM을 기존 target에서 재빌드했다. 이전 source-owned 빌드 산출물을 삭제 없이 ../table-first-fragment-fit-qa/cache-checkpoint로 이동·보존했다. target 한도 4.48GiB(4,810,363,371bytes), Native peak 4,795,326,464bytes, WASM peak 4,763,365,376bytes로 자동 중단 한도 이내였다. 최종 추가 249,856bytes. 설치·패키징·릴리스·권한 우회·영구 삭제는 하지 않았다. 최종 UI는 앞선 targeted 자산 16개를 그대로 재사용했다.

로컬 증거 ../table-first-fragment-fit-qa/baseline, targeted, final, native-final와 build-proof를 보존하고 공개 proof.json에는 SHA와 검증 요약만 담았다. 개인 원본/바이너리·대용량 캐시를 커밋하지 않았다.

수직 overflow의 좁은 수정이며 전체 단위 테스트/한컴 원본 비교를 대신하지 않는다. 전체 Rust test는 누락된 기존 fixtures 때문에 실행하지 않았으며 새 Native example 비교와 실제 Electron으로 검증했다. OS 파일 선택창, 물리 IME, 수동 GUI, Linux, 한컴 교차검증은 하지 않았다. 실제 부분 저장 프레임의 기존 허용 정책은 그대로여서 모든 문서의 모든 overflow를 제거했다고 주장하지 않는다. 다음 좁은 후보는 편집 전부터 존재한 host 본문보존과 첫 머리행의 겹침이다. 그 원인과 첫 fragment의 host 높이 회계를 분리 재현해 검토해야 한다.
