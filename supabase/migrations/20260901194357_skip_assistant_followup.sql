-- 후보·확인 카드를 건너뛰면 등록/수정/삭제 후속 맥락만 지운다. 직전 목록 순위는 유지한다.

create or replace function public.cancel_pending_assistant_action(
  p_action_id uuid,
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
      '종료할 작업이 없습니다.'
    );
  end if;

  if v_row.pending_action_status = 'cancelled' then
    return public.assistant_session_result(true, 'already_cancelled', v_row, '이미 종료된 작업입니다.');
  end if;

  if v_row.pending_action_status = 'completed' then
    return public.assistant_session_result(true, 'already_completed', v_row, '이미 적용된 작업입니다.');
  end if;

  if p_expected_version is null or v_row.version <> p_expected_version then
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 확인해 주세요.'
    );
  end if;

  if v_row.pending_action_status <> 'pending' or v_row.pending_action is null then
    return public.assistant_session_result(
      true, 'not_pending', v_row,
      '종료할 작업이 없습니다.'
    );
  end if;

  if (v_row.pending_action ->> 'id') is distinct from p_action_id::text then
    return public.assistant_session_result(
      false, 'action_mismatch', v_row,
      '다른 기기에서 이미 처리된 작업입니다.'
    );
  end if;

  update public.assistant_sessions set
    last_intent = null,
    selected_subscription_id = null,
    last_result = null,
    candidate_ids = '{}',
    pending_action_status = 'cancelled',
    version = v_row.version + 1,
    updated_at = pg_catalog.now()
  where user_id = v_uid
  returning * into v_row;

  return public.assistant_session_result(true, 'cancelled', v_row, '작업을 종료했습니다.');
end;
$$;

revoke all on function public.cancel_pending_assistant_action(uuid, integer) from public, anon;
grant execute on function public.cancel_pending_assistant_action(uuid, integer) to authenticated;

create or replace function public.skip_assistant_followup(
  p_action_id uuid default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.assistant_sessions;
  v_status text;
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
      '건너뛸 작업이 없습니다.'
    );
  end if;

  if p_expected_version is not null and v_row.version <> p_expected_version then
    return public.assistant_session_result(
      false, 'conflict', v_row,
      '다른 기기에서 대화 맥락이 바뀌었습니다. 다시 확인해 주세요.'
    );
  end if;

  if v_row.pending_action_status = 'pending' and v_row.pending_action is not null then
    if p_action_id is not null and (v_row.pending_action ->> 'id') is distinct from p_action_id::text then
      return public.assistant_session_result(
        false, 'action_mismatch', v_row,
        '다른 기기에서 이미 처리된 작업입니다.'
      );
    end if;
    v_status := 'cancelled';
  else
    v_status := v_row.pending_action_status;
  end if;

  update public.assistant_sessions set
    last_intent = null,
    selected_subscription_id = null,
    last_result = null,
    candidate_ids = '{}',
    pending_action_status = v_status,
    version = v_row.version + 1,
    updated_at = pg_catalog.now()
  where user_id = v_uid
  returning * into v_row;

  return public.assistant_session_result(true, 'skipped', v_row, '이 작업을 건너뛰었습니다.');
end;
$$;

revoke all on function public.skip_assistant_followup(uuid, integer) from public, anon;
grant execute on function public.skip_assistant_followup(uuid, integer) to authenticated;
