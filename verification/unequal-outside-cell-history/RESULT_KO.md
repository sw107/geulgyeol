# Unequal tracks 밖 일반 셀의 Delete·혼합 history 검증

독립 승인된 PR22 HEAD `c5af9298a32252a22fe6ddd8500bab7a29310ef1`를 원격에서
재확인하고 준비 상태 전환 후 일반 병합했다. 병합 SHA와 원격 main readback은
`1fec4e325f2bea5fc24aa194070e2c5aa0248f4e`다. Force push·브랜치 삭제·릴리스는 없다.

그 뒤 기존 synthetic `partial-unequal-left.hwp`의 cell 40, paragraph 0, offset 0
Delete 한 건부터 실제 Mac Electron에서 검증했다. 제품 코드는 변경하지 않았다.

## 선택한 좁은 입력과 순차 확장

48행·세 열, 일관된 track 폭 `[4000,7000,10000]`이다. Rectangle은 row `[8,40)`,
연결된 owner block은 `[4,45)`이며 대상 cell 40은 `(row47,col2)`의 마지막 일반 셀이다.
문단 하나에 stored frame과 기존 문자 서식이 있다. 현재 기존 guarded source history
판단은 true이고 PR22의 제외 SQUEEZE 전용 판단은 false다.

과거 이 셀의 문자 입력과 긴 owner의 tail 입력은 검증했지만 Delete/혼합 history는
빠져 있었다. PR21의 Delete/혼합 검증은 equal tracks의 긴 owner 24 대상이며,
PR22의 track mismatch 제외 검사는 한 셀 폭이 잘못된 조건이다. 이 둘을 일관된
unequal tracks 밖 일반 셀의 검증으로 합산하지 않았다.

| 새 Mac Electron 단계 | 흐름 | same-format exact undo/redo 쌍 | 양형식 저장·재열기 |
| --- | ---: | ---: | ---: |
| HWP Delete 한 건 | 1 | 2 | 2 |
| 같은 HWP 셀의 settled mixed + pending burst | 2 | 24 | 4 |
| HWPX 동등 입력의 Delete + 같은 mixed/burst | 3 | 26 | 6 |
| 형식 간 동일 선행 계획 확인용 HWP 재현 | 3 | 26 | 6 |
| 전체 실행 | 9 | 78 | 18 |

첫 Delete는 실제 첫 문자 C 하나가 삭제됐음을 독립 비교했다. Mixed 여섯 명령은
문자 입력 → Shift+Enter → Delete → Backspace → Enter → 후속 문자 입력이다.
두 cycle의 중간 undo/redo 상태는 각 입력 형식 자체의 전체 SVG·clip/cut·셀/본문 문단·
character ID·style·page definition과 exact하다. 반복 머리행과 후행 본문도 포함된다.
Burst 최종 상태는 그 형식의 settled reference와 exact하게 같다.

모든 실행의 Node/app exit 0·normal quit·QA/seed 전후 hash 불변·받은 WASM hash를 확인했다.
Physical paint는 46회·644페이지이며 hidden/partial 0, border/ink overflow가 없다.
새 저장 18개는 고정 Native renderer로 실제 full SVG/model 비교, 개별/overall exit 0,
overflow 경고 0을 확인했다. Metadata consumer도 종료와 manifest/hash provenance를
검증했다. Consumer가 layout을 다시 실행했다고 주장하지 않는다.

## 형식 간 추가 관찰과 남은 차이

동일한 전체 작업 계획의 HWP/HWPX 초기 상태, 단독 Delete, mixed 최초 두 단계,
Enter 뒤 최종 상태, burst 최종 상태 및 대응 저장 여섯 쌍의 full SVG/model은 같다.
그러나 mixed의 Delete와 이어지는 Backspace 직후에는 page 12의 줄 경계가 다르다.
텍스트·문단/문자 서식 모델은 같고, 해당 중간 단계에 대한 undo/redo도 각 형식의
자기 reference로 정확히 돌아온다. 전체 형식 간 중간 SVG exact를 주장하지 않는다.

