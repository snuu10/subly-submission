import type { Announcement } from '@/lib/announcements';

const URL_RE = /(https?:\/\/[^\s]+)/g;

function linkifyBody(body: string) {
  return body.split(URL_RE).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary underline"
      >
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AnnouncementDetailModal({
  announcement,
  onClose,
}: {
  announcement: Announcement;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {announcement.tag ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-primary">
                {announcement.tag}
              </span>
            ) : null}
            <h2 className="text-lg font-extrabold text-text">{announcement.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent hover:text-text"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">{formatDate(announcement.published_at)}</p>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text">
          {linkifyBody(announcement.body)}
        </p>
      </div>
    </div>
  );
}
