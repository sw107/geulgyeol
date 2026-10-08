# 중첩 셀 직접 문단 서식 검증

기준 `6e46c09934fdfdf990ce9323427b0f11c87e8b7e`에서 dev.6을 보존하고 별도 checkout에서 작업했다. 기존 UI 차단 8건(깊이 2·3의 조회, 정렬, 줄 간격, F5 블록)을 해결했다.

## 변경

- `applyParaFormatInCellsByPaths`로 모든 표 경로·문단·기존 모양/스타일/글자/탭/번호 참조와 입력 속성을 먼저 검증한다. 경로 중복을 제거하고, 잘못된 대상이 섞여도 정의·문서·이력을 변경하지 않는다. 비표 컨트롤 경로는 거절한다.
- 문단 조회, 정렬, 줄 간격, 대화상자 속성, 다중 문단·역방향 선택, F5 셀 블록/제외 셀, Shift+Tab 내어쓰기가 가장 안쪽 문단을 사용한다. 서로 다른 셀/상위 경로의 텍스트 범위는 기존 무변경 거절 경계를 유지한다.
- 문단 대화상자의 `borderFillId`는 검증된 기존 테두리 seed로 받는다. 생략한 테두리·배경 요소는 대상 문단에서 보존하고 새 단색 배경의 생략된 무늬는 없음(-1)으로 잡는다.
- 셀 문단 명령은 SnapshotCommand로 정확한 모델과 저장된 줄 정보를 복원한다. 새 검증에서 발견한 일반 셀 undo의 SVG 변경도 수정했다. 본문 이력 경로는 유지한다. snapshot 수·해제·무변경 상태를 CommandHistory에 전달하여 기존 98-ID 예산을 적용한다.
- 중첩 셀 스타일 **지정**은 이전 비지원 경계를 유지한다. 이 작업은 직접 문단 서식이며 기존 스타일 전파/삭제, 모양복사, 수식, 회전 그룹 개선을 유지한다.

## 결과

| 검사 | 결과 |
|---|---|
| 네이티브, 깊이 1~3 × 병합 유무 × 수식 유무 | 48사례, 정확한 이력 복원 288회, HWP/HWPX 재열기 96회, 무변경 거절 720회 |
| 실제 WASM + UI 메서드 + CommandHistory | 108사례, 기존 차단 8건 해소, 이력 복원 648회, 재열기 216회, 거절 80회 |
| UI 저장 전체 페이지 SVG | 216/216 정확 일치; 대표 표 clip/page 비교도 통과 |
| 실제 CommandHistory 예산/분기/해제 | 3깊이, 375명령, 복원 129회; live snapshot ≤98, clear 후 0 |
| UI 저장 파일 네이티브 참조 대조 | 216건: 스타일/글자 run/수식 script·크기·색·instance·위치 및 본문 보존 |
| 기존 모양복사 | 네이티브 6입력/복원72/재열기36/거절78; WASM UI 30사례/복원180/재열기60/거절44 |
| 기존 검색 | 408사례(UI272)/복원640/재열기2096, 이력 SVG 차이 0 |
| 기존 표 치환 이력 | 24사례/복원170/재열기82/거절4, 레이아웃 차이 0 |
| 기존 next-style UI | 11사례 통과(mock, WASM/GUI 검사 아님) |
| TypeScript / Vite / native·WASM Clippy | 통과, Clippy -D warnings |

네이티브 내용 비교는 선택 문단 모양 ID와 파생 line segment/dirty/cache만 정규화하고 나머지 문서와 기존 정의를 비교했다. undo/redo는 문서 모델과 전체 SVG를 정확 비교했다. 저장된 본문의 표현 메타데이터는 미편집 같은 형식 roundtrip과 비교했고, native/WASM HWP writer의 raw 헤더·SectionDef 뒤쪽 0 padding만 정규화했다. 스타일 값과 수식/글자/논리 컨트롤 참조는 입력과 직접 비교했다.

WASM SHA256: `51986b31898b3854c84f297403cd0fdfb81a9a8cd3c8f12e99bdec480d118e14`. 엔진 빌드 전후/완료 소스 hash 및 Vite 엔진 hash가 일치한다. 기존 target 재사용, 3GiB 상한 준수. dev.6/dev.5/BetaNext 보호 ASAR hash 3개 유지, 허용 fixture 11개 검증/복원0.

## 한계와 다음 확인

실제 Mac GUI·물리 IME·Linux 실행은 미검증이다. Electron은 dev.6을 Node 모드로만 사용했으며 UI 검사 DOM/커서는 mock, 명령 dispatch는 adapter다. 새 앱/설치/서명/배포/원격 변경은 없다. 셀 서식 snapshot은 기존 예산으로 제한되지만 큰 문서의 메모리·GUI 반응성은 별도 실측이 필요하다.

전체 라이브러리 테스트는 이전 무필터 검사에서 아래 include_bytes fixture 누락 때문에 컴파일 exit101, 런타임 실행0이었다. 이번에 재시도·복원·대체·스킵하지 않았다.

- `engine/samples/3-09월_교육_통합_2022.hwp`
- `engine/samples/hwp3-sample16-hwp5.hwp`
- `engine/samples/hwpx/aift.hwpx`

다음 확인은 실제 Mac에서 깊이 2·3의 F5/문단 대화상자/Shift+Tab 및 undo/redo·저장재열기, 큰 문서 snapshot 메모리다. 중첩 셀 스타일 지정과 비표/머리말/각주 직접 경로 확장은 별도 범위로 검토한다. 로컬 커밋만 보존하고 push/release는 보류한다.

## 재현

기존 offline Cargo/toolchain/target 환경을 사용한다. `cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp --example nested_paragraph_format_check -- OUTPUT`로 합성 입력과 네이티브 검증을 생성한다. `scripts/check-nested-paragraph-format.mjs ENGINE_DIR INPUT_DIR OUTPUT_DIR`는 생성된 proof.json 입력을 사용한다. `--example nested_paragraph_format_check -- --verify-ui UI_EXPORT_MANIFEST OUTPUT`는 저장 참조를 대조한다. dev.6 Electron 실행 시 ELECTRON_RUN_AS_NODE=1을 설정한다.

원시 로그·출력·build proof는 checkout 밖 `../nested-paragraph-qa/`, 요약 및 소스 hash는 같은 폴더의 proof.json에 있다.
