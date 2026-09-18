-- 인사이트·AI 비서·카테고리·월평균 구독 지출액은 기본 위젯으로 고정한다.
-- 나머지 네 위젯만 삭제(숨김)할 수 있으며 신규 사용자의 기본 화면에서는 숨긴다.

alter table public.dashboard_widget_preferences
  drop constraint if exists dashboard_widget_hidden_valid;

update public.dashboard_widget_preferences
set hidden_ids = array(
  select hidden.id
  from pg_catalog.unnest(hidden_ids) with ordinality as hidden(id, position)
  where hidden.id = any (
    array['upcoming', 'mix', 'subscriptions', 'payment-instruments']::text[]
  )
  order by hidden.position
);

alter table public.dashboard_widget_preferences
  alter column hidden_ids set default array[
    'upcoming', 'mix', 'subscriptions', 'payment-instruments'
  ]::text[],
  add constraint dashboard_widget_hidden_valid check (
    hidden_ids <@ array[
      'upcoming', 'mix', 'subscriptions', 'payment-instruments'
    ]::text[]
  );

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
  v_default_order text[] := array[
    'insights',
    'briefing',
    'category',
    'spend',
    'upcoming',
    'mix',
    'subscriptions',
    'payment-instruments'
  ]::text[];
  v_default_hidden text[] := array[
    'upcoming', 'mix', 'subscriptions', 'payment-instruments'
  ]::text[];
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'order_ids', pg_catalog.to_jsonb(v_default_order),
      'hidden_ids', pg_catalog.to_jsonb(v_default_hidden),
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
    'order_ids', coalesce(pg_catalog.to_jsonb(v_order), pg_catalog.to_jsonb(v_default_order)),
    'hidden_ids', coalesce(pg_catalog.to_jsonb(v_hidden), pg_catalog.to_jsonb(v_default_hidden)),
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
  v_hidden_allowed text[] := array[
    'upcoming', 'mix', 'subscriptions', 'payment-instruments'
  ]::text[];
  v_count integer;
  v_unique integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'order_ids', pg_catalog.to_jsonb(v_allowed),
      'hidden_ids', pg_catalog.to_jsonb(v_hidden_allowed),
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
      'hidden_ids', pg_catalog.to_jsonb(v_hidden_allowed),
      'message', '위젯 순서가 올바르지 않습니다.'
    );
  end if;

  select count(*), count(distinct id)
  into v_count, v_unique
  from pg_catalog.unnest(v_hidden) as ids(id);

  if v_unique <> v_count or not (v_hidden <@ v_hidden_allowed) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_hidden',
      'order_ids', pg_catalog.to_jsonb(v_order),
      'hidden_ids', pg_catalog.to_jsonb(v_hidden_allowed),
      'message', '기본 위젯은 삭제할 수 없습니다.'
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
