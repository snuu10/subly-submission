# 무료 체험 구독 구현 상세 검토

> 검토 기준 커밋: `6482a83`
>
> **후속 결정:** 이 검토 당시에는 “D-day만 알림”을 기준으로 분석했으나, 이후 무료 체험 종료 알림을 **D-3·D-1·D0 총 3회** 제공하기로 확정했다. 따라서 아래 1번의 최종 수정 방향은 일반 `payment_due` 알림을 제거하는 것이 아니라, D-3·D-1·D0 모두를 체험 전용 `trial_ending` 알림으로 생성하고 같은 날짜의 일반 결제 알림만 중복 생성하지 않는 방식으로 해석한다.

현재 `origin/main` 최신 커밋은 `6482a83`이고, 이전에 지적했던 항목 중 AI 다중 대화의 무료 체험 상태 유실은 `b44f2e8`에서 수정됐다. 나머지 핵심 문제는 아직 코드에 남아 있다.

## 1. 체험 구독 알림이 일반 결제 알림으로 생성되는 문제

사용자가 다음과 같이 등록했다고 가정한다.

```text
서비스: 밀리의서재
무료 체험 종료일: 2026-09-20
첫 유료 결제일: 2026-09-20
월 결제금액: 9,900원
```

현재 데이터는 대략 다음처럼 저장된다.

```text
is_trial = true
trial_ends_at = 2026-09-20
anchor_date = 2026-09-20
```

알림 함수는 먼저 체험 종료일이 오늘인지 확인한다.

```ts
if (sub.is_trial === true && trialEndsAt === todayIso) {
  // D0 무료 체험 종료 알림 생성
}
```

그런데 이 처리 후 일반 결제 알림 계산도 계속 실행한다.

```ts
const paymentYmd = nextPaymentDateYmd(anchor, cycle, today);
const daysUntil = diffDaysYmd(paymentYmd, today);

if (!REMINDER_OFFSETS.includes(daysUntil)) continue;
```

관련 코드: [generate-payment-notifications](/Users/chan/Developer/seongnam-ai-camp/projects/subly/supabase/functions/generate-payment-notifications/index.ts:229)

`REMINDER_OFFSETS`는 `[3, 1]`이므로 기존 구현의 실제 동작은 다음과 같다.

| 날짜 | 계산 결과 | 생성되는 알림 |
|---|---:|---|
| 9월 17일 | D-3 | 일반 결제 예정 알림 |
| 9월 19일 | D-1 | 일반 결제 예정 알림 |
| 9월 20일 | D0 | 무료 체험 종료 알림 |

후속 결정에 따른 올바른 동작은 다음과 같다.

| 날짜 | 생성할 알림 종류 | 예시 문구 |
|---|---|---|
| D-3 | `trial_ending` | 무료 체험이 3일 뒤 끝나요 |
| D-1 | `trial_ending` | 무료 체험이 내일 끝나요 |
| D0 | `trial_ending` | 무료 체험이 오늘 끝나요 |
| 체험 종료 후 | `payment_due` | 기존 일반 결제 예정 알림 |

핵심은 체험 기간에 일반 `payment_due`를 생성하지 않고, 체험 전용 알림을 생성한 다음 같은 날짜의 일반 알림 생성을 건너뛰는 것이다.

```ts
const isActiveTrial =
  sub.is_trial === true &&
  trialEndsAt !== null &&
  trialEndsAt >= todayIso;

if (isActiveTrial) {
  const trialDaysUntil = diffDaysYmd(parseYmd(trialEndsAt), today);

  if ([3, 1, 0].includes(trialDaysUntil)) {
    // trial_ending 알림 생성
  }

  continue; // 같은 날짜의 일반 payment_due 알림만 중복 생성하지 않음
}
```

이 문제는 Edge Function이 배포된 상태이므로 우선 수정해야 한다.

## 2. D-day AI 홈 카드가 사용 여부 질문에 가려지는 문제

`resolveBriefing()`은 D-day 체험을 가장 먼저 찾아 정상적으로 `trial_ending`을 반환한다.

```ts
if (trialEndingToday.length > 0) {
  return {
    kind: 'trial_ending',
    title: '무료 체험이 오늘 끝나요',
  };
}
```

하지만 실제 홈 컴포넌트는 `usageEvent`가 있으면 `fallback`을 무시한다.

```ts
const title = usageEvent
  ? `${usageEvent.payload.name}, 최근 30일 동안 쓰셨나요?`
  : fallback.title;
```

관련 코드: [AiBriefingCard.tsx](/Users/chan/Developer/seongnam-ai-camp/projects/subly/components/AiBriefingCard.tsx:191)

예를 들면 다음 두 데이터가 동시에 존재할 수 있다.

```text
fallback:
  밀리의서재 무료 체험이 오늘 끝나요

usageEvent:
  넷플릭스, 최근 30일 동안 쓰셨나요?
```

