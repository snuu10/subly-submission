import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACTIONS = ["create", "update", "delete", "pause", "resume"] as const;
type ClaudeAction = (typeof ACTIONS)[number];

const MAX_TOOL_ROUNDS = 4;

const TOOLS = [
  {
    name: "get_monthly_total",
    description:
      "월평균 구독 지출액(정기만, 연간÷12, 일회성 0)과 등록된 결제 일정 기준 이번 달 예상 지출액을 반환합니다. 계좌 연동이 없으므로 실제 결제라고 단정하지 않습니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_category_totals",
    description: "카테고리별 월 지출 합계를 반환합니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_upcoming_subscriptions",
    description: "N일 안에 결제될 활성 구독 목록을 결제일이 가까운 순으로 반환합니다.",
    input_schema: {
      type: "object",
      properties: {
        within_days: { type: "integer", description: "조회 기간(일). 생략하면 7." },
      },
    },
  },
  {
    name: "find_subscriptions_by_name",
    description:
      "이름에 검색어가 포함된 구독을 찾습니다(활성·비활성 모두). 동명 구독이 있는지 확인할 때도 사용하세요.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색할 서비스명(부분 일치)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_subscriptions",
    description:
      "활성 구독 전체를 나열합니다. '제일 비싼/싼 구독' 같은 순위 질문이나 특정 카테고리 목록 질문에 사용하세요.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "카테고리 이름으로 필터(부분 일치). 생략하면 전체.",
        },
      },
    },
  },
] as const;

const USAGE_RESPONSES = ["used_recently", "occasionally", "not_used", "unsure"] as const;

