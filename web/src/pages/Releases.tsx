import { useEffect, useState } from 'react';

import androidLogo from '../../../assets/images/android.png';
import appStoreLogo from '../../../assets/images/app-store.png';
import { BrandLockup } from '@/components/BrandLockup';
import { supabase } from '@/lib/supabase';

type Platform = 'android' | 'ios';

type ReleaseRow = {
  id: string;
  version: string;
  version_code: number;
  file_size: number | null;
  is_current: boolean;
  notes: string | null;
  created_at: string;
  storage_path: string;
};

const PLATFORM_META = {
  android: {
    logo: androidLogo,
    title: 'Android',
    description: 'APK 파일을 내려받아 직접 설치합니다.',
    comingSoonMessage: '아직 배포된 버전이 없습니다.',
  },
  ios: {
    logo: appStoreLogo,
    title: 'iOS',
    description: 'App Store 출시 전까지는 여기서 IPA를 내려받아 설치합니다.',
    comingSoonMessage: '곧 업로드 예정입니다.',
  },
} as const;

function downloadUrl(storagePath: string): string {
  return `/api/download-release?key=${encodeURIComponent(storagePath)}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function usePlatformReleases(platform: Platform) {
  const [releases, setReleases] = useState<ReleaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('app_releases')
      .select('id, version, version_code, file_size, is_current, notes, created_at, storage_path')
      .eq('platform', platform)
      .order('version_code', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        setReleases(data ?? []);
      });
  }, [platform]);

  return { releases, error };
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <a href="/" className="text-sm font-semibold text-muted hover:text-text">
          ← 돌아가기
        </a>
        <div className="mt-4">
          <BrandLockup size="md" />
        </div>
        {children}
      </div>
    </div>
  );
}

function ReleaseCard({ release }: { release: ReleaseRow }) {
  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold text-text">v{release.version}</span>
          {release.is_current ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-primary">
              최신
            </span>
          ) : null}
        </div>
        <a
          href={downloadUrl(release.storage_path)}
          className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-white"
        >
          다운로드
        </a>
      </div>
      <p className="mt-1 text-xs text-muted">
        {formatDate(release.created_at)} · versionCode {release.version_code}
        {release.file_size ? ` · ${formatSize(release.file_size)}` : ''}
      </p>
      {release.notes ? (
        <p className="mt-2 whitespace-pre-line text-sm text-text">{release.notes}</p>
      ) : null}
    </li>
  );
}

export function PlatformReleasesPage({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform];
  const { releases, error } = usePlatformReleases(platform);
  const [showPast, setShowPast] = useState(false);

  const current = releases?.find((release) => release.is_current) ?? null;
  const past = releases?.filter((release) => !release.is_current) ?? [];

  return (
    <PageShell>
      <div className="mt-2 flex items-center gap-2">
        <img src={meta.logo} alt="" className="size-7" />
        <h1 className="text-2xl font-extrabold text-text">{meta.title} 앱 다운로드</h1>
      </div>
      <p className="mt-2 text-sm text-muted">{meta.description}</p>

      {error ? (
        <p className="mt-6 rounded-xl bg-rose-bg px-3 py-2 text-sm text-danger">{error}</p>
      ) : releases === null ? (
        <p className="mt-6 text-sm text-muted">불러오는 중…</p>
      ) : releases.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-4 text-sm text-muted">
          {meta.comingSoonMessage}
        </p>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {current ? <ReleaseCard release={current} /> : null}
          </ul>

          {past.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowPast((value) => !value)}
                className="flex w-full items-center justify-between rounded-2xl border border-dashed border-border p-4 text-sm font-semibold text-muted hover:border-primary hover:text-text"
              >
                <span>이전 버전 ({past.length})</span>
                <span className={showPast ? 'rotate-180 transition-transform' : 'transition-transform'}>
                  ▾
                </span>
              </button>
              {showPast ? (
                <ul className="mt-3 flex flex-col gap-3">
                  {past.map((release) => (
                    <ReleaseCard key={release.id} release={release} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  );
}

export function ReleasesIndexPage() {
  return (
    <PageShell>
      <h1 className="mt-2 text-2xl font-extrabold text-text">앱 다운로드</h1>
      <p className="mt-2 text-sm text-muted">플랫폼을 선택하세요.</p>
      <div className="mt-6 flex flex-col gap-3">
        <a
          href="/releases/android"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary"
        >
          <img src={androidLogo} alt="" className="size-8" />
          <span className="text-base font-extrabold text-text">Android</span>
        </a>
        <a
          href="/releases/ios"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary"
        >
          <img src={appStoreLogo} alt="" className="size-8" />
          <span className="text-base font-extrabold text-text">iOS</span>
        </a>
      </div>
    </PageShell>
  );
}
