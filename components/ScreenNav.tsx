import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

type ScreenNavProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  showBack?: boolean;
  right?: ReactNode;
};

export function ScreenNav({ title, subtitle, onBack, showBack = true, right }: ScreenNavProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.nav,
        {
          backgroundColor: colors.surface,
          paddingTop: insets.top + 10,
        },
      ]}>
      {showBack ? (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          style={styles.back}
          accessibilityLabel="뒤로">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export function ScreenShell({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return <View style={[styles.shell, { backgroundColor: colors.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  right: {
    marginLeft: 8,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
