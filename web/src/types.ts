export type BillingCycle = 'monthly' | 'yearly' | 'one_time';

export type LifecycleStatus =
  | 'active'
  | 'guide_reviewed'
  | 'cancel_requested'
  | 'ending_scheduled'
  | 'ended'
  | 'end_confirm_needed';

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  active: '활성',
  guide_reviewed: '해지 안내 확인',
  cancel_requested: '해지 신청',
  ending_scheduled: '이용 종료 예정',
  ended: '종료',
  end_confirm_needed: '종료 확인 필요',
};

export type LifecycleAlert = {
  subscription_id: string;
  name: string;
  kind: 'ending_soon' | 'end_confirm';
  lifecycle_status: LifecycleStatus;
  service_end_date: string | null;
  days_until: number;
  monthly_save: number;
  yearly_save: number;
};

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  category_id: string;
  anchor_date: string;
  next_payment_date: string;
  created_at: string;
  last_checked_at: string | null;
  preset_id: string | null;
  is_active: boolean;
  memo?: string;
  emoji?: string;
  account_id?: string;
  billing_channel?: import('@/types/cancel-guide').BillingChannel | null;
  payment_instrument_id?: string | null;
  lifecycle_status?: LifecycleStatus;
  service_end_date?: string | null;
  /** 무료 체험 중인지. billing_cycle과 별개 표시 전용 플래그 */
  is_trial?: boolean;
  /** 'yyyy-MM-dd' 체험 종료일(= 첫 유료 결제일). is_trial이면 필수 */
  trial_ends_at?: string | null;
}

/** is_trial만으로 배지를 켜면 체험 종료 후 다음 결제 주기에 다시 켜질 수 있다 —
 * 항상 날짜(trial_ends_at)와 함께 판정한다. */
export function isTrialCurrent(sub: Pick<Subscription, 'is_trial' | 'trial_ends_at'>, todayIso: string): boolean {
  return Boolean(sub.is_trial && sub.trial_ends_at && sub.trial_ends_at >= todayIso);
}

export type SystemCategoryKey =
  | 'entertainment'
  | 'music'
  | 'work'
  | 'health'
  | 'education'
  | 'cloud'
  | 'etc';

export interface Category {
  id: string;
  user_id: string;
  key: SystemCategoryKey | null;
  name: string;
  color: string;
  emoji: string | null;
  is_system: boolean;
  is_hidden: boolean;
  created_at: string;
}

export type SpendInsight = {
  kind: 'top_category' | 'largest_subscription';
  label: string;
};

export type ProjectedMonth = {
  label: string;
  amount: number;
};
