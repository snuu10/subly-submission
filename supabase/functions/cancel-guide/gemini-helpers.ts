import { claudeText, parseClaudeJson } from "../_shared/claude.ts";

export type GeminiIntent = "cancel_howto" | "app_delete" | "ambiguous" | "other";

export type BillingChannel =
  | "direct_web"
  | "apple_app_store"
  | "google_play"
  | "carrier"
  | "unknown";

export type GeminiClassification = {
  canonical_service_id: string | null;
  canonical_service_name: string | null;
  intent: GeminiIntent;
  billing_channel: BillingChannel | null;
  ask_billing_channel: boolean;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** 모델에 넘기기 전 이메일·전화·카드·UUID를 제거한다. 원문 전체는 호출하지 말 것. */
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(CARD_RE, "[card]")
    .replace(UUID_RE, "[id]")
    .slice(0, 280)
    .trim();
}

function keywordFallback(serviceQuery: string, snippet: string): GeminiClassification {
  const blob = `${serviceQuery} ${snippet}`.toLowerCase();
  const howto = /해지\s*방법|어떻게\s*해지|취소하는\s*법|해지하는\s*법|해지\s*안내|unsubscribe/.test(blob);
  const del = /목록에서\s*삭제|앱에서\s*지워|등록\s*삭제|삭제해/.test(blob);
  const vagueCancel = /해지해|해지\s*해|취소해/.test(blob) && !howto;

  let intent: GeminiIntent = "other";
  if (howto && !del) intent = "cancel_howto";
  else if (del && !howto) intent = "app_delete";
  else if (vagueCancel || (howto && del)) intent = "ambiguous";

  return {
    canonical_service_id: null,
    canonical_service_name: serviceQuery.trim() || null,
    intent,
    billing_channel: null,
    ask_billing_channel: intent === "cancel_howto",
  };
}

export async function classifyWithGemini(input: {
  serviceQuery: string;
  questionSnippet?: string;
  billingChannelHint?: string | null;
  platformHint?: string | null;
}): Promise<GeminiClassification> {
  const fallback = keywordFallback(input.serviceQuery, input.questionSnippet ?? "");
  // Gemini (데모데이: Claude로 대체)
  // const apiKey = Deno.env.get("GEMINI_API_KEY");
  // if (!apiKey) return fallback;
  // const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3-flash-preview";

  const payload = {
    service_query: input.serviceQuery.slice(0, 80),
    question_type_hint: "cancel_or_delete",
    billing_channel_hint: input.billingChannelHint ?? null,
    platform_hint: input.platformHint ?? null,
    question_snippet: input.questionSnippet ? scrubPii(input.questionSnippet) : null,
  };

  const prompt = `당신은 구독 앱의 분류기입니다. google 검색을 쓰지 마세요.
아래 JSON 필드만 보고 다음 JSON만 출력하세요.
{"canonical_service_id":"영문슬러그또는null","canonical_service_name":"한국어표시명또는null","intent":"cancel_howto|app_delete|ambiguous|other","billing_channel":"direct_web|apple_app_store|google_play|carrier|unknown|null","ask_billing_channel":true또는false}

규칙:
- cancel_howto: 실제 서비스 해지/취소 절차를 묻는 경우
- app_delete: 앱 목록에서 구독 기록을 지우라는 경우
- ambiguous: "해지해줘"처럼 둘 다 가능한 경우
- 결제 채널을 알 수 없으면 billing_channel은 null, ask_billing_channel은 cancel_howto일 때 true
입력: ${JSON.stringify(payload)}`;

  try {
    // Gemini (데모데이: Claude로 대체)
    // const res = await fetch(
    //   `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    //   {
    //     method: "POST",
    //     headers: { "content-type": "application/json" },
    //     body: JSON.stringify({
    //       contents: [{ role: "user", parts: [{ text: prompt }] }],
    //       generationConfig: { temperature: 0, responseMimeType: "application/json" },
    //     }),
    //   },
    // );
    // if (!res.ok) return fallback;
    // const json = await res.json() as {
    //   candidates?: { content?: { parts?: { text?: string }[] } }[];
    // };
    // const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // const parsed = JSON.parse(text) as Record<string, unknown>;

    const text = await claudeText({
      system: "JSON만 출력하세요. 마크다운 펜스 없이.",
      user: prompt,
      maxTokens: 200,
    });
    if (!text) return fallback;
    const parsed = parseClaudeJson(text) as Record<string, unknown>;
    const intent = parsed.intent;
    const channel = parsed.billing_channel;
    return {
      canonical_service_id: typeof parsed.canonical_service_id === "string" && parsed.canonical_service_id
        ? parsed.canonical_service_id
        : fallback.canonical_service_id,
      canonical_service_name:
        typeof parsed.canonical_service_name === "string" && parsed.canonical_service_name
          ? parsed.canonical_service_name
          : fallback.canonical_service_name,
      intent:
        intent === "cancel_howto" || intent === "app_delete" || intent === "ambiguous" || intent === "other"
          ? intent
          : fallback.intent,
      billing_channel:
        channel === "direct_web" ||
          channel === "apple_app_store" ||
          channel === "google_play" ||
          channel === "carrier" ||
          channel === "unknown"
          ? channel
          : null,
      ask_billing_channel: parsed.ask_billing_channel === true,
    };
  } catch {
    return fallback;
  }
}
