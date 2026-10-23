# 경량 자동 검증 입력과 실행 범위

`rhwp-studio`의 기본 테스트 명령은 `tests/*.test.mjs`와 editor host 계약 검사를 함께 실행한다. 기존 `.ts` 검색 패턴은 실제 Studio 테스트를 찾지 못했지만 Node가 종료 코드 0을 반환할 수 있었다. 성공 판정에는 실행된 테스트 수와 실패/제외 수를 함께 확인한다.

Node 22.18.0에서 다음 집중 검사를 실행한다. Studio 검사는 개발 의존성과 생성된 `pkg` SDK가 필요하다.

```sh
npm --prefix rhwp-studio test
node --test rhwp-shared/sw/thumbnail-limits.test.js
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp-contracts --lib -- --test-threads=1
```

`thumbnail-limits.test.js`는 기존 공유 thumbnail 검사에 있던 helper·Rust parser assertion을 그대로 분리한다. Rust 원본 위치는 글결의 `engine/src/parser/mod.rs`이다. 브라우저 확장 소스가 없어도 이 두 계약은 독립 실행할 수 있다. 기존 확장 소비자·Safari assertion은 `thumbnail-decompression.test.js`에 남아 있으며, 확장 소스 누락을 성공이나 skip으로 바꾸지 않는다.

## 정책 문서 정본과 고지

`engine/mydocs/tech/agent_runtime/version_policy.md`는 기존 `rhwp-contracts` 정책 경로 검사의 compile-time 입력이다. 다음 프로젝트 기술 문서를 바이트 변경 없이 복원했다.

- 출처: [RHWP 정책 문서](https://github.com/edwardkim/rhwp/blob/f1f9c6ae58344ee9368996d3543f76b9345cf227/mydocs/tech/agent_runtime/version_policy.md)
- upstream commit: `f1f9c6ae58344ee9368996d3543f76b9345cf227`
- upstream blob: `31bfd4c3c26ea09f7312ae0c76c8ddd2829610f1`
- 크기: 8,579 bytes
- SHA-256: `af14ca6db6592a2416348300871e8f353bb161d2f5b29dbf068d3f3544b07223`
- 저작권: © 2025–2026 Edward Kim. 원본 [MIT 고지](../../LICENSE)를 보존한다.

프로젝트 기술 문서의 복원은 외부 문서·이미지·폰트 fixture의 이용 또는 재배포 허용 근거가 아니다. 이 변경에는 외부 HWP/HWPX·OCX 문서나 E2E corpus를 추가하지 않는다.

## 검증 한계

이 명령들은 전체 Rust·브라우저·앱·물리 IME 검증을 대체하지 않는다. `rhwp-contracts` 검사만 선택하므로 다른 crate와 CLI의 누락 입력, 기존 assertion/ABI 문제의 해결을 뜻하지 않는다. 전체 E2E와 확장 테스트에는 현재 소스 스냅샷 밖의 진입 파일·도움 코드·fixture가 더 필요하다. 누락 검사나 테스트 0건 종료는 통과로 집계하지 않는다.
