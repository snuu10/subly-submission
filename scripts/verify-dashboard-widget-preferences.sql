-- 원격 개발 DB에서 실행하는 회귀 검증. 모든 쓰기는 마지막 ROLLBACK으로 되돌린다.
-- 실행: supabase db query --linked --file scripts/verify-dashboard-widget-preferences.sql

begin;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  (
    select id::text
    from auth.users
    where email = 'tester@subly.app'
    limit 1
  ),
  true
);

set local role authenticated;

do $$
declare
  v_saved jsonb;
  v_loaded jsonb;
  v_restored jsonb;
  v_invalid jsonb;
  v_invalid_hidden jsonb;
begin
  v_saved := public.save_my_dashboard_widget_preferences(
    array[
      'payment-instruments', 'subscriptions', 'mix', 'upcoming',
      'spend', 'category', 'briefing', 'insights'
    ]::text[],
    array['upcoming', 'mix']::text[]
  );

  if v_saved->>'ok' is distinct from 'true'
    or v_saved->'order_ids'->>0 is distinct from 'payment-instruments'
    or v_saved->'hidden_ids' is distinct from '["upcoming", "mix"]'::jsonb then
    raise exception '위젯 설정 저장 검증 실패: %', v_saved;
  end if;

  v_loaded := public.get_my_dashboard_widget_preferences();
  if v_loaded->'order_ids' is distinct from v_saved->'order_ids'
    or v_loaded->'hidden_ids' is distinct from v_saved->'hidden_ids' then
    raise exception '위젯 설정 재조회 검증 실패: %', v_loaded;
  end if;

  v_restored := public.save_my_dashboard_widget_preferences(
    array[
      'payment-instruments', 'subscriptions', 'mix', 'upcoming',
      'spend', 'category', 'briefing', 'insights'
    ]::text[],
    array['mix']::text[]
  );
  if v_restored->>'ok' is distinct from 'true'
    or v_restored->'hidden_ids' is distinct from '["mix"]'::jsonb then
    raise exception '삭제 위젯 복원 검증 실패: %', v_restored;
  end if;

  v_invalid := public.save_my_dashboard_widget_preferences(
    array['insights', 'insights']::text[],
    '{}'::text[]
  );
  if v_invalid->>'code' is distinct from 'invalid_order' then
    raise exception '잘못된 순서 거부 검증 실패: %', v_invalid;
  end if;

  v_invalid_hidden := public.save_my_dashboard_widget_preferences(
    array[
      'insights', 'briefing', 'category', 'spend',
      'upcoming', 'mix', 'subscriptions', 'payment-instruments'
    ]::text[],
    array['briefing']::text[]
  );
  if v_invalid_hidden->>'code' is distinct from 'invalid_hidden' then
    raise exception '기본 위젯 삭제 거부 검증 실패: %', v_invalid_hidden;
  end if;
end;
$$;

reset role;
rollback;
