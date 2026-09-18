import type { BillingChannel } from '@/types/cancel-guide';

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
  /** categories.id. 라벨·색상은 category-store에서 조회한다 */
  category_id: string;
  /** 'yyyy-MM-dd' 최초 결제일. 결제 주기의 유일한 진실 */
  anchor_date: string;
  /** 'yyyy-MM-dd' anchor_date + billing_cycle로부터 계산된 파생 캐시 */
  next_payment_date: string;
  created_at: string;
  last_checked_at: string | null;
  preset_id: string | null;
  is_active: boolean;
  memo?: string;
  emoji?: string;
  /** 가입 계정(이메일/아이디). 비밀번호는 저장하지 않는다 */
  account_id?: string;
  /** 결제 경로. 등록 시 선택, 해지 안내 때 필요할 수 있다 */
  billing_channel?: BillingChannel | null;
  /** 직접 등록한 은행·카드. 가입 계정(account_id)과 별개 */
  payment_instrument_id?: string | null;
  lifecycle_status?: LifecycleStatus;
  service_end_date?: string | null;
  /** 무료 체험 중인지. billing_cycle과 별개 표시 전용 플래그 */
  is_trial?: boolean;
  /** 'yyyy-MM-dd' 체험 종료일(= 첫 유료 결제일). is_trial이면 필수 */
  trial_ends_at?: string | null;
}

export type NewSubscriptionInput = Pick<
  Subscription,
  | 'name'
  | 'amount'
  | 'billing_cycle'
  | 'category_id'
  | 'anchor_date'
  | 'next_payment_date'
  | 'preset_id'
  | 'is_active'
  | 'memo'
  | 'emoji'
  | 'account_id'
  | 'billing_channel'
  | 'payment_instrument_id'
  | 'is_trial'
  | 'trial_ends_at'
>;

/** is_trial만으로 배지를 켜면 체험 종료 후 다음 결제 주기에 다시 켜질 수 있다 —
 * 항상 날짜(trial_ends_at)와 함께 판정한다. */
export function isTrialCurrent(sub: Pick<Subscription, 'is_trial' | 'trial_ends_at'>, todayIso: string): boolean {
  return Boolean(sub.is_trial && sub.trial_ends_at && sub.trial_ends_at >= todayIso);
}
