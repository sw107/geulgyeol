# 검토 주석 저장 구조 조사와 최소 구현 설계

기준 HEAD: `7670a158df75e07c69fcb2ba2df23b33d44b92f4` (dev9 문서 체크포인트).
제품 엔진/UI 기준: `87e1e074d039a9fc6da9bb431afaa3a383ad46b7`.
이번 결과는 **저장 구조 결함 재현과 설계**다. 주석 저작 기능을 완료한 결과가 아니다.

## 기존 구조와 비활성 경로

`model/control.rs`의 `FieldType::Memo` / `Field`에 `field_id`, `memo_index`,
`memo_paragraphs`, `memo_text_direction`, typed `parameters`, 원본 parameters XML이 있다.
HWPX 파서는 `fieldBegin type="MEMO"`의 parameters와 subList 문단을 읽고,
HWPX writer는 이를 다시 출력한다. 기존 스타일 전파/삭제 순회도 메모 문단을 다룬다.
새로운 메모 본문 모델 전체를 만들 필요가 있다는 뜻은 아니다.

`command/commands/insert.ts`의 `insert:comment`는 TODO stub이며
`canExecute: () => false`다. `index.html`에도 disabled 표시가 있고 실제 dispatcher/menu
상태도 비활성이다. 전용 주석 조회·추가·본문 수정·삭제 Native/WASM API,
주석 본문 대화상자와 편집 모드는 현재 없다. 비활성의 **관찰 가능한 코드 이유**는 stub이다.
과거 개발자가 이 메뉴를 비활성으로 둔 의도까지 확인한 것은 아니다.

기존 누름틀 대화상자의 `memo` 문자열은 ClickHere 안내 메모이며 검토 메모 본문과 다르다.
`getFieldValue`는 검토 메모가 걸린 **본문 선택 텍스트**를 반환하고 `setFieldValue`도 그
본문을 바꾼다. 이 API를 검토 내용 편집에 재사용하면 사용자가 보존하라고 한 선택 텍스트를
바꾼다. 이름 셀/누름틀/하이퍼링크 API 동작은 이번에 변경하지 않았다.

작성자·생성 시각 전용 설정은 조사한 `user-settings.ts` / `options-dialog.ts`에서
확인되지 않았다. 새 주석에 OS 계정, 문서 요약의 기존 작성자, 현재 시간을 추정해 넣지 않는다.
합성 재현 문서는 작성자·시각을 지정하지 않는다. 기존 문서의 parameters/command metadata를
새 주석 작성자 정보로 복사하지 않는다.

## HWP5 선행 결함 — 재현으로 확인

1. HWP writer는 Memo를 `%unk` 컨트롤 헤더와 `MEMO/...` command로 쓰고, 문단 끝에
   별도 `HWPTAG_MEMO_LIST` / `LIST_HEADER` / 메모 본문 문단을 쓴다.
2. HWP reader는 헤더를 `FieldType::Unknown`으로 읽고 `memo_paragraphs`를 비워 둔다.
   `parse_body_text_section`에 MEMO_LIST를 선택 범위의 필드로 연결하는 처리가 없다.
3. 편집하지 않은 HWP 저장은 section raw stream으로 꼬리를 보존할 수 있다.
   그러나 본문을 한 글자 수정하면 raw가 무효화된다. writer의 memo 수집은 Memo와
   비어 있지 않은 memo_paragraphs에만 의존하므로 미연결 꼬리가 재출력되지 않는다.
4. HWP→HWPX fallback은 command에서 메타데이터를 유도하지만 빈 subList를 만든다.
   원래 검토 내용이 돌아오는 경로가 아니다.

한글·BMP 밖 이모지/문자, 서로 인접한 한 문단의 메모 1개와 2개, 각 메모의 본문 2문단으로
이를 Native에서 재현했다. HWPX에서는 메모 2/4문단이 보존되며 선택 텍스트·글자/문단/스타일
참조도 같다. HWP 모델에는 메모 본문 0문단, 원본 raw에는 꼬리 1/2개가 남지만 본문 편집 후
꼬리 0개다. HWP→HWPX에는 메모 개수만큼 빈 문단이 생긴다. 같은 WASM 저장본 4개를
독립 Native로 읽어 동일 현상을 확인했다. 현재 저장 content-loss report의 count는 0이므로
그 보고서만으로 저장재열기 성공을 판정할 수 없다.

