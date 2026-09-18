-- 구독 삭제 후 이력 트리거가 이미 없는 subscription_id를 넣어 FK가 깨졌다.
-- ON DELETE SET NULL과 맞게, 삭제 이벤트는 subscription_id를 비운다.

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
      old.user_id, null, old.name, 'deleted',
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
