-- 등록 확인 후 만든 구독 id를 세션에 남겨 카드 수정이 그 행을 열 수 있게 한다.

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
  v_locked integer;
  v_expected_raw text;
  v_expected timestamptz;
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

  if v_kind = 'create' then
    v_name := nullif(btrim(coalesce(v_extract ->> 'name', '')), '');
    v_amount := nullif(v_extract ->> 'amount', '')::integer;
    v_cycle := nullif(v_extract ->> 'billing_cycle', '');
    v_category := nullif(v_extract ->> 'category_id', '')::uuid;
    begin
      v_anchor := nullif(v_extract ->> 'anchor_date', '')::date;
    exception
      when others then
        v_anchor := null;
    end;
    if v_name is null or v_amount is null or v_amount <= 0 or v_cycle is null or v_anchor is null then
      return public.assistant_session_result(false, 'invalid_extract', v_row, '등록에 필요한 정보가 부족합니다.');
    end if;
    if v_cycle not in ('monthly', 'yearly', 'weekly') then
      return public.assistant_session_result(false, 'invalid_extract', v_row, '결제 주기를 확인해 주세요.');
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
  elsif v_kind <> 'create' then
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

    v_expected_raw := nullif(btrim(coalesce(v_extract ->> 'expected_updated_at', '')), '');
    if v_expected_raw is not null then
      begin
        v_expected := v_expected_raw::timestamptz;
      exception
        when others then
          return public.assistant_session_result(
            false, 'conflict', v_row,
            '구독 정보가 달라졌습니다. 다시 확인해 주세요.'
          );
      end;
      if date_trunc('milliseconds', timezone('utc', v_sub.updated_at))
        is distinct from date_trunc('milliseconds', timezone('utc', v_expected)) then
        return public.assistant_session_result(
          false, 'conflict', v_row,
          '구독 정보가 달라졌습니다. 다시 확인해 주세요.'
        );
      end if;
    end if;

    if v_kind = 'update' then
      v_amount := coalesce(nullif(v_extract ->> 'amount', '')::integer, v_sub.amount);
      if v_amount is null or v_amount <= 0 then
        return public.assistant_session_result(false, 'invalid_extract', v_row, '금액이 올바르지 않습니다.');
      end if;
    end if;
  end if;

  update public.assistant_sessions set
    pending_action_status = 'completed',
    selected_subscription_id = case
      when v_kind = 'delete' then null
      else coalesce(v_target, selected_subscription_id)
    end,
    candidate_ids = '{}',
    last_result = case
      when jsonb_typeof(last_result) = 'object' then last_result - 'create_draft'
      else last_result
    end,
    version = v_row.version + 1,
    updated_at = pg_catalog.now()
  where user_id = v_uid
    and version = p_expected_version
    and pending_action_status = 'pending'
    and pending_action ->> 'id' = p_action_id::text;

  get diagnostics v_locked = row_count;
  if v_locked = 0 then
    select * into v_row
    from public.assistant_sessions
    where user_id = v_uid;
    if v_row.pending_action_status = 'completed' then
      return public.assistant_session_result(true, 'already_completed', v_row, '이미 적용된 작업입니다.');
    end if;
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 확인해 주세요.'
    );
  end if;

  if v_kind = 'create' then
    v_account := nullif(btrim(coalesce(v_extract ->> 'account_id', '')), '');
    v_preset := nullif(v_extract ->> 'preset_id', '');
    v_memo := nullif(v_extract ->> 'memo', '');
    v_emoji := nullif(v_extract ->> 'emoji', '');

    v_next := public.subscription_next_payment_date(v_anchor, v_cycle);

    insert into public.subscriptions (
      user_id, name, amount, billing_cycle, category_id, anchor_date, next_payment_date,
      is_active, memo, preset_id, emoji, account_id
    ) values (
      v_uid, v_name, v_amount, v_cycle, v_category, v_anchor, v_next,
      true, v_memo, v_preset, v_emoji, v_account
    )
    returning id into v_target;

    update public.assistant_sessions set
      selected_subscription_id = v_target,
      last_result = case
        when jsonb_typeof(last_result) = 'object'
          then last_result || jsonb_build_object('id', v_target::text)
        else jsonb_build_object('id', v_target::text)
      end
    where user_id = v_uid;

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

  select * into v_row
  from public.assistant_sessions
  where user_id = v_uid;

  return public.assistant_session_result(true, 'completed', v_row, '적용했습니다.');
end;
$$;

revoke all on function public.confirm_pending_assistant_action(uuid, integer, uuid)
  from public, anon;
grant execute on function public.confirm_pending_assistant_action(uuid, integer, uuid)
  to authenticated;
