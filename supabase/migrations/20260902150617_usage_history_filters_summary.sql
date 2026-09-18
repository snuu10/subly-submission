-- 사용 기록에 필터와 요약(응답 비율, 안 쓰는 구독, 구독별 최근)을 붙인다.
-- 기존 list_my_usage_history(integer)는 인자 타입이 달라져서 교체한다.

drop function if exists public.list_my_usage_history(integer);

create or replace function public.list_my_usage_history(
  p_limit integer default 100,
  p_subscription_id uuid default null,
  p_response text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer;
  v_items jsonb;
  v_counts jsonb;
  v_unused jsonb;
  v_latest jsonb;
  v_empty_counts jsonb := pg_catalog.jsonb_build_object(
    'used_recently', 0,
    'occasionally', 0,
    'not_used', 0,
    'unsure', 0,
    'later', 0
  );
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'items', '[]'::jsonb,
      'summary', pg_catalog.jsonb_build_object(
        'response_counts', v_empty_counts,
        'unused', '[]'::jsonb,
        'latest_by_subscription', '[]'::jsonb
      ),
      'message', '로그인이 필요합니다.'
    );
  end if;

  if p_response is not null and p_response not in (
    'used_recently', 'occasionally', 'not_used', 'unsure', 'later'
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'invalid_response',
      'items', '[]'::jsonb,
      'summary', pg_catalog.jsonb_build_object(
        'response_counts', v_empty_counts,
        'unused', '[]'::jsonb,
        'latest_by_subscription', '[]'::jsonb
      ),
      'message', '사용 여부 필터가 올바르지 않습니다.'
    );
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  with combined as (
    select
      ('checkin:' || c.id::text) as id,
      'checkin'::text as kind,
      c.subscription_id,
      coalesce(nullif(pg_catalog.btrim(s.name), ''), nullif(e.payload ->> 'name', ''), '구독') as name,
      c.response,
      c.source,
      c.created_at as at,
      pg_catalog.to_char(c.next_check_at, 'YYYY-MM-DD') as next_check_at,
      null::timestamptz as snoozed_until
    from public.usage_checkins c
    left join public.subscriptions s on s.id = c.subscription_id
    left join public.briefing_events e on e.id = c.briefing_event_id
    where c.user_id = v_uid

    union all

    select
      ('snooze:' || e.id::text) as id,
      'snooze'::text as kind,
      e.subscription_id,
      coalesce(nullif(pg_catalog.btrim(s.name), ''), nullif(e.payload ->> 'name', ''), '구독') as name,
      'later'::text as response,
      e.source,
      e.updated_at as at,
      null::text as next_check_at,
      e.snoozed_until
    from public.briefing_events e
    left join public.subscriptions s on s.id = e.subscription_id
    where e.user_id = v_uid
      and e.snoozed_until is not null
      and e.status in ('snoozed', 'expired')
  ),
  filtered as (
    select *
    from combined
    where (p_subscription_id is null or subscription_id = p_subscription_id)
      and (p_response is null or response = p_response)
      and (p_from is null or at >= p_from)
      and (p_to is null or at <= p_to)
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', hist.id,
        'kind', hist.kind,
        'subscription_id', hist.subscription_id,
        'name', hist.name,
        'response', hist.response,
        'source', hist.source,
        'at', hist.at,
        'next_check_at', hist.next_check_at,
        'snoozed_until', hist.snoozed_until
      )
      order by hist.at desc
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select *
    from filtered
    order by at desc
    limit v_limit
  ) hist;

  with combined as (
    select c.response
    from public.usage_checkins c
    where c.user_id = v_uid
    union all
    select 'later'::text
    from public.briefing_events e
    where e.user_id = v_uid
      and e.snoozed_until is not null
      and e.status in ('snoozed', 'expired')
  ),
  counted as (
    select response, count(*)::integer as cnt
    from combined
    group by response
  )
  select v_empty_counts || coalesce(pg_catalog.jsonb_object_agg(response, cnt), '{}'::jsonb)
  into v_counts
  from counted;

  with latest_checkin as (
    select distinct on (c.subscription_id)
      c.subscription_id,
      c.response,
      c.created_at as at,
      coalesce(nullif(pg_catalog.btrim(s.name), ''), '구독') as name,
      s.amount,
      s.billing_cycle
    from public.usage_checkins c
    inner join public.subscriptions s
      on s.id = c.subscription_id
     and s.user_id = v_uid
     and s.is_active
    where c.user_id = v_uid
    order by c.subscription_id, c.created_at desc
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'subscription_id', unused.subscription_id,
        'name', unused.name,
        'amount', unused.amount,
        'billing_cycle', unused.billing_cycle,
        'at', unused.at
      )
      order by unused.at desc
    ),
    '[]'::jsonb
  )
  into v_unused
  from latest_checkin unused
  where unused.response = 'not_used';

  with combined as (
    select
      c.subscription_id,
      coalesce(nullif(pg_catalog.btrim(s.name), ''), nullif(e.payload ->> 'name', ''), '구독') as name,
      c.response,
      c.created_at as at
    from public.usage_checkins c
    left join public.subscriptions s on s.id = c.subscription_id
    left join public.briefing_events e on e.id = c.briefing_event_id
    where c.user_id = v_uid

    union all

    select
      ev.subscription_id,
      coalesce(nullif(pg_catalog.btrim(s.name), ''), nullif(ev.payload ->> 'name', ''), '구독') as name,
      'later'::text as response,
      ev.updated_at as at
    from public.briefing_events ev
    left join public.subscriptions s on s.id = ev.subscription_id
    where ev.user_id = v_uid
      and ev.snoozed_until is not null
      and ev.status in ('snoozed', 'expired')
  ),
  latest as (
    select distinct on (subscription_id)
      subscription_id,
      name,
      response,
      at
    from combined
    order by subscription_id, at desc
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'subscription_id', latest.subscription_id,
        'name', latest.name,
        'response', latest.response,
        'at', latest.at
      )
      order by latest.at desc
    ),
    '[]'::jsonb
  )
  into v_latest
  from latest;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'items', v_items,
    'summary', pg_catalog.jsonb_build_object(
      'response_counts', coalesce(v_counts, v_empty_counts),
      'unused', coalesce(v_unused, '[]'::jsonb),
      'latest_by_subscription', coalesce(v_latest, '[]'::jsonb)
    ),
    'message', ''
  );
end;
$$;

revoke all on function public.list_my_usage_history(integer, uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.list_my_usage_history(integer, uuid, text, timestamptz, timestamptz)
  to authenticated;
