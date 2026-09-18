import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { LIFECYCLE_LABELS, type LifecycleStatus } from '@/types/subscription';

const CONFIRM_LABEL: Partial<Record<LifecycleStatus, { confirm: string; done: string }>> = {
  guide_reviewed: { confirm: '안내 확인으로 기록', done: '기록됨' },
  cancel_requested: { confirm: '해지 완료로 기록', done: '기록됨' },
  ending_scheduled: { confirm: '종료 예정으로 기록', done: '기록됨' },
  ended: { confirm: '종료 확인', done: '종료됨' },
  end_confirm_needed: { confirm: '종료 확인 필요로 기록', done: '기록됨' },
  active: { confirm: '아직 결제로 되돌리기', done: '되돌림' },
};

function asStatus(value: string): LifecycleStatus | null {
  return value in LIFECYCLE_LABELS ? (value as LifecycleStatus) : null;
}

type LifecycleConfirmCardProps = {
  name: string;
  to: string;
  serviceEndDate?: string | null;
  confirmed?: boolean;
  saving?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function LifecycleConfirmCard({
  name,
  to,
  serviceEndDate,
  confirmed,
  saving,
  onConfirm,
  onSkip,
}: LifecycleConfirmCardProps) {
  const colors = useThemeColors();
  const status = asStatus(to);
  const labels = status ? CONFIRM_LABEL[status] : undefined;
  const summary = status === 'cancel_requested'
    ? '실제 서비스 해지를 완료한 것으로 기록할까요? 이용 종료일까지 목록에 유지됩니다.'
    : `${status ? LIFECYCLE_LABELS[status] : to}으로 바꿀까요? 앱 목록 삭제와는 다릅니다.`;

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.summary, { color: colors.muted }]}>
        {summary}
      </Text>
      {serviceEndDate ? (
        <Text style={[styles.meta, { color: colors.muted }]}>이용 종료일 {serviceEndDate}</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onConfirm}
          disabled={confirmed || saving || !labels}
          style={[
            styles.confirm,
            { backgroundColor: colors.primary, opacity: confirmed || saving || !labels ? 0.5 : 1 },
          ]}>
          <Text style={[styles.confirmLabel, { color: colors.primaryText }]}>
            {confirmed ? labels?.done ?? '반영됨' : labels?.confirm ?? '반영하기'}
          </Text>
        </Pressable>
        {confirmed ? null : (
          <Pressable onPress={onSkip} style={styles.skip}>
            <Text style={[styles.skipLabel, { color: colors.muted }]}>대화 이어가기</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  meta: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  confirm: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  confirmLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  skip: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  skipLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
