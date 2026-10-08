# 중첩 행 API 타입·경계 검증

`243a1e1`에서 새로 추가한 중첩 행 API의 JS 인덱스 강제변환 결함을 수정했다. 기준 후보에서 `null`, `false`, 숫자 문자열, 배열, `valueOf` 객체를 section으로 전달하거나 문자열·boolean parent를 전달하면 숫자로 변환되어 **안쪽 표에 실제 행이 추가되는 7건**을 재현했다. `getNestedTableRowTarget`과 `editNestedTableRow`의 section/parent를 `JsValue`로 받아 원래 타입을 검사하고, 실제 JS Number인 경우에만 기존 유한·정수·u32 검사로 넘긴다. Native 행 편집 계약·삭제 허용 범위·제품 UI는 변경하지 않았다.

새 `--nested-row-boundary` Native 예제와 `check-nested-row-boundary.mjs`는 이전 왼쪽 열/2행 검사와 별도로 오른쪽 열·1행/3행·첫/마지막 행·빈 셀·다문단·비BMP/결합 문자/한글을 검사한다. 생존 셀의 좌표를 독립 계산하고 문단·직접 서식·스타일 정의·필드/제어·표 밖 문단을 비교한다. Mac 검사는 마지막 셀 문단과 Unicode scalar 끝 위치에서 실제 dispatcher/Bridge/InputHandler/CommandHistory를 실행한다. 이전 행 검사에는 이번 QA의 단일 Chrome 프로필을 재사용하는 환경 변수만 추가했다.

| 최종 후보 검사 | 결과 |
|---|---|
| 새 Native 경계 | 20사례, snapshot undo/redo 80쌍, HWP/HWPX 80재열기, 마지막 행/소유 참조 행 6원자 거절 |
| 새 실제 headed Mac Chrome | 20사례, 명령 undo/redo 80쌍, 80재열기·독립 Native 80. Unicode/다문단 커서와 경로 정확 복원, 모든 안쪽 셀 표시·부모 frame 포함 |
| 새 JS 타입·경로 거절 | 240 API/축/타입/fixture 조합 + 잘못된 path 200건 + 마지막/참조 행의 dispatch/direct 거절 16쌍 = 456원자 검사. 오래된 대상 24건. HWP/HWPX/SVG/커서/이력 무변경, 삭제 거절 뒤 pending redo 사용 가능 |
| 기존 중첩 행 | Native 24/96쌍/96재열기/170거절, Mac 24/28편집/112쌍/96재열기·Native독립96. 비지원 dispatch/direct 736거절, stale 60 |
| 일반 표 구조 | Native 24/96쌍/96재열기/23거절/no-op4, Mac 24/30편집/120쌍/96재열기·Native독립96, 281거절/no-op3 |
| Mac 정상 합계 | **68사례/78편집/312이력쌍/272저장재열기**, 독립 Native 재실행·저장물 전체 문단/참조/DocInfo/BinData/SVG 대조 **272** |
| 셀 링크 현재 WASM/UI adapter 회귀 | 84정상/288재열기/84이력쌍/444원자 거절·취소, layout12·multipage12, 독립 Native 저장물264. 이 항목은 DOM adapter 자동 검사이며 실제 Mac GUI 검사 수에 합산하지 않음 |
| 셀 수식 Native 회귀 | 72사례/288재열기/504snapshot동작/10거절 |
| 컴파일·정적 검사 | 최종 Native 예제3개/WASM release 빌드, 후보 DTS TypeScript, Clippy lib+예제3개 `-D warnings`, diff 검사 통과 |

잘못된 타입은 페이지 안에서 재구성한다: undefined/null/boolean/string/배열/valueOf 객체/boxed Number/BigInt/NaN/Infinity/음수/소수/overflow. edit에는 정상 숫자 좌표에서 방금 얻은 유효 토큰을 사용하므로 토큰 실패가 타입 오류를 대신 가리는 검사가 아니다. 비유한 값의 CDP JSON 전달 강제변환도 피한다. Mac 세 검사 모두 runtime WASM 해시 일치, pageerror0을 확인했다.

