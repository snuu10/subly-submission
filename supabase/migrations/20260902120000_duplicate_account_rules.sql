-- 같은 서비스를 하나 더 넣을 때 가입 계정 필수.
-- 계정 중복은 같은 서비스 안에서만 금지한다.
-- 넷플릭스 A계정 + 왓챠 A계정처럼 서비스가 다르면 같은 이메일이어도 된다.

create or replace function public.subscription_duplicate_account_issue(
  p_uid uuid,
  p_name text,
  p_account text,
  p_preset text,
  p_exclude uuid
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_has_sibling boolean;
  v_taken boolean;
  v_account text := nullif(btrim(coalesce(p_account, '')), '');
  v_name_key text := lower(replace(btrim(coalesce(p_name, '')), ' ', ''));
begin
  if v_name_key = '' then
    return null;
  end if;

  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_uid
      and s.is_active
      and (p_exclude is null or s.id is distinct from p_exclude)
      and (
        (nullif(btrim(coalesce(p_preset, '')), '') is not null and s.preset_id = p_preset)
        or (
          (
            p_preset is null or btrim(p_preset) = ''
            or s.preset_id is null
            or s.preset_id = p_preset
          )
          and lower(replace(btrim(s.name), ' ', '')) = v_name_key
        )
      )
  ) into v_has_sibling;

  if not v_has_sibling then
    return null;
  end if;
  if v_account is null then
    return 'required';
  end if;

  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_uid
      and s.is_active
      and (p_exclude is null or s.id is distinct from p_exclude)
      and (
        (nullif(btrim(coalesce(p_preset, '')), '') is not null and s.preset_id = p_preset)
        or (
          (
            p_preset is null or btrim(p_preset) = ''
            or s.preset_id is null
            or s.preset_id = p_preset
          )
          and lower(replace(btrim(s.name), ' ', '')) = v_name_key
        )
      )
      and lower(btrim(coalesce(s.account_id, ''))) = lower(v_account)
  ) into v_taken;

  if v_taken then
    return 'taken';
  end if;
  return null;
end;
$$;

revoke all on function public.subscription_duplicate_account_issue(uuid, text, text, text, uuid)
  from public, anon;
grant execute on function public.subscription_duplicate_account_issue(uuid, text, text, text, uuid)
  to authenticated;

create or replace function public.subscriptions_enforce_duplicate_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_issue text;
  v_identity_changed boolean := true;
begin
  if new.is_active is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_identity_changed :=
      new.name is distinct from old.name
      or new.preset_id is distinct from old.preset_id
      or (old.is_active is not true and new.is_active is true);
  end if;
  v_issue := public.subscription_duplicate_account_issue(
    new.user_id,
    new.name,
    new.account_id,
    new.preset_id,
    case when tg_op = 'UPDATE' then new.id else null end
  );
  -- 이미 있던 중복 구독은 결제일 롤링 등 일반 수정은 통과시키고, 새로 넣거나 서비스가 겹칠 때만 계정을 받는다.
  if v_issue = 'required' and (tg_op = 'INSERT' or v_identity_changed) then
    raise exception '같은 서비스가 이미 있어요. 구분할 가입 계정을 알려 주세요.'
      using errcode = '23514';
  end if;
  if v_issue = 'taken' then
    raise exception '같은 서비스에는 같은 계정을 넣을 수 없어요. 다른 계정을 입력해 주세요.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_duplicate_account on public.subscriptions;
create trigger subscriptions_duplicate_account
before insert or update on public.subscriptions
for each row
execute function public.subscriptions_enforce_duplicate_account();

create unique index if not exists subscriptions_user_name_account_active_uidx
  on public.subscriptions (user_id, lower(replace(btrim(name), ' ', '')), lower(btrim(account_id)))
  where is_active and account_id is not null and btrim(account_id) <> '';
-- user_id + account 단독 유니크가 아니다. 서비스명이 다르면 같은 이메일을 허용한다.
