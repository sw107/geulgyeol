# 필수 Native pin과 전체 wrapper 종료 검증

독립 검토의 ee114bdc5754a14e819a8f73deb812d8f6f03063 P2를 수정했다.
입력의 최초 관측 hash와 필수 외부 digest 확인을 별도 메서드로 분리했다.
필수 expected()는 누락·빈 값·64자리 소문자 hex가 아닌 값을 SHA 읽기 전에 거절한다.
Native 전후, source 전후, ledger/log/SVG 및 saved Native/manifest/index process pin에
이 경로를 사용한다. optional pin()은 bounded JSON의 최초 관측 용도로만 남긴다.

saved 소비자는 이제 Native case exit0뿐 아니라 native-process.json도 요구한다.
run-native-saved-qa.py는 정확히 자신이 만든 wrapper subprocess가 반환한 전체 exit를
기록한다. phase·Native·명령·manifest·wrapper source의 전후 SHA와 final index SHA를
연결한다. 소비자는 전체 exit0, 명령의 phase/Native, index SHA, source pins, complete
phase 및 wrapper status를 함께 확인하고 종료 때 process record도 다시 pin 검증한다.

- 합성53개 통과. 기존29개와 필수5필드의 누락/빈 값/잘못된 형식15개,
  전체 exit/record/phase/index pin/Native command/검사 중 변경 거절7개,
  실제 coordinator+fake Native 성공/실패 subprocess2개를 포함한다.
- 두 실제 fake-Native wrapper의 coordinator exit는 각각0/1, 독립 record에 일치한다.
- 실제 기존 source/baseline10건·174파일을 stricter reader로 읽어 통과했다.
- 기존 저장88건에는 새 전체 process record가 없으므로 새 reader가 거절했다.
  과거 종료 증거를 사후에 0으로 채우지 않았다. 이전 제품 검증 결과는 보존한다.
- 기존30문서·12,690 query 결과와 초기29검사 public proof는 그대로 보존했다.
  좌표 알고리즘은 바꾸지 않았으며 이번 수정에서 같은 전체 query를 재실행하지 않았다.
- 새 Native 제품 실행·앱 실행·빌드·패키징·릴리스·삭제·CI 검증은 없었다.

공유 임시경로의 해당 이름을 가진 합성 root35개 physical 합계10,764,288 bytes가
기존10,000,000 한도를 넘은 것을 관측했다. root별 생성 주체는 모두 확정하지 못했다.
추가 합성 증거 생성은 중지했고 어느 root도 삭제하지 않았다. 이번53검사 root의
별도 크기와 제품 whole-run 정상/실패/free/unfinished 수치는 p2-proof.json에 기록했다.
이는 한도를 만족한 것으로 보고하지 않는다. 소스·문서 커밋과 read-only 확인만 계속했다.

PR19는 독립 검토 후 정상 병합됐고 main은77a4c925b2e43965c6780993cab174f6f9667ab4다.
제품 smoke의4흐름/undo-redo28쌍/재열기8건과 정상 앱 종료 증거는 보존했다.
제품 검증과 보조 Native 실행은 이 도구 수정의 독립 재검토 뒤 이어갈 예정이다.
