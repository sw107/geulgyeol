# 누적 각주·미주/중첩 문단의 Mac dev.7 통합 후보

제품 소스 `7a51cc2e28167b3f0711d9f3b570a5604bbf27b7`까지의 WASM/Studio를 별도 `../dev7-checkpoint-qa/GeulgyeolDev7.app` 한 개로 통합했다. 버전0.4.4-dev.7, bundle ID `org.geulgyeol.dev.checkpoint7`, 독립 userData이며 실제 실행 프로필은 QA 폴더에만 생성했다. 기본 앱·dev.3·dev.5·dev.6·공개 beta.2·사용자 문서를 수정하지 않았다.

시작 디스크 약28GiB 여유와 기존 target2,949,492,736bytes를 확인했다. 이전 검증된 Electron44.3.0 런타임과 최신 Vite 산출물/`pkg`를 재사용했고 Cargo/WASM release 재빌드·의존성 설치·checkout 복제·ZIP 생성은 없다. 후보와 추출 엔진/프로필/검사 저장물을 합쳐 약370MiB, 예산2GiB 이내다. target 증가는0이며 최종 사용량은 proof.json에 기록했다.

## 패키지 일치·서명·실행

ASAR79개 엔트리의 파일/블록/header integrity와 Info.plist header hash, 앱/4helper 이름·실행 파일·bundle ID·버전, 독립 프로필, 전체 Vite 자산과 binding4개의 byte-exact 일치 및 후보 내부 symlink 경계를 확인했다. 컴파일된 UI의 note 글자/문단·예약 조합·중첩 문단 메서드도 검사했고 제품 소스8파일 해시가 직전 구현 proof와 일치한다.

WASM SHA256 `657d4b4a3949813d6d3c366a2ca1245c7c5e9d93dba34423db738419013af1e9`, ASAR SHA256 `e28969fa32824c2a9b914e84419c10b9f23dffe12984eab9404e986d645e6129`. 브라우저 hashed WASM·별도 binding 엔진·서버 제공 엔진·자동 검사 엔진이 모두 일치한다. 전체 번들의 ad-hoc deep/strict codesign과 최종 strict 재확인은 성공했다. Developer ID/Apple 공증은 수행하지 않았다. 인증서·보안 설정·계정·원격 권한 변경 없이 새 후보에만 ad-hoc 서명했다.

격리 프로필의 일반 후보 실행에서 로컬 서버 HTML의 dev.7 버전과 제공 WASM hash를 확인했다. bundle ID로 정상 quit 요청exit0, 앱exit0, 후보 main/helper 잔존0이다. 샌드박스 안 첫 일반 실행은 OS에 의해 exit-6으로 중단됐고 서버 자동 테스트는 localhost listen EPERM이었다. 허용된 별도 후보 실행/테스트만 샌드박스 밖에서 진행해 성공 결과를 얻었다. 실패 시도를 성공으로 세지 않았다. renderer helper `sandbox_extension_issue_file`·일부 Node `task_name_for_pid` 경고는 로그에 남았다.

실제 Mac GUI 조작 도구가 없어서 화면의 선택·툴바·저장 대화상자·물리 한글 IME를 검사하지 않았다. 일반 실행/서버·서명·엔진 자동 명령 성공을 GUI/물리IME 성공으로 해석하지 않는다. Linux는 이번 실행하지 않았다.

## 패키지 엔진 자동 명령 검사

서명한 새 앱에서 binding/엔진만 추출하고 새 앱의 Electron Node24.20.0/darwin-arm64로 실행했다. 실제 현재 InputHandler·Bridge·명령·CommandHistory/선택 복원과 note 입력/키보드 분기를 사용했다. DOM·대화상자·geometry/refresh·글로벌dispatch는 headless adapter다. 컴파일된 UI가 원본 빌드와 byte-exact인 것은 별도로 확인했으며, 번들 JS 전체를 GUI에서 클릭한 검사는 아니다.

| 검사 | 통과 결과 |
|---|---|
| 각주/미주 선택 글자 | 36사례, 복원216, 재열기72, 거절32, SVG72일치 |
| 각주/미주 선택/캐럿 문단 | 40사례+기존캐럿12, 복원240, 재열기80, 거절176, SVG80일치 |
| 각주/미주 캐럿 다음입력·조합·수명/정리 | 기본24+경계8+연속8+수명32+조합28+구조16+실패원복8+lifecycle16, 복원352, 재열기136, 거절20, SVG136일치; snapshot 최대100/clear후0 |
| 중첩 문단 | 108사례, 복원648, 재열기216, 거절80, SVG216일치; 예산375명령/복원129 |
| 실제 패키지 UI 저장물 Native 재확인 | 136개. 기존 compiled verifier만 실행; Cargo/target 재빌드 없음 |
| 전체 desktop 자동 테스트 | tests33, pass31/fail0/skip1/TODO1, 자산 서버 포함 |

대표 명령 저장재열기는 합계504건이다. skip은 private 복합 fixture 미지정이고 TODO는 createEmpty의 기본 스타일 없는 모델이며 앱은 createBlankDocument를 쓴다. TODO를 통과로 세지 않았다. 이전 원본 전체 library는 fixture3개 누락으로 compileexit101/runtime0이었으며 이번 재시도·복원·대체·skip없다. 허용 fixture11/hash 확인·복원0·blocked3 유지. 기존dev6/dev5/BetaNext 보호 ASAR hash도 유지했다.

## 다음 범위와 재현

[기능 대조](FEATURE_AUDIT_KO.md)의 다음 제안은 **일반 본문 문단 번호 목록 이어 쓰기** 한 가지다. 실제 대화상자 확인과 명령 경로의 두 실패가 기존 목록 ‘3.’ 대신 신규 정의의 ‘1.’을 표시하며 저장재열기에도 유지된다. 기존 id를 사용하는 API 대조는 정상이다. 다음 기능은 이번에 구현하지 않았다.

```sh
python3 scripts/package-local-mac-integration.py --source-app dist/GeulgyeolBetaNext.app --studio-dir ../note-pending-format-qa/web --output-app NEW_APP_PATH --product GeulgyeolDev7 --bundle-id org.geulgyeol.dev.checkpoint7 --version 0.4.4-dev.7
scripts/sign-mac-bundle.sh NEW_APP_PATH org.geulgyeol.dev.checkpoint7
python3 scripts/check-local-mac-checkpoint.py --app NEW_APP_PATH --studio-dir ../note-pending-format-qa/web --output-dir QA_OUTPUT --source-proof verification/note-pending-format/proof.json --required-ui-method applyCharFormatInFootnote --required-ui-method applyParaFormatInFootnoteRange --required-ui-method applyParaFormatInCellsByPaths --required-ui-method beginPendingFootnoteComposition --required-ui-method finishPendingFootnoteComposition
node scripts/check-note-pending-format.mjs QA_OUTPUT/packaged-engine ../note-paragraph-qa/behavior/native QA_OUTPUT/note-pending
node scripts/check-numbering-continuation-gap.mjs QA_OUTPUT/packaged-engine QA_OUTPUT/next-gap
```

기존 후보 덮어쓰기는 거절한다. 상세 hash/검사/크기는 proof.json, 원시 기록은 `../dev7-checkpoint-qa/package-verification.json`, signature 로그, basic-launch/process-cleanup proof, 네 대표 명령 결과와 next-gap에 있다. 이 커밋은 검증 도구/재현/기능 대조 기록만 추가하며 제품 엔진/UI 소스는7a51cc2 그대로다.
