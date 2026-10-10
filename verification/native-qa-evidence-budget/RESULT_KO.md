# Native 저장 검증 wrapper 예산 연결

QA 도구 PR #16은 승인된 d4ae08a12723f2b300a74f649f77994684c6e4a8을 일반 병합했다.
병합 후 원격 main을 다시 읽은 SHA는 fbe9fa0a428c9567591b25a35b16ac7fcaec0a6d다.
이번 변경은 그 도구의 후속이며 제품 부분높이 dirty 변경을 포함하지 않는다.

## 연결 범위

shard-electron-table-manifest.py의 새 fresh 출력에 공유 예산을 연결한다.
GEULGYEOL_QA_BUDGET_ROOT로 전체 새 QA 묶음을 명시해야 한다. 과거 출력은 재사용하지 않는다.
Python adapter는 private stdin/stdout pipe로 Node bridge를 시작한다.
bridge는 EvidenceBudget 인스턴스 하나를 유지해 한 phase만 소유하며, Python이
정책을 복제하거나 재시작 시 running marker를 인수하지 않는다.

- 시작 전 정상 128MiB·실패/임시 16MiB 예상량과 실제 free를 검사한다.
- raw hash는 스트림으로 계산하고, 사례 scratch는 32MiB로 제한한다.
- 사례 작성 전에 scratch + 예상 Native 16MiB + metadata의 잔량을 검사한다.
- 실행 중 250ms마다 공유 budget.check를 호출한다. 초과하면 이번 wrapper가 시작한
  정확한 Native 자식 하나만 terminate하고 기다린다. 종료하지 않는 own 자식만 kill한다.
  다른 앱·프로세스를 열거하거나 신호를 보내지 않는다.
- Native 실패/overflow·입력/도구 hash 변경·예산 오류를 완료로 기록하지 않는다.
  새 상태는 complete:false이며 phase는 failed로 누적한다.
- 후속 P2 수정에서는 coordinator pipe EOF만으로 Native 종료를 확인할 수 없어 running을 보존한다.
  명시적으로 종료를 확인한 coordinator의 failed 요청만 다음 bounded phase를 허용한다.
  실행 재현·급종료 회귀·현재 검증은 ../native-eof-producers/RESULT_KO.md를 참조한다.
- index는 디스크 바이트/fsync 확인 후 배타적으로 승격한다. 새 scratch 및 실패 증거를
  wrapper가 삭제하지 않는다. 마지막 scratch 정리는 성공한 상위 실행자의 기존 역할이다.
- Native source/probe ledger producer와 baseline producer, 엔진 빌드 자체는 아직 연결하지 않았다.

실행 전후 및 표본 검사 방식이며 OS disk quota가 아니다. 빠른 외부 writer가 예측을
넘겨 한 번에 쓰는 양까지 원자적으로 제한한다고 주장하지 않는다. Native child가
자체적으로 만든 별도 자식 프로세스를 관리하는 기능도 없다(현재 대상은 단일 Rust 검사기).
정상 768MiB·실패 256MiB 상한과 실제 free 조건은 기존 공유 모듈 그대로다.

## 합성 검증

python3 -B scripts/native_qa_budget_test.py: 6개 통과.
사용한 실행 파일은 새 임시 폴더에 만든 작은 Python 가짜 Native이며 실제 엔진이 아니다.

1. 정상 흐름의 budget 한도·완료 기록·디스크 hash와 원본 hash 보존
2. 가짜 Native exit 1의 실패 marker·불완전 상태·성공 index 부재
3. 이전 running+partial이 새 Native 실행/marker 생성 전에 거절되며 과거 marker 불변
4. 당시 coordinator pipe EOF 후 partial 보존과 실패 기록 (후속 P2에서 running 보존으로 수정)
5. 주입된 예산 오류 때 생성한 가짜 자식 하나의 종료 확인
6. budget root 누락 시 bridge/phase marker 없이 거절

Node bridge 문법, Python adapter/wrapper/test 구문, git diff 공백 검사도 통과했다.
Python bytecode 생성을 끄고 합성 임시 증거를 보존했다. 앱·실제 Native/WASM·빌드·대규모
회귀·CI 성공은 이번 결과에 포함하지 않는다. 이전 QA 통과 기록은 수정하지 않았다.

다음 후보는 Native source ledger와 painted-baseline producer에도 같은 adapter를 연결하고,
공간 조건과 사용자 작업 범위가 충족될 때 실제 엔진·Mac 실행으로 연결 동작을 확인하는 것이다.

## 후속 검토 수정
EOF 동작과 producer 연결은 ../native-eof-producers/RESULT_KO.md에 기록했다.
이 문서의 최초 6개 검증 기록은 당시 범위이며 현재 wrapper 회귀는 8개다.
