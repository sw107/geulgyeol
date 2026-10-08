# dev9 이후 검토 주석 저장 조사 결과

**설계·재현 분기로 완료했다. 주석 추가·내용 수정·삭제 API/UI는 구현하지 않았다.**
HWPX에는 기존 메모 본문 모델/reader/writer가 있으나 HWP5에는 메모 꼬리를 필드로 복원하고
미해석 소유 관계를 보존하는 구조가 빠져 있다. 이를 먼저 추가해야 두 형식 재열기와 비지원
참조 보존을 만족할 수 있다. [최소 구현 설계](DESIGN_KO.md), [집계 근거](proof.json).

기준 dev9 HEAD `7670a15`, 제품 엔진/UI `87e1e07`을 보존했다.
수정은 합성 Native 재현 example, 현재 WASM/실제 UI 명령 재현 script와 조사 문서뿐이다.
기존 스타일 전파/삭제·그룹 해제·표 수식·링크/필드 기능의 제품 코드는 바꾸지 않았다.

## 확인한 결함

메모 1/2개, 각 메모 본문 2문단, 한글·이모지·직접 글자 서식이 든 합성 문서에서:

| 경로 | 관찰 결과 |
| --- | --- |
| HWPX 저장·재열기 | 검토 내용 2/4문단과 본문 선택 텍스트·글자/문단/스타일 참조 보존 |
| HWP 저장·재열기 | writer에는 메모 꼬리 1/2개, reader 모델에는 메모 내용 0문단·Unknown 필드 |
| 편집 없는 HWP 재저장 | 원본 raw stream으로 꼬리 보존 가능; 편집 지원이 있다는 뜻은 아님 |
| HWP 재열기 후 본문 한 글자 편집·저장 | raw 무효화 후 메모 꼬리 0개로 소실 |
| HWP→HWPX | 기존 내용 대신 메모당 빈 본문 1문단 생성 |
| 저장 content-loss 보고서 | 위 경로에서도 count 0; 재열기 성공을 대신할 수 없음 |

Native 재현이 현재 결함에 대한 assertion을 통과한다는 뜻이지 메모 저작 기능 통과가 아니다.
WASM이 저장한 파일 4개를 독립 Native로 읽어 같은 내용 손실을 확인했다.
실제 registry/dispatcher/menu-state는 192개 입력을 disabled로 거절하며 모델/두 형식 저장
바이트/정보/필드/이벤트가 그대로다. 이는 **명령 전체 비활성** 검사이며 구현된 범위 guard가 아니다.
전용 memo/comment WASM export도 없다.

## 검증

| 검사 | 결과 |
| --- | --- |
| 새 Native 저장 구조 재현 | 메모 1/2개, 내용/서식 참조와 raw 꼬리 소실 재현 통과 |
| 기존 일반 snapshot | Native 메모 IR 복원, WASM 문서 4개의 본문 변경 전후 복원 통과; 주석 command undo/redo는 미검증 |
| 실제 현재 본문 링크 UI/WASM 회귀 | 양성 6, 재열기 22, undo/redo 각 6, 거절 36 |
| 실제 현재 셀 링크 UI/WASM 회귀 | 양성 84, 재열기 288, undo/redo 각 84, 무변경 거절 444; 높이/다쪽 각 12 |
| 링크 저장본 독립 Native 조회 | 본문 22개·셀 264개 파일의 전체 서식 ID, 필드 범위, 이웃 본문/셀/각주 참조 보존 |
| TypeScript noEmit | 통과 |
| Clippy lib + 새 재현/본문·셀 링크 example, `-D warnings` | 통과 |
| 전체 library test 컴파일 | 기존 `include_bytes!` 샘플 3개 누락으로 실패; 실제 test 실행 못함 |

누락 파일은 `engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, `engine/samples/hwpx/aift.hwpx`다.
샘플 대체·검사 제외·가짜 fixture 추가는 하지 않았다.
메뉴 DOM/커서/렌더링 adapter를 사용하는 Node 검사는 Mac GUI 클릭이나 물리 IME 검사가 아니다.
이번 Linux 실행 환경 검사는 하지 않았다.

## 재현 명령과 산출물

현재 실행 환경의 별도 QA는 `../review-comment-qa`다.
`run-budgeted-cargo.py`가 target 4GiB와 여유 공간 10GiB 중단 조건을 검사한다.
제품 엔진 소스 887개가 dev9 freeze와 같은 해시여서 dev9 WASM을 새 QA/pkg로 복사해 사용했다.
이번 WASM 재빌드/앱 패키징은 하지 않았다. 아래 명령은 checkout에서 실행했다.

```sh
python3 ../review-comment-qa/run-budgeted-cargo.py native-storage-final run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example review_comment_storage_probe -- ../review-comment-qa/native
ELECTRON_RUN_AS_NODE=1 ../dev9-checkpoint-qa/GeulgyeolDev9.app/Contents/MacOS/GeulgyeolDev9 scripts/check-review-comment-storage.mjs ../review-comment-qa/pkg ../review-comment-qa/native ../review-comment-qa/wasm-ui
python3 ../review-comment-qa/run-budgeted-cargo.py native-wasm-reopen run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example review_comment_storage_probe -- ../review-comment-qa/native --verify-wasm
ELECTRON_RUN_AS_NODE=1 ../dev9-checkpoint-qa/GeulgyeolDev9.app/Contents/MacOS/GeulgyeolDev9 rhwp-studio/node_modules/typescript/bin/tsc -p ../review-comment-qa/tsconfig.json --noEmit
python3 ../review-comment-qa/run-budgeted-cargo.py clippy-final clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --example review_comment_storage_probe --example body_hyperlink_check --example cell_hyperlink_check -- -D warnings
python3 ../review-comment-qa/run-budgeted-cargo.py library-tests-test-compile test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib --no-run
```

`native/native-proof.json`, `native/native-wasm-reopen.json`, `wasm-ui/proof.json`,
각 회귀의 proof와 Cargo 로그/예산 기록, TypeScript 로그, `wasm-provenance.json`,
`protection.json`에 원시 근거가 있다. 초기 셀 Native 회귀 호출의 manifest/출력 인자 오류는
올바른 saved-file manifest와 JSON 출력 파일로 바로잡아 최종 검사했다. 실패 로그도 남겼다.

target 최고/최종 **3,648,233,472 bytes (3.398GiB)**,
최소 여유 **24,166,400,000 bytes (22.507GiB)**로 예산을 지켰다. 별도 QA 약16.85MiB다.
이전 보호 대상 10개와 이번 시작 해시 4개가 그대로다. dev9 app/기존 후보/root pkg/원본 작업을
바꾸지 않았으며 새 공개 push/release·보안/계정/인증서/원격 권한 변경·검증 GUI 실행은 없다.

다음은 HWP5 메모 꼬리 소유/미해석 레코드 보존 모델과 reader/writer 계약을 먼저 구현·검증하는
것이다. 그 후에 한 문단 선택의 주석 저작과 실제 command undo/redo를 연결해야 한다.
