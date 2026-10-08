# Enter 글꼴 분류 캐시 — 통제 비교 후 로컬 채택

2bdf2e9의 후보 미채택 판단 이후 부모가 요청한 **단 한 번의 통제 비교**를 수행했다. 기존 비교는 실행 모드/과거 실행 시점이 달라 기준값이 크게 달랐다. 이번에는 같은 Mac Electron Node24.20.0 프로세스에 기준4ff4199b와 후보c258e847의 WASM을 별도 인스턴스로 초기화하고, 같은 문서/현재 typed Bridge·next-command를 사용했다. 두 인스턴스에 큰 본문12회+큰 셀12회씩 동일 예열, 각 입력 추가3회 예열을 적용했다. 입력마다20쌍을 A→B와B→A 교대로 측정해 각 순서10회를 실행했다. 파싱은 Enter/undo 타이머에서 제외하며 실행 전GC, Nodeheap192MiB, RSS768MiB/두WASM합계512MiB 상한을 유지했다. 별도컴파일/검사와겹치지않았다. V8 tiering 옵션을 바꾸지 않은 기본 런타임이다.

기준/후보의 Rust1.93.1·wasm-bindgen0.2.127, offline/locked release LTO/codegen-units=1/debug0/incrementaloff/jobs2 옵션은 같고, engine/src 차이는 text_measurement.rs의 순수KoPub분류 캐시뿐이다. 성공한 후보 빌드의 모든 라이브러리 소스 해시와 이번 로컬채택 소스가 정확히 일치한다. 새 거대 패키지/앱/ZIP/외부배포는 만들지 않았다.

측정 전에 큰 두범위의 Enter/undo 중앙값개선≥10%, paired median 절약시간95%bootstrap 하한>0, 양측sign p<.05, 각엔진 전반/후반10회 중앙값변화≤10%, 작은문서 중앙값회귀≤5%를 채택기준으로 정했다. 여섯조건이 모두 통과했다. bootstrap10,000회와 sign검사의 상세값/원시값은 proof.json에 있으며 반복측정에 대한 서술적 근거다. 합성문서 범위를 넘는GUI전체지연·모든문서 개선 보장으로 해석하지 않는다.

|대상|본문 문단 수|Enter기준ms|Enter후보ms|중앙값개선|Enter표준편차기준/후보ms|Undo중앙값기준/후보ms|
|---|---:|---:|---:|---:|---:|---:|
|body|32|2.482|1.487|40.1%|0.058/0.047|2.484/1.483|
|body|512|42.644|24.874|41.7%|0.280/0.192|42.803/25.171|
|body|8192|871.479|569.152|34.7%|19.553/2.300|872.195/575.233|
|cell|32|2.407|1.477|38.6%|0.042/0.024|2.392/1.438|
|cell|512|42.512|24.934|41.3%|0.341/0.170|42.797/25.113|
|cell|8192|876.080|571.154|34.8%|26.605/16.605|882.352/581.479|

큰문서의20쌍은 Enter와undo 모두 후보승리20/20, 양측sign p=0.0000019073이다. Enter paired median 절약95%구간은 본문301.44~304.99ms, 셀303.14~306.47ms. 큰문서 Enter의 전반/후반 중앙값변화는 모든엔진0.3%미만, undo는0.12%미만이었다. RSS관측최대337133568bytes, 두WASM합계140902400bytes. 프로세스/할당중 순간최대치를 보장하는 한도라고 주장하지 않는다. 실행412.88초 후 exit0, 모든 소유 검사 정상종료.

**유의미하고 일관된 현재 next-command 이득과 기존의 동일소스 정확성 근거가 확인되어 후보를 로컬 채택했다.** per-thread FIFO는 이름8개, 이름당256UTF8bytes 이하다. 최대2KiB는 유지하는 이름bytes만 뜻하며metadata/전체RSS는 제외다. Unicode lowercase/4substring/Dotum우선순위는 원래 그대로이고 긴이름은 기존계산으로처리한다. 폭·메트릭·스타일·문단·페이지·문서상태를 캐시하지 않으며 페이지네이션 무효화범위도 바꾸지 않는다.

기존 동일후보 정확성: 14글꼴×4서식 SVG/모든glyphdecisiontrace56조합 기준완전일치, snapshot56/재열기112. 큰본문·고정1×1셀400페이지씩 전후1600hash 및 전체text/style digest기준일치, undo/redo/두형식12회. native next162/history288/reopen324/merge36/reject126; 실제 WASM288/UI72/history576/merge72/reject21/1224출력 및native 의미/참조재열기 비교. 전파/삭제/셀수식/그룹/메타데이터/이벤트타원 회귀, native/WASM strictClippy, 전체tsc/Vite, UI11, 관련desktop30pass/0fail/1skip/1TODO가 통과했다. 이 검사를 다시 반복하지 않고 정확한 소스·WASM 해시 동일성으로 연결했다.

과거 네모드 기준504/507ms와 이번871/876ms 사이 원인은 여전히 확정하지 않았다. 예열/tiering은 가설이며, 이번 결과를 과거504ms와 섞어서 개선율을 계산하지 않는다. 이번 통제에서는 같은 프로세스·같은예열·같은현재UI명령·순서교차 조건과 안정된 전후분포가 근거다. 본문배경32/512/8192 문단과고정1×1셀 합성입력, 사진/내장폰트 없음. 큰표·사진·실제MacGUI/IME·Linux실기·한컴재열기는 미검증이다. 전체section 조판비용은 여전히 남는다. 성능의 추가분석은 이결론으로 종료하고 다음 일반편집의 데이터보존 결함선택으로 이동했다.

재현: `node --expose-gc --max-old-space-size=192 scripts/compare-enter-controlled.mjs BASELINE_ENGINE CANDIDATE_ENGINE FIXTURES OUTPUT_DIR`. 두engine의rhwp.js/rhwp_bg.wasm/package.json을 격리보존하고 같은합성fixtures를사용한다. 정확성/입력생성재현은 ../enter-font-experiment/REPRODUCE_KO.md를참조한다. 로컬에서만사용하며공개작업은보류한다.
