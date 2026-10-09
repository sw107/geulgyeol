# 표·셀 속성의 정밀 값 보존과 긴 가로 표 검증

## 수정 범위

기존 미커밋 수정과 QA를 `../horizontal-table-fragment-qa/writer-resume-20261009`에 SHA256 체크포인트로 보존했다. 제품 변경은 `table-cell-props-dialog.ts` 한 파일이다. 0.1mm로 표시된 셀 너비·높이와 셀/표 안쪽 여백을 사용자가 바꾸지 않았다면 원래 HWPUNIT를 유지한다. 높이만 변경하면서 너비7000이7002로 반올림되던 결함을 고쳤다. 바깥 여백의 기존 정밀 값 보존 helper를 안쪽 여백에도 사용한다. 엔진 제품 소스와 WASM은 변경하지 않았다.

검토된 여백 수정 `e3422a4fbd0f9076211ab1e6017d8134f8dd8741`은 [draft PR #3](https://github.com/sw107/geulgyeol/pull/3)에 남기고 이 후속은 별도 브랜치로 정리한다. 이전 앱·공개beta.2·원본·QA를 교체하거나 삭제하지 않았다. 새 설치 앱/ZIP을 만들지 않았다.

## 반복 머리행 차이의 판정

기존 `full-2`는 반복 머리행 입력 뒤 아래 행과 후행 본문이 재열기 때21.33px 내려가는 차이를 기록했다. 실제 Electron 관찰에서 비교 당시 `hasDeferredPaginationPending()`이 true였다. 제품의 실제 idle 완료를 기다리면 재열기와 동일한 SVG가 나왔다. QA의 두 번 RAF/250ms 타이머는 지연 페이지 계산 완료를 보장하지 않았다.

QA는 입력·undo·redo 모두 실제 pending 해제를 관찰하고 비교하도록 수정했다. 테스트에서 강제로 엔진 flush를 호출하지 않는다. 기존 redo 결함을 새 결함으로 보고하거나 엔진을 다시 수정하지 않았다. 긴 내용의 셀에서 선언 최소 높이가 바뀌어도 실제 행높이는 유지될 수 있어, 높이 변경은 저장 속성·이력·다른 속성 보존과 재열기로 판정한다.

JS 문서 이력 비교는 모델/전체SVG/스타일/참조를 정확히 비교하고 HWP/HWPX 컨테이너 바이트를 이력 동일성에서 제외한다. 저장 경로에서는 현재 export와 실제 IPC 저장 파일의 SHA256을 정확히 대조한다. Native API JSON의0.0과 JS JSON.stringify의0만 정확한 정수 범위에서 정규화하며, 소수 값의 차이는 허용하지 않는다.

## 결과

| 검사 | 결과 |
| --- | --- |
| 실제 Mac Electron 긴 가로표 | 3합성 seed × HWP/HWPX,44사례; 첫/중간/끝 fragment 입력, 단일/전체 치환, 크기 no-op, 높이 증가/감소 |
| 이력·양형식 실제 저장/재열기 | undo/redo76쌍, 저장·재열기76건; 페이지 수·전체SVG·본문·셀/문단 속성·문자모양ID·스타일 보존 |
| 반복 머리행·후행본문 | 반복 대상 머리행만 각 fragment에 출력, 각 내용/후행본문 소유 정확, 마지막 행 뒤 후행본문 유지 |
| 유효 음수·경계의 새 UI 입력 | 네 방향 × -32768/-850/32767 × HWP/HWPX,24건; undo/redo24쌍, 실제 저장재열기48건 |
| 독립 Native 동일 바이트 대조 | 위76+48=124파일; 전체SVG·페이지 수·본문·셀·문단/문자모양ID·스타일 정확 일치 |
| 현재 소스 검증 | 실제 엔진 DTS를 지정한 TypeScript, Node 문법2개, rustfmt, git diff --check 모두0 |
| 현재 UI 빌드 | Vite 새 빌드16자산 전부 기존 테스트 번들과 바이트 일치; 동일 자산/엔진 hardlink 재사용 |
| 실행 수명 | 최종 가로표·경계 QA 앱 모두 정상 종료0, renderer 오류0 |

[증거·행렬·SHA256](proof.json). WASM SHA256은 `14c6978c7712faf84846c65619adc137bd923b17c3d47fd715544dc76fd1ec99`다. 기존Native 캐시를 재사용해 검증 예제만 빌드했다. target peak4,764,250,112bytes, 더 보수적인4.48GiB(4,810,363,371bytes) 상한 이내였다. 이번 검증 묶음 완료 시 전체 가로표 QA는 약962MiB로, 이전 실패 기록과 새 상태 JSON을 모두 보존했다. 추가 캐시 정리·영구 삭제는 하지 않았다.

현재 checkout의 기본 `pkg` DTS는 오래된 상태라 직접 기본 tsconfig를 실행하면 기존5개 API가 누락된다. 이번 TypeScript 검사는 실제 실행 엔진 `../table-margin-range-qa/pkg`의 bindings와 기존 node_modules/@types를 지정한 외부 tsconfig로 수행했다. 기본 pkg를 덮어써 이 제한을 숨기지 않았다.

## 한계와 다음 구현 후보

실제 Electron 자동 검증은 선택/읽기용 private handle과 OS 응답 adapter를 사용한다. 물리 IME·수동 pointer/GUI·실제 OS 파일선택창·설치 패키지·한컴·Linux는 검증하지 않았다. SVG 왕복 일치는 조판의 절대 정확성을 보장하지 않는다.

`shrink` 단일 치환의 HWP/HWPX 입력·출력4파일은 첫 fragment의 표 아래선이1019.893px로, 본문 하한1009.1px를10.8px 초과한다는 Native 진단을 남긴다. 텍스트 소유와 저장/재열기 일치는 통과했으나 이 overflow를 해결한 것은 아니다. 합성 seed의 앵커 본문과 첫 표 행이 가까워 겹쳐 보이는 기존 화면도 그대로 남는다.

다음 좁은 구현 후보는 이 긴 RowBreak 셀 단일 치환의 첫 fragment overflow를 재현하고 행높이/분할 경계의 원인을 수정하는 것이다. 머리행·후행본문·문자/문단 참조를 그대로 유지하는 이번76파일을 회귀 기준으로 사용할 수 있다. 물리 Mac IME/선택창 검증과 Linux 부가 검증은 별도 단계다.

## 재실행

현재 엔진과 소스의 private QA UI를 `scripts/build-electron-table-margin-qa.mjs QA_ROOT PHASE ENGINE_DIR`로 새 출력 폴더에 구성한다. `ENGINE_DIR`에는 실제 `rhwp.js/rhwp_bg.wasm`과 두 DTS가 필요하다. 기존 합성 seed 경로는 각 JS 상단에 명시돼 있다.

```sh
node scripts/check-electron-horizontal-table.mjs QA_ROOT/PHASE ENGINE_DIR
node scripts/check-electron-table-margin-boundaries.mjs QA_ROOT/BOUNDARY_PHASE ENGINE_DIR
cargo run --offline --locked --manifest-path engine/Cargo.toml --example horizontal_table_saved_check -- QA_ROOT/PHASE/manifest.json OUTPUT_DIR
```

두Electron 실행은 별도 fresh QA 폴더의runtime/bootstrap/files를 사용하며 같은 입력 폴더를 재사용하면 audit 검사에서 거절한다. 실제 Mac Electron44.3.0이 필요하다. Native 예제는 기존 target와debug0/incrementaloff/jobs2를 지정해 실행하며 재빌드 예산을 감시한다. 전체Rust lib 테스트의 기존 누락fixture 제한을 이 독립 예제로 해결한 것으로 주장하지 않는다.
