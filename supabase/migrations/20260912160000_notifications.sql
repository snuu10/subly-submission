-- 결제일 D-3/D-1 알림. 서버(Edge Function + Cron)가 생성하고 Expo Push로 발송한다.
-- 설계 근거: docs/notification-implementation-plan.md

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid null references public.subscriptions(id) on delete set null,
  kind text not null default 'payment_due' check (kind = 'payment_due'),
  payment_date date not null,
  reminder_offset integer not null check (reminder_offset in (1, 3)),
  title text not null,
  body text not null,
  target_path text null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sent', 'partial', 'failed', 'skipped')),
  push_sent_at timestamptz null,
  unique (user_id, subscription_id, payment_date, reminder_offset)
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

-- 사용자는 read_at만 바꿀 수 있어야 하므로 select만 열고, 나머지 열 변경은 트리거로 막는다.
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
     or new.subscription_id is distinct from old.subscription_id
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

create trigger notifications_guard_update_trigger
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

-- 기기 토큰. RLS는 활성화만 해두고 정책은 두지 않아 authenticated/anon 직접 접근을 막고,
-- 아래 SECURITY DEFINER RPC로만 등록/비활성화하게 한다 (expo_push_token unique 충돌 시
-- 소유자가 바뀌는 케이스를 RLS 정책만으로 안전하게 표현하기 어렵기 때문).
create table public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  device_key text null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_devices_user_idx on public.notification_devices (user_id) where enabled;

alter table public.notification_devices enable row level security;

create or replace function public.register_notification_device(
  p_expo_push_token text,
  p_platform text,
  p_device_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'invalid platform';
  end if;

  insert into public.notification_devices (user_id, expo_push_token, platform, device_key, enabled, last_seen_at, updated_at)
  values (v_user_id, p_expo_push_token, p_platform, p_device_key, true, now(), now())
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    device_key = coalesce(excluded.device_key, public.notification_devices.device_key),
    enabled = true,
    last_seen_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.register_notification_device(text, text, text) from public;
grant execute on function public.register_notification_device(text, text, text) to authenticated;

create or replace function public.disable_notification_device(p_expo_push_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_devices
  set enabled = false, updated_at = now()
  where expo_push_token = p_expo_push_token and user_id = auth.uid();
end;
$$;

revoke all on function public.disable_notification_device(text) from public;
grant execute on function public.disable_notification_device(text) to authenticated;

-- 기기별 발송/수신 확인 기록. 서버(service_role)만 다룬다.
create table public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.notification_devices(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'ticket_ok', 'delivered', 'error', 'unknown')),
  expo_ticket_id text null,
  error_code text null,
  error_message text null,
  sent_at timestamptz null,
  checked_at timestamptz null,
  unique (notification_id, device_id)
);

create index notification_push_deliveries_pending_idx
  on public.notification_push_deliveries (status, sent_at);

alter table public.notification_push_deliveries enable row level security;
