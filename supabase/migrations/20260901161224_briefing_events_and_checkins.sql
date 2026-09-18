-- 홈 브리핑 질문(briefing_events)과 사용 여부 답변(usage_checkins).
--
-- 1단계 범위: 스키마 + RPC만. 홈 카드·AI 비서·last_checked_at·ai_briefings(unused_nudge)
-- 동작은 바꾸지 않는다. 이 테이블은 2단계에서 홈이 붙기 전까지 비어 있다.
--
-- 원칙
-- 1. 클라이언트는 두 테이블을 SELECT만 한다. 쓰기는 전부 RPC.
-- 2. user_id는 auth.uid()만 쓴다. 클라이언트가 보낸 user_id/기간/dedupe_key/payload는 받지 않는다.
-- 3. 기간·dedupe_key·payload는 서버가 Asia/Seoul과 현재 subscriptions 행으로 만든다.
-- 4. 예상 가능한 결과는 예외가 아니라 {ok, code, event, checkin, message}로 돌려준다.
--    상태를 바꾼 뒤 raise 해서 트랜잭션을 롤백시키는 경로를 두지 않는다.
-- 5. security definer 함수는 search_path = ''이고 객체를 완전한 이름으로 부른다.

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------

create table public.briefing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 구독이 사라지면 질문과 답변도 함께 사라진다. 삭제한 구독의 이름·금액이
  -- payload 스냅샷으로 남지 않게 하려는 것이므로 set null이 아니라 cascade다.
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  kind text not null check (kind in ('usage_prompt')),
  status text not null default 'pending'
    check (status in ('pending', 'displayed', 'answered', 'snoozed', 'dismissed', 'expired')),
  -- 서버 생성: 'usage_prompt:{subscription_id}:{period_start}'
  dedupe_key text not null,
  period_start date not null,
  period_end date not null,
  -- 화면 표시용 스냅샷. 허용 키는 정확히 6개:
  --   name, amount, billing_cycle, kind, period_start, period_end
  -- 실제 작업 대상은 언제나 subscription_id로 현재 subscriptions를 다시 읽어 정한다.
  payload jsonb not null,
  source text not null default 'home' check (source in ('home', 'assistant', 'push')),
  snoozed_until timestamptz,
  -- 이 시각이 지난 미완료 이벤트는 RPC 진입 시 expired로 바뀐다. pg_cron은 쓰지 않는다.
  expires_at timestamptz not null,
  expired_reason text
    check (expired_reason is null or expired_reason in ('subscription_inactive', 'period_elapsed')),
  displayed_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint briefing_events_period_order check (period_end >= period_start),
  constraint briefing_events_user_dedupe_uniq unique (user_id, dedupe_key),

  constraint briefing_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint briefing_events_payload_size check (octet_length(payload::text) <= 2048),
  constraint briefing_events_payload_required check (
    payload ?& array['name', 'amount', 'billing_cycle', 'kind', 'period_start', 'period_end']
  ),
  constraint briefing_events_payload_no_extra check (
    payload - array['name', 'amount', 'billing_cycle', 'kind', 'period_start', 'period_end']
      = '{}'::jsonb
  ),
  constraint briefing_events_payload_name check (
    char_length(payload ->> 'name') between 1 and 80
  ),
  constraint briefing_events_payload_amount check (
    jsonb_typeof(payload -> 'amount') = 'number'
  ),
  constraint briefing_events_payload_cycle check (
    payload ->> 'billing_cycle' in ('monthly', 'yearly', 'weekly')
  ),
  constraint briefing_events_payload_kind check (payload ->> 'kind' = kind)
);

-- 같은 구독·같은 종류에 미완료 이벤트는 하나만. 스누즈로 주가 넘어가도 새 행을 만들지 않는다.
create unique index briefing_events_open_one_idx
  on public.briefing_events (user_id, subscription_id, kind)
  where status in ('pending', 'displayed', 'snoozed');

create index briefing_events_user_status_expires_idx
  on public.briefing_events (user_id, status, expires_at);
