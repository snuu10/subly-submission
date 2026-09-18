# 영수증 등록 중복 처리: 구현 완료 보고

작성: 2026-09-15
계획 원본: [docs/receipt-duplicate-registration-plan.md](./receipt-duplicate-registration-plan.md)

## 변경 요약

`app/chat.tsx` 한 파일만 수정. 서버(Edge Function) 변경 없음 — 배포 불필요.

### 1. 키워드 추측 제거 → 선택 카드로 통일

이름이 겹치는 영수증을 캡션 키워드(`바꿔|변경|수정|업데이트`)로 "새 등록/수정"을 추측하던 블록을 제거하고, `target` 계산 직후 `receiptNameOverlap` 판정을 추가했다. 이름이 겹치면(기존 구독 1개 매치, 또는 `candidate_ids` 2개 이상) 항상 텍스트 대화와 같은 `duplicateCreate` 3버튼 선택 카드("기존 구독 변경" / "별도로 추가" / "그대로 두기")를 띄운다. 겹치지 않으면 기존과 동일하게 바로 등록 확인 카드가 뜬다(회귀 없음).

- `candidatesFromIds` 매핑을 공용으로 추출해 기존 `candidate_ids` 분기와 공유.
- `assistant.fromReceiptImage = true`로 표시해 "별도로 추가" 버튼의 로컬 처리 분기를 구분.

### 2. `ChatItem`에 필드 추가

- `fromReceiptImage?: boolean` — 영수증에서 만들어진 duplicateCreate 카드인지.
- `awaitingAccount?: boolean` — 계정 필요 알림 후 채팅 답장을 기다리는 중인지.

### 3. "별도로 추가" 버튼을 로컬 처리로

영수증 경로에서는 서버에 `awaiting_duplicate` 세션이 없으므로(`assistant-turn`과 `claude-proxy`는 세션 비공유), `handleSend('별도 구독')`로 서버에 묻는 대신 `toParsedSubscription`으로 즉시 일반 등록 확인 카드(`item.extract`)로 전환한다. 이후 렌더링·등록·수정은 기존 `ChatInlineCard`/`handleRegister`/`handleEdit` 경로를 그대로 재사용.

### 4. "계정 필요" 알림 후 채팅 답장만으로 자동 등록

- `handleRegister`의 직접 저장 분기(서버 pending action 없는 영수증 경로)에서 `addSubscription` 호출 전에 `duplicateAccountIssue`로 미리 검사하도록 변경. 문제가 있으면 `awaitingAccount: true`로 표시하고 "채팅으로 바로 답장해도 등록돼요" 안내를 덧붙인 알림을 띄운다. 카드는 그대로 남아 "등록"/"수정" 버튼이 계속 보인다.
- `handleSend` 맨 앞, `dismissOpenActions` 호출 이전에 가로채기를 추가: `awaitingAccount`이고 `dismissed`/`registered`가 아닌 가장 최근 카드가 있으면
  - "취소" 계열 답장 → `awaitingAccount`만 해제(등록하지 않음, 카드는 남음)
  - "없어"/"몰라" 계열 회피 답장 → 계정을 다시 요청하는 안내만 추가(등록하지 않음)
  - 그 외 답장 → `account_id`로 병합해 `duplicateAccountIssue` 재검사 후 문제없으면 `addSubscription`으로 자동 등록, 카드가 `registered: true`로 바뀜
  - 형제 구독이 이미 같은 계정을 쓰면("taken") 등록하지 않고 이유를 안내한 뒤 다시 답장을 기다림
- 모듈 레벨에 `looksLikeAccountDodge`/`looksLikeAccountCancel` 헬퍼를 추가(서버 `gemini-intent.ts`의 판별 로직을 런타임이 달라 이 파일 전용으로 복제 — 기존 앱/웹 상수 복제 관례와 동일한 패턴).

## 검증

### 1) 타입 체크

```
npx tsc --noEmit
```

오류 없이 통과.

