-- ChatGPT 수정: 전용 임시 DB에서만 실행하며 모든 데이터/DDL을 롤백한다.
begin;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claim.role', true);
$$;
create table public.subscriptions (
  id uuid primary key, user_id uuid references auth.users(id), anchor_date date not null,
  billing_cycle text not null, is_active boolean not null default true
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null
);
-- INITIAL_MIGRATION
-- RETRY_MIGRATION
-- PREFERENCES_MIGRATION

grant usage on schema public, auth to service_role, authenticated;
grant all on all tables in schema public to service_role;
grant select, update on public.notifications to authenticated;
grant execute on function auth.uid(), auth.role() to authenticated, service_role;
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.subscriptions values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-09-16', 'monthly', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '2026-09-14', 'one_time', true);
insert into public.notifications(id,user_id,subscription_id,payment_date,reminder_offset,title,body)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', '2026-09-16', 3, 'test', 'test');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
declare job record; jobs integer;
begin
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs = 0, 'no token -> no job';
  insert into public.notification_devices(id,user_id,expo_push_token,platform)
    values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ExponentPushToken[test]', 'android');
  select * into job from public.claim_notification_deliveries();
  assert job.id is not null and job.attempt_count = 1, 'late registration must claim existing notification';
  assert job.badge = 1, 'badge should include all unread';
  assert public.validate_notification_delivery(job.id, job.claim_token), 'claim is valid';
  perform public.start_notification_deliveries(jsonb_build_array(jsonb_build_object('id', job.id, 'claim_token', job.claim_token)));
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs = 0, 'already sending must not be reclaimed';
  perform public.finish_notification_delivery(job.id, job.claim_token, 'retry', null, 'HTTP_503');
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs = 0, 'backoff must be respected';
  update public.notification_push_deliveries set next_attempt_at = '2026-09-13 00:59Z' where id = job.id;
  select * into job from public.claim_notification_deliveries();
  assert job.attempt_count = 2, 'retry must increment attempt count';
  perform public.start_notification_deliveries(jsonb_build_array(jsonb_build_object('id', job.id, 'claim_token', job.claim_token)));
  perform public.finish_notification_delivery(job.id, gen_random_uuid(), 'ticket_ok', 'wrong-ticket');
  assert (select status = 'sending' from public.notification_push_deliveries where id=job.id), 'wrong claim cannot finish';
  perform public.finish_notification_delivery(job.id, job.claim_token, 'ticket_ok', 'ticket-1');
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs = 0, 'accepted ticket must never be resent';
  update public.notification_push_deliveries set status='pending', attempt_count=0, next_attempt_at='2026-09-13 00:59Z';
  select * into job from public.claim_notification_deliveries();
  perform public.start_notification_deliveries(jsonb_build_array(jsonb_build_object('id', job.id, 'claim_token', job.claim_token)));
  update public.notification_push_deliveries set claimed_at='2026-09-13 00:40Z';
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs=0, 'expired in-flight job is not retried';
  assert (select status='unknown' from public.notification_push_deliveries where id=job.id), 'expired claim becomes unknown';
  update public.notification_push_deliveries set status='retry', attempt_count=4, next_attempt_at='2026-09-13 00:59Z';
  select * into job from public.claim_notification_deliveries();
  perform public.start_notification_deliveries(jsonb_build_array(jsonb_build_object('id', job.id, 'claim_token', job.claim_token)));
  perform public.finish_notification_delivery(job.id, job.claim_token, 'retry', null, 'HTTP_429');
  assert (select status='error' and attempt_count=5 from public.notification_push_deliveries where id=job.id), 'max attempts enforced';
  update public.notification_push_deliveries set status='pending', attempt_count=0, next_attempt_at='2026-09-13 00:59Z';
  select * into job from public.claim_notification_deliveries();
  -- A crash before sending is recoverable without consuming an external-send attempt.
  update public.notification_push_deliveries set claimed_at='2026-09-13 00:40Z';
  select * into job from public.claim_notification_deliveries();
  assert job.attempt_count=1, 'expired pre-send claim is safely reclaimed';
  update public.notification_devices set user_id='00000000-0000-0000-0000-000000000002';
  assert not public.validate_notification_delivery(job.id,job.claim_token), 'changed ownership invalidates claim';
  -- Restore for start, then emulate ownership change while waiting for Expo.
  update public.notification_devices set user_id='00000000-0000-0000-0000-000000000001';
  perform public.start_notification_deliveries(jsonb_build_array(jsonb_build_object('id', job.id, 'claim_token', job.claim_token)));
  update public.notification_devices set user_id='00000000-0000-0000-0000-000000000002';
  perform public.finish_notification_delivery(job.id,job.claim_token,'error',null,'DeviceNotRegistered');
  assert (select enabled from public.notification_devices limit 1), 'old token receipt must not disable new owner';
  update public.notification_devices set user_id='00000000-0000-0000-0000-000000000001';
  update public.notification_push_deliveries set status='retry', attempt_count=1, next_attempt_at='2026-09-13 00:59Z';
  update public.subscriptions set is_active=false;
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs=0, 'inactive subscription is not retried';
  assert (select status='skipped' from public.notification_push_deliveries limit 1), 'inactive job skipped';
end;
$$;
reset role;

-- 새 설정은 본인만 읽고 바꿀 수 있으며, 푸시 OFF는 대기 재시도를 건너뛴다.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.notification_preferences(user_id, push_enabled)
  values ('00000000-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select count(*) = 1 from public.notification_preferences), 'owner sees preferences';
  begin
    insert into public.categories(user_id,name)
      values ('00000000-0000-0000-0000-000000000001', '영상!');
    assert false, 'special character category must fail';
  exception when check_violation then null;
  end;
  insert into public.categories(user_id,name)
    values ('00000000-0000-0000-0000-000000000001', '생활 비');
  begin
    insert into public.categories(user_id,name)
      values ('00000000-0000-0000-0000-000000000001', '생활비');
    assert false, 'normalized duplicate category must fail';
  exception when unique_violation then null;
  end;
end $$;
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
update public.subscriptions set is_active=true;
update public.notification_push_deliveries
  set status='retry', next_attempt_at='2026-09-13 00:59Z';
do $$ declare jobs integer; begin
  select count(*) into jobs from public.claim_notification_deliveries();
  assert jobs=0, 'push-disabled user is not retried';
  assert (select status='skipped' from public.notification_push_deliveries limit 1), 'disabled retry is skipped';
end $$;
reset role;

-- Authenticated users cannot claim/send; RLS restricts read/write to the owner.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare blocked boolean := false;
begin
  assert (select count(*)=0 from public.notifications), 'RLS must hide other users';
  assert (select count(*)=0 from public.notification_preferences), 'RLS must hide other preferences';
  begin
    perform public.claim_notification_deliveries();
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'authenticated role must not execute sender RPC';
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
update public.notifications set read_at = now();
do $$ begin
  assert (select count(*)=0 from public.notifications where read_at is null), 'owner can mark read';
end $$;
reset role;
rollback;
