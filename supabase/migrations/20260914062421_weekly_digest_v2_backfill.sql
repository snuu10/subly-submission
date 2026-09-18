-- 기존 주간 다이제스트 캐시를 구조화 카드가 읽을 수 있는 v2 payload로 보강한다.
-- 사용자별 금액은 이미 계산된 캐시 값만 사용하며 구독 원본 데이터는 변경하지 않는다.
update public.ai_briefings
set payload = payload || jsonb_build_object(
  'version', 2,
  'week_start', week_start::text,
  'week_end', (week_start + 6)::text,
  'delta', (payload->>'this_week')::numeric - (payload->>'last_week')::numeric,
  'trend', case
    when (payload->>'this_week')::numeric > (payload->>'last_week')::numeric then 'up'
    when (payload->>'this_week')::numeric < (payload->>'last_week')::numeric then 'down'
    else 'same'
  end,
  'reason', case
    when (payload->>'this_week')::numeric > (payload->>'last_week')::numeric
      then '이번 주 결제 예정 금액이 지난주보다 많아요.'
    when (payload->>'this_week')::numeric < (payload->>'last_week')::numeric
      then '이번 주 결제 예정 금액이 지난주보다 적어요.'
    else '지난주와 결제 예정 금액이 같아요.'
  end,
  'charges', '[]'::jsonb,
  'generated_at', created_at
)
where kind = 'weekly_digest'
  and payload->>'version' is distinct from '2'
  and jsonb_typeof(payload->'this_week') = 'number'
  and jsonb_typeof(payload->'last_week') = 'number';
