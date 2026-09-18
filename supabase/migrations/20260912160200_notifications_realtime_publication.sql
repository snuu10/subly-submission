-- notifications 테이블 변경을 웹/앱 realtime 채널로 브로드캐스트하기 위해 publication에 추가한다.
-- subscriptions/categories/payment_instruments도 이미 같은 방식으로 등록되어 있다.
alter publication supabase_realtime add table public.notifications;
