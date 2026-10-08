# dev9 통합 Mac 개발 후보 검증

별도 후보 하나 `GeulgyeolDev9.app` (`0.4.4-dev.9`, `org.geulgyeol.dev.checkpoint9`)에 이름 셀 보호·본문/단일 셀 링크 저작까지 통합했다. 소스 기준 `87e1e07`, 엔진 SHA256 `b065061056644c753ad475fb16b330fef96108a8438dab2d6481482865ab7198`. dev8와 원본 문서/기존 pkg를 보존했고 ZIP·공개 배포 없음.

엔진 소스는 직전 검증과 같아 Rust 재빌드 없이 별도 후보 WASM을 사용했다. 현재 Studio 소스·후보 DTS로 TS 검사 후 별도 Vite 빌드를 만들고, dev8 Electron 44.3.0 arm64 런타임을 복사했다. ASAR 각 파일/블록/header, 신선한 웹 자산과 bindings4개·hashed WASM 일치, Helper4개의 이름/식별자, 번들 내부 symlink·격리 프로필을 확인했다. `codesign --verify --deep --strict`가 실행 전후 통과했고 `Signature=adhoc`다. Developer ID/공증은 제공하지 않는다.

## 패키지 엔진 검사

앱에서 추출한 bindings는 패키지 바이트와 동일하다. 새 후보의 Node 24.20.0에서 이를 초기화하고 현재 실제 UI 명령/대화상자/dispatcher/Bridge/InputHandler/SnapshotCommand/CommandHistory를 실행했다. DOM·커서 기하·repaint는 어댑터다.

| 검사 | 결과 |
|---|---|
| 본문 링크 삽입·URL 편집·텍스트 보존 해제 | 정상6, 재열기22, undo/redo각6, 거절36 |
| 일반/중첩 셀 링크 깊이1~3·일반/병합·동명 이웃 | 정상84, 재열기288, undo/redo각84, 거절·취소444사례 |
| 상위 표 레이아웃·긴 링크 문구 | 높이 증가12, 페이지 분할12·SVG 반복80개 모두 출력 |
| 이름 셀 값 교체·보호 | 정상48, 거절188, 재열기96, undo/redo각72, 이름/ID 충돌20 |
| 필드 값 원자성 | 정상10, 두 형식 재열기20·snapshot10쌍; 비지원18 모두 무변경 거절 |
| 기존 ClickHere | 재열기54+이전 결함 확인4, undo/redo각24, 거절14, 셀 회귀6 |

전부 통과. 합계 HWP/HWPX 재열기484회. 실패·취소에서는 문서 모델·저장 바이트·이벤트·이력 보존을 비교했다. 기존 빈 BorderFill 차이는 정상 fixture를 편집 전에 정규화하며 실제 변경 비교를 완화하지 않았다. 각 원시 proof는 후보 디렉터리에 있다.

## Mac 프로세스 검사·한계

기본 sandbox 앱 기동은 `-6`으로 종료됐다. 후보에 한정한 승인된 실행에서 버전 HTML과 최신 JS/CSS/WASM 자산의 로컬 서버 응답·해시가 일치했다. AppleScript quit0/앱 exit0, 후보 본체·Helper 잔류0. 별도 프로필만 사용했고 원본 사용자 문서를 열지 않았다. 외부 링크 실행0, OS 보안/Accessibility/계정/인증서/원격 권한 변경 없음.

이는 앱 기동·자산 서빙·Node 패키지 엔진 실행·정상 종료 검사다. **실제 renderer 편집 GUI와 물리 IME는 미검증**이며 화면 성공으로 확대하지 않는다. Linux 이번 실행 없음. 전체 Rust library test의 기존 누락 fixture3개 제한은 유지하며 복구·대체·검사 제외 없음.

추가 디스크 최고548.9MiB/최종388.0MiB로 1GiB 목표 이내. target 전후3.332GiB, 감시 최소 여유22.43GiB로 4GiB/10GiB 기준 준수. 의존성 설치·캐시 삭제·대형 복제 없음. 기존 앱/pkg10개와 dev8 Info.plist·실행 파일 해시 보존.

## 다음 제안 하나 — 구현하지 않음

**선택 텍스트에 검토 주석/메모 삽입.** 정상 편집 문서에서 최신 실제 `insertCommands`를 등록하고 dispatcher와 메뉴 상태 갱신 코드를 실행했다. 같은 문맥의 링크 명령은 활성인데 `insert:comment`는 등록된 stub의 `canExecute: false`로 disabled다. dispatch `{'ok': False, 'reason': 'disabled'}`, 편집 호출/커맨드 이벤트0, HWP/HWPX 전체 바이트·필드·문서 정보 동일. 패키지 메뉴도 비활성이고 전용 comment/memo WASM export 없음. [재현 proof](next-gap-comment.json).

다음에는 일반 본문 한 문단의 선택 범위에 검토 메모 추가·수정·삭제를 연결하는 작은 범위를 제안한다. 먼저 기존 MEMO 저장 모델과 참조 슬롯을 확인하고, 한글/emoji·직접 서식·다른 필드/각주·메모 ID를 유지하며 undo/redo와 HWP/HWPX 재열기를 검증한다. 다른 문맥·복합 선택·불명 참조는 편집 전에 거절한다. 이번에 제품 소스나 이 기능을 구현하지 않았다.

근거 [proof.json](proof.json), 후보·원시 로그·재현 스크립트 `/Users/sw107/Documents/Codex/2026-10-06/task/dev9-checkpoint-qa`. 재개 명령·backup patch·로컬 커밋은 해당 `CHECKPOINT_KO.md`를 참고한다.
