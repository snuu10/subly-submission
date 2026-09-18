-- 기본 6개 커스텀(이름변경·삭제) + 이름 유니크 + 기타 제외 최소 1개.
-- 시딩은 카테고리가 없을 때만 7개를 넣고, 이후에는 기타만 없으면 기타만 보정한다.

create unique index categories_user_name_idx
  on public.categories (user_id, name);

create or replace function public.ensure_default_categories()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing integer;
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;

  select count(*) into existing
  from public.categories
  where user_id = uid;

  if existing = 0 then
    insert into public.categories (user_id, key, name, color, is_system, is_hidden)
    select uid, s.key, s.name, s.color, true, false
    from public.system_category_seed() s
    on conflict (user_id, key) where key is not null do nothing;
    return;
  end if;

  insert into public.categories (user_id, key, name, color, is_system, is_hidden)
  select uid, s.key, s.name, s.color, true, false
  from public.system_category_seed() s
  where s.key = 'etc'
  on conflict (user_id, key) where key is not null do nothing;
end;
$$;

drop policy if exists "own_delete" on public.categories;
create policy "own_delete" on public.categories
  for delete using ((select auth.uid()) = user_id and key is distinct from 'etc');

create or replace function public.delete_custom_category(p_category_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target public.categories;
  etc_id uuid;
  non_etc integer;
begin
  if uid is null then
    raise exception '인증이 필요합니다.';
  end if;

  select * into target
  from public.categories
  where id = p_category_id and user_id = uid;

  if not found then
    raise exception '카테고리를 찾을 수 없습니다.';
  end if;

  if target.key = 'etc' then
    raise exception '기타 카테고리는 삭제할 수 없습니다.';
  end if;

  select count(*) into non_etc
  from public.categories
  where user_id = uid and key is distinct from 'etc';

  if non_etc <= 1 then
    raise exception '기타를 제외한 카테고리는 최소 1개가 있어야 합니다.';
  end if;

  select id into etc_id
  from public.categories
  where user_id = uid and key = 'etc';

  if etc_id is null then
    raise exception '기타 카테고리가 없습니다.';
  end if;

  update public.subscriptions
  set category_id = etc_id, updated_at = now()
  where user_id = uid and category_id = target.id;

  delete from public.categories where id = target.id;
end;
$$;

create or replace function public.protect_etc_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.key = 'etc' then
    if new.name is distinct from old.name
      or new.key is distinct from old.key
      or new.is_hidden is distinct from old.is_hidden
      or new.is_system is distinct from old.is_system then
      raise exception '기타 카테고리는 변경할 수 없습니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_protect_etc on public.categories;
create trigger categories_protect_etc
  before update on public.categories
  for each row execute function public.protect_etc_category();

-- BEFORE DELETE 시점에는 삭제 대상 row가 아직 남아 있으므로 count <= 1이면 마지막 1개다.
create or replace function public.prevent_last_non_etc_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.key is not distinct from 'etc' then
    raise exception '기타 카테고리는 삭제할 수 없습니다.';
  end if;

  if (
    select count(*)
    from public.categories
    where user_id = old.user_id and key is distinct from 'etc'
  ) <= 1 then
    raise exception '기타를 제외한 카테고리는 최소 1개가 있어야 합니다.';
  end if;

  return old;
end;
$$;

drop trigger if exists categories_prevent_last_non_etc on public.categories;
create trigger categories_prevent_last_non_etc
  before delete on public.categories
  for each row execute function public.prevent_last_non_etc_delete();
