-- 배포될 때마다 웹에 남기는 공지사항(업데이트 로그). 내용은 DB에 직접 입력한다(작성 UI 없음).
-- 계정별 마지막 확인 시각을 저장해, "최근 7일 이내 발행 + 아직 안 읽음" 기준으로 배지 카운트를 낸다.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  tag text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

create policy "authenticated_select" on public.announcements
  for select to authenticated
  using (true);

grant select on table public.announcements to authenticated;

create table public.announcement_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now()
);

alter table public.announcement_reads enable row level security;

create policy "own_select" on public.announcement_reads
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own_insert" on public.announcement_reads
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "own_update" on public.announcement_reads
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.announcement_reads to authenticated;