### 2) 계획서 "검증" 섹션 시나리오 코드 재점검 (정적 트레이스, 별도 서브에이전트로 교차 검증)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 캡션 없는 두 번째 넷플릭스 영수증 → 3버튼 선택 카드 | PASS |
| 2a | "기존 구독 변경" → 값 병합, 계정 요구 없이 바로 업데이트 | PASS |
| 2b | "별도로 추가" → 등록 확인 카드 → "등록" → 계정 필요 알림 | PASS |
| 2b-i | 알림 후 "chan@gmail.com" 답장 → 자동 등록, 카드 `registered` | PASS |
| 2b-ii | 알림 후 "없어" 답장 → 다시 계정 요구, 등록 안 됨 | PASS |
| 2b-iii | 알림 후 "취소" 답장 → `awaitingAccount` 해제, 카드는 남음, 재가로채기 없음 | PASS |
| 2b-iv | "수정" 모달 경로도 함께 정상 동작 | PASS (사소한 참고: 모달로 저장해도 `awaitingAccount` 플래그 자체는 명시적으로 안 지워지지만, `registered: true`가 되면서 인터셉터의 `!row.registered` 조건에 걸러져 실질적 충돌 없음) |
| 2b-v | 형제 구독이 이미 쓰는 계정으로 답장 → "taken" 문구, 재답장 대기 | PASS |
| 3 | "그대로 두기" → 카드 닫힘, 아무 것도 안 바뀜 | PASS |
| 4 | 동명 2개 이상 → 후보 카드 여러 개, 각각 탭해서 업데이트 | PASS (이 케이스는 `manageAction`이 영수증 경로에서 항상 `null`이라 기존 `candidate_ids` 분기가 원래 도달 불가능했던 지점 — 새 `receiptNameOverlap` 분기가 실제로 이 기능을 동작하게 만든 부분) |
| 5 | 완전히 새 서비스 영수증 → 선택 카드 없이 평소처럼 등록 확인 카드 | PASS (회귀 없음) |
| 6 | `awaitingAccount` 대기 중이 아닐 때 평소 텍스트는 `assistant-turn`으로 정상 라우팅 | PASS |

발견된 버그 없음. 계획서에 없던 참고 사항 하나: 영수증 두 장을 연달아 올려 `awaitingAccount` 카드가 2개 동시에 열리면, 인터셉터가 가장 최근 카드만 찾아 답장을 받으므로 더 오래된 카드는 직접 닫거나 등록하기 전까지는 답장을 가로채지 못한다(엣지 케이스, 발생 빈도 낮음).

### 3) 수동 확인 (미실시)

계획서의 "수동 확인(APK 빌드 후)" 항목은 실제 기기/시뮬레이터 실행이 필요해 이번 작업에서는 진행하지 않았다. 위 표는 코드를 정적으로 추적한 결과이며, 실기기 확인은 별도로 필요하다.

## 후속 조치 (이어받아 진행)

보고서의 "영수증 두 장 동시" 엣지 케이스를 근본 회피하는 제약을 추가했다 — 근본 수정(여러 카드를 동시에 추적)은 다음 목록으로 미루고, 지금은 **영수증을 한 장씩만 처리**하도록 막았다.

### 추가 변경 — `app/chat.tsx`

`handleSend` 맨 앞, 기존 `pendingAccountItem` 가로채기보다 먼저: `pendingImage`가 있을 때 `fromReceiptImage`이면서 아직 안 끝난(`dismissed`/`registered`/`confirmed` 전부 아닌) 카드가 있으면 전송을 막고 안내한다.

```ts
if (pendingImage) {
  const openReceiptItem = messages.find(
    (row) => row.fromReceiptImage && !row.dismissed && !row.registered && !row.confirmed
  );
  if (openReceiptItem) {
    notify('영수증은 한 장씩', '이전 영수증 처리를 먼저 끝내거나 "그대로 두기"로 닫은 뒤 다시 보내 주세요.');
    return;
  }
}
```

`npx tsc --noEmit` 재확인, 통과.

## 향후 개선 목록 (지금은 안 함)

- **여러 영수증 동시 처리**: 지금은 한 장씩만 허용한다. 여러 장을 동시에 열어두고 각각 독립적으로 답장받게 하려면 `awaitingAccount` 인터셉터를 "가장 최근 카드"가 아니라 사용자가 답장할 카드를 명시적으로 고르는 방식(예: 어떤 영수증인지 되묻기)으로 바꿔야 한다.
- **실기기/에뮬레이터 수동 확인**: 계획서의 "수동 확인(APK 빌드 후)" 항목 전체가 아직 미실시. 정적 트레이스만 됐다.
- **웹(`AssistantPanel.tsx`)에는 영수증 첨부 기능 자체가 없음**: 필요해지면 이번 로직(특히 `duplicateAccountIssue` 기반 계정 가로채기)을 웹에도 이식해야 한다.
- **영수증 OCR이 계정/이메일 자체를 추출하는 경우는 고려 안 함**: 지금은 항상 채팅 답장으로 계정을 받는다. 영수증에 이메일이 찍혀 있어도 자동으로는 안 채워진다(요구사항에 없었음, 의도적으로 범위 밖).

## 배포

서버(Supabase Edge Function) 변경 없음 — 이번 작업은 전부 `app/chat.tsx` 클라이언트 로직이라 재배포 불필요.
