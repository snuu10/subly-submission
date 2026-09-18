# supabase/

앱·웹이 같이 쓰는 백엔드.

- `migrations/` — Postgres 스키마, RLS. 루트에서 `supabase db push` / Studio로 적용
- `functions/` — Edge Functions
  - `assistant-turn` — 텍스트 채팅. 의도 분류는 Claude, 월 목록·비교·정리 추천·해지 생명주기는 키워드+DB 템플릿. 조회 unknown도 Claude
  - `claude-proxy` — 영수증 OCR 등 유료 Claude가 필요한 작업
  - `cancel-guide` — 해지 절차(공식 페이지 확인 때 Claude)
  - `suggest-category` — 카테고리 추천
  - `weekly-digest` — 주간 브리핑 캐시

시크릿(`ANTHROPIC_API_KEY` 등)은 대시보드에만 두고 저장소에 넣지 않습니다. CLI `.temp/`는 gitignore입니다.
