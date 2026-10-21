# 셀 문단의 누름틀·하이퍼링크 혼합 편집

새 문서와 표를 만드는 정상 공개 API로 한 셀 문단에 누름틀과 선택 텍스트 하이퍼링크를 넣으면, 필드 밖에서 Enter를 누른 뒤 누름틀 값 변경이 제어 토큰 오류로 거절된다. Backspace로 합쳐도 거절 상태가 남는다. 수정 전 SDK에서 이 과정을 재현했고, 저장한 HWPX를 다시 열면 값 변경이 가능해지는 것도 확인했다. 모델을 직접 고치거나 비정상 XML을 넣은 재현이 아니다.

`Paragraph::split_at`과 `merge_from`은 필드 소유 컨트롤만 세어 짝을 이루는 FIELD_END 슬롯을 빠뜨린다. 기존 셀 복원 경로는 ClickHere만 허용해 Hyperlink가 하나라도 있으면 복원을 건너뛰었다. 두 타입은 이미 지원하는 텍스트 필드이며 같은 BEGIN/END 구조를 사용한다. 이 둘만 포함하고 기존 축 검사를 통과한 셀 문단에 복원을 적용한다. 분할 후 하이퍼링크만 남은 문단도 병합 전에 검증할 수 있어야 한다.

필드 내부 분할, 다른 컨트롤이나 필드 타입, 범위 태그, 불명확한 소유권 및 잘못된 문자 축의 기존 조건은 유지한다. 본문·표 캡션·그림 캡션·글상자 경로와 중첩 표 배치는 변경하지 않는다.

검증용 입력은 공개 API로 새로 만든 합성 문서이며 외부 문서 파일을 추가하지 않는다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml --example mixed_cell_field_structure_check
TARGET/debug/examples/mixed_cell_field_structure_check OUTPUT/native
node scripts/build-wasm-release.mjs OUTPUT/pkg
node scripts/check-mixed-cell-field-structure.mjs fixed OUTPUT/pkg OUTPUT/sdk-mixed
```

SDK 검사는 현재 제품의 분할·병합 명령, WasmBridge 메서드와 CommandHistory를 읽어 실행한다. 누름틀·링크 순서, 빈 누름틀, 인접 필드, 여러 누름틀, 서로 다른 다음 스타일을 다루며 값·URL 변경, undo/redo, 주변 문단과 셀, 글자·문단 모양, HWP/HWPX 재열기와 SVG 일치를 검사한다. `fixed` 검사는 하나라도 실패하면 종료 코드가 0이 아니다. 실제 GUI나 물리 IME 검증을 대신하지 않는다.

## 현재 검증 범위

Native 예제 빌드와 68개 사례가 통과했다. 204개 상태에서 408회 HWP/HWPX 저장·재열기 및 값 변경·스냅샷 복원을 검사했다. 수정 전 main SDK는 새 SDK 검사를 제어 토큰 오류로 통과하지 못한다.

수정 후 WASM은 오프라인·잠금 파일·고정 도구 버전으로 빌드했고 경로 정보 검사도 통과했다. 혼합 필드 SDK 84개 사례의 588개 상태에서 값 변경 2,100회, 링크 주소 변경 1,764회, 스냅샷 복원 3,864회, HWP/HWPX 저장·재열기 1,176회가 통과했다. 별도 새 프로세스에서 같은 1,176개 저장본과 값 변경 1,400회를 검사했으며 모델·SVG 차이는 없었다. 기존 누름틀 구조 108개 사례의 756개 상태와 재열기 1,512회도 통과했다. 의도적으로 필드 내부를 가른 4개 사례는 기존 SDK와 모델·SVG·저장본·거절 결과가 동일했으며 지원 성공 수치로 세지 않았다.

추가 18개 검사 묶음도 통과했다. 필드 값 원자성, 셀·본문 하이퍼링크, 이름 필드, 메모·설정과 XML, 네임스페이스 XML, 미주·수식, Studio 및 새 SDK 타입, 호스트 저장·이력 20건과 Studio 90건을 포함한다. 기존 검증 드라이버 3개의 누락 의존성은 검증 폴더의 어댑터에서 실제 제품 모듈을 연결했으며 원래 assertion은 유지했다. 저장소의 기존 검사 파일은 바꾸지 않았다.

실제 앱·한글 왕복, 물리 IME, 전체 Rust 검사와 CI는 이번 실행에서 검증하지 않았다. 기존 누락 입력·별도 assertion 실패·Native ABI 중단을 성공으로 계산하지 않는다. 독립 검토 전 병합하지 않는다.
