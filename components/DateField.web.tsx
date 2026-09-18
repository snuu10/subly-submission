import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export type DateFieldProps = {
  /** 'yyyy-MM-dd' */
  value: string;
  onChange: (value: string) => void;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

export function DateField({ value, onChange }: DateFieldProps) {
  const colors = useThemeColors();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleChange = (next: string) => {
    setDraft(next);
    if (isRealDate(next)) onChange(next);
  };

  const invalid = draft.length > 0 && !isRealDate(draft);

  return (
    <View style={styles.wrap}>
      <TextInput
        value={draft}
        onChangeText={handleChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        maxLength={10}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.chip,
            borderColor: invalid ? colors.danger : colors.border,
          },
        ]}
      />
      {invalid ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          YYYY-MM-DD 형식으로 입력해 주세요.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.mono,
  },
  error: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
});
