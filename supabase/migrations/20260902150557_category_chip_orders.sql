-- 구독 목록 칩 순서. 앱·웹이 계정 단위로 따로 저장한다. 기기 로컬이 아니라서
-- 다른 폰/PC에서도 유지되고, 두 표면의 순서는 서로 덮어쓰지 않는다.
-- 전체(합성 필터)와 기타(key = etc)는 배열에 넣지 않는다.

create table public.category_chip_orders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_ids uuid[] not null default '{}',
  web_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.category_chip_orders enable row level security;

create policy "own_select" on public.category_chip_orders
  for select using ((select auth.uid()) = user_id);

create or replace function public.get_my_category_chip_order()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.category_chip_orders;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'app_ids', '[]'::jsonb,
      'web_ids', '[]'::jsonb,
      'message', '로그인이 필요합니다.'
    );
  end if;

  select * into v_row
  from public.category_chip_orders
  where user_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'app_ids', coalesce(pg_catalog.to_jsonb(v_row.app_ids), '[]'::jsonb),
    'web_ids', coalesce(pg_catalog.to_jsonb(v_row.web_ids), '[]'::jsonb),
    'message', ''
  );
end;
$$;

create or replace function public.reorder_category_chips(
  p_surface text,
  p_ordered_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := coalesce(p_ordered_ids, '{}');
  v_count integer;
  v_unique integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'app_ids', '[]'::jsonb,
      'web_ids', '[]'::jsonb,
      'message', '로그인이 필요합니다.'
    );
  end if;

  if p_surface is distinct from 'app' and p_surface is distinct from 'web' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_surface',
      'app_ids', '[]'::jsonb,
      'web_ids', '[]'::jsonb,
      'message', '앱 또는 웹 순서를 지정해 주세요.'
    );
  end if;

  select count(distinct ids.id), count(*)
  into v_unique, v_count
  from pg_catalog.unnest(v_ids) as ids(id);

  if v_count <> v_unique then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_ids',
      'app_ids', '[]'::jsonb,
      'web_ids', '[]'::jsonb,
      'message', '카테고리 순서가 올바르지 않습니다.'
    );
  end if;

  select count(*) into v_count
  from public.categories
  where user_id = v_uid
    and id = any(v_ids)
    and key is distinct from 'etc';

  if v_count <> pg_catalog.cardinality(v_ids) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_ids',
      'app_ids', '[]'::jsonb,
      'web_ids', '[]'::jsonb,
      'message', '카테고리 순서가 올바르지 않습니다.'
    );
  end if;

  insert into public.category_chip_orders (user_id, app_ids, web_ids)
  values (
    v_uid,
    case when p_surface = 'app' then v_ids else '{}'::uuid[] end,
    case when p_surface = 'web' then v_ids else '{}'::uuid[] end
  )
  on conflict (user_id) do update
  set
    app_ids = case
      when p_surface = 'app' then excluded.app_ids
      else public.category_chip_orders.app_ids
    end,
    web_ids = case
      when p_surface = 'web' then excluded.web_ids
      else public.category_chip_orders.web_ids
    end,
    updated_at = now();

  return public.get_my_category_chip_order();
end;
$$;

revoke all on function public.get_my_category_chip_order() from public, anon;
grant execute on function public.get_my_category_chip_order() to authenticated;

revoke all on function public.reorder_category_chips(text, uuid[]) from public, anon;
grant execute on function public.reorder_category_chips(text, uuid[]) to authenticated;
