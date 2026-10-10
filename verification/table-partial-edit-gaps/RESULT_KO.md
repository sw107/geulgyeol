# 부분높이 colSpan=2 편집·history·행 경계 후속 검증

병합된 main `f437dd87b58ac51f4d9634604c6f2ba495816b62`의 제품 소스와 고정된
WASM/Native를 재사용했다. 이번 묶음은 검증 도구와 증거 요약을 추가하며 제품의
layout/history 범위나 상수를 변경하지 않는다. 새 빌드·앱·zip·릴리스는 없다.

## 실제 Mac Electron

| 단계 | 작업 흐름 | exact undo/redo 쌍 | 양형식 저장·재열기 |
| --- | ---: | ---: | ---: |
| HWPX 첫·중간 삭제/줄바꿈과 mixed smoke | 4 | 28 | 8 |
| HWP 첫·중간·끝 삭제/줄바꿈과 mixed | 8 | 36 | 16 |
| HWPX 끝 fragment | 2 | 4 | 4 |
| 실제 snapshot 예산 초과 | 1 | 50 | 2 |
| 실제 65행 편집 및 마지막 셀 Tab | 4 | 18 | 8 |
| 최종 QA 소스 HWP/HWPX 끝 fragment 재확인 | 4 | 8 | 8 |
| 합계 | 23 | 144 | 46 |

48행 원본의 긴 병합 owner에서 첫/중간/끝 문단은 0/31/63이며 실제 page index는
1/4/7이다. Delete와 Shift+Enter를 두 입력 형식에서 실행했다. Mixed 흐름은
문자 입력 → Shift+Enter → Delete → Backspace → Enter → 후속 문자 입력의 여섯
명령을 개별 settle 및 pagination pending burst로 실행하고 두 cycle의 모든
중간 undo/redo 상태를 비교한다. 전체 SVG·clip/cut, 본문·셀 문단·character ID·
style·page definition, 반복 머리행과 후행 본문을 확인했다.

지원 범위 physical assertion은 89회·935페이지이며 hidden/partial 0이다.
65→66행 이탈 뒤 세 paint 관찰을 포함한 전체 관찰은 92회·971페이지, hidden/partial 0이다.
이탈 후 관찰을 지원 범위의 geometry 성공으로 승격하지 않았다. 허용치는 2px이며
관찰된 border/ink overflow는 없다. 각 성공 단계는 Node harness와 앱 exit 0,
정상 quit, 실행 전후 QA/seed hash 불변, 받은 WASM hash 일치를 기록한다.

새 저장 46개 모두 기존 고정 Native 바이너리로 full SVG/page count/model/style을
실제로 비교했다. Native 개별 exit 및 새 overall wrapper exit 0, overflow 경고 0이다.
PR20 consumer도 종료·manifest 계획·SHA provenance를 검증했다. Consumer의 읽기만으로
layout을 재검증했다고 주장하지 않는다. 과거 88개 실행의 overall 기록은 소급 작성하지 않았다.

## 실제 98-ID 예산

상수와 mock을 바꾸지 않고 실제 source snapshot 경로에서 100개 키 입력을 생성했다.
최대 snapshot resource 98, 첫 eviction은 99번째 입력이었다. 8회 undo 후 새 분기로
redo를 비우고 새 분기의 undo/redo를 exact 비교했다. 남은 undo 90개를 drain했고,
예산에 남은 redo 49개를 연속 재생하여 모든 retained 상태의 전체 hash를 비교했다.
empty undo도 불변이었다. 최종 재생 지점은 원본 입력 reference 52이다.

98은 history 명령 수가 아닌 snapshot ID 예산이다. Undo 과정에서 source/post
snapshot을 함께 보유하므로 redo 후보가 추가 eviction될 수 있다. 100개 입력이나
새 분기 끝까지의 redo 전체가 남는다고 주장하지 않는다.

## 실제 행 경계와 제외 범위

동일 synthetic 원본에서 실제 table 4/65/66행을 만들었다. 최종 budget 적용 생성기도
새 디렉터리에서 세 경계를 재검증했다. Body snapshot eligible cell은 각각 0/95/0이다.
65행 마지막 셀 Tab으로 실제 66행이 되면 모든 cell이 guarded history 범위를 벗어난다.
전환 undo/redo와 양형식 저장·재열기는 exact이며, 저장된 66행 파일은 이전 엔진에서도
전체 SVG·모델이 같은 fallback으로 열린다.

4행, 66행, rectangle 밖 셀의 serialized lineWrap=SQUEEZE와 textDirection=1만
제외 비교 대상으로 삼았다. 같은 HWP/HWPX bytes 8개에 대해 이전 WASM과 현재 WASM의
읽기 전용 전체 SVG·모델 비교를 통과했다. 이어 실제 Electron에서 각 엔진 16흐름,
32쌍 history 관찰, 32개 저장·재열기를 실행했다. 서로 96개 상태·caret 기록,
32개 저장의 full SVG·모델·서식과 paint 관찰이 exact하게 같다.

