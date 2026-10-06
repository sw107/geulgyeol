# 글결 0.4.4-beta.1 검증 기록 — 2026-10-06

## 이번 Mac 패키지에서 확인

- dev.4 소스 `c2ed2bcc2975c6622605fa5b3d65949495282d60`의 검증된 WASM과 편집 UI를 재사용했다. Cargo/WASM/Vite 재빌드는 하지 않았다.
- package.json·화면/도움말·Info.plist 버전은 `0.4.4-beta.1`이며 별도 GeulgyeolBetaNext 앱/설정 폴더를 사용한다. ASAR에서 바뀐 파일은 package.json·main.cjs·web/index.html 세 개뿐이다.
- 엔진 SHA256: `ccac2d483f32fdfeea8dc717bf8f3767b91e7301a1b0f63b3586d77261b3c1d8`. ASAR SHA256: `95071ec51add351b31c9ca77e6589cc2f4afbfb0d0264600abfb9eb0a082941b`.
- ASAR 모든 파일 integrity와 새 Info.plist header integrity를 검사했다. main/helper 번들 이름과 실행 파일을 일치시켜 초기 재포장의 helper 검색 실패를 수정하고, 전체 번들 strict ad-hoc 서명을 통과했다. Developer ID 서명·Apple 공증은 없다.
- 실제 앱 프로세스의 로컬 서버가 새 버전 HTML과 동일 SHA의 엔진을 제공함을 확인했고 앱에 정상 종료를 요청하여 exit 0을 확인했다. 화면 편집·native 저장 대화상자 검사는 아니다.
- 최종 앱의 Electron 런타임과 ASAR에서 추출한 엔진으로 본문/셀/중첩 셀/머리말·각주 등 16개 입력, 두 형식 재열기 32회, snapshot undo·redo 32회를 확인했다.
- 최종 데스크톱 검사 31 pass/0 fail/기존 skip 1/TODO 1. TODO는 createEmpty 기본 스타일 초기화이며 앱은 createBlankDocument를 사용한다. 스타일 UI 컨트롤러 6개와 삭제 UI 3개를 포함한다.
- 기존 Native 전파 48개 조합/재열기 96회/undo·redo 96회/거절 17개, 스타일 삭제 16개·표 셀 수식 72개·저장 줄 회전그룹 108개 회귀 증거는 `verification/dev4/` 및 Git의 개발 기록에 보존했다. 이번 릴리스 준비 중 Native 검사를 다시 실행하지 않았다.

## 남은 확인

실제 GUI 상호작용·물리 한글 IME·다운로드 앱 실행·새 Linux 검사와 한컴 전체 호환성은 미검증이다. strict Clippy는 변경하지 않은 파일의 기존 8개 진단으로 실패했고 baseline 재확인은 중단됐다. 저장소에 GitHub Actions workflow/check run/status가 없으므로 CI 통과 결과는 없다. 문서 사본으로 시험하고 저장 후 다시 확인한다.

ZIP CRC, 공개 첨부 다운로드 SHA256 대조와 정확한 태그 커밋은 릴리스 설명/첨부 SHA256SUMS 및 QA 로그에 기록한다. 아래는 이전 beta.2/beta.1의 역사적 검증이며 이번 버전의 GUI 성공으로 해석하지 않는다.

---

# 글결 0.4.3-beta.2 검증 기록 — 2026-10-05

## Mac 베타2에서 실제 확인

- 베타1 다운로드 ZIP의 SHA-256과 ZIP CRC는 정상이고 원본 앱 파일도 ZIP과 동일했지만, 번들 strict 서명 검증에서 `code has no resources but signature indicates they must be present` 실패를 확인함.
- 베타2의 번들 전체를 ad-hoc 서명하고 `codesign --verify --deep --strict` 통과. Apple Developer ID 서명·공증은 없음. `spctl` 승인은 통과하지 않았음.
- Chrome의 로컬 HTTP 다운로드 → Finder 일반 압축 해제 → 일반 앱 실행을 시험함. 격리 속성을 유지한 앱은 Apple이 악성 코드가 없음을 확인할 수 없다는 경고로 차단됨.
- 사용자가 직접 보안 예외를 허용한 후 실제 다운로드한 앱이 AppTranslocation 경로에서 실행됨. 에이전트는 예외 승인, 격리 속성 삭제 또는 보안 설정 변경을 하지 않았음.
- 0.4.3-beta.2 표시, 한글/영문/숫자/이모지 61자·3문단 붙여넣기, 한 번 실행취소로 이전 `a` 복원, 한 번 다시 실행으로 세 문단 복원.
- 실제 다운로드 앱 상단의 로컬 저장으로 HWPX 7,524바이트와 HWP 13,312바이트 저장. 두 형식을 같은 앱에서 다시 열어 본문과 1쪽을 확인함.
- 패키지와 같은 엔진으로 별도 읽어 61자·3문단·1쪽, 문자 및 두 형식의 text-layout 일치를 확인. 새 한컴 독립 인증이나 물리 키보드 IME 스트레스 검사는 아님.
- 공개 ZIP은 위에서 사용자가 직접 허용하고 검증한 후보와 동일한 바이트를 사용함. 소스의 앱 버전·본문 실행 코드도 해당 후보와 일치하며, 소스에는 이후 패키징 재발 방지용 전체 번들 서명·검증 명령을 추가함. 이미 검증한 후보 앱은 다시 만들거나 변경하지 않음.
- 새 `package:mac` 명령으로 별도 패키징·전체 번들 strict 서명 검증 통과. 데스크톱 검사를 새로 수행해 15통과, 1skip, 1기존TODO, 실제 fail 0.
- Mac Apple Silicon만 공개. Ubuntu 24.04 amd64 설치·기본 샌드박스 실행 화면은 확인했으나 입력·저장 검증이 남아 Linux 첨부를 제공하지 않음.