create index briefing_events_user_sub_created_idx
  on public.briefing_events (user_id, subscription_id, created_at desc);

-- 답변은 추가만 한다. 수정·삭제 RPC를 두지 않는다.
create table public.usage_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  -- 이벤트가 지워지면 답변도 함께. 이벤트당 답변은 하나.
  briefing_event_id uuid not null unique references public.briefing_events(id) on delete cascade,
  -- 사용 여부만 담는다. keep(유지 결정)과 review_later(나중에 보기)는 여기 넣지 않는다.
  -- review_later는 briefing_events.status = 'snoozed'로 처리한다.
  response text not null
    check (response in ('used_recently', 'occasionally', 'not_used', 'unsure')),
  source text not null check (source in ('home', 'assistant', 'push')),
  -- 서버 계산(KST): used_recently +30, occasionally +14, not_used +7, unsure +7
  next_check_at date not null,
  created_at timestamptz not null default now()
);

create index usage_checkins_user_sub_created_idx
  on public.usage_checkins (user_id, subscription_id, created_at desc);
create index usage_checkins_user_next_check_idx
  on public.usage_checkins (user_id, next_check_at);

-- ---------------------------------------------------------------------------
-- RLS / GRANT — 클라이언트는 SELECT만
-- ---------------------------------------------------------------------------

alter table public.briefing_events enable row level security;
alter table public.usage_checkins enable row level security;

create policy "own_select" on public.briefing_events
  for select using ((select auth.uid()) = user_id);
create policy "own_select" on public.usage_checkins
  for select using ((select auth.uid()) = user_id);

revoke all on public.briefing_events from anon, authenticated;
revoke all on public.usage_checkins from anon, authenticated;
grant select on public.briefing_events to authenticated;
grant select on public.usage_checkins to authenticated;
grant all on public.briefing_events to service_role;
grant all on public.usage_checkins to service_role;

-- ---------------------------------------------------------------------------
-- 내부 헬퍼 (클라이언트 실행 권한 없음)
-- ---------------------------------------------------------------------------

-- 모든 RPC가 같은 모양으로 답한다. 조합이 전부 null인 composite는 IS NULL이 참이므로
-- 값을 못 찾은 경우에도 event/checkin이 json null로 나간다.
create or replace function public.briefing_result(
  p_ok boolean,
  p_code text,
  p_event public.briefing_events,
  p_checkin public.usage_checkins,
  p_message text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ok', p_ok,
    'code', p_code,
    'event', case when p_event is null then null else pg_catalog.to_jsonb(p_event) end,
    'checkin', case when p_checkin is null then null else pg_catalog.to_jsonb(p_checkin) end,
    'message', p_message
  );
$$;

-- payload는 항상 현재 subscriptions 행으로만 만든다. 클라이언트 입력을 받지 않는다.
create or replace function public.briefing_payload(
  p_sub public.subscriptions,
  p_kind text,
  p_period_start date,
  p_period_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'name', pg_catalog.left(p_sub.name, 80),
    'amount', p_sub.amount,
    'billing_cycle', p_sub.billing_cycle,
    'kind', p_kind,
    'period_start', pg_catalog.to_char(p_period_start, 'YYYY-MM-DD'),
    'period_end', pg_catalog.to_char(p_period_end, 'YYYY-MM-DD')
  );
$$;

