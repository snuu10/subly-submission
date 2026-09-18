-- 공용 curated 해지 가이드(사람 검수만 write)와 사용자 스코프 임시 결과.
-- AI 생성 결과를 여러 사용자에게 재사용하는 경로는 만들지 않는다.

create table public.cancellation_guides_curated (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  service_name text not null,
  country text not null default 'KR',
  billing_channel text not null
    check (billing_channel in ('direct_web', 'apple_app_store', 'google_play', 'carrier', 'unknown')),
  platform text not null
    check (platform in ('ios', 'android', 'web')),
  steps jsonb not null default '[]'::jsonb,
  refund_policy text,
  warnings jsonb not null default '[]'::jsonb,
  official_support_url text,
  status text not null default 'verified'
    check (status in ('verified', 'expired')),
  verified_by text,
  verified_at timestamptz,
  expires_at timestamptz,
  change_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index cancellation_guides_curated_lookup_idx
  on public.cancellation_guides_curated (service_id, country, billing_channel, platform);

alter table public.cancellation_guides_curated enable row level security;

-- 인증 사용자는 읽기만. insert/update/delete 정책 없음 → Studio/서비스 롤만 기록.
create policy "curated_select_authenticated"
  on public.cancellation_guides_curated
  for select
  to authenticated
  using (true);

create table public.cancellation_requests_user (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_query text not null,
  service_id text,
  country text not null default 'KR',
  billing_channel text
    check (billing_channel is null or billing_channel in ('direct_web', 'apple_app_store', 'google_play', 'carrier', 'unknown')),
  platform text
    check (platform is null or platform in ('ios', 'android', 'web')),
  payload jsonb not null default '{}'::jsonb,
  status text not null
    check (status in ('generated', 'review_needed', 'expired')),
  created_at timestamptz not null default now()
);

create index cancellation_requests_user_user_created_idx
  on public.cancellation_requests_user (user_id, created_at desc);

alter table public.cancellation_requests_user enable row level security;

create policy "own_select" on public.cancellation_requests_user
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.cancellation_requests_user
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.cancellation_requests_user
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.cancellation_requests_user
  for delete using ((select auth.uid()) = user_id);
