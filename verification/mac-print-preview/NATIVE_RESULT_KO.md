# Mac 인쇄 시트 취소·재시도 검증 완료

실제 검증한 제품은 PR39 `e8d227504d53e6f23060a6cd2b29a366966a1680`이다. 기존 `RESULT_KO.md`와 `proof.json`은 fixed3의 부분 검증 및 fixed-final 종료 미확인 이력을 그대로 보존하며, 이 문서는 후속 실제 Mac 관찰 결과를 추가한다. 제품의 desktop/Studio/engine 코드는 변경하지 않았다. 검증 runner·관찰 helper·테스트와 근거 문서만 보완한다.

## 이번 실행에서 통과한 범위

기존 합성 `print-input.hwp`와 `print-input.hwpx`만 사용했다. 문서마다 앱 미리보기는 두 쪽이며 전체 `PRINT_00`~`PRINT_51` 본문을 포함한다. 단일 공식 owned Electron44.3.0 인스턴스에서 아래 순서가 완료됐다.

1. 전체 HWP/HWPX export SHA, 전체 본문, editor/print SVG SHA, dirty 및 undo1/redo1 상태를 기록한다. 앱 인쇄 미리보기의 모든 SVG 노드·속성·본문을 print profile과 대조한다. ID namespace와 XML/HTML 빈 태그 표현만 기존 fixed3 방식으로 비교한다.
2. 허용된 CUA가 정확한 owned Electron 실행 파일과 `print-input.<형식> — 인쇄 미리보기` 제목·localhost preview URL·두 쪽을 확인한다. CUA로 실제 인쇄 버튼을 눌러 macOS `PDPrintPanel`을 관찰하고 `PDCancel`을 누른다. 원래 `window.print` 진입은 QA console marker로 별도 확인한다.
3. 같은 창에서 다시 인쇄하고 취소한다. **HWP2회 + HWPX2회, 총4회** 모두 실제 시트 표시·취소·preview renderer 복귀와 전체 상태 동일성을 검사했다. 호출 marker·ready·pending 응답만으로 시트를 관찰했다고 판정하지 않는다.
4. 미리보기 닫기/창 교체/닫은 후 전체 상태 보존, 실제 제품 redo와 undo가 기존 저장 SHA로 돌아오는 것을 확인한다. CUA에서 앱 편집 화면·문서 이름·“수정됨” 및 저장 형식을 확인했다.
5. CUA의 실제 앱 “다른 이름으로 저장” 버튼으로 합성 변경을 전용 `native-preserved-hwp.hwp`와 `native-preserved-hwpx.hwpx` 사본에 저장했다. 실제 host IPC·filesystem 저장 acknowledgement, 저장 완료 UI 및 dirty 해제, 저장 바이트와 취소 전 export SHA의 일치를 확인했다. 사용자 원본을 저장하거나 버리지 않았다. native chooser 응답만 기존 bootstrap에서 제어했다.
6. 저장된 사본을 같은 고정 WASM 엔진에서 별도로 재파싱해 양형식 전체 본문 동일·두 쪽을 확인했다. **Mac UI 재열기 검증으로 표현하지 않는다.**
7. 저장 후 정확한 QA의 `will-quit`, 소유한 자식 process의 **exit0**, signal 없음, terminationUnconfirmed=false를 확인했다. CUA 앱 inventory에서도 Electron 실행 중=false였다. 포트 연결 실패나 기본 Electron 안내 창을 종료 증거로 사용하지 않았다.

실제 최종 실행의 `errors=[]`, 양형식 `nativePrintCanceled=true`, 정상 종료가 확인됐다. 공개 근거는 [native-proof.json](native-proof.json), [desktop 테스트](native-desktop-tests.txt), [QA helper 테스트](native-qa-tests.txt), [실행 로그](native-run.txt)이다.

## QA 보완 및 관련 테스트

