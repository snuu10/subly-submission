-- 2~3단계: 서버 후보 선정 + 비서 확인 후 체크인.
-- 1단계 파일은 수정하지 않는다.

alter table public.usage_checkins
  alter column briefing_event_id drop not null;

alter table public.usage_checkins
  add column if not exists idempotency_key text;

create unique index if not exists usage_checkins_user_idempotency_uidx
  on public.usage_checkins (user_id, idempotency_key)
  where idempotency_key is not null;

-- 후보: 활성 구독만. last_checked_at은 보지 않는다.
-- 체크인 없음 → 생성일(KST)이 오늘-30일 이전.
-- 체크인 있음 → next_check_at이 오늘 이하.
-- 이미 열려 있는 표시 가능 이벤트가 있으면 그걸 재사용한다.
create or replace function public.select_usage_prompt_candidate(
  p_source text default 'home'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date;
  v_sub_id uuid;
  v_event public.briefing_events;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
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
  v_today := (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date;

  select e.* into v_event
  from public.briefing_events e
  where e.user_id = v_uid
    and e.kind = 'usage_prompt'
    and e.status in ('pending', 'displayed', 'snoozed')
    and (e.snoozed_until is null or e.snoozed_until <= pg_catalog.now())
  order by e.expires_at asc
  limit 1;

  if v_event.id is not null then
    return public.briefing_result(
      true, 'reused', v_event, null::public.usage_checkins,
      '이미 열려 있는 질문을 보여줍니다.'
    );
  end if;

  select s.id into v_sub_id
  from public.subscriptions s
  left join lateral (
    select c.next_check_at, c.created_at
    from public.usage_checkins c
    where c.user_id = v_uid and c.subscription_id = s.id
    order by c.created_at desc
    limit 1
  ) latest on true
  where s.user_id = v_uid
    and s.is_active = true
    and (
      (
        latest.next_check_at is null
        and (pg_catalog.timezone('Asia/Seoul', s.created_at))::date <= v_today - 30
      )
      or (
        latest.next_check_at is not null
        and latest.next_check_at <= v_today
      )
    )
  order by
    case when latest.next_check_at is null then 0 else 1 end,
    coalesce(latest.next_check_at, (pg_catalog.timezone('Asia/Seoul', s.created_at))::date) asc,
    s.name asc
  limit 1;

  if v_sub_id is null then
    return public.briefing_result(
      true, 'none',
      null::public.briefing_events, null::public.usage_checkins,
      '지금 물어볼 구독이 없습니다.'
    );
  end if;

  return public.upsert_briefing_event(v_sub_id, 'usage_prompt', p_source);
end;
$$;

-- 비서가 확인 버튼을 누른 뒤에만 호출. 이벤트 없이 체크인할 수 있다.
-- 같은 구독의 열린 홈 이벤트가 있으면 그 이벤트를 answered로 바꾼다.
-- 홈이 먼저 답해 next_check_at이 아직이면 새 행을 넣지 않는다.
create or replace function public.record_assistant_checkin(
  p_subscription_id uuid,
  p_response text,
  p_idempotency_key text,
  p_source text default 'assistant'
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
  v_latest public.usage_checkins;
  v_today date;
  v_next date;
  v_key text;
begin
  if v_uid is null then
    return public.briefing_result(
      false, 'unauthenticated',
      null::public.briefing_events, null::public.usage_checkins,
      '로그인이 필요합니다.'
    );
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    return public.briefing_result(
      false, 'invalid_idempotency_key',
      null::public.briefing_events, null::public.usage_checkins,
      '요청 키가 필요합니다.'
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

  select * into v_checkin
  from public.usage_checkins
  where user_id = v_uid and idempotency_key = v_key;

  if v_checkin.id is not null then
    select * into v_event from public.briefing_events where id = v_checkin.briefing_event_id;
    return public.briefing_result(
      true, 'already_answered', v_event, v_checkin,
      '같은 요청은 한 번만 저장합니다.'
    );
  end if;

  select * into v_sub
  from public.subscriptions
  where id = p_subscription_id and user_id = v_uid
  for update;

  if v_sub.id is null then
    return public.briefing_result(
      false, 'subscription_missing',
      null::public.briefing_events, null::public.usage_checkins,
      '구독을 찾을 수 없습니다.'
    );
  end if;

  if not v_sub.is_active then
    return public.briefing_result(
      false, 'subscription_inactive',
      null::public.briefing_events, null::public.usage_checkins,
      '일시정지된 구독입니다.'
    );
  end if;

  v_today := (pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date;

  select * into v_latest
  from public.usage_checkins
  where user_id = v_uid and subscription_id = v_sub.id
  order by created_at desc
  limit 1;

  -- 홈에서 이미 답해 다음 확인일이 아직이면 오래된 비서 카드가 덮지 못한다.
  if v_latest.id is not null and v_latest.next_check_at > v_today then
    return public.briefing_result(
      true, 'already_answered', null::public.briefing_events, v_latest,
      '이미 저장된 사용 여부입니다. 처음 답을 그대로 둡니다.'
    );
  end if;

  select * into v_event
  from public.briefing_events
  where user_id = v_uid
    and subscription_id = v_sub.id
    and kind = 'usage_prompt'
    and status in ('pending', 'displayed', 'snoozed')
  for update;

  if v_event.id is not null and v_event.status in ('dismissed', 'expired') then
    v_event := null;
  end if;

  if v_event.id is not null and v_event.status = 'answered' then
    select * into v_checkin from public.usage_checkins where briefing_event_id = v_event.id;
    return public.briefing_result(
      true, 'already_answered', v_event, v_checkin,
      '이미 답한 질문입니다. 처음 답을 그대로 둡니다.'
    );
  end if;

  v_next := case p_response
    when 'used_recently' then v_today + 30
    when 'occasionally' then v_today + 14
    else v_today + 7
  end;

  begin
    insert into public.usage_checkins (
      user_id, subscription_id, briefing_event_id, response, source, next_check_at, idempotency_key
    )
    values (
      v_uid, v_sub.id,
      case when v_event.id is not null then v_event.id else null end,
      p_response, p_source, v_next, v_key
    )
    returning * into v_checkin;
  exception
    when unique_violation then
      select * into v_checkin
      from public.usage_checkins
      where user_id = v_uid
        and (
          idempotency_key = v_key
          or (v_event.id is not null and briefing_event_id = v_event.id)
        )
      order by created_at desc
      limit 1;
      if v_event.id is not null then
        select * into v_event from public.briefing_events where id = v_event.id;
      end if;
      return public.briefing_result(
        true, 'already_answered', v_event, v_checkin,
        '이미 저장된 사용 여부입니다. 처음 답을 그대로 둡니다.'
      );
  end;

  if v_event.id is not null then
    update public.briefing_events
    set status = 'answered',
        answered_at = pg_catalog.now(),
        snoozed_until = null
    where id = v_event.id
    returning * into v_event;
  end if;

  return public.briefing_result(
    true, 'answered', v_event, v_checkin,
    '답변을 저장했습니다.'
  );
end;
$$;

revoke all on function public.select_usage_prompt_candidate(text) from public, anon;
revoke all on function public.record_assistant_checkin(uuid, text, text, text) from public, anon;
grant execute on function public.select_usage_prompt_candidate(text) to authenticated;
grant execute on function public.record_assistant_checkin(uuid, text, text, text) to authenticated;
