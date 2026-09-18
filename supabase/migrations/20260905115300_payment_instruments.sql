-- 유저가 직접 등록하는 은행·카드 결제수단. 번호는 뒤 4자만 보관한다.

create table public.payment_instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bank', 'card')),
  institution_key text not null,
  name text not null,
  number_last4 text not null check (number_last4 ~ '^[0-9]{4}$'),
  status text not null default 'in_use'
    check (status in ('undecided', 'unused', 'in_use', 'expired')),
  classification text not null default 'personal'
    check (classification in ('personal', 'corporate')),
  card_type text check (card_type in ('credit', 'check')),
  expiry_month smallint check (expiry_month between 1 and 12),
  expiry_year smallint check (expiry_year between 2000 and 2100),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_instruments_card_fields_ck check (
    (kind = 'bank' and card_type is null and expiry_month is null and expiry_year is null)
    or (kind = 'card' and card_type in ('credit', 'check'))
  )
);

create index payment_instruments_user_kind_idx
  on public.payment_instruments (user_id, kind, created_at desc);

alter table public.payment_instruments enable row level security;

create policy "own_select" on public.payment_instruments
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.payment_instruments
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.payment_instruments
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.payment_instruments
  for delete using ((select auth.uid()) = user_id);

alter table public.subscriptions
  add column payment_instrument_id uuid
    references public.payment_instruments(id) on delete set null;

create index subscriptions_payment_instrument_idx
  on public.subscriptions (payment_instrument_id)
  where payment_instrument_id is not null;

alter table public.payment_instruments replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payment_instruments'
  ) then
    alter publication supabase_realtime add table public.payment_instruments;
  end if;
end $$;
