# target 예산과 실제 디스크 여유

기준 `4c587f8a356a257b1d922aeb25ed4ca3e4d1716e`. 이번은 읽기 전용 용량 조사와 기존 WASM/작은 새 합성자료 조사이다. 새 adapter, Cargo 빌드, cache 삭제/휴지통 이동/청소, 앱 패키징은 없다.

**직전의 ‘여유31MiB’는 실제 디스크 부족이 아니라, 기존 target에 정한3GiB 작업 상한의 잔여분이다.** workspace와 target는 같은 `/dev/disk3s5` 볼륨이다. `df -k`의 available25,760,000KiB =26,378,240,000bytes ≈24.567GiB이다. 볼륨 사용률95%와 target 자체 예산은 다른 값이다. 파일 읽기만으로 상한을 올리거나 청소하지 않았다. APFS의 공유 공간/snapshot과 측정 시점에 따라 df는 변할 수 있으며 du의 부분합을 df의 감소량으로 그대로 해석하지 않는다.

| 항목 | du 할당 바이트 | 환산/의미 |
|---|---:|---|
| 기존 target 전체 | 3,188,535,296 | 2.970GiB, 자체 상한3,221,225,472bytes |
| target 예산 잔여 | 32,690,176 | 31.176MiB, 디스크 available과 별개 |
| target/debug | 2,467,688,448 | host Native 검사와 의존성 |
| debug/examples | 1,586,040,832 | 과거 rhwp 연결 검증 실행파일 비중이 큼 |
| debug/deps | 841,773,056 | 재사용할 Native dependency/metadata 포함 |
| debug/build + .fingerprint | 30,949,376 +8,925,184 | build script/설정·freshness 정보 |
| wasm32 release | 529,461,248 | release 의존성/rlib/WASM/LTO 관련 파일 |
| wasm32 debug | 113,504,256 | WASM check/Clippy 의존성/metadata |
| host release | 77,869,056 | 기존 호스트 release 도구/의존성 |

하위 항목은 부모 용량에 포함되므로 합산해 전체 사용량을 부풀리지 않는다. du는1024-byte block 할당량이고 파일의 논리크기와도 구분했다. inode/links를 함께 조사하여 같은 inode를 중복 계산하지 않았다.

| 보존할 후보 앱 | du 할당 바이트 | 약 MiB |
|---|---:|---:|
| GeulgyeolDev7.app | 351,064,064 | 334.801 |
| GeulgyeolDev6.app | 351,019,008 | 334.758 |
| GeulgyeolDevEnter.app | 350,916,608 | 334.660 |
| GeulgyeolBetaNext.app | 350,818,304 | 334.566 |

앱 합계는약1.307GiB이며 target3GiB 상한의 구성원이 아니다. 앱/ASAR는 모두 그대로 보존했고 실행파일은 기존과 같이 `ELECTRON_RUN_AS_NODE=1`로만 이용했다.

## 추가 빌드의 예상과 재사용 범위

아래 예상은 현재 산출물 크기에서 잡은 **계획용 추정/여유량**이다. 이번에 빌드하여 관측한 증가량이 아니며, 최종 net 증가와 컴파일/링크 순간 peak를 구분해야 한다.

| 후속 작업 | 현물 근거와 예상 증가/임시 여유 |
|---|---|
| 기존 WASM을 읽어 작은 합성자료 조사 | 이번 target 증가0. QA 파일만 별도로 생성. source 또는 Cargo를 변경하지 않음 |
| 새 rhwp 연결 Native 검증 예제 | 기존 대표 executable은37~38MB. plain 이름+hashed 이름이 별도 inode로 약72MiB인 쌍이 있어, 새 예제 하나에약70~90MiB를 계획하는 것이 합리적. 현재31MiB 예산보다 큼 |
| 생산 rhwp Native 재빌드 | 기존 rlib의 논리크기112,467,016bytes(약107MiB). 덮어쓰는 최종 파일의 net 증가는 작을 수 있지만 object/archive·metadata·link가 이전 파일과 공존할 수 있다. 의존성 재사용 시라도 임시 추가100~300MiB 정도의 여유를 계획하고 실측해야 함 |
| 생산 WASM release/LTO 재빌드 | 기존 rlib은100,953,424bytes(약96MiB), 두 별도 inode 복사본; WASM은13,313,371bytes(약12.7MiB), 기존 full.rmeta도약42MiB. 최종 overwrite의 net 증가와 별개로 임시 추가200~500MiB 정도를 계획하되 dependency/feature/hash 변화에 따라 더 커질 수 있음 |

과거 release 빌드 기록의 `targetAddedBytes:0`은 캐시/동일 경로 산출물을 사용한 그 실행의 최종 변화다. 모든 신규 생산 빌드의 peak가0이라는 증거가 아니고, 당시2초 단위 du 관측으로 짧은 임시 peak를 완전히 포착했다고 주장하지 않는다. 현재31MiB만으로 큰 rebuild를 시작하지 않는 판단은 자체 예산 때문이며 디스크가 물리적으로31MiB밖에 남지 않았기 때문이 아니다.

다음 자산은 그대로 재사용할 수 있다.

- 기존 `style-lint-qa/target`, Cargo home/offline cache, aarch64-apple-darwin1.93.1 toolchain과 wasm32 target. 새 target·다운로드·checkout을 만들 필요가 없다.
- Native `debug/deps`의655개 및 WASM release deps의258개 rlib/rmeta 파일. 이 수는 package 수가 아니라 artifact 수이다. 같은 toolchain/feature/profile/flag/dependency일 때만 freshness가 성립하며 다른 host/wasm/profile 사이에서 그대로 링크하지 않는다.
- 변경되지 않은 build-script 결과·fingerprint. 이번 조사에서 cache 파일이나 fingerprint를 수정하지 않았다. rhwp 소스/새 dependency를 바꾸면 rhwp와 관련 소비자는 다시 빌드해야 하며, 옛 rlib/옛 WASM을 새 구현의 검증으로 재사용할 수는 없다.
- SHA256이 같은23개 검증 executable 쌍은 별도 inode이고 중복된 한쪽의 할당량 합계792,121,344bytes(약755MiB)다. 이는 **정리 후보를 식별한 조사 결과**이며 이번에 삭제/중복 제거/링크 치환하지 않았다. QA/기존 앱/원본은 cache 정리 후보로 취급하지 않는다. future cleanup이 필요해도 별도 범위와 보존 정책을 먼저 정해야 한다.

원시 df/du, inode/크기, largest file, cache 목록과 동일 해시 executable 쌍은 `../vertical-cell-resource-metric-qa/resources.json`에 있다. 전체 생산 source/WASM·앱4개·직전 합성 원본8개의 해시는 동일했고 target 크기도 조사 전후 동일하다.
