# 투명 채우기 Mac Chrome 검증과 최종 감사

기준 HEAD는 7bc60dd다. 현재 소스의 Mac headed Chrome에서 채우기 속성을 변경하지 않고 확인했을 때 도형 테두리 폭이 100에서 99 HWPUNIT으로 줄어드는 문제를 재현했다. 표시값 0.35mm를 다시 변환하면서 원래 정밀도를 잃었다. picture-props-apply-model.ts의 테두리 폭 처리 한 줄을 기존 addChangedMm 헬퍼로 바꿨다. 표시값이 그대로면 원래 폭을 유지하고, 실제 편집한 값과 명시적 0은 적용한다. 새 엔진 기능이나 Rust 변경은 없다.

## 검증 결과와 소스 대응

- 실제 Mac Chrome 154.0.8037.98, 현재 Vite UI 소스와 기존 최종 WASM을 함께 실행했다. UI 소스 SHA256은 b6632c0a675dac5e761350831e9b83a17676866334f438b61fc1ab41143e1ed2, 엔진 SHA256은 84a1052245d4541ff488b5338eac9ac752f00f6e694f0ec3e229306c09c55bc8다. 연결 복구 후 현재 소스와 성공 기록의 해시 일치를 확인했다.
- 작은 합성 표(1행 2열), 셀, 사각형의 투명 COLORREF·명시적 없음·실제 흰색 총 9상태를 검사했다. 속성 열기와 초기 표시, 변경 없는 확인, 변경 후 취소, 색→흰색→없음 변경, undo/redo 54쌍, HWP/HWPX 저장 90파일과 재열기 90회가 통과했다.
- 본문 글자 모양·스타일·책갈피, 표/셀 테두리·대각선·셀 크기, 도형 테두리, 전체 SVG를 비교했다. 셀 적용에서는 옆 셀을 보존한다. 표 전체 적용은 기존 계약대로 모든 셀의 채우기를 바꾼다. 이번 마무리에서는 보존된 90개의 원시 조회/예상값/SVG와 실제 저장 파일을 다시 감사했으며, 도형 폭 100과 본문의 굵은 글씨 보존을 확인했다.
- 원래 TypeScript noEmit 검사와 정밀도 12사례가 통과했다. 그림/도형의 폭 13·99·100·141·142·7200에서 변경 없는 표시값을 보존하고, 실제 0.42mm 변경·명시적 0·빈 입력의 처리도 검사했다. 복구 후 정밀도 12사례를 별도 감사 폴더에서 다시 실행했고 새 검증 스크립트의 구문도 확인했다. 최종 제품 소스는 기존 성공 실행과 같아 GUI나 빌드를 반복하지 않았다.
- 검증 스크립트를 저장했다. 후속 실행이 기존 QA 기록을 덮어쓰지 않도록 proof·서버 헬퍼·Vite 캐시의 경로만 각 실행의 새 run 폴더 안으로 옮겼다. 이 출력 경로 변경은 구문 확인 대상이며, 대화상자 동작을 다시 실행한 결과로 주장하지 않는다.

## 미해결 항목과 비교의 한계

1. **Native/Chrome 빈 엔진 문서의 쪽 배치:** 같은 저장 바이트의 Native SVG와 Chrome SVG가 여백·쪽 크기에서 달라 Native 대조가 첫 파일에서 종료 코드 101로 실패했다. 이 작업에서 원인을 확정하거나 수정하지 않았다. Native 90파일 대조/재저장이 통과했다고 주장하지 않는다. 기본 템플릿을 사용하는 추가 실행은 연결 중단 전에 적용되지 않았고 이번 마무리에서도 수행하지 않았다.
2. **HWPX 표 총 크기 getter:** 재열기 후 tableWidth/tableHeight가 0을 반환하는 차이가 남았다. Chrome 비교에서는 이 읽기 전용 총 크기 두 필드를 제외하고 개별 셀 크기·배치·전체 SVG를 엄격히 비교했다. 원시 값은 저장 파일별 observed.json에 남겼다. 같은 HWP 기준의 UI 단계에서는 총 크기가 유지되는지도 최종 감사에서 확인했다.
3. **무늬 없음의 0/-1:** patternType 0과 -1의 표현 차이를 동일한 무늬 없음으로 비교했다. 실제 기록이 이 두 값에 한정됨을 감사했다. 이 차이를 엔진에서 수정하지 않았다. 두 조회 차이의 개별 기록은 기존 proof에 총 99개다. borderFillId는 적용 시 새 자원으로 바뀔 수 있어 속성 비교에서 제외했다.

저장은 Studio의 실제 export API를 사용한 바이트를 QA 파일에 기록하고 실제 file input으로 재열었다. OS 저장 대화상자나 브라우저 다운로드 UI를 검사한 것은 아니다. 실제 DOM/Canvas2D와 Chrome 프로토콜 입력이며, 선택 위치는 DEV Cursor로 준비했고 색상 input의 input/change 이벤트는 합성했다. 물리 마우스·키보드·IME, OS 클립보드, 설치 앱·Electron host, Linux 실행은 검증하지 않았다. 사용자 문서는 사용하지 않았다.

## 보존·공간·기록

기존 39,215개 보호 기준과 중단 시점의 Chrome QA 기록을 합쳐 44,480개 파일의 SHA256을 감사했다. 변경 0, 누락 0이다. dev12 strict 서명은 유효하다. 성공 실행의 Chrome과 소스 서버는 종료 코드 0으로 정상 종료했으며, 복구 후 해당 프로세스 잔류 없음과 32168 포트 닫힘을 확인했다. 기존 로그와 실패 시도는 덮어쓰지 않았다.

기존 target은 4.2981GiB다. 이번 마무리 감사의 실제 여유는 약 18.02GiB이며, 앞선 실행의 관측 최저 약 15.99GiB와 구분한다. target 4.5GiB/실제 여유 15GiB 기준을 만족한다. 새 앱·ZIP·target·대규모 빌드·삭제 정리·푸시·릴리스·PR 변경·권한/클립보드 변경은 없다.

QA 루트: ../transparent-fill-chrome-qa.

- 기존 성공 기록: proof.json, run-1791411770003/manifest.json, 저장물/원시 조회/대화상자·Canvas 스크린샷, chrome-per-file-target-budget.json, lifecycle-run-1791411770003.json.
- 원래 정밀도/TS 결과: border-width-proof.json, border-width-budget.json, typescript-budget.json.
- 미해결 Native 결과: native-chrome.log, native-chrome-budget.json.
- 복구 후 감사: finish-audit/source-and-runtime-proof.json, preservation-proof.json, saved-results-proof.json, 재실행 정밀도 결과.
- 마지막 커밋·공간 확인은 QA의 commit-final.json과 FINISH_CHECKPOINT_KO.md에 기록한다.

다음 확인 항목은 위 세 미해결 차이의 독립 진단과, 별도로 승인된 설치 앱/OS 저장 경로 검사다.
