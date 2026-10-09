# 긴 병합 셀의 줄바꿈과 직접 삭제 이력

PR8이 병합된 main `5ded4ed8cd4ac3834aacb6665a5e1edeb684ac72`에서 이어지는 UI 수정이다. PR8 소스 `7b5a028620e8e810bdd122c454d7d2a274b8f015`, PR9 후보 브랜치 `fda752466027f12a6d23b508891bbb581199149d`, 별도 병렬 표 로컬 체크포인트 `778a1cf34e99060f2f3d02371b5db1a7bf3f13d9`를 보존했다.

## 재현과 수정

검증된 합성 partial-long-rowspan HWP/HWPX를 사용했다. 저장 줄 프레임이 남은 47행 병합 셀의 중간 조각에서 실제 Shift+Enter 후 undo 하면 7번 페이지 clip 높이가 693.36px에서 707.76px로 14.4px 바뀌었다. InputHandler의 해당 원본 snapshot 판정에 insertLineBreak가 빠져 있었다. 기존의 단일 열·전체 rowspan·수평 일반 텍스트 판정 범위에 이 명령을 추가한다. 이전에 해결한 redo 결함을 새 결함으로 보고한 것이 아니다.

직접 Delete로 첫 병합 문단의 첫 글자를 지운 뒤에는 정상 지연 처리를 기다려도 일부 페이지의 테두리가 본문을 8.0267px 넘었고 redo의 전체 SVG가 달랐다. snapshot wrapper가 원래 DeleteTextCommand의 TextMutationEffects를 전달하지 않아 제품의 지연 페이지 재배치가 예약되지 않은 별도 누락이었다. 최초 실행에서 원래 명령의 effect를 한 번 소비해 wrapper가 기존 coordinator에 전달하고, snapshot restore redo와 effect 없는 즉시 명령에는 기존 immediate contract를 전달한다. 적용 범위는 기존 source snapshot wrapper이며 원래의 anchored body 편집도 회귀 검증했다. 이력 예산이나 composition cache를 늘리지 않는다.

Rust의 visible-tail grace를 끄는 가설은 같은 실패를 해결하지 못해 철회했다. 해당 patch와 실패 QA는 보존했으며 최종 Rust diff는 없다. 최종 검사는 PR8 WASM과 소스가 일치하는 보존 Native 바이너리를 사용했다. 새 Native/WASM 빌드나 기존 후보 앱 변경을 주장하지 않는다.

## 실제 Mac 검증

