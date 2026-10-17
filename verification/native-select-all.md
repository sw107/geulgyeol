# 네이티브 모두 선택 메뉴의 문서 선택 연결

기준 main은 PR #68 병합 커밋 `1d15e839f7147bd73cf64dee4cab5b6834308270`이다.

Electron 기본 `selectAll` 역할은 글결의 커서/선택 모델을 갱신하지 않았다.
실제 Mac Electron에서 두 문단 합성 문서를 열고 메뉴 콜백 후 `Q`를 입력하면
문서가 교체되지 않고 `QSELECT-ALL-A\nSELECT-ALL-B`가 됐다.

메뉴를 `edit:select-all` 명령으로 연결하고 CmdOrCtrl+A를 명시한다. 기존
undo/redo의 포커스 탐색을 공유해 문서 입력은 엔진, 일반 입력란/텍스트 영역/
contenteditable은 해당 필드의 브라우저 선택으로 보낸다. busy·초기화 중·IME 조합 중에는
실행하지 않고, 다른 모달 뒤 본문도 선택하지 않는다. 다른 창이 메뉴를 실행하면
그 창의 `webContents.selectAll()`만 호출한다. 기존 cut/copy/paste 역할은 변경하지 않는다.

## 이번 검증

- 신규 계약 검사 3개와 기존 history 검사 2개 통과. 메인 창/다른 창/닫힌 창,
  문서와 일반 필드, 중첩 iframe·모달·busy·IME 조합을 포함한다.
- 전체 desktop 170개 통과·실패 0·기존 비공개 fixture 검사 skip 1.
- 전체 Studio `tsc --noEmit`, JS 구문, Git 공백 검사 통과.
- 수정 전 실제 Electron의 메뉴 실패와 renderer 키보드 선택 동작을 대조했다.
- 최종 실제 Electron 6개 흐름: 합성 두 문단을 실제 host로 재열기, 메뉴 선택 후
  전체 `Q` 교체, 기존 2단계 undo 확인, 일반 input만 선택하고 문서 바이트 불변,
  실제 HWP/HWPX 원자 저장과 각 저장물을 새 WASM 문서 핸들로 재열기.
- 성공 실행과 중간 실패 실행 모두 소유한 앱의 정상 종료 exit 0을 확인했다.

Electron 44.3.0의 실제 메뉴 객체 콜백·production Studio·preload·IPC·저장을 사용했다.
메뉴 콜백은 QA에서 호출하고 입력/포커스는 DOM/CDP로 전달했다. 물리 메뉴 클릭이나
물리 Cmd+A/IME, Finder 조작, 정품 한글 비교를 뜻하지 않는다. 일반 input은 QA가
추가한 합성 입력란이다. 저장물 재열기는 같은 고정 WASM 엔진의 새 핸들이며
별도 Native 엔진이나 실제 앱 재열기라고 주장하지 않는다.

Studio/엔진 소스를 수정하지 않아 보존한 production 빌드를 같은 바이트로 재사용했다.
새 WASM/Vite 빌드·제품 배포 앱 생성은 없다. CI 체크 부재를 통과로 표현하지 않는다.
RFN 허가·폰트 교체·새 베타 배포 보류를 유지한다.

## 남은 기존 결함: 선택 교체 undo의 원자성

한 번의 undo는 입력한 `Q`만 제거해 빈 문서가 되고 두 번째 undo가 원래 두 문단을 복원한다.
수정 전 소스의 renderer 키보드 선택 경로와 수정 후 메뉴 경로에서 똑같이 재현했다.
따라서 이번 메뉴 수정의 회귀로 분류하지 않으며, 선택 교체를 한 번에 되돌리는 문제는
**미해결**이다. 이를 한 번의 undo 통과로 집계하지 않는다.

첫 QA의 plugin 메서드 대소문자 오류, 이 기존 undo 동작을 원자적이라고 가정한 실패와
추가 조사 기록도 원시 근거에 보존한다. 합성 파일을 재열어 이력을 초기화한 검사에서도
같은 2단계 동작이 나왔고 최종 수정 전/후 대조로 범위를 분리했다.

## 재현과 근거

```sh
node --test desktop/tests/edit-history.test.cjs
node --test desktop/tests/*.test.cjs
cd rhwp-studio && node node_modules/typescript/bin/tsc --noEmit
# 저장소 루트에서, 새로운 출력 경로와 보존한 production runtime을 지정
node scripts/check-electron-select-all.mjs NEW_PHASE_DIR fixed PINNED_PRODUCTION_RUNTIME_DIR
```

저장소 밖 `native-select-all/qa/`에 `app-baseline/proof.json`,
`app-baseline-history/undo-observation.json`, `app-fixed-complete/proof.json`,
`app-fixed-complete/undo-observation.json`, `unit-first.tap`, `desktop-final.tap`,
`typescript.log`, `delivery-freeze.json` 및 모든 중간 실패 기록을 보존한다.
사용자 dirty checkout·원본·이전 증거·폰트·엔진 입력 보존을 별도로 감사한다.

최종 감사 중 공유 Mac 여유 공간이 기존 기준 16,374,562,816 bytes 아래로 내려갔다.
추가 앱 실행/빌드를 중단하고 소규모 감사 메타데이터·커밋·PR만 마무리했다.
최종 공간 gate를 통과했다고 주장하지 않으며, 이전 증거/캐시는 삭제하지 않았다.
측정값과 중단 상태는 `delivery-freeze.json`에 기록한다.
