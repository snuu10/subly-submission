-- ChatGPT 수정: CLI 생성 후 기존 알림 테이블 마이그레이션보다 뒤에 실행되도록 순서를 맞춤.
-- 발송 생성/재시도 분리, 동시 실행 선점, 불확실한 전송의 중복 발송 방지.
alter table public.notification_push_deliveries
  drop constraint notification_push_deliveries_status_check;
alter table public.notification_push_deliveries
  add constraint notification_push_deliveries_status_check
    check (status in ('pending', 'claimed', 'sending', 'retry', 'ticket_ok', 'delivered', 'error', 'unknown', 'skipped')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz not null default now(),
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column attempted_token text,
  add column attempted_user_id uuid;

create index notification_delivery_retry_idx
  on public.notification_push_deliveries (next_attempt_at)
  where status in ('pending', 'retry');

-- ChatGPT 수정: 매 실행마다 과거 알림 전체를 스캔하지 않고 당일 대상부터 찾는다.
create index notifications_reminder_day_idx on public.notifications ((payment_date - reminder_offset));

-- ChatGPT 수정: 변경/해지/삭제된 구독과 지난 알림은 재발송하지 않는다.
-- 기준일에서 월수의 배수를 직접 더하여 월말 clamp와 연간 윤년을 보존한다.
create function public.notification_is_due(p_subscription uuid, p_user uuid, p_date date, p_offset integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select p_date - p_offset = (now() at time zone 'Asia/Seoul')::date
    and exists (
      select 1 from public.subscriptions s
      cross join lateral (
        select (extract(year from p_date)::int - extract(year from s.anchor_date)::int) * 12
          + extract(month from p_date)::int - extract(month from s.anchor_date)::int as months
      ) m
      where s.id = p_subscription and s.user_id = p_user and s.is_active
        and p_date >= s.anchor_date
        and (
          (s.billing_cycle = 'one_time' and s.anchor_date = p_date)
          or (s.billing_cycle in ('monthly', 'yearly')
            and (s.billing_cycle = 'monthly' or m.months % 12 = 0)
            and (s.anchor_date + make_interval(months => m.months))::date = p_date)
        )
    );
$$;
revoke all on function public.notification_is_due(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.notification_is_due(uuid, uuid, date, integer) to service_role;

create function public.claim_notification_deliveries(p_limit integer default 100)
returns table (
  id uuid, notification_id uuid, device_id uuid, user_id uuid, token text,
  title text, body text, subscription_id uuid, claim_token uuid, attempt_count integer, badge integer
)
language plpgsql security invoker set search_path = ''
as $$
begin
  -- 전송 전 선점 상태에서 종료된 작업은 안전하게 다시 준비할 수 있다.
  update public.notification_push_deliveries d
    set status = 'retry', next_attempt_at = now(), attempt_count = greatest(0, d.attempt_count - 1)
    where d.status = 'claimed' and d.claimed_at < now() - interval '10 minutes';
  -- ChatGPT 수정: 전송 중 프로세스가 종료되면 성공 여부가 불명확하므로 재발송 대신 unknown.
  update public.notification_push_deliveries d
    set status = 'unknown', error_code = 'ClaimExpired', checked_at = now()
    where d.status = 'sending' and d.claimed_at < now() - interval '10 minutes';

  update public.notification_push_deliveries d
    set status = 'skipped', error_code = 'NoLongerEligible', checked_at = now()
    from public.notifications n
    where n.id = d.notification_id and d.status in ('pending', 'retry')
      and not public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset);

  if extract(hour from now() at time zone 'Asia/Seoul') < 9 then return; end if;

  -- ChatGPT 수정: 기존 알림도 매번 기기와 연결하므로 발송 실패/늦은 토큰 등록을 복구한다.
  insert into public.notification_push_deliveries (notification_id, device_id)
    select n.id, device.id from public.notifications n
    join public.notification_devices device on device.user_id = n.user_id and device.enabled
    where n.payment_date - n.reminder_offset = (now() at time zone 'Asia/Seoul')::date
      and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
    order by n.id, device.id
    on conflict do nothing;

  return query
    with candidates as (
      select d.id from public.notification_push_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_devices device on device.id = d.device_id
      where d.status in ('pending', 'retry') and d.next_attempt_at <= now() and d.attempt_count < 5
        and device.enabled and device.user_id = n.user_id
        and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
      order by d.next_attempt_at, d.id
      limit least(greatest(p_limit, 1), 100)
      for update of d skip locked
    ), claimed as (
      update public.notification_push_deliveries d
      set status = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(),
        attempt_count = d.attempt_count + 1, attempted_token = device.expo_push_token,
        attempted_user_id = device.user_id,
        expo_ticket_id = null, checked_at = null, error_code = null, error_message = null
      from candidates c, public.notification_devices device
      where d.id = c.id and device.id = d.device_id
      returning d.*
    )
    select d.id, n.id, d.device_id, n.user_id, d.attempted_token, n.title, n.body,
      n.subscription_id, d.claim_token, d.attempt_count,
      (select count(*)::integer from public.notifications unread
        where unread.user_id = n.user_id and unread.read_at is null)
    from claimed d join public.notifications n on n.id = d.notification_id;
end;
$$;
revoke all on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

-- ChatGPT 수정: 전송 직전에도 현재 기기 소유권/토큰/구독 상태를 확인한다.
create function public.validate_notification_delivery(p_id uuid, p_claim uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.notification_push_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.notification_devices device on device.id = d.device_id
    where d.id = p_id and d.claim_token = p_claim and d.status = 'claimed'
      and device.enabled and device.user_id = n.user_id
      and device.user_id = d.attempted_user_id and device.expo_push_token = d.attempted_token
      and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
  );
$$;
revoke all on function public.validate_notification_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.validate_notification_delivery(uuid, uuid) to service_role;

-- ChatGPT 수정: 선점(claimed)과 외부 요청 직전(sending)을 구분하고 한 RPC에서 일괄 검증한다.
create function public.start_notification_deliveries(p_claims jsonb)
returns table (id uuid, claim_token uuid)
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.notification_push_deliveries d
    set status = 'skipped', error_code = 'NoLongerEligible', checked_at = now()
    from jsonb_to_recordset(p_claims) as requested(id uuid, claim_token uuid)
    where d.id = requested.id and d.claim_token = requested.claim_token and d.status = 'claimed'
      and not public.validate_notification_delivery(d.id, d.claim_token);
  return query
    update public.notification_push_deliveries d
      set status = 'sending', claimed_at = now()
      from jsonb_to_recordset(p_claims) as requested(id uuid, claim_token uuid)
      where d.id = requested.id and d.claim_token = requested.claim_token
        and public.validate_notification_delivery(d.id, d.claim_token)
      returning d.id, d.claim_token;
end;
$$;
revoke all on function public.start_notification_deliveries(jsonb) from public, anon, authenticated;
grant execute on function public.start_notification_deliveries(jsonb) to service_role;

create function public.finish_notification_delivery(
  p_id uuid, p_claim uuid, p_status text, p_ticket text default null,
  p_code text default null, p_message text default null
)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  delivery public.notification_push_deliveries;
begin
  if p_status not in ('ticket_ok', 'retry', 'error', 'unknown', 'skipped') then
    raise exception 'invalid delivery outcome';
  end if;
  if p_status = 'ticket_ok' and p_ticket is null then raise exception 'ticket required'; end if;

  update public.notification_push_deliveries d
    set status = case when p_status = 'retry' and d.attempt_count >= 5 then 'error' else p_status end,
      expo_ticket_id = p_ticket, error_code = p_code, error_message = p_message, sent_at = now(),
      next_attempt_at = now() + make_interval(mins => (5 * power(2, least(d.attempt_count - 1, 4)))::int)
    where d.id = p_id and d.claim_token = p_claim and d.status = 'sending'
    returning d.* into delivery;
  if not found then return; end if;

  if p_code = 'DeviceNotRegistered' then
    update public.notification_devices set enabled = false, updated_at = now()
      where id = delivery.device_id and user_id = delivery.attempted_user_id
        and expo_push_token = delivery.attempted_token;
  end if;

  -- 동일 알림의 다른 기기 결과와 직렬화하여 집계를 갱신한다.
  perform 1 from public.notifications where id = delivery.notification_id for update;
  update public.notifications n set
    push_status = case
      when exists (select 1 from public.notification_push_deliveries d where d.notification_id = n.id and d.status in ('pending','retry','claimed','sending')) then 'pending'
      when not exists (select 1 from public.notification_push_deliveries d where d.notification_id = n.id and d.status not in ('ticket_ok','delivered')) then 'sent'
      when exists (select 1 from public.notification_push_deliveries d where d.notification_id = n.id and d.status in ('ticket_ok','delivered')) then 'partial'
      else 'failed' end,
    push_sent_at = case when p_status = 'ticket_ok' then now() else n.push_sent_at end
    where n.id = delivery.notification_id;
end;
$$;
revoke all on function public.finish_notification_delivery(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_notification_delivery(uuid, uuid, text, text, text, text) to service_role;

-- ChatGPT 수정: 기존 명확한 일시 오류만 복구한다. unknown/성공 티켓은 재발송하지 않는다.
update public.notification_push_deliveries
  set status = 'retry', next_attempt_at = now()
  where status = 'error' and (
    error_code = 'MessageRateExceeded'
    or error_message ~ '^HTTP (429|5[0-9]{2})$'
  );

-- ChatGPT 수정: 기존 Cron을 재사용하고 재시도 지연(5분부터)을 실제 실행 주기에 반영한다.
do $$
declare job bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into job from cron.job where jobname = 'generate-payment-notifications-hourly';
    if job is not null then
      perform cron.alter_job(job, schedule := '*/5 * * * *');
    end if;
  end if;
end;
$$;
