# 제외된 SQUEEZE 표의 좁은 source history 복구

48행·세 열의 synthetic 표에서 부분높이 colSpan=2 rectangle 밖 일반 셀 하나만
SQUEEZE이고, 기본 가로쓰기 rectangle owner의 첫 문단을 편집하는 조건을 고쳤다.
Delete/Shift+Enter 뒤 undo하면 모델은 되돌아오지만 원본 stored line frame을
역연산으로 복원하지 못해 SVG가 바뀌던 기존 동작이다. PR21의 이전·현재 엔진
비교 24건 중 이 한 조건의 8건만 이번 수정 대상으로 삼았다.

PR21은 고정 HEAD `eedba83ff2f7fbfdbd305802bcceadd4c400942b` 독립 승인 뒤 정상 병합했고,
기반 main은 `d8466609c7107359a19af01417ab0664b19cf941`다.

## 제품 변경

`excludedLineWrapCellNeedsTextSnapshot`은 history 전용 읽기 판단이다. 세 열,
5~65행의 기존 bounded plain partial rectangle에서, rectangle 밖의 standalone
body cell 하나만 SQUEEZE일 때 기본 가로쓰기 rectangle owner의 stored frame을 보존한다.
표를 잠깐 clone하고 그 한 flag를 기본값으로 바꾼 shape witness에 기존 검사를 적용한다.
문서의 wrap이나 renderer 판단을 변경하지 않는다. Caption, raw break, 중첩 control,
여러 rectangle, gap/overlap, track mismatch, 방향 변경, resize 등 기존 shape 제약을 유지한다.
4/66행, KEEP, 여러 SQUEEZE 셀, header/rectangle 안 SQUEEZE는 이 경로에 들어오지 않는다.

Studio의 기존 source SnapshotCommand 라우터에 이 별도 history 판단만 추가했다.
삽입/삭제/Tab/줄바꿈의 기존 mutation effects·cursor 계약과 lazy before/after snapshot을
재사용한다. 98-ID 예산과 history 클래스는 변경하지 않았다. 이번 Electron 실행은
Delete와 Shift+Enter에 한정한다. 이전 엔진에는 optional 호출이 false로 돌아가므로
기존 fallback을 유지한다.

`mergedCellNeedsTextSnapshot`과 renderer/layout/명령 core는 변경하지 않았다.
Guarded layout 대상은 계속 0이고 새 history 대상은 owner cell 24 하나다.
이 수정은 표 layout 지원 확대가 아니다.

## 실제 같은 입력의 수정 전후 Mac Electron

| 단계 | 흐름 | undo/redo 쌍 | 양형식 저장·재열기 |
| --- | ---: | ---: | ---: |
| 수정 전 재현: HWP/HWPX × Delete/Shift+Enter | 4 | 8 관찰 | 8 |
| 수정 후 같은 bytes·같은 작업 | 4 | 8 exact | 8 |

수정 전 8개 undo는 모델을 복구했지만 원본 SVG와 달랐다. 수정 후 두 cycle의
undo/redo는 전체 SVG·clip/cut, 셀/본문 문단·character ID·style·page definition을
exact하게 복구한다. 반복 머리행·후행 본문도 같은 전체 상태에 포함된다.
첫 편집 직후의 전체 SVG·모델 및 저장·재열기 결과는 수정 전과 그대로 같다.
첫 편집의 snapshot resource는 기존 0에서 정확히 1로 바뀌었다.

두 실행 모두 Node harness/app exit 0, normal quit, QA 및 seed 전후 hash 불변,
실제로 받은 WASM hash 일치다. 같은 입력 bytes와 기존 before 증거를 별도 비교기가 확인했다.
새 저장 8개는 기존 고정 Native renderer로 실제 full SVG/model 비교 및 overflow 경고 0,
개별/overall exit 0을 확인했다. PR20 metadata consumer도 새 provenance를 검증했다.
Native renderer 코드는 같으며 새 history API의 Native unit 통과를 뜻하지 않는다.

