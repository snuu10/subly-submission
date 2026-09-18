-- 설정 화면용 사용 기록. 체크인 답과 아직 답하지 않은 스누즈만 모은다.
-- 쓰기는 기존 answer/snooze RPC만. 이 함수는 읽기만 한다.

create or replace function public.list_my_usage_history(
  p_limit integer default 50
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
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthenticated',
      'items', '[]'::jsonb,
      'message', '로그인이 필요합니다.'
    );
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  select coalesce(pg_catalog.jsonb_agg(hist.item order by hist.at desc), '[]'::jsonb)
  into v_items
  from (
    select
      combined.at,
      pg_catalog.jsonb_build_object(
        'id', combined.id,
        'kind', combined.kind,
        'subscription_id', combined.subscription_id,
        'name', combined.name,
        'response', combined.response,
        'source', combined.source,
        'at', combined.at,
        'next_check_at', combined.next_check_at,
        'snoozed_until', combined.snoozed_until
      ) as item
    from (
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
    ) combined
    order by combined.at desc
    limit v_limit
  ) hist;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'items', v_items,
    'message', ''
  );
end;
$$;

revoke all on function public.list_my_usage_history(integer) from public, anon;
grant execute on function public.list_my_usage_history(integer) to authenticated;
