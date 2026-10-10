# Native EOF 차단과 source/baseline producer 연결

PR #17 후속이다. 제품 dirty 수정과 과거 QA 자료는 이 커밋에 포함하지 않는다.

## 실행 재현과 수정
이전 bridge에서 실제 pipe EOF를 만든 뒤, 별도 실행 중인 가짜 Native의 heartbeat가
계속 증가했고 marker는 failed가 되어 다음 phase 시작이 허용됐다.
수정은 EOF만으로 failed를 기록하지 않고 기존 running을 보존한다.
종료를 확인하지 못한 phase를 재시작 writer가 인수하거나 해제하지 않는다.
정상 coordinator가 자기 Native의 종료를 기다린 뒤 보내는 명시적 failed/complete는 유지한다.

회귀에는 실제 bridge EOF + 계속 쓰는 가짜 Native와, 실제 run_native를 호출하던
합성 coordinator를 급종료하는 경우가 모두 포함된다. 후자의 유한 가짜 Native는
자연 종료까지 확인한다. 테스트가 만든 정확한 프로세스 외에는 신호를 보내지 않는다.

## producer
prepare-native-evidence-budget.py의 source/baseline 모드는 명시적 전체-run budget root
아래 fresh phase만 만든다. source는 기존 Native 바이너리를 실행하며 빌드는 하지 않는다.
source 사례·파일·도구·Native hash를 고정하고 HWP/HWPX 두 형식의 실행 기록을 만든다.
이 기록은 ledger 생성 기록이며 독립 layout 검사 통과로 주장하지 않는다.
baseline은 Native TextRun과 SVG의 고유 painted y를 대조하고 기존 좌표 oracle 형식으로
내보낸다. 한 JSON 사례 32MiB, SVG 페이지 16MiB, seed index 4MiB, source plan 256건을 제한한다.
phase 전체 SVG를 출력 proof에 복제하지 않는다. 입력은 최종 hash까지 확인한다.

출력은 budget 검사 후 새 partial에 쓰고 fsync/hash를 확인해 배타적으로 승격한다.
최종화 실패 때 이번 writer가 만든 완료 proof는 .failed 증거로 보존한다.
소비자는 완료 proof와 complete phase marker를 함께 확인해야 한다.
이전 private producer·사용자 원본·dirty 파일을 덮어쓰지 않는다.
hash 읽기는 with 블록으로 닫아 합성 검사에서 발견한 ResourceWarning을 수정했다.
현재 indexed caret 소비자의 Native binary 경로는 기존 QA 레이아웃을 사용한다.
새 producer의 nativeBinary metadata 연결은 후속 사항이며 제품 QA에 자동 적용했다고 주장하지 않는다.

## 검증
- native_qa_budget_test.py: 8개 통과 (실제 bridge, 가짜 Native만 사용)
- native_evidence_producer_test.py: 7개 통과
  - 6개는 입력 변경·고유 baseline·최종화 실패 등을 주입된 메모리 coordinator로 검사
  - 1개는 실제 shared bridge와 작은 가짜 Native로 source → baseline 두 phase 연결 확인
- qa-evidence-tools.test.mjs: 기존 33개 통과
- Node 구문 및 git diff 공백 검사 통과
- Python ResourceWarning을 오류 처리하는 실행에서 경고 출력 없음

실제 제품 Native/WASM/Electron·CI 검증은 이 도구 결과에 포함하지 않는다.
표본 budget 검사는 OS quota가 아니며 외부 writer의 순간 쓰기를 원자적으로 제한하지 않는다.
다음 단계는 고정 SHA 독립 검토와, 별도 제품 검증 묶음에서 부분높이 기능의 Mac 실행 확인이다.
