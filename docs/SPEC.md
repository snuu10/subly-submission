# 프로젝트: subly (자취생·라이트유저를 위한 구독 지출 관리 앱)

계좌·카드 연동(마이데이터) 없이 수동 등록만으로 동작하는 초경량 구독 관리 앱. 구독 5~15개를 보유한 20~30대 라이트 유저를 타깃으로, 결제일 알림과 지출 시각화, 미사용 구독 리마인드를 제공한다.

> 상태 표기: `[완료]` 현재 코드에 구현됨 / `[진행예정]` 설계만 되어 있고 코드는 아직 없음

---

## 1. 기술 스택 & 환경 설정

**Frontend**
- React Native (Expo SDK 57), TypeScript
- Expo Router (파일 기반 라우팅)
- Zustand (전역 상태관리 — 인증 세션 / 구독 데이터)
- React Native 기본 컴포넌트 + StyleSheet (별도 UI 라이브러리 없음), `expo-symbols`로 아이콘 처리
- `react-native-web`으로 웹 정적 빌드 지원(선택)

**Backend & DB**
- Supabase
  - Auth: 이메일/비밀번호(가입 시 6자리 숫자 인증) + 카카오·구글 소셜 로그인 `[완료]`
  - PostgreSQL: 구독 데이터 영속화 `[진행예정]` (현재는 로컬 zustand 메모리에만 존재)
  - Storage: 영수증/결제화면 캡처 이미지 저장용 `[완료: receipts 버킷]`

**AI**
- Anthropic Claude API (`claude-sonnet-4-6`, Edge Function `claude-proxy`) `[완료: 프록시 / 진행예정: ANTHROPIC_API_KEY 시크릿]`
  - 영수증·결제 완료 화면 캡처 이미지에서 구독 정보(JSON) 추출 (OCR)
  - 대화형 챗봇을 통한 구독 정보 입력
  - 클라이언트(RN 앱)에 API 키를 직접 넣을 수 없으므로, **Supabase Edge Functions**를 프록시로 경유해 호출 (Netlify Functions의 Expo/Supabase 버전에 해당). 이미 Supabase를 백엔드로 쓰고 있어 별도 플랫폼(AWS Lambda 등) 추가 없이 통합 가능.

**형상관리 & 배포**
- GitHub: `snuu10/subly` 프라이빗 저장소 연동 완료 `[완료]` (`.gitignore`에 `.env`, `node_modules/`, `/ios`, `/android` 등 이미 반영)
- EAS(Expo Application Services): 네이티브 빌드·배포용 `[진행예정]` — Netlify CI/CD에 해당하는 역할
- (선택) 웹 배포: `npx expo export -p web` 정적 산출물을 Netlify/Vercel에 배포 가능

