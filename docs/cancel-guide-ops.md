# 해지 안내 운영 (Studio 검수)

코드 관리자 UI는 없습니다. verified 공용 가이드는 Supabase Studio에서만 올립니다.

## 시크릿

Edge Function `cancel-guide`가 읽는 값입니다. 클라이언트 `.env`에 넣지 않습니다.

```bash
npx supabase secrets set ANTHROPIC_API_KEY=<값> --project-ref ikbogbhugowdvrcxggax
npx supabase secrets set GEMINI_API_KEY=<값> --project-ref ikbogbhugowdvrcxggax
```

선택: `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `CANCEL_GUIDE_DAILY_LIMIT`(기본 10), `CANCEL_GUIDE_DAILY_SEARCH_LIMIT`(기본 5).

배포:

```bash
npx supabase functions deploy cancel-guide --project-ref ikbogbhugowdvrcxggax
npx supabase functions deploy claude-proxy --project-ref ikbogbhugowdvrcxggax
```

## curated 등록

테이블: `cancellation_guides_curated`

1. 공식 고객센터 페이지를 브라우저로 직접 연다. Gemini/Claude 링크를 그대로 믿지 않는다.
2. `status = verified` 행을 새로 넣는다. AI `cancellation_requests_user.payload`를 복사하지 않는다. 검수자가 자기 문장으로 쓴다.
3. 채울 값: `service_id`, `service_name`, `country`(항상 `KR`), `billing_channel`, `platform`, `steps`(각 단계 `citation.quoted_span` 필수), `official_support_url`, `verified_by`, `verified_at`, `expires_at`, `change_log`.
4. 만료 시 `status`를 `expired`로 바꾼다. 만료된 행은 앱이 쓰지 않고 다음 요청은 다시 Claude 검색을 탄다.

복합 유니크: `(service_id, country, billing_channel, platform)`.

## 사용자 임시 결과

`cancellation_requests_user`는 본인 RLS만. 공용 가이드로 승격하는 SQL/트리거는 없다.

## 정적 고객센터 링크

검수된 3개만 등록한다. 그 외 서비스는 준비될 때까지 목록에 넣지 않는다.
확인일(`verified_at`)은 2026-08-30. URL의 `&`는 이스케이프하지 않는다.

| service_id | 조건 | URL | 용도 |
| --- | --- | --- | --- |
| netflix | country=KR | https://help.netflix.com/ko/node/407 | 넷플릭스 해지 공식 도움말 |
| youtube_premium | country=KR, platform=android, billing_channel=google_play | https://support.google.com/youtube/answer/6308278?hl=ko&co=GENIE.Platform%3DAndroid | Android·Play 결제 YouTube Premium 해지 도움말 |
| disney_plus | country=KR | https://help.disneyplus.com/ko/article/disneyplus-cancel | Disney+ 해지 공식 도움말 |

YouTube 링크는 Android + Google Play일 때만 폴백으로 보여 준다. App Store 등 다른 채널 절차를 이 URL만으로 confirmed 처리하지 않는다.

## 수동 테스트

- 넷플릭스 해지 방법 알려줘 → 결제 경로를 묻지 않고 바로 가이드 카드(웹 결제 기준 안내 포함). 삭제 카드가 아님.
- 임의/테스트 서비스명으로 해지 방법 알려줘 → `not_found` 가이드 카드에 안내 확인/해지 신청 등 lifecycle 버튼 없이 "목록에서 삭제" 버튼만 노출 → 클릭 시 기존 삭제 확인 카드로 전환되어 실제 삭제까지 확인.
- 넷플릭스 삭제해줘 → 기존 삭제 확인 카드.
- 한도: 검색 6회째 429 안내.
- 다른 계정으로 `cancellation_requests_user`가 안 보임.
