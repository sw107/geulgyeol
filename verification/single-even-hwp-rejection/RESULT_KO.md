# 단일 Even 바탕쪽 HWP 저장 거절

기준 main은 `2a9c13448fdf682f169e5d4ba025135432d36fd1`이다. PR86은 이 브랜치에
포함하지 않고 실제 앱 검증 전 Draft 보류를 유지한다. 다른 작업으로 자료를 보내지 않는다.

## 지원 계약

새 HWP 레코드를 생성해야 하는 물리 루트 구역에 일반 바탕쪽이 **하나뿐이고 Even**이면
HWP 저장을 `UnsupportedInput`으로 거절한다. 현재 인코더는 이 선언을 Both와 같은
바이트로 내보내므로 적용 범위·상속을 보존한다고 보장할 수 없다. 홀수 쪽에 현재 표시가
같거나 바탕쪽 문자열이 같아도 거절한다. 비밀번호·보고서 유무와 무관하다.

오류 안내는 “단일 짝수 바탕쪽의 적용 범위와 상속은 현재 HWP 저장에서 보존할 수 없습니다.
HWPX 형식으로 저장해 주세요.”이다. single-Even의 올바른 한글 비트를 추측하거나
Both 파싱을 Even으로 바꾸지 않았다.

직접 HWPX, 기존 정상 Odd/Both·명시 Both+Odd, 변경 없는 신뢰 가능한 HWP raw 통과는
유지한다. HWPX/HWP3/HML처럼 어댑터가 새 HWP 레코드를 만드는 출처는 raw 캐시가
있어도 사전 거절을 우회하지 않는다. inline 소유자는 기존 거절 계약을 유지한다.
확장 바탕쪽을 섞은 단일 base, 복수/중복 선언·방향·이미지/표 등은 새 지원으로
인증하지 않는다. raw HWP의 인코딩 의미 자체도 새로 인증한 것이 아니다.

## 원자성 및 앱 경로

serializer의 공통 경계에서 파일 바이트 생성 전에 검사한다. 변경 가능한 Native
어댑터 export는 어댑터·DocInfo 캐시 갱신 전에 같은 검사를 한다. snapshot export는
원래부터 복제본에서만 변환하며 live 문서를 바꾸지 않는다.

bridge의 기존 `onBeforeExport`는 캐럿을 문서에 기록한다. 새 읽기 전용
`validateHwpMasterPageExport`를 **이 hook 전**에 실행해 거절 시 캐럿도 보존한다.
검사 기능이 없는 옛 SDK와 섞인 새 bridge는 HWP 전체를 hook 전에 중단하고 HWPX를
안내한다. 이 head는 새 SDK와 함께 배포해야 한다. 옛 UI에 SDK만 교체한 조합은
캐럿 hook 순서가 다르므로 새 UI와 SDK를 함께 고정해야 한다. HWPX에는 새 검사를 적용하지 않는다.

오류는 serializer → Native 오류 → WASM throw → bridge → `baramHost.export` →
기존 desktop 오류창으로 전달된다. 호스트는 export bytes를 만든 뒤에야 IPC 저장을
요청한다. 따라서 이 오류에서는 파일 선택·쓰기·저장 완료/clean 처리가 실행되지 않는다.
Studio의 직접 파일 저장도 export payload를 먼저 만들고 나서 파일 handle을 연다.

바이트 전용 HWP 소비자도 거절한다. HWP 전용 자동 복구는 export 오류를 보고하며
이전 draft를 덮어쓰지 않는다(`saveDraft`보다 export가 먼저다). 암묵적인 HWPX 자동
전환은 추가하지 않았다. compare/digest 등 HWP만 요구하는 보조 호출도 이 조합에서
실패할 수 있다. 실제 앱/복구 사용자 흐름의 전면 인증은 별도다.

## 회귀

자체 생성17종(기존13종 + Even/Both 충돌 대조2종 + 앞 정의만 바꾼2종)을 사용한다.
단일Even 거절 대상은11종, 정상 HWP 대조군은6종이다. 작은 본문 편집 후 기존 파일을
둔 채 plain/reported/password 및 변경 가능한 Native export를 검사한다.

Native는 파일을 유지한 거절66회, adapter raw-cache 우회 방지11회, 재열기103회와
snapshot 복원68회를 검사한다. 앞 Odd 정의만 바꾼 경우와 같은 문자열 대조군에서
HWPX의 상속 결과가 따라오는지도 검사한다.

WASM은 raw API·실제 bridge 메서드의 거절 각44회, 실제 desktop controller/IPC/storage
코드에 연결한 거절11회, 이력 undo/redo22회와 재열기46회를 검사한다. 이 테스트는
DOM/대화상자 대역을 사용한다. 거절 시 onBeforeExport·chooser·write 호출0, 기존
파일 bytes·dirty·파일명·문서·이력이 유지되는지 확인하고 같은 문서의 HWPX 저장을
이어 수행한다. 실제 Electron 창·물리 키 입력 검증이라고 표현하지 않는다.

기존 HWPX 캐시67회·carry45회·물리 구역65회도 유지한다. 이전 물리 회귀의 HWP30회는
현재 렌더만 비교했으므로 단일Even metadata 손실을 놓쳤다. 그중5종·25회는 이제
`hwpRejectionExpected`와 정확한 HWPX 안내 오류를 검사한다. 나머지 안전한 HWP
재열기5회와 HWPX65회는 유지한다. 원본 fixture/실패 로그는 보존하고 변경된 계약을
명시한 overlay를 사용한다. 오류를 일반적으로 허용하거나 검사를 생략하지 않는다.

```sh
cargo build --offline --locked --manifest-path engine/Cargo.toml --example single_even_hwp_guard_check
python3 scripts/prepare-single-even-hwp-guard.py "$BINARY" "$FIXTURES"
"$BINARY" "$FIXTURES/manifest.json" "$NATIVE_OUTPUT" fixed
node scripts/check-single-even-hwp-guard.mjs "$WASM_PKG" "$FIXTURES/manifest.json" "$WASM_OUTPUT" fixed
```

출력은 새 경로여야 한다. baseline은 같은 probe를 수정 전 main 라이브러리에 링크한
바이너리/SDK로 실행한다. WASM baseline에는 마지막 인자로 원래 bridge 소스도 준다.
정확한 계수·해시·명령과 실패 기록은 `proof.json` 및 고정 증거 폴더에 있다.

## 제한

정품 한글의 single-Even 인코딩·소유 관계를 새로 검증하지 않았다. 기존 미주
getNoteEditInfo 진입·overflow/조판 문제는 별도이며 PR86의 앱 인계 승인도 대기다.
전체 Rust 단위 테스트는 기존 include 파일4개 누락으로 실행 전 컴파일이 막힌다.
고정 도구에 Clippy가 없으며 CI 부재는 통과가 아니다. 사용자 원본과 기존 증거를
보존한다. 새 PR은 독립 검토·실제 앱 QA 전 병합하지 않고 배포하지 않는다.
