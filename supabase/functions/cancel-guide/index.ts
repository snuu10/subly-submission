import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { classifyWithGemini, type BillingChannel } from "./gemini-helpers.ts";
import { domainsFor, fallbackUrl, findSupportLink } from "./support-links.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COUNTRY = "KR";
const ENDPOINT = "cancel-guide";
const CHANNELS = ["direct_web", "apple_app_store", "google_play", "carrier", "unknown"] as const;
const PLATFORMS = ["ios", "android", "web"] as const;

type Platform = (typeof PLATFORMS)[number];

type RequestBody = {
  service_query?: string;
  billing_channel?: string | null;
  platform?: string | null;
  subscription_id?: string | null;
  question_snippet?: string | null;
  mode?: string;
};

type Citation = { url: string; title: string; quoted_span: string };

type GuideStep = {
  order: number;
  description: string;
  citation: Citation;
  confidence: "confirmed";
};

type GuidePayload = {
  status: "verified" | "generated" | "review_needed" | "not_found";
  service_id: string | null;
  service_name: string | null;
  country: typeof COUNTRY;
  billing_channel: BillingChannel | null;
  platform: Platform | null;
  steps: GuideStep[];
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
};

const DISCLAIMER = "정확한 절차는 서비스 공식 앱/웹사이트에서 최종 확인하세요.";
const FAIL_MESSAGE = "최신 공식 절차를 확인하지 못했습니다. 서비스 공식 앱/웹사이트 또는 고객센터에서 확인해 주세요.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asChannel(value: unknown): BillingChannel | null {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value)
    ? (value as BillingChannel)
    : null;
}

function asPlatform(value: unknown): Platform | null {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value)
    ? (value as Platform)
    : null;
}

function emptyGuide(partial: Partial<GuidePayload>): GuidePayload {
  return {
    status: "not_found",
    service_id: null,
    service_name: null,
    country: COUNTRY,
    billing_channel: null,
    platform: null,
    steps: [],
    cancellation_effective_at: null,
    refund_policy: null,
    warnings: [],
    official_support_url: null,
    confidence: "unverified",
    fetched_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    search_failed: false,
    ...partial,
  };
}

function citationOk(raw: unknown): Citation | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const quoted = typeof row.quoted_span === "string" ? row.quoted_span.trim() : "";
  if (!url.startsWith("https://") || quoted.length < 8) return null;
  return { url, title: title || url, quoted_span: quoted };
}

function filterCitedSteps(raw: unknown): GuideStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: GuideStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const citation = citationOk(row.citation);
    if (!description || !citation) continue;
    steps.push({
      order: steps.length + 1,
      description,
      citation,
      confidence: "confirmed",
    });
  }
  return steps;
}

function overallConfidence(steps: GuideStep[], highRiskUnverified: boolean): GuidePayload["confidence"] {
  if (steps.length === 0) return "unverified";
  if (highRiskUnverified) return "partial";
  return "confirmed";
}

