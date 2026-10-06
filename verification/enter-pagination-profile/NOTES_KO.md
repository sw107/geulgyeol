# Enter 페이지네이션 진단

프로덕션 엔진은 b8e14bf/실제 WASM4ff4199b 그대로 두고 기존 native RHWP_2424_PROFILE 타이머와 실제 WASM CPU 샘플을 수집했다. 합성32/512/8192본문 문단, 본문·고정1×1셀을 비교했다. native debug 수치는 실제 앱 지연과 비교하지 않는다. 두 진단 실행이 일부 겹쳤으므로 절대 시간·작은 차이는 성능 개선 증거로 사용하지 않는다. 실제 기존 WASM의 12회 비계측 지연은 ../enter-performance의 자료를 기준으로 삼는다.

native Enter 단계에서 조판(typeset)은 본문99.49~99.93%, 셀99.20~99.92% 수준이다. 8192문단 본문 Enter는8193개 일반 문단, 셀 Enter는8191개 일반 문단과 표1개를 다시 조판한다. 부모 문단의 높이 측정 캐시는 잘 사용하지만 조판 단계는 모든 문단을 다시 읽는다. 구성은 본문 split의 변경 문단/새 문단만 갱신하고 셀 split에서는 본문 구성 변경 없이 section pagination만 dirty로 표시한다. section normalization revision, section/page tree, dirty bitmap/문단→단 mapping 갱신을 구별해야 한다.

WASM CPU의 단일 문자 폭 결정 하위 호출에서 StrSearcher와 Unicode 소문자 변환이 반복된다. measure_char_width_embedded_decision의 inclusive 비중은4개 프로파일에서43.7~50.6%다. 동일한 primary font name을 매 문자마다 소문자화하고 KoPub4개 substring 규칙으로 분류하는 중복 작업이 확인됐다. 즉시 전체 조판을 증분화하면 폭·wrap band·column·footnote·그림 문맥의 무효화 규칙이 넓어지므로 이번 수정 대상으로 삼지 않는다.

안전한 좁은 후보는 **글꼴 이름의 순수 KoPub 분류 결과만 제한적으로 메모**하는 것이다. 폭 자체나 문단/페이지를 캐시하지 않고, 기존 Unicode to_lowercase와 substring 규칙, Dotum 우선 순위를 그대로 유지한다. 긴 이름은 기존 계산으로 처리하고, 캐시 이름 수/UTF8 byte를 제한한다. 다양한 글꼴·대소문자·Kelvin Unicode case fold·모호한 이름·긴 이름·굵기/기울임/작은 크기/자간/위첨자와 한글·Latin·공백·탭·구두점·PUA·emoji·자모의 기준 SVG/결정 trace/undo/재열기를 먼저 확보한다.

실제GUI/IME와Linux 실기는 이번 진단에서도 확인하지 않았다. 공개푸시/릴리스는 최신 사용자 지시에 따라 보류하며 로컬 기록만 남긴다.
