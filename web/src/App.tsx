import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { completeOAuthFromUrl, consumeOAuthErrorFromUrl } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { DashboardPage } from '@/pages/Dashboard';
import { LoginPage } from '@/pages/Login';
import { PlatformReleasesPage, ReleasesIndexPage } from '@/pages/Releases';

const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
const isReleasesPage = pathname === '/releases' || pathname.startsWith('/releases/');

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    if (isReleasesPage) return;
    let cancelled = false;

    async function boot() {
      const urlError = consumeOAuthErrorFromUrl();
      if (urlError && !cancelled) setOauthError(urlError);

      try {
        await completeOAuthFromUrl();
      } catch (caught) {
        if (!cancelled) {
          setOauthError(caught instanceof Error ? caught.message : 'Google 로그인에 실패했습니다.');
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSession(data.session);
        setReady(true);
      }
    }

    void boot();

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  if (isReleasesPage) {
    if (pathname === '/releases/android') return <PlatformReleasesPage platform="android" />;
    if (pathname === '/releases/ios') return <PlatformReleasesPage platform="ios" />;
    return <ReleasesIndexPage />;
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        준비 중…
      </div>
    );
  }

  // ChatGPT 수정: 계정이 바뀌면 이전 계정의 알림/배지와 진행 중인 조회 상태를 버린다.
  return session ? <DashboardPage key={session.user.id} /> : <LoginPage initialError={oauthError} />;
}
