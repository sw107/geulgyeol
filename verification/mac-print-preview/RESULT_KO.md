# Mac 앱 인쇄 미리보기 — 부분 검증 완료

기준 main은 `8199830da1706535aa8965865a5d832a4269eac5`이다. 기존 앱에서는 Studio의 `file:print`가 요청하는 내부 `print.html` 창을 데스크톱 정책이 차단해 미리보기를 표시하지 못했다. 데스크톱은 이제 정확한 내부 인쇄 URL을 보안 설정이 유지되는 앱 소유 자식 창 하나로 표시한다. 엔진·Studio 인쇄 구현·공개 배포 앱은 변경하지 않았다.

## 허용 범위와 보안 경계

- 주 앱의 webContents에만 정책을 설치한다. 현재 같은 origin의 `/studio/` 프레임이 있어야 한다.
- 목적지는 정확한 `<앱 origin>/studio/print.html`이다. query/hash, 외부 URL, 다른 포트, data/about URL, named window, features, POST, 다른 disposition은 거절한다.
- Electron 44에서 `_blank`는 빈 frameName, 일반 `window.open`은 foreground-tab으로 관찰됐다. Studio의 no-referrer 정책은 빈 referrer를 보낸다.
- **referrer 분기는 호출 frame 인증이 아니다.** Electron 이 API의 요청 정보로는 Studio 프레임과 같은 webContents의 host 프레임을 구분하지 못한다. 허용 경계는 신뢰된 앱 주 webContents가 요청하는 정확한 번들 인쇄 페이지다. 같은 앱 host에서 그 페이지를 요청하는 것도 허용된다. 이 제약을 특정 프레임 인증으로 표현하지 않는다.
- 자식 창에는 host IPC preload가 없고 sandbox/contextIsolation/webSecurity를 유지한다. Node integration은 꺼져 있으며 기존 session의 원격 요청·권한 차단을 유지한다. 자식 팝업과 다른 페이지로의 이동을 차단한다. 부모 종료 시 닫히고 새 미리보기는 기존 창을 닫아 교체한다.

Electron API의 생성 옵션·보안 상속·createWindow 동작은 [공식 문서](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler)를 참조한다.

## 실제 Mac Electron에서 완료한 검증

독립 소유 Electron 44.3.0과 현재 독립 WASM을 사용했다. 기존 합성 HWP/HWPX만 사용했고 각 문서는 두 쪽이며 `PRINT_00`~`PRINT_51` 본문을 가진다. 실제 사용자 원본·클립보드·Chrome UI를 사용하지 않았다. 읽기용 QA handles를 노출한 source-QA이고 native 파일 chooser 응답은 bootstrap에서 제어했다.

- blocked2: 양형식에서 실제 차단 알림과 미리보기 창 미생성을 재현했다. 전체 HWP/HWPX 내보내기 SHA, 화면/인쇄 SVG, text, dirty 상태, undo/redo stack이 유지됐다. 정상 quit/exit 0.
- fixed3: 양형식 모두 두 쪽 미리보기를 표시했다. 모든 인쇄 SVG 노드·속성·본문을 비교했다. 페이지별 SVG ID namespace만 역변환했다. XML과 HTML의 빈 태그 직렬화 차이는 DOM 트리 비교로 처리했다.
- 닫기 버튼, 창 닫기, 다시 열기, 기존 창 교체 후 전체 문서 SHA·SVG·본문·dirty 상태와 undo 1/redo 1이 유지됐다. 남은 redo와 undo 명령도 실제로 동작했다. 자식 팝업·다른 로컬 페이지 이동은 차단됐다. 자식의 require와 host bridge는 없었다. 정상 quit/exit 0.
- 현재 제품 소스 pin으로 관련 Node 테스트 13개를 다시 실행해 모두 통과했다. QA 종료 helper는 실제 짧은 Node 자식 프로세스로 지연 종료/종료 기한/시그널 구분 테스트 3개를 통과했다. 실행 로그: [제품 테스트 13개](desktop-tests.txt), [QA 종료 테스트 3개](qa-exit-tests.txt).

