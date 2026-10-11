# 복잡한 합성 문서의 암호 저장 회귀

PR40 `582e1404c9efd5002c203418eee5e744084ac9d2`에서 별도 브랜치
`dev/encrypted-complex-regression`를 만들었다. **제품 변경은 없다.** 새 Native 예제,
host 회귀 도구, 소유·오프라인 QA recipe 및 검증 기록만 추가한다. PR40 고정 SHA와
Mac UI 미검증에 따른 draft/병합 보류를 유지한다. 인쇄/이전 앱 조작도 재개하지 않았다.

## 기존 fixture와 실행 범위

새 원본을 만들거나 개인 문서를 사용하지 않았다. 이전 합성 QA 파일 세 개를 SHA로
확인하고 소유 QA 디렉터리에 작은 복사본만 만들었다. 기존 파일은 읽기만 했다.

| 기존 합성 문서 | 현재 범위 |
|---|---|
| repeat-table | 48행·1열, 반복 머리행, 후행 본문, 3쪽 |
| merged-repeat-table | 48행·1열·46 owner, 중간 rowspan, 반복 머리행, 후행 본문, 11쪽 |
| caption-pictures | 그림 2개·캡션·이웃 필드/메모, 1쪽. PNG 자료는 각각 68bytes |

표와 그림은 서로 다른 기존 문서다. 이 결과는 표 안 그림이나 대용량 이미지까지
확인했다는 뜻이 아니다. fixture 출처와 해시는 [proof.json](proof.json)에 있다.

Native에서 각 fixture를 HWP/HWPX 암호 입력 문서로 만든 뒤 본문에 `SAVED_EDIT `를
넣고 양형식으로 저장해 **3×2×2=12개 고유 조합**을 검사했다. 열기 암호와 저장 암호는
서로 다른 공개 테스트 상수이며 값은 로그/CLI/IPC에 기록하지 않았다. 평문 기준
serializer와의 비교는 메모리에서만 수행하며 평문 파일이나 host fallback은 만들지 않았다.

## 최종 검증 결과

- Native 12조합 모두 암호화/평문 기준 출력의 typed projection과 전체 SVG가 일치.
  올바른 저장 암호 재열기, 무암호·잘못된 암호·이전 암호 거절 통과.
- 본문·셀·캡션 text/문자서식 참조, 문자서식 정의, 표 반복 머리행·cell header·rowspan·
  치수, 그림 geometry/crop/기본 속성 및 전체 이미지 bytes가 12조합 모두 유지된다.
  현재 source 전체 SVG와 재열기 SVG도 같다. 전체 문단서식/컨트롤 모델 일치는 아래와 구분한다.
- 현재 WASM serializer + 실제 `baram.js` 저장 함수 + `main.cjs`에 등록되는 저장
  핸들러 + 실제 atomic Node filesystem으로 암호 파일 12개 저장. 실제 파일 선택은
  어댑터이며 성공 시 선택한 기존 합성 파일을 snapshot으로 교체했다.
- host 저장물 12개를 별도 현재 Native 실행으로 다시 열어 기대 Native 출력과
  typed projection·전체 SVG를 대조. 재열기 Native/WASM의 모든 쪽 SVG SHA도 일치.
  이 검사에서 표 머리행·컨트롤·문자/문단 정의·스타일·BinData ID/확장자/전체 bytes 해시를 함께 비교했다.
- PR40 단위9 + 기존 host/revision/write-fence/storage 회귀11, 합계 **20개 재실행 통과**.

## 형식 차이와 손실 거절의 구분

Native 출력 12개 중 **동일 형식 6개는 source typed projection도 정확히 일치**한다.
**교차 형식 6개는 전체 typed projection 차이가 남는다.** 따라서 12개 전부를
완전한 형식 보존으로 집계하지 않는다. 현재 암호 저장 결과는 같은 형식의 평문
기준 출력과 일치하므로 이 차이를 새 암호화 결함으로 단정하지 않는다.

교차 형식의 문단 정의에는 `attr1`과 `break_latin_word`(null↔KEEP_WORD) 표현 차이가
있다. 그림 문서의 컨트롤에는 메모/필드 원시 표현, `ctrl_data_name`, 파라미터,
그림 numbering/shape control ID가 달라지고 **그림 `img_dim`이 HWPX의 75×75에서
HWP의 0×0으로 바뀐다.** 현재 PNG bytes·crop·표시 geometry·전체 SVG는 같지만
그림 메타데이터 전체 보존으로 확대하지 않는다. 정상 12개 저장의 손실 보고는
모두 count0이므로 보고서0만으로 전체 IR 보존을 입증할 수 없다.

