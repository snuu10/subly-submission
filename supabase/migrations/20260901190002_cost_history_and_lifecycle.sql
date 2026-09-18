-- 5단계: 가격·상태 이력, 월 스냅샷.
-- 6단계: 해지 생명주기 (앱 삭제·일시정지와 분리).
--
-- 클라이언트는 이력·스냅샷 SELECT만. 쓰기는 트리거와 RPC.
-- 지난달 금액을 추정해 넣지 않는다. 스냅샷은 이번 달(KST)만 재계산한다.

alter table public.subscriptions
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in (
      'active',
      'guide_reviewed',
      'cancel_requested',
      'ending_scheduled',
      'ended',
      'end_confirm_needed'
    )),
  add column if not exists service_end_date date,
  add column if not exists guide_reviewed_at timestamptz,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists last_rebill_check_at timestamptz;

create index if not exists subscriptions_user_lifecycle_idx
  on public.subscriptions (user_id, lifecycle_status);

create or replace function public.monthly_equivalent(p_amount integer, p_cycle text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cycle = 'yearly' then round(p_amount::numeric / 12)::integer
    when p_cycle = 'weekly' then round(p_amount::numeric * 4.33)::integer
    else p_amount
  end;
$$;

revoke all on function public.monthly_equivalent(integer, text) from public, anon;
grant execute on function public.monthly_equivalent(integer, text) to authenticated, service_role;

create table public.subscription_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  subscription_name text not null,
  kind text not null check (kind in (
    'created', 'amount', 'cycle', 'active', 'lifecycle', 'deleted', 'observed'
  )),
  old_amount integer,
  new_amount integer,
  old_billing_cycle text,
  new_billing_cycle text,
  old_is_active boolean,
  new_is_active boolean,
  old_lifecycle text,
  new_lifecycle text,
  monthly_amount integer,
  source text not null default 'trigger'
    check (source in ('trigger', 'rpc', 'baseline')),
  created_at timestamptz not null default now()
);

create index subscription_change_events_user_created_idx
  on public.subscription_change_events (user_id, created_at desc);
create index subscription_change_events_user_kind_idx
  on public.subscription_change_events (user_id, kind, created_at desc);
create index subscription_change_events_sub_created_idx
  on public.subscription_change_events (subscription_id, created_at desc);

