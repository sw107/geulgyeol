# Mac 현재 소스 UI 통합 검증

기준 `3df19d9`의 캡션·책갈피·본문 붙여넣기를 현재 소스의 실제 Mac Chrome 창에서 검증했다. 12흐름, undo/redo36쌍, HWP/HWPX30재열기를 통과했고 브라우저 실행 오류는0이다. 제품 코드 변경은 없다. 기존 앱·공개 beta.2·dev.3 및 이전 후보/QA를 보존했다.

## 현재 소스 실행과 도구

기존 Vite API와 공식 `vite.geulgyeol-beta.config.mjs`를 사용해 localhost에 소스를 실행했다. `GEULGYEOL_DEV_ENGINE_DIR`은 보존된 `plain-paste-qa/pkg-final`을 가리켰고, 실제 브라우저가 받은 WASM SHA256은 `cef3ef66709627ee07284df957fb75f24f330f672b5b8df5fac1f79d3bcf8cf1`로 일치했다. 캐시와 Chrome 프로필은 새 `source-gui-qa` 안에 한정했다. 기존 dev11 실행 파일은 Node CLI로만 사용했다.

`npm start --prefix desktop`은 기존 `desktop/web` 엔진을 실행하며, 그 WASM SHA256은 `ccac2d483f32fdfeea8dc717bf8f3767b91e7301a1b0f63b3586d77261b3c1d8`다. 따라서 저장된 Electron 앱을 실행해서 현재 후보의 편집 성공이라고 주장하지 않았다. 새 앱/ZIP·기존 번들 덮어쓰기·설치 앱 변경은 하지 않았다.

기본 sandbox에서는 화면0개이며 `screencapture -R0,0,1,1`이 `does not intersect any displays`로 실패했다. host 읽기 전용 preflight에서는 기존 화면 캡처 허용=true/화면2개, Accessibility=false다. OS 권한 요청/변경 없이 QA Chrome PID에 속한 창만 캡처했고 책갈피/캡션 화면을 직접 확인했다. 도구 목록에 네이티브 데스크톱 컨트롤러는 없으며 AppleScript/System Events/OS 입력·클립보드에는 접근하지 않았다.

## 실제 소스 UI 검사

| 흐름 | 확인 |
|---|---|
| 책갈피 추가 | 실제 이름 입력 DOM/확인 버튼, emoji 이름·scalar 오프셋 |
| 책갈피 구조 변경 | Enter 나눔, Backspace/Delete 합침, 여러 문단 선택 삭제의 위치 보존 |
| 일반 본문 붙여넣기 | 선택 교체, 여러 문단 교체, CRLF·빈 줄·emoji/astral |
| 그림 캡션 | 삽입, 일반 글자 입력, 실제 속성 대화상자에서 제거 |
| 그림 삭제 | 선택된 그림의 실제 Delete 키 경로, undo 복원·redo 삭제 |
| 자동 한국어 조합 | Chrome `Input.imeSetComposition`의 ㅎ→하→한과 최종 확정 |

어댑터 대신 실제 DOM·Canvas2D·Cursor·InputHandler·CommandHistory를 사용했다. 위치와 그림 선택은 DEV의 실제 Cursor/선택 메서드로 지정했고 키 입력은 Chrome 프로토콜이다. 붙여넣기는 합성 `ClipboardEvent`를 실제 textarea에 전달했다. 마우스 hit-testing·물리 키보드·macOS 한국어 IME·OS Cmd+V 검증으로 확대하지 않는다.

각 흐름을 Cmd+Z/Shift+Cmd+Z로3회 반복했다. 저장은 실제 `baramHost.export`의 content-loss 거절 경로를 거쳐 새 QA 파일에 기록한 뒤 실제 소스 file-input/FileReader/load로 열었다. 본문·직접 글자/문단 서식·책갈피·필드/앵커·주석 내용·그림 데이터/속성·캡션 서식·전체 SVG를 대조했다. 24개의 편집 후 재열기와 아래3사례의 undo 저장물6재열기를 합쳐30회다. 네이티브 OS 파일/저장 대화상자와 Electron host IPC는 미검증이다.

## HWP 바이트 차이의 별도 분석

9흐름은 undo/redo HWP/HWPX 바이트까지 정확히 일치했다. 다음3흐름은 undo HWP 바이트 완전 일치를 주장하지 않는다. 독립 CFB/압축 해제·정렬된 레코드 대조에서 차이를 제한했다.

- 캡션 일반 입력과 자동 본문 조합: 편집 문단의 `PARA_HEADER.numLineSegs` 0→1 및 저장 `LINE_SEG` 하나 생성. 원래 저장 줄이 없는 합성 입력의 재조판 결과다. 다른 모든 스트림/레코드는 동일하다.
- 그림 Delete undo: `DocInfo.DOCUMENT_PROPERTIES`의 저장 캐럿 문단0→1/문자16→0만 변경. 모든 구역/다른 스트림·레코드는 동일하다.

세 사례 모두 정확 HWPX·전체 SVG·내용/직접 서식/참조/그림 대조와 두 형식 undo 저장재열기를 통과했다. 관찰한 범위에서 내용·서식 손실 결함은 확인하지 못했으며, HWP 바이트 차이를 없애기 위한 제품 수정은 하지 않았다. 독립 제한 검사 `hwp-metadata-assertions.json`과 원본/undo 저장물을 QA에 남겼다.

## 보존·종료와 다음 확인

이전 보호18777파일의 SHA256 변경/누락0. 새 QA 최대 약409.9MiB, 기존 공유 target 약3.960GiB, 실제 디스크 여유 최저 약19.49GiB로 한도(추가1GiB/target4.5GiB/free15GiB)를 유지했다. 이전 캐시/실패 로그도 삭제하지 않았다. 테스트 Chrome은 매 실행 finally close, 정확한 자체 서버 PID에는 SIGTERM을 보냈고 검증 프로세스 잔류0/포트 닫힘을 확인했다. 서버 도구 종료코드는143이므로 정상 exit0이라고 기록하지 않는다.

실제 Electron GUI·네이티브 저장·물리 IME·한컴·Linux는 별도 확인 항목이다. 이번 결과를 바탕으로 다음 개발 범위는 **기존 혼합 서식 캡션의 선택 교체·Backspace/Delete·줄나눔 원자 이력**을 제안한다. 이번 UI 검사는 새 캡션에 글자를 추가하는 범위까지이며 선택 편집 전체의 서식 복원을 인증하지 않았다.

QA: `/Users/sw107/Documents/Codex/2026-10-06/task/source-gui-qa`. 실행 드라이버·중간 도구 실패·저장물·소유 창 캡처·체크포인트를 보존했다. [집계와 해시](proof.json). 새 앱/ZIP/target·공개 푸시/릴리스·보안/계정/인증서/원격 권한 변경은 없다.
