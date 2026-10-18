# 물리 구역 간 페이지 문맥과 홀짝 정의 캐시

기준 main은 PR81 병합 `84d05eb011f6ff65eec9ccd1515fb23ab3d5ee66`이다.
기존 PR84 `0876c37`의 단순 suffix 재계산은 새 머리말·꼬리말 P2를 만들었으므로
독립 검토가 거절했다. 이 수정은 기존 쪽번호 P2와 새 회귀를 함께 다룬다.
최종 실제 앱 QA와 독립 재검토가 끝날 때까지 Draft·병합 보류다.

## 두 재현과 원인

앞 물리 구역을 1쪽에서 2쪽으로 늘리면 본문이 깨끗한 다음 구역의 쪽번호가 2에
머물고 짝수 바탕쪽이 남았다. 새 HWPX 재열기와 직접 모델 재구성은 쪽번호 3과
홀수 바탕쪽을 선택했다. 본문 dirty만으로 캐시를 재사용한 것이 원인이었다.

`0876c37`은 첫 dirty 이후 전체 suffix를 계산했다. 그러나 깨끗한 앞 구역의
carry를 실제 페이지에서만 읽어, 1쪽짜리 홀수 구역에 정의돼도 보이지 않은 EVEN
머리말·꼬리말을 버렸다. 검토의 3개 구역·6쪽 입력에서 중간 구역에 X 한 글자를
넣으면 쪽 수가 같은데 마지막 6쪽이 EVEN에서 ODD로 바뀌었다. 기존 main은 그
깨끗한 마지막 구역을 유지했다. 새 회귀를 기존 결함으로 분류하지 않는다.

## 변경 계약

- 깨끗한 구역과 dirty 구역은 같은 원본 정의 수집·carry 갱신 함수를 사용한다.
  보이지 않은 홀짝 슬롯, source section/paragraph/control 주소, 중첩 표 경로와
  기존 정의 순서를 보존한다. 마지막 페이지에 우연히 나온 장식으로 다른 슬롯을
  덮지 않는다. 최종 쪽별 재선택도 같은 수집 결과를 사용하며 선택 정책은 유지한다.
- 각 물리 구역에 실제로 들어온 문맥을 파생 캐시에 저장한다. 이전 마지막 쪽번호,
  쪽번호 위치의 모든 필드, 홀짝 머리말·꼬리말과 바탕쪽의 실제 소유자 참조가 키다.
  자기 source가 dirty이거나 입력 문맥이 달라질 때 계산하고, 문맥이 같은 깨끗한
  뒤 구역은 기존 결과를 재사용한다. 바뀐 문맥만 다음 구역에 전파한다.
- 기존 본문 dirty 및 문단 측정·구성 캐시는 유지한다. 문맥 캐시는 DocumentCore의
  파생 상태이며 문서 모델·저장 형식·물리 API 주소에 필드를 추가하지 않는다.
  새 문서 생성 시 비어 있고, 스냅샷/문서 전체 재구성은 기존 all-dirty 경로로 갱신한다.

## 검증 계약

기존 합성 9종·검토 원본 4종의 65회 비교를 유지한다. HWPX/HWP 선택 재열기,
확장·축소·재확장과 스냅샷 복원을 검사한다. 새 carry 행렬은 다음 5종이다.

- 독립 검토 원본 3구역·6쪽 입력.
- 1쪽짜리 홀수 앞 구역의 보이지 않은 EVEN 정의.
- 짝수에서 시작하는 앞 구역의 보이지 않은 ODD 정의.
- 두 개의 깨끗한 앞 구역에서 슬롯 소유자가 나뉘는 경우.
- 같은 적용 범위의 뒤 정의가 있는 순서 대조군.

각 입력은 한 글자 편집 → 앞·뒤 구역 동시 배치 편집 → 확장 → 배치 undo/redo →
축소 → 원본/한 글자 스냅샷 복원을 검사한다. Native는 직접 모델 전체 재구성,
WASM은 독립 슬롯 소유자·홀짝 기대값을 새 HWPX 재열기와 함께 확인한다.
초기 실패 로그와 거절된 head의 Native/WASM 재현을 보존했다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml \
  --example inline_master_pages_check --example physical_section_context_check
python3 scripts/prepare-physical-section-page-context.py "$INLINE_CHECK_BINARY" "$FIXTURES"
node scripts/prepare-physical-section-carry.mjs "$WASM_PKG" \
  "$FIXTURES/carry-bases.json" "$CARRY_FIXTURES" "$OPTIONAL_REVIEW_INPUT"
"$CONTEXT_CHECK_BINARY" "$CARRY_FIXTURES/manifest.json" "$NATIVE_OUTPUT" fixed
node scripts/check-physical-section-carry.mjs "$WASM_PKG" \
  "$CARRY_FIXTURES/manifest.json" "$WASM_OUTPUT" fixed
```

검토 입력 인자는 생략 가능하다. 출력은 새 경로여야 한다. 기존 행렬은
`check-physical-section-page-context.mjs`와 `$FIXTURES/manifest.json`을 사용한다.
계수·해시·동일 입력 성능 비교는 `proof.json`에 기록한다.

## 한계와 별도 항목

3/8/32개의 작은 합성 구역에서 insert+delete를 측정한다. 기존 검토의 32구역
첫 편집 중앙값은 main 0.064ms, 거절된 PR84 0.768ms였다. 동일 입력의 이번 재측정은
main 0.028ms, 거절된 head 0.704ms, 새 수정 0.031ms였다. 새 문맥 키는 같은
쪽 수의 편집에서 불필요한 suffix 계산을 줄인다. 이 제한된 WASM 측정은 실제 앱,
큰 문서, 중첩 표나 긴 정의 경로의 성능 보증이 아니다.

별도 HWP 단일 Even 저장은 Both로 재파싱돼 홀수 상속을 바꾸는 문제가 있다.
PR81 이전·병합본·기존 PR84에서 동일했고 별도 조사 자료를 고정했다. 이번 수정은
그 저장 의미 손실을 해결하거나 정품 한글과의 동등성을 인증하지 않는다. HWP
교차 인증은 기존 명시한 6종만 유지하며, 새 carry 행렬은 HWPX 경로를 검사한다.

전체 Rust 단위 테스트는 기존 include 파일 4개 누락으로 실행 전 컴파일에서
막히며 고정 도구에 Clippy가 없다. 등록 CI가 없다는 것은 CI 통과가 아니다.
사용자 원본·미커밋 변경·이전 증거는 보존한다. 추가 병합·배포하지 않는다.