최종 소스 재빌드 후 WASM과 모든 bindgen 출력이 첫 검사 후보와 바이트 일치했다. SHA256: `3a9e736e1025bf3c9c72bda67e1d9ca4a1665bfb3e2f06b5ab172932bc7f1a86`. 별도 `../nested-row-boundary-qa/pkg` 및 동일 `pkg-final`이며 기존 앱에는 통합하지 않았다. 원시 실행 로그/fixture/저장물/스크린샷/manifest는 이 QA 디렉터리에, 집계는 [proof.json](proof.json)에 있다.

## 참조가 있는 행 삭제: 기존 거절 유지

새 3행 fixture의 가운데 행에는 이름 셀·하이퍼링크·수식2개가 있고, 표 밖 문단에는 그 이름을 Command로 가진 합성 CrossRef가 있다. 지원 API는 HWP/HWPX 두 fixture에서 이 행 삭제를 문서/이벤트/저장 바이트/SVG 무변경으로 거절했다.

별도 시험 문서에서 **비공개 모델 `Table.delete_row`만 우회 호출**하면 행 안 이름 바인딩은 사라지지만 표 밖 CrossRef의 ID/Command와 바깥 문단은 그대로 남는다. 이는 지원 API의 새 결함이 아니다. 이름 조회 전후와 저장된 CrossRef payload의 실제 근거이며, 합성 Command가 한컴의 모든 상호참조 문법을 재현하거나 실제 참조 해석을 검증했다는 뜻도 아니다. 행 밖 바이트를 보존하는 것만으로 삭제의 참조 안전 계약을 확정할 수 없으므로 이번에는 삭제 지원을 확대하지 않았다.

최소 다음 작업은 (1) 삭제 행 안에 완결된 링크 Field/FieldRange·수식만 있고 이름/공유 ID/행 밖 또는 다른 list의 참조/불명 Command가 없음을 문서 전체에서 증명하는 계약, (2) 살아남는 형제·바깥 문단·정의/BinData를 임의 삭제·재작성하지 않는 소유권 규칙, (3) 각 거절/지원 경계와 반복 이력·HWP/HWPX 재열기의 독립 대조를 마련하는 것이다. 해당 증명이 없으면 현재 거절을 유지한다.

## 보존·한계

보호된 **29,328파일 변경0/누락0**. 기존 target만 재사용했고 최고 **4.139GiB**로 한도4.5GiB를 지켰다. 모니터링 QA 최고 약157.54MiB/추가 한도1GiB, 실제 여유 최소 **16.449GiB**/하한15GiB. 모든 Chrome은 `browser.close()`로 정상 종료, 소스 서버 SIGTERM143, 소유 Chrome/서버0·32172포트 닫힘을 확인했다. 원본/이전 후보/앱/클립보드/권한을 보존했고 삭제·정리·새 target·앱/ZIP·릴리스·계정/인증서 변경은 하지 않았다. 이 수정은 로컬 커밋으로만 보관한다.

라이브러리 table unit test는 기존 `include_bytes!` 샘플 `engine/samples/3-09월_교육_통합_2022.hwp`, `engine/samples/hwp3-sample16-hwp5.hwp`, `engine/samples/hwpx/aift.hwpx` 누락으로 컴파일 실패했다. 샘플 대체·테스트 제외 없이 실패 로그를 보존했고 통과로 집계하지 않았다.

기존 형식 변환의 HWP metadata3 차이 및 HWP→HWPX fill/section 기본값 차이는 미해결이다. 기존 일반 표 검사에서는 기준 변환 차이를 기록하며, 독립 Native 저장물 대조와 메모리/이력은 별도 엄격 비교한다. 실제 Mac Chrome DOM/Canvas/명령 검사는 수행했지만 위치 설정은 DEV Cursor를 썼다. 물리 pointer/IME·설치 Electron/IPC/native 파일대화상자·OS 클립보드·Linux·한컴·큰 실제 문서/성능과 지원 밖 중첩 구조의 전체 인증은 이번에 수행하지 않았다.
