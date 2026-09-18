import type { AuthError, Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** ChatGPT 수정: 가입·비밀번호 찾기 인증번호는 6자리로 통일. */
export const SIGNUP_OTP_LENGTH = 6;
export const SIGNUP_OTP_PATTERN = new RegExp(`^\\d{${SIGNUP_OTP_LENGTH}}$`);

function mapAuthError(error: AuthError): Error {
  const message = error.message.toLowerCase();

  if (message.includes('already registered') || message.includes('user already registered')) {
    return new Error('이미 가입된 이메일입니다. 로그인해 주세요.');
  }
  if (message.includes('invalid login credentials')) {
    return new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  if (message.includes('password should be at least') || error.code === 'weak_password') {
    return new Error('비밀번호는 8자 이상이어야 합니다.');
  }
  if (message.includes('invalid email') || error.code === 'email_address_invalid') {
    return new Error('이메일 형식을 확인해 주세요.');
  }
  if (
    error.code === 'otp_expired' ||
    message.includes('otp_expired') ||
    message.includes('token has expired')
  ) {
    return new Error('인증번호가 만료되었습니다. 다시 요청해 주세요.');
  }
  if (error.code === 'otp_disabled') {
    return new Error(
      '이메일 인증이 꺼져 있습니다. Supabase Authentication에서 Confirm email을 켜 주세요.'
    );
  }
  if (message.includes('otp') || message.includes('token has expired') || message.includes('invalid token')) {
    return new Error('인증번호가 올바르지 않습니다.');
  }

  return new Error(error.message);
}

export type SignUpProfile = {
  name: string;
};

export type SignUpResult =
  | { status: 'verified'; session: Session }
  | { status: 'needs_verification' };

function assertNewSignupUser(user: { identities?: { id: string }[] | null } | null) {
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    throw new Error('이미 가입된 이메일입니다. 로그인해 주세요.');
  }
}

export async function signUpWithEmail(
  email: string,
  password: string,
  profile?: SignUpProfile
): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: profile
      ? {
          data: {
            name: profile.name,
          },
        }
      : undefined,
  });
  if (error) throw mapAuthError(error);
  assertNewSignupUser(data.user);
  if (data.session) return { status: 'verified', session: data.session };
  return { status: 'needs_verification' };
}

export async function verifySignupOtp(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'signup',
  });
  if (error) throw mapAuthError(error);
  if (!data.session) {
    throw new Error('인증에 실패했습니다. 번호를 다시 확인해 주세요.');
  }
  return data.session;
}

export async function resendSignupOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
  });
  if (error) throw mapAuthError(error);
}

export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw mapAuthError(error);
  if (!data.session) {
    throw new Error('로그인에 실패했습니다.');
  }
  return data.session;
}

export function hasPasswordIdentity(user: {
  identities?: { provider?: string }[] | null;
  app_metadata?: { provider?: string };
} | null | undefined): boolean {
  if (!user) return false;
  if (user.identities?.some((item) => item.provider === 'email')) return true;
  return user.app_metadata?.provider === 'email';
}

export async function lookupEmailsByName(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('이름을 입력해 주세요.');

  const { data, error } = await supabase.functions.invoke('lookup-email-by-name', {
    body: { name: trimmed },
  });
  if (error) throw new Error(error.message || '아이디 찾기에 실패했습니다.');
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  const emails = data && typeof data === 'object' && Array.isArray((data as { emails?: unknown }).emails)
    ? (data as { emails: unknown[] }).emails.filter((item): item is string => typeof item === 'string')
    : [];
  return emails;
}

export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) throw mapAuthError(error);
}

export async function verifyRecoveryOtp(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'recovery',
  });
  if (error) throw mapAuthError(error);
  if (!data.session) {
    throw new Error('인증에 실패했습니다. 번호를 다시 확인해 주세요.');
  }
  return data.session;
}

export async function updatePassword(password: string): Promise<void> {
  if (password.length < 8) {
    throw new Error('비밀번호는 8자 이상이어야 합니다.');
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw mapAuthError(error);
}

export async function changePassword(email: string, currentPassword: string, nextPassword: string): Promise<void> {
  if (nextPassword.length < 8) {
    throw new Error('비밀번호는 8자 이상이어야 합니다.');
  }
  if (currentPassword === nextPassword) {
    throw new Error('새 비밀번호가 현재 비밀번호와 같습니다.');
  }
  await signInWithEmail(email, currentPassword);
  await updatePassword(nextPassword);
}
