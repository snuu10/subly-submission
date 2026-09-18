import { Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

type AssistantTabButtonProps = {
  onPress?: PressableProps['onPress'];
  accessibilityState?: { selected?: boolean };
};

export function AssistantTabButton({ onPress, accessibilityState }: AssistantTabButtonProps) {
  const colors = useThemeColors();
  const focused = Boolean(accessibilityState?.selected);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="비서"
      style={styles.wrap}>
      <View style={[styles.circle, { backgroundColor: colors.primary }]}>
        <SymbolView
          name={{ ios: 'bubble.left.fill', android: 'chat_bubble', web: 'chat_bubble' }}
          tintColor="#FFFFFF"
          size={22}
        />
      </View>
      <Text
        style={[
          styles.label,
          {
            color: focused ? colors.primary : colors.muted,
            fontFamily: focused ? fonts.sansBold : fonts.sansMedium,
          },
        ]}>
        비서
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    top: -18,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
  },
});
