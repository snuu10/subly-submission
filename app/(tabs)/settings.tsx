import { router, Tabs, type Href } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { hasPasswordIdentity } from '@/lib/auth';
import { confirmAction, notify } from '@/lib/confirm';
import { disableCurrentDevice } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

function accountLabel(session: Session | null): string {
  if (session?.user?.email) return session.user.email;

  const provider = session?.user?.app_metadata?.provider;
  if (provider === 'kakao') return '카카오 계정';
  if (provider === 'google') return 'Google 계정';

  return '로그인됨';
}

export default function SettingsScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const [signingOut, setSigningOut] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '확인 불가';
  const configuredBuild = Platform.select({
    android: Constants.expoConfig?.android?.versionCode?.toString(),
    ios: Constants.expoConfig?.ios?.buildNumber,
  });
  const nativeBuildVersion = Constants.expoGoConfig ? null : Application.nativeBuildVersion;
  const buildVersion = configuredBuild ?? nativeBuildVersion ?? '개발 빌드';
  const platformLabel = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web';

  const handleSignOut = async () => {
    if (signingOut) return;

    const ok = await confirmAction({
      title: '로그아웃',
      message: '로그아웃 하시겠어요?',
      confirmLabel: '로그아웃',
      destructive: true,
    });
    if (!ok) return;

    setSigningOut(true);
    await disableCurrentDevice();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSigningOut(false);
      notify('로그아웃 실패', error.message);
      return;
    }
    router.replace('/(onboarding)' as Href);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Tabs.Screen options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>설정</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>계정</Text>
          <Text style={[styles.body, { color: colors.muted }]} numberOfLines={1}>
            {accountLabel(session)}
          </Text>
          {hasPasswordIdentity(session?.user) ? (
            <Pressable
              onPress={() => router.push('/change-password' as Href)}
              style={[styles.changePasswordButton, { borderColor: colors.border }]}>
              <Text style={[styles.changePasswordLabel, { color: colors.text }]}>비밀번호 변경</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            style={[
              styles.signOutButton,
              { borderColor: colors.danger },
              signingOut ? styles.signOutDisabled : null,
            ]}>
            <Text style={[styles.signOutLabel, { color: colors.danger }]}>
              {signingOut ? '로그아웃 중…' : '로그아웃'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push('/announcements' as Href)}
          style={[styles.card, styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.linkTexts}>
            <Text style={[styles.title, { color: colors.text }]}>공지사항</Text>
            <Text style={[styles.body, { color: colors.muted }]}>업데이트 내역과 안내</Text>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            tintColor={colors.muted}
            size={18}
          />
        </Pressable>

        {/* ChatGPT 수정: 앱 설정에서 알림 세부 설정으로 진입한다. */}
        <Pressable
          onPress={() => router.push('/notification-settings' as Href)}
          style={[styles.card, styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.linkTexts}>
            <Text style={[styles.title, { color: colors.text }]}>알림 설정</Text>
            <Text style={[styles.body, { color: colors.muted }]}>결제 알림, 기기 푸시, 매너모드</Text>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            tintColor={colors.muted}
            size={18}
          />
        </Pressable>

        <Pressable
          onPress={() => router.push('/usage-history' as Href)}
          style={[styles.card, styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.linkTexts}>
            <Text style={[styles.title, { color: colors.text }]}>사용 기록</Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              홈·비서에서 답한 사용 여부
            </Text>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            tintColor={colors.muted}
            size={18}
          />
        </Pressable>

        <Pressable
          onPress={() => router.push('/categories' as Href)}
          style={[styles.card, styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.linkTexts}>
            <Text style={[styles.title, { color: colors.text }]}>카테고리 관리</Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              기본 카테고리 숨기기, 내 카테고리 추가
            </Text>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            tintColor={colors.muted}
            size={18}
          />
        </Pressable>

        <Pressable
          onPress={() => router.push('/payment-methods' as Href)}
          style={[styles.card, styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.linkTexts}>
            <Text style={[styles.title, { color: colors.text }]}>결제수단</Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              은행·카드를 직접 등록하고 구독에 연결
            </Text>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            tintColor={colors.muted}
            size={18}
          />
        </Pressable>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>안내</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            subly는 계좌·카드를 자동 연결하지 않고, 직접 등록한 결제수단만 관리합니다.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>앱 정보</Text>
          <View style={styles.versionRow}>
            <Text style={[styles.versionLabel, { color: colors.muted }]}>앱 버전</Text>
            <Text style={[styles.versionValue, { color: colors.text }]}>v{appVersion}</Text>
          </View>
          <View style={styles.versionRow}>
            <Text style={[styles.versionLabel, { color: colors.muted }]}>{platformLabel} 빌드</Text>
            <Text style={[styles.versionValue, { color: colors.text }]}>{buildVersion}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkTexts: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  versionRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  versionLabel: {
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  versionValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.monoBold,
  },
  changePasswordButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    paddingVertical: 10,
  },
  changePasswordLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  signOutButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    paddingVertical: 10,
  },
  signOutDisabled: {
    opacity: 0.6,
  },
  signOutLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