-- 모든 이벤트 RPC가 진입 직후 호출한다. 직접 SELECT는 상태를 못 바꾸므로,
-- SELECT를 쓰는 클라이언트는 expires_at이 지난 행을 활성으로 취급하면 안 된다.
create or replace function public.expire_stale_briefing_events(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.briefing_events
  set status = 'expired',
      expired_reason = 'period_elapsed'
  where user_id = p_user_id
    and status in ('pending', 'displayed', 'snoozed')
    and expires_at <= pg_catalog.now();
end;
$$;

create or replace function public.trg_briefing_events_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger briefing_events_touch
  before update on public.briefing_events
  for each row execute function public.trg_briefing_events_touch();

-- 구독을 일시정지하면 미완료 질문을 닫는다. authenticated에는 briefing_events UPDATE
-- 권한이 없으므로 definer로 돈다. true -> false로 실제로 바뀐 경우에만 실행된다.
create or replace function public.trg_expire_briefing_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active is true and new.is_active is false then
    update public.briefing_events
    set status = 'expired',
        expired_reason = 'subscription_inactive'
    where user_id = new.user_id
      and subscription_id = new.id
      and status in ('pending', 'displayed', 'snoozed');
  end if;

  return null;
end;
$$;

create trigger subscriptions_expire_briefing_on_deactivate
  after update of is_active on public.subscriptions
  for each row
  when (old.is_active is true and new.is_active is false)
  execute function public.trg_expire_briefing_on_deactivate();

-- ---------------------------------------------------------------------------
-- 공개 RPC
-- ---------------------------------------------------------------------------

create or replace function public.upsert_briefing_event(
  p_subscription_id uuid,
  p_kind text default 'usage_prompt',
  p_source text default 'home'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sub public.subscriptions;
  v_event public.briefing_events;
  v_checkin public.usage_checkins;
  v_today date;
  v_period_start date;
  v_period_end date;
  v_dedupe text;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  if p_kind is distinct from 'usage_prompt' then
    return public.briefing_result(
      false, 'invalid_kind',
      null::public.briefing_events, null::public.usage_checkins,
      '지원하지 않는 이벤트 종류입니다.'
    );
  end if;

  if p_source is null or p_source not in ('home', 'assistant', 'push') then
    return public.briefing_result(
      false, 'invalid_source',
      null::public.briefing_events, null::public.usage_checkins,
      '지원하지 않는 요청 출처입니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  select * into v_sub
  from public.subscriptions
  where id = p_subscription_id and user_id = v_uid;

  if v_sub.id is null then
    return public.briefing_result(
      false, 'subscription_missing',
      null::public.briefing_events, null::public.usage_checkins,
      '구독을 찾을 수 없습니다.'
    );
  end if;

  -- 일시정지된 구독은 묻지 않는다. 열려 있던 질문은 닫고 결과로 알린다(예외 아님).
  if not v_sub.is_active then
    update public.briefing_events
    set status = 'expired',
        expired_reason = 'subscription_inactive'
    where user_id = v_uid
      and subscription_id = v_sub.id
      and kind = p_kind
      and status in ('pending', 'displayed', 'snoozed');

    return public.briefing_result(
      false, 'subscription_inactive',
      null::public.briefing_events, null::public.usage_checkins,
      '일시정지된 구독입니다.'
    );
  end if;

  select * into v_event
  from public.briefing_events
  where user_id = v_uid
    and subscription_id = v_sub.id
    and kind = p_kind
    and status in ('pending', 'displayed', 'snoozed')
  limit 1;

  if v_event.id is not null then
    return public.briefing_result(
      true, 'reused', v_event, null::public.usage_checkins,
      '이미 열려 있는 질문을 그대로 씁니다.'
    );
  end if;

  v_today := (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date;

  select * into v_checkin
  from public.usage_checkins
  where user_id = v_uid and subscription_id = v_sub.id
  order by created_at desc
  limit 1;

  if v_checkin.id is not null and v_checkin.next_check_at > v_today then
    return public.briefing_result(
      false, 'prompt_not_due', null::public.briefing_events, v_checkin,
      '아직 다시 물어볼 때가 아닙니다.'
    );
  end if;

  -- ISO 요일: 월=1. 그 주 월요일부터 일요일까지.
  v_period_start := v_today - (pg_catalog.date_part('isodow', v_today)::int - 1);
  v_period_end := v_period_start + 6;
  v_dedupe := 'usage_prompt:' || v_sub.id::text || ':'
    || pg_catalog.to_char(v_period_start, 'YYYY-MM-DD');

  begin
    insert into public.briefing_events (
      user_id, subscription_id, kind, status, dedupe_key,
      period_start, period_end, payload, source, expires_at
    )
    values (
      v_uid, v_sub.id, p_kind, 'pending', v_dedupe,
      v_period_start, v_period_end,
      public.briefing_payload(v_sub, p_kind, v_period_start, v_period_end),
      p_source,
      pg_catalog.timezone('Asia/Seoul', (v_period_end + 1)::timestamp)
    )
    on conflict (user_id, dedupe_key) do nothing
    returning * into v_event;
  exception
    when unique_violation then
      -- 다른 기기가 같은 순간에 열린 이벤트를 만든 경우(부분 유니크 인덱스).
      v_event := null::public.briefing_events;
  end;

  if v_event.id is null then
    select * into v_event
    from public.briefing_events
    where user_id = v_uid
      and (
        dedupe_key = v_dedupe
        or (
          subscription_id = v_sub.id
          and kind = p_kind
          and status in ('pending', 'displayed', 'snoozed')
        )
      )
    order by created_at desc
    limit 1;

    return public.briefing_result(
      true, 'reused', v_event, null::public.usage_checkins,
      '같은 질문이 이미 있습니다.'
    );
  end if;

  return public.briefing_result(
    true, 'created', v_event, null::public.usage_checkins,
    '질문을 만들었습니다.'
  );
end;
$$;

-- 만료 정리 후 지금 물어볼 수 있는 질문 하나를 돌려준다. 홈은 한 장만 보여준다.
create or replace function public.list_my_briefing_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.briefing_events;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  select * into v_event
  from public.briefing_events
  where user_id = v_uid
    and status in ('pending', 'displayed', 'snoozed')
    and (snoozed_until is null or snoozed_until <= pg_catalog.now())
  order by expires_at asc
  limit 1;

  if v_event.id is null then
    return public.briefing_result(
      true, 'none',
      null::public.briefing_events, null::public.usage_checkins,
      '지금 보여줄 질문이 없습니다.'
    );
  end if;

  return public.briefing_result(
    true, 'found', v_event, null::public.usage_checkins,
    '보여줄 질문이 있습니다.'
  );
end;
$$;

create or replace function public.mark_briefing_event_displayed(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.briefing_events;
  v_sub public.subscriptions;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  select * into v_event
  from public.briefing_events
  where id = p_event_id and user_id = v_uid
  for update;

  if v_event.id is null then
    return public.briefing_result(
      false, 'event_not_found',
      null::public.briefing_events, null::public.usage_checkins,
      '질문을 찾을 수 없습니다.'
    );
  end if;

  if v_event.status in ('answered', 'dismissed', 'expired') then
    return public.briefing_result(
      false, 'event_closed', v_event, null::public.usage_checkins,
      '이미 끝난 질문입니다.'
    );
  end if;

  if v_event.status = 'displayed' then
    return public.briefing_result(
      true, 'displayed', v_event, null::public.usage_checkins,
      '이미 표시된 질문입니다.'
    );
  end if;

  if v_event.status = 'snoozed'
    and v_event.snoozed_until is not null
    and v_event.snoozed_until > pg_catalog.now() then
    return public.briefing_result(
      false, 'still_snoozed', v_event, null::public.usage_checkins,
      '아직 미루기 기간입니다.'
    );
  end if;

  select * into v_sub
  from public.subscriptions
  where id = v_event.subscription_id and user_id = v_uid;

  if v_sub.id is null then
    update public.briefing_events
    set status = 'expired', expired_reason = 'period_elapsed'
    where id = v_event.id
    returning * into v_event;

    return public.briefing_result(
      false, 'subscription_missing', v_event, null::public.usage_checkins,
      '구독을 찾을 수 없습니다.'
    );
  end if;

  if not v_sub.is_active then
    update public.briefing_events
    set status = 'expired', expired_reason = 'subscription_inactive'
    where id = v_event.id
    returning * into v_event;

    return public.briefing_result(
      false, 'subscription_inactive', v_event, null::public.usage_checkins,
      '일시정지된 구독입니다.'
    );
  end if;

  -- 스누즈에서 돌아오면 같은 행을 다시 쓴다. snoozed_until은 비운다.
  update public.briefing_events
  set status = 'displayed',
      snoozed_until = null,
      displayed_at = pg_catalog.now(),
      payload = public.briefing_payload(v_sub, v_event.kind, v_event.period_start, v_event.period_end)
  where id = v_event.id
  returning * into v_event;

  return public.briefing_result(
    true, 'displayed', v_event, null::public.usage_checkins,
    '질문을 표시했습니다.'
  );
end;
$$;

-- 체크인 저장과 answered 전환을 한 트랜잭션에서 처리한다.
create or replace function public.answer_briefing_checkin(
  p_event_id uuid,
  p_response text,
  p_source text default 'home'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.briefing_events;
  v_checkin public.usage_checkins;
  v_sub public.subscriptions;
  v_today date;
  v_next date;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  if p_response is null
    or p_response not in ('used_recently', 'occasionally', 'not_used', 'unsure') then
    return public.briefing_result(
      false, 'invalid_response',
      null::public.briefing_events, null::public.usage_checkins,
      '지원하지 않는 응답입니다.'
    );
  end if;

  if p_source is null or p_source not in ('home', 'assistant', 'push') then
    return public.briefing_result(
      false, 'invalid_source',
      null::public.briefing_events, null::public.usage_checkins,
      '지원하지 않는 요청 출처입니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  -- 같은 질문에 두 기기가 동시에 답해도 한 번만 저장되도록 행을 잠근다.
  select * into v_event
  from public.briefing_events
  where id = p_event_id and user_id = v_uid
  for update;

  if v_event.id is null then
    return public.briefing_result(
      false, 'event_not_found',
      null::public.briefing_events, null::public.usage_checkins,
      '질문을 찾을 수 없습니다.'
    );
  end if;

  if v_event.status = 'answered' then
    select * into v_checkin
    from public.usage_checkins
    where briefing_event_id = v_event.id;

    return public.briefing_result(
      true, 'already_answered', v_event, v_checkin,
      '이미 답한 질문입니다. 처음 답을 그대로 둡니다.'
    );
  end if;

  if v_event.status in ('dismissed', 'expired') then
    return public.briefing_result(
      false, 'event_closed', v_event, null::public.usage_checkins,
      '이미 끝난 질문입니다.'
    );
  end if;

  -- payload가 아니라 현재 구독 행으로 소유권과 상태를 다시 확인한다.
  select * into v_sub
  from public.subscriptions
  where id = v_event.subscription_id and user_id = v_uid;

  if v_sub.id is null then
    update public.briefing_events
    set status = 'expired', expired_reason = 'period_elapsed'
    where id = v_event.id
    returning * into v_event;

    return public.briefing_result(
      false, 'subscription_missing', v_event, null::public.usage_checkins,
      '구독을 찾을 수 없습니다.'
    );
  end if;

  if not v_sub.is_active then
    update public.briefing_events
    set status = 'expired', expired_reason = 'subscription_inactive'
    where id = v_event.id
    returning * into v_event;

    return public.briefing_result(
      false, 'subscription_inactive', v_event, null::public.usage_checkins,
      '일시정지된 구독입니다.'
    );
  end if;

  v_today := (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date;
  v_next := case p_response
    when 'used_recently' then v_today + 30
    when 'occasionally' then v_today + 14
    else v_today + 7
  end;

  insert into public.usage_checkins (
    user_id, subscription_id, briefing_event_id, response, source, next_check_at
  )
  values (v_uid, v_sub.id, v_event.id, p_response, p_source, v_next)
  returning * into v_checkin;

  update public.briefing_events
  set status = 'answered',
      answered_at = pg_catalog.now(),
      snoozed_until = null
  where id = v_event.id
  returning * into v_event;

  return public.briefing_result(
    true, 'answered', v_event, v_checkin,
    '답변을 저장했습니다.'
  );
end;
$$;

-- 나중에 보기. 기본 7일이며 클라이언트가 기간을 정하지 않는다.
create or replace function public.snooze_briefing_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.briefing_events;
  v_until timestamptz;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  select * into v_event
  from public.briefing_events
  where id = p_event_id and user_id = v_uid
  for update;

  if v_event.id is null then
    return public.briefing_result(
      false, 'event_not_found',
      null::public.briefing_events, null::public.usage_checkins,
      '질문을 찾을 수 없습니다.'
    );
  end if;

  if v_event.status in ('answered', 'dismissed', 'expired') then
    return public.briefing_result(
      false, 'event_closed', v_event, null::public.usage_checkins,
      '이미 끝난 질문입니다.'
    );
  end if;

  v_until := pg_catalog.now() + interval '7 days';

  -- 숨기는 7일 + 다시 보여줄 7일. 그 안에 안 보면 period_elapsed로 만료된다.
  update public.briefing_events
  set status = 'snoozed',
      snoozed_until = v_until,
      expires_at = v_until + interval '7 days'
  where id = v_event.id
  returning * into v_event;

  return public.briefing_result(
    true, 'snoozed', v_event, null::public.usage_checkins,
    '7일 뒤에 다시 물어봅니다.'
  );
end;
$$;

create or replace function public.dismiss_briefing_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.briefing_events;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  perform public.expire_stale_briefing_events(v_uid);

  select * into v_event
  from public.briefing_events
  where id = p_event_id and user_id = v_uid
  for update;

  if v_event.id is null then
    return public.briefing_result(
      false, 'event_not_found',
      null::public.briefing_events, null::public.usage_checkins,
      '질문을 찾을 수 없습니다.'
    );
  end if;

  if v_event.status in ('answered', 'dismissed', 'expired') then
    return public.briefing_result(
      false, 'event_closed', v_event, null::public.usage_checkins,
      '이미 끝난 질문입니다.'
    );
  end if;

  update public.briefing_events
  set status = 'dismissed'
  where id = v_event.id
  returning * into v_event;

  return public.briefing_result(
    true, 'dismissed', v_event, null::public.usage_checkins,
    '이번 질문을 닫았습니다.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 실행 권한: 내부 헬퍼와 트리거는 아무에게도 주지 않고, 공개 RPC만 authenticated
-- ---------------------------------------------------------------------------

revoke all on function public.briefing_result(
  boolean, text, public.briefing_events, public.usage_checkins, text
) from public, anon, authenticated;
revoke all on function public.briefing_payload(
  public.subscriptions, text, date, date
) from public, anon, authenticated;
revoke all on function public.expire_stale_briefing_events(uuid)
  from public, anon, authenticated;
revoke all on function public.trg_briefing_events_touch()
  from public, anon, authenticated;
revoke all on function public.trg_expire_briefing_on_deactivate()
  from public, anon, authenticated;

revoke all on function public.upsert_briefing_event(uuid, text, text)
  from public, anon;
revoke all on function public.list_my_briefing_events()
  from public, anon;
revoke all on function public.mark_briefing_event_displayed(uuid)
  from public, anon;
revoke all on function public.answer_briefing_checkin(uuid, text, text)
  from public, anon;
revoke all on function public.snooze_briefing_event(uuid)
  from public, anon;
revoke all on function public.dismiss_briefing_event(uuid)
  from public, anon;

grant execute on function public.upsert_briefing_event(uuid, text, text) to authenticated;
grant execute on function public.list_my_briefing_events() to authenticated;
grant execute on function public.mark_briefing_event_displayed(uuid) to authenticated;
grant execute on function public.answer_briefing_checkin(uuid, text, text) to authenticated;
grant execute on function public.snooze_briefing_event(uuid) to authenticated;
grant execute on function public.dismiss_briefing_event(uuid) to authenticated;
