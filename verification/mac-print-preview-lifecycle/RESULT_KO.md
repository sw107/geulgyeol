# 인쇄 미리보기 unload 수명주기 수정

기존 main 2a8116a3c2e884e85d7942fe39e405f40b9d9b9b에서 인쇄 미리보기의 beforeunload가 닫기를 거절하면, 다시 인쇄를 열 때 기존 child와 새 child 두 개가 남았다. 실제 Mac Electron44.3.0/BrowserWindow로 이를 재현했다. 원래 모듈은 이전 child.close()만 호출했으며 beforeunload 차단을 해제하지 않았다.

읽기 전용 print snapshot child에만 will-prevent-unload의 preventDefault를 적용했다. 이는 미리보기 교체 및 소유 창 정리가 beforeunload에 막히지 않도록 한다. editable owner에는 이 정책을 적용하지 않았으며 인쇄 URL·navigation fence·preload/IPC·sandbox 정책은 기존 그대로다. 제품 수정은 desktop/print-preview.cjs의3줄이다.

## 자동 검증

Node 회귀4개 통과. 같은 새 테스트를 수정 전 모듈에 적용하면3통과/1실패(이전 snapshot의 unload가 교체를 막음)한다. 저장 IPC QA의 Window adapter에 once()가 없어 기존 main의 print installer 초기화가 실패하는 별도 공백도 발견했다. 해당 adapter의 no-op once()를 보완해 실제 save handler 테스트3개를 다시 실행할 수 있게 했다.

전체 desktop 테스트는53통과/0실패/1기존 fixture skip(총54)이다. 최초 sandbox 실행의 local-server EPERM2개는 허용된localhost 테스트 범위로 실행해 해결했고 보안 설정을 변경하지 않았다. fixture가 없는 complex-layout skip을 통과로 세지 않는다.

실제 native 회귀는 기존 설치Electron 하나와 재사용 isolated QA profile 하나를 사용했다. 합성HTML Studio frame에서 실제window.open으로 product window handler를 호출하며, child에만 합성 beforeunload veto를 넣었다. fixed 최종소스에서 이전 child 닫힘 완료, 한 child 유지, 명시적 닫기 후 다시 열기, 부모 종료·child 정리, no-preload/nodeIntegration=false/contextIsolation=true/sandbox=true가 통과했다. 부모 합성 state(text/dirty/undo/redo 값)도 같았다. 이는 실제WASM/HWP document history 전부를 인쇄 중 재검증했다는 뜻이 아니다.

ready-to-show show 요청은 기록하면서 실제표시는 억제했다. visibleGUI나 OS print sheet/physical printer를 실행하지 않았다. 소유하지 않은 앱/창/프로세스는 조회·종료하지 않았다. 테스트가 넣은 child.beforeunload만 해제하고 자기 창을 정상close·app.quit으로 정리했다. 강제 프로세스 kill은 없다.

최종하네스는 고정100ms로 성공을 추정하지 않고 이전 child의isDestroyed 완료를 bounded condition으로 기다린다. interrupted trace나 proof가 있으면 같은 label 재실행을 거절한다. caught assertion 뒤 normal app.quit은 exit0일 수 있으므로 exit0만 성공으로 세지 않는다. proof.error 없음 및 replacementClosed/parentClosed/reopenAfterClose/hardenedChildren/ownerStatePreserved/cleanupClosed를 모두 검증해야 한다.

## 재실행

whole-run EvidenceBudget을 통과한 fresh phase를 먼저 만들고 marker를running으로 시작한다. ELECTRON_RUN_AS_NODE를제거한 환경에서 다음 형태로실행한다. source-root는 기본저장소 root이며외부snapshot baseline은명시적module argument로만 받는다.

```
GEULGYEOL_QA_BUDGET_ROOT=/absolute/whole-qa-root <installed-electron> scripts/check-electron-print-preview-lifecycle.cjs /absolute/repo/desktop/print-preview.cjs /absolute/fresh-phase fixed
```

동시에 다른writer/QA app을 같은profile에서 실행하지 않는다. phase의fixed.json과trace가fresh인지먼저 확인한다. 완료proof의error와6개수명주기 필드를읽고실제처리 결과를판정한뒤marker를완료한다. 이전기록과profile을삭제하거나덮어쓰지않는다.

## 근거·범위

로컬 baseline/fixed JSON 및초기하네스실패를모두보존했다. 첫준비실행은proof 없이정상종료했으며 성공으로세지 않았다. host frame에서open한초기요청은올바르게거절되어actualStudio frame으로고쳤다. 최종public source와baseline-event source는fresh trace guard 차이가있고 각각실행SHA를proof에기록했다. source/data/proof만공개하며profile/cache·개인문서·원본PDF·개인경로는올리지않는다.

기존dirty4·lock3·WASM·이전증거273/cache133·PDF3·PR40–42 heads를보존확인했다. 추가빌드/패키징/설치/보안설정변경없음. 실제OS인쇄문서전체행과끝123독립뷰어검증·제품PDF채택보류는그대로다. 이번수정은PDF검색문제해결이라고주장하지않는다. Linux native검증도미실행이다.

다음 구현후보는 인쇄문서 준비중 render실패/취소 이후재시도와문서이력보존의자동회귀다. 이한묶음의완료를전체개발종료로해석하지않는다. 병합/릴리스는별도독립검토뒤부모가조율한다.
