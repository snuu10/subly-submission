-- 숨김/삭제는 "구독 재배정 + 카테고리 상태 변경"이 한 몸이어야 한다. 클라이언트에서
-- 두 번 호출하면 중간 실패 시 카테고리는 사라졌는데 구독은 그 id를 가리키는 상태가 된다.
-- 함수 본문이 곧 하나의 트랜잭션이므로 여기로 옮겨 원자성을 확보한다.
--
-- 역할 분담: 숨김은 시스템 전용, 삭제는 커스텀 전용. 기타는 어느 쪽도 불가.

create or replace function public.hide_category(p_category_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target public.categories;
  etc_id uuid;
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

  -- 일반 규칙을 먼저 걸러 오해 소지 있는 메시지를 피한다.
  if not target.is_system then
    raise exception '커스텀 카테고리는 숨길 수 없습니다. 삭제를 사용하세요.';
  end if;

  if target.key = 'etc' then
    raise exception '기타 카테고리는 숨길 수 없습니다.';
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

  update public.categories set is_hidden = true where id = target.id;
end;
$$;

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

  if target.is_system then
    raise exception '기본 카테고리는 삭제할 수 없습니다.';
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
