import type { BillingChannel } from '@/types/cancel-guide';
import type { BillingCycle } from '@/types/subscription';

export const BILLING_CYCLE_OPTIONS: { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: '월간' },
  { value: 'yearly', label: '연간' },
  { value: 'one_time', label: '일회성' },
];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: '월간',
  yearly: '연간',
  one_time: '일회성',
};

/** AI 카드·영수증 확인 화면. */
export const BILLING_CYCLE_SHORT: Record<BillingCycle, string> = {
  monthly: '매월',
  yearly: '매년',
  one_time: '일회성',
};

export const BILLING_CHANNEL_OPTIONS: { value: BillingChannel; label: string }[] = [
  { value: 'direct_web', label: '웹에서 결제' },
  { value: 'apple_app_store', label: '앱스토어' },
  { value: 'google_play', label: '플레이스토어' },
  { value: 'carrier', label: '통신사' },
  { value: 'unknown', label: '잘 모름' },
];

export const BILLING_CHANNEL_LABELS: Record<BillingChannel, string> = {
  direct_web: '웹에서 결제',
  apple_app_store: '앱스토어',
  google_play: '플레이스토어',
  carrier: '통신사',
  unknown: '잘 모름',
};
