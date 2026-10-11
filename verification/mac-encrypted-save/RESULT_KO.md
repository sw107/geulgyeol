# Mac host 암호 문서 저장 후보

main `8199830da1706535aa8965865a5d832a4269eac5`에서 분리한
`dev/mac-encrypted-save-independent`의 소스 후보다. 암호 문서를 열고 Mac host 저장을
누르면 기존 동기 export가 거절하던 경로에 명시 저장용 비동기 export를 연결했다.
열기 암호를 보관하지 않으므로 매번 저장할 암호와 확인을 사용자가 직접 입력한다.
같은 암호로 유지하거나 새 암호로 변경할 수 있으며, 취소하면 저장하지 않는다.

기존 저장 암호 대화상자와 HWP/HWPX reported password serializer를 사용한다.
암호는 renderer에서 한 호출에만 사용하고 host 파일 저장에는 bytes/name/format만 넘긴다.
serializer 예외는 암호가 섞인 원문을 노출하지 않도록 일반 오류로 바꾼다. 자동 평문
fallback이나 보호 해제는 없다. 기존 동기 export의 보호 문서 거절과 보호 문서의
recovery 차단은 유지했다. 문자열 메모리의 물리적 영점 삭제를 보장하는 변경은 아니다.

암호 입력 동안 host의 새 문서·열기·저장 잠금은 유지하고 renderer의 기존 모달을
조작할 수 있게 한다. 암호 확인 뒤 serializer 전, bytes 생성 뒤 파일 요청 전에 문서
epoch/revision을 확인한다. 취소·짧은 입력·확인 불일치·내용 손실·버전 변경·쓰기 실패는
저장 완료로 처리하지 않는다. 파일 선택 뒤 추가 편집이 있으면 저장된 사본을 인정하되
현재 문서의 dirty를 유지한다. 이 경우 선택한 파일은 저장 snapshot으로 교체될 수 있다.

## 실행한 검증

| 검사 | 결과와 범위 |
|---|---|
| 새 단위 테스트 | 9개 통과: serializer 선택, 일반 저장, 암호 취소/짧은 입력/확인 불일치, 버전 변경, 예외 비노출, 내용 손실, busy, 저장 취소/실패/추가 편집 |
| 기존 host 회귀 | 11개 통과: 문서 revision, write fence, 실제 host 완료/취소·쓰기/close 오류·중복 요청·독점 임시 파일 충돌, atomic storage |
| TypeScript | 전체 프로젝트 tsc --noEmit exit0 |
| desktop studio 연결 | desktop용 Vite 설정의 write:false 메모리 빌드 통과, 258 modules/7 outputs. 기존 studio 산출물 덮어쓰기 없음 |
| Native 합성 저장 | HWP→HWP, HWP→HWPX, HWPX→HWP, HWPX→HWPX 네 조합. 각각 1쪽, 전체 본문·Native SVG·원본 모델/파일 보존, 올바른 저장 암호 재열기, 무암호/잘못된 암호/이전 암호 거절 |
| 실제 host 함수 저장 | 현재 WASM serializer, 실제 baram.js 저장 함수·main.cjs에 등록되는 저장 핸들러·atomic filesystem으로 네 암호 파일 생성. Electron/window/chooser/DOM/editor는 어댑터 |
| host 실패 분기 | 암호 취소, 파일 선택 취소, 실제 임시 파일 write+close 오류, 저장 도중 추가 편집 네 분기. 앞 세 분기는 원본 파일도 보존 |
| 독립 Native 재열기 | host 생성 파일 네 개를 현재 Native로 다시 열어 기대 Native 파일과 전체 본문/SVG 비교. 저장물의 전체 Native SVG와 WASM SVG도 정확히 일치 |

소량의 한글·영문·이모지·문자 서식이 있는 합성 fixture만 사용했다. 암호는 공개된
테스트 상수이고 CLI/로그/저장 IPC에는 암호 값을 전달하지 않았다. WASM source digest를
계산할 때의 평문 bytes는 메모리에서만 사용했다. 사용자 원본·실제 암호는 사용하지 않았다.

Native 최종 합성 실행은 `mac-encrypted-native-final-20261011`, host 독립 재열기는
`mac-encrypted-host-native-final-20261011`이다. host의 입력/기대 fixture는 앞선 실제
Native 성공 실행 `mac-encrypted-native-20261011-2`에서 왔다. 최종 runner/source pin을
대조했고 실제 Native 실행 결과를 사용했다. 앞선 runner의 raw-WASM oracle 분기는
Native 근거로 사용하지 않았다. 해시·capacity·검사 범위는 [proof.json](proof.json),
실행 출력은 이 디렉터리의 `.txt` 파일에 있다. fixture·캐시·앱은 커밋하지 않는다.

## 재실행

저장소 루트에서 Node22와 소유 Rust 환경을 사용한다. 기존 증거 디렉터리는 덮어쓰지
않으므로 아래 run-id/output은 매번 새 이름을 선택해야 한다.

```sh
node --experimental-strip-types --test scripts/tests/host-encrypted-save.test.mjs
node --test desktop/tests/document-version.test.cjs desktop/tests/document-write-fence.test.cjs desktop/tests/host-save.test.cjs desktop/tests/storage.test.cjs
(cd rhwp-studio && node node_modules/typescript/bin/tsc --noEmit)
bash scripts/qa-independent.sh --recipe encrypted-save --run-id encrypted-native-new
node --experimental-strip-types scripts/check-host-encrypted-save.mjs .geulgyeol-local/qa/encrypted-host-new .geulgyeol-local/qa/encrypted-native-new/native
bash scripts/qa-independent.sh --recipe encrypted-save --run-id encrypted-host-native-new --input .geulgyeol-local/qa/encrypted-host-new/native-manifest.json
```

## 보존·한계·다음 확인

기존 dirty4, lock3, pkg WASM pin을 모두 보존했다. PR39
`e8d227504d53e6f23060a6cd2b29a366966a1680`의 인쇄 QA는 보류 상태다. 기존 앱/이전
실패 증거를 조작하지 않았고 Electron 추가 실행·패키징·엔진/WASM 재빌드·영구 삭제·
권한/보안 설정 변경은 없었다. 이번 Native 예제만 기존 소유 target에서 컴파일했다.
추가 소유 공간은 256MiB, 진단은 16MiB 예산 내였고 전체 7GiB/진단1GiB/free floor
16,374,562,816B 감시를 통과했다. 정확한 전후 값은 proof에 있다.

초기 QA 예제의 Document serde 비교 컴파일 오류와 Node QA의 잘못된 page-count API
호출 실패는 수정하고 로컬 실패 증거를 보존했다. 제품 오류나 성공 검사로 집계하지 않았다.

**실제 Mac Electron UI, 입력/포커스/IME/Enter/Escape, 실제 IPC 전송 및 OS 저장 대화상자,
실제 undo/redo 이력, 복잡한 표·그림/대용량 암호 문서, HWP3 및 한컴/Linux는 미검증이다.**
입력창 연결·dirty 보존을 어댑터로 확인한 범위를 물리 UI 검증으로 주장하지 않는다.
따라서 draft PR 후보이며 병합·릴리스 준비 완료를 의미하지 않는다.

다음 우선 후보는 기존 앱 상태가 독립적으로 확인된 뒤 Mac 암호 저장의 실제 입력·
취소·저장 실패·undo/redo·양형식 재열기 검증이다. 앱 조작이 계속 보류되면 보호 문서
serializer의 내용 손실 거절과 복잡한 합성 표/그림 재열기 회귀를 Native에서 확장할 수 있다.
