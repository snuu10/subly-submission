# 체험(무료 체험) 구독 표시 기능 — 계획 문서

갱신: 2026-09-15
상태: **보류** — 사용자 요청으로 설계까지만 하고 구현 전 중단. 열린 질문 4개 모두 확정 완료(아래
"열린 질문" 절 참고) — 구현 시작만 남음.

## Context

사용자가 "이번 달 얼마 나가?" 버그를 리포트하면서, 무료 체험 후 자동 결제로 전환되는 구독이
"생각보다 많이 발생되고 쓸데없는 지출로 이어진다"며 이를 막을 기능 아이디어를 요청했다.
참고 이미지 두 장(다른 앱 화면 추정)을 첨부:

1. 구독 상세 화면 — 이름 아래 "체험종료 임박" 배지, 금액에 취소선.
2. 구독 목록 행 — 이름 아래 파란 글씨로 "체험 종료 임박", 금액에 취소선 + "곧 유료" 보조 텍스트.

논의 중 정한 핵심 설계 원칙: **체험을 `billing_cycle`의 네 번째 값으로 넣지 않는다.** `billing_cycle`은
지출 계산 전체(월평균 환산, 이번 달 예상액, 카테고리 합계)에 쓰이는 필드라, 체험이 끝나면 결국 실제
주기(월간/연간)로 돌아가야 하는데 그 정보가 사라진다. 대신 **기존 실제 주기는 그대로 두고, 그 위에
`is_trial` 플래그를 얹는다** — 내부적으로는 이미 월간/연간 구독이고, 화면 표시만 다르게 한다.

## 조사 결과 요약

### 1. DB 스키마 (`public.subscriptions`)

베이스 테이블 자체는 마이그레이션 이력에 없음(레포 추적 이전에 생성됨) — 이후 `alter table`들과
`types/subscription.ts:33-58`로 전체 컬럼 재구성 확인. 현재 컬럼: `id, user_id, name, amount,
billing_cycle, category_id, anchor_date, next_payment_date, created_at, last_checked_at, preset_id,
is_active, memo, emoji, account_id, billing_channel, lifecycle_status, service_end_date,
guide_reviewed_at, cancel_requested_at, ended_at, last_rebill_check_at, payment_instrument_id`.
체험 관련 컬럼 없음.

`anchor_date`는 "결제 주기의 유일한 진실"(코드 주석), `next_payment_date`는 그로부터 계산된 파생
캐시. 체험 구독의 "첫 실제 결제일"은 개념적으로 `anchor_date`와 같은 값이 될 수 있다 — 체험이 끝나고
처음 돈이 나가는 날이 곧 `anchor_date`이기 때문. 다만 배지를 "지금도 정확히" 판단하려면 별도
불변 기준점이 필요하다(아래 열린 질문 2).

### 2. AI 추출 흐름

- `ClaudeExtract`(`types/extract.ts:19-28`): `name, amount, billing_cycle, anchor_date,
  next_payment_date, category_key, category_name, account_id`. 체험 필드 없음.
- `claude-proxy` SYSTEM_PROMPT(`supabase/functions/claude-proxy/index.ts:81-89`)의 JSON 스키마도 동일—
  영수증 이미지에서 "체험"/"trial" 관련 문구를 읽어도 지금은 버려진다.
- `ClassifiedIntent`(`supabase/functions/assistant-turn/gemini-intent.ts:79-90`): 마찬가지로 체험 필드 없음.
  기존 키워드 감지 패턴(재사용할 형태): `wantsCreate = /등록|추가|넣어줘/.test(compact) && ...`
  (`gemini-intent.ts:836`), `wantsUpdate = /바꿔|수정|변경/.test(compact) && ...`(`:838`). 같은 스타일로
  `wantsTrial = /무료체험|체험판|trial/i.test(compact)` 추가 가능.

### 3. 등록 저장 경로 (3곳, 전부 컬럼 리스트 수정 필요)

- RPC `confirm_pending_assistant_action`(최신 정의: `supabase/migrations/20260905023701_confirm_accepts_one_time.sql:260-266`) —
  `insert into public.subscriptions (user_id, name, amount, billing_cycle, category_id, anchor_date,
  next_payment_date, is_active, memo, preset_id, emoji, account_id) values (...)`. extract는
  `v_extract ->> 'field'`로 읽음(`:217-230`).