create table public.subscription_monthly_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  monthly_total integer not null default 0,
  active_count integer not null default 0,
  category_totals jsonb not null default '{}'::jsonb,
  source text not null default 'refresh' check (source in ('refresh', 'baseline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start),
  constraint subscription_monthly_snapshots_totals_object check (
    jsonb_typeof(category_totals) = 'object'
  ),
  constraint subscription_monthly_snapshots_totals_size check (
    octet_length(category_totals::text) <= 4096
  )
);

alter table public.subscription_change_events enable row level security;
alter table public.subscription_monthly_snapshots enable row level security;

create policy "own_select" on public.subscription_change_events
  for select using ((select auth.uid()) = user_id);
create policy "own_select" on public.subscription_monthly_snapshots
  for select using ((select auth.uid()) = user_id);

revoke all on public.subscription_change_events from anon, authenticated;
revoke all on public.subscription_monthly_snapshots from anon, authenticated;
grant select on public.subscription_change_events to authenticated;
grant select on public.subscription_monthly_snapshots to authenticated;
grant all on public.subscription_change_events to service_role;
grant all on public.subscription_monthly_snapshots to service_role;

create or replace function public.kst_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date;
$$;

create or replace function public.kst_month_start(p_day date default null)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', coalesce(p_day, public.kst_today()))::date;
$$;

create or replace function public.refresh_monthly_snapshot(p_user_id uuid, p_month_start date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := coalesce(p_month_start, public.kst_month_start());
  v_total integer := 0;
  v_count integer := 0;
  v_cats jsonb := '{}'::jsonb;
begin
  select
    coalesce(sum(public.monthly_equivalent(s.amount, s.billing_cycle)), 0),
    count(*)::integer
  into v_total, v_count
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.is_active is true
    and s.lifecycle_status is distinct from 'ended';

  select coalesce(jsonb_object_agg(c.name, c.total), '{}'::jsonb)
  into v_cats
  from (
    select cat.name, sum(public.monthly_equivalent(s.amount, s.billing_cycle))::integer as total
    from public.subscriptions s
    join public.categories cat on cat.id = s.category_id
    where s.user_id = p_user_id
      and s.is_active is true
      and s.lifecycle_status is distinct from 'ended'
    group by cat.name
  ) c;

  insert into public.subscription_monthly_snapshots (
    user_id, month_start, monthly_total, active_count, category_totals, source, updated_at
  ) values (
    p_user_id, v_month, v_total, v_count, v_cats, 'refresh', pg_catalog.now()
  )
  on conflict (user_id, month_start) do update set
    monthly_total = excluded.monthly_total,
    active_count = excluded.active_count,
    category_totals = excluded.category_totals,
    source = 'refresh',
    updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.refresh_monthly_snapshot(uuid, date) from public, anon, authenticated;
grant execute on function public.refresh_monthly_snapshot(uuid, date) to service_role;

create or replace function public.subscription_history_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'INSERT' then
    v_user := new.user_id;
    insert into public.subscription_change_events (
      user_id, subscription_id, subscription_name, kind,
      new_amount, new_billing_cycle, new_is_active, new_lifecycle,
      monthly_amount, source
    ) values (
      new.user_id, new.id, new.name, 'created',
      new.amount, new.billing_cycle, new.is_active, new.lifecycle_status,
      public.monthly_equivalent(new.amount, new.billing_cycle), 'trigger'
    );
  elsif tg_op = 'UPDATE' then
    v_user := new.user_id;
    if new.amount is distinct from old.amount then
      insert into public.subscription_change_events (
        user_id, subscription_id, subscription_name, kind,
        old_amount, new_amount, old_billing_cycle, new_billing_cycle,
        monthly_amount, source
      ) values (
        new.user_id, new.id, new.name, 'amount',
        old.amount, new.amount, old.billing_cycle, new.billing_cycle,
        public.monthly_equivalent(new.amount, new.billing_cycle), 'trigger'
      );
    end if;
    if new.billing_cycle is distinct from old.billing_cycle then
      insert into public.subscription_change_events (
        user_id, subscription_id, subscription_name, kind,
        old_amount, new_amount, old_billing_cycle, new_billing_cycle,
        monthly_amount, source
      ) values (
        new.user_id, new.id, new.name, 'cycle',
        old.amount, new.amount, old.billing_cycle, new.billing_cycle,
        public.monthly_equivalent(new.amount, new.billing_cycle), 'trigger'
      );
    end if;
    if new.is_active is distinct from old.is_active then
      insert into public.subscription_change_events (
        user_id, subscription_id, subscription_name, kind,
        old_is_active, new_is_active, monthly_amount, source
      ) values (
        new.user_id, new.id, new.name, 'active',
        old.is_active, new.is_active,
        public.monthly_equivalent(new.amount, new.billing_cycle), 'trigger'
      );
    end if;
    if new.lifecycle_status is distinct from old.lifecycle_status then
      insert into public.subscription_change_events (
        user_id, subscription_id, subscription_name, kind,
        old_lifecycle, new_lifecycle, monthly_amount, source
      ) values (
        new.user_id, new.id, new.name, 'lifecycle',
        old.lifecycle_status, new.lifecycle_status,
        public.monthly_equivalent(new.amount, new.billing_cycle), 'trigger'
      );
    end if;
  elsif tg_op = 'DELETE' then
    v_user := old.user_id;
    insert into public.subscription_change_events (
      user_id, subscription_id, subscription_name, kind,
      old_amount, old_billing_cycle, old_is_active, old_lifecycle,
      monthly_amount, source
    ) values (
      old.user_id, old.id, old.name, 'deleted',
      old.amount, old.billing_cycle, old.is_active, old.lifecycle_status,
      public.monthly_equivalent(old.amount, old.billing_cycle), 'trigger'
    );
  end if;

  perform public.refresh_monthly_snapshot(v_user, public.kst_month_start());
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_history_aiud on public.subscriptions;
create trigger subscriptions_history_aiud
  after insert or update or delete on public.subscriptions
  for each row
  execute function public.subscription_history_trigger();

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
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'updated', 0);
  end if;

  update public.subscriptions set
    lifecycle_status = 'end_confirm_needed',
    last_rebill_check_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where user_id = v_uid
    and lifecycle_status = 'ending_scheduled'
    and service_end_date is not null
    and service_end_date <= v_today;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'code', 'ok', 'updated', v_n);
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
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'alerts', '[]'::jsonb);
  end if;

  perform public.sync_my_lifecycle_due();

  select coalesce(jsonb_agg(item order by (item ->> 'days_until')::integer), '[]'::jsonb)
  into v_alerts
  from (
    select jsonb_build_object(
      'subscription_id', s.id,
      'name', s.name,
      'kind', case
        when s.lifecycle_status = 'end_confirm_needed' then 'end_confirm'
        else 'ending_soon'
      end,
      'lifecycle_status', s.lifecycle_status,
      'service_end_date', s.service_end_date,
      'days_until', (s.service_end_date - v_today),
      'monthly_save', public.monthly_equivalent(s.amount, s.billing_cycle),
      'yearly_save', public.monthly_equivalent(s.amount, s.billing_cycle) * 12
    ) as item
    from public.subscriptions s
    where s.user_id = v_uid
      and (
        s.lifecycle_status = 'end_confirm_needed'
        or (
          s.lifecycle_status = 'ending_scheduled'
          and s.service_end_date is not null
          and s.service_end_date - v_today between 0 and 7
        )
      )
  ) q;

  return jsonb_build_object('ok', true, 'code', 'ok', 'alerts', v_alerts);
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
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', '로그인이 필요합니다.');
  end if;
  if p_to is null or p_to not in (
    'active', 'guide_reviewed', 'cancel_requested', 'ending_scheduled', 'ended', 'end_confirm_needed'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', '지원하지 않는 해지 상태입니다.');
  end if;

  select * into v_sub
  from public.subscriptions
  where id = p_subscription_id and user_id = v_uid;

  if v_sub.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', '구독을 찾지 못했어요.');
  end if;

  v_next := p_to;
  v_end := coalesce(p_service_end_date, v_sub.service_end_date, v_sub.next_payment_date);

  if p_to = 'cancel_requested' then
    if v_end is not null and v_end <= v_today then
      v_next := 'end_confirm_needed';
    elsif v_end is not null then
      v_next := 'ending_scheduled';
    end if;
  end if;

  if p_to = 'ending_scheduled' and v_end is null then
    return jsonb_build_object('ok', false, 'code', 'missing_end_date', 'message', '이용 종료일을 알려 주세요.');
  end if;

  update public.subscriptions set
    lifecycle_status = v_next,
    service_end_date = case
      when v_next in ('cancel_requested', 'ending_scheduled', 'end_confirm_needed', 'ended') then v_end
      when v_next = 'active' then null
      else service_end_date
    end,
    guide_reviewed_at = case
      when v_next = 'guide_reviewed' then pg_catalog.now()
      when v_sub.guide_reviewed_at is not null then v_sub.guide_reviewed_at
      when v_next in ('cancel_requested', 'ending_scheduled', 'end_confirm_needed', 'ended') then pg_catalog.now()
      else guide_reviewed_at
    end,
    cancel_requested_at = case
      when v_next in ('cancel_requested', 'ending_scheduled', 'end_confirm_needed', 'ended')
        then coalesce(v_sub.cancel_requested_at, pg_catalog.now())
      when v_next = 'active' then null
      else cancel_requested_at
    end,
    ended_at = case
      when v_next = 'ended' then pg_catalog.now()
      when v_next = 'active' then null
      else ended_at
    end,
    last_rebill_check_at = case
      when v_next = 'end_confirm_needed' then pg_catalog.now()
      when v_next = 'active' then pg_catalog.now()
      else last_rebill_check_at
    end,
    is_active = case
      when v_next = 'ended' then false
      else is_active
    end,
    updated_at = pg_catalog.now()
  where id = v_sub.id and user_id = v_uid
  returning * into v_sub;

  return jsonb_build_object(
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

-- 기존 행 기준으로 이번 달 스냅샷만 채운다. 지난달 금액은 만들지 않는다.
do $$
declare
  r record;
begin
  for r in select distinct user_id from public.subscriptions
  loop
    perform public.refresh_monthly_snapshot(r.user_id, public.kst_month_start());
  end loop;
end;
$$;
