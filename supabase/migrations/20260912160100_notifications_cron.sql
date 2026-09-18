-- 결제일 알림 생성/발송을 pg_cron + pg_net으로 주기 실행한다.
-- 서비스 롤 키는 파일에 직접 넣지 않고 Vault 시크릿(이름 'service_role_key')을 참조한다.
-- 시크릿은 이 마이그레이션과 별도로 운영자가 다음으로 등록해 둔다:
--   select vault.create_secret('<service_role_key>', 'service_role_key', 'notifications cron auth');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;
grant usage on schema net to postgres, service_role;

select cron.schedule(
  'generate-payment-notifications-hourly',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ikbogbhugowdvrcxggax.supabase.co/functions/v1/generate-payment-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);

select cron.schedule(
  'check-notification-receipts-every-15min',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ikbogbhugowdvrcxggax.supabase.co/functions/v1/check-notification-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);
