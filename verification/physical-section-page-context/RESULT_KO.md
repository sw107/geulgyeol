# 물리 구역 간 쪽번호·홀짝 캐시 갱신

PR81은 검토 head `99f55331e0a337a114a63b8323b932067feea390` 그대로
`84d05eb011f6ff65eec9ccd1515fb23ab3d5ee66`에 병합됐다. 이 수정은 별도 브랜치의
기존 P2를 다루며, PR81에서 새로 발생한 결함으로 분류하지 않는다.

## 재현과 원인

두 물리 구역을 연 뒤 첫 구역 본문을 늘려 1쪽에서 2쪽으로 만든다. 수정 전에는
마지막 물리 구역의 쪽번호가 2이고 짝수 바탕쪽 MASTER_0이 남는다. 같은 내용을
HWPX로 저장해 새로 열거나 Native에서 문서 모델을 직접 재구성하면 쪽번호 3과
홀수 바탕쪽 MASTER_1이 된다. 저장 데이터 손실과 편집 중 파생 캐시를 분리했다.

`paginate_pass`는 자기 본문이 dirty인 구역만 계산했다. 다음 구역의 본문이 같아도
앞 구역의 쪽번호 carry, 맞쪽 여백, 홀짝 바탕쪽·머리말·꼬리말은 달라질 수 있다.
첫 dirty 구역 이후의 물리 구역을 같은 패스에서 다시 계산하도록 변경했다.
자기 소스가 깨끗한 다음 구역은 구성 결과와 문단 측정 캐시를 유지한다. 편집 전의
앞쪽 구역은 기존 생략 경로를 유지한다. 번호 재시작·상속·바탕쪽 선택 정책과
저장 형식은 변경하지 않는다.

## 회귀 계약

합성 입력 9종과 독립 검토 원본 4종을 사용한다. HWP 출처 입력, 3개 구역의 연속
전파, 중간 구역 편집, 번호 7 재시작, 맞쪽 여백, 상속 머리말·꼬리말 및 독립 검토의
홀짝·복수·확장 바탕쪽을 포함한다. 원본 → 확장 → 축소 → 재확장 → 스냅샷 복원을
검사한다. 각 단계의 편집 중 상태를 새 HWPX 문서와 비교하고, Native는 같은 모델의
전체 재구성도 비교한다. WASM은 구역별 번호, 홀짝 선택, 맞쪽 방향의 독립 기대값과
바뀌지 않은 구역 본문 보존을 추가로 검사한다.

HWP 교차 재열기는 별도로 통과한 6종만 인증한다. 3개 물리 구역에서 공유 바탕쪽을
사용하는 합성 입력의 HWP 변환은 수정 전 병합 WASM에서도 바탕쪽 상속 불일치가
있었다. 그 실패와 입력을 보존했으며 이 캐시 수정으로 해결했다고 보고하지 않는다.
독립 검토의 확장 바탕쪽 입력은 이 검사에서 HWPX 경로만 검사한다. Native의 HWP
검사는 WASM 공개 API와 같은 `export_hwp_with_adapter_snapshot` 경로를 사용한다.
저수준 native exporter를 직접 쓴 초기 검사 실패는 시험 도구 차이로 보존했다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example inline_master_pages_check --example physical_section_context_check
python3 scripts/prepare-physical-section-page-context.py "$INLINE_CHECK_BINARY" "$FIXTURES"
"$CONTEXT_CHECK_BINARY" "$FIXTURES/manifest.json" "$NATIVE_OUTPUT" fixed
node scripts/check-physical-section-page-context.mjs "$WASM_PKG" \
  "$FIXTURES/manifest.json" "$WASM_OUTPUT" fixed
```

출력 경로는 새 경로여야 한다. 수정 전 병합본은 같은 입력에 `baseline` 모드를
사용해 불일치가 실제 존재하는지 확인한다. 계수·해시·추가 회귀는 `proof.json`을
참조한다. 초기 실패·검토 원본·사용자 원본과 이전 증거를 보존했다.

## 한계

뒤 구역 전체를 다시 페이지네이션하므로 긴 다중 구역 문서의 성능 비용이 늘 수
있다. 본문 구성과 측정 캐시는 재사용하지만 별도 성능 벤치마크는 하지 않았다.
새 수정의 실제 앱·정품 한글 QA와 독립 검토는 아직 대기다. PR81의 앱 승인을
이 수정의 앱 승인으로 확장하지 않는다. 전체 Rust 단위 테스트는 기존 include
파일 4개가 없어 실행 전 컴파일에서 막히며 고정 도구에 Clippy가 없다. 등록된 CI
체크가 없다는 것은 CI 통과를 뜻하지 않는다. 독립 검토 전 추가 병합·배포하지 않는다.
