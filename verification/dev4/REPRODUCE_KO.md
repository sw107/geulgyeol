# dev.4 스타일 전파 검증과 로컬 이력

공개 beta.2의 기존 Git 커밋과 태그를 유지하고, dev.3 소스 보존 커밋 다음에 dev.4 전파 변경을 저장했다. 이 저장소는 빌드/배포 결과를 포함하지 않는다. 별도 원격을 등록하거나 푸시하지 않았다.

## 저장 범위

- dev.3 보존: 저장 줄 회전그룹 해제, 표 셀 수식의 정확 조회/편집/삭제, 스타일 삭제 참조 보존 및 해당 테스트.
- dev.4: 문단 컨테이너 전체의 스타일 모양 전파, 직접 서식/다른 스타일/nextStyle 참조 보존, 무변경 거절, 결과 API와 UI rollback, 후보 앱/설정 폴더 분리 및 전파 테스트.
- `dev3-to-dev4.patch`는 기존 QA 패치의 바이트를 그대로 보존한다. 추가된 재현 문서는 패치 밖이다. `source-file-hashes.json`은 개발 당시 코드 16개 파일의 해시를 고정한다.

## 재현 명령

저장소 루트에서 실행한다. 기존 Rust/Cargo/WASM 도구와 lockfile 버전의 Node 의존성이 필요하다. 이 Git 정리 작업에서는 다음 명령을 새로 실행하지 않았다. 생성 출력은 추적하지 않는다.

```sh
# 합성 문서로만 검사: 본문, 셀, 중첩 셀, 머리말/꼬리말, 각주/미주, 글상자/캡션
cargo run --locked --manifest-path engine/Cargo.toml \
  --example style_propagation_check -- /tmp/geulgyeol-dev4-proof

# WASM/편집 UI 생성 (wasm32-unknown-unknown, wasm-bindgen 0.2.127 필요)
./scripts/build.sh

# API 검사: 위에서 생성한 16개 HWP/HWPX 입력을 사용
GEULGYEOL_QA_FIXTURES=/tmp/geulgyeol-dev4-proof \
  node --test desktop/tests/style-propagation.test.cjs

# UI 컨트롤러와 전체 데스크톱 검사
node --test desktop/tests/style-propagation-ui.test.cjs
node --test desktop/tests/*.test.cjs
```

전체 데스크톱 검사에는 임시 localhost 서버를 여는 권한이 필요하다. 샌드박스에서 `listen EPERM`이면 해당 검사 실행 제한을 구분한다. 기존 `createEmpty` 기본 스타일 초기화 TODO와 fixture 부재 skip은 성공으로 집계하지 않는다.

## 기록한 검증 결과와 한계

기존 기록에서 Native 48개 조합/undo·redo 96회/재열기 96회/무변경 거절 17개, 데스크톱 31 pass/0 fail/기존 skip 1/TODO 1을 확인했다. Mac 실제 ASAR 엔진은 16개 입력과 재열기 32회를 통과했다. 결과의 수치와 패키지/ZIP 해시는 `proof.json`에 있다.

실제 GUI와 물리 IME 검증은 미완료다. Linux 파일 전송은 자동 승인 검토로 거절되어 실행하지 않았다. strict Clippy는 수정하지 않은 파일의 8개 진단으로 실패했으며, baseline 재확인과 예외 적용 검사는 저장공간 정리 요청으로 중단했다. 이 Git 정리로 그 검사가 통과했다고 주장하지 않는다.

직접 지정 서식은 현재 모델에서 원래 스타일의 CharShape/ParaShape ID와 다른 부분을 유지한다. [한컴 공식 스타일 편집 설명](https://help.hancom.com/hoffice/multi/ko_kr/hwp/format/style/style(edit).htm)의 전체 전파/직접 변경 부분 유지 규칙을 따른다. 왕복 API 속성은 기존 형식 변환 기본값 차이를 같은 입력의 변경 전 export 기준과 비교했다.

바탕쪽, 모델링되지 않은 문단/STYLE 레코드, 대상 스타일을 직접 쓰는 덧말, 알 수 없는 개체, 잘못된 참조 및 과도한 깊이는 변경 없이 거절한다. 바탕쪽 원본/변환 보존과 스타일 생성/이름 변경의 참조 검증은 후속 범위다.

## 저장소 밖에 보존되는 자료

개발 당시 전체 QA 폴더는 저장소와 같은 부모의 `style-propagation-qa/`에 있다. 합성 HWP/HWPX 입력/출력, 검사 로그, 패키징된 Mac 앱 및 ZIP은 Git에 넣지 않았다. 생성된 `pkg/`, `desktop/web/studio/`, `dist/`, `node_modules`와 Cargo 캐시도 추적하지 않는다. 새 문서 기능에 필요한 공개 upstream 빈 템플릿 한 개는 기존 이력의 항목을 그대로 유지한다.
