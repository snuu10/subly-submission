import { FormEvent, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';

import { changePassword, hasPasswordIdentity } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const MIN_PASSWORD_LENGTH = 8;

export function AccountSettingsWidget({ onOpenAnnouncements }: { onOpenAnnouncements: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const canChange = hasPasswordIdentity(user);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== nextPassword;
  const canSave =
    Boolean(user?.email) &&
    currentPassword.length > 0 &&
    nextPassword.length >= MIN_PASSWORD_LENGTH &&
    nextPassword === confirmPassword &&
    !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user?.email || !canSave) return;
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      await changePassword(user.email, currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setInfo('비밀번호가 바뀌었습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '변경에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-md rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-extrabold text-text">계정</h2>
      <p className="mt-1 text-sm text-muted">{user?.email ?? '로그인됨'}</p>

      {canChange ? (
        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <h3 className="text-sm font-bold text-text">비밀번호 변경</h3>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="현재 비밀번호"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="새 비밀번호 (8자 이상)"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="새 비밀번호 확인"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          {mismatch ? <p className="text-sm text-danger">비밀번호가 일치하지 않습니다.</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {info ? <p className="text-sm text-muted">{info}</p> : null}
          <button
            type="submit"
            disabled={!canSave}
            className="mt-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? '변경 중…' : '변경'}
          </button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-muted">
          카카오·Google로만 로그인한 계정은 여기서 비밀번호를 바꾸지 않습니다.
        </p>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <button
          type="button"
          onClick={onOpenAnnouncements}
          className="text-sm font-semibold text-primary hover:underline"
        >
          업데이트 내역 보기
        </button>
      </div>
    </section>
  );
}
