-- 공개 다운로드용 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-releases', 'app-releases', true, 104857600,
  array['application/vnd.android.package-archive','application/octet-stream']::text[]
)
on conflict (id) do nothing;

create policy "app_releases_public_select" on storage.objects for select
  using (bucket_id = 'app-releases');
-- insert/update/delete 정책은 만들지 않는다: service_role은 RLS를 우회하므로 스크립트 업로드에 지장 없고,
-- anon/authenticated는 쓰기 권한이 없어야 하므로 정책을 아예 안 만드는 게 맞다.

-- 버전 추적 테이블
create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'android',
  version text not null,
  version_code int not null,
  storage_path text not null,
  file_size bigint,
  is_current boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (platform, version_code)
);

-- 플랫폼당 "현재 버전"은 하나만 존재하도록 DB 레벨에서 강제
create unique index app_releases_one_current_per_platform
  on public.app_releases (platform) where (is_current);

alter table public.app_releases enable row level security;
create policy "app_releases_public_select" on public.app_releases for select
  using (true);
-- 쓰기 정책 없음: service_role만 기록 가능.
