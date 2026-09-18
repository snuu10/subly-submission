export const BILLING_CHANNELS = [
  'direct_web',
  'apple_app_store',
  'google_play',
  'carrier',
  'unknown',
] as const;

export type BillingChannel = (typeof BILLING_CHANNELS)[number];

export type CancelGuidePlatform = 'ios' | 'android' | 'web';

export type CancelGuideCitation = {
  url: string;
  title: string;
  quoted_span: string;
};

export type CancelGuideStep = {
  order: number;
  description: string;
  citation: CancelGuideCitation;
  confidence: 'confirmed';
};

export type CancelGuideResponse = {
  status: 'verified' | 'generated' | 'review_needed' | 'not_found';
  service_id: string | null;
  service_name: string | null;
  country: 'KR';
  billing_channel: BillingChannel | null;
  platform: CancelGuidePlatform | null;
  steps: CancelGuideStep[];
  cancellation_effective_at: string | null;
  refund_policy: string | null;
  warnings: string[];
  official_support_url: string | null;
  confidence: 'confirmed' | 'partial' | 'unverified';
  fetched_at: string;
  disclaimer: string;
  search_failed: boolean;
  needs_billing_channel?: boolean;
  needs_intent?: boolean;
  redirect?: 'claude_proxy';
  intent?: string;
  error?: string;
};

export type CancelGuideRequest = {
  service_query: string;
  billing_channel?: BillingChannel | null;
  platform?: CancelGuidePlatform | null;
  subscription_id?: string | null;
  question_snippet?: string | null;
  mode?: 'curated';
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
