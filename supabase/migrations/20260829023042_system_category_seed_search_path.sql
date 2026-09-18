-- system_category_seed()는 VALUES만 쓰지만, 공개 스키마 함수는 search_path를 고정해야
-- 역할이 바뀐 뒤에도 다른 스키마의 동명 객체를 타지 않는다.
alter function public.system_category_seed() set search_path = public;
