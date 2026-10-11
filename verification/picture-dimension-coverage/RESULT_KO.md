# 그림 imgDim 변환과 content-loss coverage 검증

기준: PR41 `b09300c4cbd68f2851aa2ddacbdfdbf0f34b75cd`. PR40 `582e1404c9efd5002c203418eee5e744084ac9d2`, main `8199830da1706535aa8965865a5d832a4269eac5`와 앞선 QA 증거를 보존했다. 새 브랜치 `dev/picture-dimension-coverage`는 PR41 위의 검증·문서 변경이며 serializer/adapter/renderer 동작을 바꾸지 않는다.

## 결론

HWPX→HWP에서 전체 좌표 범위 그림의 `img_dim=(75,75)`가 `(0,0)`이 되는 현상은 기존 어댑터가 HWP picture extra의 크기 칸에 의도적으로 쓰는 sentinel이다. HWP serializer의 필드 누락이나 parser의 읽기 누락으로 재현되지 않았다. HWP parser는 extra의 offset 9..17을 읽고, 원본 좌표 범위와 crop 우하단이 다르면 어댑터는 nonzero 크기를 그 칸에 기록한다.

검증한 전체 범위와 좌상단 crop에서는 원본 좌표 기준을 `crop.right/bottom`에서 복원할 수 있다. PNG 전체 바이트, geometry, 유효 좌표 기준, 전체 Native SVG가 보존된다. **literal imgDim 값의 동일성은 보존되지 않는다.** HWP→HWPX로 다시 변환해도 값은 0으로 남는다. HWPX→HWPX는 값을 그대로 보존하며, 우하단을 줄여 별도 원본 기준이 필요한 crop에서는 HWP와 반환 HWPX 모두 nonzero 값을 유지한다. 검증된 경우에서 복원 불가능한 이미지 내용 손실은 발견하지 못했으므로 출력 정책이나 손실 count를 억지로 바꾸지 않았다.

## 공식 자료와 근거 범위

- [한컴 HWP5 형식 revision 1.3](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf)의 §4.3.9.4 표107(인쇄47쪽/PDF52쪽)은 그림 경계·crop·padding·그림 정보·opacity·instanceID·가변 효과 정보를 열거한다. 현재 코드가 원본 크기로 읽는 extra 두 칸의 의미는 그 표에 명시되지 않는다. 공개 표만으로 이 칸을 필수 원본 크기나 저장 불가능한 값으로 단정하지 않는다.
- [한컴 OWPML imgDim.h](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPML/Class/Para/imgDim.h)와 [imgDim.cpp](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPML/Class/Para/imgDim.cpp)는 unsigned 크기 값을 `dimwidth/dimheight`로 읽고 쓴다. 이 구현에는 단위 설명이 없다. KS 원문은 이번 접근에서 확보하지 못했다.
- 글결의 `insert_picture_native`는 decoded px ×75를 기본 논리 범위로 만들며, renderer의 `compute_image_crop_src`는 imgDim / decoded px로 배율을 계산한다. 따라서 `75×75`를 PNG `75×75px`로 해석할 수 없다. 이번 1px PNG는 논리 범위75×75, 2px PNG는 별도로200×300을 사용했다. 모델의 기존 “픽셀 크기/HWPX parser만 적재” 주석을 실제 경로에 맞게 정정했다.
- 어댑터 주석에 있는 한컴2020 호환성 실측은 기존 구현의 근거다. 이번 작업은 한컴 앱을 실행하거나 그 실측을 재확인하지 않았다. 이 결과는 해당 sentinel에 대한 공식 규범적 의미나 모든 외부 편집기에서의 메타데이터 동일성을 증명하지 않는다.

## 실행한 검증

`bash scripts/qa-independent.sh --recipe picture-dimension --run-id <fresh-id>`

`engine/examples/picture_dimension_check.rs`가 문서 factory와 자체 생성된 70/77byte PNG만 사용한다. 파일 입력·개인 원본·비밀정보는 없다. 문서 저장 바이트는 메모리에만 존재하고 QA JSON/log만 디스크에 남는다. 한 쪽, 그림 한 개인 합성 문서 네 개다.

