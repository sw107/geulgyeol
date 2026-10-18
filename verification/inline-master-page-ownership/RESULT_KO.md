# 후속 인라인 구역 바탕쪽 소유권

기준 main: `d45b704442e60b9470a9c57f877a5b1cca0940bf`.

## 재현과 변경

합성 HWPX ZIP의 한 `section0.xml`에 첫 문단의 `secPr → masterpage0`과
후속 문단의 `secPr → masterpage1`을 명시했다. 기준 엔진은 두 바탕쪽을 모두
바깥 `Section.section_def`에 붙이고 각 `Control::SectionDef`는 비웠다.
바깥 용지 폭도 첫 59528 대신 후속 42000이 됐다. 같은 용지 크기, 빈 첫
바탕쪽, 공유 part, 역순 manifest에서도 소유권 오류가 재현됐다.

읽기는 각 본문 secPr의 명시적 idRef를 그 문단의 제어에 연결한다. 바깥 정의는
첫 문단의 정의를 반영한다. 같은 part를 여러 구역이 참조하는 것은 보존하고,
한 소유자의 중복 참조만 기존 방식대로 합친다. 쓰기는 각 실제 소유자가 등록한
바탕쪽 part와 idRef를 같은 큐에서 발급한다. 명시적인 빈 물리 구역에는 전역 manifest의 다른 구역 바탕쪽을 붙이지 않는다.
단일 물리 구역도 바깥 정의와
첫 문단의 바탕쪽 사본을 동기화해 HWP 출처 HWPX의 HWP 저장 누락을 막는다.

## 범위와 거절

- 지원 소유자: 본문 첫 문단과 후속 문단에 직접 표현된 secPr, 문단당 하나.
- 기본 Both 바탕쪽은 HWP/HWPX 저장과 편집 후 재열기를 확인한다.
- 인라인 구역의 홀짝·복수 적용 범위와 확장 바탕쪽은 HWPX에서 보존한다.
  기존 HWP 변환기는 후속 제어의 적용 슬롯을 변환하지 않으므로, 새로 생성하는
  해당 HWP 출력은 명시적으로 거절한다. 무변경 원본 raw HWP 재사용은 유지한다.
- 여러 secd가 있는 HWP의 물리 스트림 끝 확장 바탕쪽에는 소유자 참조가 없다.
  기존 읽기 결과를 다른 소유자로 재배정하지 않으며 HWPX 변환도 거절한다.
- 누락된 대상, 중복 manifest ID, 참조 없는 양수 masterPageCnt, 같은 문단의
  복수 정의, 첫 소유자 부재, 중첩 소유자는 추정하지 않는다.
- 중첩 표의 로컬 직렬화 오류가 내용 손실 보고로 바뀌는 기존 경로가 있으므로,
  지원하지 않는 중첩 바탕쪽은 렌더링 전에 검사해 표를 통째로 잃지 않게 한다.
- 전역 manifest에는 다른 물리 구역의 part도 있다. 참조하지 않는 part를
  인라인 소유자에게 임의 배정하지 않는다. 고아 part 자체의 보존은 인증하지 않는다.

## 재현 명령

고정 Rust 도구와 오프라인 의존성이 준비된 환경에서 실행한다. 출력 폴더는
아직 없는 경로여야 한다. WASM 빌드는 기존 release 빌드 절차를 사용한다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml --example inline_master_pages_check
python3 scripts/check-inline-master-pages.py "$NATIVE_BINARY" "$NATIVE_OUTPUT"
node scripts/build-wasm-release.mjs "$WASM_PKG"
node scripts/check-inline-master-pages.mjs "$WASM_PKG" "$NATIVE_OUTPUT" "$NATIVE_BINARY" "$WASM_OUTPUT"
```

기대값은 입력 ZIP의 manifest와 secPr 참조에서 독립적으로 읽는다. HWP 출처 HWPX와 출처 표시 없는 순수 HWPX를 모두 검사한다. 순수 HWPX의
기존 HWP 저장 경로는 인라인 경계를 물리 SectionN 스트림으로 분리하므로,
원본의 논리 소유 순서와 분리된 결과의 대응도 확인한다. 검사는
바탕쪽 내용·용지 폭·적용 범위·방향·크기·표지 속성, 본문, 편집, 저장과
재열기, 스냅샷 복원 및 거절 전후 상태 보존을 다룬다. 렌더 SVG 비교는 같은
엔진의 상태 보존 검사이며 정품 한글과의 시각 동등성을 의미하지 않는다.

실행 결과와 한계는 함께 커밋한 `proof.json`을 참조한다. 화면 제어 도구가
없으므로 이번 변경의 정품 한글·Electron 실제 앱 검증은 수행하지 않았다.
별도 한글 경고 2×2 진단과 관련 로그는 이 변경에 포함하지 않는다.
