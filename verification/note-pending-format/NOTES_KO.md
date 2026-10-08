# 구현·검증 기록

checkout `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, 기준 `0185924102f63d8f5795ab68cd828407669beef1`. 원시 기준 소스·입력/저장물·빌드/검사 로그는 인접 `../note-pending-format-qa`에 보존한다. 로컬 변경이며 공개 push/release·새 앱 제작은 없다.

## 변경

`InputHandler`에 본문 예약과 분리된 note 예약을 추가했다. 빈 범위에 기존 `applyCharFormatInFootnote`를 호출해 속성/참조를 검사하며, 아직 입력하지 않은 글꼴/모양 정의를 만들지 않는다. 글자 모양 대화상자도 note 캐럿을 저장한 대상으로 받아 예약한다. 예약 값은 getter에 반영하여 토글·크기·장평/자간 증감이 이어진다.

실제 note onInput에서 입력과 새 글자의 정밀 범위 서식을 `SubmodeSelectionSnapshotCommand` 한 건으로 실행한다. 기존 글자 run·문단 모양/스타일·노트 번호·본문/이웃 노트는 그대로 둔다. 입력 후에만 예약 앵커를 연장한다. CursorState의 note 좌표/선택/모드 revision으로 실제 이동·선택/해제·편집 영역 전환을 감지하며 undo/redo는 예약을 해제한다.

예약 중 조합은 시작 문서 스냅샷 하나와 갱신 시 잠깐 쓰는 백업 하나만 소유한다. 최종 글자와 서식을 기존 snapshot 명령으로 다시 기록한다. 취소나 주소 변경은 조합분을 원복하며, 취소 뒤 도착하는 조합 이벤트도 문서를 바꾸지 않는다. 조합 중 다른 명령·undo/redo·서식 변경·입력창 blur는 실제 compositionend 경로로 먼저 마무리한다. 문서 로드는 이전 핸들을 initDoc/deactivate보다 먼저 해제하므로 기존 Bridge documentGeneration/hasLoadedDocument로 다른 문서의 snapshot 복원/해제를 피한다. deactivate/dispose는 같은 문서의 임시 조합을 원복하고 예약을 버린다.

기존 note 글자 삭제 역연산은 undo 후 렌더가 정확히 복원되지 않는 문제를 실제로 재현했다. note Backspace/Delete·문단 병합도 기존 snapshot 이력으로 바꿨다. 끝에서 Delete는 이력과 redo를 건드리지 않는다. CommandHistory·Rust 엔진/API의 상태 모델은 변경하지 않았다.

## 자동 검증

각주/미주 × ASCII/Unicode의 혼합 run·다른 문단 스타일·여백·빈 문단·자동번호·이웃 각주를 사용했다.

- 보존한 기준 소스와 현재 동일 WASM으로 실제 onInput 미지원 4건 재현.
- 예약 입력 24, 경계/빈 문단 8, 연속 입력/조합 중 서식 변경 8, 이동/선택/영역 수명 32.
- 조합 28: 갱신·취소·빈 최초 입력·신규 글꼴·중단 후 추가 이벤트·조합 중 undo와 Enter. lifecycle 16: deactivate/dispose, 실제 WASM 핸들 교체/해제 후 정리.
- 입력 이후 삭제/분할/병합 16. 실패를 입력/서식 사이에 주입하여 전체 문서·정의·HWPX 바이트 원복 및 다음 정상 입력 8. 무변경 거절 20, no-op 12, 이력 복원 352.
- HWP/HWPX 재열기 136, 전체 SVG 136/136 일치, export contentLoss 0. 저장물 136개를 독립 Native 경로로 열어 글자/문단 속성·본문/이웃·스타일 및 nextStyle에 따른 분할/병합 스타일·자동번호/본문 참조를 확인했다. Native/JS JSON의 160.0과 160 등 숫자 표현은 동일 수치로 비교하며 속성 키/값은 모두 검사한다.
- 실제 CommandHistory로 예약 입력 104건 후 조합·취소·undo/redo·분기와 남은 이력을 확인했다. 살아있는 snapshot ID 최대 100, history.clear 후 0. 본문/셀 기존 예약 앵커 대조 2건도 통과했다(셀 삽입/geometry 검사가 아닌 실제 helper와 위치 adapter 검사).
- 이전 각주 글자36/복원216/재열기72/거절32; 문단40/복원240/재열기80/거절176/기존 캐럿12; 중첩 문단108/복원648/재열기216/거절80와 이력 예산375명령/복원129.
- 모양복사30/복원180/재열기60/거절44; 검색408(UI272/복원640/재열기2096/SVG차이0); 표치환24/복원170/재열기82/거절4/레이아웃차이0.
- TypeScript/Vite 웹 빌드 및 Native/WASM Clippy `-D warnings` 통과.

실제 현재 Bridge 메서드, InputHandler 입력/서식/실행/이력 복원 메서드, 전체 CursorState, note 키보드 분기, CommandHistory와 명령 클래스를 실행했다. DOM/CharShapeDialog/화면 refresh/geometry는 adapter이며 글로벌 키보드 dispatch는 mock이다. Node24를 기존 dev.6 Electron의 Node 모드로만 실행했다. 실제 Mac GUI/물리 IME/Linux/새 앱 패키징 성공을 뜻하지 않는다.

## 엔진·보존·한계

기존 fresh WASM `657d4b4a3949813d6d3c366a2ca1245c7c5e9d93dba34423db738419013af1e9`를 재사용했다. 이전 release 빌드 proof의 엔진 소스868파일 해시가 현재와 일치하며 엔진 src 변경은 없다. 이번 WASM release 재빌드는 하지 않았다. 웹 내 WASM 및 회귀 검사 엔진 해시도 일치한다. Native 검증 example만 추가했다. 기존 Rust target 재사용/debug0/incrementaloff/jobs2와 3GiB 상한을 지켰다.

원본 루트·사용자 문서·기존 dev.3/공개 beta.2는 변경하지 않았다. dev.6/dev.5/BetaNext ASAR 보호 해시는 `proof.json`과 일치한다. 허용 fixture11 검증/복원0/blocked3 유지. 전체 library 검사 재시도·fixture 복원·대체·skip은 없다. 과거 전체 library 검사는 `3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx` 누락으로 compileexit101/runtime0이었다.

검증용 GUI 창을 열지 않았다. 일부 Node 실행의 `task_name_for_pid` 경고와 웹 빌드의 기존 chunk/externalized-module 경고는 GUI/서명 검사 결과가 아니다. 보안·계정·인증서·권한 변경과 원격 작업은 없다.

## 재현

Node24, Rust1.93.1과 기존 Cargo home/target을 사용한다. 아래 fixture 경로는 보존한 이전 QA 입력이다. 전체 library 검사나 fixture 복원을 추가하지 않는다.

```sh
node scripts/check-note-pending-gap.mjs pkg ../note-paragraph-qa/behavior/native ../note-pending-format-qa/gap ../note-pending-format-qa/baseline
node scripts/check-note-pending-format.mjs pkg ../note-paragraph-qa/behavior/native ../note-pending-format-qa/ui
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example note_pending_format_check -- ../note-pending-format-qa/ui/export-manifest.json ../note-pending-format-qa/behavior/ui-saved
```
