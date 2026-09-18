# 구독 해지 안내 기능 설계안 (v2)

> 상태: 설계 확정 (코드 미반영, 구현 전 사용자 승인 대기)
> v1(Gemini Search Grounding → Claude 재가공 구조)은 Gemini API 약관 리스크(Grounded Result 수정·혼합·공용 캐싱 금지)로 폐기되었습니다. 이 문서가 v1을 대체합니다.

## 1. 개요

사용자가 등록한 구독 서비스의 해지 방법을 물으면, 결제 채널(웹/Apple/Google Play/통신사)별 차이를 반영해 해지 단계·환불·주의사항을 안내한다. 검색과 구조화는 Claude API의 Web Search/Web Fetch가 전담하고, Gemini는 그라운딩 없는 보조 작업(정규화·분류 등)에만 쓰인다. 여러 사용자에게 공용으로 제공하는 안내는 사람이 공식 문서를 독립적으로 확인한 curated 데이터로만 한정한다.

## 2. 역할 분리 — Gemini / Claude

Gemini는 검색 결과를 Claude에 넘기는 업스트림 검색 엔진으로 쓰지 않는다.

**그룹 A (기본 파이프라인의 일부, 그라운딩 미사용, 이번 MVP 구현 범위)**
- 서비스명 정규화, 사용자 질문의 해지 의도 분류, 추가 질문 필요 여부 판단, 결제 채널 분류
- 테스트 질문·평가 데이터 생성
- 사람이 작성한 curated 가이드의 형식·누락 항목 점검
- 구조화된 최소 데이터만 사용하고 PII를 제거한 뒤 전달
- 이 호출들은 `googleSearch` 도구를 쓰지 않으므로 Gemini의 Grounded Result 관련 약관 제약(수정·혼합·캐싱 금지) 대상이 아니다. 결과를 자유롭게 저장·재사용해도 된다.
- **PII 보호**: 사용자 채팅 원문을 그대로 Gemini에 전달하지 않는다. 가능하면 구조화된 필드(서비스명 후보, 질문 유형 등)로 축약해서 전달하고, 자유 텍스트를 넘겨야 할 때는 이메일·전화번호·카드번호·이름 등 PII 패턴을 제거하는 스크러빙을 거친 뒤에만 전달한다. 이메일·결제정보·`user_id`·구독 id·전체 대화 이력은 어떤 Gemini 호출에도 원문으로 넘기지 않는다. (Gemini 무료 티어는 사람이 입력/출력을 검토할 수 있다는 약관 문구가 확인되어, 이 원칙은 필수 사항이다.)

**그룹 B (Search Grounding 실험 모드, 이번 MVP 제외)**
- 검색 결과는 요청한 사용자에게만 표시하고, 여러 사용자에게 재사용하거나 공용 캐시로 저장하지 않는다.
- Gemini Grounded Result를 Claude에 전달해 재작성하지 않는다.
- Gemini 결과를 자동으로 curated 데이터에 등록하지 않는다.
- 인라인 인용과 Search Suggestions(최대 5개)를 다른 콘텐츠와 섞지 않고 그대로, 전용 카드에 표시한다.
- 기본 해지 안내 파이프라인과 코드 경로를 명확히 분리한다(`mode: "gemini_experiment"` 등).
- **이번 MVP 구현에서는 제외합니다.** 기본 파이프라인이 안정화된 후 feature flag가 적용된 별도 실험으로 진행합니다(12-4번 참고). 이유: 별도 약관 준수 UI·데이터 격리 필요, Search Suggestions·인용 표시 별도 구현 필요, 기본 파이프라인과 동시 구현 시 테스트 범위가 커짐.

**Claude**는 기본 해지 안내 파이프라인 전체(검색·검증·구조화)를 담당한다.
- Web Search/Web Fetch 사용, 가능하면 해당 서비스의 공식 도메인만 허용(`allowed_domains`)
- 공식 근거가 확인된 실행 단계만 안내, 각 단계와 실제 인용 출처를 연결
- 환불·위약금·데이터 삭제 등 고위험 정보는 추가 검증
- 검색 실패 시 기억에 의존해 절차를 만들어내지 않고 "최신 공식 절차를 확인하지 못했습니다"로 응답
- 검색 횟수는 `max_uses`로 제한(요청당 3~5회 권장)

## 3. 기본 처리 흐름

