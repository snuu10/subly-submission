# 영수증 등록: 이름 겹칠 때 "새 구독 / 기존 업데이트" 아이콘 선택

갱신: 2026-09-15

다른 CLI 세션(계정)에서 이어받아 구현하기 위해 저장한 작업 계획이다.
원본은 `~/.claude/plans/ai-spicy-raccoon.md`.

## Context

직전 커밋(`9a42201`)에서 영수증 인식이 이름 겹치는 기존 구독을 무조건 "수정"으로 단정하는 버그를 고쳤는데, 고친 방식이 **키워드 추측**이었다 — 캡션에 "바꿔/변경/수정/업데이트"가 없으면 무조건 "새 등록"으로 간주했다. 사용자가 정확히 짚은 사각지대: **기존 구독 정보가 바뀌어서(가격 인상 등) 최신 영수증을 다시 올린 경우**, 캡션 없이 사진만 보내면 이것도 "새 등록"으로 잘못 넘어간다 — 추측을 반대 방향으로 틀리게 바꾼 것뿐이다.

사용자 제안(아이콘으로 선택)이 정답이다. 실은 **텍스트 대화 경로에 이미 똑같은 상황을 위한 3버튼 선택지가 있다** — `app/chat.tsx`의 `duplicateCreate` 블록([chat.tsx:1256-1276](../app/chat.tsx#L1256-L1276)): "기존 구독 변경" / "별도로 추가" / "그대로 두기". 조사해보니 이 중 두 개는 **이미 서버 세션(`pendingActionId`) 없이도 동작하는 클라이언트 전용 경로를 갖고 있다**:

- **"기존 구독 변경"** → `handleSelectCandidate` ([chat.tsx:625](../app/chat.tsx#L625)) — `item?.pendingActionId`가 없으면 순수 로컬 `setMessages`로 처리([chat.tsx:666](../app/chat.tsx#L666) 이하). 그 결과로 뜨는 확인 카드에서 "등록"을 누르면 `handleConfirmAction` ([chat.tsx:475](../app/chat.tsx#L475))인데, 이것도 `pendingActionId` 없을 때 `updateSubscription`을 직접 호출하는 로컬 경로가 이미 있다([chat.tsx:510-536](../app/chat.tsx#L510-L536)).
- **"그대로 두기"** → `handleSkipAction` → `skipFollowupForItem` ([chat.tsx:368](../app/chat.tsx#L368)) — `pendingActionId`가 없어도 `skipAssistantFollowup(undefined, null)`을 호출하고 `not_pending`류 코드를 정상 처리로 받아들여 문제없이 카드를 닫는다.

**"별도로 추가"만** 지금 `handleSend('별도 구독')`로 서버에 텍스트를 보내 세션의 `awaiting_duplicate` 초안을 전제로 판단한다([chat.tsx:1267](../app/chat.tsx#L1267)) — 영수증 경로는 그 초안이 서버에 없으므로(claude-proxy와 assistant-turn은 세션 비공유, 지난 조사에서 확인) 이것만 로컬 버전이 필요하다. 다행히 "별도로 추가"가 하는 일은 정확히 **일반 등록 확인 카드로 전환**하는 것이라, 그 최종 상태(`item.extract` 채우기)는 이미 만들어져 있고 `ChatInlineCard`/`handleRegister`([chat.tsx:1151-1159](../app/chat.tsx#L1151-L1159), `handleRegister`는 이미 `pendingActionId` 없이 `addSubscription` 직접 호출하는 경로가 있음, 커밋 `65d353f`)가 그대로 받는다.

즉 새로 만들 코드는 "별도로 추가" 버튼 하나의 로컬 분기와, 아래 4번(계정 채팅 답장) 뿐이고, 나머지는 전부 재사용이다.

### 참고: "기존 구독 변경"이 실제로 하는 일

OCR 추출 값과 기존 저장 값을 필드별로 병합한다(`mergeExtractIntoSubscription`, [lib/extract.ts:204](../lib/extract.ts#L204)) — 영수증에 값이 있으면 그 값, 없으면 기존 값을 그대로 유지(`extract.amount ?? current.amount` 식). 화면엔 "4,900원 → 5,900원"처럼 이전·이후 비교가 뜨고([ChatActionCard.tsx:58-59](../components/ChatActionCard.tsx#L58-L59)), 사용자가 "등록"을 눌러 명시적으로 확인해야 `updateSubscription`이 실행된다 — 조용히 덮어쓰지 않는다. 이미 구현돼 있어 이번 계획에서 손댈 것이 없다.

## 설계

### 1. 키워드 추측을 선택 UI로 교체 — `app/chat.tsx`

직전 커밋에서 추가한 다음 블록을 제거한다:

```ts
if (image && manageAction === 'update' && response.extract && !/바꿔|변경|수정|업데이트/.test(text)) {
  manageAction = null;
}
```

대신, `target` 계산 직후([chat.tsx:967](../app/chat.tsx#L967) 부근) 이름이 겹치는지 판단해 겹치면 **항상** 선택 카드를 띄운다(키워드로 추측하지 않는다):

```ts
const receiptNameOverlap = Boolean(
  image &&
    response.extract &&
    ((manageAction === 'update' && target) ||
      (response.candidate_ids && response.candidate_ids.length > 0))
);
```

`receiptNameOverlap`이 참이면 기존의 `target && manageAction` / `candidate_ids` 분기([chat.tsx:972-1004](../app/chat.tsx#L972-L1004))를 타지 않고, 텍스트 경로의 `duplicateCreate` 분기와 동일한 필드를 채운다:

```ts
assistant.duplicateCreate = true;
assistant.candidates = target ? [target] : candidatesFromIds;
assistant.pendingAction = 'update';
assistant.pendingExtract = response.extract;
assistant.fromReceiptImage = true;
```

`candidatesFromIds`는 기존 `candidate_ids` 매핑 로직([chat.tsx:981-983](../app/chat.tsx#L981-L983))을 재사용 — claude-proxy 프롬프트가 이미 "같은 이름의 구독이 둘 이상이면 candidate_ids에 겹치는 구독 id를 모두 배열로 넣으세요"라고 지시해뒀으므로 서버 쪽은 손댈 것이 없다.

**같은 이름이 2개 이상일 때:** `assistant.candidates`에 2개 이상이 채워지면, 별도 코드 없이 기존 후보 카드 UI([chat.tsx:1225-1254](../app/chat.tsx#L1225-L1254))가 각 후보를 개별 카드로 렌더링한다 — 이름·금액·다음 결제일 같은 구분 정보와 함께. 이때 "기존 구독 변경" 칩 자체는 `candidates.length === 1`일 때만 보이고([chat.tsx:1259](../app/chat.tsx#L1259)), 2개 이상이면 사용자가 그 카드들 중 하나를 직접 탭한다 — 탭 자체가 "이 구독을 변경"이라는 선택이다. 탭하면 `handleSelectCandidate`([chat.tsx:625](../app/chat.tsx#L625))가 실행되고, 이미 확인했듯 `pendingActionId` 없이도 동작하는 로컬 경로가 있다([chat.tsx:666](../app/chat.tsx#L666) 이하) — 새로 만들 코드가 없다.

### 2. `ChatItem`에 마커 추가 — `app/chat.tsx`

```ts
fromReceiptImage?: boolean;
```

`isOpenActionItem`([chat.tsx:149](../app/chat.tsx#L149))은 이미 `candidates.length > 0`로 열린 카드를 잡으므로 이 필드 자체는 판정에 영향 없음 — 오직 "별도로 추가" 버튼의 분기용.

### 3. "별도로 추가" 버튼을 로컬 처리로 — `app/chat.tsx`

[chat.tsx:1266-1270](../app/chat.tsx#L1266-L1270)의 `onPress={() => void handleSend('별도 구독')}`을 다음과 같이 분기:

```tsx
onPress={() => {
  if (item.fromReceiptImage && item.pendingExtract) {
    const parsed = toParsedSubscription(item.pendingExtract, categories);
    if (!parsed) return;
    setMessages((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, duplicateCreate: false, candidatesResolved: true, extract: parsed }
          : row
      )
    );
    return;
  }
  void handleSend('별도 구독');
}}
```

`toParsedSubscription`은 이미 이 파일에서 import돼 있다(영수증 처리에 쓰임). 이후 렌더링은 [chat.tsx:1151](../app/chat.tsx#L1151) `item.extract` 블록이 그대로 맡고, "등록"을 누르면 이미 고쳐둔 `handleRegister`의 직접 저장 경로(`addSubscription` → `duplicateAccountIssue`가 계정 필수 검사)가 그대로 작동한다. "수정"을 누르면 `handleEdit`이 계정 필드가 있는 모달을 연다.

### 4. "계정 필요" 알림 후 모달 없이 채팅 답장만으로 자동 등록

사용자 요청: "별도로 추가" → 등록 시도 → 계정 필요 알림이 뜨면, `handleEdit`로 모달을 여는 대신 **채팅으로 계정/이메일을 바로 답장하면 그 값으로 합쳐서 자동 등록**되어야 한다. 모달 경로는 그대로 남겨두고(수정 버튼은 계속 동작), 채팅 답장이라는 더 빠른 경로를 추가하는 것이다.

#### `ChatItem`에 필드 추가 — `app/chat.tsx`

```ts
awaitingAccount?: boolean;
```

#### `handleRegister`의 직접 저장 분기를 사전 검사로 변경 — `app/chat.tsx`

지금은 `addSubscription`을 바로 불러서 실패하면 `notify`만 띄운다([chat.tsx:339-354](../app/chat.tsx#L339-L354) 부근, 이번 세션에서 추가한 코드). `addSubscription` 호출 전에 먼저 `duplicateAccountIssue`(`lib/duplicate-account.ts`, 이미 존재·이미 `addSubscription` 내부에서 쓰이는 함수)로 미리 확인한다:

```ts
import { duplicateAccountIssue, duplicateAccountMessage } from '@/lib/duplicate-account';

// handleRegister의 직접 저장 분기 안, addSubscription 호출 전
const issue = duplicateAccountIssue(useSubscriptionStore.getState().subscriptions, {
  name: parsed.name,
  account_id: parsed.account_id,
  preset_id: parsed.preset_id,
});
if (issue) {
  setMessages((prev) => prev.map((row) => (row.id === id ? { ...row, awaitingAccount: true } : row)));
  notify('계정 필요', `${duplicateAccountMessage(issue)} 채팅으로 바로 답장해도 등록돼요.`);
  return;
}
```

카드는 그대로 남는다(`registered`가 안 됐으므로 "등록"·"수정" 버튼도 계속 보임) — 모달 경로를 없애지 않고 **추가**하는 것.

#### `handleSend` 맨 앞에 가로채기 추가 — `app/chat.tsx`

[chat.tsx:843-847](../app/chat.tsx#L843-L847) `dismissOpenActions(text)` 호출 **이전**에 삽입 — 그 함수가 열린 카드를 서버로 스킵 처리해버리면 `awaitingAccount` 상태를 잃는다:

```ts
const pendingAccountItem = [...messages].reverse().find(
  (row) => row.role === 'assistant' && row.awaitingAccount && !row.dismissed && !row.registered
);
if (pendingAccountItem?.extract && !pendingImage) {
  setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
  setDraft('');
  if (looksLikeAccountCancel(text)) {
    setMessages((prev) =>
      prev.map((row) => (row.id === pendingAccountItem.id ? { ...row, awaitingAccount: false } : row))
    );
    return;
  }
  if (looksLikeAccountDodge(text)) {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'assistant', text: '계정을 알아야 어떤 구독인지 구분할 수 있어요. 이메일이나 아이디를 입력해 주세요.' },
    ]);
    return;
  }
  const merged = { ...pendingAccountItem.extract, account_id: text.trim() };
  const issue = duplicateAccountIssue(subscriptions, {
    name: merged.name,
    account_id: merged.account_id,
    preset_id: merged.preset_id,
  });
  if (issue) {
    setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: duplicateAccountMessage(issue) }]);
    return;
  }
  try {
    const created = await addSubscription({
      name: merged.name,
      amount: merged.amount,
      billing_cycle: merged.billing_cycle,
      category_id: merged.category_id,
      anchor_date: merged.anchor_date,
      next_payment_date: merged.next_payment_date ?? computeNextPaymentDate(merged.anchor_date, merged.billing_cycle),
      preset_id: merged.preset_id,
      is_active: true,
      account_id: merged.account_id,
    });
    if (!created) {
      notify('등록 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
      return;
    }
    setMessages((prev) =>
      prev.map((row) =>
        row.id === pendingAccountItem.id
          ? { ...row, registered: true, subscriptionId: created.id, awaitingAccount: false, extract: merged }
          : row
      )
    );
  } catch (error) {
    notify('등록 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
  }
  return;
}
```

`issue`가 "taken"(다른 형제 구독이 이미 그 계정 씀)이면 등록하지 않고 다시 답장을 기다린다 — 무한 루프처럼 보이지 않도록 이유를 담은 메시지를 매번 보여준다(`duplicateAccountMessage`가 이미 'taken' 전용 문구를 갖고 있음).

#### 취소·회피 판별 헬퍼 — `app/chat.tsx` 모듈 레벨

서버(`gemini-intent.ts`)의 `isNonAnswerAccountUtterance`/`isRejectUtterance`와 같은 패턴을 이 파일 전용으로 작게 둔다(런타임이 달라 직접 import 불가 — 이 앱은 이미 `constants/spend-metrics.ts` ↔ `web/src/lib/spend-metrics.ts`처럼 앱·웹 간 상수/판별 로직을 의도적으로 복제하는 관례가 있다):

```ts
function looksLikeAccountDodge(text: string): boolean {
  const compact = text.replace(/\s+/g, '').replace(/[.!?]+$/g, '');
  return /^(없어|없어요|없음|없다|몰라|몰라요|모름|생략|생략할게|건너뛰기|건너뛸게|건너뛰어|패스|스킵|그냥등록|그냥등록해|그냥해줘|나중에|안적을래|안쓸래)$/.test(
    compact
  );
}

function looksLikeAccountCancel(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /^(취소|취소할게|취소해줘|아니|아니요|그만할게|안할래|안할게|됐어)$/.test(compact);
}
```

## 검증

- 앱 타입 체크: `npx tsc --noEmit`
- 서버 변경 없음 — 이번 변경은 전부 `app/chat.tsx` 클라이언트 로직이라 Edge Function 재배포 불필요.
- 웹(`AssistantPanel.tsx`)은 영수증 첨부 기능이 없어 해당 없음(이전 조사에서 확인).

수동 확인(APK 빌드 후):
- 기존 넷플릭스 구독이 있는 상태에서 캡션 없이 두 번째 넷플릭스 영수증 첨부 → "기존 구독 변경 / 별도로 추가 / 그대로 두기" 3버튼이 뜨는지 확인.
  - "기존 구독 변경" → 영수증 값으로 기존 구독이 업데이트되는지(계정 요구 없이 바로 되는지, 업데이트는 중복이 아니므로).
  - "별도로 추가" → 등록 확인 카드가 뜨고, "등록" 누르면 계정 필요 알림이 뜨는지(기존 안전장치).
    - 알림 후 **채팅으로 바로 "chan@gmail.com" 같은 답장** → 자동으로 합쳐져 등록되는지, 카드가 `registered`로 바뀌는지.
    - 알림 후 "없어"로 답장 → 다시 계정을 요구하는지(등록되면 안 됨).
    - 알림 후 "취소"로 답장 → `awaitingAccount`가 풀리고 조용히 넘어가는지(카드는 남아 있어도 됨, 다시 답장을 가로채지 않아야 함).
    - 여전히 "수정"으로 모달을 열어 계정 입력 후 저장하는 기존 경로도 함께 되는지(신규 경로가 기존 경로를 안 깨야 함).
    - 이미 같은 계정을 쓰는 형제 구독이 있을 때 그 계정으로 답장 → "taken" 문구가 뜨고 재답장을 기다리는지.
  - "그대로 두기" → 카드가 닫히고 아무 것도 안 바뀌는지.
- 겹치는 이름이 2개 이상인 경우(같은 서비스 이미 2개 등록된 상태에서 세 번째 영수증) → 후보 카드 여러 개가 뜨고 각각 탭해서 그 구독으로 업데이트되는지.
- 이름이 전혀 안 겹치는 완전히 새 서비스 영수증 → 선택 카드 없이 바로 평소처럼 등록 확인 카드가 뜨는지(회귀 없음).
- `awaitingAccount` 대기 중이 아닐 때는 평소처럼 텍스트가 `assistant-turn`으로 정상 라우팅되는지(가로채기가 무관한 대화까지 먹지 않는지).
