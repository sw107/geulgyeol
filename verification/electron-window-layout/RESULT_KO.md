# Electron 검증 창의 고정 viewport 해제

실제 Electron 창은 내용 영역1280×860인데 Puppeteer.connect의 기본 viewport가 렌더러를800×600으로 고정했다. 이 연결을 쓰면 앱 헤더/편집기/상태바가 왼쪽 위에만 남고 오른쪽·아래에 회색 여백이 생긴다. desktop CSS의 고정 크기 결함으로 분류하지 않는다. 기존 Electron 개발 검증 스크립트2개에 defaultViewport:null을 지정했다. 실행 중 예전 연결의 override는 진단 창에만 Emulation.clearDeviceMetricsOverride로 해제했다.

사용자 첨부 시각2026-10-08 09:39:59 UTC는 이 작업의 두 번째 QA Electron 실행09:39:49–09:40:06 UTC와 겹친다. 동일 설정의 실제 Electron native capture에서 같은 유형의 여백을 재현했다. 첨부 원본은 Library의 materialization 준비는 성공했지만 Mac download helper가 실패하여 이 worker가 원본 픽셀을 직접 확인한 것은 아니다. 설치 앱에서 발생한 증상으로 확정하지 않는다. 원본과 별도 재현 캡처를 구분한다.

scripts/check-mac-window-layout.mjs는 기존 앱/프로필을 사용하지 않는 QA runtime에서 실제 BrowserWindow.setContentSize와 native capturePage를 쓴다. baseline800×600 대 native1280×860 불일치를 확인한 뒤,900×620/1024×720/1280×860/1440×900/900×620/1280×860의6회 resize를 검사했다. 모든 크기에서 viewport=실제 창 내용 크기, body/헤더/iframe의 너비·아래 끝 일치, 도구모음 창 안 배치, 바깥 수평 overflow 없음, 문서 스크롤50px 이동을 통과했다. 실제 상태바 줌96%와 HWPX 문서 바이트는 불변이고 renderer pageerror0, 앱 정상 종료exit0이다.

실행 환경은 Mac의 Electron44.3.0, byte-identical main/preload/storage/server 복사본과 이전에 검증된 최신 앱 내부 compiled UI다. 현재 제품 소스1191파일은5179b34 검증 때와 같고, 앱이 실제 로딩한 WASM은 e37d8f0a855b4458f42207be06595b14342901cbca687517960e487d616fbe45다. QA bootstrap은 별도 appData를 지정하고 chooser 결과만 통제한다. bootstrap 직접 실행의 info.version은 Electron44.3.0이며 새 제품 버전/설치 앱 패키징 결과가 아니다.

별도 Chrome 창·웹 버전 개발·새 앱/ZIP/target·권한/계정/클립보드 변경·공개 푸시·PR 변경/병합·릴리스는 없다. 기존 dev12/설치 앱/사용자 원본/실패 로그/보호 파일을 보존한다. OS native chooser·물리 IME·실제 clipboard·설치 앱 갱신·Linux는 미검증이다.

QA: ../electron-host-save-qa. layout-final/layout-proof.json·layout-lifecycle.json, 각 native PNG 및 layout-final-budget.json이 최종 레이아웃 근거다. layout-qa의 최초 진단은 zoom selector가 null이어서 최종 줌 근거로 쓰지 않으며 그대로 보존했다. 재현 PNG baseline-fixed-viewport와 수정 후 native-1280x860-5를 비교할 수 있다. 동일 최신 Electron의 저장/취소/중복/실패/동시 편집 및 앱 재열기 기록은 QA CHECKPOINT_KO.md에 별도로 구분한다.

재실행은 새 QA 디렉터리에 현재 host 파일과 현재 앱 UI를 runtime/에 복사하고 기존 QA bootstrap.cjs를 복사하여 별도 app-data/files를 만든 뒤 아래처럼 실행한다. 이전 결과 디렉터리에 덮어쓰지 않는다. 실제 앱 파일을 수정하거나 다시 패키징할 필요가 없다.

```sh
python3 ../electron-host-save-qa/run-budgeted.py <새라벨> node scripts/check-mac-window-layout.mjs <새QA디렉터리>
```

고정 viewport를 해제한 최신 Electron의 최종 저장 검사는17군, 실제 앱 saved-file 재열기11건(합계28군)이 통과했다. 보조 Node WASM 재열기22건은 실제 앱11건과 구분한다. 실제 preload→IPC, source host handler, real FS와 앱 내부 UI를 실행했다. 상단 버튼은 DOM click, 문자 입력은 CDP, 저장 중 편집은 앱 공개 플러그인이다. OS chooser의 선택 결과/취소/오류는 QA가 통제했고 실물 대화상자 성공으로 주장하지 않는다. 정상/취소/중복/real rename 실패/재시도/extension mismatch/chooser promise rejection/나중 편집의 dirty·내용 보존을 확인했다. 초기 QA 경로/메서드 실패 및 비활성 창 기다림/CDP timeout 기록은 별도 attempt 폴더에 보존하고 최종 통과 count에 합산하지 않았다.
