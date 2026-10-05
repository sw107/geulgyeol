# 글결 (Geulgyeol)

HWP/HWPX 문서를 로컬에서 읽고 편집하는 Mac 데스크톱 앱입니다. RHWP 0.8.6에 글결의 데스크톱 통합과 편집·조판·저장 수정사항을 더했습니다. 한컴 한글 전체 기능을 대체하는 완성품은 아직 아닙니다.

## 베타 사용

버전 **0.4.3-beta.1**, macOS Apple Silicon(arm64), Electron 44.3.0. GitHub Releases의 Mac ZIP을 풀고 `GeulgyeolBeta.app`을 실행합니다. Intel Mac/Windows용 빌드는 제공하지 않습니다. 별도 베타 설정 폴더를 사용하므로 기존 글결 앱을 교체하지 않습니다.

개발자 인증서 서명·Apple 공증이 없는 시험판입니다. 다운로드한 앱은 macOS 보안 확인으로 실행이 제한될 수 있습니다. 이 저장소는 보안 경고를 우회하는 자동 스크립트를 제공하지 않습니다.

먼저 문서 사본으로 시험하세요. 열기, 본문·서식 편집, 표 편집, 그림·일부 도형 편집, 실행취소·다시 실행, HWP/HWPX 사본 저장을 지원합니다. 저장 후 사본을 다시 열어 확인하세요. 문서는 앱 안에서 로컬 처리되며 외부 리소스 요청을 차단합니다.

### 알려진 제한

- 실제 빠른 한글 IME 조합은 물리 키보드 검증이 남아 있습니다. 자동 붙여넣기 검증을 실제 조합 입력 인증으로 보지 않습니다.
- 긴 표 행의 쪽 분할, 복합 조판, 일부 도형 테두리·캡션, 전체 한컴 호환성은 추가 검증이 필요합니다.
- 저장 줄이 있는 회전 그룹, 중첩 그룹 및 기울기 변환의 묶음 해제는 안전하게 차단될 수 있습니다. 미검증 확대 지원 실험은 베타에서 제외했습니다.
- 표 셀 안 수식 삽입은 현재 제한됩니다. 암호 문서의 저장과 64 MB 초과 문서는 지원하지 않습니다.
- Noto/Nanum/Gowun/Pretendard의 공개 글꼴만 함께 제공합니다. 다른 글꼴은 대체되어 줄·쪽 배치가 달라질 수 있습니다.
- API `createEmpty`는 기본 스타일이 없는 모델입니다. 앱은 스타일을 갖춘 `createBlankDocument`를 사용합니다. 전체 upstream 회귀 fixture는 이 소스 스냅샷에 포함하지 않습니다.

## 개발

`engine/`은 수정된 Rust 엔진, `rhwp-studio/`는 편집 화면, `desktop/`은 Electron 호스트입니다. `rhwp-shared/` 및 `npm/`은 RHWP 공유 계약과 SDK/플러그인 소스입니다. 생성된 WASM, 앱, 사용자 문서, 개발용 캐시·로컬 설정은 Git 소스에서 제외합니다. 새 문서 생성에 필수인 upstream 빈 템플릿 `engine/saved/blank2010.hwp` 한 개만 포함합니다.

필요 도구: Rust 1.93.1과 wasm32-unknown-unknown 타깃, wasm-bindgen-cli 0.2.127, Node.js 22 이상. 의존성 설치 후 빌드합니다.

```sh
npm ci --prefix rhwp-studio
npm ci --prefix desktop
./scripts/build.sh
npm test --prefix desktop
npm start --prefix desktop
npm run package:mac --prefix desktop
```

베타 ZIP은 검증된 통합 엔진을 사용하며 소스에서 새로 컴파일한 WASM과 비트 단위 동일성을 인증한 결과는 아닙니다. `VERIFICATION.md`에서 새 시험과 이전 검증을 구분합니다.

## 출처와 라이선스

[RHWP](https://github.com/edwardkim/rhwp), upstream v0.8.6 commit `f1f9c6ae58344ee9368996d3543f76b9345cf227`, © 2025–2026 Edward Kim, MIT. 기존 저작권 표시와 MIT 전문을 보존했습니다. 글결은 독립적인 수정·통합 프로젝트이며 한컴 및 RHWP 원저작자의 공식 제품이나 승인 제품을 의미하지 않습니다.

코드: [LICENSE](LICENSE). 포함 글꼴과 기타 의존성: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `desktop/web/licenses/`. 글꼴은 각 고유 라이선스를 따릅니다.