1. 사용자 질문에서 서비스와 해지 의도를 감지
2. 서비스명 정규화 (Gemini 그룹 A)
3. 국가는 서버에서 `"KR"`로 고정, 플랫폼·결제 채널 확인 — 결제 채널이 없으면 사용자에게 먼저 질문
4. 유효한 verified 가이드 조회
5. verified 가이드가 있으면 즉시 반환 (Claude/Gemini 호출 생략 — 비용 절감의 핵심 지점)
6. 없으면 Claude 공식 웹 검색 수행 (호출 전 사용량 한도 확인, 11번 참고)
7. 문장별 공식 근거가 있는 실행 단계만 구조화
8. 고위험 내용은 추가 검색 또는 `review_needed` 처리
9. 검색 실패 시 추측하지 않고 안전한 실패 안내 제공 (steps 비움 + 고정 실패 문구 + 정적 고객센터 링크, 12-7번 참고)
10. 결과는 해당 사용자 범위의 임시 데이터로만 저장
11. 별도 사람 검수를 거친 경우에만 verified 공용 가이드로 승격

## 4. 데이터 상태 및 공용/사용자 데이터 분리

AI가 생성한 결과를 곧바로 여러 사용자에게 제공하는 공용 캐시로 저장하지 않는다. 공용으로 제공할 수 있는 것은 사람이 공식 문서를 독립적으로 확인하고 직접 승인한 curated 데이터뿐이다.

| 상태 | 의미 | 공개 범위 |
| --- | --- | --- |
| `generated` | 특정 사용자 요청으로 생성된 임시 결과 | 해당 사용자만 |
| `review_needed` | 근거 부족 또는 출처 충돌 | 해당 사용자 + 내부 검토자만 |
| `verified` | 사람이 공식 문서를 독립적으로 검수한 공용 가이드 | 전체 사용자 |
| `expired` | 재검토 필요 | verified에서 강등, 재검수 전까지 신규 노출 안 함 |

`verified` 승격 시 기록: `verified_by, verified_at, expires_at, 공식 출처, 국가, 플랫폼, 결제 채널, 변경 이력`. Gemini Grounded Result나 Gemini가 제공한 링크를 자동으로 verified 데이터에 복사하지 않는다. 검수자는 공식 고객센터를 직접 확인하고 자기 언어로 새로 작성한다(원문 그대로 복사 금지 — 별도 저작권 이슈 방지).

물리적으로 분리된 테이블(8번)과 RLS로 이 경계를 강제한다. curated 테이블에는 클라이언트가 직접 쓸 수 있는 정책을 두지 않아, "생성 결과가 자동으로 공용 데이터가 되는" 코드 경로가 아예 존재하지 않게 한다. MVP에서는 이 상태 전환을 Supabase Studio에서 사람이 직접 수행한다(12-3번 참고).

## 5. 결제 채널

해지 경로는 결제 채널에 따라 달라진다(예: 같은 넷플릭스라도 Apple 앱스토어 결제와 웹 직접결제는 해지 화면이 다르다).

값: `direct_web`, `apple_app_store`, `google_play`, `carrier`, `unknown`

- 구독 등록 시 `billing_channel`은 선택 입력(필수화하지 않음 — "초경량 등록"이라는 앱의 핵심 가치 유지)
- 기존 구독에 결제 채널 정보가 없으면 해지 안내 요청 시점에 사용자에게 질문
- 답변을 구독 정보에 저장할지는 별도로 사용자에게 확인 후 결정

## 6. confirmed 판정 규칙

- `sources` 배열이 존재한다는 이유만으로 `confirmed`로 판정하지 않는다.
- 각 실행 단계가 공식 출처의 인용 근거(문장 단위)와 직접 연결됐을 때만 `confirmed`로 취급한다.
- 공식 근거가 없는 실행 단계는 사용자에게 노출하지 않는다.
- 검색 confidence score는 보조 신호일 뿐 사실 검증 결과로 취급하지 않는다.

## 7. 요청/응답 스키마

```json
// 요청
{
  "service_query": "넷플릭스",
  "billing_channel": "apple_app_store" | "google_play" | "direct_web" | "carrier" | "unknown" | null,
  "platform": "ios" | "android" | "web" | null,
  "subscription_id": "uuid | null",
  "mode": "curated"
}
```