## 미완료 및 실패 증거

**실제 macOS 인쇄 시트 관찰·취소·renderer 복귀·양형식 이후 저장/재열기 검증은 완료하지 않았다. 실물 인쇄는 하지 않았다.** fixed-final의 ready marker는 준비 증거일 뿐 시트 관찰 증거가 아니다. modal print 호출의 CDP 응답 시간 초과가 발생했고 해당 실행에는 will-quit/exit 결과가 없다.

허용된 UI 재시도에서 실행 중인 Electron을 선택했으나 기본 Electron 안내 창만 표시됐다. 정확한 QA 인쇄 시트를 식별하지 못해 취소 버튼은 누르지 않았고 새 QA 앱을 띄우지 않았다. 기록된 QA의 디버깅·자산 포트는 모두 ECONNREFUSED였지만 종료 이벤트 증거가 없어 해당 실행의 종료는 **미확인**으로 유지한다. 저장 내용 버리기·프로세스 검색·보안 설정 변경을 하지 않았다.

최종 QA runner는 인쇄 준비, UI observer 준비, 호출 요청, 실제 print 함수 진입 관찰, 시트 관찰, 취소, renderer 복귀, 앱 종료를 구분한다. pending CDP 응답이나 준비 marker는 성공 조건이 아니다. native QA opt-in에 한해서 bootstrap의 포커스 억제를 적용하지 않는다. 실패 정리는 취소를 기본으로 하며, 현재 호출이 새로 만든 QA 자식의 측정된 용량 초과에만 SIGTERM fallback을 허용하고 그 뒤 exit 이벤트를 기다린다. 기한 내 확인 불가 결과는 terminationUnconfirmed다.

이 runner/포커스 보완은 구문 검사와 helper 테스트를 수행했으며 **보완 후 새 Electron 실행은 하지 않았다**. fixed3 실제 검증은 이전 runner로 실행한 결과이며 현재 제품 파일 SHA는 동일하다. Linux, 생산 번들, 물리 IME, OS 파일 chooser, 실제 출력은 미검증이다. 이전 알림 처리 오류·요청 형태 차단·DOM 직렬화 비교 오류·최종 native 시간 초과 증거를 모두 보존했다.

## 실행 전제와 다음 작업

`scripts/build-electron-table-qa.mjs`로 신선한 전용 runtime을 만들고 미추적 새 desktop 모듈도 복사해야 한다. 전체 QA root와 신선한 phase에 EvidenceBudget을 시작한 뒤 다음 runner를 사용한다:

```sh
GEULGYEOL_QA_BUDGET_ROOT=/absolute/whole-qa-root \
GEULGYEOL_QA_PRINT_FIXTURES=/absolute/synthetic-two-page-fixtures \
node scripts/check-electron-print-preview.mjs /absolute/phase/fresh-runtime fixed
```

fixture 디렉터리는 기존 합성 print-input.hwp/.hwpx와 fixture-proof.json을 제공한다. 기존 evidence runtime을 덮어쓰지 않는다. native 취소 QA는 `GEULGYEOL_QA_NATIVE_PRINT_CANCEL=1`을 명시하고 정확한 QA 창에 UI observer가 연결된 뒤에만 호출한다. observer-ready/canceled receipts는 실제 허용 UI 관찰에 근거해 작성해야 하며 카드 승인이나 시트 관찰을 추정해서 작성하면 안 된다. 이전 미확인 앱을 해결하기 전 중복 실행하지 않는다.

다음 작업은 정확한 전용 QA 창 선택과 실제 macOS 인쇄 시트 취소 검증이며, 이 PR은 그 완료를 주장하지 않는 draft다. 병합·릴리스·추가 패키징은 하지 않았다.
