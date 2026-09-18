# 개발 환경

갱신: 2026-09-05 (과거 발화 기록)

## Supabase

- 프로젝트: `ikbogbhugowdvrcxggax` (`https://ikbogbhugowdvrcxggax.supabase.co`).
- 마이그레이션·함수 배포는 이 개발 프로젝트만 대상으로 한다. 사용자가 프로덕션을 명시하지 않으면 프로덕션에 배포하지 않는다.

출처: 2026-08-23 「Supabase 이 프로젝트 사용하세요.」

## 시크릿

- Claude 호출 키는 클라이언트 `.env`가 아니라 **Supabase Edge Function Secrets**에만 넣는다.
- 이름: `ANTHROPIC_API_KEY`. Gemini를 쓰는 기능이 있으면 `GEMINI_API_KEY`도 같은 Secrets.

출처: 2026-08-29 「클라이언트 .env가 아니라 Supabase 시크릿만 넣으세요.」

## 웹

- 로컬 웹은 **5174 포트 고정**.

출처: 2026-09-02 「웹은 5174 포트 고정으로 띄워줘」

## 테스터

- 확인용 계정: `tester@subly.app`. 비밀번호는 저장소에 두지 않는다.

접속 절차는 `docs/ACCESS.md`.
