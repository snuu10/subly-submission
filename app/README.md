# app/

Expo Router 화면. 파일 경로가 곧 라우트입니다.

- `(tabs)/` — 하단 탭: 홈, 목록, 비서, 예정, 통계, 설정
- `(onboarding)/` — 로그인·가입
- `receipt/` — 영수증 촬영·분석·확인
- `subscription/[id].tsx` — 구독 상세(레거시 경로, 모달이 기본)
- `chat.tsx` — `/chat` 진입 시 비서 탭으로 보냄
- `categories.tsx` — 카테고리 관리

웹 대시보드는 여기 없고 [`web/`](../web/)입니다.
