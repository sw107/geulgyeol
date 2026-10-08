# 표 분할 원자성 및 행·열 편집 검증

기준 소스는 `b49f417`이다. 링크·수식·직접 서식의 병합 보존을 유지하면서 **셀 분할의 범위 검사와 실패 시 전체 원상 보존**을 수정했다. 후보는 `/Users/sw107/Documents/Codex/2026-10-06/task/table-structure-qa/pkg`, WASM SHA256 `92d6614e5ff0a3ebac84859857086d59ccdbd38d37852e696f3f2bba0f939d4b`이다. 기존 앱에는 미통합이며 새 앱/ZIP·공개 push/release는 하지 않았다.

## 재현과 수정

기존 2×2 표에서 범위 끝 열2를 지정해도 분할이 성공해 2×4로 바뀌었다. 병합 셀의 절반만 포함한 범위도 주변 셀을 분할했고, `mergeFirst`는 병합 해제 후 행 수 초과 오류를 반환하면서 변경을 남겼다. 정수가 아닌 행 좌표·65536 좌표·필수 키가 빠진 options도 다른 유효한 대상에 잘린 채 적용됐다. 원시 근거는 QA의 `baseline-geometry-proof.json`, `numeric-baseline-proof.json`이다.

분할 범위의 역순/표 밖/병합 일부 겹침과 단일 셀의 실제 anchor·span을 먼저 검증한다. `mergeFirst`의 두 단계와 다중 셀 범위는 Table 복제본에서 모두 성공한 뒤 반영한다. 일반 단일 분할은 기존 사전 검사를 유지한다. 행·열 및 분할 WASM API는 f64 정수/범위 검증을 공유하며, 분할 Ex는 필수 좌표/분할 수·옵션 타입을 엄격하게 읽는다. 유효한 1×1은 dirty·조판·이벤트를 만들지 않고 UI도 빈 snapshot 이력을 남기지 않아 대기 redo가 유지된다. 기존 `mergeFirst`의 정상 분할 방식은 변경하지 않았다.

## 결과

| 검사 | 통과 결과 |
|---|---|
| Native 혼합 표 | HWP/HWPX 원본24사례·30편집, 전체 Document/화면 snapshot96쌍, 두 형식 저장재열기96, 내용 손실 보고0 |
| Native 오류·no-op | 범위/병합 경계/단일 anchor/0값/병합 해제 후 초과/여러 셀의 늦은 실패23건 원자 거절, 정상 no-op4건 무변경. 문서·SVG·이벤트·HWP/HWPX 바이트 비교 |
| 실제 Mac Chrome 소스 UI | headed Chrome24사례·30편집, 실제 CommandHistory undo/redo120쌍(사례 전체96왕복), 저장재열기96. 잘못된 입력281건 및 정상 no-op3건에서 바이트/전체 SVG/history와 대기 redo 보존 |
| 독립 Native 대조 | Mac 저장 파일96개를 Native에서 명령 재실행 후 재직렬화/재파싱한 결과와 비교. 전체 문단·제어/필드 소유·typed DocInfo·BinData·전체 SVG 일치 |
| 기존 셀 링크 회귀 | 정상84·재열기288·undo/redo84쌍·원자 거절444·layout12·multipage12, 독립 Native 저장물264 |
| 기존 셀 수식 회귀 | 72사례·재열기288·snapshot 동작504·원자 거절10 |
| 빌드/정적 검사 | 현재 소스 WASM release, 후보 DTS를 사용한 TypeScript, Clippy(lib/기존 검증 example3개) 경고0, git diff 검사 통과 |

병합 내부 행·열 삽입, 병합 anchor 행·열 삭제, 삽입 행·열 재삭제, 병합 해제, 2×2/1×3 분할, mergeFirst와 완전히 포함한 범위/다중 셀 분할을 검사했다. 합성 표에는 혼합 서식 문단8개, 링크, 수식2개, 이름 셀, 인접 본문 책갈피가 함께 있다. 커서는 DEV API로 배치했고 실제 dispatcher/분할 대화상자/InputHandler/Bridge/키보드 history 경로를 사용했다. 내부 행·열 삭제와 단순 병합 해제는 실제 snapshot/Bridge 경로로 실행했다. 화면 근거는 QA의 `current-source-browser.png`이며 실제 브라우저가 받은 WASM 해시는 후보와 일치한다.

## 형식 변환 기준과 한계

HWP 원본을 편집 없이 HWPX로 저장해도 문단 fillType/pattern 기본값과 SectionDef의 일부 기본/packed 속성이 달라진다. 먼저 같은 형식의 저장 기준을 만들고, 표 편집 밖 소유 정보와 DocInfo를 그 기준에 대조했다. 브라우저는 기준에서 확인된 서식 속성 객체만 대응시키며, 표 구조·본문/셀 텍스트·필드/수식·전체 SVG는 그대로 비교한다. 이번 표 편집으로 추가 손실이 없다는 검사이며 전체 corpus의 형식 변환 무손실 인증은 아니다. 관련 기준 파일4개와 상세 값은 `browser-proof.json`에 남겼다.

전체 `cargo test -p rhwp --lib`는 기존 누락 샘플3개(`3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`)의 include_bytes에서 컴파일이 막힌다. 샘플 대체/테스트 제외로 우회하지 않았다. 추가한 model 단위 검사는 저장소에 남겼고 같은 원자성 조건을 컴파일·실행 가능한 Native 검사에서도 확인했다.

실제 Mac 설치 Electron 호스트/파일 대화상자, 물리 IME/마우스 좌표 선택, OS 클립보드, 한컴 대조, Linux와 중첩 표 자체의 전체 구조 편집은 미검증이다. 과거 Mac UI 검사에서 남은 HWP metadata 차이3건도 이번에 해결했다고 주장하지 않는다. 다음 확인은 별도 후보 앱 통합 후 해당 host/실입력 경로 및 실제 문서의 복합 병합 경계를 대조하는 것이다.

## 보존과 자원

보호 파일24,789개 해시가 모두 같고 누락0이다. 원본 문서·기본 앱·기존 후보·공개 beta.2를 보존했다. 새 target·수동 캐시 삭제·권한/계정/인증서/원격 설정 변경은 없다. 브라우저는 정상 close됐고 전용 서버는 SIGTERM(exit143)으로 종료했으며 잔류 프로세스0/포트32169 닫힘을 확인했다.

전체 시도에서 target 최고4.183GiB(상한4.5), 추가 QA 최고85.80MiB(상한1GiB), 실제 여유 최소18.883GiB(하한15)를 지켰다. 최종 target4.040GiB·QA68.02MiB·실제 여유19.150GiB. [집계 근거](proof.json).