`country`는 요청 바디에 넣지 않는다. MVP에서는 다국가 지원을 하지 않으므로, 클라이언트가 값을 보내더라도 `cancel-guide` Edge Function이 항상 내부에서 `"KR"`로 고정해서 처리한다(클라이언트 입력을 신뢰하지 않음). `mode: "gemini_experiment"`는 그룹 B가 이번 MVP에서 제외되므로 아직 사용하지 않는다.

```json
// 응답
{
  "status": "verified" | "generated" | "review_needed" | "not_found",
  "service_id": "netflix",
  "service_name": "넷플릭스",
  "country": "KR",
  "billing_channel": "apple_app_store",
  "platform": "ios",
  "steps": [
    {
      "order": 1,
      "description": "설정 > Apple ID > 구독 메뉴에서 넷플릭스를 선택합니다.",
      "citation": { "url": "...", "title": "...", "quoted_span": "..." },
      "confidence": "confirmed" | "inferred"
    }
  ],
  "cancellation_effective_at": "텍스트 또는 null",
  "refund_policy": "텍스트 또는 null",
  "warnings": ["..."],
  "official_support_url": "...",
  "confidence": "confirmed" | "partial" | "unverified",
  "fetched_at": "ISO8601",
  "disclaimer": "정확한 절차는 공식 앱/웹사이트에서 최종 확인하세요.",
  "search_failed": false
}
```

## 8. 필요한 DB 테이블

- `cancellation_guides_curated` (공용, verified 전용): `service_id, country, billing_channel, platform`(복합 unique) + `steps jsonb, refund_policy, warnings jsonb, official_support_url, status(verified/expired), verified_by, verified_at, expires_at, change_log jsonb, created_at`. RLS: 인증 사용자 select 공용 허용, insert/update는 클라이언트 경로 없음(Supabase Studio에서 사람이 직접 관리, 12-3번).
- `cancellation_requests_user` (사용자 스코프 임시): `user_id, service_query, service_id, country, billing_channel, platform, payload jsonb, status(generated/review_needed/expired), created_at`. RLS는 기존 `receipt_uploads` 패턴과 동일하게 own-only.
- `ai_usage_daily` (사용량 카운터, rate limit용, 12-6번): 기준 키 `user_id, endpoint, usage_date`(복합 unique) + `request_count, web_search_count, updated_at`. 클라이언트 direct read/write 불가 — insert/update는 `security definer` RPC를 통해서만, RLS로 직접 접근 차단.
- (그룹 B 구현 시, 이번 MVP 제외) `cancellation_gemini_experiments`: `user_id, service_query, raw_text, grounding_sources jsonb, created_at`. own-only RLS, curated와 조인 없음.
- `subscriptions.billing_channel` 컬럼 추가 (선택 입력, check 제약 5개 값). **주의**: `subscriptions` 테이블 자체의 최초 CREATE 마이그레이션이 저장소에 없으므로(12-5번), 이 컬럼 추가 마이그레이션을 작성하기 전에 원격 DB의 실제 스키마를 먼저 확인한다.

## 9. 저장소 현황 (근거)

- `supabase/functions/claude-proxy/index.ts`: 기존 Claude 프록시 패턴(사용자 JWT로 RLS 적용, `ANTHROPIC_API_KEY`는 `Deno.env.get()`만 사용, 서비스 롤 미사용). 새 `cancel-guide` 함수도 동일 패턴을 따른다. 현재 Web Search 도구는 없음 — 신규 추가 필요.
- `types/subscription.ts` / `stores/subscription-store.ts`: 현재 `billing_channel`, `country`, `platform` 필드 없음(grep으로 확인).
- `components/SubscriptionModal.tsx`: `account_id`(서비스 로그인 계정) 필드가 이미 있음 — `billing_channel` 선택 필드를 이 근처에 추가하는 것을 권장.
- `app/chat.tsx`: `supabase.functions.invoke('claude-proxy', {...})` 패턴으로 호출. 새 기능도 `lib/cancel-guide.ts`를 통해 `supabase.functions.invoke('cancel-guide', {...})`로 동일하게 연결.
- `AGENTS.md`: Expo SDK 57 문서(`https://docs.expo.dev/versions/v57.0.0/`) 준수만 명시. 다른 저장소 컨벤션 없음 — 확인 완료.
- 자동화 테스트 프레임워크 없음(jest 설정·테스트 스크립트·`*.test.*` 파일 전부 미확인).
- git 로그 확인 결과 저장소 전체가 커밋 6개뿐인 초기 프로젝트이며, `supabase/migrations`를 건드린 커밋은 2개뿐(둘 다 최근 날짜). `subscriptions` 테이블은 그 이전 커밋(`f670dea`, "Add onboarding, subscription CRUD, and theming scaffold")에서 이미 쓰이고 있어 마이그레이션 파일 도입 이전에 별도 경로(Dashboard/SQL Editor 추정)로 생성됐을 가능성이 높음 — 자세한 내용과 확인 절차는 12-5번.

