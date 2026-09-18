-- 정기 구독은 등록 일정대로 자동 갱신된 것으로 반영한다.
-- 이 기록은 계좌 거래 확인이 아니라 일정 스냅샷이며, 확인된 결제와 구분한다.

create table public.subscription_renewals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  expected_date date not null,
  expected_amount integer not null check (expected_amount > 0),
  actual_date date,
  actual_amount integer check (actual_amount is null or actual_amount > 0),
  status text not null default 'assumed_renewed'
    check (status in ('assumed_renewed', 'confirmed')),
  confirmation_source text not null default 'schedule'
    check (confirmation_source in ('schedule', 'manual', 'receipt')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, expected_date),
  constraint subscription_renewals_confirmation_ck check (
    (status = 'assumed_renewed' and confirmation_source = 'schedule' and confirmed_at is null)
    or
    (status = 'confirmed' and confirmation_source in ('manual', 'receipt') and confirmed_at is not null)
  )
);

create index subscription_renewals_user_date_idx
  on public.subscription_renewals (user_id, expected_date desc);

alter table public.subscription_renewals enable row level security;

create policy "own_select" on public.subscription_renewals
  for select using ((select auth.uid()) = user_id);

revoke all on public.subscription_renewals from anon, authenticated;
grant select on public.subscription_renewals to authenticated;
grant all on public.subscription_renewals to service_role;

-- 이번 달 중 오늘까지 도래한 정기 구독 회차만 기록한다.
-- 과거 전체를 실제 결제처럼 백필하지 않고, 호출을 반복해도 고유 제약으로 한 번만 생성한다.
create or replace function public.sync_my_automatic_renewals()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.kst_today();
  v_month_start date := public.kst_month_start();
  v_sub public.subscriptions%rowtype;
  v_due date;
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'unauthenticated', 'inserted', 0);
  end if;

  for v_sub in
    select * from public.subscriptions
    where user_id = v_uid
      and is_active is true
      and billing_cycle in ('monthly', 'yearly')
      and lifecycle_status is distinct from 'ended'
  loop
    v_due := public.subscription_next_payment_date(
      v_sub.anchor_date,
      v_sub.billing_cycle,
      v_month_start
    );

    if v_due between v_month_start and v_today
       and (v_sub.service_end_date is null or v_due <= v_sub.service_end_date) then
      insert into public.subscription_renewals (
        user_id, subscription_id, expected_date, expected_amount,
        status, confirmation_source
      ) values (
        v_uid, v_sub.id, v_due, v_sub.amount,
        'assumed_renewed', 'schedule'
      )
      on conflict (subscription_id, expected_date) do nothing;
      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('ok', true, 'code', 'ok', 'inserted', v_inserted);
end;
$$;

revoke all on function public.sync_my_automatic_renewals() from public, anon;
grant execute on function public.sync_my_automatic_renewals() to authenticated;

create or replace function public.confirm_my_subscription_renewal(
  p_subscription_id uuid,
  p_expected_date date,
  p_actual_amount integer default null,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
  v_row public.subscription_renewals%rowtype;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_source not in ('manual', 'receipt') then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;
  if p_actual_amount is not null and p_actual_amount <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  select * into v_sub from public.subscriptions
  where id = p_subscription_id and user_id = v_uid;
  if not found or v_sub.billing_cycle = 'one_time' then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.subscription_renewals (
    user_id, subscription_id, expected_date, expected_amount,
    actual_date, actual_amount, status, confirmation_source, confirmed_at, updated_at
  ) values (
    v_uid, v_sub.id, p_expected_date, v_sub.amount,
    public.kst_today(), coalesce(p_actual_amount, v_sub.amount),
    'confirmed', p_source, pg_catalog.now(), pg_catalog.now()
  )
  on conflict (subscription_id, expected_date) do update set
    actual_date = excluded.actual_date,
    actual_amount = excluded.actual_amount,
    status = 'confirmed',
    confirmation_source = excluded.confirmation_source,
    confirmed_at = excluded.confirmed_at,
    updated_at = excluded.updated_at
  returning * into v_row;

  return pg_catalog.jsonb_build_object('ok', true, 'code', 'confirmed', 'renewal', pg_catalog.to_jsonb(v_row));
end;
$$;

revoke all on function public.confirm_my_subscription_renewal(uuid, date, integer, text) from public, anon;
grant execute on function public.confirm_my_subscription_renewal(uuid, date, integer, text) to authenticated;

alter publication supabase_realtime add table public.subscription_renewals;
