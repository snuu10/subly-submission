-- 기존 subscriptions 테이블에 결제 채널만 추가. CREATE TABLE은 하지 않는다.

alter table public.subscriptions
  add column billing_channel text
  check (
    billing_channel is null
    or billing_channel in ('direct_web', 'apple_app_store', 'google_play', 'carrier', 'unknown')
  );
