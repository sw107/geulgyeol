# 정식 ClickHere 검증기의 현재 채우기 의미

scripts/check-clickhere-preservation.mjs의 field-free HWPX 재열기 검사는 기본 채우기 조회가 반드시 달라져야 한다고 단언했다. 7bc60dd의 투명 채우기 getter 수정 이후 실제 차이는0이다. 원본 경로의 단언을 차이0으로 고치고, 결과 설명도 정규화 차이를 허용하지 않는다고 명시했다. 제품 엔진/API/UI/desktop은 변경하지 않았다.

이전 검사는 fillType/patternColor/patternType 차이가 하나 이상 있어야 통과하고 다른 차이는 거절했다. 현재 검사는 재귀 비교의 모든 차이를 거절한다. 비교 키나 서식/참조 필드를 삭제하지 않았고 허용값을 늘리지 않았다. 필드 ID 유일성, 값/anchor 일치, 본문 모든 문단/글자/문단 속성, control owner, 같은 문단 각주 위치/내용, contentLoss0의 HWP/HWPX 저장 재열기, snapshot undo/redo와 비지원 편집 거절은 그대로다. proof의 기존 fixtureNormalization 키는 기록 호환성을 위해 유지하되 differences는 빈 배열만 허용한다.

원본 스크립트를 CLICKHERE_EXPECT_PRESERVED=1과 현재 WASM에서 실행해 54재열기/undo24/redo24/거절14를 통과했다. 독립된 QA 파생본에서 채우기 조회 변형, 본문 첫 문자 손실, control 소유 문단 이동을 각각 주입하자 세 경우 모두 새 엄격 단언에서 exit1로 거절됐다. 원본 성공을 진단본 성공으로 대체하지 않았다. 과거 실패와 진단 결과는 보존했다.

같은 최종 검증 소스의 통합 suite24/24, desktop36pass/0fail/기존 선택적 layout fixture1skip/0TODO, TypeScript noEmit·Node 구문·git diff --check가 통과했다. engine/UI/desktop 제품1191파일과 후보 WASM e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45는 bf1f7db 검증 때와 동일하다. 이전 실제 Chrome/Native/Vite/Clippy 결과는 이 hash 대응으로 재사용한다. 전체 lib 단위 테스트·최신 설치 앱·물리 IME·OS 저장 대화상자·Linux의 성공을 새로 주장하지 않는다.

QA는 ../table-size-qa/merge-final-qa다. 부모 검토용 최종 SHA·post-commit 재검사·보호/공간 감사와 PR 병합 차단 판정은 그 폴더에 별도로 기록한다. 새 앱/ZIP/target·삭제 정리·추가 push/PR update/merge/release·계정/보안/권한 변경은 없다.
