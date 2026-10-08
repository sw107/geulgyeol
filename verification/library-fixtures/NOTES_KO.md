# 라이브러리 fixture 복원 진단

2026-10-06, 기준 커밋 `fd99c3f`. 기존 누락 10개/컴파일 오류28개를 조사해 공개 upstream의 고정 커밋에서 7개 fixture와 4개 라이선스 파일을 원래 바이트 그대로 복원했다. 전체 라이브러리 검사에는 문서 corpus 3개가 여전히 필요하며, 권리·비민감성이 검증되지 않아 복원하지 않았다. 전체 검사 통과나 런타임 회귀 없음으로 보고하지 않는다.

## 출처와 원래 파일 확인

Upstream은 RHWP v0.8.6 commit `f1f9c6ae58344ee9368996d3543f76b9345cf227`이다. GitHub tree API의 이 고정 커밋 전체 목록(`truncated=false`)을 조회했고 각 복원 파일의 Git blob SHA-1·크기·SHA-256을 검증했다. 현재/latest 파일로 대체하지 않았다.

원래 `/Users/sw107/Documents/Codex/2026-09-08/new-chat`와 `work/rhwp-build`, `work/rhwp-engine`, `work/rhwp-upstream`, 보존 QA `2026-10-05/task-2`, 현 작업 QA를 읽기 전용으로 조사했다. 두 smoke 글꼴과 개별 라이선스는 `work/rhwp-upstream/tests/fixtures/fonts`에 이미 있었으며 공개 pinned blob과 정확히 같았다. 나머지 원래 8개 파일은 조사 범위에 없었다. 같은 이름의 12-byte `tools/oracle_public/fixtures/mini_repo` 파일은 5,820,416-byte 시험지 원본이 아니므로 사용하지 않았다. 정확한 테스트 함수·include 위치·원래 후보 경로·존재 여부는 `audit.json`에 기록했다.

| 기존 누락 fixture (engine/ 아래) | 테스트 의도 | 복원 판단 |
| --- | --- | --- |
| `samples/hml/formatting_table.hml` | HML metadata/warnings, 공용 편집/저장, 손실 preflight 8개 테스트 | Unlicense 공개 parser corpus, 원문 복원 |
| `samples/hwpx/ref/ref_empty.hwpx` | 문자 모양 수·7종 fontface·헤더 tail/기본값·속성 순서 | MIT upstream 빈 구조 template, 원문 복원 |
| `samples/render-p35-font-native-bitmap.hwpx` | print 옵션 불변성, 내장 bitmap 글꼴의 public layer export | 위 빈 template + MIT 합성 글꼴로 만든 공개 fixture, 원문 복원 |
| `tests/fixtures/fonts/RHWPBitmapSvgGlyphSmoke.ttf` | bitmap/SVG payload·unsafe/malformed/shared SVG 거절·리소스 예산 | 개별 MIT 합성 fixture 고지, 로컬 캐시 원문 복원 |
| `tests/fixtures/fonts/RHWPExactFaceSmoke.ttc` | collection face index와 exact-family proof, strict rendering resources | 개별 MIT 합성 fixture 고지, 로컬 캐시 원문 복원 |
| `assets/logo/logo-32.png` | CanvasKit 이미지 payload와 layer replay | MIT upstream 리소스, 원문 복원 |
| `ttfs/opensource/NotoSansKR-Regular.ttf` | 고정 SHA-256과 printable ASCII advance의 metric 일치 | SIL OFL 1.1, 원문과 동봉 라이선스 복원 |
| `samples/3-09월_교육_통합_2022.hwp` | 문단325..332의 stored picture-band transaction/무변경 거절 4개 테스트 | 차단: 원 출판자 재사용 허가·비민감성 미확인 |
| `samples/hwp3-sample16-hwp5.hwp` | HWP3 변환 profile로 해석한 문단 box/서식 reflow | 차단: 한컴 변환 이력은 있으나 원 문서 권리·비민감성 미확인 |
| `samples/hwpx/aift.hwpx` | 실물 memoProperties header의 SOLID/#CBFF99 보존 | 차단: upstream 작업지시자 사업계획 corpus, 파일별 권리·비민감성 미확인 |

