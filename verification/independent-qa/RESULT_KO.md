# 독립 오프라인 QA recipe

과거 QA `build.py`는 예전 Rust bin과 공용 Cargo cache를 코드에서 지정한다. 환경 변수 wrapper만으로 그 경로를 바꿀 수 없으므로, 과거 driver·proof·log·fixture를 그대로 보존하고 아래 새 recipe를 사용한다. 검증은 현재 checkout에 대한 새 결과이며 과거 QA 결과를 대체하지 않는다.

## 준비

먼저 `bash scripts/setup-standalone.sh`로 저장소 소유 도구를 준비한다. Python 3.11 이상과 기본 TLS 검증을 사용하는 `curl`이 필요하다. native/test에 필요한 추가 crate 26개의 선택 목록은 `scripts/independent-qa-crates.json`, SHA의 기준은 `engine/Cargo.lock`이다.

```sh
python3 scripts/prepare-independent-qa-cache.py \
  --report .geulgyeol-local/native-cache-prepare-1.json
```

없는 archive만 공식 `https://static.crates.io`에서 받는다. 기존 archive는 SHA가 다르면 보존하고 중단한다. TLS 검증을 해제하지 않는다. 재실행은 새 report 경로를 사용하며 일치하는 archive를 다시 받지 않는다. 전체 cache를 복사하거나 전역 Cargo 설정을 변경하지 않는다. `svg2pdf`는 registry 패키지가 아닌 Cargo.lock의 고정 Git 의존성이고, 기존 독립 Cargo checkout/DB를 사용한다.

## recipe 실행

```sh
bash scripts/qa-independent.sh --recipe empty-roundtrip --run-id empty-qa-1

# 합성 fixture 경로를 명시한다. 기존 파일은 읽기만 한다.
bash scripts/qa-independent.sh --recipe table-ledger --run-id table-hwp-qa-1 \
  --input /absolute/path/to/synthetic-table.hwp
bash scripts/qa-independent.sh --recipe table-ledger --run-id table-hwpx-qa-1 \
  --input /absolute/path/to/synthetic-table.hwpx

# Cargo WASM build만 수행한다. JS/UI 빌드나 패키징은 하지 않는다.
bash scripts/qa-independent.sh --recipe wasm-build --run-id wasm-qa-1
```

`--dry-run`을 붙이면 명령·환경·pin만 출력하고 파일을 만들거나 Cargo를 실행하지 않는다. run ID는 한 개의 짧은 소문자 이름이며 기존 run ID, 경로 이탈, 외부 output symlink는 거절한다. 결과는 `.geulgyeol-local/qa/<run-id>/plan.json`, `command.log`, `result.json`과 `native/`에 기록된다. 이 디렉터리는 공개 커밋에서 제외한다.

- `empty-roundtrip`: 기존 `empty_document_check`를 실행한다. 빈 문서/템플릿·텍스트·서식 6종의 양형식 저장 체인 60회 재열기와 잘못된 resource ID의 원자적 거절을 확인한다.
- `table-ledger`: 기존 `three_column_owner_check`를 실행한다. **표가 있는** HWP/HWPX가 필요하다. source owner·행/열·페이지별 layout/SVG를 새 ledger에 기록한다. ledger 생성은 편집·undo/redo나 Electron 화면과의 일치를 증명하지 않는다.
- `wasm-build`: locked/offline release WASM lib를 빌드한다. 앱 검증은 별도 Mac QA driver에서 수행한다.

`standalone-env.sh`의 owned Cargo/Rustup/Rust 프록시와 기존 `engine/target`만 사용한다. 상속된 Rust wrapper/flags/기본 build target을 제거하고 debug=0, incremental=0, jobs=2를 지정한다. 공용 target을 사용하는 다른 Cargo 작업의 file-lock 대기가 보이면 이 새 QA child session만 중단한다. 프로세스 목록을 조회하지 않는다.

## 용량과 실패 보존

정상 상한 7GiB, 진단 상한 1GiB, 최소 free 16,374,562,816바이트를 유지한다. runner는 도구·Node modules·기존 target·로컬 QA·관련 산출물의 전체 할당량을 세므로 기존 baseline을 빼는 방식보다 보수적이다. 진단 상한은 `.geulgyeol-local` 전체에 적용한다. 최초 독립화 baseline이 있으면 전역 filesystem 사용량 증가도 정상 상한에 포함한다.

컴파일 중 매초와 종료 후 용량을 확인하고 샘플을 결과에 기록한다. Rust가 rename/remove한 임시 파일의 `FileNotFoundError`만 건너뛰며 권한 오류는 무시하지 않는다. 한도 또는 file-lock 충돌 시 이 invocation에서 만든 child session만 SIGTERM하고 기존 실패 출력은 남긴다. 기존 QA target·로그를 삭제해 예산을 맞추지 않는다.

## 검증 결과와 범위

Mac ARM64에서 공식 archive 26개/1,570,221바이트의 lock SHA 검증, 추가 다운로드 없는 재실행, 오프라인 native 6종/60회 재열기, 합성 4행·3열 표 HWP/HWPX의 각 owner 9개 ledger를 확인했다. 옛 도구 4개 루트와 Cargo symlink 2개를 정상 Trash로 옮긴 뒤에도 native 6종/60회 오프라인 검증이 통과했다. 기존 run ID 덮어쓰기 및 `../` run ID를 거절했다.

최초 다운로드는 Python 런타임의 trust-store 오류로 실패해 기본 TLS 검증을 유지하는 curl로 변경했다. 최초 native 시도는 용량 감시의 Rust 임시파일 경합으로 중단되어 수정했다. 최초 table-ledger 시도에는 본문 전용 fixture를 잘못 선택했으며, 기존 합성 표 fixture로 다시 검증했다. 실패 로그는 private QA에 보존했고 제품 결함으로 보고하지 않았다.

이 PR은 현재 source/recipe 검증이다. 새 Electron UI·물리 IME·native chooser·프린터·Linux·native-skia/GPU 검증은 수행하지 않았다. WASM recipe는 dry-run 명령을 확인했으며 이번 묶음에서 실제 WASM build를 추가하지 않았다. Native proof의 `independent*` flag는 외부 입력 수가 0일 때 별도의 Native/WASM SVG 비교를 의미하지 않는다.

정상 Trash 이동의 복원 manifest와 사용자 승인된 42개 개별 영구삭제 영수증은 private QA에 남겼다. 새로 옮긴 도구/링크에는 영구삭제 승인이 없으며 전체 Trash를 비우지 않았다. 과거 driver를 그대로 재생하려면 원래 경로로 복원하고, 향후 검증은 위 새 recipe와 새 출력 위치를 사용한다.

다음 개발 단계는 준비된 synthetic 두 페이지 문서로 Mac 인쇄 미리보기의 baseline을 기록하고, 표·반복 머리행·후행 본문과 실제 화면/저장/재열기/PDF 또는 인쇄 미리보기의 일치를 좁게 확인하는 것이다. 실제 인쇄 개발·앱 실행은 이 묶음 이후 별도로 진행한다.
