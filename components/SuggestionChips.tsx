import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

type SuggestionChipsProps = {
  suggestions: string[];
  disabled?: boolean;
  onSelect: (text: string) => void;
};

export function SuggestionChips({ suggestions, disabled, onSelect }: SuggestionChipsProps) {
  const colors = useThemeColors();
  if (suggestions.length === 0) return null;

  return (
    <View style={styles.row}>
      {suggestions.map((text) => (
        <Pressable
          key={text}
          onPress={() => onSelect(text)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={text}
          style={[
            styles.chip,
            {
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: disabled ? 0.45 : 1,
            },
          ]}>
          <Text style={[styles.label, { color: colors.text }]}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
