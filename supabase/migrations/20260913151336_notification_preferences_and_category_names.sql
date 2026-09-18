-- ChatGPT 수정: 사용자별 알림 수신 범위와 매너모드. 행이 없으면 기존 동작(모두 허용)을 유지한다.
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  payment_due_enabled boolean not null default true,
  payment_due_d3_enabled boolean not null default true,
  payment_due_d1_enabled boolean not null default true,
  push_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_select_own" on public.notification_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "notification_preferences_insert_own" on public.notification_preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "notification_preferences_update_own" on public.notification_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.notification_preferences to authenticated;

-- 현재 기기 토큰은 소유자에게 활성 여부만 노출하고 토큰 행 자체는 계속 숨긴다.
create function public.is_notification_device_enabled(p_expo_push_token text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  return exists (
    select 1 from public.notification_devices d
    where d.user_id = v_user_id
      and d.expo_push_token = p_expo_push_token
      and d.enabled
  );
end;
$$;
revoke all on function public.is_notification_device_enabled(text) from public;
grant execute on function public.is_notification_device_enabled(text) to authenticated;

create function public.touch_notification_preferences_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_notification_preferences_updated_at();

-- 알림 생성 여부와 푸시 발송 여부를 분리한다. 푸시를 꺼도 기존 알림함은 유지된다.
create function public.notification_inbox_enabled(p_user uuid, p_offset integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce((
    select p.notifications_enabled
      and p.payment_due_enabled
      and case p_offset
        when 3 then p.payment_due_d3_enabled
        when 1 then p.payment_due_d1_enabled
        else false
      end
    from public.notification_preferences p
    where p.user_id = p_user
  ), true);
$$;

create function public.notification_push_enabled(p_user uuid, p_offset integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select public.notification_inbox_enabled(p_user, p_offset)
    and coalesce((
      select p.push_enabled
      from public.notification_preferences p
      where p.user_id = p_user
    ), true);
$$;

revoke all on function public.notification_inbox_enabled(uuid, integer) from public, anon, authenticated;
revoke all on function public.notification_push_enabled(uuid, integer) from public, anon, authenticated;
grant execute on function public.notification_inbox_enabled(uuid, integer) to service_role;
grant execute on function public.notification_push_enabled(uuid, integer) to service_role;

-- 사용자 설정이 바뀐 뒤 과거 실패 건이 재시도로 발송되지 않도록 선점과 전송 직전에 검사한다.
create or replace function public.validate_notification_delivery(p_id uuid, p_claim uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.notification_push_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.notification_devices device on device.id = d.device_id
    where d.id = p_id and d.claim_token = p_claim and d.status = 'claimed'
      and device.enabled and device.user_id = n.user_id
      and device.user_id = d.attempted_user_id and device.expo_push_token = d.attempted_token
      and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
      and public.notification_push_enabled(n.user_id, n.reminder_offset)
  );
$$;

create or replace function public.claim_notification_deliveries(p_limit integer default 100)
returns table (
  id uuid, notification_id uuid, device_id uuid, user_id uuid, token text,
  title text, body text, subscription_id uuid, claim_token uuid, attempt_count integer, badge integer
)
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.notification_push_deliveries d
    set status = 'retry', next_attempt_at = now(), attempt_count = greatest(0, d.attempt_count - 1)
    where d.status = 'claimed' and d.claimed_at < now() - interval '10 minutes';
  update public.notification_push_deliveries d
    set status = 'unknown', error_code = 'ClaimExpired', checked_at = now()
    where d.status = 'sending' and d.claimed_at < now() - interval '10 minutes';

  update public.notification_push_deliveries d
    set status = 'skipped', error_code = 'NoLongerEligible', checked_at = now()
    from public.notifications n
    where n.id = d.notification_id and d.status in ('pending', 'retry')
      and (
        not public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
        or not public.notification_push_enabled(n.user_id, n.reminder_offset)
      );

  if extract(hour from now() at time zone 'Asia/Seoul') < 9 then return; end if;

  insert into public.notification_push_deliveries (notification_id, device_id)
    select n.id, device.id from public.notifications n
    join public.notification_devices device on device.user_id = n.user_id and device.enabled
    where n.payment_date - n.reminder_offset = (now() at time zone 'Asia/Seoul')::date
      and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
      and public.notification_push_enabled(n.user_id, n.reminder_offset)
    order by n.id, device.id
    on conflict do nothing;

  return query
    with candidates as (
      select d.id from public.notification_push_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_devices device on device.id = d.device_id
      where d.status in ('pending', 'retry') and d.next_attempt_at <= now() and d.attempt_count < 5
        and device.enabled and device.user_id = n.user_id
        and public.notification_is_due(n.subscription_id, n.user_id, n.payment_date, n.reminder_offset)
        and public.notification_push_enabled(n.user_id, n.reminder_offset)
      order by d.next_attempt_at, d.id
      limit least(greatest(p_limit, 1), 100)
      for update of d skip locked
    ), claimed as (
      update public.notification_push_deliveries d
      set status = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(),
        attempt_count = d.attempt_count + 1, attempted_token = device.expo_push_token,
        attempted_user_id = device.user_id,
        expo_ticket_id = null, checked_at = null, error_code = null, error_message = null
      from candidates c, public.notification_devices device
      where d.id = c.id and device.id = d.device_id
      returning d.*
    )
    select d.id, n.id, d.device_id, n.user_id, d.attempted_token, n.title, n.body,
      n.subscription_id, d.claim_token, d.attempt_count,
      (select count(*)::integer from public.notifications unread
        where unread.user_id = n.user_id and unread.read_at is null)
    from claimed d join public.notifications n on n.id = d.notification_id;
end;
$$;

-- 카테고리 표시 이름은 한글·영문·숫자·공백만 허용한다. 기존 행은 보존하되 새 쓰기부터 적용한다.
create function public.normalize_category_name(p_name text)
returns text language sql immutable strict security invoker set search_path = ''
as $$
  select lower(regexp_replace(p_name, '[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+', '', 'g'));
$$;

alter table public.categories
  add column normalized_name text generated always as (public.normalize_category_name(name)) stored;

create index categories_user_normalized_name_idx
  on public.categories (user_id, normalized_name);

alter table public.categories
  add constraint categories_name_format_ck check (
    char_length(name) between 1 and 20
    and name = regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')
    and name !~ '[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ ]'
  ) not valid;

create function public.guard_category_normalized_name()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    if exists (
      select 1 from public.categories c
      where c.user_id = new.user_id
        and c.id <> new.id
        and c.normalized_name = public.normalize_category_name(new.name)
    ) then
      raise exception using
        errcode = '23505',
        constraint = 'categories_user_normalized_name_key',
        message = '같은 카테고리 이름이 이미 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_normalized_name_guard
  before insert or update of name on public.categories
  for each row execute function public.guard_category_normalized_name();
