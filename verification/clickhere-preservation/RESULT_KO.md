# 본문 누름틀 보존 조사와 입력 명령 수정

기준 checkout `9a74bc27c565e2217be41f20384641c8a9aac17c`. 기존 pkg WASM과 Mac Electron의 Node 실행 환경을 재사용했다. **누름틀의 전체 서식·참조 보존은 미완료다.** 실제 Mac GUI, 물리 IME, Linux 실행, 앱 패키징·공개 배포는 하지 않았다.

## 실제 수정

`rhwp-studio/src/engine/command.ts`의 `InsertTextCommand`에서 삽입 후 캐럿/서식 끝과 연속 명령 병합 위치를 `text.length` 대신 기존 `charCount(text)`로 계산한다. 엔진의 본문·셀 위치/삭제 count는 Unicode scalar 단위인데 기존 두 계산만 UTF-16 단위였다.

수정 전 `앞[빈 누름틀]뒤`에 예약 굵게 서식으로 `🙂`를 입력하면 캐럿이3으로 전진하고 이웃 `뒤`도 굵어진다. 다음 입력 `다`는 뒤에 들어간다. 수정 후 캐럿2, 이웃 서식 보존, 실제 필드 마커의 활성 필드 갱신을 거친 다음 입력은 필드 값 `🙂다`로 들어간다. 스칼라 위치의 연속 입력은 병합하고 UTF-16 길이에 따른 잘못된 간격의 입력은 병합하지 않는다. 모델이 이미 손상된 경우를 복구하는 변경은 아니다.

Rust 엔진·WASM·기존 앱에는 변경이 없다. 새 소스 수정은 기존 앱에 들어 있지 않다.

## 자동 검증

`scripts/check-clickhere-preservation.mjs`는 현재 소스의 실제 필드 삽입/속성 대화상자, 명령 콜백, WasmBridge, InputHandler 연산 라우터·필드 마커/활성화·양식 게이트·필드 이동·undo/redo 처리와 CommandHistory를 기존 WASM에 연결한다. DOM, 캐럿 좌표/화면 갱신, 플랫폼 이벤트는 어댑터이므로 GUI 성공으로 해석하지 않는다.

- 작은 합성 문서: 빈/채워진 필드 생성·속성 변경·이모지/astral/ZWJ 비조합 입력, API 값 설정/비우기, 채워진 필드 clipboard API 이동, 빈/채워진 필드 삭제.
- guide/memo/name/editable, field ID·시작/끝·문자열 관계, 모든 문자의 전체 조회 서식과 문단 속성, 다른 스타일의 문단 및 다른 문단의 각주 참조를 대조했다.
- 정상 제한 사례의 HWP/HWPX 재열기36회, undo/redo 각15회, 무변경 거절14회. 정상 저장 보고서 count0. 실제 양식 필드 앞/뒤 이동과 순환은 잠긴 필드를 건너뛰고 문서를 변경하지 않는다.
- 같은 입력 명령이 쓰이는 일반/깊이2·3 중첩 셀6개 캐시 합성자료에서 astral 입력 캐럿·이웃 서식·문단 속성·삭제 undo 회귀 검사를 통과했다. 셀 누름틀 UI 인증은 아니다.
- TypeScript `tsc --noEmit`, `git diff --check` 통과. 수정 전 명령 소스를 같은 WASM/검사기에 넣으면 첫 이모지 캐럿 `3 !== 2`에서 실패한다.

이 통과 사례는 혼합 글자 모양·다른 인라인 컨트롤을 가진 모든 문단의 보존을 뜻하지 않는다. 아래 두 실패를 같은 검사기에서 별도 재현하며 결과에 `featureComplete:false`, `knownFailures:2`를 명시한다.

합성 blank 문서의 기본 BorderFill은 **필드가 없어도** HWPX 왕복 시 fillType/patternColor/patternType 메타데이터가 바뀌었다. 최초 합성 seed만 HWPX로 초기화하고 그 뒤는 속성을 제외하지 않고 정확히 비교한다. 변경45개와 fieldCount0을 proof의 fixtureNormalization에 기록했다. 이 기본값 왕복 차이를 수정했다고 주장하지 않는다.

## 미해결 엔진 결함 두 가지

