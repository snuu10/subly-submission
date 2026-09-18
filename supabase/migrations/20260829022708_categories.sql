-- 유저별 카테고리 테이블. 기존 subscriptions.category(text check) 대체용.
--
-- 시스템 카테고리는 유저마다 7개 row로 복제된다. 전역 테이블 + 유저별 숨김 테이블로
-- 나누면 조회마다 조인과 anti-join이 붙는데, 유저당 7행은 그 복잡도를 감당할 만큼
-- 크지 않다. 이름 변경/숨김도 같은 테이블 update로 끝난다.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text check (key in
    ('entertainment','music','work','health','education','cloud','etc')),
  name text not null,
  color text not null,
  emoji text,
  is_system boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- 커스텀은 key가 없고 시스템은 반드시 key가 있다. 두 RPC 가드의 전제를 스키마가 보장한다.
  constraint categories_system_key_ck
    check ((is_system and key is not null) or (not is_system and key is null)),
  -- 기타는 RPC를 우회한 직접 update로도 숨길 수 없다. key가 null이면 검사는 통과한다.
  constraint categories_etc_visible_ck
    check (not (is_hidden and key = 'etc'))
);

alter table public.categories enable row level security;

-- 시스템 카테고리 중복 시딩 방지. 커스텀(key is null)에는 적용되지 않는 부분 인덱스.
create unique index categories_user_key_idx
  on public.categories (user_id, key) where key is not null;
create index categories_user_idx on public.categories (user_id);

-- UPDATE는 SELECT 정책 없이는 조용히 0행을 반환하므로 4개 동작을 각각 정의한다.
create policy "own_select" on public.categories
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.categories
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.categories
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- 시스템 카테고리는 RPC를 우회한 직접 delete도 막는다. delete_custom_category는 invoker라
-- 커스텀에는 그대로 동작하고, 계정 삭제 시 auth.users cascade는 RLS를 거치지 않으므로 영향 없다.
create policy "own_delete" on public.categories
  for delete using ((select auth.uid()) = user_id and not is_system);

-- 시딩 정의를 RPC와 백필이 공유한다. 값은 constants/categories.ts, constants/Colors.ts와 동일.
create or replace function public.system_category_seed()
returns table (key text, name text, color text)
language sql
immutable
as $$
  values
    ('entertainment'::text, '엔터테인먼트'::text, '#E11D48'::text),
    ('music',    '음악',       '#7C3AED'),
    ('work',     '업무',       '#2563EB'),
    ('health',   '건강',       '#059669'),
    ('education','교육',       '#D97706'),
    ('cloud',    '클라우드',   '#0891B2'),
    ('etc',      '기타',       '#6B7280')
$$;

-- 세션이 생기는 시점(로그인·가입 직후)마다 호출한다. 멱등이므로 반복 호출은 무해하다.
create or replace function public.ensure_default_categories()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;

  insert into public.categories (user_id, key, name, color, is_system, is_hidden)
  select uid, s.key, s.name, s.color, true, false
  from public.system_category_seed() s
  on conflict (user_id, key) where key is not null do nothing;
end;
$$;

-- 기존 유저 백필. 0002의 category_id 매핑이 이 결과에 의존한다.
insert into public.categories (user_id, key, name, color, is_system, is_hidden)
select u.id, s.key, s.name, s.color, true, false
from auth.users u
cross join public.system_category_seed() s
on conflict (user_id, key) where key is not null do nothing;