저장 8개를 실제 현재 WASM으로 읽어 guarded eligible 0/history eligible [24]를 확인했다.
HWP 입력은 HWPX로 다시 export해 포함된 `hp:tc/hp:subList` 속성을 독립 파싱했다.
모두 `(row=1,col=0,lineWrap=SQUEEZE)` 한 셀을 유지한다.

WASM scope oracle 24개에서는 같은 bytes의 전체 SVG·모델 및 기존 layout eligibility가
이전 엔진과 exact하게 같고 query가 읽기 전용이다. 실제 4/65/66행, 기본 BREAK,
multiple SQUEEZE, KEEP, owner/header/rectangle-row SQUEEZE, textDirection과 track
mismatch를 포함한다. 65행 SQUEEZE shape witness는 history owner만 허용하고
4/66행은 허용하지 않는다. 이 API 판정 검사를 실제 65행 편집 검증으로 확대 해석하지 않는다.

## 빌드·실패·보존

기존 Rust cache로 새 WASM만 필요한 빌드를 수행했다. Target 최대 4,901,335,040B는
상한 5,078,798,827B 안이며 free 최소 44,455,747,584B는 안전하한 이상이었다.
Fresh bindings를 사용한 전체 TypeScript 검사 exit 0이다. 기본 로컬 pkg의 기존
API 누락 7건은 오래된 bindings 탓이며 원래 pkg를 덮어 고치지 않았다.

Rust lib unit 필터 실행은 기존 sample 3개와 계약 crate 문서 1개가 없어 컴파일 단계에서
막혔다. 추가한 unit 두 개가 실행됐다고 주장하지 않는다. 실제 컴파일된 WASM의
24개 scope 검사와 Electron/Native 실행으로 현재 동작을 검증했다. 누락 파일을
가짜로 만들거나 관련 소스를 우회 수정하지 않았다.

보조 비교기의 embedded JS 괄호 오류, serialized 속성을 tc에서 읽던 QA 오류의
실패 두 단계도 보존했다. 최종 비교기는 실행 전 embedded JS 구문을 검사하고
실제 subList 속성을 읽는다. 이 QA 오류로 성공한 제품 실행을 다시 쓰지 않았다.
PR21의 기존 실패 두 단계 app exit 미관측/null 기록도 그대로 유지했다.

보호파일22·과거proof23·PR21의 source/proof·기존 dirty 네 파일·기존 runtime/Native/엔진은
전부 해시를 유지한다. 기존 source UI assets는 hardlink로 재사용하고 변경된 assets만
새 runtime에 만들었다. 기존 앱·beta.2·원본·캐시를 삭제하거나 교체하지 않았으며
새 .app/zip/베타는 없다. 상세 실행·source·예산 해시는 proof.json에 기록했다.

새 WASM `143713ea4cb939ac15db2b411891ffdcff551a40146a21dee182cac324fff651`
수정 전 WASM `444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988`
새 source runtime `4040dd9fad254b5bdebaa9fbe91522f00bee5c03eed7fe3faa632c6f5941dce6`
고정 Native `1801e456363aa79de62e96f60d846a30d8d37251e0bfef72bb2a2dff686ad250`

OS chooser는 QA 응답으로 통제했다. 물리 IME·수동 GUI·Linux·CI와 새로운 packaged app은
검증하지 않았다. 66행/textDirection의 기존 undo 화면 차이는 이번에 수정하지 않았고
수정 후 원래 24건 전체 batch가 통과했다고 주장하지 않는다. SVG·원본·profile/cache·
개인 경로는 공개하지 않는다.

다음 검증 후보는 불균등 track과 rectangle 밖 일반 셀의 Delete/혼합 history다.
현재 한 조건의 독립 검토 뒤 별도 재현·수정 범위를 정한다.
