-- 무료 체험 구독 표시 기능: is_trial/trial_ends_at 플래그 + D0(당일) 알림 허용.
-- 설계 근거: docs/trial-subscription-badge-plan.md

alter table public.subscriptions
  add column is_trial boolean not null default false,
  add column trial_ends_at date,
  add constraint subscriptions_trial_ends_at_check
    check (not is_trial or trial_ends_at is not null);

-- 체험 종료(D0) 알림을 표현하기 위해 reminder_offset=0과 kind='trial_ending'을 허용한다.
alter table public.notifications
  drop constraint notifications_reminder_offset_check,
  add constraint notifications_reminder_offset_check check (reminder_offset in (0, 1, 3)),
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('payment_due', 'trial_ending'));

-- offset=0(체험 종료 당일)은 d3/d1 개별 토글과 무관하게 payment_due_enabled만 따른다.
create or replace function public.notification_inbox_enabled(p_user uuid, p_offset integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce((
    select p.notifications_enabled
      and p.payment_due_enabled
      and case p_offset
        when 3 then p.payment_due_d3_enabled
        when 1 then p.payment_due_d1_enabled
        when 0 then true
        else false
      end
    from public.notification_preferences p
    where p.user_id = p_user
  ), true);
$$;