손실 실패도 별도로 검사했다. 기존 그림 문서의 Native QA 복제본에서 한 자료의
bounded read만 거절하고 raw passthrough를 제공하지 않았다. 실제 양형식 reported
serializer가 count1/`binaryContentEmptied`를 반환한다. HWP 이유는
`rawPassthroughUnavailable`, HWPX는 `resourceReadFailedOrLimitExceeded`다.
live 자료 bytes/model은 유지됐고, 손실 산출 bytes는 저장하지 않았다.

이 실제 Native 손실 DTO 두 개를 host의 reported artifact 경계에 어댑터로 주입해
**파일 IPC0·dirty 유지·완료 통지0·선택한 합성 파일 해시 유지·평문 fallback 없음**을
확인했다. 이 두 검사는 WASM 자체의 자원 읽기 실패를 주입한 결과가 아니다.
정상 fixture의 실제 host 저장 12건/손실0과 Native fault2/host DTO gate2를 각각 집계한다.

## 근거·보존·한계

최종 실행은 `encrypted-complex-pinned-native-20261011` → `host-pinned` →
`encrypted-complex-pinned-reopen-20261011`이며 runner/Native source pin과 실제
저장 파일 해시를 다시 대조했다. Native/host 출력 및 회귀 로그는 이 디렉터리의
`.txt` 4개다. 실패/중간 시도는 로컬에 보존했다. 최초 컴파일 실패는 새 QA에서
ContentLoss DTO와 SHA API를 잘못 호출한 오류였고 제품 실패로 집계하지 않는다.

typed projection은 text·서식 참조·컨트롤 typed 필드·정의·스타일·이미지 해시를
비교하며 `raw_*`, packed `attr`, layout/cache 필드는 제외한다. `attr1`이나 `img_dim`의
차이를 제거해 성공으로 만들지 않았다. 실제 원본 raw record 전체 동등성 검사는 아니다.
세부 차이 path는 component별 최대32개씩 로컬에 보존하고 공개 proof에는 경로를 요약했다.

기존 dirty4/lock3/WASM 및 PR40 제품 소스는 보존했다. PR40 파일 중 수정한 것은
새 recipe를 추가한 `scripts/run-independent-qa.py`뿐이다. 새 앱/패키지·WASM·제품
엔진 재빌드는 없으며 새 Native QA 예제만 기존 소유 target에서 컴파일했다.
추가 normal256MiB/diagnostic32MiB 예산 및 전체7GiB/진단1GiB/free floor
16,374,562,816B 한도를 지켰다. 정확한 전후 값은 proof에 있다. 영구 삭제·보안/권한
설정 변경·실제 암호/개인 원본·fixture/앱의 외부 전송은 없다.

**Mac Electron 화면/실제 IPC 전송/OS 선택창/물리 암호 입력/IME/포커스/undo·redo 이력,
한컴/Linux, HWP3, 더 복잡한 문서와 대용량 이미지의 실제 사용은 미검증이다.**
UI 미검증을 Native 결과로 완료 처리하거나 PR40 병합 보류를 해제하지 않는다.
이전 late-edit 계약도 유지한다. 선택 파일에 이전 snapshot이 저장될 수 있으며,
현재 추가 편집은 dirty로 남는다. 모든 저장 실패에서 원본 파일이 보존된다는 확대 주장은 하지 않는다.

## 재실행과 다음 후보

검증된 기존 private fixture manifest가 필요한 도구다. fixture가 없으면 개인 원본을
대용하지 않는다. 저장소 루트에서 아래의 output/run-id에 매번 새 이름을 사용한다.

```sh
bash scripts/qa-independent.sh --recipe encrypted-complex --run-id complex-new-native --input .geulgyeol-local/qa/encrypted-complex-20261011/fixtures.json
node --experimental-strip-types scripts/check-host-encrypted-complex.mjs .geulgyeol-local/qa/complex-new-host .geulgyeol-local/qa/complex-new-native/native
bash scripts/qa-independent.sh --recipe encrypted-complex --run-id complex-new-reopen --input .geulgyeol-local/qa/complex-new-host/native-manifest.json
```

다음 독립 후보는 교차 형식의 문단/그림 메타데이터 차이를 보존 가능한 표현과
현재 형식 제한으로 더 좁게 분류하고 손실 보고의 coverage를 확인하는 것이다.
기존 앱 상태가 확인된 뒤에는 PR40 실제 Mac 암호 입력·취소·저장·재열기·이력 검증이 남는다.