- 앱 `stores/subscription-store.ts:419-436` `addSubscription`.
- 웹 `web/src/lib/data.ts:115-133` `createSubscription`.

두 클라이언트 경로 모두 `next_payment_date`는 AI가 안 채우고 로컬에서
`computeNextPaymentDate`(`web/src/lib/calc.ts:44`, 앱도 동일 함수)로 직접 계산 — 체험 관련 파생값도
이 함수 근처에 있어야 앱·웹이 어긋나지 않는다.

### 4. 등록/수정 폼

- 앱 `components/SubscriptionModal.tsx`: `FormState`(`:60-73`), 결제 주기 선택 `OptionChips`가
  [`:478-484`](../components/SubscriptionModal.tsx#L478-L484)에 있고 바로 다음이 "최초 결제일"
  `DateField`([`:486-496`](../components/SubscriptionModal.tsx#L486-L496)). **체험 토글은 이 두 Field
  사이가 자연스러운 위치** — 새 날짜 입력을 따로 만들지 않고, 토글을 켜면 "최초 결제일" Field의
  라벨/힌트만 "체험 종료일(첫 결제일)"로 바뀌는 방식을 추천(같은 `anchorDate` 값 재사용, 폼이
  복잡해지지 않음). 저장 payload는 `:249-270`.
- 앱 `app/receipt/confirm.tsx`: `useState` 개별 필드 방식(`name, amount, cycle, anchorDate, categoryId,
  accountId`, `:44-50`), 저장 호출 `:81-91`. 체험 토글 추가 필요.
- 웹 `web/src/components/SubscriptionForm.tsx`: `SubscriptionFormDraft`(`:25-34`), cycle 상태
  `:69`, 결제 주기 버튼 행 `:269-277`, 저장 payload `:178`. 앱과 동일한 위치 관계.

### 5. 주기 라벨 표시 — 현재 흩어져 있음(정리 필요)

- **앱은 중앙화됨**: `constants/billing.ts`의 `BILLING_CYCLE_LABELS`/`BILLING_CYCLE_SHORT`를
  `SubscriptionRow.tsx:51,101`, `ChatActionCard.tsx:83`, `chat-text.ts:50`가 재사용. 단
  `ChatInlineCard.tsx`(`:63-75`)만 인라인 삼항연산자로 별도 중복.
- **웹은 4곳에 독립 중복**: `SubscriptionForm.tsx:17-21`(`CYCLES`),
  `assistant/ChatInlineCard.tsx:17`, `assistant/ChatActionCard.tsx:14`(동일한 `CYCLE` 상수 두 벌),
  `widgets/SubscriptionListWidget.tsx:43-46`(`BILLING_CYCLE_LABEL`, 사용처 `:297`).
  `web/src/lib/billing.ts` 같은 공용 파일이 아예 없음.

**권장**: 체험 배지를 얹기 전에 웹부터 `web/src/lib/billing.ts`로 4곳을 먼저 합치고, 앱은
`ChatInlineCard.tsx`의 인라인 삼항을 공용 맵으로 바꾼다. 그 위에 `subscriptionCycleLabel(sub)`
같은 래퍼 하나만 추가하면 "체험 종료 임박" 표시가 8곳이 아니라 딱 한 함수 안에서 끝난다.

### 6. 알림 시스템

`supabase/functions/generate-payment-notifications/index.ts` — `subscriptions`에서
`id, user_id, name, amount, billing_cycle, anchor_date, is_active`만 select(`:184`), 체험 개념 없이
모든 구독을 동일하게 취급. `REMINDER_OFFSETS = [3, 1]`(`:98`)일 때 알림 생성, 제목/본문은
`titleFor`/`bodyFor`(`:152-158`) — 예: `"3일 후 넷플릭스 결제 예정"`. `notifications` 테이블에 upsert(`:242`),
push `kind`는 `"payment_due"` 고정(`:230`, `:274`).

**체험 전용 문구 분기**를 여기 추가하는 게 자연스러운 지점 — `sub.is_trial`을 select에 추가하고
`titleFor`/`bodyFor`에서 분기: 예) `"3일 후 넷플릭스 체험 종료·자동 결제"` /
`"9월 22일부터 9,900원이 청구돼요. 계속 쓰실 건가요?"`.

### 7. 홈 브리핑 카드 — "무료 체험" 토픽은 아예 미구현 (범위 제외 권장)

`docs/rules/assistant.md`가 문서화한 브리핑 7개 토픽 중 실제 구현된 건 **3개뿐**(결제 예정, 사용 여부
확인, 해지 진행 확인 — `resolveBriefing`, `lib/briefing.ts`/`web/src/lib/briefing.ts:49-83`).
"무료 체험·연간 갱신 임박"을 포함한 나머지 4개는 선택 로직 자체가 없음 — 이번 기능과 무관하게
이미 있던 공백. 이번 계획에 브리핑 카드까지 넣으면 범위가 크게 늘어나고(3개 토픽 간 우선순위
로직까지 건드려야 함), 목록/상세 배지 + 알림만으로도 실제 목적(체험 전환 인지)은 충분히
달성된다 — **1차 범위에서 제외를 권장**.

## 설계 (권장안)

### 스키마

```sql
alter table public.subscriptions
  add column is_trial boolean not null default false,
  add column trial_ends_at date,
  add column trial_notice_acknowledged_at timestamptz,
  add constraint subscriptions_trial_ends_at_check
    check (not is_trial or trial_ends_at is not null);
```

`trial_ends_at`은 `anchor_date`(반복 결제 계산 기준)와 역할이 다른 **별도 컬럼**이다 — 재사용하면
시간이 지난 뒤(체험 종료 후 다음 결제 주기가 돌아온 뒤) 상태 판정이 불안정해지므로 반드시 분리한다
(열린 질문 2, 확정).

배지 조건은 항상 `is_trial && trial_ends_at >= today` — 자동 해제용 cron·RPC 불필요(날짜가 지나면
조건이 저절로 꺼짐). `anchor_date`/`next_payment_date`는 지금처럼 그대로 계산 — 체험 구독도 내부적으론
"미래의 특정일에 시작하는 평범한 월간/연간 구독"으로 취급해 지출 계산 코드를 전혀 안 건드린다.

**상태 모델(4개가 서로 독립, 섞지 않는다 — 아래 "종료 시점 전환 확인" 절에서 드러난 설계 실수를
바로잡은 결과):**

| 축 | 값을 결정하는 컬럼 |
|---|---|
| 체험 여부 | `is_trial` + `trial_ends_at`(날짜로 판정) |
| 알림 확인 여부 | `trial_notice_acknowledged_at` (버튼 응답 여부만 기록, 체험 여부와 무관) |
| 해지 여부 | 기존 `lifecycle_status` (변경 없음) |
| 결제 주기 | 기존 `billing_cycle` (변경 없음) |

`is_trial`을 "알림에 응답했는지"를 기록하는 용도로 쓰지 않는다 — 체험 배지는 오직 날짜(`trial_ends_at`)로만
꺼진다. 버튼 응답은 `trial_notice_acknowledged_at`에 별도로 남긴다.

### AI 감지 + 반영

- `gemini-intent.ts`: `wantsTrial` 정규식 추가, `ClassifiedIntent`/`asCreateSubscription`에
  `is_trial`/`trial_ends_at` 슬롯 추가.
- `claude-proxy` SYSTEM_PROMPT: JSON 스키마에 `is_trial`/`trial_ends_at` 추가, "영수증에 '첫 달
  무료'·'무료체험' 등이 보이면 is_trial을 true로, 실제 청구가 시작되는 날짜를 trial_ends_at에
  넣으세요" 규칙 추가.
- `confirm_pending_assistant_action` RPC, `addSubscription`(앱), `createSubscription`(웹) 3곳
  insert 컬럼에 추가.
- `ClaudeExtract`/`ParsedSubscription`(앱·웹 `types/extract.ts`) 타입에 필드 추가.

### 수동 토글 (AI가 놓쳤을 때 대비) — 진행형 공개(progressive disclosure)로 확정

**사용자 지적**: 스위치를 항상 노출하고 그 아래 날짜·계정 필드를 상시 붙여두면 평소(체험 아닌)
등록에도 폼이 늘어나 보여서 깔끔하지 않다. → **클릭 전까지는 세부 입력을 아예 숨긴다.**

`SubscriptionModal.tsx`(앱)·`SubscriptionForm.tsx`(웹) 공통: "결제 주기" 칩 밑에
**[⏳ 무료체험이에요] 칩 하나만** 추가(기본 상태는 눌리지 않은 상태). 폼은 이 상태에서 지금과
완전히 동일 — "최초 결제일" 필드 하나만 평범하게 보임, 계정 필드도 없음.

칩을 누르면 그 자리 아래로 **"최초 결제일" 필드 하나만** 펼쳐지고, 그 자리에서 라벨이 "체험
종료일(첫 결제일)"로 바뀐다 — 같은 `anchorDate` 값을 `anchor_date`이자 `trial_ends_at`으로 함께
저장(새 날짜 입력 아님). 칩을 다시 누르면 접히고 체험 아님으로 되돌아감.

**계정 필드는 새로 만들지 않는다 — 사용자 지적으로 수정.** `SubscriptionModal.tsx:532-538`에
"가입 계정" 필드가 **이미 폼 맨 아래(카테고리 다음)에 존재**하고, 라벨이
`sameServiceSubscriptions(...).length > 0`일 때 "필수"/그 외 "선택"으로 이미 동적으로 바뀐다.
체험 칩을 펼쳤을 때 이 자리에 계정 필드를 또 넣으면 폼에 계정 입력란이 **두 개** 생겨 겹친다.
대신 기존 필드의 필수 판정 조건만 넓힌다:

```ts
const accountRequired =
  sameServiceSubscriptions(subscriptions, form.name, form.presetId, editingId).length > 0 ||
  form.isTrial;
```

라벨은 그대로 `accountRequired ? '가입 계정 (필수)' : '가입 계정 (선택)'` 패턴 재사용, 저장 시
막는 검증(`accountIssue`)도 이 조건에 `form.isTrial && !form.accountId.trim()`을 추가. 웹
`SubscriptionForm.tsx`, `app/receipt/confirm.tsx`도 각자의 동일 위치 계정 필드에 같은 조건 추가 —
셋 다 새 입력란을 만들지 않고 기존 필드의 필수 조건만 확장한다.

**결제수단(카드)도 같은 이유로 필수 — 사용자 요청으로 추가.** "수많은 카드 중 어떤 카드에서
지출되는지" 확인 필요 — 체험이 여러 개 겹칠수록 어느 카드가 청구되는지 헷갈리기 쉽다. 이것도
새 필드가 아니라 **이미 있는 필드**를 재사용한다: `SubscriptionModal.tsx:556`의
"결제수단 (선택)" `Field`(→ `form.paymentInstrumentId`, `payment_instrument_id` 컬럼에 저장,
설정의 은행·카드 목록에서 고르는 칩 UI, `:608` "설정 > 결제수단에서 은행·카드를 등록할 수
있어요" 안내 포함). 계정 필드와 똑같은 패턴으로 필수 조건에 `form.isTrial`을 추가:

```ts
const paymentInstrumentRequired = form.isTrial;
```

라벨을 `paymentInstrumentRequired ? '결제수단 (필수)' : '결제수단 (선택)'`로 바꾸고, 저장 시
검증에 `form.isTrial && !form.paymentInstrumentId`를 추가해 막는다. 단, 사용자가 아직 결제수단을
하나도 등록해두지 않은 상태에서 체험을 켤 수 있으므로, 그 경우 "설정 > 결제수단에서 먼저 등록해
주세요" 안내로 막힘 없이 유도(기존 `:608` 안내 문구 재사용). 웹·영수증 폼도 동일 위치에 이미
있는 결제수단 필드에 같은 조건을 더한다 — 새 입력란 없음.

### 계정(이메일/아이디) + 결제수단(카드) 필수 — 사용자 지적으로 추가

**체험 구독은 이름이 겹치지 않아도 계정을 무조건 받는다.** 기존 `duplicateAccountIssue`
(`lib/duplicate-account.ts`)는 **같은 이름의 형제 구독이 2개 이상일 때만** 계정을 요구하는
로직이라, 체험은 그 조건과 무관하게 항상 필요하다 — 체험은 여러 서비스가 겹치기 쉽고
(같은 OTT를 다른 계정으로 여러 번 체험하는 경우 포함), 나중에 "종료 시점 확인" 알림·해지 안내
채팅이 정확히 어떤 계정의 구독인지 구분해야 하기 때문이다.

- **AI 비서(텍스트/영수증) 경로도 동일하게 계정 + 결제수단을 둘 다 필수로 받는다 — 사용자 요청으로
  확장.** `is_trial === true`로 판정되면, 이름 중복 여부와 무관하게 `account_id`와
  `payment_instrument_id`가 둘 다 비어 있는 채로 저장하지 않는다. 계정은 기존 "계정 필요" 흐름
  (`awaitingAccount`, `chat.tsx`/`AssistantPanel.tsx`에 이미 있는 채팅 답장 자동 등록 경로)을
  그대로 재사용 — 트리거 조건만 "이름 겹침 OR 체험임"으로 넓히면 된다. 결제수단은 채팅 텍스트로
  자유 입력을 받을 수 없으므로(카드 이름은 `payment_instrument_id`라는 실제 레코드를 가리켜야
  함), `awaitingAccount`와 같은 패턴으로 **`awaitingPaymentInstrument`** 상태를 추가하고 답장
  텍스트 대신 아래 "결제수단 선택 UI" 카드를 채팅 안에 인라인으로 띄워 고르게 한다(등록된 카드가
  없으면 그 카드 자체가 "먼저 등록하기" 버튼 하나만 보여줌). 계정 질문 → 결제수단 선택 순서로
  두 정보를 모두 받은 뒤에만 `addSubscription`/`createSubscription`을 호출.
- 수동 등록 폼(`SubscriptionModal.tsx`/`SubscriptionForm.tsx`/`receipt/confirm.tsx`)에서도
  체험 토글이 켜져 있으면 계정 입력 필드와 결제수단 선택을 둘 다 필수로 표시(별표·에러 메시지) —
  저장 시 하나라도 비어 있으면 막는다.

### 결제수단 선택 UI — 컴팩트 필드 + 바텀시트 (사용자 요청으로 추가, 3안 비교 후 확정)

**현재 상태**: `SubscriptionModal.tsx:556-610`의 결제수단 선택은 가로 스크롤 **칩** 목록이다
(`없음` 칩 + 등록된 카드/계좌 각각 칩 하나, `:601` `{institution.name} {last4}`만 작게 표시) —
카드가 여러 개면 구분이 잘 안 되고, "새로 등록하기"로 이어지는 진입점도 없이 아래
안내 텍스트(`:607-609` "설정 > 결제수단에서 은행·카드를 등록할 수 있어요")만 있다.

**검토한 3안**(목업 8·9번 섹션): (A) 카드형 가로 스크롤, (B) 세로 리스트(라디오), (C) 컴팩트
선택 필드 → 바텀시트. **(C) 확정** — 평소엔 폼에서 한 줄만 차지해 다른 필드들과 위화감이 없고,
탭했을 때만 시트가 올라와 고르는 방식이 이번 세션 내내 지켜온 "평소엔 안 늘어나고 필요할 때만
펼친다" 원칙(위 "진행형 공개" 절)과 가장 잘 맞는다.

- **닫힌 상태**: 선택된 결제수단이 있으면 아이콘 + "국민카드 ●●●● 4482"를 한 줄로 표시,
  없으면 "결제수단을 선택하세요" 플레이스홀더. 탭하면 시트가 열림.
- **시트 내용**: 등록된 결제수단이 **1개 이상**이면 각각을 라디오 형태로 세로 나열(은행/카드
  아이콘 + 기관명 + 마지막 4자리 + 선택 시 라디오 채움, `app/payment-methods.tsx`의 기존 기관
  아이콘·색상 재사용), 맨 끝에 **"+ 계좌/카드 추가"** 행을 하나 더 붙인다. 이 행을 누르면
  `router.push('/payment-methods')`로 이동(기존 라우트, 새 화면 아님) — 등록을 마치고 돌아오면
  방금 추가한 항목이 시트에 바로 나타나야 한다(payment-instrument-store가 전역 상태라 화면
  전환 후에도 자동 반영됨, 추가 로직 불필요).
- 등록된 결제수단이 **0개**면 시트 대신(또는 시트를 열자마자) "등록된 카드/계좌가 없어요.
  결제수단을 먼저 등록해야 체험을 등록할 수 있어요" 안내 문구 + **"계좌/카드 등록하기"** 버튼
  하나만 보여주고, 누르면 동일하게 `/payment-methods`로 이동해 등록을 유도한다.
- AI 비서 채팅의 `awaitingPaymentInstrument` 인라인 카드도 이 동일한 시트 컴포넌트(닫힌
  필드 → 탭하면 시트, 없으면 등록 유도)를 그대로 재사용 — 폼과 채팅에서 다른 컴포넌트를 새로
  만들지 않는다.

### 표시

1. 웹 라벨 4중복을 `web/src/lib/billing.ts`로 통합(앱의 `constants/billing.ts`와 대응), 앱의
   `ChatInlineCard.tsx` 인라인 삼항도 공용 맵으로 교체.
2. `subscriptionCycleLabel(sub)` 헬퍼 추가(앱·웹 각 1개) — 체험 조건이면 "체험 종료 임박" 반환.
3. 목록 행(`SubscriptionRow.tsx`, `SubscriptionListWidget.tsx`)·상세 화면: 체험이면 금액 취소선 +
   "곧 유료" 보조 텍스트로 교체(참고 이미지 그대로).

### 알림

`generate-payment-notifications/index.ts`의 select에 `is_trial`과 `trial_ends_at`(날짜 판정에 필요) 추가,
`titleFor`/`bodyFor`에 체험 전용 분기 추가. 기존 `REMINDER_OFFSETS`/스케줄링 로직은 그대로 재사용.

### 종료 시점 전환 확인 (계속 쓸지/해지할지) — 사용자 지적으로 추가

**놓쳤던 지점**: 등록 시점엔 이 체험이 나중에 "정식 구독으로 이어질지"(케이스 2) "안 이어질지"(케이스 1)
알 수 없다. 그러니 이건 **등록 화면에서 물을 질문이 아니다** — 체험 종료일이 가까워졌을 때 **별도로**
물어야 하는 질문이다. 위 "알림" 절만으로는 이 확인이 빠져 있었다 — 단순 안내("3일 후 결제돼요")만
있고, 실제로 계속 쓸지/해지할지를 사용자에게서 받아서 구독 상태에 반영하는 단계가 없었다.

**설계 — 사용자가 정확한 문구·버튼·흐름을 지정. 거의 전부 기존 해지 안내 인프라 재사용:**

알림 스케줄(D-3/D-1/D-DAY 3단계, 무응답이면 순차 재안내):
- **D-3**: 최초 안내.
- **D-1**: `trial_notice_acknowledged_at`이 비어 있으면(=아직 응답 안 함) 재안내.
- **D-DAY**: 여전히 비어 있으면 마지막 안내(문구는 아래 "당일 처리" 절 참고).

알림 문구(예시, D-1):
```
왓챠 무료 체험이 내일 끝나요.
내일부터 월 12,900원이 결제될 예정이에요.

[그대로 이용]  [결제 전 해지]
```

1. **[그대로 이용]** → **`is_trial`을 내리지 않는다** (초기 설계의 실수 — D-3에 눌렀는데 바로
   `is_trial=false`가 되면 체험 기간이 아직 남았는데 배지가 즉시 사라진다). 대신
   `trial_notice_acknowledged_at`에 현재 시각만 기록해 이후 재안내(D-1/D-DAY)를 멈춘다. 체험
   배지는 지금처럼 `trial_ends_at` 날짜가 지나야 자연히 사라진다 — **버튼 응답과 체험 상태를
   분리**하는 것이 이번 수정의 핵심.
2. **종료일까지 계속 무응답이면** → "사용자가 계속 이용을 선택했다"로 기록하지 않는다. 실제
   서비스처럼 해지하지 않으면 자동 결제되므로 구독 상태(`billing_cycle`, 예상 지출 계산)는 그대로
   유료로 유지하되, 이는 **"해지가 확인되지 않아 결제가 예정대로 진행된다"는 사실 반영**일 뿐 —
   사용자의 명시적 동의로 취급하지 않는다(문구·로그에서도 "동의함"이 아니라 "무응답"으로 구분).
3. **[결제 전 해지]** → **즉시 해지 처리하는 버튼이 아니다.** 이 구독을 대상으로 AI 비서
   채팅을 열고, 이미 구현된 **해지 안내 흐름**을 그대로 태운다 — 새로 만들 게 거의 없다:
   - 가입 경로 질문: `cancel-guide` 함수의 `needs_billing_channel` 플래그로 이미 생성되는
     "이 구독은 어디에 결제하고 있나요? 경로를 고르면 해지 안내를 찾아볼게요."
     (`supabase/functions/assistant-turn/index.ts:632-633`) — "앱에서 가입했나요, 웹사이트에서
     가입했나요?"와 동일한 질문. 다만 이번 진입점은 **의도(해지 안내 vs 목록 삭제)를 이미 알고
     있으므로** `needs_intent` 단계는 건너뛰고 바로 `needs_billing_channel`부터 시작 — 알림에서
     연 채팅이니 "목록에서 지울까요, 실제 해지 안내할까요?"를 다시 물을 필요가 없다.
   - 해지 방법 안내: `cancel-guide` 함수가 그대로 제공.
   - 완료 확인: 이미 구현된 **`LifecycleConfirmCard`**(`components/LifecycleConfirmCard.tsx:9`,
     `cancel_requested` 상태의 "해지 완료로 기록" 버튼 — 사용자가 요청한 "해지 완료"와 사실상
     동일한 문구, 그대로 재사용)가 "해지를 완료하셨나요?" + 확인/건너뛰기를 담당. 확인을 누를
     때만(=`advance_subscription_lifecycle` RPC 호출 시점에만) Subly 쪽 `lifecycle_status`가 바뀐다.
   - **오해 방지 문구**: [결제 전 해지] 버튼 아래나 채팅 첫 메시지에 "이 버튼은 바로 해지되는
     게 아니라 해지 방법을 안내해 드려요"를 명시 — 사용자가 정확히 지적한 부분. 새 카피 하나만
     추가하면 됨.

**이번 기능에서 실제로 새로 만드는 건 두 가지뿐이다** — (1) "알림 → 그 구독을 대상으로 해지 안내
채팅을 여는 진입점", (2) `trial_notice_acknowledged_at`을 기록/조회하는 얇은 로직. 가입 경로 질문·
안내·완료 확인은 전부 기존 `cancel-guide`/`LifecycleConfirmCard` 그대로.

**당일(D-DAY) 처리 — 사용자 질문으로 확인**

- **표시는 이미 문제없다.** `getDdayLabel`(`web/src/lib/calc.ts:93-98`, 앱도 동일 함수)이 당일을
  `'D-DAY'`로 이미 처리하고, 배지 조건 `is_trial && trial_ends_at >= today`도 당일을 포함하므로
  "체험 종료 임박 · D-DAY"가 자연스럽게 뜬다. 여기는 손댈 것 없음.
- **진짜 빠진 부분은 알림이다.** `REMINDER_OFFSETS = [3, 1]`(`generate-payment-notifications/index.ts:98`)에
  **0(당일)이 없다.** 일반 결제는 당일 알림이 없어도 무방하지만(이미 D-3/D-1에 알렸음), 체험은
  당일이 **실제로 과금이 시작되는 결정 마감일**이라 다르다 — D-3·D-1에 응답이 없으면 D-0엔
  아무 알림도 없이 그냥 유료 전환된다.
- **처리 예정**: `sub.is_trial`이 참인 구독에 한해서만 `REMINDER_OFFSETS`에 `0`을 추가(일반 결제는
  그대로 `[3, 1]` 유지, 노이즈 안 늘림). 문구도 급박하게: "밀리의서재 무료 체험이 오늘 끝나요.
  오늘부터 월 9,900원이 결제될 예정이에요." + 동일한 [그대로 이용] / [결제 전 해지] 버튼.

### 구독 목록 탭에도 버튼을 넣을까? — 사용자 질문 후 범위 제외로 결론

처음엔 "복잡하지 않다"까지 확인했었다 — `app/(tabs)/subscriptions.tsx:317-349`의 기존
"actions 푸터"(상태별로 [일시정지]/[다시 시작] 버튼 또는 평문 텍스트를 보여주는 자리)에
`is_trial` 네 번째 분기만 추가하면 되는 구조였다.

**최종 결론(사용자 판단): 목록 탭에 별도 버튼은 넣지 않는다.** 이미 목록에 수정/삭제 아이콘이
있고, 그걸로 대체 가능하다 — 체험 종료 시점 전환은 **알림에서만** [그대로 이용]/[결제 전 해지]로
처리하고, 목록 탭에서는 (필요하면) 기존 수정 아이콘으로 `is_trial`을 끄거나 삭제 아이콘으로
지우는 것으로 충분하다. 목록 탭 UI는 손대지 않는다.

## 열린 질문 (구현 전 확인 필요) — 4개 모두 확정 완료 (2026-09-15)

1. **브리핑 카드 토픽 포함 여부 → 1차 제외 확정.** 목록/상세 배지 + D-3/D-1/D-DAY 알림으로 핵심
   목적은 충족된다. 브리핑 우선순위 설계(3개 토픽 간 로직)는 별도 작업으로 분리. 출시 후 알림
   열람률이 낮으면 그때 추가.
2. **`trial_ends_at` 별도 컬럼 vs `anchor_date` 재사용 → 별도 컬럼 확정.** `anchor_date`(반복 결제
   계산 기준)와 `trial_ends_at`(최초 체험 전환 시점)은 역할이 달라, 재사용하면 시간이 지난 뒤
   상태 판정이 불안정해진다.
3. **무응답 시 기본값 → "계속 결제될 예정으로 처리하되, 사용자의 '동의'로 기록하지 않는다" 확정.**
   실제 서비스는 해지하지 않으면 자동 결제되므로 예상 지출·구독 상태는 유료로 유지하지만, 이건
   "해지가 확인되지 않아 결제가 예정대로 진행된다"는 사실 반영이지 사용자가 명시적으로 계속
   이용을 선택했다는 뜻이 아니다 — 로그·문구에서 "동의함"과 "무응답"을 구분한다. 재알림 스케줄은
   D-3 → (무응답) D-1 재안내 → (무응답) D-DAY 마지막 안내로 확정(위 "설계" 절 반영 완료).
   추가로 드러난 버그: [그대로 이용]을 눌렀다고 즉시 `is_trial=false`로 내리면 체험 기간이 아직
   남았는데 배지가 사라진다 — **버튼 응답(`trial_notice_acknowledged_at`)과 체험 상태(`is_trial`/
   `trial_ends_at`)를 분리**하도록 설계를 수정했다(위 "종료 시점 전환 확인" 절 반영 완료).
4. **브리핑 카드에 "종료 시점 확인"을 별도 토픽으로도 노출할지 → 1차 제외 확정.** 1번과 결국
   같은 작업(`resolveBriefing`에 후보·우선순위 추가)이라 함께 제외. 알림을 놓쳐도 목록/상세
   배지로 확인 가능하므로 1차 범위는 목록·상세 배지 + 알림까지만. 열람률이 낮으면 추후 추가.

## 검증 (구현 시)

- `cd supabase/functions/assistant-turn && deno test --allow-env --allow-read`
- `npx tsc --noEmit` (앱), `cd web && npm run build` (웹)
- 수동: AI로 "OO 무료체험 등록해줘" → `is_trial` 자동 설정 확인. 폼에서 수동 토글 → 저장 →
  목록/상세에서 배지·취소선 확인. 체험 종료일이 지난 구독은 배지 자동으로 안 뜨는지 확인.
  D-3/D-1/D-DAY 알림 문구가 체험 전용으로 나오는지 확인(웹·앱 동일).
  알림 탭 → **[그대로 이용]** 선택(D-3 시점) → `trial_notice_acknowledged_at`만 기록되고
  `is_trial`/배지는 그대로 유지되는지, 이후 D-1/D-DAY 재알림이 안 오는지 확인.
  알림 탭 → **[결제 전 해지]** 선택 → 기존 해지 생명주기 흐름(`cancel-guide`/
  `LifecycleConfirmCard`)으로 정확히 넘어가는지(새 흐름을 만들지 않았는지 확인), 안내 문구에
  "바로 해지되는 게 아니다"가 명시돼 있는지.
  알림에 끝까지 무응답 → 종료일이 지나면 배지는 사라지되 구독은 유료로 유지되고, 어디에도
  "동의함"으로 기록되지 않는지(무응답 vs 동의 구분) 확인.
