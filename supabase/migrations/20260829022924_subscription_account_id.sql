-- 구독별 가입 계정(이메일/아이디). 프로토타입 단계라 비밀번호는 저장하지 않는다.
alter table public.subscriptions add column account_id text;
