export const CLAUDE_ACTIONS = ['create', 'update', 'delete', 'pause', 'resume'] as const;
export type ClaudeAction = (typeof CLAUDE_ACTIONS)[number];
export type ClaudeManageAction = Exclude<ClaudeAction, 'create'>;

export type ClaudeSubscriptionHint = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: import('@/types').BillingCycle;
  is_active: boolean;
};

export type ClaudeExtract = {
  name: string | null;
  amount: number | null;
  billing_cycle: import('@/types').BillingCycle | null;
  anchor_date: string | null;
  next_payment_date?: string | null;
  category_key: import('@/types').SystemCategoryKey | null;
  category_name: string | null;
  account_id: string | null;
};

export type ClaudeChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ClaudeUsageCheckin = {
  subscription_id: string;
  response: import('@/types/briefing-event').UsageCheckinResponse;
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

export type ParsedSubscription = {
  name: string;
  amount: number;
  billing_cycle: import('@/types').BillingCycle;
  anchor_date: string;
  category_id: string;
  account_id?: string;
  memo?: string;
  preset_id: string | null;
  next_payment_date?: string | null;
};
