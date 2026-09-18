-- 결제 주기: weekly 제거, one_time 추가.
-- 기존 주간 행은 반복 결제로 보고 monthly로 옮긴다.

create or replace function public.monthly_equivalent(p_amount integer, p_cycle text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cycle = 'yearly' then round(p_amount::numeric / 12)::integer
    when p_cycle = 'one_time' then 0
    else p_amount
  end;
$$;

create or replace function public.subscription_next_payment_date(
  p_anchor date,
  p_cycle text,
  p_from date default (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cycle text := coalesce(p_cycle, 'monthly');
  v_from date := coalesce(p_from, (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date);
  v_anchor date := coalesce(p_anchor, v_from);
  v_y integer;
  v_m integer;
  v_d integer;
  v_n integer := 0;
  v_last integer;
  v_day integer;
  v_next date;
begin
  if v_cycle = 'one_time' then
    return v_anchor;
  end if;

  if v_cycle not in ('monthly', 'yearly') then
    v_cycle := 'monthly';
  end if;

  v_y := extract(year from v_anchor)::integer;
  v_m := extract(month from v_anchor)::integer;
  v_d := extract(day from v_anchor)::integer;

  if v_cycle = 'yearly' then
    loop
      v_last := extract(day from (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::integer;
      v_day := least(v_d, v_last);
      v_next := make_date(v_y, v_m, v_day);
      if v_next >= v_from then
        return v_next;
      end if;
      v_y := v_y + 1;
      v_n := v_n + 1;
      if v_n > 20 then
        return v_from;
      end if;
    end loop;
  end if;

  loop
    v_last := extract(day from (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::integer;
    v_day := least(v_d, v_last);
    v_next := make_date(v_y, v_m, v_day);
    if v_next >= v_from then
      return v_next;
    end if;
    v_m := v_m + 1;
    if v_m > 12 then
      v_m := 1;
      v_y := v_y + 1;
    end if;
    v_n := v_n + 1;
    if v_n > 48 then
      return v_from;
    end if;
  end loop;
end;
$$;

update public.briefing_events
set payload = jsonb_set(payload, '{billing_cycle}', '"monthly"')
where payload ->> 'billing_cycle' = 'weekly';

update public.subscriptions
set
  billing_cycle = 'monthly',
  next_payment_date = public.subscription_next_payment_date(anchor_date, 'monthly')
where billing_cycle = 'weekly';

alter table public.briefing_events drop constraint if exists briefing_events_payload_cycle;
alter table public.briefing_events add constraint briefing_events_payload_cycle check (
  payload ->> 'billing_cycle' in ('monthly', 'yearly', 'one_time')
);

do $$
declare
  v_con name;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'subscriptions'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%billing_cycle%'
  loop
    execute format('alter table public.subscriptions drop constraint %I', v_con);
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_billing_cycle_check
  check (billing_cycle in ('monthly', 'yearly', 'one_time'));