1. **기존 각주 위치 손실.** 문단 `참조문단끝`의 각주 위치2 앞 위치1에 빈 필드를 삽입하면 `getControlTextPositions`가 `[2]`에서 `[1,1]`로 바뀐다. 즉 각주는 저장 전부터1로 이동한다. HWP는 이미 잘못된 `[1,1]`을 그대로 재열고, HWPX는 `[5,5]`로 재연다. HWPX 필드 scalar 앵커도1→5, getControls의 필드/각주 raw 위치도 각각4만큼 추가 이동한다. 본문·속성은 유지되고 두 보고서 모두 count0이라 보고서만으로 잡을 수 없다.
2. **기존 혼합 글자 모양 손실.** `앞뒤가나`의 `뒤` 기울임·`가` 굵게를 지정하고 위치1에 빈 필드를 삽입하면 두 서식이 즉시 기본값으로 바뀐다. HWP/HWPX 모두 손상된 서식을 저장/재열며 count0을 보고한다. 실제 snapshot undo는 삽입 전 상태를 정확히 복원하고 redo는 손상 상태를 다시 복원한다. 안전한 편집 완료로 볼 수 없다.

소스상 공통 최소 원인은 `engine/src/document_core/queries/field_query.rs`의 `insert_click_here_field_in_para`가 원본 컨트롤 위치를 읽어 삽입 순서를 정한 뒤 `rebuild_char_offsets`를 호출하는 부분이다. 그 helper는 선행 컨트롤과 필드 begin/end 간격만 재구성해 기존 비필드 인라인 간격을 잃고, 기존 char_shapes의 raw 위치 경계도 새 축으로 옮기지 않는다. `engine/src/serializer/hwpx/section.rs`의 slot mismatch 분기는 본문 전체 뒤에 컨트롤을 방출해 HWPX의 추가 앵커 이동을 설명한다. 증거는 실제 API/직렬화 결과와 방출 XML이며, 수정의 모든 파급 범위를 확인한 것은 아니다.

최소 엔진 수정은 원본 비필드 컨트롤의 소유 위치와 글자 모양의 의미상 경계를 삽입 전 보존하고, 필드 begin/end 삽입 후 새 raw 위치 축으로 함께 재구성하는 것이다. 같은 helper를 쓰는 필드값 변경/제거·clipboard 경로도 경계별 대조가 필요하다. 위치 소유권이 불명확한 문단은 **변경 전 원자적으로 거절**해야 한다. 직렬화기의 문단 끝 fallback만 고치면 삽입 때 이미 잃은 참조/서식은 복구되지 않는다.

## 빌드 보류와 보존

target 할당량3,188,535,296bytes, 자체3GiB 상한 잔여32,690,176bytes(약31.18MiB)는 이번 전후 동일하다. 실제 디스크 부족과는 별개다. 엔진 변경을 검증할 기존-cache Native 임시 추가량100–300MiB, WASM LTO200–500MiB는 계획 추정이며 새 빌드 측정치가 아니다. 이 상한을 넘는 빌드와 임의 cache 삭제/큰 clone을 하지 않았다. 다음 엔진 작업은 빌드 예산부터 정해야 한다.

기존 source 기준1423파일 중 변경은 command.ts 하나뿐이고 engine/src1141파일은 모두 동일하다. pkg WASM 및 기존 앱4개의 app.asar SHA256도 동일하다. 사용자 원본/기본 앱·dev.3·공개 beta.2를 수정하지 않았다. 큰 기존 library suite의 누락 원본3개도 우회/대체/복원하지 않았다. 검증 프로세스는 종료했으며 검증용 GUI 창은 만들지 않았다.

전체 모델·실패 전후·저장 파일·원시 로그: `../clickhere-preservation-qa/behavior/proof.json`, `known-field-footnote.hwp/.hwpx`, `known-field-format.hwp/.hwpx`. 보존 증거: `../clickhere-preservation-qa/preservation-proof.json`.

재실행(새 빌드/설치 없음):

```sh
CLICKHERE_CELL_FIXTURES=../nested-paragraph-qa/behavior/native/proof.json \
ELECTRON_RUN_AS_NODE=1 \
../dev7-checkpoint-qa/GeulgyeolDev7.app/Contents/MacOS/GeulgyeolDev7 \
scripts/check-clickhere-preservation.mjs pkg ../clickhere-preservation-qa/behavior
```

다음 실제 확인은 엔진 두 결함 수정 뒤 Native/WASM의 동일 사례를 보존 성공으로 전환하고, 실제 Mac 누름틀 클릭/캐럿·한글 물리IME·대화상자 및 양식 이동/undo/redo를 확인하는 것이다. 긴 세로 셀 pagination/metric adapter는 기존 미지원·보류 상태를 유지한다.
