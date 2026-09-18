import { FormEvent, useEffect, useState } from 'react';

import androidLogo from '../../../assets/images/android.png';
import appStoreLogo from '../../../assets/images/app-store.png';
import { BrandLockup } from '@/components/BrandLockup';
import {
  lookupEmailsByName,
  requestPasswordReset,
  resendSignupOtp,
  SIGNUP_OTP_LENGTH,
  SIGNUP_OTP_PATTERN,
  signInWithEmail,
  signInWithGoogle,
  signInWithKakao,
  signUpWithEmail,
  updatePassword,
  verifyRecoveryOtp,
  verifySignupOtp,
} from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type Mode = 'login' | 'signup' | 'find-id' | 'find-pw';
type FindPwStep = 'email' | 'otp' | 'password';
type Pending = 'email' | 'google' | 'kakao' | 'otp' | 'resend' | 'lookup' | null;

export function LoginPage({ initialError = null }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [findPwStep, setFindPwStep] = useState<FindPwStep>('email');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [foundEmails, setFoundEmails] = useState<string[]>([]);
  const [findIdSearched, setFindIdSearched] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [apkVersion, setApkVersion] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('app_releases')
      .select('version')
      .eq('platform', 'android')
      .eq('is_current', true)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setApkVersion(data.version);
      });
  }, []);

  const busy = pending !== null;
  const trimmedEmail = email.trim();
  const passwordMismatch = passwordConfirm.length > 0 && passwordConfirm !== password;
  const canRequestCode =
    name.trim().length >= 1 &&
    EMAIL_PATTERN.test(trimmedEmail) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    passwordConfirm === password;

  function switchMode(next: Mode) {
    if (busy) return;
    if (mode === 'signup' || next === 'signup') {
      setName('');
      setEmail('');
      setPassword('');
      setPasswordConfirm('');
      setOtp('');
      setNeedsVerification(false);
    }
    setMode(next);
    setFindPwStep('email');
    setFoundEmails([]);
    setFindIdSearched(false);
    setNewPassword('');
    setNewPasswordConfirm('');
    setOtp('');
    setError(null);
    setInfo(null);
    setPasswordConfirm('');
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setPending('email');
    try {
      await signInWithEmail(trimmedEmail, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로그인에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!canRequestCode) {
      setError(
        passwordMismatch ? '비밀번호가 일치하지 않습니다.' : '이름, 이메일, 비밀번호를 확인해 주세요.'
      );
      return;
    }

    setPending('email');
    try {
      const result = await signUpWithEmail(trimmedEmail, password, { name: name.trim() });
      if (result.status === 'verified') return;
      setNeedsVerification(true);
      setOtp('');
      setInfo('이메일로 6자리 숫자를 보냈습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '가입에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onVerifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!SIGNUP_OTP_PATTERN.test(otp)) {
      setError('6자리 숫자를 입력해 주세요.');
      return;
    }

    setPending('otp');
    try {
      await verifySignupOtp(trimmedEmail, otp);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '인증에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    setPending('resend');
    try {
      await resendSignupOtp(trimmedEmail);
      setInfo('이메일로 인증번호를 다시 보냈습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '재발송에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onFindId(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (name.trim().length < 1) {
      setError('이름을 입력해 주세요.');
      return;
    }
    setPending('lookup');
    try {
      const emails = await lookupEmailsByName(name);
      setFoundEmails(emails);
      setFindIdSearched(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '아이디 찾기에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onRequestReset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError('이메일 형식을 확인해 주세요.');
      return;
    }
    setPending('email');
    try {
      await requestPasswordReset(trimmedEmail);
      setOtp('');
      setFindPwStep('otp');
      setInfo('이메일로 6자리 숫자를 보냈습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '발송에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onVerifyReset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!SIGNUP_OTP_PATTERN.test(otp)) {
      setError('6자리 숫자를 입력해 주세요.');
      return;
    }
    setPending('otp');
    try {
      await verifyRecoveryOtp(trimmedEmail, otp);
      setFindPwStep('password');
      setInfo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '인증에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onSaveResetPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    setPending('email');
    try {
      await updatePassword(newPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '변경에 실패했습니다.');
      setPending(null);
    }
  }

  async function onResendReset() {
    setError(null);
    setInfo(null);
    setPending('resend');
    try {
      await requestPasswordReset(trimmedEmail);
      setInfo('이메일로 인증번호를 다시 보냈습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '재발송에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setInfo(null);
    setPending('google');
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google 로그인에 실패했습니다.');
      setPending(null);
    }
  }

  async function onKakao() {
    setError(null);
    setInfo(null);
    setPending('kakao');
    try {
      await signInWithKakao();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '카카오 로그인에 실패했습니다.');
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-8">
        <BrandLockup size="md" />
        <h1 className="mt-2 text-2xl font-extrabold text-text">
          {mode === 'find-id'
            ? '아이디 찾기'
            : mode === 'find-pw'
              ? findPwStep === 'otp'
                ? '이메일 인증'
                : findPwStep === 'password'
                  ? '새 비밀번호'
                  : '비밀번호 찾기'
              : mode === 'login'
                ? '대시보드 로그인'
                : needsVerification
                  ? '이메일 인증'
                  : '대시보드 가입'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === 'find-id'
            ? '가입할 때 넣은 이름을 입력하면 이메일을 마스킹해서 보여 줍니다.'
            : mode === 'find-pw'
              ? findPwStep === 'otp'
                ? `${trimmedEmail}으로 보낸 6자리 숫자를 입력하세요.`
                : findPwStep === 'password'
                  ? '새 비밀번호를 8자 이상으로 넣어 주세요.'
                  : '가입 이메일로 6자리 숫자를 보냅니다.'
              : mode === 'login'
                ? '앱과 같은 계정으로 로그인하며, 세션은 이 브라우저에만 저장됩니다.'
                : needsVerification
                  ? `${trimmedEmail}으로 보낸 6자리 숫자를 입력하면 가입이 완료됩니다.`
                  : '이름과 이메일, 비밀번호를 넣은 뒤 인증번호를 받으면 가입이 완료됩니다.'}
        </p>

        {!isSupabaseConfigured ? (
          <p className="mt-6 rounded-xl bg-rose-bg px-3 py-2 text-sm text-danger">
            web/.env에 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 넣어 주세요.
          </p>
        ) : null}

        {mode === 'login' ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onLogin}>
            <EmailField value={email} onChange={setEmail} disabled={busy} />
            <PasswordField
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={busy}
            />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'email' ? '로그인 중…' : '로그인'}
            </button>
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-muted">
              <button type="button" onClick={() => switchMode('find-id')} disabled={busy}>
                아이디 찾기
              </button>
              <span className="text-border">|</span>
              <button type="button" onClick={() => switchMode('find-pw')} disabled={busy}>
                비밀번호 찾기
              </button>
            </div>
          </form>
        ) : mode === 'find-id' ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onFindId}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              이름
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            {findIdSearched && foundEmails.length === 0 ? (
              <p className="text-sm text-muted">일치하는 계정이 없습니다</p>
            ) : null}
            {foundEmails.map((item) => (
              <p key={item} className="text-base font-bold text-text">
                {item}
              </p>
            ))}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'lookup' ? '찾는 중…' : '찾기'}
            </button>
          </form>
        ) : mode === 'find-pw' && findPwStep === 'email' ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onRequestReset}>
            <EmailField value={email} onChange={setEmail} disabled={busy} />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'email' ? '보내는 중…' : '인증번호 받기'}
            </button>
          </form>
        ) : mode === 'find-pw' && findPwStep === 'otp' ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onVerifyReset}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              인증번호
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={SIGNUP_OTP_LENGTH}
                placeholder="6자리 숫자"
                required
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, '').slice(0, SIGNUP_OTP_LENGTH))
                }
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal tracking-[0.3em] outline-none focus:border-primary"
              />
            </label>
            {info ? <p className="text-sm text-muted">{info}</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !SIGNUP_OTP_PATTERN.test(otp)}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'otp' ? '확인 중…' : '인증하기'}
            </button>
            <button
              type="button"
              onClick={() => void onResendReset()}
              disabled={busy || !isSupabaseConfigured}
              className="text-sm font-semibold text-primary disabled:opacity-60"
            >
              {pending === 'resend' ? '다시 보내는 중…' : '인증번호 다시 받기'}
            </button>
          </form>
        ) : mode === 'find-pw' && findPwStep === 'password' ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onSaveResetPassword}>
            <PasswordField
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              disabled={busy}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={
                busy ||
                !isSupabaseConfigured ||
                newPassword.length < MIN_PASSWORD_LENGTH ||
                newPassword !== newPasswordConfirm
              }
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'email' ? '변경 중…' : '비밀번호 변경'}
            </button>
          </form>
        ) : needsVerification ? (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onVerifyCode}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              인증번호
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={SIGNUP_OTP_LENGTH}
                placeholder="6자리 숫자"
                required
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, '').slice(0, SIGNUP_OTP_LENGTH))
                }
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal tracking-[0.3em] outline-none focus:border-primary"
              />
            </label>
            {info ? <p className="text-sm text-muted">{info}</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !SIGNUP_OTP_PATTERN.test(otp)}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'otp' ? '확인 중…' : '인증하기'}
            </button>
            <button
              type="button"
              onClick={() => void onResend()}
              disabled={busy || !isSupabaseConfigured}
              className="text-sm font-semibold text-primary disabled:opacity-60"
            >
              {pending === 'resend' ? '다시 보내는 중…' : '인증번호 다시 받기'}
            </button>
          </form>
        ) : (
          <form className="mt-8 flex flex-col gap-4" onSubmit={onRequestCode}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              이름
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            <EmailField value={email} onChange={setEmail} disabled={busy} />
            <PasswordField
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={busy}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                required
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            {passwordMismatch ? (
              <p className="text-sm text-danger">비밀번호가 일치하지 않습니다.</p>
            ) : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !canRequestCode}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending === 'email' ? '보내는 중…' : '인증 요청'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
          disabled={busy}
          className="mt-4 w-full text-center text-sm font-semibold text-muted disabled:opacity-60"
        >
          {mode === 'login' ? '처음이신가요? 가입하기' : '로그인으로 돌아가기'}
        </button>

        {mode === 'login' || mode === 'signup' ? (
          <>
            <div className="mt-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted">또는</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={() => void onKakao()}
              disabled={busy || !isSupabaseConfigured}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] px-4 py-3 text-sm font-bold text-[#191919] disabled:opacity-60"
            >
              <KakaoMark />
              {pending === 'kakao' ? '카카오로 이동 중…' : '카카오로 시작하기'}
            </button>

            <button
              type="button"
              onClick={() => void onGoogle()}
              disabled={busy || !isSupabaseConfigured}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-bold text-text disabled:opacity-60"
            >
              <GoogleMark />
              {pending === 'google' ? 'Google로 이동 중…' : 'Google로 시작하기'}
            </button>
          </>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-3 border-t border-border pt-4">
          <a
            href="/releases/android"
            className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-text"
          >
            <img src={androidLogo} alt="" className="size-4" />
            Android{apkVersion ? ` (v${apkVersion})` : ''}
          </a>
          <span className="text-border">|</span>
          <a
            href="/releases/ios"
            className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-text"
          >
            <img src={appStoreLogo} alt="" className="size-4" />
            iOS
          </a>
        </div>
      </div>
    </div>
  );
}

function EmailField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
      이메일
      <input
        type="email"
        autoComplete="email"
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary disabled:opacity-60"
      />
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
      비밀번호
      <input
        type="password"
        autoComplete={autoComplete}
        required
        minLength={MIN_PASSWORD_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary disabled:opacity-60"
      />
    </label>
  );
}

function KakaoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#191919"
        d="M12 3C6.48 3 2 6.48 2 10.78c0 2.75 1.84 5.17 4.62 6.55-.2.75-.73 2.72-.84 3.14-.13.51.19.5.4.37.16-.11 2.6-1.76 3.66-2.48.68.1 1.39.15 2.16.15 5.52 0 10-3.48 10-7.73C22 6.48 17.52 3 12 3z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