| 경우 | decoded px | 원본 imgDim | crop 좌표 L/T/R/B | HWP imgDim |
| --- | --- | --- | --- | --- |
| one-pixel-full | 1×1 | 75×75 | 0/0/75/75 | 0×0 |
| non-75-full | 2×2 | 200×300 | 0/0/200/300 | 0×0 |
| shortened-crop | 2×2 | 200×300 | 0/0/50/75 | 200×300 |
| left-top-crop | 2×2 | 200×300 | 150/225/200/300 | 0×0 |

- 네 경우 × HWP/HWPX × 일반/암호화 = **16개 export/reopen 통과**. PNG byte equality, geometry, full SVG, plain/encrypted parity, 기대 literal imgDim, 실제 HWP raw extra 크기, loss count0, live 모델 보존을 검사한다. 암호화8개는 비밀번호 없음·오답 거절 및 정답 재열기를 검사한다.
- 일반 HWP→HWPX 반환 **4개 통과**. literal metadata와 유효 좌표 기준 보존을 따로 기록한다. crop 우하단이 원본 기준과 같은3개는 literal metadata가 다르다는 사실을 성공 조건과 별도로 명시한다.
- shortened-crop의 imgDim을 의도적으로0으로 바꾼 대조군은 **유효 좌표와 실제 full SVG 모두 달라짐**을 확인한다. SVG에 실제 PNG data URI가 있는지도 검사한다. 첫 대조군은 2px 이미지의 renderer 허용 오차 때문에 차이가 드러나지 않아 crop을1/4 범위로 좁혔다. 이를 제품 결함으로 보고하지 않는다.
- bounded resource read를 거절하는 합성 resolver **2개 통과**. 양형식 actual Native report의 `binaryContentEmptied`, count1, 해당 reason, 산출물 빈 자원, 원본 자원 보존을 검사한다. 손실 바이트는 파일에 저장하지 않는다.

## count0의 의미와 남은 한계

현재 `ContentLossReport` 생산자는 HWP/HWPX 바이너리 읽기·raw passthrough 실패 및 HWPX chart preview 바이너리 실패를 보고한다. `ControlOmitted`/`MetadataReduced`는 후속 생산자용 분류다. HWP snapshot 경로의 adapter report가 이 content-loss DTO로 합쳐지지는 않는다. **count0은 계측된 손실이 없었다는 뜻이며 모든 컨트롤·메타데이터의 보존 보증이 아니다.** 이 범위를 모듈 주석에도 명시했다. 이번 그림의 literal 차이를 count0으로 은폐된 복원 불가능한 내용 손실과 동일시하지 않는다.

독립 Native runner의 offline/locked 및 용량 gate를 사용했다. 새 package, WASM/app 빌드, Electron 실행, Chrome 검증, 실제 인쇄는 수행하지 않았다. 기존 dirty4, cache, lock3, WASM 및 PR40/41 증거는 보존했다. 시작 forecast는 normal256MiB/diagnostic16MiB, 소스 주석에 따른 Native library 재컴파일 전 forecast는 normal512MiB/diagnostic16MiB이다. 실제 용량과 source hash는 `proof.json`에 기록한다. 실패한 초기 compile/factory/민감도 시도도 private QA에 남겼다.

범위는 top-level 단일 그림이다. group/table 그림, 부분적·0·음수 기준 좌표, 임의 효과, 한컴의 실제 crop 편집, Mac 저장 chooser/IPC 및 OS 인쇄는 이 검증 범위 밖이다. PR40의 실제 Mac 저장 UI 보류는 그대로 남는다. 다음 후보는 content-loss producer가 아직 없는 컨트롤/필드 metadata의 좁은 합성 재현과 보존 기준 정의이며, 실제로 복원 불가능한 값부터 coverage를 추가할 수 있다.
