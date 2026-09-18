-- 알림 길게 누르기 메뉴의 "삭제"용. 기존엔 select/update 정책만 있었다.

create policy "notifications_delete_own" on public.notifications
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant delete on table public.notifications to authenticated;
