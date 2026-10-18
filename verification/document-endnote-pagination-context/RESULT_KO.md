# 문서 끝 미주의 파생 페이지 캐시

기준은 PR84 병합 `e38938d813eb06bdb8a2baec2ed9281fbd0317e0`이다.
승인된 engine `4f46743`과 PR83 UI `9348166`의 tree·WASM 일치를 확인했고,
병합 소스의 UI90·타입 및 핵심45/65회 엔진 회귀도 통과했다. 그 승인 범위에
이 미주 캐시 결함은 포함되지 않았다. 이 변경은 별도 Draft이며 독립 검토 전
병합·배포하지 않는다.

## 최소 재현과 원인

검토 원본은 3개 물리 구역이고, 첫 구역의 미주를 문서 끝에 배치한다.
`insertTextInFootnote(0,0,2,0,0,'NOTE_CONTENT '.repeat(1200))` 후 편집 중에는
3쪽인데 새 HWPX 재열기는4쪽이다. 머리말·바탕쪽이 없는 합성 2구역·2문단·
미주1개에서도 편집 중2쪽/재열기3쪽으로 줄여 재현했다. Z 한 글자만 넣어 쪽 수가
같은 경우에도 마지막 구역에 복사된 미주 텍스트가 오래된 상태였다.

문서 끝 미주(Endnote + EachColumn/END_OF_DOCUMENT)는 앞 구역에서 억제하고
마지막 물리 구역의 `DeferredEndnote`로 복사한다. 앞 구역의 미주 편집은 그 구역을
dirty로 만들지만, 본문 쪽 수·쪽번호·장식 소유자 carry가 같으면 마지막 구역의
기존 입력 문맥 키가 같아져 복사된 미주와 페이지 결과를 재사용했다. 원본 note
텍스트와 저장 데이터는 바뀌었으므로 재열기·전체 모델 재구성은 새 결과를 냈다.

## 변경

`SectionPaginationContext`의 마지막 구역 키에 실제 RenderAll donor와 같은 조건의
앞 구역 목록 및 source revision을 추가한다. 최상위 Endnote가 있고 root 배치가
END_OF_DOCUMENT인 앞 구역만 포함한다. revision은 기존 source 편집 무효화 경로를
사용한다. 큰 미주 본문을 키에 복제하거나 해시하지 않는다.

마지막 구역의 note 내용·서식·번호·소유자 위치가 달라질 수 있는 source 변경,
donor의 추가·제거·배치 변경이 입력 키를 바꾼다. 미주가 없는 앞 구역은 키에 넣지
않으며 단일 구역·마지막 구역의 자기 미주·구역 끝 미주·각주는 기존 dirty 경로를
유지한다. 문서 모델·저장 형식·물리 API 주소·미주 조판/분할 알고리즘은 바꾸지 않는다.
source revision은 보수적인 구역 단위라 donor의 일반 본문 편집도 마지막 구역을
다시 계산할 수 있다.

## 검증

9종은 검토 원본, 최소2구역, 중간 donor, 두 donor 배치 편집, 같은 source의 두 미주,
구역 끝 미주, 마지막 구역 미주, 단일 구역, 각주 대조군이다. 각 입력에 작은 편집,
큰 확장, undo/redo, 축소·복원 및 선택한2종의 미주 제거·재삽입을 수행한다.

페이지 정보, 렌더 트리의 텍스트 해시·문자 수, 본문과 원본 note 텍스트/소유자
정보를 HWPX 재열기와 비교한다. Native는 직접 모델 전체 재구성도 비교한다.
원본은 합성 복사본만 사용하며, 처음 작성한 해시 도구의 컴파일 실패와 초기
실행 실패를 포함해 원본 로그를 보존했다. 정확한 계수·해시는 `proof.json`에 기록한다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml --example document_endnote_cache_check
python3 scripts/prepare-document-endnote-cache.py "$BINARY" "$FIXTURES" "$OPTIONAL_REVIEW_SEED"
"$BINARY" "$FIXTURES/manifest.json" "$NATIVE_OUTPUT" fixed
node scripts/check-document-endnote-cache.mjs "$WASM_PKG" \
  "$FIXTURES/manifest.json" "$WASM_OUTPUT" fixed
```

검토 입력 인자는 생략할 수 있고 출력은 새 경로여야 한다. 제어 입력은 `seed`
명령으로 자체 생성한다. 수정 전 병합 엔진에는 `baseline` 모드로 같은 행렬의
불일치를 확인한다. 기존 물리 구역65회·carry45회 및 인라인 저장/렌더·필드·주석
회귀를 유지한다.

## 한계

길어진 미주의 기존 `LAYOUT_OVERFLOW_DRAW` 경고도 보존했다. 이 변경은 편집 중
캐시와 새 재열기 결과의 동등성을 고치며, 미주 줄 분할·페이지 경계·글꼴 기하의
전면적 정확성을 인증하지 않는다. 큰 렌더 트리는 파일로 반복 저장하지 않고
메모리에서 텍스트 해시/문자 수로 비교한다. 중첩 표·도형 안 미주는 기존 RenderAll
수집 범위를 확장하지 않았다. 새 미주 행렬은 HWPX 경로이며 HWP 변환·정품 한글·
물리 입력·서명 패키지·실제 앱 QA를 대신하지 않는다. 별도 HWP 단일 Even 바탕쪽
상속 문제도 미해결로 보존한다.

전체 Rust 단위 테스트는 기존 include 파일4개 누락으로 실행 전 컴파일에서
막히고 고정 도구에 Clippy가 없다. CI 등록0은 CI 통과가 아니다. 새 head의 독립
검토와 실제 앱 QA는 대기다. 사용자 원본·기존 증거를 보존한다.
