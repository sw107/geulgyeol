# Studio 파일 저장 실패 피드백 수정

- 기준: `8bc11e8e3a5cda313b30b9146086537401c66e82` (PR #99 병합). 2026-10-23 원격 main도 동일함을 확인했다.
- 범위: `rhwp-studio/src/command/commands/file.ts`의 File System Access 저장 오류 처리. 엔진 문자 인덱스, undo, 파서/직렬화, SDK는 수정하지 않았다.
- 기존 Electron 호스트에는 저장 중복 방지 및 실패/취소 시 dirty 유지가 이미 구현되어 있었다. 이번 수정은 해당 기능을 다시 구현하지 않는다. 데스크톱의 호스트 위임 저장 경로 자체를 변경하는 수정은 아니다.

## 재현과 수정

Studio의 `tryFileSystemSave`는 picker/createWritable/write/close에서 발생한 일반 예외를 모두 `fallback` 결과로 바꾸었다. 일반 저장은 다운로드를 요청한 뒤 `markClean('save')`와 `saved`를 반환했고, 다른 이름으로 저장도 두 번째 이름 입력 후 다운로드 요청만으로 clean 처리했다. `confirmSaveBeforeReplacingDocument` 역시 그 `saved`를 근거로 문서 교체를 허용했다. 선택한 파일의 저장 실패가 사용자에게 전달되지 않는 결함이다.

일반 예외를 다시 던져 기존 `reportSaveError`와 실패 반환 경로로 전달한다. 실패한 저장에서는 다운로드를 요청하거나 문서 파일명·핸들·보호 상태를 변경하지 않으며, dirty 상태를 유지한다. AbortError/NotAllowedError 취소 처리는 그대로 둔다. File System Access를 지원하지 않는 환경이 반환하는 기존 다운로드 폴백도 유지한다.

## 검사 결과

Node.js v22.18.0에서 별도 의존성 설치 없이 실행했다.

```sh
node --test desktop/tests/studio-save-failure.test.cjs
node --test desktop/tests/studio-save-failure.test.cjs desktop/tests/host-save.test.cjs desktop/tests/storage.test.cjs desktop/tests/close.test.cjs
git diff --check
```

- 수정 전 새 회귀 테스트: 18개 중 14개 실패, 4개 통과. 일반 저장은 실제 `saved !== failed`, 다른 이름으로 저장은 실제 dirty 해제, 문서 교체 확인은 실제 true 반환을 재현했다.
- 수정 후 집중 검사: 30개 통과, 실패·건너뛰기 0개.
- HWP/HWPX 일반 저장 및 다른 이름으로 저장 각각의 create/write/close 실패, 오류 표시, 상태 보존, 재시도 성공을 검증했다.
- 저장 후 문서 교체 차단, picker 일반 오류, AbortError/NotAllowedError 취소, 새 문서 취소, API 미지원 환경의 기존 폴백을 검증했다.
- 기존 호스트 저장, 실제 임시 파일 I/O 오류 및 종료 컨트롤러 검사도 통과했다.
- `git diff --check` 통과.

새 회귀 테스트는 전체 실제 command 모듈을 Node TypeScript 변환으로 읽고 실제 file-system-access/save-target/save-format/save-document-format/export-content-loss 헬퍼를 사용한다. UI, 브라우저 파일 핸들, exporter는 합성 어댑터다. 실제 브라우저 저장 대화상자·디스크 오류 재현이나 문서 포맷 적합성 검사로 주장하지 않는다.

## 남은 검증과 제한

- 실제 Mac 앱/브라우저 대화상자, 전체 TypeScript 빌드, 전체 WASM 회귀, 실제 한컴 재열기는 실행하지 않았다. 다른 트랙과 충돌하는 앱 실행·무거운 빌드는 요청하지 않았다.
- API 미지원 환경에서 다운로드 요청을 완료로 처리하는 기존 Studio 동작은 이번 오류 전달 수정 범위 밖이다. 다운로드 완료 인증 개선은 별도 검토가 필요하다.
- PR #96 외부 문서 권리 보류를 유지한다. 사용자 문서, SDK, 다른 작업자의 미커밋 파일, 기존 증거를 변경/삭제하지 않았다.
- 전용 worktree는 약 66 MiB이며 의존성·대형 빌드 산출물을 복제하지 않았다. 병합·배포·릴리스는 수행하지 않는다.
