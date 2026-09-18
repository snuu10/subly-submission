# web/

조회·관리용 웹 대시보드. 앱(Expo)과 코드베이스가 분리된 Vite + React + Tailwind 프로젝트입니다.

같은 Supabase URL/anon key를 쓰고, 구독 CRUD·Realtime·AI 비서(등록/변경/해지 안내)를 지원합니다. 영수증 카메라/파일 첨부는 앱 전용입니다.

```bash
cp .env.example .env
npm install
npm run dev
```

- `src/pages/` — 로그인, 대시보드
- `src/components/` — 사이드바, 위젯, 비서 패널, 구독 폼
- `src/lib/` — Supabase, 계산, 채팅/해지 호출
- `public/fonts/` — Pretendard Variable (웹)

접속 방법은 [docs/ACCESS.md](../docs/ACCESS.md)입니다. 테스터 비서 확인·API 스크립트도 그 문서에 있습니다.
