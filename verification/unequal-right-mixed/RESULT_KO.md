# Unequal-right cell40 mixed 검증

PR24의 승인 HEAD `ab0a6ff9a5fdef441ae7e5ff6bd4b7d8950083de`에서 이어서 실제 Mac
Electron 검증을 수행했다. 원격 HEAD·충돌 없음은 확인하고 ready로 전환했으나,
일반 병합은 자동 승인 검토가 직접 사용자 승인을 확인할 수 없다는 이유로 거절했다.
병합을 우회하지 않았으며 이 후속 PR은 PR24 브랜치를 base로 하는 QA 변경이다.
제품 수정·새 빌드·패키징·릴리스는 없다.

기존 원본은 48행·3열·41셀의 unequal-right 표다. 대상 cell40은 row47/col2,
1×1 일반 셀, 폭10000HU, 문단 하나·66문자이며 초기 caret은 page18이다.
기존 runtime52파일을 hardlink로 재사용하고 원본 bytes를 새 input copy와 대조했다.
HWP 앱·Node와 Native 종료를 확인한 뒤 같은 계획을 HWPX에서 실행했다.

실제 입력 순서는 `SEQ🙂` 입력 → Shift+Enter → Delete → Backspace → Enter →
`TAIL🙂` 입력이다. 각 단계가 정착된 settled와 즉시 연속 입력 burst를 모두 실행했다.
첫 C 삭제, 줄바꿈 제거, 문단 분할과 후속 입력 결과를 독립 비교기에서 확인했다.
다른 셀과 반복 머리행, 후행본문·문단/문자 서식·스타일·페이지 정의를 보존했다.

| 입력 형식 | 실제 흐름 | assertion/독립 보존 쌍 | 상태 파일 | 양형식 저장·재열기 | Native 비교 |
| --- | ---: | ---: | ---: | ---: | ---: |
| HWP | 2 | 24/24 | 48 | 4 | 4 |
| HWPX | 2 | 24/24 | 48 | 4 | 4 |
| 합계 | 4 | 48/48 | 96 | 8 | 8 |

Operation·cycle·step·undo/redo를 포함하는 새 파일명으로 96개 상태를 모두 별도
보존했고, 실제 단계 reference의 전체 SVG hash·clip/cut·모델과 독립 대조했다.
각 형식 내부 모든 undo/redo가 exact하며 burst 최종 결과는 settled와 같다.
저장·재열기8건의 전체 SVG·모델이 해당 최종 reference와 같았다.
Node/app exit0·normal quit이며 source/seed 전후 hash가 같다. Native 개별8건과
전체 wrapper 둘 모두 exit0, 실제 전체 SVG/model 일치 및 overflow 경고0이다.
별도 metadata consumer는 provenance를 읽기 검증했으며 새 layout 실행으로 집계하지 않았다.
Physical paint24회·480페이지에서 hidden/partial0, body tolerance2px 안이다.

## 새 입력에서 별도로 확인한 형식 간 차이

HWP/HWPX initial, 입력, Shift+Enter, Enter, 최종/burst 및 대응 저장4쌍은 같다.
그러나 Delete·Backspace 직후 page18의 SVG와 cellRendered 줄 경계가 다르다.
논리 모델은 같고 각 형식의 자기 reference로 되돌린 상태는 정확하다.
이 입력에 left page12 예외를 적용하지 않았다. 전체 중간 SVG 형식 간 exact는 아니다.

이전 고정 WASM `444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988`과
현재 WASM `143713ea4cb939ac15db2b411891ffdcff551a40146a21dee182cac324fff651`에 원본
두 형식을 메모리로 재현했다. 각 형식의 이전/현재 비교 모델(범위는 proof에 명시)·모든 셀 문자 속성 및
전체 SVG가 같았으며, 각 엔진·형식의 초기+6단계 SVG가 실제 Electron 증거와 일치했다.
두 엔진 모두 stage3/4에서만 page18 차이를 재현했다. 메모리 재현을 추가 앱 실행으로
집계하지 않는다. 기존 HWPX 저장 LineSeg 보존 분기와 일치하는 관찰이나, 올바른
줄 경계는 이 검증만으로 판정하지 않는다. 새 제품 회귀나 과거 redo 결함으로 보고하지 않았다.

첫 메모리 비교는 default body-clip이 실제 앱 보기 설정과 달라 초기 SVG 비교에서
멈췄다. 실패·당시 소스를 보존하고 실제 앱의 clipEnabled=false 및 글자 표시 설정으로
맞춘 fresh 단계에서 검증했다. 제품 SVG를 정규화하거나 차이를 제거하지 않았다.
수집기의 budget-root 환경변수 누락은 앱/Native 실행 전 중단됐고 빈 결과 디렉터리도
보존했다. 공유 synthetic 최초 subset 집계는 별도 global 기록으로 정확히 보완했다.

## 보존·예산·한계

과거 1920파일을 포함한 원본·소스·공개 문서 등2243개의 실행 전 해시가 모두 유지됐다.
제품 소스와 renderer/history, 기존 dirty4파일·기존 앱·beta.2·실패 증거를 보존했다.
별도 excluded-linewrap checker는 변경하지 않았다. 이 QA가 전체 QA에 적용됐다는
주장은 없다. PR23의 과거78 assertion 쌍 중 개별 파일로 독립 보존된42쌍 제한도 유지한다.

정상/실패 예산, 미완료 단계 없음과 free floor는 proof.json에 기록했다.
공유 synthetic14,749,696B는 상한32,000,000B 안이다. 삭제·캐시 정리·원본 재생성은 없다.
Rust unit 기존 입력4개 누락, 물리 IME·수동 GUI·Linux·CI·새 packaged app 미검증,
OS chooser 통제 제한은 유지한다. 원본·raw SVG·개인 경로·profile/cache는 공개하지 않는다.
다음 후보는 right page18의 올바른 한컴 줄 경계 판정이며, 독립 검토 전 제품 범위를 넓히지 않는다.
