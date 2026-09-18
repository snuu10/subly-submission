import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';

export default function NotFoundScreen() {
  const colors = useThemeColors();

  return (
    <>
      <Stack.Screen options={{ title: '화면을 찾을 수 없음', headerShown: true }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>이 화면은 없습니다.</Text>
        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>홈으로 돌아가기</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  link: {
    marginTop: 16,
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