- native 인쇄 버튼은 CUA observer가 클릭한다. modal print를 CDP click 응답 대기로 시작하지 않는다. observer/cancel receipt 대기는 도구·연결 지연을 고려해15분으로 늘렸고, 실제 callback 진입도 성공 조건으로 검사한다. 새 marker 이름은 `hwp-1`, `hwp-2`, `hwpx-1`, `hwpx-2`이다.
- `native-print-observer.mjs` 함수는 renderer에 직렬화되어도 외부 변수에 의존하지 않는다. 원래 print의 this·arguments·return·exception을 유지하고, 재시도 시 원본을 한 번만 호출한다. callback 전달·직렬화·재시도·오류 전파를 실제 JS VM에서 검증한다.
- 제품 인쇄/종료 Node 테스트 **8개**, QA 종료/관찰 helper 테스트 **6개** 모두 통과했다. 새 helper의 관찰용 변화는 QA child에만 적용되며 제품 코드·보안 설정은 바뀌지 않는다.
- dirty 상태를 단순히 clean으로 표시해 종료하지 않고, 실제 QA 사본 저장을 검증한 후 종료한다. 모든 파일·marker는 신선한 phase에서 생성한다. UI receipt는 실제 허용된 CUA 관찰에만 근거한다.

## 보존한 실패와 이전 증거

- fixed3의 양형식 미리보기·상태 보존·exit0 증거와 fixed-final의 ready-only·종료 미확인 상태는 별개이며 그대로 남겼다. 이번 성공으로 과거 종료를 소급 확정하지 않는다.
- `native-resume-20261012`: 앱 선택 지연으로 observer60초 기한 초과. 준비만 됐고 native 호출/시트 관찰은 없었다. 종료 미확인.
- `native-resume2-20261012`: QA 관찰 wrapper가 renderer의 외부 변수를 참조한 오류였다. 실제 print에 들어가기 전에 실패했다. 합성 변경 사본을 실제 저장하고 hash를 확인한 후 exit0으로 종료했다. 제품 결함으로 분류하지 않는다. serialized helper 테스트를 추가해 보완했다.
- `native-final-20261012`: HWP 시트2회 표시·취소·미리보기 복귀를 실제 관찰했으나, 두 번째 receipt 기록 명령의 자동 승인 검토가 시간 초과되고 허용된 재시도는 exec-server 초기화 실패로 실행되지 않았다. 뒤이어 연결 중단이 발생했다. 두 번째 자동 상태 검사·저장·정상 종료를 완료했다고 쓰지 않는다. 기록 파일 부재·will-quit0개·소유 session 연결 실패와 현재 UI 앱 부재를 확인한 뒤 새 단일 실행으로 이어갔다. 권한을 다른 경로로 우회하지 않았다.
- 최종 성공 phase는 `native-connected-20261012`이다. 다른 앱을 중복 실행하지 않았으며, 앞선 실행의 현재 UI 부재/정확한 exit0을 각각 확인한 후 재시도했다. 기존 fixed3/fixed-final과 dirty4·lock3·WASM을 포함한270개 파일 SHA가 일치했다. PR40–42 branch/commit을 유지하고 기존 PR42 작업 트리로 복귀한다.

## 한계와 다음 후보

**물리 출력·PDF 파일 출력·Linux·생산 번들·실제 OS 파일 chooser는 검증하지 않았다.** Chrome UI를 사용하지 않았다. source-QA는 기존 QA handles와 chooser 응답 제어를 사용한다. 현재 설치 프린터를 선택하지 않았으며 macOS 패널은 네 번 모두 “1페이지 모두”로 표시됐다. 앱의2쪽 SVG 미리보기와 시스템 패널 표시는 구분한다. 이 패널 표시만으로 실제 출력 페이지 수·종이 배치를 보장하거나 제품의2쪽 인쇄 성공을 주장하지 않는다. 프린터 설정을 바꾸지 않았다.

별도 출력 없이도 취소·재시도·문서 상태·정상 종료 검증은 완료됐다. 다음 인쇄 후보는 물리 출력 없이 native PDF 산출의 실제 페이지 수·배치를 앱2쪽 SVG와 대조하는 것이다. PR39는 독립 검토를 위해 draft를 유지하고 병합·릴리스하지 않는다.

기존 whole-run 한도 normal768MiB/failure256MiB 및 free floor16,374,562,816byte를 유지했다. 최종 phase의 normal/failure forecast는 각각48MiB였다. 기존 UI와 WASM을 hardlink로 재사용하고 전용 app-data·작은 사본·증거만 생성했다. 최종 정확한 용량·source SHA는 native-proof.json에 있다. 새 package·WASM/app 빌드·권한/보안 설정 변경·영구 삭제는 없다.