## 10. 변경될 파일 목록

**신규**
- `supabase/functions/cancel-guide/index.ts` (핵심 함수)
- `supabase/functions/cancel-guide/gemini-helpers.ts` (그룹 A + PII 스크러빙)
- `supabase/migrations/0009_cancellation_guides.sql` (curated/requests_user 테이블)
- `supabase/migrations/0010_ai_usage_daily.sql` (rate limit 카운터 테이블 + RPC, 12-6번)
- `supabase/migrations/0011_subscriptions_billing_channel.sql` (컬럼 추가 — 12-5번 원격 스키마 확인 이후 작성)
- `lib/cancel-guide.ts` (클라이언트 래퍼)
- `components/CancelGuideCard.tsx` (결과 카드)
- `constants/cancellation-support-links.ts` (정적 고객센터 링크 목록, 12-7번 — 서비스별 `url, verified_at` 포함)

**수정**
- `app/chat.tsx` (해지 의도 감지 분기 + 카드 연결)
- `components/SubscriptionModal.tsx` (billing_channel 필드)
- `types/subscription.ts`
- `stores/subscription-store.ts`

(그룹 B는 이번 MVP 제외이므로 `components/GeminiExperimentCard.tsx` 등은 후속 범위로 미룬다.)

## 11. 구현 순서

1. `subscriptions` 원격 스키마 확인 (12-5번) — 마이그레이션 작성 전 선행
2. DB 마이그레이션(8번 테이블 + `billing_channel` 컬럼)
3. `cancel-guide` 함수 뼈대 (curated 조회만 우선, country는 서버에서 `"KR"` 고정)
4. `ai_usage_daily` 기반 rate limit 확인 로직 (Claude Web Search 호출 전 게이트)
5. Claude Web Search 연동(도메인 제한 · `max_uses` · 실패 폴백 · 정적 고객센터 링크 fallback)
6. confirmed 판정 로직(문장-인용 매핑, 6번)
7. Gemini 그룹 A 연동 + PII 스크러빙
8. 클라이언트 연결(`lib/cancel-guide.ts`, `CancelGuideCard`, `chat.tsx`)
9. `SubscriptionModal`에 `billing_channel` 필드 + 되묻기 플로우
10. 검수 운영 흐름 문서화 (Supabase Studio 사용법 정리)

## 12. 남은 결정 사항 (확정됨)

**1. country** — MVP에서는 `"KR"`로 고정합니다. 클라이언트가 보낸 country 값은 신뢰하지 않고, `cancel-guide` Edge Function 내부에서 항상 `"KR"`로 덮어씁니다. 다국가 지원은 후속 범위로 남깁니다.

**2. AGENTS.md** — Expo SDK 57 준수 외 추가 비공개 컨벤션 없음 (확인 완료).

**3. curated 검수 인터페이스** — MVP에서는 별도 관리자 화면을 만들지 않고 Supabase Studio를 사용합니다. `verified / expired / verified_by / verified_at / expires_at`을 Studio 테이블 편집기에서 직접 관리합니다. 다음 중 하나가 충족되면 별도 관리자 화면을 후속으로 검토합니다: curated 가이드 30개 이상 / 검수 담당자 2명 이상 / 매주 반복적인 검수 작업 발생 / JSON 필드 직접 편집 오류 빈발.

**4. Gemini 그룹 B** — 이번 구현에는 그룹 A만 포함합니다. 그룹 A 범위: 서비스명 정규화, 해지 의도 분류, 결제 채널 추가 질문 판단, 구조화된 최소 데이터만 사용, PII 제거. 그룹 B(Search Grounding 실험 모드)는 이번 MVP에서 제외하고, 기본 파이프라인이 안정화된 후 feature flag가 적용된 별도 실험으로 진행합니다. 이유: 별도 약관 준수 UI·데이터 격리 필요, Search Suggestions·인용 표시 별도 구현 필요, 기본 파이프라인과 동시 구현 시 테스트 범위가 커짐.

