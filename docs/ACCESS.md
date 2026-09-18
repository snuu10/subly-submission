# subly 접속 가이드

앱과 웹은 **같은 Supabase 계정**을 씁니다. 구독 데이터는 공유되지만, 로그인 세션은 기기·브라우저마다 따로입니다. 웹에서 로그인했다고 앱이 자동으로 열리지는 않습니다.

개발 확인용 계정은 `tester@subly.app` 입니다. 비밀번호는 저장소에 두지 않습니다.

## 앱 (Expo)

저장소 루트에서:

```bash
npm install
npx expo start
```

QR을 Expo Go로 찍거나, 터미널에서 `i`(시뮬레이터) / `a`(Android)를 누릅니다. Google 또는 테스터 이메일/비밀번호로 로그인합니다.

## 웹 대시보드 (로컬)

배포하지 않고 로컬에서 확인합니다.

```bash
cd web
cp .env.example .env
```

`.env`의 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`는 루트 `.env`의 `EXPO_PUBLIC_*`와 같은 값입니다.

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5174 을 열고 Google, 이메일 로그인, 또는 **가입하기**로 인증번호를 받아 계정을 만듭니다.

웹에서 구독 **추가 · 수정 · 일시정지 · 삭제**가 됩니다. 앱에서 바꾼 내용도 Realtime으로 대시보드에 바로 반영됩니다. 헤더 **+** 로 추가하고, 구독 목록이나 곧 결제 행을 눌러 수정합니다.

헤더 **비서**, 또는 브리핑 카드로 채팅 패널이 열립니다. 웹 비서도 앱과 같이 등록·변경·삭제·일시정지·해지 안내를 확인 카드로 적용합니다. 영수증 카메라/파일 첨부는 앱에서만 됩니다.

## 비서 채팅 확인

앱 AI 비서와 웹 헤더 **비서**에서 같은 문장을 보냅니다.

1. `목록` → 말풍선 아래 이름 / 금액 / 결제일 표 (쉼표로 이어진 한 줄이 아님)
2. `그중에서 제일 비싼` → 방금 목록 안에서 가장 비싼 구독
3. `홍티비 등록` → `3만원` → 등록 확인 카드 (3만 원 이하 목록이 아님)
4. `홍티비 30000` → `등록` 키워드 없이도 등록 확인
5. 넷플릭스가 두 개면 가로로 나란히, 아래 `대화 이어가기`, 태그는 OTT

표 레이아웃과 후보 카드 배치는 화면에서만 확인됩니다.

## 에이전트·터미널에서 API만 확인

화면을 누르지 않고 등록 후속·목록 줄바꿈만 보려면, 로컬에서만 비밀번호를 넘깁니다. **커밋하지 마세요.**

```bash
TESTER_EMAIL=tester@subly.app TESTER_PASSWORD='…' node scripts/verify-assistant-turn.mjs
```

루트 `.env`에 `TESTER_EMAIL` / `TESTER_PASSWORD`를 넣어도 됩니다. 스크립트는 세션을 초기화한 뒤 `목록`, `그중에서 제일 비싼`, `홍티비 등록` → `3만원`, `홍티비 30000`을 호출합니다.

## Google 로그인 설정

앱과 웹 모두 **브라우저 OAuth**로 Google에 로그인합니다. Client ID·Secret은 앱 `.env`에 넣지 않고, **Supabase Dashboard**에만 넣습니다.

공식 절차는 [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)과 같습니다.

### 1. Google Cloud에서 Client ID / Client Secret 발급

1. [Google Cloud Console](https://console.cloud.google.com/home/dashboard)에서 프로젝트를 만들거나 고릅니다.
2. [Google Auth Platform](https://console.cloud.google.com/auth/overview)을 엽니다. 처음이면 Get started로 앱 이름, 지원 이메일, 개발자 연락처를 넣습니다.
3. **Audience**에서 테스트 사용자를 넣습니다. External이면 앱이 검증되기 전에 여기 등록된 Google 계정만 로그인됩니다.
4. **Data Access (Scopes)**에 아래가 있는지 확인합니다.
   - `openid` (직접 추가)
   - `.../auth/userinfo.email` (기본)
   - `.../auth/userinfo.profile` (기본)
5. **Clients**에서 [Create client](https://console.cloud.google.com/auth/clients/create) → 애플리케이션 유형 **Web application**.
6. **Authorized JavaScript origins**
   - 로컬 웹: `http://localhost:5174`
   - 배포 웹: `https://<your-netlify-domain>`
7. **Authorized redirect URIs**에는 Google이 아니라 **Supabase 콜백**을 넣습니다.
   - 이 프로젝트: `https://ikbogbhugowdvrcxggax.supabase.co/auth/v1/callback`
   - 대시보드에서 확인: [Authentication > Providers > Google](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/providers?provider=Google)
8. Create 후 **Client ID**와 **Client Secret**을 저장합니다. Secret은 다시 볼 수 없으니 놓치면 재발급합니다.

iOS/Android용 Client ID는 지금 흐름(브라우저 OAuth)에는 필요 없습니다. 나중에 네이티브 Google 버튼을 쓸 때만 추가로 만듭니다. 그때는 Web Client ID를 맨 앞에 두고 쉼표로 이어 붙입니다.

### 2. Supabase에 붙이기

