-- ChatGPT 수정 아님 — 장애 수정: ensure_default_categories()가 ON CONFLICT DO NOTHING으로
-- 기존 시스템 카테고리 재삽입을 건너뛰려 했지만, BEFORE INSERT 트리거
-- guard_category_normalized_name()이 충돌 판정보다 먼저 실행되어 23505로 실패했다.
-- (Postgres는 INSERT ... ON CONFLICT에서도 충돌 여부를 판정하기 전에 BEFORE ROW 트리거를
-- 대상 행에 대해 실행한다.) 이미 있는 시스템 카테고리는 애초에 INSERT 대상에서
-- 제외해 트리거가 실행될 일이 없도록 한다. 동시 호출 안전을 위해 사용자 단위
-- advisory lock을 트리거와 같은 키 공간(hashtext(user_id::text))으로 획득한다.
create or replace function public.ensure_default_categories()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext(uid::text));

  insert into public.categories (user_id, key, name, color, is_system, is_hidden)
  select uid, s.key, s.name, s.color, true, false
  from public.system_category_seed() s
  where not exists (
    select 1 from public.categories c
    where c.user_id = uid and c.key = s.key
  );
end;
$$;
