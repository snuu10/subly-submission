export const BILLING_CHANNELS = [
  "direct_web",
  "apple_app_store",
  "google_play",
  "carrier",
  "unknown",
] as const;

export type BillingChannel = (typeof BILLING_CHANNELS)[number];

export type CancelGuidePlatform = "ios" | "android" | "web";

export type CancelGuideCitation = {
  url: string;
  title: string;
  quoted_span: string;
};

export type CancelGuideStep = {
  order: number;
  description: string;
  citation: CancelGuideCitation;
  confidence: "confirmed";
};

export type CancelGuideResponse = {
  status: "verified" | "generated" | "review_needed" | "not_found";
  service_id: string | null;
  service_name: string | null;
  country: "KR";
  billing_channel: BillingChannel | null;
  platform: CancelGuidePlatform | null;
  steps: CancelGuideStep[];
  cancellation_effective_at: string | null;
  refund_policy: string | null;
  warnings: string[];
  official_support_url: string | null;
  confidence: "confirmed" | "partial" | "unverified";
  fetched_at: string;
  disclaimer: string;
  search_failed: boolean;
  needs_billing_channel?: boolean;
  needs_intent?: boolean;
  redirect?: "claude_proxy";
  intent?: string;
  error?: string;
};

export type CancelGuideRequest = {
  service_query: string;
  billing_channel?: BillingChannel | null;
  platform?: CancelGuidePlatform | null;
  subscription_id?: string | null;
  question_snippet?: string | null;
  mode?: "curated";
};
