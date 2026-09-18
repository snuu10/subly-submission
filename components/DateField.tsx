import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export type DateFieldProps = {
  /** 'yyyy-MM-dd' */
  value: string;
  onChange: (value: string) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatLabel(value: string): string {
  const date = fromISODate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function DateField({ value, onChange }: DateFieldProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android는 피커가 확인/취소 시 스스로 닫히므로 상태를 즉시 내려야 한다.
    if (Platform.OS === 'android') setOpen(false);

    if (event.type === 'dismissed' || !selected) return;
    onChange(toISODate(selected));
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.field, { borderColor: colors.border, backgroundColor: colors.chip }]}>
        <Text style={[styles.value, { color: colors.text }]}>{formatLabel(value)}</Text>
        <Text style={[styles.hint, { color: colors.muted }]}>변경</Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={fromISODate(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
        />
      ) : null}

      {Platform.OS === 'ios' && open ? (
        <Pressable onPress={() => setOpen(false)} style={styles.doneButton}>
          <Text style={[styles.doneLabel, { color: colors.primary }]}>완료</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  value: {
    fontSize: 15,
    fontFamily: fonts.mono,
  },
  hint: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  doneLabel: {
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
});