Blank HWPX는 body text가 비어 있고 preview text는 CRLF뿐이며 미리보기 PNG도 백지인 것을 확인했다. Bitmap HWPX의 body는 합성 private-use glyph U+E100 하나이고 내장 글꼴도 위 MIT fixture와 같다. 원본 바이트를 복사했으며 새 합성 fixture를 생성하지 않았다.

## 라이선스와 생성 절차

- RHWP 코드/합성 데이터: [고정 커밋 MIT 전문](https://raw.githubusercontent.com/edwardkim/rhwp/f1f9c6ae58344ee9368996d3543f76b9345cf227/LICENSE), 기존 `engine/LICENSE` 보존.
- Bitmap/SVG 글꼴: [개별 고지](https://raw.githubusercontent.com/edwardkim/rhwp/f1f9c6ae58344ee9368996d3543f76b9345cf227/tests/fixtures/fonts/RHWPBitmapSvgGlyphSmoke.LICENSE.md), 원래 generator `scripts/generate_font_glyph_payload_fixture.py`.
- Exact-face TTC: [개별 고지](https://raw.githubusercontent.com/edwardkim/rhwp/f1f9c6ae58344ee9368996d3543f76b9345cf227/tests/fixtures/fonts/RHWPExactFaceSmoke.LICENSE.md), 원래 generator `scripts/generate_exact_face_collection_fixture.py`.
- Bitmap HWPX: 원래 generator `scripts/generate_font_native_hwpx_fixture.py`가 `ref_empty.hwpx`의 첫 fontface와 빈 text를 치환하고 합성 TTF/manifest를 추가한다. 로컬 캐시 generator 자체의 blob도 고정 공개 tree와 일치했다. 이번에는 generator를 실행하지 않고 공개 결과 바이트를 복원했다.
- HML: `osik-kwon/osk_filter` commit `8b483dc73edfe31b34c9c2324e1096be474fa341`, `test/sample/hml/hml.hml`; [원 프로젝트 Unlicense](https://raw.githubusercontent.com/osik-kwon/osk_filter/8b483dc73edfe31b34c9c2324e1096be474fa341/LICENSE). upstream이 파일명만 바꾸고 보존한 29,500 bytes, SHA256 `177b93de7c79462bef7850e15b018dbc8138fbe713b9c7e045b6125cc7527d35`. 고지도 동봉했다. HML script는 파일 데이터로만 보존하며 실행하지 않았다.
- Noto: [동봉 OFL](https://raw.githubusercontent.com/edwardkim/rhwp/f1f9c6ae58344ee9368996d3543f76b9345cf227/ttfs/opensource/NotoSansKR-OFL.txt)과 upstream `ttfs/opensource/README.md`의 Google Fonts instancing/subset 기록을 확인했다. 고정 SHA256 `6e06a7fe5d696ca719894a23f36bb2b1be8c816a5937cd4ad0f23ca67780dd74`는 현재 테스트의 고정값과 같다. 현재 배포용 WOFF2를 임의 변환해 대신하지 않았다. OFL 원문 21행에는 upstream 그대로의 trailing space가 있어 `git diff --check`가 경고한다. 고정 원문 hash를 보존하기 위해 라이선스 텍스트를 정리하지 않았다.

큰 corpus는 공개 저장소에 존재한다는 사실과 원 문서의 재사용 권리·내용 안전성을 구분했다. 기존 paragraph325의 stored geometry를 generic synthetic model로 바꾸면 실제 회귀 의도가 달라지고, native HWP5 blank로 HWP3-derived sample을 바꾸면 profile assertion이 사라진다. 메모용 독립 합성 테스트를 추가하는 것은 가능하지만 실물 corpus 보존 검사를 복구했다고 주장할 수는 없다. 이 작업은 해당 테스트·assertion·skip·조건부 컴파일을 바꾸지 않았다. 사용자 원본문서를 사용하거나 업로드하지 않았다.

## 무필터 전체 검사

```sh
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp --lib -- --test-threads=2
```

Rust1.93.1 aarch64 Mac, 기존 `style-lint-qa/target` 재사용, jobs2, test/dev debug0, incrementaloff. 결과 exit101, 20.59초, 위 corpus 3개의 include_bytes! 컴파일 오류. 필터/skip는 없으며 테스트 본문은 실행되지 않았다. 이 3개는 이전 28개 오류에도 존재하는 build prerequisite다. 이번 변경의 엔진/API/UI Rust·TS 소스는 기준 커밋과 동일하므로 새 코드 회귀를 나타내는 오류는 아니다. 단, 런타임 실패의 기존/새 회귀 분리는 실행되지 않아 판정 불가다. 추가 runtime file-read corpus 누락도 전체 테스트가 실행되기 전에는 실제 실패 수를 알 수 없다.

복원 helper `scripts/restore-library-fixtures.py`는 기본값으로 11개 파일을 hash 검증만 한다. `--cache ROOT` 또는 `--download`를 명시하면 누락된 reviewed manifest 파일만 복원한다. 기존 hash 불일치 파일은 덮어쓰지 않고 거절한다. 다운로드는 고정 URL과 정상 TLS 검증을 사용하며 불명 corpus 3개는 manifest의 허용 목록 밖이다.

```sh
python3 scripts/restore-library-fixtures.py
python3 scripts/restore-library-fixtures.py --download
```

격리된 작은 QA checkout에서 cache 복원11건/검증11건을 확인했고, 손상된 기존 TTC는 exit1로 거절하면서 그대로 보존했다. 실제 fixture는 negative 검사로 변경하지 않았다. `proof.json`과 인접 QA `library-fixtures-qa`의 로그·SHA를 참고한다.

새 WASM/app/ZIP를 만들지 않았고 기존 WASM SHA와 앱 app.asar SHA가 유지됐다. 원래 checkout/QA도 변경하지 않았다. 원격 쓰기/push/release, 계정·보안·인증서 변경은 없다. 실제 Mac GUI/IME/Linux 검증 없음.

## 다음 실제 기능 제안 한 개

**중첩 표 셀 모양복사/붙여넣기**를 제안한다. 최신 `InputHandler.applyCopiedCellPropsToSelection`의 `cellPath.length > 1` 분기가 거절하고, 현재 코드를 mock cursor로 실행해 결과 false/변경0건을 확인했다. 위치: `rhwp-studio/src/engine/input-handler.ts:5463`. 이미 스타일 전파의 중첩 셀 지원은 있으나, 이 셀 자체의 여백·세로정렬·테두리/배경 모양복사는 별도 누락이다.

현재 Bridge는 `getCellInfoByPath`/`getTableDimensionsByPath`를 제공하지만 `getCellOwnProperties`/`setCellProperties`는 flat 주소만 받는다. 다음 구현은 원본/대상 cellPath로 셀 자체 속성을 정확히 조회·변경하고 선택 범위/제외 셀을 유지하도록 engine/API/UI를 연결하는 범위다. 형제 셀·본문·병합 구조·스타일·문서 참조를 보존하고 단일 이력 명령으로 배치 계산을 완료해야 한다. 2·3단계 중첩, 병합/제외 셀, 다중 대상, 비지원 경로 무변경 거절, 반복 undo/redo, HWP/HWPX 재열기와 SVG를 검증하는 것이 완료 조건이다. 이번에는 제안·누락 재현까지만 했으며 기능 구현을 완료한 것으로 주장하지 않는다.
