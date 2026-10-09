# Mac beta.3 내부 후보

0.4.4-beta.3 / `GeulgyeolBeta3.app` / Mac arm64 / `org.geulgyeol.beta.0443` 후보 하나를 만들었다. main 기준은 `795f93cf48c86cf0f9b52d1ce60c10f7b411664b`, 표 수정은 `7b5a028620e8e810bdd122c454d7d2a274b8f015` ([초안 PR 8](https://github.com/sw107/geulgyeol/pull/8)), 실제 패키지 제품 소스는 `17821392ac2156df369f7a67242c2f182c889489`다. 이후 검증문서 커밋과 패키지 제품 소스를 구분한다. 후보 브랜치는 PR 8에 의존하며 부모의 독립 검토·병합·릴리스 조율을 기다린다. 공개 beta.2 태그·앱·ZIP·사용자 원본·기존 QA는 보존했고 새 공개 릴리스나 ZIP은 없다.

## 포함된 수정과 패키지

main에 병합된 표 안/밖 여백·입력 범위 원자적 거절·반복 머리행·후행 본문 앞간격·실제 프레임 하단 진단에 더해 긴 병합 셀 조각의 넘침/중복과 원본 저장 프레임 undo 복원을 포함한다. 해당 표 묶음은 실제 Electron 114사례, undo/redo 200쌍, HWP/HWPX native IPC 재열기 200건, 기하 314회/3366쪽 및 Native 512파일 비교를 통과했다. 자세한 합성 출처와 범위는 [표 검증](../table-stored-merged-fragments/RESULT_KO.md)에 있다.

기존 공식 Electron 44.3.0과 의존성을 재사용했다. 새 엔진을 지정한 production Vite에서 QA 선택/읽기 전역과 dev probe를 제외했고 현재 tracked desktop 코드·SDK·라이선스와 글꼴을 명시적으로 새 ASAR에 넣었다. 앱과 별도 `GeulgyeolBeta3` 설정 폴더를 사용한다. 전체 ASAR 엔트리 출처/해시, build-info 소스 SHA, Info.plist·제품 이름·버전·bundle ID, 내부 링크, 실행 전후 strict deep ad-hoc 서명을 확인했다. QA 후 ASAR 해시는 그대로다. 앱 약 334.73MiB, ZIP 없음. 이전 앱 ASAR 11개는 동일 해시다. 의존성 설치·새 target·기존 앱 덮어쓰기·캐시 삭제·보안 설정 변경은 없다.

## 실제 후보 앱 검증

- 어댑터 없는 일반 기동 1건: 제품 버전·실제 수신 WASM SHA·새 문서 clean 상태를 확인하고 소유 PID에 정상 종료를 요청했다. main inspector/native 응답 교체는 사용하지 않았다.
- 저장·종료 lifecycle 29건: 양형식 저장, 취소·선택 오류·실제 파일 rename 실패, 같은 task의 늦은 편집, 승인 후 입력, 저장/복구본 정리 중 편집, transaction abort 및 삭제 실패에서 문서·창·복구본 보존, 최종 실제 저장 후 정상 종료.
- 실제 idle autosave→renderer crash→cold restart→복구 선택→추가 편집→저장→세 번째 기동 재열기 6건. 같은 전용 origin과 IndexedDB 복구본을 사용했다.
- 복구 안전성 8시나리오/20검사: debounce 전 두 번째 충돌, 삭제 실패, 나중에, 전체 삭제 실패/재시도, 다중 후보 선택, 복구본 교체 put 거절·실제 transaction abort·교체 성공. 원본 durable copy 보존과 실제 저장 뒤 해당 복구본만 정리를 확인했다.
- pruning 5시나리오/15검사: 미래 저장 시각, 조회 거절/abort, 삭제 거절/abort. 현재 복구본을 pruning하지 않고 오류 뒤 crash/restart에서도 최신 커밋 내용을 복구했다.
- 합계 71검사, 실제 앱 프로세스 정상 종료 41건. lifecycle pageErrors 0. 제어된 renderer crash/IDB 실패는 재현 조건이며 예상하지 않은 제품 오류로 세지 않는다. ASAR를 테스트 중 변경하지 않았다.
- 새 후보 WASM을 명시한 desktop unit 49통과·실패 0·기존 비공개 fixture 1 skip. 첫 기본 경로 실행은 보존된 오래된 desktop 자산을 읽어 여백/최소 export 세 검사가 실패했으며 원시 결과를 보존했다. 실제 후보 엔진을 지정하면 세 검사 모두 통과한다. TypeScript·production Vite·Node 구문·diff 검사를 통과했고 앱 준비 뒤 가용 공간은 15GiB보다 크다.

## 정확한 해시와 한계

WASM SHA256: `b5b5b2fc52dedbd0140322497e7fe792c9a34f8568ed8bc8f02dbd341a67474b`.
ASAR SHA256: `e94f2bfc1b0cb1911c358fe16e036935c7ad8514ee4923bff89555f05990e15e`.
전체 번들 manifest와 실행파일·ASAR header 해시는 [proof.json](proof.json)에 있다. raw 앱·검증 로그·전용 프로필·중간 실패·checkpoint는 저장소 밖 `../table-stored-merged-fragments-qa/`에 보존한다. 공개 커밋에는 소스·검증문서·요약 해시만 넣는다.

부분 저장 프레임의 짧은 행 합성 사례는 객체 높이가 산술적으로 24행에 해당하지만 실제 첫 조각은 0~26행이다. 모든 셀의 저장 LINESEG 위치가 각각 0부터 시작하므로 객체 높이만으로 한컴에서 저장한 쪽 경계라고 단정하지 않는다. 실제 한컴 원본과 화면 비교가 없어 이번 결과를 그 호환성 인증으로 확대하지 않는다.

실제 앱 production UI·WASM·IPC·파일 쓰기·IndexedDB·재실행을 검사했으며, lifecycle/복구의 네이티브 응답·충돌·IDB 실패는 QA에서 제어했다. OS 파일 선택창 직접 조작·물리 IME·수동 GUI·Linux·한컴 앱 비교는 미검증이다. Developer ID 서명·공증은 제공하지 않는다. 전체 Rust lib 테스트는 기존 샘플 세 개 누락으로 차단 상태다. 이번 gate 밖의 병렬/혼합 rowspan 소유자·세로 셀·캡션·중첩 컨트롤과 실제 원본의 저장 쪽 경계는 다음 구현/검증 후보이며, beta 후보 통과를 전체 개발 종료로 취급하지 않는다. 공개 패키지/릴리스 판단은 부모가 독립 코드 검토 뒤 내린다.
