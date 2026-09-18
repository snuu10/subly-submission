-- 사용자별 일일 AI 호출 집계. 클라이언트 직접 접근 불가. Edge Function만 private RPC로 증감.

create schema if not exists private;

create table public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  web_search_count integer not null default 0 check (web_search_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint, usage_date)
);

alter table public.ai_usage_daily enable row level security;

revoke all on public.ai_usage_daily from anon, authenticated;
grant all on public.ai_usage_daily to postgres, service_role;

create or replace function private.get_ai_usage(p_endpoint text)
returns table (request_count integer, web_search_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (timezone('Asia/Seoul', now()))::date;
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint가 필요합니다.';
  end if;

  select d.request_count, d.web_search_count
  into request_count, web_search_count
  from public.ai_usage_daily d
  where d.user_id = uid
    and d.endpoint = p_endpoint
    and d.usage_date = today;

  if not found then
    request_count := 0;
    web_search_count := 0;
  end if;

  return next;
end;
$$;

create or replace function private.increment_ai_usage(p_endpoint text, p_web_search integer default 0)
returns table (request_count integer, web_search_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (timezone('Asia/Seoul', now()))::date;
  search_delta integer := least(greatest(coalesce(p_web_search, 0), 0), 10);
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint가 필요합니다.';
  end if;

  return query
  insert into public.ai_usage_daily as u (
    user_id, endpoint, usage_date, request_count, web_search_count, updated_at
  )
  values (uid, p_endpoint, today, 1, search_delta, now())
  on conflict (user_id, endpoint, usage_date)
  do update set
    request_count = u.request_count + 1,
    web_search_count = u.web_search_count + search_delta,
    updated_at = now()
  returning u.request_count, u.web_search_count;
end;
$$;

revoke all on function private.get_ai_usage(text) from public, anon;
revoke all on function private.increment_ai_usage(text, integer) from public, anon;
grant execute on function private.get_ai_usage(text) to authenticated, service_role;
grant execute on function private.increment_ai_usage(text, integer) to authenticated, service_role;
grant usage on schema private to authenticated, service_role;