이 경우 화면에는 넷플릭스 질문만 나오고 밀리의서재 체험 종료는 표시되지 않는다. 무료 체험 종료는 특정 날짜에만 유효하고 다음 날 사라지므로 일반 사용 여부 질문보다 우선하는 것이 적절하다.

권장 우선순위:

1. 실제 구독 종료 확인이 필요한 lifecycle 카드
2. 오늘 종료되는 무료 체험 카드
3. 사용 여부 질문
4. 이번 주 결제 브리핑
5. 일반 안내

최소 수정 예시:

```ts
const trialEndingToday = fallback.kind === 'trial_ending';
const showUsageEvent = Boolean(usageEvent && !trialEndingToday);

const title = showUsageEvent
  ? `${usageEvent!.payload.name}, 최근 30일 동안 쓰셨나요?`
  : fallback.title;
```

버튼 렌더링도 동일한 `showUsageEvent`를 사용해야 한다. 제목만 체험 종료로 바꾸고 버튼은 `최근 사용했어요`로 남으면 안 된다.

## 3. AI 다중 대화에서 무료 체험 상태가 유실되던 문제

이 문제는 현재 수정됐다.

과거에는 사용자가 다음처럼 여러 문장으로 등록하면 문제가 발생했다.

```text
사용자: 넷플릭스 무료 체험 등록해줘
AI: 금액은 얼마인가요?
사용자: 월 17,000원
AI: 첫 결제일은 언제인가요?
사용자: 9월 30일
```

마지막 발화인 `9월 30일`에는 “무료 체험”이라는 단어가 없으므로 `classified.is_trial`이 다시 `false` 또는 `null`이 됐고, 최종 구독이 일반 구독으로 저장될 수 있었다.

현재는 `CreateDraft`에 아래 값이 보존된다.

```ts
is_trial: boolean;
trial_ends_at: string | null;
```

새 발화에 체험이라는 단어가 없어도 이전 초안 값을 사용한다.

```ts
const draftIsTrial =
  classified.is_trial === true ||
  (prior?.is_trial ?? false);
```

관련 코드: [assistant-turn](/Users/chan/Developer/seongnam-ai-camp/projects/subly/supabase/functions/assistant-turn/index.ts:2033)

따라서 이 항목은 해결된 것으로 판단된다.

다만 AI 등록에는 아직 별도의 문제가 있다.

- 무료 체험은 계정과 결제수단을 필수로 요구한다.
- AI가 단일 서비스 등록 시 계정을 항상 먼저 질문하지 않는다.
- AI 채팅 안에 결제수단 선택 UI가 없다.
- RPC는 결제수단이 없어도 체험 구독을 저장한다.
- 앱·웹 수동 폼과 AI 등록의 검증 규칙이 서로 다르다.

현재 가능한 결과:

```text
앱 수동 등록:
  계정 없음 → 차단
  결제수단 없음 → 차단

AI 등록:
  계정 없음 → 확인 시 RPC 실패 가능
  결제수단 없음 → 그대로 저장 가능
```

제품 정책을 유지하려면 AI가 확인 카드를 만들기 전에 다음 순서로 진행해야 한다.

```text
필수 정보 수집
→ 계정 질문
→ 결제수단 선택
→ 최종 확인
→ 저장
```

AI 결제수단 선택 UI를 당장 구현하기 어렵다면 체험 구독을 감지했을 때 등록 모달로 넘기는 것도 현실적인 1차 해결책이다.

## 4. 결제수단 추가 화면이 등록 모달 뒤에서 열리는 문제

현재 구조:

```text
SubscriptionModal
└─ 결제수단 바텀시트
   └─ 계좌/카드 추가
      └─ router.push('/payment-methods')
```

문제는 `router.push()`를 실행할 때 바텀시트만 닫고 바깥 `SubscriptionModal`은 닫지 않는다는 점이다.

```ts
setPaymentSheetOpen(false);
router.push('/payment-methods');
```

관련 코드: [SubscriptionModal.tsx](/Users/chan/Developer/seongnam-ai-camp/projects/subly/components/SubscriptionModal.tsx:652)

`SubscriptionModal`은 일반 화면이 아니라 루트에 떠 있는 네이티브 `Modal`이다. 라우터는 결제수단 화면으로 이동했지만 모달이 그 위를 계속 덮을 수 있다.

사용자 입장에서는 다음 문제가 생길 수 있다.

1. 구독 정보를 거의 다 입력한다.
2. 결제수단 추가를 선택한다.
3. 화면이 이동한 것 같지만 구독 모달이 그대로 보인다.
4. 모달을 닫으면 작성 내용이 초기화될 수 있다.
5. 결제수단을 등록하고 돌아와도 기존 초안이 사라진다.

가장 안정적인 해결은 구독 폼 초안을 Context나 별도 store에 보관하는 것이다.

