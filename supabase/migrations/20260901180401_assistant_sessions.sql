-- 4단계: 유저당 1행의 구조화된 비서 대화 맥락.
-- 말풍선 원문은 저장하지 않는다. 쓰기는 RPC만, 클라이언트는 SELECT.

create table public.assistant_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  last_intent text,
  ranked_subscription_ids uuid[] not null default '{}',
  selected_subscription_id uuid references public.subscriptions(id) on delete set null,
  query_period jsonb,
  billing_channel text
    check (
      billing_channel is null
      or billing_channel in ('direct_web', 'apple_app_store', 'google_play', 'carrier', 'unknown')
    ),
  last_result jsonb,
  candidate_ids uuid[] not null default '{}',
  pending_action jsonb,
  pending_action_status text not null default 'none'
    check (pending_action_status in ('none', 'pending', 'completed', 'expired', 'cancelled')),
  context_expires_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint assistant_sessions_period_object check (
    query_period is null or jsonb_typeof(query_period) = 'object'
  ),
  constraint assistant_sessions_period_size check (
    query_period is null or octet_length(query_period::text) <= 512
  ),
  constraint assistant_sessions_result_object check (
    last_result is null or jsonb_typeof(last_result) = 'object'
  ),
  constraint assistant_sessions_result_size check (
    last_result is null or octet_length(last_result::text) <= 8192
  ),
  constraint assistant_sessions_pending_object check (
    pending_action is null or jsonb_typeof(pending_action) = 'object'
  ),
  constraint assistant_sessions_pending_size check (
    pending_action is null or octet_length(pending_action::text) <= 4096
  )
);

create index assistant_sessions_context_expires_idx
  on public.assistant_sessions (context_expires_at);
create index assistant_sessions_pending_status_idx
  on public.assistant_sessions (pending_action_status);

alter table public.assistant_sessions enable row level security;

create policy "own_select" on public.assistant_sessions
  for select using ((select auth.uid()) = user_id);

revoke all on public.assistant_sessions from anon, authenticated;
grant select on public.assistant_sessions to authenticated;
grant all on public.assistant_sessions to service_role;

create or replace function public.assistant_session_result(
  p_ok boolean,
  p_code text,
  p_session public.assistant_sessions,
  p_message text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', p_ok,
    'code', p_code,
    'session', to_jsonb(p_session),
    'message', p_message
  );
$$;

