# 기존 HWP5 메모 저장 보존

기준 로컬 커밋: `7021531`의 저장 결함 재현과 [최소 설계](../review-comment-storage/DESIGN_KO.md).
이번 단계는 기존 메모가 있는 문서의 읽기·본문 편집·저장을 보존한다. 새 검토 주석 추가·내용 편집·삭제 API와 UI는 연결하지 않았다. 별도 엔진 후보만 만들었고 dev9 앱·원본 문서·기본 앱·기존 후보·공개 beta.2는 보존했다.

## 구현 범위

- Section에 원본 메모 꼬리 바이트와 파싱한 목록·소유 상태를 기록하고, Field에 원본 제어 레코드·begin/end 표식을 기록한다. 이 값들도 raw provenance에 포함한다.
- 문서 전체에서 필드 ID, command의 메모 index, 표식, 꼬리 index가 유일하게 일치할 때만 기존 Memo 본문으로 연결한다. 접두어만으로 Unknown 전체를 Memo로 바꾸지 않는다. 마지막 구역에 꼬리가 있는 복수 구역도 연결한다.
- 본문 수정 후 HWP 저장은 원본 꼬리 바이트와 제어 레코드 payload를 다시 쓴다. 인접 메모 끝은 half-open으로 처리해 경계 타이핑이 두 범위를 교차시키지 않게 했다. 다른 필드 종류의 기존 경계 동작은 유지한다.
- HWPX 변환은 확인한 단순 메모 목록·본문·명시적 command metadata만 허용한다. 원본 작성자를 그대로 투영하며 작성 시각을 새로 추정하지 않는다. 미해석 시각/자식 레코드·고아/중복 index·손상된 UTF-16·불명 metadata는 HWP에 보존하고 HWPX 변환은 거절한다. 표식/소유/내용 seal이 바뀌거나 원본 꼬리를 안전하게 재출력할 수 없으면 HWP도 거절한다.
- 기존 HWPX의 명시적 생성 시각 등 command로 재구성하지 못하는 parameters는 HWPX에 보존하고 HWP 변환을 거절한다. 저장 거절은 문서·이력·이벤트를 바꾸지 않는다.

이 구조는 본문 편집 중 메모의 원본 저장물을 보존하는 최소 표현이다. 메모 내용이나 metadata 자체를 편집 가능한 대상으로 확장하지 않았다. 메모 내부 제어, 비본문 소유자, 불명 컨테이너 등은 보수적으로 원본 보존/거절한다.

## 검증

합성·허용된 이전 재현 fixture만 사용했다. 한글·이모지·BMP 밖 문자, 메모 두 개와 각 두 문단, 인접 링크·각주, 직접 글자 서식·문단/스타일 참조를 대조한다. Native는 실제 HWP/HWPX reader로 다시 읽고 원본 꼬리·제어 payload와 내용을 확인한다. WASM은 실제 엔진의 본문 입력·snapshot undo/redo·exportWithReport를 실행하고 저장물을 다시 Native로 읽어 독립 대조한다. content-loss count만으로 성공을 판정하지 않는다.

Native 메모 재열기 32건, 실제 WASM 문서 16종의 저장재열기 37건·원자 거절 27건·본문 snapshot undo/redo 각16건을 통과했다. WASM 저장물 37개를 Native로 독립 재열기해 메모 내용·범위·metadata·각주·서식 참조와 원본 꼬리/제어 payload를 대조했다. 본문 링크 재열기22·셀 링크288·누름틀54, 값 교체 정상10/비지원18의 기존 회귀, 실제 비활성 주석 dispatcher192건, TypeScript·Clippy도 확인했다. 링크 저장물22+264개를 Native로 독립 대조했다. 기존 테스트 초기화21곳에 새 내부 필드의 None 기본값만 추가했으며 전체 단위 테스트의 차단은 기존 fixture3개뿐이다.

최종 검사 수치·새 WASM 해시·자원·보존 해시는 [proof.json](proof.json)에 기록한다. 자동 검사 로그와 합성 저장물은 작업 루트의 `memo-preservation-qa`에 있다.

## 한계와 다음 확인

Mac arm64 Native/WASM 자동 검사다. 실제 Mac GUI·물리 IME·한컴 GUI 호환성·전체 문서 corpus·이번 Linux 실행은 확인하지 않았다. 새 앱 패키징·실행·서명·공개 push/release·보안/계정/권한 변경 없음. 기존 library 전체 단위 테스트는 원래 빠진 include_bytes fixture 3개 때문에 컴파일할 수 없으며 대체 파일/검사 제외로 우회하지 않았다.

다음 확인은 허용된 실제 HWP 메모 corpus와 한컴 GUI 대조다. 새 주석 저작 API/UI는 별도 후속 범위로 남는다. 이번 snapshot 검증은 본문 편집의 undo/redo이며, 아직 없는 주석 command의 undo/redo 성공을 뜻하지 않는다.
