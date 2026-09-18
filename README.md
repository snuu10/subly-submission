# subly

자취생·라이트 유저를 위한 구독 지출 관리. 계좌 연동 없이 수동 등록, 영수증 OCR, AI 비서로 돌아갑니다.

앱과 웹은 **따로 만든 클라이언트**이고, **같은 Supabase**를 씁니다. 구독 데이터는 공유되고, 로그인 세션은 기기·브라우저마다 다릅니다.

| 구분 | 위치 | 스택 |
|---|---|---|
| 모바일 앱 | 저장소 루트 (`app/`, `npx expo start`) | Expo SDK 57, React Native |
| 웹 대시보드 | [`web/`](web/) (`cd web && npm run dev`) | Vite, React, Tailwind |
| 백엔드 | [`supabase/`](supabase/) | Auth, Postgres, Edge Functions |

접속·테스터 비서 확인은 [docs/ACCESS.md](docs/ACCESS.md), 폴더 역할은 각 폴더의 `README.md`를 보세요.

```bash
# 앱
npm install
npx expo start

# 웹
cd web && cp .env.example .env && npm install && npm run dev
```
