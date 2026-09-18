import { supabase } from '@/lib/supabase';

export type Announcement = {
  id: string;
  title: string;
  body: string;
  tag: string | null;
  published_at: string;
};

const UNREAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseAnnouncement(row: Record<string, unknown>): Announcement | null {
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string') {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tag: typeof row.tag === 'string' ? row.tag : null,
    published_at: typeof row.published_at === 'string' ? row.published_at : new Date().toISOString(),
  };
}

export async function fetchAnnouncements(
  limit: number,
  offset: number
): Promise<{ items: Announcement[]; total: number }> {
  const { data, error, count } = await supabase
    .from('announcements')
    .select('id, title, body, tag, published_at', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return { items: [], total: 0 };
  const items = data
    .map((row) => parseAnnouncement(row as Record<string, unknown>))
    .filter((item): item is Announcement => item !== null);
  return { items, total: count ?? items.length };
}

export async function getMyAnnouncementLastReadAt(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('announcement_reads')
    .select('last_read_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return typeof data?.last_read_at === 'string' ? data.last_read_at : null;
}

export async function markAnnouncementsRead(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('announcement_reads')
    .upsert({ user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: 'user_id' });
}

/** 최근 7일 이내 발행 + 마지막으로 읽은 시각 이후에 올라온 것만 배지 카운트에 넣는다. */
export function countUnreadRecent(items: Announcement[], lastReadAt: string | null): number {
  const cutoff = Date.now() - UNREAD_WINDOW_MS;
  const lastRead = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  return items.filter((item) => {
    const publishedAt = new Date(item.published_at).getTime();
    return publishedAt >= cutoff && publishedAt > lastRead;
  }).length;
}