**환경 변수**
| 용도 | 변수명 | 위치 |
|---|---|---|
| 클라이언트(Expo) | `EXPO_PUBLIC_SUPABASE_URL` | `.env` (이미 존재) |
| 클라이언트(Expo) | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` (이미 존재) |
| 서버(Supabase Edge Function) | `ANTHROPIC_API_KEY` | `supabase secrets set` (클라이언트 비노출) |
| 서버(Supabase Auth 설정) | 카카오 REST API 키 / Client Secret | Supabase 대시보드 Authentication > Providers |
| 서버(Supabase Auth 설정) | 구글 OAuth Client ID / Secret | Supabase 대시보드 Authentication > Providers |

---

## 2. 주요 기능 명세

**① 사용자 인증 (Supabase Auth)** `[완료]`
- 이메일/비밀번호 회원가입(6자리 숫자 확인 후 완료)·로그인·로그아웃. 아이디 찾기(이름→마스킹 이메일), 비밀번호 찾기, 설정에서 비밀번호 변경. 보안 질문 없음.
- 카카오/구글 소셜 로그인 (OAuth PKCE + 딥링크)
- 로그인 세션 유무로 온보딩/홈 화면 라우팅 가드
- (진행예정) DB 연동 시 RLS로 "로그인한 유저만 본인 구독 데이터 접근" 강제

**② 구독 수동 등록 & 관리** `[완료: 로컬 상태 / 진행예정: DB 저장]`
- 서비스명·금액·결제주기(월간/연간)·카테고리·결제일 입력
- 자주 쓰는 서비스 18종 아이콘 프리셋에서 선택 시 이름/카테고리 자동 채움
- 등록된 구독 수정·삭제 (`app/subscription/[id].tsx`)

**③ 냉장고(영수증) 사진 기반 구독 자동 인식 — Claude API OCR** `[완료]`
- 결제 완료 화면 캡처 또는 영수증 사진 업로드 → Supabase Storage 저장
- 이미지를 Claude API(Edge Function 경유)로 전달해 서비스명/금액/결제주기/결제일을 JSON으로 추출
- 인식 결과를 화면에 보여주고 사용자가 수동으로 추가/수정/삭제 후 저장

**④ 대화형 챗봇 기반 구독 등록 — Claude API** `[완료]`
- 자연어 대화로 "넷플릭스 만 칠천원 매달 15일에 나가" 같은 입력을 구조화된 구독 데이터로 변환(Structured Output/Tool Use)

**⑤ 홈 대시보드** `[완료]`
- 월평균 구독 지출액 / 등록된 결제 일정 기준 이번 달·다음 달 예상 지출액 — [docs/rules/spend-metrics.md](rules/spend-metrics.md)
- 다가오는 결제 리스트 + D-day 배지

**⑥ 결제일 D-3 / D-1 푸시 알림** `[진행예정, 스텁만 존재]`
- `expo-notifications`로 로컬 알림 스케줄링 (`lib/notifications.ts`는 현재 경고 로그만 출력)

**⑦ 카테고리별 지출 차트** `[진행예정]`
- 통계 탭에 카테고리별 지출 비중 도넛 차트 (현재는 안내 문구만 있는 플레이스홀더)

**⑧ 미사용 구독 리마인드** `[진행예정]`
- `last_checked_at` 필드는 이미 데이터 모델에 존재하나, 갱신·조회 로직 미구현
- 일정 기간 확인 안 한 구독에 "이거 아직 써요?" 리마인드 배지 표시 예정

---

## 3. UI/UX 요구사항

- 모바일 화면 우선 (React Native 네이티브 앱이므로 기본 전제), 라이트/다크 테마 자동 대응 `[완료]`
- AI 분석(OCR, 레시피/메뉴 추천에 해당하는 챗봇 응답) 대기 중 로딩 인디케이터 또는 스켈레톤 UI 표시 `[완료]`
- 카카오 브랜드 컬러(#FEE500) 등 소셜 로그인 버튼은 각 플랫폼 가이드라인 색상 준수 `[완료]`

### 폴더 구조 (현재 + 신규 예정)

```
subly/
├─ app/
│  ├─ _layout.tsx              # 루트 레이아웃, 세션/폰트/온보딩 초기화
│  ├─ index.tsx                 # 세션 유무 기반 리다이렉트
│  ├─ (onboarding)/
│  │  ├─ _layout.tsx
│  │  └─ index.tsx              # 카카오/구글 로그인 진입 화면
│  ├─ (tabs)/
│  │  ├─ _layout.tsx
│  │  ├─ home.tsx                # 대시보드
│  │  ├─ add-subscription.tsx    # 구독 추가
│  │  ├─ stats.tsx                # 통계(플레이스홀더)
│  │  └─ settings.tsx             # 계정/로그아웃/카테고리 관리 진입
│  ├─ chat.tsx                  # AI 비서 전체 화면
│  ├─ receipt/                  # 영수증 촬영·분석·확인
│  ├─ categories.tsx             # 카테고리 관리 (숨김 토글/커스텀 추가·삭제)
│  └─ subscription/
│     └─ [id].tsx                # 구독 상세/수정/삭제
├─ components/
│  ├─ OptionChips.tsx
│  └─ ServiceIcon.tsx
├─ constants/
│  ├─ billing.ts / categories.ts / colors.ts
│  └─ services.ts                # 서비스 아이콘 프리셋 18종
├─ lib/
│  ├─ supabase.ts                 # Supabase 클라이언트 (PKCE)
│  ├─ oauth.ts                    # 카카오/구글 소셜 로그인
│  ├─ auth.ts                     # 이메일/비밀번호 인증
│  └─ notifications.ts            # 푸시 알림 (스텁)
├─ stores/
│  ├─ auth-store.ts
│  ├─ category-store.ts           # 유저별 카테고리 (시딩/숨김/커스텀)
│  └─ subscription-store.ts
├─ types/
│  ├─ category.ts
│  └─ subscription.ts
├─ images/                        # 서비스 아이콘 PNG
├─ supabase/
│  ├─ migrations/                 # DB 스키마 마이그레이션
│  └─ functions/                  # Edge Functions
│     └─ claude-proxy/            # Claude API 프록시 `[완료]`
├─ app.json / package.json / tsconfig.json
```

### DB 테이블 스키마 (SQL)

마이그레이션 파일은 `supabase/migrations/`에 순서대로 있고, 원격 DB에도 적용 완료다.

| 파일 | 내용 |
| --- | --- |
| `0001_categories.sql` | `categories` 테이블 + RLS + 시딩 함수 + 기존 유저 백필 |
| `0002_subscriptions_category_id.sql` | `subscriptions.category`(text) → `category_id`(uuid fk) 교체 |
| `0003_category_rpc.sql` | `hide_category`, `delete_custom_category` |
| `0004_subscription_account_id.sql` | `subscriptions.account_id` 추가 |
| `0005_system_category_seed_search_path.sql` | `system_category_seed()` search_path 고정 |
| `0006_category_customize.sql` | 이름 유니크, 시딩 1회, 6개 삭제 허용, 기타 제외 최소 1개 |

`anchor_date`(최초 결제일)가 결제 주기의 유일한 진실이고 `next_payment_date`는
`anchor_date` + `billing_cycle`로 계산되는 파생 캐시다. 서버 푸시가
`where next_payment_date between current_date and current_date + 3`로 조회해야 하므로
컬럼으로 유지하고, 앱이 조회·저장 시점에 재계산해 어긋난 행만 갱신한다.

카테고리는 전역 테이블 대신 유저별 row 복제 방식이다. 최초 로그인(카테고리 0개)에만
시스템 7개를 시딩하고, 이후 `ensure_default_categories`는 기타가 없을 때만 기타를 보정한다.
삭제한 기본 카테고리(음악 등)는 다시 생기지 않는다.

기타(`key = 'etc'`)만 잠근다. 나머지 6개는 이름 변경·숨김·삭제가 가능하다. 이름은
`(user_id, name)` 유니크라 숨긴 카테고리도 같은 이름을 점유한다. 기타를 제외한 카테고리는
최소 1개가 있어야 하며, 마지막 1개 삭제는 RPC와 트리거가 거부한다.

```sql
-- 유저별 카테고리
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text check (key in
    ('entertainment','music','work','health','education','cloud','etc')),
  name text not null,
  color text not null,
  emoji text,                  -- 현재 UI에서 렌더링하지 않음. 향후 직접 선택용
  is_system boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- 커스텀은 key가 없고 시스템은 반드시 key가 있다. 두 RPC 가드의 전제를 스키마가 보장한다.
  constraint categories_system_key_ck
    check ((is_system and key is not null) or (not is_system and key is null)),
  -- 기타는 RPC를 우회한 직접 update로도 숨길 수 없다.
  constraint categories_etc_visible_ck
    check (not (is_hidden and key = 'etc'))
);

