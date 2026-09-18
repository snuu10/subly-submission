import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/fonts';
import { formatCurrency } from '@/stores/subscription-store';

type GradientHeroCardProps = {
  monthlyTotal: number;
  monthPaymentTotal: number;
  nextMonthTotal: number;
};

export function GradientHeroCard({
  monthlyTotal,
  monthPaymentTotal,
  nextMonthTotal,
}: GradientHeroCardProps) {
  return (
    <LinearGradient
      colors={['#4F46E5', '#7C3AED']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}>
      <View style={styles.decorLarge} />
      <View style={styles.decorSmall} />
      <View style={styles.content}>
        <Text style={styles.label}>월평균 구독 지출액</Text>
        <Text style={styles.amount}>
          {monthlyTotal.toLocaleString('ko-KR')}
          <Text style={styles.amountUnit}>원</Text>
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statLabel}>이번 달 예상 지출액</Text>
            <Text style={styles.statValue}>{formatCurrency(monthPaymentTotal)}</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statLabel}>다음 달 예상 지출액</Text>
            <Text style={styles.statValue}>{formatCurrency(nextMonthTotal)}</Text>
          </View>
        </View>
        <Text style={styles.hint}>등록된 결제 일정 기준</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 24,
    position: 'relative',
  },
  decorLarge: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 192,
    height: 192,
    borderRadius: 96,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  decorSmall: {
    position: 'absolute',
    bottom: -64,
    left: -24,
    width: 256,
    height: 256,
    borderRadius: 128,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  content: {
    position: 'relative',
  },
  label: {
    color: '#C7D2FE',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
    marginBottom: 4,
  },
  amount: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '800',
    fontFamily: fonts.monoBold,
    letterSpacing: -0.5,
  },
  amountUnit: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  hint: {
    color: '#C7D2FE',
    fontSize: 12,
    fontFamily: fonts.sans,
    marginTop: 10,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    minWidth: 120,
    gap: 3,
  },
  statLabel: {
    color: '#C7D2FE',
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: fonts.monoBold,
  },
});