const SYSTEM_PROMPT = `당신은 구독 관리 앱 subly의 AI 비서입니다.
사용자 말이나 결제 화면/영수증 이미지에서 구독 정보를 다루거나,
기존 구독을 수정·삭제·일시정지·다시 시작하거나, 구독 데이터에 대한 질문에 답합니다.

반드시 아래 JSON만 출력하세요. 설명 문장이나 마크다운은 넣지 마세요.
{
  "reply": "사용자에게 보여줄 짧은 한국어 문장",
  "action": "create" | "update" | "delete" | "pause" | "resume" | null,
  "subscription_id": "기존 구독 id 또는 null",
  "candidate_ids": ["이름이 겹치는 구독 id들"] 또는 null,
  "usage_checkin": null 또는 {
    "subscription_id": "기존 구독 id",
    "response": "used_recently" | "occasionally" | "not_used" | "unsure"
  },
  "extract": null 또는 {
    "name": "서비스명",
    "amount": 숫자(원, 정수),
    "billing_cycle": "monthly" | "yearly" | "one_time",
    "anchor_date": "YYYY-MM-DD" 또는 null,
    "category_key": "entertainment" | "music" | "work" | "health" | "education" | "cloud" | "etc" | null,
    "category_name": "사용자 카테고리 이름 또는 null",
    "account_id": "이메일/아이디 또는 null"
  }
}

규칙:
- 월평균 구독 지출액, 이번 달 예상 지출액, 카테고리별 지출, 다가오는 결제, 가장 비싼/싼 구독처럼 데이터를 물으면 제공된 도구를 호출해 정확한 값으로 답하세요. 이번 달 얼마/구독료는 월평균 구독 지출액(일회성 제외)로 답하세요. 결제 총액/실제로 나간 돈을 물어도 계좌 연동이 없으므로 등록된 결제 일정 기준 예상 지출액이라고 명시하세요. 이런 조회 응답은 action·subscription_id·candidate_ids·extract·usage_checkin을 모두 null로 두고 reply에만 답을 담으세요.
- 제공된 기존 구독 목록에서 이름(부분 일치·통칭 포함)으로 대상을 고르고, 그때만 action을 넣으세요.
- 이름이 정확히 하나로 좁혀지면 subscription_id에 그 id를 넣고 candidate_ids는 null로 두세요.
- 같은 이름의 구독이 둘 이상이면 subscription_id는 null, candidate_ids에 겹치는 구독 id를 모두 배열로 넣으세요. 이때도 action과(수정이면) extract는 사용자가 원하는 내용으로 채우세요. id를 추측해서 하나만 고르지 마세요.
- 결제 화면/영수증 이미지에서 추출한 서비스명이 기존 활성 구독과 이름이 겹치면(계정이 다르거나 새로 등록하려는 것처럼 보여도) 이 규칙을 아래 "신규 등록" 규칙보다 우선하세요: extract는 반드시 채우고, 이름이 하나로 좁혀지면 subscription_id에, 둘 이상이면 candidate_ids에 넣고 action은 "update"로 두세요. "신규 등록인지 기존 수정인지 알려주세요" 같은 말을 reply로 되묻지 마세요 — 그 선택은 화면에서 사용자가 버튼으로 직접 고릅니다.
- 이름이 목록에 전혀 없으면 action·subscription_id·candidate_ids·extract·usage_checkin을 모두 null로 하고 reply로 되물으세요.
- 신규 등록: action은 "create", extract에 서비스명과 금액. 확신할 수 없으면 extract는 null, reply에 부족한 항목을 물어보세요. (단, 위 이름 겹침 규칙이 적용되는 경우는 예외입니다.)
- 수정: action은 "update", extract에는 바꿀 필드만 넣으세요. 바꾸지 않는 필드는 생략하세요.
- 삭제: "delete". 일시정지: "pause". 재개·다시 켜기·다시 시작: "resume". 이 세 가지는 extract를 null로 두세요.
- 주기 힌트가 없으면 monthly.
- 결제일이 날짜만 있으면 올해(필요하면 내년)의 YYYY-MM-DD로 만드세요.
- 카테고리는 제공된 목록 이름과 맞추고, 시스템 키를 알면 category_key도 넣으세요.
- 등록 확인 톤: "이렇게 등록할까요?" / 수정: "이렇게 바꿀까요?" / 삭제: "이 구독을 삭제할까요?" / 일시정지: "이 구독을 일시정지할까요?" / 다시 시작: "이 구독을 다시 시작할까요?"
- 비밀번호는 절대 추출하지 마세요.
- reply에는 **나 __ 같은 마크다운을 쓰지 마세요. 강조가 필요하면 따옴표만 쓰세요.
- "해지 방법"·"어떻게 해지"·"취소하는 법"은 앱에서 구독을 지우는 delete가 아닙니다. 그 경우에는 action·subscription_id·candidate_ids·extract·usage_checkin을 모두 null로 두고, reply로 해지 안내 흐름을 쓰라고 하지 말고 짧은 안내만 하세요. 실제 서비스 해지 절차는 이 함수가 담당하지 않습니다.
- 사용 여부(usage_checkin)는 사용자가 이번 메시지에서 서비스명과 사용 상태를 직접 말했을 때만 채우세요. 예: "왓챠는 안 써", "넷플릭스는 자주 써", "디즈니는 가끔 써". 매핑: 자주/최근 사용=used_recently, 가끔=occasionally, 안 써/안 사용=not_used, 잘 모르겠어=unsure.
- "안 써"처럼 대상 구독이 불명확하면 usage_checkin은 null로 두고 reply로 구독명을 다시 물으세요. 목록에서 임의로 고르지 마세요.
- 사용자가 사용 상태를 말하지 않았으면 usage_checkin은 반드시 null입니다. 결제 주기·미사용 추정·홈 맥락만으로 사용 여부를 추측하지 마세요.
- usage_checkin이 유효하면 그 턴의 action·extract는 null로 두세요. 확인 카드는 클라이언트가 보여 주고, 당신이 저장하지는 않습니다.`;

type HistoryItem = { role: "user" | "assistant"; content: string };

type RequestBody = {
  mode?: "extract" | "chat";
  text?: string;
  image_base64?: string;
  media_type?: string;
  history?: HistoryItem[];
  categories?: { name: string; key: string | null }[];
  subscriptions?: {
    id: string;
    name: string;
    amount: number;
    billing_cycle: string;
    is_active: boolean;
  }[];
  briefing_context?: {
    event_id?: string;
    subscription_id?: string;
    intent?: string;
    entry_source?: string;
  };
};

