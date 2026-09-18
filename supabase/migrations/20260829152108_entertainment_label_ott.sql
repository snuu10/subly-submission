-- 시스템 카테고리 entertainment 표시명을 엔터테인먼트에서 OTT로 바꾼다. 내부 키는 유지한다.

create or replace function public.system_category_seed()
returns table (key text, name text, color text)
language sql
immutable
set search_path = public
as $$
  values
    ('entertainment'::text, 'OTT'::text, '#E11D48'::text),
    ('music',    '음악',       '#7C3AED'),
    ('work',     '업무',       '#2563EB'),
    ('health',   '건강',       '#059669'),
    ('education','교육',       '#D97706'),
    ('cloud',    '클라우드',   '#0891B2'),
    ('etc',      '기타',       '#6B7280')
$$;

-- 아직 기본 이름을 쓰는 행만 갱신. 같은 계정에 이미 OTT가 있으면 유니크 충돌을 피한다.
update public.categories c
set name = 'OTT'
where c.key = 'entertainment'
  and c.name = '엔터테인먼트'
  and not exists (
    select 1
    from public.categories other
    where other.user_id = c.user_id
      and other.name = 'OTT'
      and other.id <> c.id
  );