1. [Authentication > Providers > Google](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/providers?provider=Google)에서 Enable Sign in with Google.
2. **Client IDs**에 Web Client ID를 넣습니다.
3. **Client Secret (for OAuth)**에 Web Client Secret을 넣습니다.
4. Save.

### 3. Redirect URLs

[Authentication > URL Configuration](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/url-configuration) **Redirect URLs**에 아래를 추가합니다.

| URL | 용도 |
|---|---|
| `http://localhost:5174/**` | 로컬 웹 대시보드 |
| `https://<your-netlify-domain>/**` | 배포 웹 |
| `subly://auth/callback` | 앱 개발/스토어 빌드 |
| `exp://**` | Expo Go |

Site URL은 배포 웹 주소로 두는 것이 좋습니다.

### 4. 확인

- 웹: http://localhost:5174 에서 **Google로 시작하기**
- 앱: 온보딩의 **Google로 시작하기** → 시스템 브라우저에서 Google 동의 → 앱으로 복귀

동의 화면에 `ikbogbhugowdvrcxggax.supabase.co`가 보이면 정상입니다. 서비스 이름으로 바꾸려면 Google Auth Platform **Branding**과 Supabase [커스텀 도메인](https://supabase.com/docs/guides/platform/custom-domains)을 설정합니다.

## 이메일 인증번호 (Gmail SMTP)

앱·웹 이메일 가입은 **6자리 숫자**를 받은 뒤에 완료됩니다. 발송은 클라이언트가 아니라 **Supabase Auth**가 합니다. 자릿수는 6자리로 고정입니다. Gmail 비밀번호·앱 비밀번호는 `.env`나 앱 코드에 넣지 않습니다.

공식 절차는 [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)와 [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)와 같습니다.

### 1. Confirm email 켜기

1. [Authentication > Providers > Email](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/providers)에서 Email을 켭니다.
2. **Confirm email**을 ON으로 둡니다. 꺼져 있으면 `signUp`이 바로 세션을 주고 메일은 가지 않습니다.
3. **Email OTP length**를 `6`으로 설정합니다. 앱·웹 입력 제한과 실제 발급 번호의 길이가 같아야 합니다.

### 2. Gmail SMTP 연결

Gmail은 일반 비밀번호를 SMTP에 받지 않습니다. 2단계 인증을 켠 뒤 [앱 비밀번호](https://support.google.com/accounts/answer/185833)를 만듭니다. 16자이며 **띄어쓰기 없이** 넣습니다.

[Project Settings > Authentication](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/settings/auth)에서 **Enable Custom SMTP** 후:

| 항목 | 값 |
|---|---|
| Sender email | 발신에 쓸 Gmail 주소 |
| Sender name | `subly` |
| Host | `smtp.gmail.com` |
| Port | `465` (SSL) |
| Username | 같은 Gmail 주소 |
| Password | 앱 비밀번호 (띄어쓰기 없음) |

가입 메일이 안 오면 SMTP 설정과 Gmail 앱 비밀번호를 먼저 확인합니다. 기본 발송 한도에 걸렸을 때도 같은 증상이 납니다.

### 3. Confirm signup 템플릿에 `{{ .Token }}`

[Authentication > Email Templates > Confirm signup](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/templates)에 **인증번호(`{{ .Token }}`)**를 넣습니다. 이 프로젝트는 6자리입니다. 매직 링크(`{{ .ConfirmationURL }}`)만 보내면 앱·웹의 인증번호 칸과 맞지 않습니다.

예시:

```html
<h2>subly 이메일 인증</h2>
<p>아래 인증번호를 앱 또는 웹에 입력하세요.</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: 700;">{{ .Token }}</p>
<p>인증번호는 잠시 후 만료됩니다.</p>
```

`{{ .Token }}`은 Supabase가 넣는 6자리 숫자입니다. 클라이언트가 만든 코드가 아닙니다.

### 3-b. Recovery 템플릿에도 `{{ .Token }}`

비밀번호 찾기는 **Reset password** 템플릿을 씁니다. [Authentication > Email Templates > Reset password](https://supabase.com/dashboard/project/ikbogbhugowdvrcxggax/auth/templates)에도 6자리 코드를 넣습니다. 매직 링크만 보내면 앱·웹 인증번호 칸과 맞지 않습니다.

```html
<h2>subly 비밀번호 찾기</h2>
<p>아래 인증번호를 앱 또는 웹에 입력하세요.</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: 700;">{{ .Token }}</p>
<p>인증번호는 잠시 후 만료됩니다.</p>
```

제목 예: `subly 인증번호`

### 4. 확인

1. 앱 온보딩 또는 웹 **가입하기**에서 이름·이메일·비밀번호를 넣고 인증번호를 요청합니다.
2. 발신 Gmail 받은편지함/스팸에서 6자리 숫자를 확인합니다.
3. 코드를 입력하면 세션이 생기고 홈/대시보드로 갑니다.
4. 잘못된 코드, **인증번호 다시 받기**, 이미 있는 계정의 로그인이 그대로인지도 봅니다.

## 환경 변수

| 위치 | 이름 |
|---|---|
| 앱 `.env` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| 웹 `web/.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| 선택, 루트 `.env` (로컬만) | `TESTER_EMAIL`, `TESTER_PASSWORD` |
