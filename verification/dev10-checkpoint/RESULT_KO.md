# dev10 Mac 개발 후보 통합 결과

최신 메모 저장 보존·제한된 본문 검토 주석 저작·본문 편집 앵커 안정화를 별도 후보 하나 `GeulgyeolDev10.app` (`0.4.4-dev.10`, `org.geulgyeol.dev.checkpoint10`)에 통합했다. 제품 소스는 `658b8b27f7409d9a76b6f3c28b8617d1618d422e` 그대로다. 이 단계의 로컬 변경은 검증 재현 스크립트와 기록뿐이며 다음 기능을 구현하지 않았다.

엔진 SHA256 `15b705d0d79f74415fbbfb5e2ab616d5514f8f08101506c76d29e4c32d3c67af`, ASAR SHA256 `c4b83977cd089650cfd6c51780ce3901d764f96205ec16e056a9b2eaede49b9e`. 직전 검사 엔진과 소스가 같아 WASM 재빌드 없이 사용했다. 현재 소스/후보 DTS TypeScript 검사와 새 Vite 빌드를 거쳐 보존된 dev9 Electron 런타임의 복사본에 통합했다. 79개 ASAR 엔트리/블록/header, bindings4개와 최신 웹 자산/hashed WASM, Helper4개 이름/ID·내부 symlink·격리 프로필을 대조했다. Studio/desktop293개·engine1,147개 소스 해시가 모두 불변이다.

## 패키지 엔진 자동 검사

새 앱의 Node 모드에서 앱에 든 bindings/WASM과 같은 바이트를 실행했다. 실제 UI 명령·dispatcher·Bridge·InputHandler·SnapshotCommand·CommandHistory를 사용하며 DOM/커서 기하/그리기는 테스트 어댑터다.

| 검사 | 결과 |
|---|---|
| 본문 주석 추가·조회·내용 수정·삭제 | 변경14, HWP/HWPX 재열기64, 거절55, undo/redo각16 |
| 본문 입력/삭제·단순 문단 분할/합치기와 앵커 | 정상43, 재열기168, 거절36, undo/redo각43 |
| 기존 메모 작성자/시각·불명 제어 보존 | 재열기4, 비지원 형식 거절2, snapshot undo/redo각3 |
| 저장본 독립 Native 대조 | 저작64 + 앵커168 + 보존4 = 236개, 문서/메모·각주·스타일·필드 참조 및 HWP 원본 꼬리/제어 payload 일치 |

전부 통과했다. 일반 메모는 두 형식, 명시적 생성 시각/세로 메모는 HWPX만 저장하며 HWP 변환은 무변경 거절한다. 새 작성자는 빈 값·생성 시각 없음, 기존 작성자/시각은 유지한다. 본문 시작/끝 경계 입력은 주석 밖에 두고 안전한 빈 앵커를 보존한다. 주석 내부 분할, 각주/개체를 가진 주석 문단 분할/합치기, 문단 간 주석 선택 삭제, 불명 참조/중복/겹침/빈 앵커 충돌은 거절한다. 지원 범위 상세는 [저작](../body-comment/RESULT_KO.md), [앵커](../body-comment-anchor/RESULT_KO.md)를 유지한다.

추가 보존 probe의 최초 undo 검사는 원본 입력 바이트와 비교해 실패했다. 편집 전 첫 엔진 저장에도 동일한 정규화 차이가 있어 기준을 편집 전 엔진 저장으로 바로잡았고 정확한 undo 바이트 복원을 확인했다. 원본 파일 전체 바이트와 동등한 저장이라고 주장하지 않는다. Native probe의 최초 상대 경로 오류도 절대 경로로 고쳤다. 최초 실패 로그를 남겼으며 제품 수정은 없었다. Native 보존 예제만 캐시 갱신으로 약40KiB 늘었고 WASM은 재빌드하지 않았다.

## Mac 패키지·프로세스 확인과 한계

실행 전후 `codesign --verify --deep --strict` 통과, `Signature=adhoc`. Developer ID 서명/공증은 제공하지 않는다. 기본 sandbox 앱 기동은 `-6`으로 종료됐다. 별도 후보에 한정한 승인된 실행에서 최신 버전 HTML과 JS/CSS/WASM 로컬 서버 응답/해시가 일치했다. quit 요청0·앱 exit0·본체/Helper 잔류0. 별도 프로필만 사용했고 원본 사용자 문서/외부 링크 실행0, 보안/Accessibility·계정·인증서·원격 권한 변경 없음.

**실제 renderer 편집 GUI·물리 IME·Linux는 미검증**이다. 기동/자산 서빙/Node 엔진 검사와 구분한다. 전체 library unit test는 직전 소스 검사에서 기존 누락 fixture3개(`3-09월_교육_통합_2022.hwp`, `hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`)로 컴파일이 막혔고 이번에는 반복하지 않았다. fixture 대체/검사 제외 없음. 한컴 전체 대체와 실제 corpus 전체 무손실을 주장하지 않는다.

기본 앱·공개 beta.2·기존 dev3/dev9 및 이전 후보를 변경하지 않았다. 지정 보호 파일16개(기준 엔트리17개)의 해시가 모두 일치한다. 새 앱 하나·ZIP 없음, 공개 push/release 없음. 추가 최고/최종 약381.4MiB, target 최고/최종3.609GiB, 감시 최소 여유21.896GiB로 1GiB/4GiB/10GiB 기준을 지켰다. 의존성 설치·대형 복제·캐시 삭제 없음. 정확한 바이트 수와 실패/통과 원시는 [proof](proof.json)에 있다.

## 다음 제안 하나 — 문단 띠 메뉴

일반 편집 문서/본문 한 문단 선택에서 `insert:para-band`가 실제 registry에 등록된 `canExecute: false` stub임을 재현했다. 같은 문맥의 하이퍼링크와 검토 주석은 활성이다. dispatcher 결과 `{ok:false, reason:'disabled'}`, 실제 메뉴 상태/패키지 메뉴 비활성, 편집 호출/command 이벤트0, HWP/HWPX 전체 저장 바이트·문서 상태 불변이다. 전용 para-band export도 없다. [재현 근거](next-gap-paragraph-band.json).

후속은 일반 본문 한 문단의 문단 띠 적용/제거를 작은 범위로 제안한다. 먼저 기존 문단 테두리/배경 또는 개체 저장 표현을 확인해 계약을 정하고, 본문·스타일·직접 서식·필드/주석·각주 참조, undo/redo와 두 형식 저장재열기를 검증한다. 복합 문맥은 편집 전 거절한다. **이번에는 구현하지 않았다.** 실제 Mac GUI/IME 확인도 남아 있다.

앱·원시 로그·재개 명령·백업은 `/Users/sw107/Documents/Codex/2026-10-06/task/dev10-checkpoint-qa/CHECKPOINT_KO.md`에서 확인한다.
