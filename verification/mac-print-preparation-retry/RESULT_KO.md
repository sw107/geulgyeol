# Mac 인쇄 준비 중 창 닫힘과 재시도 복구

미리보기 준비 중 창을 닫으면 닫힌 창의 animation frame callback이 실행되지 않아 `printJobActive`가 계속 남았다. 그 뒤 PDF 안내나 인쇄 미리보기를 요청해도 “인쇄 문서를 준비하고 있습니다.”만 표시됐다. 실제 Mac Electron의 원래 코드에서 이 경로를 재현했다. 이 수정은 소유 Studio의 타이머로 창 닫힘과 준비 시간 초과를 감지하고 폰트·paint 대기를 취소한다. 사용자의 창 닫힘은 정상 취소로 처리하며 `finally`에서 인쇄 작업 잠금을 해제한다. 준비 제한은 surface 로딩과 같은 10초이고, 닫힘 확인 간격은 50ms다.

기준 main은 PR45 병합 SHA `153ac9caba3c92e6cdd0e0a388ec3aade9069e98`다. `source-before.json`과 `source-after.json`은 실제 검사에 사용한 소스·WASM·잠금파일 67개의 전후 SHA256이며 서로 동일하다. 새 커밋의 소스가 이 manifest와 같은지 확인할 수 있다. `runtime-before.json`과 `runtime-after.json`도 별도 파일로 기록했으며 서로 동일하다. `proof.json`에는 해당 QA 실행 소스와 설치된 Electron binary, 실제 native 증거의 해시가 있다.

검증은 설치된 Electron 44.3.0의 실제 BrowserWindow와 합성 2페이지 HWP/HWPX 문서로 수행했다. 문서에 A/B를 편집한 뒤 undo하여 undo 1개·redo 1개, dirty=true인 상태에서 비교했다.

- 두 번째 페이지의 print SVG 렌더 실패 뒤 불완전한 미리보기 창 정리와 정상 재시도.
- 실제 PDF 안내 다이얼로그 취소 뒤 미리보기 재시도.
- PDF 준비 확인 뒤 두 번째 페이지 렌더 실패, 오류 다이얼로그 닫기와 미리보기 재시도.
- 실제 자식 창에서 readiness animation frame을 요청했지만 전달되지 않는 상태를 만들고 창 닫기. 원래 코드는 후속 PDF 안내가 막혔고, 수정 후에는 안내 취소와 미리보기 재시도가 양형식에서 통과했다.

각 경로 후 HWP/HWPX export 전체 바이트 SHA256, 문서 본문, 모든 화면·인쇄 SVG SHA256, 파일명·dirty, undo/redo stack 길이를 비교했다. 성공한 미리보기의 모든 SVG 노드·속성·텍스트도 실제 print 렌더 결과와 비교했다. 마지막에는 retained redo와 undo를 실제 실행해 각각 B와 A 편집 바이트로 돌아오는 것을 확인했다. 이미 해결된 이전 redo 결함을 새 결함으로 보고하지 않는다.

`desktop.tap`: 전체 58개 중 57개 통과·기존 complex-picture fixture 부재 1개 생략. `print-readiness.tap`: 정상 폰트/두 paint, 닫힌 창의 callback 취소, 끝나지 않는 폰트 대기 중 닫힘, 열린 창의 준비 시간 초과 등 4개 통과. TypeScript `tsc --noEmit` 통과. 세 명령 모두 exit 0이며 원본 TAP과 명령·stdout/stderr 해시는 공개 검증 파일에 담았다.

이 검증은 OS 인쇄 다이얼로그를 열지 않았다. 자기 QA 앱에서 `window.print` 호출을 차단했고 호출 시도는 0회였다. native 파일 선택 결과는 합성 fixture로 제어했으며, 편집 엔진과 실제 Mac 창·IPC 실행환경을 사용했다. QA용 WASM/InputHandler 핸들 노출 외에 제품 소스를 검증 목적으로 바꾸지 않았다. 최종 baseline과 수정 앱 모두 강제 종료 없이 exit 0으로 종료했다. 설치·전체 앱 패키징·엔진 빌드는 하지 않았다. 초기 실행의 종료 미확인과 잘못된 알림 선택자 실패는 기존 private 증거에 보존했고 성공 근거로 쓰지 않았다.

기존 dirty 4개, 잠금파일 3개, WASM, 이전 증거 273개, Swift 컴파일 캐시 133개의 해시를 재확인했다. QA 정상 증거 718155776바이트·실패 증거 158240768바이트, 남은 미완료 phase 없음. 소유 경로 합계 4698558464바이트로 7GiB 안에 있다. 기존 자산은 원래 번들과 동일한 16개를 재사용했고, 수정 번들은 13개 재사용·변경된 3개만 기록했다. 기존 사용자 자료·앱·PDF·실패 증거를 삭제하거나 변경하지 않았다.

남은 범위: OS 인쇄 취소, 물리 출력, Linux, 큰 원본 문서와 실제 native 폰트 지연의 시간 초과는 이번 결과에 포함하지 않는다. 준비 타임아웃과 폰트 대기 취소는 unit 검사다. 성공 재시도 뒤 상태 표시줄에 이전 실패 문구가 돌아오는 기존 표시 문제는 별도 개선 후보이며, 이 수정은 준비 중 닫힘으로 남는 작업 잠금만 해결한다.
