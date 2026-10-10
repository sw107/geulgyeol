# Unequal-right 마지막 일반 셀 Delete 검증

PR23은 고정 HEAD `644df8acd1c33f6623172d1aa59b7cdbe8d4d848`의 독립 승인 뒤 원격
HEAD와 충돌 여부를 재확인하고 일반 병합했다. Main readback은
`afaeb27a6288144e702608527b7cbc2fff9275b3`다. Force push·브랜치 삭제·릴리스는 없다.
새 브랜치의 변경은 QA 파일 보존과 검증문서에 한정하며 제품 코드는 변경하지 않았다.

## 과거 증거의 정확한 제한

PR23의 78 undo/redo 쌍은 실제 assertion과 PASS 로그로 뒷받침된다. 그러나 settled와
burst가 같은 중간 undo/redo 파일명을 사용해 앞선 상태 파일을 덮었다. 남은 개별
상태 파일로 독립 대조 가능한 것은 42쌍이다: HWP Delete 2, HWP mixed 12,
HWPX 동일 계획 14, HWP 동일 계획 재현 14다. 과거 proof·파일을 바꾸거나 덮인
settled 파일을 복원하지 않았다. 이 제한은 이번 proof에도 명시했다.

이전 unequal-left mixed의 형식 간 page12 줄 경계 차이는 올바른 기준이 미판정인
기존 현상으로 유지한다. 새 회귀로 주장하지 않으며 이번 오른쪽 Delete 검증으로
그 현상까지 해결하거나 판단했다고 주장하지 않는다.

## 새 QA 파일 보존

`mixedTextHistory`의 evidence prefix에 `op.name`을 포함시켰다.
예를 들어 settled는 `fixture-input.hwp-mixed-text-history-mixed-undo-0-0-state.json.gz`,
burst는 `fixture-input.hwp-mixed-burst-history-mixed-undo-0-0-state.json.gz`다.
각 실행은 fresh phase 디렉터리를 사용하고, 상태/paint/proof JSON 쓰기는 `wx`로 기존
파일이 있으면 거절한다. 앱과 통신하는 mutable `control.json`의 기존 경로는 유지한다.
Runner의 실행 전후 source pin에 새 helper도 포함했다.

보존형 synthetic 검사에서는 settled/burst·cycle·undo/redo 여덟 파일의 이름 분리,
충돌 거절과 원본 bytes 불변, 별도 실행 디렉터리 분리, 경로 밖 이름 거절을 확인했다.
같은 helper는 이번 실제 Delete의 상태·paint/proof 쓰기에서도 사용됐다. 새 이름으로
실제 mixed/burst 앱 실행은 하지 않았으며 다음 단계로 남겨 둔다.

## 실제 Mac Electron와 Native를 순차 실행

기존 `partial-unequal-right.hwp`의 cell40 / paragraph0 / offset0 Delete 한 흐름부터
실행했다. 앱 종료와 저장 두 파일의 Native 종료를 확인한 뒤 기존 HWPX 원본에서
같은 Delete만 실행하고 Native 두 건을 확인했다. 혼합 편집은 실행하지 않았다.

입력은 48행·3열·41셀, track 폭 `[4000,7000,10000]`이다. Rectangle은 row `[8,40)`의
cols1–2, 연결된 owner block은 `[4,45)`다. 대상 cell40은 `(row47,col2)`의 1×1 일반 셀,
폭 10000HU, 문단 하나·66문자이며 기존 caret은 page18, 초기 문서는 20페이지다.
기존 bounded source-snapshot 판단이 body cell `[3..40]` 모두에 적용됨을 실제 확인했다.

| 새 단계 | 흐름 | assertion 쌍 | 남은 파일로 독립 검증한 쌍 | 양형식 저장·재열기 | Native 비교 |
| --- | ---: | ---: | ---: | ---: | ---: |
| HWP Delete | 1 | 2 | 2 | 2 | 2 |
| HWPX Delete | 1 | 2 | 2 | 2 | 2 |
| 합계 | 2 | 4 | 4 | 4 | 4 |

실제 첫 문자 C 하나가 삭제됐다. Undo/redo 상태 파일 여덟 개를 모두 보존하고,
별도 비교에서 before/after reference의 전체 SVG·clip/cut·본문/셀 문단·character ID·
style·page definition과 exact함을 확인했다. 반복 머리행과 후행 본문도 포함된다.
단독 Delete의 두 입력 형식 간 초기/편집 뒤 full SVG/model 역시 같다.

두 실행 모두 Node/app exit0·normal quit·QA/seed 전후 hash 불변·받은 WASM hash 일치다.
Physical paint는 8회·160페이지로 hidden/partial0, border/ink overflow가 없다.
새 저장 네 개는 고정 Native renderer의 실제 full SVG/model 비교, 개별/overall exit0,
overflow 경고0이며 metadata consumer도 manifest/hash provenance를 검증했다.
Consumer의 읽기를 layout 재실행으로 주장하지 않는다.

## 보존·예산·한계

실행 전에 기존 상태·manifest·process·marker 등 1920개 파일의 해시를 고정했고,
실행 뒤 모두 불변임을 확인했다. PR21/22/23 공개 proof, 원본 두 파일과 새 input copy,
컴파일 소스 네 파일·renderer/history 네 파일·기존 dirty 네 파일·runtime 일반 파일
52개·bootstrap·이전/현재 WASM·Native·Electron host도 확인했다. QA source의 새 버전은
실행 전후 같은 해시이며 역사적 source 버전과 증거는 git과 이전 phase에 남겨 둔다.

정상 증거 538,435,584B / 실패 증거 71,270,400B로 768MiB / 256MiB 안이다.
미완료 단계는 없고 free 45,056,299,008B는 안전하한 16,374,562,816B 이상이다.
Shared synthetic 물리 14,639,104B는 기존 상한 32,000,000B 안이다.

새 제품 빌드·앱·zip·캐시 정리·원본 fixture 생성은 없다. Rust unit은 기존 필수 입력
네 개 누락으로 미실행인 제한을 유지한다. 물리 IME·수동 GUI·Linux·CI·새 packaged app은
미검증이고 OS chooser는 QA 응답으로 통제했다. Raw SVG·원본·개인 경로·profile/cache는
공개하지 않는다. 다음 후보는 같은 오른쪽 셀의 mixed history이며 이번에는 남겨 둔다.
