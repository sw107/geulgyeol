# Native metadata 소비자

qa-native-metadata-input.mjs는 producer가 기록한 nativeBinary 절대 경로와 전후 SHA를
사용한다. 기존 native/debug 경로를 추측하거나 compatibility hardlink를 만들지 않는다.
실제 Native 실행은 하지 않는다. metadata가 없는 과거 증거는 기존 indexed 검사와
summarizer를 그대로 사용하며, 새 consumer는 누락/잘못된 metadata를 자동 fallback하지 않는다.

source 모드는 완료된 source/baseline phase marker, complete proof, seed 계획의 순서·
개수·identity, Native 명령 경로·각 exit code와 SHA, source/ledger/log/oracle/SVG pin을
확인한다. 파일은 bounded regular canonical 경로에서 읽고 Native도 streaming hash를
사용한다. 입력·marker를 검사 전후 다시 확인한다. JSON 32MiB, SVG 16MiB,
Native 512MiB 상한을 적용한다. read-only CLI와 callable reader를 제공한다.

saved 모드는 phase 완료와 native-wrapper-status 완료를 index.json의 존재와 함께
요구한다. 모든 Native case exit code 0, nativeSame, overflow 0, case 수, wrapper
source 전후 pin과 Native binary SHA를 확인한다. 최종화 실패로 index가 남아도 failed/
running marker나 불완전 wrapper status이면 거절한다. 이는 저장 모델/SVG의 재검증이나
wrapper 전체 process exit를 독립 확인하는 도구는 아니다. 실제 Native 비교와 전체
process 종료 증거는 기존 제품 QA에서 별도로 확인됐다.

check-colspan-two-owner-carets-metadata.mjs는 기존 indexed 알고리즘의 successor다.
metadata reader를 시작/끝에 연결하고 성공 proof를 쓴 뒤 완료 marker를 기록한다.
기존 indexed 및 private dirty 검사, producer, 엔진과 앱은 수정하지 않았다.

## 검증

- 합성 29개 통과: compatibility 경로 없이 정상 source 읽기; legacy hardlink가 있어도
  누락 metadata 거절; 상대 경로·SHA·명령·exit·count·identity·marker 불일치와
  source/Native/process/marker의 검사 중 변경 거절; retained saved index의 실패/미완료 거절.
- 기존 Native source/baseline 10건, 입력 174파일 metadata 읽기 통과.
- 기존 저장 비교 88건, 입력 4파일의 완료 metadata 읽기 통과. Native 재실행 아님.
- 고정 WASM에서 새 좌표 소비자 exit 0: 30문서·12,690 query. 기존 모든 결과 행 exact.
  최대 x 0.10px / y 0.047px / height 0.034px, 허용 0.11px.
- 기존 입력/증거·새 도구 전후 SHA, 컴파일 source4, 보호파일22·과거 proof23 불변.
- 옛 compatibility hardlink는 같은 inode/link-count 2로 보존.
- Node syntax / git diff --check 통과. CI 성공은 주장하지 않음.
- whole-run 정상 229,412,864 / 실패 93,597,696 bytes, unfinished phase 0,
  768MiB/256MiB 한도 이내. 합성 root29/physical 5,619,712 bytes는 10,000,000 이내.

Native: 1801e456363aa79de62e96f60d846a30d8d37251e0bfef72bb2a2dff686ad250
WASM: 444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988
P3 dependency: 3c19b9401c046e647fe35b33db225fc397d23931 (별도 draft PR19)

새 Native·Electron 실행/빌드/패키징·릴리스·삭제는 없었다. 이 후속 결과는 기존 제품
검증 범위를 확장하지 않는다. 제품44작업은 삽입만(머리행10/병합셀26/본문8) 검증됐다.
다음 제품 검증은 삭제·줄바꿈·연속혼합편집·snapshot 예산 소진·실제4/65행 경계 편집·
제외 조건의 기존 엔진 대비 fallback 배치를 우선한다. 물리IME·수동GUI·실제 OS chooser·
새 패키지·Linux·한컴동등성은 미검증이며 베타 릴리스는 별도 승인 대기다.