**5. subscriptions 최초 CREATE 마이그레이션** — 저장소만으로는 최초 생성 경위를 확정할 수 없습니다. 확인된 사실: 마이그레이션은 `subscriptions`가 이미 존재한다는 전제로 시작함(0002가 ALTER문), 최초 `CREATE TABLE public.subscriptions`는 마이그레이션에 없음, 전체 CREATE SQL은 `docs/SPEC.md`에만 문서로 기록됨, 최초 테이블이 Supabase Dashboard/SQL Editor에서 직접 생성됐을 가능성은 있으나 확정할 증거는 없음(git 로그상 정황 근거는 9번 참고). **기존 테이블을 다시 CREATE하는 마이그레이션은 임의로 만들지 않습니다.** 구현 전 별도 확인 대상: 원격 DB의 실제 subscriptions 스키마, Supabase migration history, 로컬 마이그레이션과 원격 스키마 차이, 최초 생성 SQL 또는 작업 기록. 확인 후 기존 원격 DB를 깨뜨리지 않는 baseline 정리 방법(예: `supabase db pull`로 원격 스키마를 역산한 baseline 마이그레이션만 새로 추가하고 원격엔 재적용하지 않는 방식, 또는 `supabase migration repair`로 히스토리만 맞추는 방식)을 그 확인 이후에 제안합니다.

**6. rate limit** — Supabase 플랫폼 기본 제한은 이 기능에 필요한 사용자별 일일 AI 호출 한도로 간주하지 않습니다. 공식 문서([Rate Limiting 가이드](https://supabase.com/docs/guides/functions/examples/rate-limiting))도 Redis/Upstash 기반 예시만 제공하고 Postgres 대안은 없다는 걸 확인했습니다. MVP에서는 외부 Redis/Upstash 없이 Postgres 기반 전용 사용량 카운터로 시작합니다.
- 신규 테이블 `ai_usage_daily`: 기준 키 `user_id + endpoint + usage_date`(복합 unique), 기록값 `request_count, web_search_count, updated_at`. 원시 요청 로그가 아니라 일별 집계만 유지.
- 동시 요청 안전성: `INSERT ... ON CONFLICT (user_id, endpoint, usage_date) DO UPDATE SET request_count = ai_usage_daily.request_count + 1 ... RETURNING`을 단일 문으로 수행하는 `security definer` RPC로 원자성 확보. 클라이언트는 이 RPC를 직접 호출할 수 없고, `cancel-guide` Edge Function만 호출 — RLS로 클라이언트 직접 read/write 차단.
- `cancel-guide` 함수가 Claude Web Search 호출 **전에** 한도를 확인하고, 초과 시 429 + 재시도 가능 시점(다음 날 자정 등)을 반환.
- 초기 한도값(제안, 구현 전 확정): 사용자당 일일 `request_count` 10회, 그중 실제 Web Search를 태우는 `web_search_count` 5회. 환경변수(`CANCEL_GUIDE_DAILY_LIMIT`, `CANCEL_GUIDE_DAILY_SEARCH_LIMIT`)로 조정 가능. curated 캐시 히트는 비용이 안 드므로 카운트에서 제외.
- 트래픽이 커지면 Upstash 등으로 전환할 수 있도록 카운터 접근을 함수 내부의 얇은 인터페이스 뒤에 둡니다.

**7. 검색 실패용 정적 고객센터 링크** — 미리 큐레이션합니다. 초기 8~10개 서비스: Apple 구독 관리, Google Play 구독 관리, Netflix, YouTube Premium, Coupang WOW, Naver Plus Membership, Spotify, TVING, Wavve, Disney+. 각 URL은 구현 시점에 공식 고객센터 도메인인지 직접 확인하고 확인 날짜를 함께 기록합니다(`constants/cancellation-support-links.ts`에 `url, verified_at` 형태로). 검색 실패 시 순서: 기억에 의존한 해지 단계 생성 안 함 → "최신 해지 절차를 확인하지 못했습니다" 표시 → 등록된 공식 링크가 있으면 제공 → 없으면 "서비스 공식 앱/웹사이트에서 확인" 일반 안내.

---

이 문서는 설계 확정 단계이며, 실제 코드/마이그레이션은 12-5번(원격 스키마 확인) 및 사용자 최종 승인 이후 진행합니다.