type ToolSubscription = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: string;
  is_active: boolean;
  next_payment_date: string;
  anchor_date: string;
  category_id: string;
  account_id: string | null;
  created_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripDataUrl(value: string): string {
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function sniffImageMediaType(base64: string): string | null {
  const head = stripDataUrl(base64).slice(0, 16);
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("iVBORw")) return "image/png";
  if (head.startsWith("R0lGOD") || head.startsWith("R0lGoD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return null;
}

function resolveMediaType(declared: string | undefined, base64: string): string {
  return sniffImageMediaType(base64) ?? declared ?? "image/jpeg";
}

function asAction(value: unknown): ClaudeAction | null {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value)
    ? (value as ClaudeAction)
    : null;
}

function asSubscriptionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCandidateIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  return ids.length > 0 ? ids : null;
}

function asUsageCheckin(value: unknown): {
  subscription_id: string;
  response: (typeof USAGE_RESPONSES)[number];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.subscription_id === "string" ? row.subscription_id.trim() : "";
  const response = row.response;
  if (!id) return null;
  if (typeof response !== "string" || !(USAGE_RESPONSES as readonly string[]).includes(response)) {
    return null;
  }
  return { subscription_id: id, response: response as (typeof USAGE_RESPONSES)[number] };
}

function userStatedUsage(text: string | undefined): boolean {
  return Boolean(
    text &&
      /안\s*썼|안\s*써|안써|안씀|안\s*사용|사용\s*안|자주\s*써|자주\s*사용|가끔\s*써|가끔\s*사용|최근\s*사용|잘\s*안|안\s*보|안봐|쓰고\s*있|사용했|사용중|사용\s*중|안\s*쓰고|모르겠어|잘\s*몰라/.test(
        text
      )
  );
}

function parseModelOutput(text: string, userText?: string): {
  reply: string;
  extract: unknown;
  action: ClaudeAction | null;
  subscription_id: string | null;
  candidate_ids: string[] | null;
  usage_checkin: ReturnType<typeof asUsageCheckin>;
} {
  const empty = {
    reply: text.trim() || "확인했어요.",
    extract: null as unknown,
    action: null as ClaudeAction | null,
    subscription_id: null as string | null,
    candidate_ids: null as string[] | null,
    usage_checkin: null as ReturnType<typeof asUsageCheckin>,
  };
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return empty;
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      reply?: unknown;
      extract?: unknown;
      action?: unknown;
      subscription_id?: unknown;
      candidate_ids?: unknown;
      usage_checkin?: unknown;
    };
    const usage_checkin = userStatedUsage(userText) ? asUsageCheckin(parsed.usage_checkin) : null;
    return {
      reply:
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : "확인했어요.",
      extract: usage_checkin ? null : (parsed.extract ?? null),
      action: usage_checkin ? null : asAction(parsed.action),
      subscription_id: asSubscriptionId(parsed.subscription_id),
      candidate_ids: asCandidateIds(parsed.candidate_ids),
      usage_checkin,
    };
  } catch {
    return empty;
  }
}

function buildMessages(body: RequestBody) {
  const history = Array.isArray(body.history) ? body.history : [];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const item of history) {
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (typeof item.content !== "string" || !item.content.trim()) continue;
    if (messages.length === 0 && item.role !== "user") continue;
    const last = messages[messages.length - 1];
    if (last && last.role === item.role) {
      last.content = `${String(last.content)}\n${item.content.trim()}`;
      continue;
    }
    messages.push({ role: item.role, content: item.content.trim() });
  }

  const userContent: Array<Record<string, unknown>> = [];
  if (body.image_base64) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: resolveMediaType(body.media_type, body.image_base64),
        data: stripDataUrl(body.image_base64),
      },
    });
  }
  userContent.push({
    type: "text",
    text: body.text?.trim() || "첨부 이미지에서 구독 정보를 추출하세요.",
  });

  messages.push({ role: "user", content: userContent });
  return messages;
}

