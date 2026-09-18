import { useEffect, useState } from 'react';

import { fetchAnnouncements, markAnnouncementsRead, type Announcement } from '@/lib/announcements';

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AnnouncementsListWidget({
  onSelectAnnouncement,
}: {
  onSelectAnnouncement: (item: Announcement) => void;
}) {
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void markAnnouncementsRead();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAnnouncements(PAGE_SIZE, page * PAGE_SIZE).then(({ items: pageItems, total: pageTotal }) => {
      if (cancelled) return;
      setItems(pageItems);
      setTotal(pageTotal);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-extrabold text-text">공지사항</h2>
      {loading ? (
        <p className="mt-6 text-sm text-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-muted">등록된 공지사항이 없어요.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelectAnnouncement(item)}
                className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {item.tag ? (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-primary">
                      {item.tag}
                    </span>
                  ) : null}
                  <span className="truncate text-sm font-semibold text-text">{item.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDate(item.published_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-1">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-accent disabled:opacity-40"
            aria-label="이전 페이지"
          >
            ‹
          </button>
          {Array.from({ length: pageCount }, (_, index) => index).map((index) => (
            <button
              key={index}
              type="button"
              onClick={() => setPage(index)}
              className={`flex size-8 items-center justify-center rounded-lg text-sm font-semibold ${
                index === page ? 'bg-primary text-white' : 'text-muted hover:bg-accent'
              }`}
            >
              {index + 1}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-accent disabled:opacity-40"
            aria-label="다음 페이지"
          >
            ›
          </button>
        </div>
      ) : null}
    </section>
  );
}
