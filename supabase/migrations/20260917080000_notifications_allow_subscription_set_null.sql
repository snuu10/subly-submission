-- 구독 삭제 시 notifications.subscription_id FK(ON DELETE SET NULL)가 이 컬럼을 null로 바꾸는데,
-- notifications_guard_update 트리거가 이를 "사용자가 직접 바꾼 변경"으로 오인해 예외를 던져
-- 구독 삭제 트랜잭션 전체가 롤백되는 버그가 있었다("notifications: read_at 외에는 사용자가
-- 직접 바꿀 수 없습니다"). subscription_id가 null로 바뀌는 경우만 예외적으로 허용한다
-- (다른 값으로 바뀌는 시도는 계속 막는다).

create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.user_id <> old.user_id
     or (new.subscription_id is distinct from old.subscription_id and new.subscription_id is not null)
     or new.kind <> old.kind
     or new.payment_date <> old.payment_date
     or new.reminder_offset <> old.reminder_offset
     or new.title <> old.title
     or new.body <> old.body
     or new.target_path is distinct from old.target_path
     or new.created_at <> old.created_at
     or new.push_status <> old.push_status
     or new.push_sent_at is distinct from old.push_sent_at then
    raise exception 'notifications: read_at 외에는 사용자가 직접 바꿀 수 없습니다';
  end if;

  return new;
end;
$$;
