# 중첩 표 셀 모양복사/붙여넣기 개발 후보

기준 `af5809c`에서 중첩 셀 블록의 모양 붙여넣기는 명시적으로 거절됐고, 복사할 셀/문단 모양도 flat 주소로 조회했다. 셀 블록에는 셀 자체 속성을, 텍스트 선택에는 선택 글자 모양과 해당 문단 모양을 적용하도록 엔진·WASM·Bridge·InputHandler를 연결했다. 본문·일반 셀의 기존 명령 흐름은 유지했다.

셀 자체 모양은 여백·세로 정렬·방향·머리셀·보호·필드·테두리/배경 참조만 복사한다. 너비/높이·병합 구조·텍스트·글자/문단 모양·스타일 ID는 복사하지 않는다. 영역 테두리는 복사 원본에서 제외하며, 대상 영역이 동일 테두리 ID를 이미 덮고 있으면 기존 flat setter처럼 셀 ID를 유지한다. 제외 셀을 반영하고 중첩 대상 전부를 단일 snapshot/batch 명령으로 처리한다.

텍스트 선택은 같은 최내곽 셀 안에서만 허용한다. 글자 적용 범위는 Unicode scalar 좌표이며, 선택 끝 offset 0의 문단에도 문단 모양은 적용하되 글자 모양은 적용하지 않는다. 스타일 ID와 기존 문서 정의/참조는 유지한다. 복사 상태는 성공 시 한 번 소비하며 재복사 후 반복 붙여넣기가 가능하다.

새 경로 API는 엄격한 JSON 주소와 표만 연결된 경로(깊이 1..64)를 받는다. 모든 대상 주소·선택 범위·지원 항목·글꼴/번호/테두리 참조를 변경 전에 검증한다. 잘못된 후속 대상, 다른 셀을 가로지르는 선택, 비표 컨트롤 경로는 무변경으로 거절한다. UI 실패는 기존 SnapshotCommand의 rollback을 사용하며 복사 상태를 유지한다. 번호/글머리 참조는 적용될 문단 머리 유형별 정의 목록을 검사한다. 서로 다른 목록의 길이 최댓값으로 검사하면 잘못된 참조를 허용하는 사례를 최초 후보 WASM에서 재현해 보완했다. 기존 범용 경로 파서는 변경하지 않았다.

## 자동 검증

실제 새 WASM 및 실제 InputHandler/Bridge/명령 코드로 실행했다. UI 검사에서는 DOM·커서를 mock으로 제공하고, 명령 dispatch는 실제 SnapshotCommand/ApplyCharFormatCommand/ApplyParaFormatCommand를 호출하는 headless adapter다. 실제 화면 이벤트·CommandHistory 전체 흐름의 성공을 주장하지 않는다. 깊이 1·2·3, 병합/비병합, 다중 셀 및 제외 셀, 본문/셀 텍스트 선택, 끝 offset 0, 반복 붙여넣기를 포함한다.

| 검사 | 결과 |
|---|---|
| 새 UI 명령 | 30건, 이력 복원 180회, HWP/HWPX 재열기 60건, 무변경 거절 44건, 재복사/붙여넣기 30회 |
| 새 네이티브 문서 검사 | 6개 합성 입력, 이력 복원 72회, 재열기 36건, 무변경 거절 78건, 영역 테두리 6건 |
| 스타일 전파 | 48건, 이력 복원 96회, 재열기 96건, 거절 17건 |
| 스타일 삭제 | 16건, 재열기 32건, 거절 11건 |
| nextStyle Enter | 162건, 이력 복원 288회, 재열기 324건, 거절 126건 |
| 셀 치환 이력/레이아웃 | 24건, 이력 복원 170회, 재열기 82건, SVG·행/쪽 형상 동일 |
| Unicode 검색/치환 | 408건(UI 272건), 이력 복원 640회, 재열기 2096건 |
| 저장 줄 회전 그룹 해제 | 108건, 저장재열기 216건, 무변경 거절 14건 |
| 표 셀 다중 수식 | 72건, 이력 복원 504회, 재열기 288건, 거절 10건 |
| 수식 검색 경계 | 12건, 재열기 24건, 비지원/빈 선택 무변경 4건 |
| 데스크톱 자동 테스트 | 통과 30, 실패 0, skip 1, TODO 1 (`server.test.cjs` 제외: 기존 sandbox 제약) |
| TypeScript / Vite / native·WASM Clippy | 모두 성공, Clippy `-D warnings` |

네이티브 검사에서 셀 모양 변경 후 텍스트·글자/문단 모양·스타일 ID·컨트롤과 기존 문서 정의를 비교했다. 재계산되는 line segment는 내용 비교에서만 제외했고, undo/redo는 전체 문서 모델(overflow memo와 Table.dirty만 정규화) 및 페이지 SVG를 정확히 비교했다. UI 검사 역시 각 글자/문단/셀 속성과 SVG의 이력 복원을 비교한다. 저장재열기는 내용·모양을 비교하며 새 모양복사 저장 SVG의 완전 동일성을 주장하지 않는다.

전체 라이브러리 테스트는 필터 없이 `cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib`를 실행했으나 아래 `include_bytes!` 3개 때문에 컴파일 exit101이었다. 라이브러리 런타임 테스트는 실행되지 않았다. 권리·민감정보 확인 없이 corpus를 복원/대체하거나 테스트를 제거/skip하지 않았다. 앞 작업에서 복원한 허용 fixture 7개와 라이선스 4개는 hash 재검증을 통과했다.

- `engine/samples/3-09월_교육_통합_2022.hwp`
- `engine/samples/hwp3-sample16-hwp5.hwp`
- `engine/samples/hwpx/aift.hwpx`

## 산출물과 재현

개발 checkout은 `/Users/sw107/Documents/Codex/2026-10-06/task/geulgyeol-dev-propagation`, 상세 로그·합성 문서·빌드 증거는 인접 `nested-format-copy-qa`에 있다. 기준의 거절 재현 증거는 `library-fixtures-qa/next-feature-proof.json`을 재사용했으며 기준 소스 SHA를 다시 확인했다.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example nested_format_copy_check -- OUTPUT_DIR
node scripts/check-nested-format-copy-wasm.mjs pkg OUTPUT_DIR UI_OUTPUT_DIR
node scripts/check-cell-layout-history.mjs pkg CELL_QA_DIR
```

사용 도구는 Rust 1.93.1 / wasm-bindgen 0.2.127 / Node 22.18.0이다. WASM은 release 기본 LTO로 다시 빌드했고 빌드 중/후 엔진 소스 hash가 일치했다. Vite 출력의 엔진 WASM도 테스트한 WASM과 같다. 공유 Cargo target을 재사용했고 3GiB 상한을 넘지 않았다. Vite에는 기존 500kB chunk 경고가 있다.

실제 Mac GUI·물리 IME·Linux 실행은 검증하지 않았다. 앱/ZIP를 새로 패키징하거나 원격에 push/release하지 않았다. 원본 문서·기존 dev.3/기본 앱·공개 beta.2는 건드리지 않았고 보호 대상 app.asar 2개의 SHA가 유지됐다.

다음 수동 확인은 Mac에서 실제 F5/제외 셀 선택과 단축키 모양복사, 2·3단계 중첩 표, 한 번 소비/재복사, undo/redo 후 화면·캐럿 위치, 저장재열기, 한국어 IME를 점검하는 것이다. corpus 3개는 권리·비민감성 확인과 확보 후 전체 라이브러리 검사를 다시 실행해야 한다.