66행/lineWrap/textDirection의 undo 화면 차이 24개 assertion도 두 엔진에서 동일했다.
이들은 모델은 복구되지만 원본 SVG와 다른 기존 fallback 동작이며 새 회귀나 exact
undo 성공으로 보고하지 않는다. 관찰용 roundTripEqual은 `fallbackExpected` fixture에만
적용한다. 지원/65→66 전환 검증에는 기존 exact assertion이 유지되며, 최종 QA 소스로
양 입력 형식의 끝 fragment 네 흐름을 다시 통과했다. 로그의 PASS는 제외 묶음에서는
관찰 완료를 뜻하며, 동등성 판단은 별도 comparator가 한다.

## 보존한 실패와 QA 기록 보완

- 첫 제외 실행은 66행의 화면 밖 후반 문단 caret 조회에서 중단됐다. 재시도는
  제외 범위에만 unavailable caret를 기록하고 실제 선택 가능한 첫 문단을 사용했다.
- 다음 진단은 기존 undo 화면 차이에서 중단됐다. 거대한 assertion 문자열로
  manifest 상태가 68,114B가 되었고 failure/lifecycle 기록도 제한에 걸렸다.
  이 단계의 앱 exit는 미관측이다. Quit 요청과 audit will-quit만 확인했으며
  process record를 성공이나 exit 0으로 다시 쓰지 않았다.
- 또 한 단계는 앱 spawn 전 failure 예산 forecast에서 거절됐다. 이후 관찰 실행의
  예상량을 64MiB로 산정했다. 768MiB/256MiB 상한과 free floor는 변경하지 않았다.

세 실패 원본과 partial manifest는 모두 그대로 보존했다. 큰 실패 상태 파일은
유효한 failed phase 아래에서만 내용을 parse/promote하지 않고 물리 크기 전체를
failure 예산에 계산한다. 실행 중/성공 상태 파일과 phase marker의 제한은 유지한다.
새 QA 실패 문자열/stack은 제한된 크기로 기록한다. 작은 synthetic 네 사례는
실패 원본 불변, 용량 초과 거절, 실행/성공 상태와 phase marker 거절을 확인했다.

## 고정 해시·예산·한계

WASM `444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988`
Native `1801e456363aa79de62e96f60d846a30d8d37251e0bfef72bb2a2dff686ad250`
이전 WASM `4128c152b6503430e845f4045b0b9a3b03860ab8da5ebbaf89c914d9067e96e1`

컴파일 소스 네 파일, 이전/현재 runtime의 일반 파일 각각 52개, Electron host,
기존 dirty 네 파일, 보호파일 22개와 과거 proof 23개 해시를 유지했다. Runtime 파일은
hardlink로 재사용했으며 원본·기존 앱·beta.2·기존 증거·캐시는 삭제하거나 교체하지 않았다.
전체-root 물리 예산과 shared synthetic 잔량은 `proof.json`에 기록했다. Hardlink의
첫 방문 위치에 따라 정상/실패 분류가 달라질 수 있으며 감소를 삭제로 해석하지 않는다.
Shared synthetic 물리 14,360,576B는 승인된 32,000,000B 안이다.

실행 raw SVG·원본·profile/cache·개인 경로는 공개하지 않는다. QA chooser 응답은 통제되며
물리 IME, 수동 GUI, 새 packaged app, Linux, CI는 검증하지 않았다. 실제 Electron을
사용했고 별도 웹 개발이나 Chrome UI 검증은 하지 않았다.

다음 구현 후보는 이번에 양 엔진에서 확인한 제외 범위의 stored-wrap undo 화면 복구를
좁은 fixture 하나로 정의하는 것이다. 범위 확대와 베타 릴리스는 독립 검토 뒤 별도 조율한다.

## 도구 재사용

`prepare-electron-qa-reuse.py`는 기존 phase의 runtime/host pin을 확인한 뒤 fresh phase를
만든다. 과거 baseline에는 외부 runtime-pin 인자를 명시한다.
`run-electron-edit-gaps-qa.py`는 별도 seed 계획과 선택 연산을 받고 실제 두 프로세스
종료를 기록한다. 행 경계 seed의 실험별 `historyGaps`, `historyCell`,
`expectedRowCount`, `expectedSupported`, `expectedLeaveScope`, `fallbackExpected`와
`operations`는 계획에서 명시한다. 제외 범위는 first paragraph의 삭제/줄바꿈만 사용했다.
`compare-electron-excluded-fallback.py`는 두 완료 phase를 읽기만 하며 저장 manifest를
bounded streaming으로 비교한다. 모든 실행에는 canonical 전체-root
`GEULGYEOL_QA_BUDGET_ROOT`를 지정하고 한 writer/phase를 순서대로 사용한다.
