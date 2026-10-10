# Native bridge 급종료 후 pipe 정리

BudgetClient.close()가 이미 종료된 자체 bridge의 buffered stdin을 닫을 때
BrokenPipeError로 중단해 stdout/stderr가 열려 남는 P3를 고쳤다.
stdin의 BrokenPipeError만 처리하고 bridge wait를 finally에서 수행하며,
stdout/stderr도 중첩 finally에서 닫는다. 다른 오류를 성공으로 바꾸지 않는다.
기존 EOF running-marker 정책과 Native child 처리, 예산은 바꾸지 않았다.

실제 test-owned bridge를 begin 뒤 종료하고 newline 없는 요청을 buffering하여,
수정 전 close() BrokenPipeError를 재현했다. 수정 후 같은 테스트에서 세 pipe가
닫히고 bridge가 이미 회수됐으며 두 번째 close도 안전하다. running marker의 SHA는
유지되고 다음 phase startup은 차단된다. 실제 제품 Native/앱은 실행하지 않았다.

- wrapper 9개 / producer 7개 / 공통 Node 33개 통과
- Python -B -W error::ResourceWarning에서 경고 없음
- git diff --check 통과
- 보존된 합성 evidence root 28개, physical bytes 4,112,384 (< 10,000,000)
- 관측 free 44,646,400,000 bytes (> 16,374,562,816)

수정 전 실패 root와 수정 후 성공 root를 모두 보존했다. 원본·기존 QA·앱·캐시·
검토된 PR17/18 HEAD를 변경하거나 삭제하지 않았다. CI·새 패키지 검증은 주장하지 않는다.
metadata consumer 연결과 제품 삭제/줄바꿈/혼합 편집·경계 검증은 별도 후속 범위다.
