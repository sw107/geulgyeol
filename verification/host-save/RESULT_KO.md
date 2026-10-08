# Electron host 저장의 중복·실패 보존

기준 HEAD `7f02751`, 깨끗한 작업 트리에서 공식 `storage.cjs`의 atomicWrite와
`main.cjs`에 실제 등록되는 `baram:save` 핸들러를 조사했다. 별도 `host-save-qa`의
작은 합성 파일만 사용했다. **수정은 소스 후보에만 있고 dev.12에는 포함되지 않는다.**
dev.12/이전 앱·원본은 보존했으며 새 앱/ZIP/target/Rust 빌드·추가 푸시 없음.

## 재현 및 수정

| 재현 | 수정 후 |
|---|---|
| host 저장 요청2개가 겹치면 새 내용 저장 완료 뒤 이전 요청이 늦게 끝나 이전 내용으로 덮어씀 | 한 번에 저장 하나만 진행. 대화상자 대기와 실제 쓰기 동안 중복 요청을 거절하고 완료/취소/실패 후 재시도 가능 |
| 실제 임시 파일 쓰기 EIO 뒤 정리 close에서도 EIO가 나면 원래 오류가 가려지고 임시 파일이 남음 | 원래 오류를 유지하고 close 정리 실패가 임시 파일 정리를 건너뛰지 않도록 함. 기존 합성 문서 hash 불변 |
| 임시 파일 독점 생성이 EEXIST로 실패해도 기존 동명 파일을 unlink함 | 해당 호출에서 생성에 성공한 임시 파일만 정리 |
| 기존 runtime 재사용 packager가 수정된 storage.cjs를 읽지 않아 이전 모듈을 유지 | 현재 storage.cjs를 패키지 계획에 포함. 앱 생성 직전에 중단하는 어댑터로 전후 차이를 검증 |

동시 저장 순서·write/sync/close 오류·독점 생성 충돌은 어댑터로 결정적으로 주입했다.
파일 생성/쓰기/fsync/rename/read는 실제 Node 파일시스템이다. 물리 디스크 고장이나
사용자 문서 손상 재현이 아니다. 원래 host 오류가 UI에 전달되고 dirty가 유지되는 경로도 확인했다.

## 검증과 한계

실행은 기존 Electron의 **Node 모드**다. 실제 main 소스를 VM에서 실행해 공식 IPC 핸들러를
등록하되 Electron app/창/session/대화상자는 어댑터다. 설정 함수도 no-op이므로 사용자
프로필/권한을 바꾸지 않는다. 실제 host UI save 함수는 DOM/editor/preload 어댑터로 실행한다.
실제 renderer/IPC 전송/OS 대화상자 검사와 구분한다.

- host/UI **19개 검사군**: HWP/HWPX 새 파일·합성 파일 교체, 취소/선택 없음,
  확장자 불일치/대문자 HWP, 데이터/형식 거절6개, 비신뢰 요청, 잘못된 경로4개,
  rename 실패 정리, sync·write/close 오류, 독점 생성 충돌, 동시 저장/재시도,
  UI busy/완료·취소·실패·저장 중 추가 편집의 dirty 보존 통과.
- 최종 소스의 지속 회귀 **4개 테스트**: 실제 host 완료/취소와 UI 연결, 실제 임시 파일
  쓰기 및 close 오류의 원본/오류 보존과 재시도, 파일 쓰기 대기 중 중복 IPC 거절,
  EEXIST 기존 파일 보존 통과. 실제 host 오류가 실제 UI save 함수까지 전달된다.
- 기존 host·닫기·shortcut·이력·새 문서·패키지 엔진 **10개 회귀 테스트** 통과.
- 최종 Native 근거 **11개 저장물**: 대표 host8개 + 마지막 host/UI 회귀3개.
  cached Native 재열기 및 같은 형식의 기대값과 전체 SVG·문단·서식·DocInfo·BinData 일치.
  저장 bytes는 payload와 정확히 같고, 편집 replay나 저장 캐럿 정규화를 사용하지 않았다.

상세 해시·로그·자원은 [proof.json](proof.json)에 있다. baseline의 exit0은 예상 결함3개를
수집했다는 뜻이며 문제 없는 검사로 해석하지 않는다. 최종 검사는 문제0을 요구한다.

처음 `createEmpty()`만으로 만든 합성 HWPX는 cached Native 재출력에서
`미등록 ID 참조: charPrIDRef: [0]` 오류가 났다. 실패 샘플/로그를 보존하고 엔진 재빌드 없이,
이전 Native 검증을 통과한 작은 합성 `plain.hwpx`의 서식 구조로 최종 fixture를 생성했다.
위11건은 후자의 결과다. 초기 빈 샘플도 Native 성공으로 포함하지 않는다.
실제 UI 새 문서 초기화가 동일하게 실패하는지는 확인되지 않았다.

cached Native oracle은 확장자를 대소문자 구분해 `uppercase.HWP`의 기대값을 HWPX로
출력하는 제약이 있다. host는 대문자 확장자를 올바르게 허용한다. 격리 폴더에 동일 inode의
소문자 hardlink 하나를 만들어 올바른 HWP 분기를 선택했다. 원래 저장 bytes는 불변이며
inode/hash 매핑은 `native-final/aliases.json`에 있다. 잘못된 분기/중간 거절 로그도 보존했다.
최종11건은 모두 엄격 통과다.

host 형식 검사는 byte 타입/64MiB 상한·CFB/ZIP magic·확장자 일치다. 문서 구조는
해당 저장물의 독립 Native로 확인했다. 전체 구조 검사기를 host에 추가한 결과는 아니다.

## 보존 및 다음 확인

보호 파일 **37,702개** hash 일치. 이전 소스 freeze1,470개 중 변경은 main/storage/packager3개뿐이며
엔진/studio 소스는 불변이다. dev.12 ASAR/WASM·Native·shared target 불변, dev.12 strict ad-hoc
재확인, 관련 프로세스0. 사용자 원본/클립보드/OS 대화상자 접근 및 시스템 권한·계정·인증서
변경 없음. 기존 산출물 삭제 정리 없음. 공식 atomicWrite 시험 호출의 임시 파일 정리만
검증했고 baseline에 남은 새 합성 임시 파일 등 실패 증거는 보존했다.

추가 QA 약**7.6MiB**, target **4.0422GiB** 불변, 실제 최소 여유 약**17.34GiB**.
target4.5GiB/free15GiB 및 추가1GiB 감시를 지켰고 중단0이다. 소량 문서/로컬 커밋을
포함한 최종 bytes는 `host-save-qa/commit-final.json`에 기록한다.

물리 입력·실제 OS 대화상자·Electron renderer 저장 IPC·전원 손실/물리 디스크 고장·
한컴/Linux는 미검증이다. 실제 앱 통합은 허용된 다음 단계에서 필요하다. 우선 빈 합성
샘플의 Native HWPX ID 참조와 실제 새 문서 초기화를 대조할 수 있다.
