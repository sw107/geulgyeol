# 다음 구현 대상: 혼합 rowspan 소유자

이번 후속의 shared predicate는 블록에 겹치는 모든 셀이 같은 시작 행과 전체 rowspan을 소유하는 경우만 허용한다. 독립 행 셀 또는 시작 행·span이 다른 셀은 false다. 이 문서는 그 제외 범위의 실제 초기 재현을 보존하며 해결되었다고 주장하지 않는다.

모두 기존 확인된 합성 split-before.hwp에서 두 번째 열을 만들고 병합한 HWP/HWPX다. 객체 프레임만 40000HU로 짧게 저장했으며 한컴 작성 원본이나 실제 저작 쪽 나눔 근거가 아니다. Native에서 14개 합성 파일의 48×2 셀 격자가 정확히 한 번씩 덮이고 저장 LINESEG와 객체 프레임이 남는 것을 별도 확인했다.

| 구조 | 실제 Mac Electron 초기 재현 | 남은 문제 |
|---|---|---|
| 왼쪽 1~47행 병합, 오른쪽 독립 짧은 행 | 병합 소유자 텍스트 2867자 중 665자만 렌더; 부분 잘림·테두리 초과는 없음 | 비기하적 소유자 누락 |
| 오른쪽 1~47행 병합, 왼쪽 독립 긴 행 | raw 텍스트 소유는 일치하지만 clip에 부분 잘린 글자 30개; 테두리는 본문 안쪽 2.5067px | visible clip과 소유자 범위 불일치 |
| 왼쪽 1~32행, 오른쪽 16~47행 병합 | 소유자 중복, 숨김 1090개·부분 잘림 42개, 테두리 1840.72px 초과 | 서로 다른 시작 행과 조각 cut의 배치 불일치 |

초기 API probe에서는 각각 소유자 불일치 37·0·31건이다. 가운데 사례는 raw owner 검사만으로 통과하므로 실제 글자 ink/clip 검사가 필수다. Mac 초기 baseline 앱은 모두 정상 종료했고 실패 기록을 보존했다. 이들은 PR10의 Shift+Enter/직접 Delete 누락과 별개다.

다음 구현은 각 셀의 시작 행 위치와 실제 소비한 텍스트 cut를 같은 좌표계로 관리해야 한다. 독립 행의 물리 높이 누적과 병합 셀 내용 높이를 단순한 블록 최대값으로 대체하거나 shared predicate를 혼합 구조까지 넓혀서는 이 재현의 해결 근거가 되지 않는다. 먼저 혼합 구조의 소유자별 cut와 row offset을 기록하는 좁은 재현을 추가하고, 소유자 누락·중복 및 visible clip을 함께 확인한 뒤 첫/중간/끝 편집과 이력·양형식 저장까지 넓힌다. 이는 구현 방향이며 완료된 수정이 아니다.

raw 증거는 저장소 밖 ../table-parallel-merged-fragments-qa의 baseline-mixed-large-left, baseline-mixed-large-right, baseline-mixed-staggered, seeds-1/2와 source-native-pairs/source-native-proof.json에 보존한다. 현재 3행 짧은 mixed-short API ownership은 통과하지만 이를 긴 혼합 구조의 해결 증거로 취급하지 않는다. 기존 beta.3 앱과 PR9는 그대로 보존하고 공개 보류를 유지한다.
