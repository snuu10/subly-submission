-- 실제 서비스 해지를 확인해 종료 예정으로 기록한 구독은 이용 종료일에 자동 종료한다.
-- 종료일 뒤에 다시 "종료 확인"을 요구하지 않는다.

create or replace function public.sync_my_lifecycle_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.kst_today();
  v_n integer := 0;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'unauthenticated', 'updated', 0);
  end if;

  update public.subscriptions set
    lifecycle_status = 'ended',
    is_active = false,
    ended_at = coalesce(ended_at, pg_catalog.now()),
    last_rebill_check_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where user_id = v_uid
    and lifecycle_status in ('ending_scheduled', 'end_confirm_needed')
    and service_end_date is not null
    and service_end_date <= v_today;

  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'code', 'ok', 'updated', v_n);
end;
$$;

revoke all on function public.sync_my_lifecycle_due() from public, anon;
grant execute on function public.sync_my_lifecycle_due() to authenticated;

create or replace function public.list_my_lifecycle_alerts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.kst_today();
  v_alerts jsonb;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'unauthenticated', 'alerts', '[]'::jsonb);
  end if;

  perform public.sync_my_lifecycle_due();

  select coalesce(pg_catalog.jsonb_agg(item order by (item ->> 'days_until')::integer), '[]'::jsonb)
  into v_alerts
  from (
    select pg_catalog.jsonb_build_object(
      'subscription_id', s.id,
      'name', s.name,
      'kind', 'ending_soon',
      'lifecycle_status', s.lifecycle_status,
      'service_end_date', s.service_end_date,
      'days_until', (s.service_end_date - v_today),
      'monthly_save', public.monthly_equivalent(s.amount, s.billing_cycle),
      'yearly_save', public.monthly_equivalent(s.amount, s.billing_cycle) * 12
    ) as item
    from public.subscriptions s
    where s.user_id = v_uid
      and s.lifecycle_status = 'ending_scheduled'
      and s.service_end_date is not null
      and s.service_end_date - v_today between 0 and 7
  ) q;

  return pg_catalog.jsonb_build_object('ok', true, 'code', 'ok', 'alerts', v_alerts);
end;
$$;

revoke all on function public.list_my_lifecycle_alerts() from public, anon;
grant execute on function public.list_my_lifecycle_alerts() to authenticated;

create or replace function public.advance_subscription_lifecycle(
  p_subscription_id uuid,
  p_to text,
  p_service_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sub public.subscriptions;
  v_today date := public.kst_today();
  v_end date;
  v_next text;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', '로그인이 필요합니다.');
  end if;
  if p_to is null or p_to not in (
    'active', 'guide_reviewed', 'cancel_requested', 'ending_scheduled', 'ended', 'end_confirm_needed'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', '지원하지 않는 해지 상태입니다.');
  end if;

  select * into v_sub
  from public.subscriptions
  where id = p_subscription_id and user_id = v_uid;

  if v_sub.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found', 'message', '구독을 찾지 못했어요.');
  end if;

  v_next := case when p_to = 'end_confirm_needed' then 'ended' else p_to end;
  v_end := coalesce(p_service_end_date, v_sub.service_end_date, v_sub.next_payment_date);

  if p_to = 'cancel_requested' then
    if v_end is not null and v_end <= v_today then
      v_next := 'ended';
    elsif v_end is not null then
      v_next := 'ending_scheduled';
    end if;
  end if;

  if p_to = 'ending_scheduled' and v_end is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'missing_end_date', 'message', '이용 종료일을 알려 주세요.');
  end if;
  if p_to = 'ending_scheduled' and v_end <= v_today then
    v_next := 'ended';
  end if;

  update public.subscriptions set
    lifecycle_status = v_next,
    service_end_date = case
      when v_next in ('cancel_requested', 'ending_scheduled', 'ended') then v_end
      when v_next = 'active' then null
      else service_end_date
    end,
    guide_reviewed_at = case
      when v_next = 'guide_reviewed' then pg_catalog.now()
      when v_sub.guide_reviewed_at is not null then v_sub.guide_reviewed_at
      when v_next in ('cancel_requested', 'ending_scheduled', 'ended') then pg_catalog.now()
      else guide_reviewed_at
    end,
    cancel_requested_at = case
      when v_next in ('cancel_requested', 'ending_scheduled', 'ended')
        then coalesce(v_sub.cancel_requested_at, pg_catalog.now())
      when v_next = 'active' then null
      else cancel_requested_at
    end,
    ended_at = case
      when v_next = 'ended' then coalesce(v_sub.ended_at, pg_catalog.now())
      when v_next = 'active' then null
      else ended_at
    end,
    last_rebill_check_at = case
      when v_next in ('ended', 'active') then pg_catalog.now()
      else last_rebill_check_at
    end,
    is_active = case
      when v_next = 'ended' then false
      when v_next = 'active' then true
      else is_active
    end,
    updated_at = pg_catalog.now()
  where id = v_sub.id and user_id = v_uid
  returning * into v_sub;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'message', '해지 상태를 반영했습니다.',
    'subscription_id', v_sub.id,
    'lifecycle_status', v_sub.lifecycle_status,
    'service_end_date', v_sub.service_end_date
  );
end;
$$;

revoke all on function public.advance_subscription_lifecycle(uuid, text, date) from public, anon;
grant execute on function public.advance_subscription_lifecycle(uuid, text, date) to authenticated;

-- 과거 흐름에서 이미 종료 확인 대기 상태가 된 행은 종료일이 지난 것이므로 자동 종료로 정리한다.
update public.subscriptions set
  lifecycle_status = 'ended',
  is_active = false,
  ended_at = coalesce(ended_at, pg_catalog.now()),
  last_rebill_check_at = pg_catalog.now(),
  updated_at = pg_catalog.now()
where lifecycle_status = 'end_confirm_needed'
  and service_end_date is not null
  and service_end_date <= public.kst_today();
