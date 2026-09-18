-- 영수증/결제화면 OCR 업로드 기록
create table public.receipt_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  parsed_result jsonb,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.receipt_uploads enable row level security;

create policy "own_select" on public.receipt_uploads
  for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.receipt_uploads
  for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.receipt_uploads
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.receipt_uploads
  for delete using ((select auth.uid()) = user_id);

create index receipt_uploads_user_created_idx
  on public.receipt_uploads (user_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do nothing;

create policy "receipts_select"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts_update"
  on storage.objects for update
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts_delete"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