이 차이는 동일 선행 계획의 추가 HWP 앱 실행에서도 유지됐다. 고정 이전 WASM
`444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988`과 현재 WASM에서
원본 두 형식의 동일 text/Shift+Enter/Delete/Backspace를 메모리 재현했을 때도 같다.
각 형식의 이전/현재 전체 SVG 상태와 전체 문자 속성은 exact했다. 기존 HWPX 저장
LineSeg 보존 분기가 있는 reflow 경로와 일치하는 관찰이며, PR22의 새 회귀나 이미
수정된 과거 undo/redo 결함으로 보고하지 않는다. 어느 형식의 줄 경계가 올바른지는
이 검증만으로 판정하지 않았다. 이 관찰을 없애기 위한 제품 범위 확대도 하지 않았다.

`compare-unequal-outside-history.py`는 기본 strict 비교를 유지한다.
`--observe-preexisting-wrap`을 명시한 실행만 이 fixture의 알려진 mixed 중간 두 단계와
그 undo/redo에서 page 12 차이를 관찰로 기록한다. 논리 모델 차이·다른 페이지 차이는
거절하며 initial/단독 Delete/final/burst/save에는 exact 비교를 유지한다. Format별 binary
export digest와 pending timing 관찰을 전체 SVG/model 동등성 조건으로 사용하지 않는다.

최초 비교기의 binary digest 포함 오류, 실제 기존 형식 간 차이에서 멈춘 strict 비교,
같은 phase를 두 인자로 전달할 때 저장 계획 중복 집계 오류의 세 실패 phase와 두
비교기 소스 checkpoint를 모두 보존했다. 최종 도구는 manifest phase를 중복 방문하지
않고, source 전후 hash를 확인한다. 실패를 성공 기록으로 소급 수정하지 않았다.

## 보존·예산·한계

기존 원본 두 파일과 phase별 input copy, PR21/22 공개 proof, 컴파일 소스 네 파일,
renderer/history 네 파일, 기존 dirty 네 파일, runtime 일반 파일 52개와 bootstrap,
이전/현재 WASM·고정 Native·Electron host hash를 확인했다. Runtime은 기존 파일을
hardlink로 재사용했다. 새 빌드·앱·zip·캐시 정리·원본 fixture 생성은 없다.

전체-root 정상 증거 511,561,728B / 실패 증거 71,270,400B로 768MiB / 256MiB 안이다.
미완료 단계는 없고 free 45,071,392,768B는 안전하한 16,374,562,816B 이상이다.
Shared synthetic 물리 14,602,240B도 기존 32,000,000B 상한 안이다.

Rust unit은 기존 입력 네 개 누락 때문에 실행되지 않았다는 제한을 유지한다.
`engine/samples/3-09월_교육_통합_2022.hwp`, `engine/samples/hwp3-sample16-hwp5.hwp`,
`engine/samples/hwpx/aift.hwpx` 세 sample과 workspace 계약 crate가 요구하는
`engine/mydocs/tech/agent_runtime/version_policy.md` 한 문서다. 새 통과를 주장하거나
가짜 입력을 만들지 않았다.

OS chooser는 QA 응답으로 통제했다. 물리 IME·수동 GUI·Linux·CI·새 packaged app은
미검증이다. Unequal-right와 다른 rectangle 밖 일반 셀의 Delete/혼합까지 확대 해석하지
않는다. 개인 경로·raw SVG·원본·profile/cache는 공개 묶음에 넣지 않았다.

다음 가장 좁은 후보는 기존 `partial-unequal-right`의 마지막 일반 cell 40 Delete다.
형식 간 중간 줄 경계 차이는 별도 source-fidelity 검토 후보로 남겨 둔다.
