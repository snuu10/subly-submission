import type { UsageCheckinResponse } from '@/types/briefing-event';
import type { SystemCategoryKey } from '@/types/category';
import type { BillingCycle } from '@/types/subscription';

export const CLAUDE_ACTIONS = ['create', 'update', 'delete', 'pause', 'resume'] as const;
export type ClaudeAction = (typeof CLAUDE_ACTIONS)[number];

export type ClaudeManageAction = Exclude<ClaudeAction, 'create'>;

export type ClaudeSubscriptionHint = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  is_active: boolean;
};

/** Edge Function이 돌려주는 원시 추출. 카테고리 id는 클라에서 매핑한다. */
export type ClaudeExtract = {
  name: string | null;
  amount: number | null;
  billing_cycle: BillingCycle | null;
  anchor_date: string | null;
  next_payment_date: string | null;
  category_key: SystemCategoryKey | null;
  category_name: string | null;
  account_id: string | null;
  is_trial: boolean | null;
  /** 'yyyy-MM-dd' 체험 종료일(= 첫 유료 결제일) */
  trial_ends_at: string | null;
};

export type ClaudeChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ClaudeUsageCheckin = {
  subscription_id: string;
  response: UsageCheckinResponse;
};

export type ClaudeBriefingContext = {
  event_id?: string;
  subscription_id?: string;
  intent?: string;
  entry_source?: string;
};

export type ClaudeProxyResponse = {
  reply: string;
  extract: ClaudeExtract | null;
  action: ClaudeAction | null;
  subscription_id: string | null;
  candidate_ids: string[] | null;
  usage_checkin: ClaudeUsageCheckin | null;
};

/** 확인 화면·인라인 카드·모달 prefills에 쓰는 정규화 결과 */
export type ParsedSubscription = {
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  anchor_date: string;
  category_id: string;
  account_id?: string;
  /** 기존 구독을 다룰 때만 채워진다. 동명 구독 구분용 표시 정보 */
  memo?: string;
  preset_id: string | null;
  next_payment_date?: string | null;
  is_trial?: boolean;
  trial_ends_at?: string | null;
};