alter table public.categories enable row level security;

create unique index categories_user_key_idx
  on public.categories (user_id, key) where key is not null;
create unique index categories_user_name_idx
  on public.categories (user_id, name);
create index categories_user_idx on public.categories (user_id);

create policy "own_select" on public.categories
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.categories
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.categories
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- 기타만 직접 delete를 막는다. 나머지 6개 시스템과 커스텀은 삭제 가능.
create policy "own_delete" on public.categories
  for delete using ((select auth.uid()) = user_id and key is distinct from 'etc');

-- 구독 정보
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount integer not null check (amount > 0),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly','one_time')),
  -- FK는 NO ACTION(기본). 계정 삭제 시 categories와 subscriptions가 같은 문장에서
  -- 함께 cascade될 때 무결성 검사가 문장 끝에 수행되어야 삭제가 막히지 않는다.
  category_id uuid not null references public.categories(id),
  anchor_date date not null,
  next_payment_date date not null,
  preset_id text,
  is_active boolean not null default true,
  memo text,
  emoji text,
  account_id text,             -- 가입 계정(이메일/아이디). 비밀번호는 저장하지 않는다
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz
);

alter table public.subscriptions enable row level security;

create index subscriptions_user_next_payment_idx
  on public.subscriptions (user_id, next_payment_date);