- 새 20사례: 첫·중간·끝 병합 문단의 실제 Shift+Enter와 forward Delete, Tab의 다음 셀 이동 및 마지막 셀에서 한 행 추가, 6단계 연속 편집을 양형식에서 검사했다. Tab은 셀 이동·행 추가이며 tab 문자 삽입 검증으로 세지 않는다. 첫·중간·끝 셀 대상은 문단 0·23·46, 페이지 0·5·10이다.
- 연속 편집은 문자 입력 → Shift+Enter → Delete → Backspace → Tab 행 추가 → 새 행 문자 입력이다. 중간마다 정상 제품 완료를 기다린 기준과, 중간 pagination 대기 없이 실행한 burst를 각각 검사했다. burst 동안 pending=true인 단계가 실제 관찰됐다. 여섯 단계의 모든 중간 상태를 각각 두 차례 undo/redo하며 전체 SVG와 모델을 비교했다. 별도 테스트 전용 강제 pagination flush는 없다.
- 새 검증 undo/redo 76쌍, 실제 호스트 IPC 저장·재열기 36건, 그림 검사 66회/792쪽. 기존 PR8의 7종·114사례 회귀는 200쌍/200건, 314회/3366쪽이다. 합계 134사례·276쌍·236건·380회/4158쪽이며 숨김 0·부분 잘림 0·렌더러 오류 0이다. 각각 정상 Quit·앱 프로세스 종료 코드 0이다. Node 하네스 종료 0은 작성자의 실행 wrapper 보고이며, 별도 원시 하네스 종료 JSON은 보존하지 않았다. 기존 proof의 exitCode를 하네스 값으로 취급하지 않는다.
- 전체 SVG·쪽 수·표 위치와 쪽 정의·셀 격자·문단/문자 속성·본문 및 셀 소유자 순서·반복 머리행·후행 본문이 보존된다. 내용 편집은 격자를 바꾸지 않으며 Tab 행 추가는 기존 셀/본문/스타일을 보존한다. snapshot 자원은 한 항목당 기존 bounded 계약을 지키고 재열기 후 0개로 해제된다. 새 검증의 테두리와 글자는 본문 하단 안쪽 최소 6.3733px, 전체 회귀의 테두리는 최소 0.3733px·글자는 최소 5.2532px다. 기존 2px 허용치는 유지한다.
- Tab으로 추가한 아래 행에 상속된 isHeader=true를 모두 반복 머리행으로 세던 QA oracle을 수정했다. 제품의 기존 상단 연속 머리행 계약에 맞춰 그 아래 행은 단 한 번 소유되어야 한다고 검사한다. 이 중간 실패는 제품 본문 중복 결함으로 주장하지 않는다.
- 독립 Native 비교는 새 실제 저장 236건 + 이전 실제 저장 296건 = 532건 전부 전체 모델·SVG 일치, LAYOUT_OVERFLOW 0이다. 별도 API 경계 16건까지 총 548건이며 실제 초과 경고 네 건과 제외 계약 두 건은 보존된다. API 파일은 실제 Electron 저장 건수에 더하지 않는다. snapshot 읽기 전용 판정 17건, TypeScript·Node 구문·diff 공백 검사도 통과했다.

WASM/실제 앱 수신 바이트 SHA256은 `b5b5b2fc52dedbd0140322497e7fe792c9a34f8568ed8bc8f02dbd341a67474b`다. Native SHA256은 `8d14a5682372c5b681929d87699774d85c64f0a887bf506e19d89963590b0cbc`이며 PR8 빌드의 보존 체크포인트와 일치한다. 기존 GeulgyeolBeta3.app의 ASAR SHA256 `e94f2bfc1b0cb1911c358fe16e036935c7ad8514ee4923bff89555f05990e15e`는 그대로다. 공개 ZIP·태그·릴리스·새 패키지는 만들지 않았다.

## 재실행과 남은 범위

기존 합성 seed에 `node scripts/prepare-merged-cell-text-history.mjs <stored-seeds.json> <새 history-seeds.json>`를 실행한다. 기존 build-current 도구로 현재 UI와 PR8 pkg의 QA 런타임을 만든 뒤 `GEULGYEOL_HOST_SEEDS=<history-seeds.json> node scripts/check-electron-stored-merged-fragments.mjs <QA 경로> <PR8 pkg>`를 실행한다. 원래 stored-seeds.json을 사용하면 114사례 회귀다. 저장 manifest는 `horizontal_table_saved_check <manifest.json> <새 출력 경로>`로 독립 비교한다. raw source·저장 파일·상태·전체 SVG·실패 기록은 저장소 밖 `../merged-cell-text-history-qa/` 및 이전 QA에 보존한다. 공개 문서에는 합성 출처와 해시·요약만 포함한다.

한컴에서 직접 작성·저장한 부분 프레임 원본은 확보하지 못했고 한컴 화면 일치를 주장하지 않는다. 물리 IME·OS 파일 선택창·수동 GUI·Linux 검증은 남아 있다. 전체 Rust lib 테스트는 기존 include_bytes 원본 세 개 누락으로 실행 불가이며 이번 수정에는 Rust 변경이 없다. 병렬/혼합 rowspan의 독립 소유자 문제는 별도 로컬 체크포인트에서 재현·부분 수정 중이다. 다음 구현 후보는 그 경로의 정확한 소유자 분할과 이력이다. 기존 beta.3 후보의 공개는 이 수정의 독립 검토 및 별도 후보 반영 전까지 보류하며, 이번 묶음의 통과를 전체 개발 완료로 해석하지 않는다.