## 검증의 범위

위 Chrome 다운로드는 로컬 서버에서 진행한 검증이며 공개 GitHub 다운로드 실행 자체를 새로 승인한 결과는 아님. 공개 첨부 업로드 후 SHA-256 대조로 동일 바이트를 확인함. 일반 다운로드 자동 실행·Gatekeeper 승인·Apple 공증으로 해석하면 안 됨. 전체 제품 완료율과 모든 문서의 무손실을 인증하지 않음.

## 베타1 기존 검사 기록과 정정

# 글결 0.4.3-beta.1 검증 기록 — 2026-10-05

## 이번 베타에서 실제 확인

- Apple Silicon 네이티브 앱 실행, 글결 이름·버전·편집 화면 표시.
- 한글/영문/숫자/이모지 60자, 3문단 붙여넣기. 한 번 실행취소로 선택 교체 전 `a` 복원, 한 번 다시 실행으로 본문 전체 복원.
- 상단의 로컬 사본 저장 흐름으로 HWPX 7,523바이트 및 HWP 13,312바이트 저장 완료 표시. 두 파일 모두 실제 앱에서 다시 열어 1쪽과 본문을 확인.
- 저장된 파일을 패키지와 같은 엔진으로 별도 읽어 60자·3문단·1쪽, 문자 및 두 형식의 text-layout 일치를 검증. 같은 엔진 대조이며 새 한컴 독립 인증은 아님.
- 데스크톱 검사 15통과, 1skip(외부 fixture 미포함), 1기존TODO(createEmpty 기본 스타일 없음), 실제 fail 0. 앱은 createBlankDocument 경로를 사용함.
- 공개할 소스 스냅샷의 Rust `cargo build --offline --locked --lib` 성공(31.37초), TypeScript 검사 성공, 독립 Vite 구성으로 Studio 빌드 성공. 추가로 Rust WASM release 빌드 성공(2분16초), wasm-bindgen 0.2.127 결과가 베타 엔진 SHA-256과 byte-exact 일치. 전체 upstream Rust 회귀 fixture/Clippy 묶음을 새로 수행한 결과는 아님.
- 필수 upstream 빈 문서 템플릿 한 개만 소스에 포함. visible text가 비어 있음을 검증. 사용자 문서·연구 자료·개발 캐시·미검증 그룹 해제 후보는 제외.
- 주요 비밀키 패턴, 사용자 Mac 경로 스캔에서 일치 없음. 이 검사는 모든 비밀정보의 부재를 수학적으로 보장하지 않음.

## 검증된 기존 통합본에서 이어진 기능

문서 엔진 RHWP WASM SHA-256: `f917821f49cf9866832c718ff46ac19cc0c054ebd6f480488713ec9eb798b1ca`.

일반 원호/부분 타원, 표 저장 설정 및 HWP5 출처 보존, 여러 문단 붙여넣기 원자적 실행취소, 단순 회전·대칭 그림 그룹 해제는 기존 통합 계보에 포함됨. 이전 도형/표/40회 그룹 해제 및 장문 undo 검사를 이번 턴 모두 다시 실행했다고 주장하지 않음.

## 베타 패키징 차이

이름·버전 안내, 별도 GeulgyeolBeta 설정 폴더, 고정 Mac 경로와 QA 메타데이터 기록 제거. 첨부 고지가 있는 Noto/Nanum/Gowun/Pretendard 공개 글꼴만 유지. 외부 샘플 문서·실험 패치·개발 메모 제외. 핵심 Studio 실행 JS와 RHWP 엔진은 검증된 통합본을 사용함.

베타1 번들은 서명 리소스 검증에 실패했으며 다운로드 앱에서 실행 장애가 확인됨. 위 베타1 실행 결과는 로컬 빌드 검사이며 일반 다운로드 실행 인증이 아님. 베타1 릴리스에는 경고를 추가하고 첨부 파일을 보존함.

실제 한글 빠른 IME, 복합 문서와 긴 표의 한컴 배치 동등성, 저장 줄/중첩/shear 그룹 해제 확대, 표 셀 수식 등은 README의 미완료 범위. 전체 제품 완료율이나 모든 문서 무손실을 인증하지 않음.
