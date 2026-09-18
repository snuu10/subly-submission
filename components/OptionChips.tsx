import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';

type Option<T extends string> = {
  value: T;
  label: string;
};

type OptionChipsProps<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabledValues?: readonly T[];
  onPressDisabled?: (value: T) => void;
};

export function OptionChips<T extends string>({
  options,
  value,
  onChange,
  disabledValues,
  onPressDisabled,
}: OptionChipsProps<T>) {
  const colors = useThemeColors();

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        const disabled = disabledValues?.includes(option.value) ?? false;
        return (
          <Pressable
            key={option.value}
            onPress={() => (disabled ? onPressDisabled?.(option.value) : onChange(option.value))}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.chipSelected : colors.chip,
                borderColor: selected ? colors.chipSelected : colors.border,
                opacity: disabled ? 0.4 : 1,
              },
            ]}>
            <Text
              style={[
                styles.label,
                { color: selected ? colors.chipSelectedText : colors.text },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
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
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});
