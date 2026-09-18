-- 숨긴 카테고리도 이름을 계속 점유하지만, 화면에는 보이지 않아 사용자가 원인을 알기 어렵다.
-- 재사용 차단 로직은 그대로 두고, 안내 문구에만 힌트를 추가한다.
create or replace function public.guard_category_normalized_name()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    if exists (
      select 1 from public.categories c
      where c.user_id = new.user_id
        and c.id <> new.id
        and c.normalized_name = public.normalize_category_name(new.name)
    ) then
      raise exception using
        errcode = '23505',
        constraint = 'categories_user_normalized_name_key',
        message = '같은 카테고리 이름이 이미 있습니다. 혹시 숨긴 카테고리 중에 같은 이름이 있는지 확인해 보세요.';
    end if;
  end if;
  return new;
end;
$$;
