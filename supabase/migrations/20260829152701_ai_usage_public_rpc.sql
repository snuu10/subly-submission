-- private 스키마는 Data API에 안 열려 .schema('private')가 거절된다.
-- 사용량 RPC는 public에 두되 service_role만 실행 가능하게 두고,
-- Edge Function이 auth.getUser()로 받은 user_id를 넘긴다.
-- SECURITY DEFINER는 쓰지 않는다. service_role이 테이블 GRANT를 이미 갖고 있다.

drop function if exists private.get_ai_usage(text);
drop function if exists private.increment_ai_usage(text, integer);

create or replace function public.get_ai_usage(p_user_id uuid, p_endpoint text)
returns table (request_count integer, web_search_count integer)
language plpgsql
set search_path = public
as $$
declare
  today date := (timezone('Asia/Seoul', now()))::date;
begin
  if p_user_id is null then
    raise exception '인증이 필요합니다.';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint가 필요합니다.';
  end if;

  select d.request_count, d.web_search_count
  into request_count, web_search_count
  from public.ai_usage_daily d
  where d.user_id = p_user_id
    and d.endpoint = p_endpoint
    and d.usage_date = today;

  if not found then
    request_count := 0;
    web_search_count := 0;
  end if;

  return next;
end;
$$;

create or replace function public.increment_ai_usage(
  p_user_id uuid,
  p_endpoint text,
  p_web_search integer default 0
)
returns table (request_count integer, web_search_count integer)
language plpgsql
set search_path = public
as $$
declare
  today date := (timezone('Asia/Seoul', now()))::date;
  search_delta integer := least(greatest(coalesce(p_web_search, 0), 0), 10);
begin
  if p_user_id is null then
    raise exception '인증이 필요합니다.';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint가 필요합니다.';
  end if;

  return query
  insert into public.ai_usage_daily as u (
    user_id, endpoint, usage_date, request_count, web_search_count, updated_at
  )
  values (p_user_id, p_endpoint, today, 1, search_delta, now())
  on conflict (user_id, endpoint, usage_date)
  do update set
    request_count = u.request_count + 1,
    web_search_count = u.web_search_count + search_delta,
    updated_at = now()
  returning u.request_count, u.web_search_count;
end;
$$;

revoke all on function public.get_ai_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.increment_ai_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_ai_usage(uuid, text) to service_role;
grant execute on function public.increment_ai_usage(uuid, text, integer) to service_role;
