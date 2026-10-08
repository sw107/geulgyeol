# 세로 셀 열·문자 소유권: 독립 계산 모듈

기준 `06ba4dcb1777a15959d407eb6fed83b4c3e2518a`, checkout `geulgyeol-dev-propagation`, branch `dev/style-propagation`. 이번 범위는 **단일 일반 셀의 단순 세로 텍스트를 위한 계산·검증**이다. 기존 측정·pagination·renderer/API/UI에는 연결하지 않았다. 실제 세로 페이지 나눔 결함은 그대로이며 수정 완료로 주장하지 않는다.

## 구현

`engine/crates/rhwp-vertical-cell-plan`을 별도 workspace crate로 추가했다. production dependency는 std뿐이다. `rhwp`의 dependency와 Cargo.toml은 바뀌지 않았고 Cargo.lock은 새 패키지 항목만 추가됐다. JSON 예제의 serde_json은 기존 캐시에 있는 dev dependency이다.

입력은 원본 문단·Unicode scalar 구간을 가진 불가분 문자 묶음, 회전 후 글자 크기/advance, 열 너비/간격, 실제 사용 가능한 폭·높이와 열 진행 방향이다. 방향1/2는 RTL 열 진행으로 전달하며 실제 회전은 caller의 metric에 반영하는 계약이다. 픽셀 1/1024 정수로 계산하고 가용 영역은 안쪽으로, 글자 크기는 바깥쪽으로 반올림한다. 폰트 shaping·문자 묶음 판별·페이지 할당은 수행하지 않는다.

문단은 새 열에서 시작하며 긴 문단은 열과 조각을 넘어간다. 빈 문단도 열 하나와 원본0..0 marker 하나를 소유한다. 다음 글자나 열을 넣을 공간이 없으면 다음 조각으로 넘어간다. 결과는 원본 문단 인덱스/문자 구간/문단 열 인덱스/입력 조각 인덱스와 bbox를 보존한다. 작은 조각을 건너뛰어도 인덱스를 다시 매기지 않는다. 잘못된 구간·영 크기·좌표 overflow·너무 큰 글자·조각 부족은 **부분 결과 없이 거절**하고 입력은 변경하지 않는다.

## 검증 결과

- Mac arm64 Native 독립 테스트14개 통과. 각 scalar의 소유권1회, unit 순서·범위와 bbox를 내부 배치 코드를 사용하지 않는 별도 oracle로 검증했다. 긴1001문자, 빈 문단, 한글/영문/결합악센트/ZWJ·국기 이모지, 다양한 크기, 회전/upright 공급 metric의 다른 컷, 정확한 고정소수 경계, 조각 부족, malformed 입력/overflow를 포함한다. 생성600입력을 두 열 방향에서 검사한1,200회 ownership audit도 포함한다.
- 새 crate만 Native all-targets Clippy와 wasm32 lib Clippy `-D warnings` 통과. 전체 엔진/UI/WASM 재빌드, 새 앱 패키징은 수행하지 않았다. 첫 Clippy는 의도적으로 잘못된 Range를 만드는 테스트 표현 lint로 실패했고 tuple→Range 생성으로 수정한 후 통과했다. 실패 로그도 QA 폴더에 남겼다.
- 기존 합성 재현물의 세로 방향1/2 ×1/124문단 × HWP/HWPX =8개를 **읽기 전용 텍스트 투영**하여 계획했다. 원본은 번호와 인접 셀을 포함하므로 `productionEligible:false`, 번호/다중 셀 행 의미는 검사 범위에서 제외했다. 실제 glyph shaping 대신 caller가 제공하는 보수적 정사각 폰트 metric으로 기하 계약만 검사했다.
- 1문단7문자는1조각에서1회 소유된다. 124문단1,006문자는 기존 실제 조각4개로는 문단42에서 공간 부족으로 거절된다. 별도의 가상 continuation7개를 더 주면11조각/130열에서 중복0·누락0·경계 위반0·순서 보존을 확인했다. HWP/HWPX 각 쌍의 계획은 동일하다. **11조각은 계산 입력을 확장한 결과이며 실제 앱 페이지 수가 아니다.**

실제 입력/전체 unit별 계획/빌드 로그는 `../vertical-cell-plan-qa/`, 요약 증거는 이 폴더의 `proof.json`에 있다. projector 실행은 `scripts/project-vertical-cell-plan.mjs`, Native JSON 예제는 crate의 `examples/plan_fixture.rs`이다. 재실행/계약 상세는 crate `README.md`에 있다.

## 통합 지점과 안전한 legacy fallback

1. `table_layout.rs`의 `cell_units_uncached`/`calc_vertical_cell_content_height`와 pagination이 같은 **열·문자** 예산을 공유해야 한다. 기존 가로 높이 컷을 x축 소비량으로 재사용하지 않는다. 인접 셀·행 높이·RowBreak에 맞는 추가 조각 할당 정책은 아직 설계/검증이 필요하다.
2. `table_partial.rs`는 해당 조각의 소유 문단·scalar 범위를 원본 인덱스로 넘겨야 한다. 문단 Vec slicing으로 편집 인덱스를0부터 다시 만들지 않는다.
3. `table_cell_content.rs`는 선택된 unit만 계획 좌표로 내보내야 한다. 전체 셀을 매 조각에서 다시 compose하지 않는다. `cell_context`/`para_index`/`char_start`, 스타일·직접 서식 참조·캐럿은 원본값으로 유지하고 셀 clip은 최종 경계로 남긴다.

최초 adapter의 지원 gate는 번호/불릿, 병합·중첩 셀, 이미지/수식/다른 control, field/range tag, 연결 글상자, 검증되지 않은 복잡 shaping, 비정상 방향, 저장 특수 vpos, SQUEEZE/분산·정렬 규칙, 해결되지 않은 페이지·행·keep-with-next 조건을 제외해야 한다. 혼합 한글/영문/이모지도 caller가 실제 회전·불가분 cluster·ink bbox를 제공할 수 있어야 한다. 잘못된 geometry/oversize/완전한 조각 예산 부족은 트리·캐시를 바꾸기 전에 셀 전체를 legacy 경로로 넘긴다. 성공 prefix와 fallback을 섞지 않는다. 이번에는 이 production gate 자체도 연결하지 않았다.

다음 단계의 완료 조건은 공유 metric/frame adapter와 실제 renderer 연결 후 문자의 소유권·bbox·편집 인덱스 검사, 가로 셀 회귀, undo/redo와 HWP/HWPX 저장재열기, 실제 Mac GUI다. 실제 Mac GUI·물리 IME·Linux 검증은 이번에도 없다. 과거 결함 재현의 저장재열기 성공을 새로운 pagination 성공으로 해석하지 않는다. 기존 전체 라이브러리 suite의3개 원본 fixture 누락도 해결하지 않았다.

## 보존

기존 엔진/UI 소스와 WASM 및 앱4개의 ASAR를 SHA256으로 대조했다. 원본 문서와 기존 개발/공개 앱을 쓰거나 바꾸지 않았다. 새 dependency 다운로드·target·checkout·패키징·push/release·권한/보안/계정/인증서 변경이 없다. 기존 target/debug0/incrementaloff/jobs2 및3GiB 상한을 지켰으며 정상 종료한 Node/Cargo 도구만 사용했다. 실제 GUI 세션은 열지 않았다.
