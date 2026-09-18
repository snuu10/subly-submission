import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { AuthError, Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type OAuthProvider = 'google' | 'kakao';

/**
 * 카카오/구글 소셜 로그인.
 *
 * Redirect URLs (Supabase Dashboard > Authentication > URL Configuration):
 * - `subly://auth/callback`  (개발 빌드·스토어 빌드)
 * - `exp://**`               (Expo Go)
 * - 웹 origin (`http://localhost:8081/**` 등, Expo web)
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<Session | null> {
  const redirectTo = getRedirectTo();
  const isNative = Platform.OS !== 'web';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: isNative,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });

  if (error) throw mapOAuthError(error);
  if (!data?.url) throw new Error('로그인 URL을 가져오지 못했습니다.');

  if (!isNative) {
    return null;
  }

  if (Platform.OS === 'android') {
    await WebBrowser.warmUpAsync();
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return null;
    }

    if (result.type !== 'success' || !result.url) {
      throw new Error('로그인이 완료되지 않았습니다.');
    }

    return await createSessionFromUrl(result.url);
  } finally {
    if (Platform.OS === 'android') {
      void WebBrowser.coolDownAsync();
    }
  }
}

function getRedirectTo(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return Linking.createURL('auth/callback');
}

async function createSessionFromUrl(url: string): Promise<Session | null> {
  const params = paramsFromCallbackUrl(url);
  const oauthError = params.get('error_description') ?? params.get('error');
  if (oauthError) {
    throw new Error(humanizeOAuthMessage(oauthError));
  }

  const code = params.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw mapOAuthError(error);
    return data.session;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw mapOAuthError(error);
    return data.session;
  }

  throw new Error('로그인 코드를 받지 못했습니다.');
}

function paramsFromCallbackUrl(url: string): URLSearchParams {
  const params = new URLSearchParams();
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex !== -1) {
    const query = url.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
    new URLSearchParams(query).forEach((value, key) => {
      if (value) params.set(key, value);
    });
  }

  if (hashIndex !== -1) {
    new URLSearchParams(url.slice(hashIndex + 1)).forEach((value, key) => {
      if (value && !params.has(key)) params.set(key, value);
    });
  }

  return params;
}

function mapOAuthError(error: AuthError): Error {
  return new Error(humanizeOAuthMessage(error.message));
}

function humanizeOAuthMessage(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return '이 소셜 로그인이 아직 켜져 있지 않습니다. Supabase Authentication > Providers를 확인해 주세요.';
  }
  if (lower.includes('redirect')) {
    return '리다이렉트 URL이 허용 목록에 없습니다. Supabase URL Configuration을 확인해 주세요.';
  }
  if (lower.includes('access_denied') || lower.includes('user cancelled')) {
    return '소셜 로그인이 취소되었습니다.';
  }

  return message;
}
