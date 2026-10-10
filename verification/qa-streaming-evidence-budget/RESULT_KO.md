# QA 사례 스트리밍·좌표 인덱스·증거 예산

기준 커밋: e1506eaedaad3e8ed24bb70ff8d221be799ebccb.
이 변경은 QA 도구만 포함한다. 기존 dirty 부분높이 제품 수정, 기존 좌표 검사,
과거 QA 원시 증거·통과 기록·앱·ZIP은 보존했다.

## 구현

- Electron 저장·재열기 검증이 끝난 사례를 즉시 await append한다. 전체 SVG/model
  manifest 배열을 유지하지 않는다. JSON 배열 형식은 기존 Native reader와 동일하다.
- 새 실행은 manifest.json.gz.partial에 기록한다. 순서·파일 identity 중복·사례 크기
  (기본 32MiB)·예상 기록 수를 검사하고, 완료 때 디스크에서 gzip을 읽어 raw SHA/길이를
  검증한다. 배타적 hardlink 승격으로 기존 canonical 파일을 덮어쓰지 않는다.
  오류·누락·중복·중도 중지 시 complete:false/incomplete:true 상태와 partial을 보존한다.
  강제 종료 때도 초기 complete:false 상태가 남는다. 저장 완료는 제품 QA 통과와 별개다.
- 사례 수준 before/after/history 상태는 비교에 필요해 유지한다. fixture의 history
  참조는 해당 fixture 뒤 해제한다. 메모리 endpoint 탐지 로그는 마지막 64KiB만 유지한다.
  rows/paintChecks는 작은 요약이며, 원본 SVG를 phase 전체에 누적하지 않는다.
- 새 check-colspan-two-owner-carets-indexed.mjs는 owner/paragraph와 page로 TextRun을
  인덱싱한다. 코드포인트 길이를 한 번 계산하고 줄 경계의 양쪽 witness를 보존한다.
  Native parent/control/single-cellPath 조건과 독립 painted baseline 좌표를 그대로 사용한다.
  쿼리는 generator로 만들고 128개마다 event loop에 양보한다. 문서 전체 쿼리 배열이나
  전체 TextRun을 쿼리마다 filter하는 방식은 사용하지 않는다. 원래 dirty checker는 그대로다.

## 향후 실행 설정

새 QA bundle root와 그 아래 fresh phase 디렉터리를 사용한다. 과거 QA root를 재사용하지 않는다.
모든 단계가 같은 GEULGYEOL_QA_BUDGET_ROOT를 지정해야 하며, phase와 root는 서로 달라야 한다.

- 정상 증거 합계: 768MiB, 실패 증거 합계: 256MiB.
- block 할당량을 사용하며 하드링크를 중복 계산하지 않고 symlink를 따라가지 않는다.
- 시작 전 예상 추가량과 현재 잔량을 검사한다. 현재 단계가 실패할 경우의 증거량도
  남은 실패 allowance 안에 있어야 한다. 실패 phase marker는 다음 phase에서도 누적된다.
- Electron 기본 phase forecast: 정상 128MiB, 실패/임시 여유 16MiB.
  GEULGYEOL_QA_NORMAL_FORECAST_BYTES / GEULGYEOL_QA_FAILURE_FORECAST_BYTES로
  더 큰 예상량을 명시할 수 있지만 768/256MiB 상한은 유지된다.
- 실제 여유 공간은 16,374,562,816B + 예상 추가량 이상이어야 한다.
  전체 빌드 포함 실행 전의 별도 보수적 조건 19,426,598,912B는 이 도구가
  새 엔진 빌드를 실행하거나 통제한다는 의미가 아니다.
- 사례 기록·보조 증거·저장 파일·로그·스크린샷 전에 추가량을 검사한다.
  중지 후에는 작은 실패/lifecycle metadata만 기록하며 앱의 정상 종료 경로를 사용한다.
  예산을 위해 증거를 자동 삭제하거나 과거 정본을 변환하지 않는다.
- Native 빌드/ledger producer/기타 외부 writer까지 이 모듈로 연결한 검증은 아직 없다.
  후속 phase wrapper는 해당 산출물을 같은 root에 포함하고 실행 전후 budget.check를
  호출해야 한다. 외부 프로세스의 무제한 쓰기를 OS quota로 강제하는 구현은 아니다.

Indexed 좌표 도구에는 이전과 같은 WASM pkg, seeds, Native ledger, 독립 painted-baseline
oracle 입력이 필요하다. baseline producer의 기존 private 작업은 이 변경에 포함하지 않았다.
새 도구가 과거 12,690개 실측을 실행했다고 간주하지 않는다.

## 이번 검증

Node v22.18.0, node --test scripts/qa-evidence-tools.test.mjs: 합성 21개 통과.
순서/UTF-8/SHA, 빈 배열과 raw 호환, 누락/중복/순서 오류/크기 제한/예산 중지,
손상 gzip, 새 canonical 파일 보호, 초기 중지, hardlink/symlink accounting,
정상·실패·free-space forecast 거절, 실패 예산의 phase 간 누적,
Unicode/줄 경계/Native 범위, 작은 배치 순서·중도 실패를 확인했다.
모듈·실행 파일의 Node 문법과 Python runner 구문을 검사했다.

합성 테스트의 free-space provider만 작은 임시 파일에 맞게 주입했다.
실제 앱/WASM/Native engine 실행, 대규모 회귀, Mac 동작·메모리 사용량 검증은 하지 않았다.
원인 불명 볼륨 감소를 이 도구의 메모리 사용 때문이라고 단정하지 않는다.
소스·문서와 합성 임시 증거의 이번 증가량은 10MB 제한 이내다.
앞선 읽기 전용 공간 조사에서는 고정 121개 파일 SHA 보존을 확인했다.
이번 도구 변경 뒤에는 보호 목록 22개, 기존 dirty 소스·도구 6개, PR15의
source/boundary proof 고정 목록을 다시 hash해 확인했다.