revoke all on function public.assistant_session_result(boolean, text, public.assistant_sessions, text)
  from public, anon, authenticated;

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
  v_next date := coalesce(p_anchor, p_from);
  v_from date := coalesce(p_from, (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date);
  v_guard integer := 0;
begin
  if v_cycle not in ('monthly', 'yearly', 'weekly') then
    v_cycle := 'monthly';
  end if;

  while v_next < v_from loop
    v_guard := v_guard + 1;
    if v_guard > 600 then
      return v_from;
    end if;
    if v_cycle = 'weekly' then
      v_next := v_next + 7;
    elsif v_cycle = 'yearly' then
      v_next := (v_next + interval '1 year')::date;
    else
      v_next := (v_next + interval '1 month')::date;
    end if;
  end loop;

  return v_next;
end;
$$;

revoke all on function public.subscription_next_payment_date(date, text, date)
  from public, anon, authenticated;

create or replace function public.expire_assistant_session()
returns public.assistant_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
  v_changed boolean := false;
  v_expires timestamptz;
begin
  if v_uid is null then
    return null;
  end if;

  select * into v_row
  from public.assistant_sessions
  where user_id = v_uid;

  if v_row.user_id is null then
    return null;
  end if;

  if v_row.context_expires_at is not null and v_row.context_expires_at <= pg_catalog.now() then
    v_row.ranked_subscription_ids := '{}';
    v_row.selected_subscription_id := null;
    v_row.query_period := null;
    v_row.last_result := null;
    v_row.candidate_ids := '{}';
    v_changed := true;
  end if;

  if v_row.pending_action_status = 'pending' then
    v_expires := null;
    if v_row.pending_action is not null then
      begin
        v_expires := (v_row.pending_action ->> 'expires_at')::timestamptz;
      exception
        when others then
          v_expires := null;
      end;
    end if;
    if v_expires is null or v_expires <= pg_catalog.now() then
      v_row.pending_action_status := 'expired';
      v_changed := true;
    end if;
  end if;

  if v_changed then
    v_row.version := v_row.version + 1;
    v_row.updated_at := pg_catalog.now();
    update public.assistant_sessions set
      version = v_row.version,
      ranked_subscription_ids = v_row.ranked_subscription_ids,
      selected_subscription_id = v_row.selected_subscription_id,
      query_period = v_row.query_period,
      last_result = v_row.last_result,
      candidate_ids = v_row.candidate_ids,
      pending_action_status = v_row.pending_action_status,
      updated_at = v_row.updated_at
    where user_id = v_uid;
  end if;

  return v_row;
end;
$$;

revoke all on function public.expire_assistant_session() from public, anon;
grant execute on function public.expire_assistant_session() to authenticated;

create or replace function public.load_assistant_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
begin
  if v_uid is null then
    return public.assistant_session_result(
      false, 'unauthenticated',
      null::public.assistant_sessions,
      '로그인이 필요합니다.'
    );
  end if;

  v_row := public.expire_assistant_session();
  if v_row.user_id is null then
    return public.assistant_session_result(
      true, 'empty',
      null::public.assistant_sessions,
      '세션이 없습니다.'
    );
  end if;

  return public.assistant_session_result(true, 'ok', v_row, '세션을 불러왔습니다.');
end;
$$;

revoke all on function public.load_assistant_session() from public, anon;
grant execute on function public.load_assistant_session() to authenticated;

create or replace function public.save_assistant_session(
  p_expected_version integer,
  p_last_intent text,
  p_ranked_subscription_ids uuid[],
  p_selected_subscription_id uuid,
  p_query_period jsonb,
  p_billing_channel text,
  p_last_result jsonb,
  p_candidate_ids uuid[],
  p_pending_action jsonb,
  p_pending_action_status text,
  p_context_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
  v_status text := coalesce(p_pending_action_status, 'none');
  v_channel text := nullif(btrim(coalesce(p_billing_channel, '')), '');
begin
  if v_uid is null then
    return public.assistant_session_result(
      false, 'unauthenticated',
      null::public.assistant_sessions,
      '로그인이 필요합니다.'
    );
  end if;

  if v_status not in ('none', 'pending', 'completed', 'expired', 'cancelled') then
    return public.assistant_session_result(
      false, 'invalid_status',
      null::public.assistant_sessions,
      '지원하지 않는 대기 상태입니다.'
    );
  end if;

  if v_channel is not null
    and v_channel not in ('direct_web', 'apple_app_store', 'google_play', 'carrier', 'unknown') then
    v_channel := null;
  end if;

  select * into v_row
  from public.assistant_sessions
  where user_id = v_uid;

  if v_row.user_id is null then
    insert into public.assistant_sessions (
      user_id, version, last_intent, ranked_subscription_ids, selected_subscription_id,
      query_period, billing_channel, last_result, candidate_ids, pending_action,
      pending_action_status, context_expires_at, updated_at
    ) values (
      v_uid, 1, p_last_intent, coalesce(p_ranked_subscription_ids, '{}'),
      p_selected_subscription_id, p_query_period, v_channel, p_last_result,
      coalesce(p_candidate_ids, '{}'), p_pending_action, v_status,
      p_context_expires_at, pg_catalog.now()
    )
    returning * into v_row;

    return public.assistant_session_result(true, 'created', v_row, '세션을 만들었습니다.');
  end if;

  if p_expected_version is null or v_row.version <> p_expected_version then
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 물어봐 주세요.'
    );
  end if;

  update public.assistant_sessions set
    version = v_row.version + 1,
    last_intent = p_last_intent,
    ranked_subscription_ids = coalesce(p_ranked_subscription_ids, '{}'),
    selected_subscription_id = p_selected_subscription_id,
    query_period = p_query_period,
    billing_channel = v_channel,
    last_result = p_last_result,
    candidate_ids = coalesce(p_candidate_ids, '{}'),
    pending_action = p_pending_action,
    pending_action_status = v_status,
    context_expires_at = p_context_expires_at,
    updated_at = pg_catalog.now()
  where user_id = v_uid
  returning * into v_row;

  return public.assistant_session_result(true, 'ok', v_row, '세션을 저장했습니다.');
end;
$$;

revoke all on function public.save_assistant_session(
  integer, text, uuid[], uuid, jsonb, text, jsonb, uuid[], jsonb, text, timestamptz
) from public, anon;
grant execute on function public.save_assistant_session(
  integer, text, uuid[], uuid, jsonb, text, jsonb, uuid[], jsonb, text, timestamptz
) to authenticated;

create or replace function public.bind_pending_assistant_target(
  p_action_id uuid,
  p_subscription_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
  v_pending jsonb;
  v_expires timestamptz;
  v_candidates uuid[];
  v_kind text;
begin
  if v_uid is null then
    return public.assistant_session_result(
      false, 'unauthenticated',
      null::public.assistant_sessions,
      '로그인이 필요합니다.'
    );
  end if;

  v_row := public.expire_assistant_session();
  if v_row.user_id is null then
    return public.assistant_session_result(
      false, 'empty',
      null::public.assistant_sessions,
      '확인할 작업이 없습니다.'
    );
  end if;

  if p_expected_version is null or v_row.version <> p_expected_version then
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 물어봐 주세요.'
    );
  end if;

  if v_row.pending_action_status <> 'pending' or v_row.pending_action is null then
    return public.assistant_session_result(
      false, 'not_pending', v_row,
      '확인할 작업이 없거나 이미 처리됐습니다.'
    );
  end if;

  v_pending := v_row.pending_action;
  if (v_pending ->> 'id') is distinct from p_action_id::text then
    return public.assistant_session_result(
      false, 'action_mismatch', v_row,
      '다른 기기에서 이미 처리된 작업입니다.'
    );
  end if;

  begin
    v_expires := (v_pending ->> 'expires_at')::timestamptz;
  exception
    when others then
      v_expires := null;
  end;
  if v_expires is null or v_expires <= pg_catalog.now() then
    update public.assistant_sessions set
      pending_action_status = 'expired',
      version = v_row.version + 1,
      updated_at = pg_catalog.now()
    where user_id = v_uid
    returning * into v_row;
    return public.assistant_session_result(false, 'expired', v_row, '확인 시간이 지났습니다. 다시 요청해 주세요.');
  end if;

  v_kind := v_pending ->> 'kind';
  if v_kind is null or v_kind = 'create' then
    return public.assistant_session_result(false, 'invalid_kind', v_row, '이 작업은 구독을 고를 필요가 없습니다.');
  end if;

  v_candidates := coalesce(v_row.candidate_ids, '{}');
  if array_length(v_candidates, 1) is not null
    and not (p_subscription_id = any (v_candidates)) then
    return public.assistant_session_result(false, 'not_candidate', v_row, '목록에 있는 구독만 고를 수 있어요.');
  end if;

  if not exists (
    select 1 from public.subscriptions s
    where s.id = p_subscription_id and s.user_id = v_uid
  ) then
    return public.assistant_session_result(false, 'not_found', v_row, '구독을 찾지 못했어요.');
  end if;

  v_pending := jsonb_set(v_pending, '{subscription_id}', to_jsonb(p_subscription_id::text), true);

  update public.assistant_sessions set
    pending_action = v_pending,
    selected_subscription_id = p_subscription_id,
    version = v_row.version + 1,
    updated_at = pg_catalog.now()
  where user_id = v_uid
  returning * into v_row;

  return public.assistant_session_result(true, 'ok', v_row, '구독을 선택했습니다.');
end;
$$;

revoke all on function public.bind_pending_assistant_target(uuid, uuid, integer)
  from public, anon;
grant execute on function public.bind_pending_assistant_target(uuid, uuid, integer)
  to authenticated;

create or replace function public.confirm_pending_assistant_action(
  p_action_id uuid,
  p_expected_version integer,
  p_subscription_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
  v_pending jsonb;
  v_extract jsonb;
  v_expires timestamptz;
  v_kind text;
  v_target uuid;
  v_sub public.subscriptions;
  v_name text;
  v_amount integer;
  v_cycle text;
  v_category uuid;
  v_anchor date;
  v_next date;
  v_account text;
  v_preset text;
  v_memo text;
  v_emoji text;
  v_etc uuid;
begin
  if v_uid is null then
    return public.assistant_session_result(
      false, 'unauthenticated',
      null::public.assistant_sessions,
      '로그인이 필요합니다.'
    );
  end if;

  v_row := public.expire_assistant_session();
  if v_row.user_id is null then
    return public.assistant_session_result(
      false, 'empty',
      null::public.assistant_sessions,
      '확인할 작업이 없습니다.'
    );
  end if;

  if v_row.pending_action_status = 'completed' then
    return public.assistant_session_result(
      true, 'already_completed', v_row,
      '이미 적용된 작업입니다.'
    );
  end if;

  if p_expected_version is null or v_row.version <> p_expected_version then
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 확인해 주세요.'
    );
  end if;

  if v_row.pending_action_status <> 'pending' or v_row.pending_action is null then
    return public.assistant_session_result(
      false, 'not_pending', v_row,
      '확인할 작업이 없거나 시간이 지났습니다.'
    );
  end if;

  v_pending := v_row.pending_action;
  if (v_pending ->> 'id') is distinct from p_action_id::text then
    return public.assistant_session_result(
      false, 'action_mismatch', v_row,
      '다른 기기에서 이미 처리된 작업입니다.'
    );
  end if;

  begin
    v_expires := (v_pending ->> 'expires_at')::timestamptz;
  exception
    when others then
      v_expires := null;
  end;
  if v_expires is null or v_expires <= pg_catalog.now() then
    update public.assistant_sessions set
      pending_action_status = 'expired',
      version = v_row.version + 1,
      updated_at = pg_catalog.now()
    where user_id = v_uid
    returning * into v_row;
    return public.assistant_session_result(false, 'expired', v_row, '확인 시간이 지났습니다. 다시 요청해 주세요.');
  end if;

  v_kind := v_pending ->> 'kind';
  v_extract := coalesce(v_pending -> 'extract', '{}'::jsonb);
  v_target := coalesce(
    nullif(v_pending ->> 'subscription_id', '')::uuid,
    p_subscription_id
  );

  if v_kind is null or v_kind not in ('create', 'update', 'delete', 'pause', 'resume') then
    return public.assistant_session_result(false, 'invalid_kind', v_row, '지원하지 않는 작업입니다.');
  end if;

  if v_kind <> 'create' then
    if v_target is null then
      return public.assistant_session_result(false, 'missing_target', v_row, '적용할 구독을 먼저 골라 주세요.');
    end if;
    if array_length(v_row.candidate_ids, 1) is not null
      and not (v_target = any (v_row.candidate_ids))
      and (v_pending ->> 'subscription_id') is distinct from v_target::text then
      return public.assistant_session_result(false, 'not_candidate', v_row, '목록에 있는 구독만 고를 수 있어요.');
    end if;

    select * into v_sub
    from public.subscriptions
    where id = v_target and user_id = v_uid;

    if v_sub.id is null then
      return public.assistant_session_result(false, 'not_found', v_row, '구독을 찾지 못했어요.');
    end if;
  end if;

  if v_kind = 'create' then
    v_name := nullif(btrim(coalesce(v_extract ->> 'name', '')), '');
    v_amount := nullif(v_extract ->> 'amount', '')::integer;
    v_cycle := coalesce(nullif(v_extract ->> 'billing_cycle', ''), 'monthly');
    v_category := nullif(v_extract ->> 'category_id', '')::uuid;
    v_anchor := coalesce(nullif(v_extract ->> 'anchor_date', '')::date, (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date);
    v_account := nullif(btrim(coalesce(v_extract ->> 'account_id', '')), '');
    v_preset := nullif(v_extract ->> 'preset_id', '');
    v_memo := nullif(v_extract ->> 'memo', '');
    v_emoji := nullif(v_extract ->> 'emoji', '');

    if v_name is null or v_amount is null or v_amount <= 0 then
      return public.assistant_session_result(false, 'invalid_extract', v_row, '등록에 필요한 정보가 부족합니다.');
    end if;
    if v_cycle not in ('monthly', 'yearly', 'weekly') then
      v_cycle := 'monthly';
    end if;
    if v_category is null then
      select c.id into v_etc
      from public.categories c
      where c.user_id = v_uid and c.key = 'etc'
      limit 1;
      v_category := v_etc;
    end if;
    if v_category is null then
      return public.assistant_session_result(false, 'missing_category', v_row, '카테고리를 찾지 못했어요.');
    end if;

    v_next := public.subscription_next_payment_date(v_anchor, v_cycle);

    insert into public.subscriptions (
      user_id, name, amount, billing_cycle, category_id, anchor_date, next_payment_date,
      is_active, memo, preset_id, emoji, account_id
    ) values (
      v_uid, v_name, v_amount, v_cycle, v_category, v_anchor, v_next,
      true, v_memo, v_preset, v_emoji, v_account
    );

  elsif v_kind = 'update' then
    v_name := coalesce(nullif(btrim(coalesce(v_extract ->> 'name', '')), ''), v_sub.name);
    v_amount := coalesce(nullif(v_extract ->> 'amount', '')::integer, v_sub.amount);
    v_cycle := coalesce(nullif(v_extract ->> 'billing_cycle', ''), v_sub.billing_cycle);
    v_category := coalesce(nullif(v_extract ->> 'category_id', '')::uuid, v_sub.category_id);
    v_anchor := coalesce(nullif(v_extract ->> 'anchor_date', '')::date, v_sub.anchor_date);
    v_account := coalesce(nullif(v_extract ->> 'account_id', ''), v_sub.account_id);
    v_preset := coalesce(nullif(v_extract ->> 'preset_id', ''), v_sub.preset_id);
    v_memo := coalesce(nullif(v_extract ->> 'memo', ''), v_sub.memo);
    v_emoji := coalesce(nullif(v_extract ->> 'emoji', ''), v_sub.emoji);
    if v_amount is null or v_amount <= 0 then
      return public.assistant_session_result(false, 'invalid_extract', v_row, '금액이 올바르지 않습니다.');
    end if;
    if v_cycle not in ('monthly', 'yearly', 'weekly') then
      v_cycle := v_sub.billing_cycle;
    end if;
    v_next := public.subscription_next_payment_date(v_anchor, v_cycle);
    update public.subscriptions set
      name = v_name,
      amount = v_amount,
      billing_cycle = v_cycle,
      category_id = v_category,
      anchor_date = v_anchor,
      next_payment_date = v_next,
      account_id = v_account,
      preset_id = v_preset,
      memo = v_memo,
      emoji = v_emoji,
      updated_at = pg_catalog.now()
    where id = v_sub.id and user_id = v_uid;

  elsif v_kind = 'delete' then
    delete from public.subscriptions where id = v_sub.id and user_id = v_uid;

  elsif v_kind = 'pause' then
    update public.subscriptions set
      is_active = false,
      updated_at = pg_catalog.now()
    where id = v_sub.id and user_id = v_uid;

  elsif v_kind = 'resume' then
    update public.subscriptions set
      is_active = true,
      updated_at = pg_catalog.now()
    where id = v_sub.id and user_id = v_uid;
  end if;

  update public.assistant_sessions set
    pending_action_status = 'completed',
    selected_subscription_id = case when v_kind = 'delete' then null else coalesce(v_target, selected_subscription_id) end,
    candidate_ids = '{}',
    version = v_row.version + 1,
    updated_at = pg_catalog.now()
  where user_id = v_uid
  returning * into v_row;

  return public.assistant_session_result(true, 'completed', v_row, '적용했습니다.');
end;
$$;

revoke all on function public.confirm_pending_assistant_action(uuid, integer, uuid)
  from public, anon;
grant execute on function public.confirm_pending_assistant_action(uuid, integer, uuid)
  to authenticated;
