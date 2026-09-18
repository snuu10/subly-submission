-- 웹 대시보드 위젯 배치와 표시 여부를 계정 단위로 저장한다.
-- order_ids에는 숨긴 위젯도 유지해 다시 표시할 때 기존 위치 문맥을 복구한다.

create table public.dashboard_widget_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  order_ids text[] not null default array[
    'insights',
    'briefing',
    'category',
    'spend',
    'upcoming',
    'mix',
    'subscriptions',
    'payment-instruments'
  ]::text[],
  hidden_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint dashboard_widget_order_valid check (
    pg_catalog.cardinality(order_ids) = 8
    and order_ids @> array[
      'insights', 'briefing', 'category', 'spend', 'upcoming', 'mix',
      'subscriptions', 'payment-instruments'
    ]::text[]
    and order_ids <@ array[
      'insights', 'briefing', 'category', 'spend', 'upcoming', 'mix',
      'subscriptions', 'payment-instruments'
    ]::text[]
  ),
  constraint dashboard_widget_hidden_valid check (
    hidden_ids <@ array[
      'insights', 'briefing', 'category', 'spend', 'upcoming', 'mix',
      'subscriptions', 'payment-instruments'
    ]::text[]
  )
);

alter table public.dashboard_widget_preferences enable row level security;

create policy "own_select" on public.dashboard_widget_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own_insert" on public.dashboard_widget_preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "own_update" on public.dashboard_widget_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.dashboard_widget_preferences to authenticated;

create or replace function public.get_my_dashboard_widget_preferences()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[];
  v_hidden text[];
  v_default text[] := array[
    'insights',
    'briefing',
    'category',
    'spend',
    'upcoming',
    'mix',
    'subscriptions',
    'payment-instruments'
  ]::text[];
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'order_ids', pg_catalog.to_jsonb(v_default),
      'hidden_ids', '[]'::jsonb,
      'message', '로그인이 필요합니다.'
    );
  end if;

  select order_ids, hidden_ids
  into v_order, v_hidden
  from public.dashboard_widget_preferences
  where user_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'order_ids', coalesce(pg_catalog.to_jsonb(v_order), pg_catalog.to_jsonb(v_default)),
    'hidden_ids', coalesce(pg_catalog.to_jsonb(v_hidden), '[]'::jsonb),
    'message', ''
  );
end;
$$;

create or replace function public.save_my_dashboard_widget_preferences(
  p_order_ids text[],
  p_hidden_ids text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[] := coalesce(p_order_ids, '{}'::text[]);
  v_hidden text[] := coalesce(p_hidden_ids, '{}'::text[]);
  v_allowed text[] := array[
    'insights',
    'briefing',
    'category',
    'spend',
    'upcoming',
    'mix',
    'subscriptions',
    'payment-instruments'
  ]::text[];
  v_count integer;
  v_unique integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'order_ids', pg_catalog.to_jsonb(v_allowed),
      'hidden_ids', '[]'::jsonb,
      'message', '로그인이 필요합니다.'
    );
  end if;

  select count(*), count(distinct id)
  into v_count, v_unique
  from pg_catalog.unnest(v_order) as ids(id);

  if v_count <> pg_catalog.cardinality(v_allowed)
    or v_unique <> v_count
    or not (v_order <@ v_allowed)
    or not (v_allowed <@ v_order) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_order',
      'order_ids', pg_catalog.to_jsonb(v_allowed),
      'hidden_ids', '[]'::jsonb,
      'message', '위젯 순서가 올바르지 않습니다.'
    );
  end if;

  select count(*), count(distinct id)
  into v_count, v_unique
  from pg_catalog.unnest(v_hidden) as ids(id);

  if v_unique <> v_count or not (v_hidden <@ v_allowed) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_hidden',
      'order_ids', pg_catalog.to_jsonb(v_order),
      'hidden_ids', '[]'::jsonb,
      'message', '위젯 표시 설정이 올바르지 않습니다.'
    );
  end if;

  insert into public.dashboard_widget_preferences (user_id, order_ids, hidden_ids)
  values (v_uid, v_order, v_hidden)
  on conflict (user_id) do update
  set
    order_ids = excluded.order_ids,
    hidden_ids = excluded.hidden_ids,
    updated_at = now();

  return public.get_my_dashboard_widget_preferences();
end;
$$;

revoke all on function public.get_my_dashboard_widget_preferences() from public, anon;
grant execute on function public.get_my_dashboard_widget_preferences() to authenticated;

revoke all on function public.save_my_dashboard_widget_preferences(text[], text[]) from public, anon;
grant execute on function public.save_my_dashboard_widget_preferences(text[], text[]) to authenticated;
