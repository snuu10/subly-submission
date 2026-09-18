-- 주간 다이제스트·미사용 리마인드 주 1회 캐시. 본인 행만 읽기/쓰기.

create table public.ai_briefings (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('weekly_digest', 'unused_nudge')),
  week_start date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, week_start)
);

alter table public.ai_briefings enable row level security;

create policy "own_select" on public.ai_briefings
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.ai_briefings
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.ai_briefings
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.ai_briefings
  for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ai_briefings to authenticated;
grant all on public.ai_briefings to service_role;
