# 글결 0.4.4-beta.1 Mac 베타

누적 dev.1~4의 회전그룹 해제, 표 셀 수식 정확 편집, 스타일 삭제 참조 보존과 지원 문단 전체 스타일 모양 전파를 담는다. 직접 서식과 다른 스타일/문서 참조를 보존하며 지원하지 않는 참조는 변경 없이 거절한다.

## 재사용 및 버전 일치

엔진과 편집 UI는 검증된 dev.4 소스 커밋 `c2ed2bcc2975c6622605fa5b3d65949495282d60`에서 만든 결과를 재사용한다. Rust/WASM/Vite 재빌드는 하지 않는다. 패키지·창 제목·도움말·Info.plist·릴리스 태그는 `0.4.4-beta.1`로 일치시킨다. `GeulgyeolBetaNext.app`과 같은 이름의 설정 폴더를 사용해 기존 beta.2와 개발 후보를 보존한다.

고정 엔진 SHA256: `ccac2d483f32fdfeea8dc717bf8f3767b91e7301a1b0f63b3586d77261b3c1d8`.

```sh
python3 scripts/repackage-mac-candidate.py \
  --source-app dist/GeulgyeolDevPropagation.app \
  --output-app dist/GeulgyeolBetaNext.app
scripts/sign-mac-bundle.sh dist/GeulgyeolBetaNext.app org.geulgyeol.beta.next
```

이 재포장은 기존 ASAR 내 파일의 순서·메타데이터를 유지하고 desktop의 버전 파일 세 개만 바꾼다. 파일 integrity/offset과 Info.plist의 ASAR header integrity를 다시 계산한다. Electron main/helper 번들 이름과 실행 파일도 일치시켜 helper 검색 실패를 방지한다. 입력 개발 후보를 변경하지 않는다. 생성된 앱/ZIP/QA 로그는 Git에 추적하지 않는다. 약 336 MiB 앱 사본과 144 MiB ZIP이 필요하며 다운로드 검증 사본까지 약 0.65 GiB가 필요하다.

## 검증 범위

기존 Native 전파 48개 조합/undo·redo 96회/HWP·HWPX 재열기 96회/거절 17개, 삭제 16개·수식 72개·그룹 108개 회귀와 데스크톱 31 pass/0 fail/skip 1/TODO 1 증거는 `../dev4/`에 보존한다. 패키지 엔진 16개 입력/두 형식 재열기 32회/snapshot undo·redo 32회와 UI 컨트롤러 검사를 최종 패키지에서 통과했고 최종 데스크톱 31 pass/0 fail/기존 skip 1/TODO 1을 확인했다. 앱 프로세스/로컬 서버와 새 버전 HTML·동일 엔진을 확인하고 정상 종료(exit 0)했다. 릴리스 첨부 VERIFICATION 및 SHA256SUMS에서 최종 실행/서명/ZIP/다운로드 검증 결과를 확인한다.

ad-hoc 서명만 제공한다. Apple Developer ID 서명과 공증은 없다. 일반 다운로드 실행이 macOS에서 차단될 수 있으며 사용자가 시스템 설정의 수동 허용 여부를 판단한다. 보안 경고 우회 스크립트는 제공하지 않는다.

**실제 GUI 상호작용·물리 한글 IME·새 Linux 패키지/엔진 검증은 미완료**다. 기본 실행·로컬 서버와 자동 엔진 검증은 GUI 편집·native 저장 대화상자 성공을 뜻하지 않는다. strict Clippy는 변경하지 않은 소스의 기존 8개 진단으로 실패했고 baseline 재확인은 중단됐다. GitHub Actions workflow/check run/status가 없는 저장소이므로 CI 성공도 주장하지 않는다. 문서 사본으로 시험하고 HWP/HWPX 저장 후 재열기를 확인한다. Linux 배포는 기존 beta.2를 유지한다.