```text
결제수단 추가 선택
→ 현재 폼을 draft에 저장
→ SubscriptionModal 닫기
→ /payment-methods 이동
→ 결제수단 등록
→ 돌아오기
→ SubscriptionModal 재오픈
→ draft 복원
→ 새 결제수단 자동 선택
```

더 단순한 대안은 결제수단 생성 폼 자체를 현재 바텀시트 내부에 넣는 것이다. 그러면 라우팅과 초안 복원 문제가 없어진다.

## 5. 무료 체험 자동 테스트가 없다는 의미

현재 테스트가 통과한다는 것은 기존 기능이 깨지지 않았다는 뜻에 가깝다.

확인된 결과:

- 앱 TypeScript 검사 통과
- 웹 빌드 통과
- Assistant 테스트 83개 통과
- 알림 회귀 테스트 18개 통과

하지만 새로 추가된 테스트는 대부분 기존 테스트용 기본 객체에 아래 필드를 넣은 수준이다.

```ts
is_trial: null,
trial_ends_at: null,
```

즉 다음과 같은 실제 체험 동작은 검증하지 않는다.

### 알림 테스트

- 체험 종료 D-3 → `trial_ending` 한 건
- 체험 종료 D-1 → `trial_ending` 한 건
- 체험 종료 D0 → `trial_ending` 한 건
- 같은 날짜의 일반 `payment_due` 중복 없음
- 같은 날 함수 재실행 → 중복 없음
- 체험 종료 다음 결제 주기 → 일반 결제 알림만 생성
- 일시정지·종료 구독 → 체험 알림 없음

### AI 테스트

- `무료 체험 등록` → 금액 답변 → 날짜 답변 → `is_trial=true` 유지
- `첫 달 무료` 표현 감지
- 체험 + 일회성 결제 거절
- 체험 금액이 0원이 아니라 전환 후 결제금액으로 저장

### 홈 카드 테스트

- 체험 0개 → 카드 없음
- 체험 1개 → 단일 카드
- 체험 2개 → 2개 표시
- 체험 3개 → 3개 모두 표시
- 체험 4개 → 2개 + `외 2개`
- `usageEvent`와 D0 체험이 동시에 있음 → 체험 카드 우선
- 다음 날 → 체험 카드 제거

### 등록 화면 테스트

- 체험 토글 OFF → 계정·결제수단 선택
- 체험 토글 ON → 결제 주기 기본값 월간
- 체험 토글 ON → 월간·연간만 선택 가능
- 체험 토글 ON → 계정·결제수단 필수
- 일회성 상태에서 체험 토글 ON → 월간으로 변경
- 체험 상태에서 일회성 선택 불가
- 결제수단 추가 후 복귀 → 작성 중 데이터 유지
- 수정 화면에서 토글 OFF → `trial_ends_at=null`

자동 테스트가 없으면 화면에서 한 번 정상 동작한 것처럼 보여도 날짜가 바뀌거나 여러 이벤트가 겹칠 때 문제가 다시 나타날 수 있다.

## 6. Development build가 해결하는 것과 해결하지 않는 것

`npx expo run:android`는 다음을 검증하는 데 필요하다.

- `expo-notifications` 네이티브 모듈 로딩
- 알림 권한 요청
- Android notification channel 생성
- Expo Push Token 발급
- 실제 푸시 수신
- 알림 선택 후 앱 라우팅

하지만 Development build를 만든다고 아래 문제가 자동으로 해결되지는 않는다.

- 체험 알림이 일반 결제 알림으로 생성되는 서버 로직
- 홈 카드 우선순위
- AI 등록의 필수 정보 수집
- 모달 초안 보존
- DB 검증 불일치

즉 Development build는 수정 방법이 아니라 실제 기기 검증 환경이다.

Expo Go에서는 SDK 53부터 Android 원격 푸시를 지원하지 않으므로 원격 푸시 최종 검증에는 Development build가 필요하다. 다만 앱이 Expo Go에서 뜨지 않는 원인을 모두 `expo-notifications` import 때문이라고 단정해서는 안 된다.

## 권장 처리 순서

1. `generate-payment-notifications`에서 D-3·D-1·D0 체험 전용 알림을 생성하고 일반 결제 알림 중복을 차단한다.
2. Edge Function을 재배포한다.
3. AI 홈 카드가 `usageEvent`보다 우선하도록 수정한다.
4. 결제수단 추가 화면 이동 시 폼 초안을 보존한다.
5. AI 등록의 계정·결제수단 수집 정책을 정리한다.
6. 무료 체험 전용 테스트를 추가한다.
7. Development build를 생성한다.
8. 실제 기기에서 D-3·D-1·D0 푸시와 D0 홈 카드를 검증한다.

가장 긴급한 것은 1번이다. 서버 함수가 운영에 배포돼 있으므로 무료 체험 알림이 체험 전용 문구가 아닌 일반 결제 알림으로 생성되거나 같은 날짜에 중복될 수 있다.
