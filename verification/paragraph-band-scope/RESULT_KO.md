# 문단 띠 공식 의미 대조·진단 결과

공식 문단 띠는 **문단 너비100%·두께1mm·검정 채우기·선 없음인 문단 기준 사각형 개체**다. 문단 테두리/배경 API 연결로 같은 기능을 구현할 수 없어 이번에는 설계·재현만 진행했다. 기존 사각형/Para 너비 기준 모델은 있으므로 광범위 모델 신설이 필수라는 결론은 아니다. 공개 개체 API와 조판 폭 계산, 주석/필드 소유권까지 연결하는 별도 작업이 남았다. [한컴 Mac 설명](https://help.hancom.com/hoffice_mac/ko_kr/hwp/insert/line.htm), [설계/선택한 표현](DESIGN_KO.md).

제품 엔진/UI 및 WASM은 `658b8b2`/dev10과 같다. 새 코드는 진단용 Native 예제와 Node 검사이며 제품 기능을 바꾸지 않았다. 기존 `insert:para-band`는 disabled로 유지한다. 기본 앱·공개 beta.2·dev10 앱·이전 후보 보존, 패키징/공개/보안 권한 변경 없음.

| 검사 | 결과 |
|---|---|
| 실제 registry/dispatcher/menu | 일반 본문 선택에서 링크·검토 주석 활성, 문단 띠 비활성; dispatch disabled, 문서 전체 바이트/상태·이벤트 불변, 편집 호출0 |
| Native 진단 | 문단 테두리는 개체를 만들지 않음. 사각형 API가 너비 기준을 노출/변경하지 않음. 합성 Para 사각형 저장재열기6 |
| WASM 진단 | 저장재열기6·SVG/렌더 트리, 문단 테두리의 본문/필드/인접 문단 보존·snapshot undo 정확, API 저장본2 Native 독립 대조 |
| 조판 누락 | 양쪽 여백13.3/20.0px 적용에도 너비566.933px 유지. 위치는 이동하지만 문단 사용 폭으로 줄지 않음. Native/WASM·두 형식 일치 |
| 기존 주석 저작 회귀 | Native 재열기40, 실제 WASM/UI 변경14·재열기64·거절55·undo/redo각16 |
| 기존 본문 앵커 회귀 | 실제 WASM/UI 정상43·재열기168·거절36·undo/redo각43 |
| 저장물 독립 확인 | 주석/앵커 저장232개 Native 명령 재실행/참조 대조 |
| TypeScript / Clippy | 현 후보 DTS TS 검사, lib+진단 예제 Clippy `-D warnings` 통과 |

이는 새 문단 띠 삽입 명령의 이력/저작 성공이 아니다. 해당 명령은 미구현·disabled다. 직접 IR 지정은 저장 표현 검사이며 실제 한컴 원본 문단 띠 파일의 기본값·앵커 호환은 아직 확인하지 않았다. 실제 Mac GUI/물리 IME·Linux 실행 없음. 전체 library 단위 테스트는 이전 누락 include_bytes fixture3개 제한 때문에 재실행하지 않았고 대체/제외하지 않았다.

진단 작성 중 Native getter 이름, x 이동의 잘못된 가정, 입력 HWPUNIT와 조회 px 단위 혼동을 수정했다. 기존 회귀 스크립트가 입력 fixture 폴더에 manifest를 쓰는 동작으로 dev10 QA manifest2개가 잠시 교체됐고 원래 SHA256으로 복원했다. 이번 QA에 복사본/manifest를 보관하고 dev10 QA artifact314개 해시 전체 일치를 확인했다. 초기 컴파일/가정/manifest 경로 실패 로그는 최종 통과와 구분해 남겼다. 제품 수정으로 검사를 맞추지 않았다.

기존 제품 소스293+1,147개와 보호 경로17개(dev10 포함) 불변. target 최고/최종 약3.678GiB, 최소 여유 약21.820GiB, 추가 QA 약8MiB. 감시 중단0, 캐시 삭제/의존성 설치/새 WASM·앱 빌드 없음. Native 진단 예제 빌드로 target 약71MiB가 늘었다. 사용하지 않는 GUI 창을 열지 않았고 검사 프로세스들은 종료됐다.

정확한 수치·근거는 [proof](proof.json), [Native 진단](native-diagnostic.json), [UI 누락](ui-gap.json). 원시 로그·합성 저장물/SVG·재개 명령·backup patch는 `/Users/sw107/Documents/Codex/2026-10-06/task/paragraph-band-scope-qa/CHECKPOINT_KO.md`에 있다. 후속은 설계의 개체 API/조판/참조 계약을 확인하는 것이며 새 광범위 모델이나 다른 기능으로 대체하는 제안은 하지 않는다.