function monthlyAmount(amount: number, cycle: string): number {
  if (cycle === "yearly") return Math.round(amount / 12);
  if (cycle === "one_time") return 0;
  return amount;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthPaymentFacts(active: ToolSubscription[], now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const asOf = year * 10000 + month * 100 + now.getDate();
  let recurring = 0;
  let oneTime = 0;
  let scheduled = 0;

  for (const item of active) {
    const [ay, am, ad] = (item.anchor_date ?? "").slice(0, 10).split("-").map(Number);
    if (!ay || !am || !ad) continue;
    let charge: number | null = null;
    if (item.billing_cycle === "one_time") {
      if (ay === year && am === month) charge = ay * 10000 + am * 100 + ad;
    } else if (item.billing_cycle === "yearly") {
      if (am === month) charge = year * 10000 + month * 100 + Math.min(ad, lastDayOfMonth(year, month));
    } else {
      charge = year * 10000 + month * 100 + Math.min(ad, lastDayOfMonth(year, month));
    }
    if (charge == null || charge < ay * 10000 + am * 100 + ad) continue;
    if (charge > asOf) scheduled += item.amount;
    else if (item.billing_cycle === "one_time") oneTime += item.amount;
    else recurring += item.amount;
  }

  const equivalent = active.reduce((sum, item) => sum + monthlyAmount(item.amount, item.billing_cycle), 0);
  return {
    monthly_total: equivalent,
    monthly_equivalent: equivalent,
    month_payment_total: recurring + oneTime,
    month_expected_total: recurring + oneTime + scheduled,
    month_payment_recurring: recurring,
    month_payment_one_time: oneTime,
    month_refunds: 0,
    month_scheduled: scheduled,
    active_count: active.length,
  };
}

/** next_payment_date는 'yyyy-MM-dd'. 로컬 날짜로 비교해 시간대 이동에 하루 밀리지 않게 한다. */
function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(year, (month ?? 1) - 1, day ?? 1);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

async function fetchToolSubscriptions(client: SupabaseClient): Promise<ToolSubscription[]> {
  const { data, error } = await client
    .from("subscriptions")
    .select("id,name,amount,billing_cycle,is_active,next_payment_date,anchor_date,category_id,account_id,created_at")
    .order("next_payment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ToolSubscription[];
}

async function runTool(
  name: string,
  input: unknown,
  client: SupabaseClient
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  const all = await fetchToolSubscriptions(client);
  const active = all.filter((item) => item.is_active);

  switch (name) {
    case "get_monthly_total": {
      return monthPaymentFacts(active);
    }

    case "get_category_totals": {
      const { data: categories, error } = await client.from("categories").select("id,name");
      if (error) throw new Error(error.message);
      const byId = new Map(
        (categories ?? []).map((row: { id: string; name: string }) => [row.id, row.name])
      );
      const totals = new Map<string, number>();
      for (const item of active) {
        const label = byId.get(item.category_id) ?? "기타";
        totals.set(label, (totals.get(label) ?? 0) + monthlyAmount(item.amount, item.billing_cycle));
      }
      return {
        totals: Array.from(totals, ([category, amount]) => ({ category, amount })),
      };
    }

    case "get_upcoming_subscriptions": {
      const withinDays = typeof args.within_days === "number" ? args.within_days : 7;
      const upcoming = active
        .map((item) => ({ ...item, days_until: daysUntil(item.next_payment_date) }))
        .filter((item) => item.days_until >= 0 && item.days_until <= withinDays)
        .sort((a, b) => a.days_until - b.days_until);
      return {
        subscriptions: upcoming.map((item) => ({
          name: item.name,
          amount: item.amount,
          billing_cycle: item.billing_cycle,
          next_payment_date: item.next_payment_date,
          days_until: item.days_until,
        })),
      };
    }

    case "find_subscriptions_by_name": {
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const matches = query ? all.filter((item) => item.name.toLowerCase().includes(query)) : [];
      return {
        subscriptions: matches.map((item) => ({
          id: item.id,
          name: item.name,
          amount: item.amount,
          billing_cycle: item.billing_cycle,
          is_active: item.is_active,
          account_id: item.account_id,
        })),
      };
    }

    case "list_subscriptions": {
      const categoryFilter =
        typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
      let list = active;
      if (categoryFilter) {
        const { data: categories, error } = await client.from("categories").select("id,name");
        if (error) throw new Error(error.message);
        const matchedIds = new Set(
          (categories ?? [])
            .filter((row: { name: string }) => row.name.toLowerCase().includes(categoryFilter))
            .map((row: { id: string }) => row.id)
        );
        list = list.filter((item) => matchedIds.has(item.category_id));
      }
      return {
        subscriptions: list.map((item) => ({
          name: item.name,
          amount: item.amount,
          billing_cycle: item.billing_cycle,
          monthly_amount: monthlyAmount(item.amount, item.billing_cycle),
        })),
      };
    }

    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const categoryHint = Array.isArray(body.categories) && body.categories.length > 0
    ? `\n사용자 카테고리: ${body.categories
      .map((item) => (item.key ? `${item.name}(${item.key})` : item.name))
      .join(", ")}`
    : "";

  const subscriptionHint = Array.isArray(body.subscriptions) && body.subscriptions.length > 0
    ? `\n기존 구독: ${body.subscriptions
      .map((item) => {
        const status = item.is_active ? "활성" : "정지";
        return `${item.name}(${item.id}, ${item.amount}원, ${item.billing_cycle}, ${status})`;
      })
      .join(", ")}`
    : "\n기존 구독: 없음";

  const ctx = body.briefing_context;
  const briefingHint = ctx && (ctx.event_id || ctx.subscription_id || ctx.intent || ctx.entry_source)
    ? `\n홈/비서 진입 맥락(힌트일 뿐, 사용 여부를 추측하지 마세요): event_id=${ctx.event_id ?? "없음"}, subscription_id=${ctx.subscription_id ?? "없음"}, intent=${ctx.intent ?? "없음"}, entry_source=${ctx.entry_source ?? "없음"}. 사용자가 사용 상태를 말하지 않았으면 usage_checkin은 null입니다.`
    : "";

  if (body.image_base64) {
    const mediaType = resolveMediaType(body.media_type, body.image_base64);
    if (!["image/jpeg", "image/png"].includes(mediaType)) {
      return json({ error: "JPEG, PNG 이미지만 지원합니다." }, 400);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const toolsAvailable = body.mode !== "extract" && Boolean(supabaseUrl && supabaseAnonKey);
  const supabase = toolsAvailable
    ? createClient(supabaseUrl!, supabaseAnonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    : null;

  const messages = buildMessages(body);
  let finalText = "";
  let upstreamError: string | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
        max_tokens: 1024,
        thinking: { type: "disabled" },
        system: SYSTEM_PROMPT + categoryHint + subscriptionHint + briefingHint,
        ...(toolsAvailable ? { tools: TOOLS } : {}),
        messages,
      }),
    });

    const anthropicJson = await anthropicRes.json();
    if (!anthropicRes.ok) {
      upstreamError =
        typeof anthropicJson?.error?.message === "string"
          ? anthropicJson.error.message
          : "Claude API 호출에 실패했습니다.";
      break;
    }

    const content = Array.isArray(anthropicJson.content) ? anthropicJson.content : [];
    const textBlocks = content.filter(
      (block: { type?: string; text?: string }) => block.type === "text"
    );
    finalText = textBlocks.map((block: { text?: string }) => block.text ?? "").join("\n");

    const toolUseBlocks = content.filter(
      (block: { type?: string }) => block.type === "tool_use"
    ) as { type: "tool_use"; id: string; name: string; input: unknown }[];

    const shouldCallTools =
      toolsAvailable && supabase && anthropicJson.stop_reason === "tool_use" && toolUseBlocks.length > 0;

    if (!shouldCallTools || round === MAX_TOOL_ROUNDS) {
      break;
    }

    messages.push({ role: "assistant", content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let output: unknown;
      try {
        output = await runTool(block.name, block.input, supabase!);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : "도구 실행에 실패했습니다." };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (upstreamError) {
    return json({ error: upstreamError }, 502);
  }

  return json(parseModelOutput(finalText, body.text));
});