## 이번에 설계·재현 범위를 택한 이유

HWPX의 메모 본문 모델은 이미 있지만 HWP5 **꼬리 레코드의 소유 관계와 미해석 데이터 보존 모델**은
없다. `Section`에는 전체 raw stream과 문단만 있어, 고아/중복/불명확한 MEMO_LIST를
편집 가능한 필드와 구분해 보존·거절할 구조가 없다. 기능 활성화는 본문 편집 API/대화상자만
연결하는 최소 UI 수정으로 끝나지 않고 파서·소유 관계 표현·writer·raw 출처 계약의 변경이 필요하다.
사용자가 허용한 저장 지원 부족 시의 설계·재현 분기를 적용했다.
새 UI/API를 활성화하지 않았으며 주석 추가·수정·삭제·undo/redo 구현은 남아 있다.

## 다음 구현의 최소 범위와 완료 조건

먼저 HWP5 메모 꼬리의 원본 레코드/위치/소유 상태를 보존하는 표현을 추가한다.
MEMO command라는 접두어만으로 Unknown 필드를 일괄 Memo로 바꾸지 않는다.
헤더·end marker·memo index·꼬리 목록이 하나의 주인을 가리킬 때만 연결한다.
고아·중복 index·손상·알 수 없는 자식·복수 구역의 메모는 읽기에서 지워지지 않고,
편집 또는 다른 형식 변환을 보존할 수 없으면 변경 전 거절한다.
HWP 규격의 마지막 구역 꼬리 소유와 현재 구역별 수집 방식도 함께 결정해야 한다.
새 ID는 문서 전체의 실제/가상/미지원 필드 참조와 충돌하지 않아야 하며,
end marker의 16비트 memo index와 Number parameter의 범위를 따로 검증한다.

이 선행 저장 검증이 통과한 뒤 본문 한 문단 선택에만 네 가지 API를 연결한다.

| 동작 | 최소 계약 |
| --- | --- |
| 추가 | 같은 본문 문단의 유효 scalar 범위 `start < end`; 메모 텍스트는 별도 본문에 저장; 선택 텍스트/직접 서식 유지 |
| 조회 | 정확한 필드 주인·범위·검토 내용을 반환; 범위 끝은 half-open; 다른 필드의 선택 텍스트와 구분 |
| 내용 수정 | 검토 본문만 clone-stage 후 commit; anchor/IDs/metadata/다른 스타일·문서 참조 유지 |
| 삭제 | 자신이 소유한 fieldBegin/end와 메모 꼬리만 제거; 선택 텍스트와 주변 필드 보존 |

첫 UI는 `insert:comment` 대화상자에서 새 추가와 정확히 선택한 기존 메모의 내용 조회·수정·삭제를
처리한다. author/time 입력을 임의로 추가하지 않는다. 본문 외 셀·중첩 셀·머리말·각주,
문단을 넘는 선택, 겹치는 필드, 모호한 주인, 손상된 축, 빈/역전/소수/범위 밖 입력은
모델·이력·이벤트를 바꾸기 전에 거절한다. 대화상자 적용 때 문서 generation과 선택 주인 및
내용을 다시 검사하고, 성공한 동작만 기존 snapshot 이력으로 undo/redo한다.

완료 판정은 두 저장 형식에서 조회 가능한 실제 메모 내용/선택 범위/서식 참조가 같은지,
재열기 후에도 수정·삭제·undo/redo가 되는지다. 다중 메모·인접 경계·한글·이모지와 imported
metadata 및 비지원 참조의 무변경 거절을 확인해야 한다. 일반 snapshot 복원이 통과했다는
사실을 아직 없는 주석 command의 undo/redo 성공으로 확대하지 않는다.

Mac 실제 GUI/물리 IME는 별도 확인 항목이다. 이번 Node/Native/메뉴 DOM adapter 자동 검증은
GUI 성공이 아니다. 새 패키징·공개·보안/계정/인증서/원격 권한 변경은 하지 않았다.
