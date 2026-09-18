-- subscriptions.category(text check) -> category_id(uuid fk) 교체.
-- 0001의 시스템 카테고리 백필이 먼저 끝나 있어야 아래 매핑이 성립한다.

-- FK는 NO ACTION(기본)을 쓴다. 계정 삭제로 categories와 subscriptions가 같은 문장에서
-- 함께 cascade될 때 무결성 검사가 문장 끝에 수행되어야 삭제가 막히지 않는다.
-- RESTRICT는 문장 도중에 즉시 검사하므로 이 상황에서 계정 삭제를 실패시킨다.
alter table public.subscriptions
  add column category_id uuid references public.categories(id);

update public.subscriptions s
set category_id = c.id
from public.categories c
where c.user_id = s.user_id
  and c.key = s.category
  and s.category_id is null;

-- 매칭 실패분은 '기타'로 보낸다. not null 승격 전에 빈 값을 남기지 않기 위한 안전망.
update public.subscriptions s
set category_id = c.id
from public.categories c
where c.user_id = s.user_id
  and c.key = 'etc'
  and s.category_id is null;

alter table public.subscriptions alter column category_id set not null;

-- 컬럼을 지우면 category in (...) check 제약도 함께 사라진다.
alter table public.subscriptions drop column category;

create index subscriptions_user_category_idx
  on public.subscriptions (user_id, category_id);