create index subscriptions_user_category_idx
  on public.subscriptions (user_id, category_id);

-- UPDATE는 SELECT 정책 없이는 조용히 0행을 반환하므로 4개 동작을 각각 정의한다.
create policy "own_select" on public.subscriptions
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.subscriptions
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.subscriptions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.subscriptions
  for delete using ((select auth.uid()) = user_id);

-- 영수증/결제화면 OCR 업로드 기록
create table public.receipt_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  parsed_result jsonb,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.receipt_uploads enable row level security;

create policy "Users manage own receipts"
  on public.receipt_uploads
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Storage 버킷은 `receipts`(private)로 만들고, 경로를 `user_id/파일명` 형태로 강제한 뒤 아래와 같은 정책으로 본인 폴더만 접근하도록 제한한다.

```sql
create policy "Users access own receipt files"
  on storage.objects
  for all
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
```

### 카테고리 RPC

세 함수 모두 `security invoker`라 RLS가 그대로 적용된다.

| 함수 | 역할 |
| --- | --- |
| `ensure_default_categories()` | 카테고리가 0개일 때만 시스템 7개 시딩. 그 외에는 기타만 없으면 기타 insert |
| `hide_category(p_category_id)` | 시스템 카테고리 전용. 구독을 '기타'로 재배정 + `is_hidden = true` |
| `delete_custom_category(p_category_id)` | 기타가 아닌 카테고리 삭제. 구독을 '기타'로 재배정 + row 삭제. 마지막 non-etc면 거부 |

숨김과 삭제는 "구독 재배정 + 카테고리 상태 변경"이 한 몸이어야 한다. 클라이언트에서 두 번
호출하면 중간 실패 시 카테고리는 사라졌는데 구독이 그 id를 가리키는 상태가 되므로, 함수
본문(= 하나의 트랜잭션)으로 원자성을 확보한다.

역할 분담 가드:

- 숨김은 시스템 전용 (`not is_system`이면 에러). 삭제는 기타만 불가 (`key = 'etc'`이면 에러)
- 기타는 이름 변경·숨김·삭제 불가. RPC, CHECK, UPDATE 트리거로 이중 차단
- 기타를 제외한 카테고리는 최소 1개. 삭제 RPC와 BEFORE DELETE 트리거가 같은 문구로 거부한다
- 숨김을 해제해도 이미 '기타'로 옮겨진 구독은 복원되지 않는다. 의도된 동작이므로 실행 직전
  확인 다이얼로그에서 영향받는 구독 개수와 함께 안내한다

### 배포 설정 가이드 (Netlify → Expo/EAS 대응)

1. **GitHub 연동** — 이미 완료. `main` 브랜치에 push하면 이후 EAS Build 트리거의 소스가 됨.
2. **EAS 프로젝트 초기화**
   ```
   npm install -g eas-cli
   eas login
   eas build:configure
   ```
3. **환경 변수 등록 (EAS Secrets)**
   ```
   eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value <값>
   eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <값>
   ```
4. **Claude API 프록시용 Supabase Edge Function 배포**
   ```
   supabase functions deploy claude-proxy --project-ref <project-ref>
   supabase secrets set ANTHROPIC_API_KEY=<값>
   ```
5. **빌드/배포**
   ```
   eas build --platform android --profile preview   # 테스트용 APK
   eas build --platform all --profile production     # 스토어 제출용
   eas submit
   ```
6. **(선택) 웹 버전 배포** — `react-native-web`이 이미 설정되어 있으므로 필요 시:
   ```
   npx expo export -p web
   ```
   산출물(`dist/`)을 Netlify/Vercel에 정적 배포.
