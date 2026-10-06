# Clippy 8개 진단 정리 — 2026-10-06

기준 소스는 공개 Mac 베타 `v0.4.4-beta.1`의 커밋 `e33de6056a6ccc95a077f85be3688983d61e46de`다. 기존 실패 로그의 8개 진단이 현재 소스에 남아 있음을 확인하고 기능을 바꾸지 않는 범위로 정리했다. 새 릴리스나 패키지는 만들지 않는다.

| 진단 | 위치·영향 | 수정 |
| --- | --- | --- |
| `extend_with_drain` 4개 | 본문 글자/문단 서식과 그림이 있는 문단 split/merge의 staged 이벤트 이동 | `Vec<DocumentEvent>` 전체 이동을 `append`로 표현. 기존 이벤트 뒤에 staged 이벤트를 같은 순서로 옮기고 staged 벡터를 비운다. 단계 실행·commit 호출·반환값은 유지한다. |
| `doc_lazy_continuation` 3개 | scalar 오프셋 탐색 API 문서의 목록 다음 3줄 | 문단 구분용 빈 주석 한 줄을 넣는다. 실행 코드는 바뀌지 않는다. |
| `needless_update` 1개 | HWPX 타원 파서에서 이미 모든 필드를 지정한 `EllipseShape` | 불필요한 `..Default::default()`만 제거한다. common/drawing/attr/center/axis/start/end 값은 유지한다. 관련 Default는 값·빈 컨테이너 초기화이며 별도 ID 생성 등의 부작용이 없다. |

## 검증

Rust 1.93.1/Clippy 0.1.93에서 다음 검사에 성공(exit 0)했다. 기존 Cargo target이 정리되어 최소 범위의 target을 새로 만들었다. 디버그 정보·증분 출력을 끄고 생성량 768 MiB 초과 시 해당 Cargo 프로세스 그룹만 중단하도록 제한했다. 실제 최대/최종 크기는 약 202 MiB, 소요 약 49초다. lockfile·의존성·lint 허용 규칙을 바꾸지 않았으며 offline로 실행했다.

```sh
CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 \
  cargo clippy --offline --locked --manifest-path engine/Cargo.toml \
  -p rhwp --lib -- -D warnings
```

`git diff --check`와 4개 Rust 파일의 변경 범위를 검토했다. 정확한 명령·검사 범위·크기·exit code 및 로그 해시는 `proof.json`에 있다. 전체 QA 로그와 target은 저장소 밖의 `style-lint-qa/`에 두며 추적하지 않는다.

## 범위와 보존

검사는 **기본 feature의 native 라이브러리**다. `--all-targets`, 모든 integration test, WASM 검사나 새 엔진의 행동 회귀 검사까지 통과했다고 주장하지 않는다. 원본 Default와 이벤트 이동의 의미를 소스에서 확인했으며 새 WASM/앱을 만들지 않아 공개 베타 엔진 검사로 이번 Rust 변경을 검증했다고 주장하지 않는다.

현재 실행 환경에는 실제 Mac 화면 제어 도구가 없다. 따라서 문서 사본 열기·표 수식·스타일 변경·GUI undo/redo·native 저장·닫기·재열기와 물리 한글 IME는 미검증 상태를 유지한다. 목적으로 사용할 수 없는 음성 전용 화면 도구나 자동 키 입력으로 이 공백을 성공 처리하지 않는다. 새 GUI 검증 창은 열지 않았다.

공개 `v0.4.4-beta.1` 커밋과 첨부, 기존 beta.2, dev.4 앱/ZIP 및 원본 문서는 유지한다. 이 변경은 개발 브랜치의 후속 소스 커밋이며 원격 main은 변경/병합하지 않는다. 베타 릴리스 설명의 당시 Clippy 미통과 기록도 역사적 사실로 유지한다.
