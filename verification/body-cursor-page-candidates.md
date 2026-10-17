# Paragraph-end cursor page candidates

긴 한 문단의 선택 교체를 undo하면 snapshot 복원 뒤 캐럿 위치를 찾느라 해당 문단이 걸친 모든 페이지의 렌더 트리를 만들었다. 29만자·98쪽 합성 문서에서는 이 좌표 조회가 약3.63초였다.

`get_cursor_rect_native`의 후보 페이지를 줄이되, 다음 조건이 모두 확인되는 문단 끝(Unicode scalar offset) 조회에만 적용한다.

- 구역의 유일한 본문 문단, 수평·단일 단·동일 단 폭, 하나의 글자 스타일.
- 번호/개요/글머리 없음. 구조용 SectionDef/ColumnDef 외 컨트롤, 탭·줄바꿈·PUA 표시 변환 등은 기존 경로.
- 조합된 줄이 원문 scalar 범위를 빠짐없이 나누며, 렌더러의 기존 행 재조합 함수가 정확한 frame/profile에서 모든 줄 경계를 유지함.
- 어울림·단 설정 변경·HWP3 저장 기하 등 불확실한 구성은 기존 전체 탐색.

실제 좌표 계산과 페이지 순서·경계 우선순위는 기존 렌더 트리 탐색을 사용한다. 못 찾을 때의 fallback은 필터 전 첫 페이지를 보존한다. 새 장기 캐시나 geometry 재사용, 데이터/이력 동기화 생략, 공개 WASM API 변경은 없다. 문단 앞부분과 부분선택 undo에는 행 검증 비용을 붙이지 않는다.

저장 행은 표시 시 재래핑될 수 있어 단순히 composed 범위만으로 쪽을 제외하면 안 된다. 혼합 서식 뒤 분할된 문단의 재현을 작은 합성 fixture `engine/tests/fixtures/body-cursor-mixed-split.hwpx`로 고정했다. 해당 구성은 기존 경로를 사용한다.

## 최종 실제 앱 비교

같은 Mac/Electron, Studio JS 번들·폰트·합성 HWPX·메뉴/입력/관측 조건에서 WASM만 바꿨다. 기본 비교 엔진은 d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1, 최종 엔진은 d155c31adca72095d3cb4bb19e858c9f3872104612f8271ac7e5b002882a34b5다. SDK JavaScript·두 타입 파일의 SHA는 동일하다.

| 29만자·98쪽, ms | 기존 중앙값 | 최종 중앙값 |
|---|---:|---:|
| 전체선택 undo 관측 완료, 각3회 | 4507.4 | 1007.7 |
| history.undo 내부 | 734.1 | 711.9 |
| 문단 끝 cursor.updateRect | 3629.5 | 74.3 |
| 앞부분 3글자 선택 undo 관측 완료, 각3회 | 966.0 | 941.3 |
| 그때 cursor.updateRect | 38.9 | 38.9 |

역방향 전체선택은 각1회 관측했다. 앞부분 선택은 scalar offset100..103이다. 단일 합성 문서의 제한된 반복이며 다른 문서·최악 시간·통계적 일반화 결과는 아니다. 구간은 중첩되므로 합산하지 않는다. 완료 관측에는 메뉴 전달·비동기 렌더·두 RAF·CDP 관측이 포함되며 물리 모니터 표시 완료를 뜻하지 않는다.

정/역방향의 선택 범위, undo 후 원문 HWP/HWPX 바이트, caret 위치·rect·scroll·선택·dirty·undo/redo 상태가 기존과 일치했다. 같은 문서의 표시/캐럿 기존 동작을 보존한 것으로, 기존 스크롤 동작의 개선을 주장하지 않는다.

QA에서는 Vite가 요청한 hashed WASM asset도 교체하고 실제 브라우저 요청 URL/응답 SHA를 확인했다. 루트 SDK만 교체하여 구 엔진이 실행됐던 초기 after회차는 개선 증거에서 제외했다. QA 전용 alias이며 배포 번들이 아니다.

## 정확성·상태 검증

- 최종 Native 회귀5개: 전체 탐색 참조와 Unicode/페이지 경계/서식 좌표 동등성, fallback, 재현 fixture, 문단 끝의 페이지 트리1개 생성 확인.
- 기존 테스트가 참조하는 샘플3개가 없어 일반 Native lib test 컴파일은 차단됐다. 별도 소스 복사본에서 그 파일을 합성 compile-only 대체물로 제공하고 새5개만 실행했다. 해당 샘플을 쓰는 기존 테스트3913개는 실행하지 않았다. 원래 체크아웃에 대체물을 추가하지 않았다.
- 실제 기존/최종 WASM 7개 합성 문서·좌표118개 비교: 98쪽, Unicode/혼합 서식·분할 문단, 탭/줄바꿈, 번호, 표 host/cell, 각주, 각 구역에 한 문단인 두 구역. 좌표·조회 전후 HWP/HWPX 바이트 동일. 앞선 다문단 두 구역 구성139개도 통과했다.
- 최종 앱의 변이 후 오류 롤백: 역방향 anchor/focus·블록 단계·대기 서식·원문 바이트 복원. 캐럿 redo 위치 확인, HWP/HWPX 실제 저장·재열기, 같은 epoch의 changeSeq0→1→2→3 및 실제 IndexedDB 편집본/undo 복구본 확인. 재열기 후 추적 snapshot/fragment0.
- 최종 실제 Electron 저장·전환·닫기·복구29회귀, VM 입력/host history41개, Studio 타입 검사와 구문·공백 검사 통과.
- 최종 WASM 기능 suite 뒤 선형 메모리: 기존28,049,408 / 최종28,114,944 bytes. Node JS256MiB·WASM128MiB 한도를 사용했으며 peak RSS나 앱 메모리 상한 측정이 아니다.

`node scripts/check-body-cursor-page-candidates.mjs QA_ROOT OLD_SDK NEW_SDK LARGE_SYNTHETIC_HWPX TWO_SECTION_SEED_HWPX`로 실제 WASM 비교를 반복할 수 있다. `GEULGYEOL_QA_SKIP_BENCH=1`은 기능 비교만 수행한다. 두 구역 seed는 `scripts/prepare-body-cursor-page-fixtures.py`에 한 구역·두 문단의 합성 HWPX를 넣어 만든다. 같은 문단 끝을 재조회하는 warm 측정으로 cold 복원 비용을 대체하지 않는다.

증거: 실행 작업공간의 `body-cursor-page-candidates/qa/` 아래 `performance-final.json`, `wasm-parity-sections/proof.json`, `app-state/proof.json`, `lifecycle/proof.json`, `delivery-freeze.json`. Rust 소스 SHA256은 cf247212c2632708812bfa7d7f7190c22ace9edbd3f23eada431ed0d872b9085이며 최종 WASM build 입력과 같다.

기존 pre-PR70 baseline의 GUI65초 timeout 원인은 미확인으로 남겼으며 이번 수정·비교에 섞지 않았다. 전체 Native/CI 통과, 정품 한글 상호운용, 물리 IME, OS chooser, 패키징/서명 앱 검증은 아니다. CI checks 없음. 독립 검토 전 병합과 전체 배포를 보류한다.