function adminClient(supabaseUrl: string) {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    throw new Error("사용량 확인에 실패했습니다.");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

async function readUsage(client: SupabaseClient, userId: string) {
  const { data, error } = await client.rpc("get_ai_usage", {
    p_user_id: userId,
    p_endpoint: ENDPOINT,
  });
  if (error) {
    console.error("get_ai_usage", error.message);
    throw new Error("사용량 확인에 실패했습니다.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    request_count: Number(row?.request_count ?? 0),
    web_search_count: Number(row?.web_search_count ?? 0),
  };
}

async function bumpUsage(client: SupabaseClient, userId: string) {
  const { data, error } = await client.rpc("increment_ai_usage", {
    p_user_id: userId,
    p_endpoint: ENDPOINT,
    p_web_search: 1,
  });
  if (error) {
    console.error("increment_ai_usage", error.message);
    throw new Error("사용량 기록에 실패했습니다.");
  }
  return data;
}

function parseClaudeGuide(text: string): {
  steps: GuideStep[];
  cancellation_effective_at: string | null;
  refund_policy: string | null;
  warnings: string[];
  official_support_url: string | null;
  high_risk_unverified: boolean;
} {
  const empty = {
    steps: [] as GuideStep[],
    cancellation_effective_at: null as string | null,
    refund_policy: null as string | null,
    warnings: [] as string[],
    official_support_url: null as string | null,
    high_risk_unverified: false,
  };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const steps = filterCitedSteps(parsed.steps);
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return {
      steps,
      cancellation_effective_at:
        typeof parsed.cancellation_effective_at === "string" ? parsed.cancellation_effective_at : null,
      refund_policy: typeof parsed.refund_policy === "string" ? parsed.refund_policy : null,
      warnings,
      official_support_url:
        typeof parsed.official_support_url === "string" && parsed.official_support_url.startsWith("https://")
          ? parsed.official_support_url
          : null,
      high_risk_unverified: parsed.high_risk_unverified === true,
    };
  } catch {
    return empty;
  }
}

async function callClaudeGuide(input: {
  serviceName: string;
  billingChannel: BillingChannel;
  platform: Platform | null;
  domains: string[];
}): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const tools: Record<string, unknown>[] = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
      ...(input.domains.length > 0 ? { allowed_domains: input.domains } : {}),
      user_location: {
        type: "approximate",
        country: "KR",
        timezone: "Asia/Seoul",
      },
    },
    {
      type: "web_fetch_20250910",
      name: "web_fetch",
      max_uses: 3,
      citations: { enabled: true },
      ...(input.domains.length > 0 ? { allowed_domains: input.domains } : {}),
    },
  ];

  const system = `당신은 한국 구독 서비스의 공식 해지 안내만 작성합니다.
반드시 web_search 또는 web_fetch로 공식 도움말/고객센터를 확인한 뒤, 아래 JSON만 출력하세요.
기억이나 추측으로 단계를 만들지 마세요. 인용 문장(quoted_span)이 없는 단계는 넣지 마세요.
환불·위약금·데이터 삭제는 공식 문장으로 확인되지 않으면 필드에 넣지 말고 high_risk_unverified를 true로 두세요.

{
  "steps": [{"order":1,"description":"...","citation":{"url":"https://...","title":"...","quoted_span":"공식문서 문장"}}],
  "cancellation_effective_at": "텍스트 또는 null",
  "refund_policy": "텍스트 또는 null",
  "warnings": ["..."],
  "official_support_url": "https://... 또는 null",
  "high_risk_unverified": false
}

검색에 실패하면 steps를 빈 배열로 두세요.`;

  const user = [
    `서비스: ${input.serviceName}`,
    `국가: KR`,
    `결제 채널: ${input.billingChannel}`,
    `플랫폼: ${input.platform ?? "미지정"}`,
    "해당 결제 채널 기준의 최신 공식 해지 절차를 찾아 JSON으로 정리하세요.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      system,
      tools,
      messages: [{ role: "user", content: user }],
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : "Claude API 호출에 실패했습니다.";
    throw new Error(message);
  }

  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .filter((block: { type?: string }) => block.type === "text")
    .map((block: { text?: string }) => block.text ?? "")
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const serviceQuery = body.service_query?.trim() ?? "";
  if (!serviceQuery) {
    return json({ error: "service_query가 필요합니다." }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const platform = asPlatform(body.platform);
  let billingChannel = asChannel(body.billing_channel);

  if (body.subscription_id) {
    const { data } = await supabase
      .from("subscriptions")
      .select("name, billing_channel")
      .eq("id", body.subscription_id)
      .maybeSingle();
    if (data && !billingChannel) {
      billingChannel = asChannel(data.billing_channel);
    }
  }

  const classified = await classifyWithGemini({
    serviceQuery,
    questionSnippet: body.question_snippet ?? serviceQuery,
    billingChannelHint: billingChannel,
    platformHint: platform,
  });

  if (classified.intent === "app_delete") {
    return json(emptyGuide({ redirect: "claude_proxy", intent: "app_delete" }));
  }
  if (classified.intent === "other") {
    return json(emptyGuide({ redirect: "claude_proxy", intent: "other" }));
  }
  if (classified.intent === "ambiguous") {
    return json(emptyGuide({
      needs_intent: true,
      service_name: classified.canonical_service_name ?? serviceQuery,
      service_id: classified.canonical_service_id,
    }));
  }

  const catalog = findSupportLink(classified.canonical_service_id ?? serviceQuery) ??
    findSupportLink(serviceQuery);
  const serviceId = classified.canonical_service_id ?? catalog?.service_id ?? serviceQuery.toLowerCase();
  const serviceName = classified.canonical_service_name ?? catalog?.name ?? serviceQuery;

  if (!billingChannel || billingChannel === "unknown") {
    billingChannel = classified.billing_channel && classified.billing_channel !== "unknown"
      ? classified.billing_channel
      : billingChannel;
  }

  if (!billingChannel || billingChannel === "unknown") {
    return json(emptyGuide({
      needs_billing_channel: true,
      service_id: serviceId,
      service_name: serviceName,
      platform,
      billing_channel: null,
    }));
  }

  const lookupPlatform = platform ?? "web";
  const { data: curated } = await supabase
    .from("cancellation_guides_curated")
    .select("*")
    .eq("service_id", catalog?.service_id ?? serviceId)
    .eq("country", COUNTRY)
    .eq("billing_channel", billingChannel)
    .eq("platform", lookupPlatform)
    .eq("status", "verified")
    .maybeSingle();

  const curatedRow = curated as {
    service_id: string;
    service_name: string;
    steps: unknown;
    refund_policy: string | null;
    warnings: unknown;
    official_support_url: string | null;
    expires_at: string | null;
  } | null;

  const notExpired = curatedRow &&
    (!curatedRow.expires_at || Date.parse(curatedRow.expires_at) > Date.now());

  if (curatedRow && notExpired) {
    const steps = filterCitedSteps(curatedRow.steps);
    return json(emptyGuide({
      status: "verified",
      service_id: curatedRow.service_id,
      service_name: curatedRow.service_name,
      billing_channel: billingChannel,
      platform: lookupPlatform,
      steps,
      refund_policy: curatedRow.refund_policy,
      warnings: Array.isArray(curatedRow.warnings)
        ? curatedRow.warnings.filter((item): item is string => typeof item === "string")
        : [],
      official_support_url: curatedRow.official_support_url,
      confidence: overallConfidence(steps, false),
      search_failed: false,
    }));
  }

  const requestLimit = Number(Deno.env.get("CANCEL_GUIDE_DAILY_LIMIT") ?? 10);
  const searchLimit = Number(Deno.env.get("CANCEL_GUIDE_DAILY_SEARCH_LIMIT") ?? 5);

  let admin: SupabaseClient;
  try {
    admin = adminClient(supabaseUrl);
    const usage = await readUsage(admin, userId);
    if (usage.request_count >= requestLimit || usage.web_search_count >= searchLimit) {
      return json({
        error: "오늘 해지 안내 검색 한도를 모두 썼어요. 내일 다시 시도해 주세요.",
        retry_at: "next_seoul_midnight",
      }, 429);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "사용량 확인에 실패했습니다." }, 500);
  }

  try {
    await bumpUsage(admin, userId);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "사용량 기록에 실패했습니다." }, 500);
  }

  const domains = domainsFor(catalog?.service_id ?? serviceId, serviceQuery);
  let parsed;
  try {
    const raw = await callClaudeGuide({
      serviceName,
      billingChannel,
      platform,
      domains,
    });
    parsed = parseClaudeGuide(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "검색에 실패했습니다.";
    if (message.includes("ANTHROPIC_API_KEY")) {
      return json({ error: message }, 503);
    }
    parsed = {
      steps: [] as GuideStep[],
      cancellation_effective_at: null,
      refund_policy: null,
      warnings: [] as string[],
      official_support_url: null,
      high_risk_unverified: false,
    };
  }

  const searchFailed = parsed.steps.length === 0;
  const fallback = fallbackUrl({
    serviceId: catalog?.service_id ?? serviceId,
    query: serviceQuery,
    country: COUNTRY,
    platform,
    billingChannel: billingChannel,
  });
  // 검색 실패 때는 모델이 만든 URL을 쓰지 않고, 조건이 맞는 검수 링크만 쓴다.
  const supportUrl = searchFailed ? fallback : (parsed.official_support_url ?? fallback);
  const status = searchFailed
    ? "not_found"
    : parsed.high_risk_unverified
    ? "review_needed"
    : "generated";

  const payload = emptyGuide({
    status,
    service_id: catalog?.service_id ?? serviceId,
    service_name: serviceName,
    billing_channel: billingChannel,
    platform,
    steps: parsed.steps,
    cancellation_effective_at: parsed.cancellation_effective_at,
    refund_policy: parsed.refund_policy,
    warnings: searchFailed ? [FAIL_MESSAGE, ...parsed.warnings] : parsed.warnings,
    official_support_url: supportUrl,
    confidence: overallConfidence(parsed.steps, parsed.high_risk_unverified),
    search_failed: searchFailed,
  });

  if (!searchFailed) {
    await supabase.from("cancellation_requests_user").insert({
      user_id: userId,
      service_query: serviceQuery,
      service_id: payload.service_id,
      country: COUNTRY,
      billing_channel: billingChannel,
      platform,
      payload,
      status: status === "review_needed" ? "review_needed" : "generated",
    });
  }

  return json(payload);
});
