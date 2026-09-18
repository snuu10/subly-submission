import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { claudeText } from "../_shared/claude.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function scrubPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(CARD_RE, "[card]")
    .replace(UUID_RE, "[id]")
    .slice(0, 80)
    .trim();
}

function kstISODate(from = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(from);
}

function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function weekStartKst(from = new Date()): string {
  const iso = kstISODate(from);
  const date = new Date(`${iso}T12:00:00+09:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
  const offset: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return addDaysISO(iso, -(offset[wd] ?? 0));
}

function addCycle(iso: string, cycle: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (cycle === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

type DigestCharge = {
  name: string;
  amount: number;
  billing_cycle: string;
  charge_date: string;
};

function chargesInRange(
  name: string,
  anchor: string,
  cycle: string,
  amount: number,
  from: string,
  to: string,
): DigestCharge[] {
  if (cycle === "one_time") {
    return from <= anchor && anchor <= to
      ? [{ name, amount, billing_cycle: cycle, charge_date: anchor }]
      : [];
  }
  let cursor = anchor;
  let guard = 0;
  while (cursor < from && guard < 400) {
    cursor = addCycle(cursor, cycle);
    guard += 1;
  }
  const charges: DigestCharge[] = [];
  while (cursor <= to && guard < 800) {
    charges.push({ name, amount, billing_cycle: cycle, charge_date: cursor });
    cursor = addCycle(cursor, cycle);
    guard += 1;
  }
  return charges;
}

function digestReason(thisCharges: DigestCharge[], lastCharges: DigestCharge[], delta: number): string {
  if (delta === 0) return "지난주와 결제 예정 금액이 같아요.";
  if (delta < 0) return "지난주보다 이번 주 결제 예정 금액이 적어요.";
  const yearly = thisCharges.filter((item) => item.billing_cycle === "yearly");
  if (yearly.length > 0) return "연간 구독 갱신이 이번 주에 포함돼 있어요.";
  if (thisCharges.length > lastCharges.length) return "이번 주 결제 예정 건수가 지난주보다 많아요.";
  return "이번 주에 예정된 구독 구성이 지난주와 달라요.";
}

async function geminiOneLiner(input: {
  names: string[];
  lastWeek: number;
  thisWeek: number;
}): Promise<string> {
  const fallback = input.thisWeek === input.lastWeek
    ? "이번 주 청구액은 지난주와 비슷해요."
    : input.thisWeek > input.lastWeek
      ? `이번 주 결제 예정액이 지난주보다 ${(input.thisWeek - input.lastWeek).toLocaleString("ko-KR")}원 많아요.`
      : `이번 주 결제 예정액이 지난주보다 ${(input.lastWeek - input.thisWeek).toLocaleString("ko-KR")}원 적어요.`;

  // Gemini (데모데이: Claude로 대체)
  // const apiKey = Deno.env.get("GEMINI_API_KEY");
  // if (!apiKey) return fallback;
  // const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3-flash-preview";

  const payload = {
    service_names: input.names.map(scrubPii).filter(Boolean).slice(0, 20),
    last_week_krw: input.lastWeek,
    this_week_krw: input.thisWeek,
  };
  const prompt = `당신은 구독 지출 앱의 한 줄 브리핑 작가입니다. 검색하지 마세요.
아래 JSON만 보고 한국어 한 문장만 출력하세요. 실제 결제가 아니라 등록 일정 기준 결제 예정 정보입니다.
이름·이메일·계정은 쓰지 말고 서비스명과 금액만 언급하세요. 반드시 "결제 예정"이라고 표현하세요.
40자 이내. JSON 말고 문장만.
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
    //       generationConfig: { temperature: 0.4, maxOutputTokens: 80 },
    //     }),
    //   },
    // );
    // if (!res.ok) return fallback;
    // const body = await res.json() as {
    //   candidates?: { content?: { parts?: { text?: string }[] } }[];
    // };
    // const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    // return text.slice(0, 80) || fallback;

    const text = await claudeText({
      user: prompt,
      maxTokens: 80,
    });
    return text?.slice(0, 80) || fallback;
  } catch {
    return fallback;
  }
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

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const weekStart = weekStartKst();

  const { data: cached } = await supabase
    .from("ai_briefings")
    .select("payload")
    .eq("kind", "weekly_digest")
    .eq("week_start", weekStart)
    .maybeSingle();

  const cachedPayload = cached?.payload as Record<string, unknown> | null;
  const cachedSummary = cachedPayload?.summary;
  if (cachedPayload?.version === 2 && typeof cachedSummary === "string" && cachedSummary.trim()) {
    return json({ ...cachedPayload, week_start: weekStart, cached: true });
  }

  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("name, amount, billing_cycle, anchor_date, is_active")
    .eq("is_active", true);

  if (error) return json({ error: error.message }, 500);

  const thisWeekEnd = addDaysISO(weekStart, 6);
  const lastWeekStart = addDaysISO(weekStart, -7);
  const lastWeekEnd = addDaysISO(weekStart, -1);

  let thisWeek = 0;
  let lastWeek = 0;
  const thisWeekCharges: DigestCharge[] = [];
  const lastWeekCharges: DigestCharge[] = [];

  for (const row of rows ?? []) {
    const name = typeof row.name === "string" ? scrubPii(row.name) : "";
    const cycle = typeof row.billing_cycle === "string" ? row.billing_cycle : "monthly";
    const amount = Number(row.amount) || 0;
    const anchor = typeof row.anchor_date === "string" ? row.anchor_date : weekStart;
    if (name && amount > 0) {
      const current = chargesInRange(name, anchor, cycle, amount, weekStart, thisWeekEnd);
      const previous = chargesInRange(name, anchor, cycle, amount, lastWeekStart, lastWeekEnd);
      thisWeekCharges.push(...current);
      lastWeekCharges.push(...previous);
      thisWeek += current.reduce((sum, item) => sum + item.amount, 0);
      lastWeek += previous.reduce((sum, item) => sum + item.amount, 0);
    }
  }

  const summary = await geminiOneLiner({
    names: thisWeekCharges.map((item) => item.name),
    lastWeek,
    thisWeek,
  });
  const delta = thisWeek - lastWeek;
  const payload = {
    version: 2,
    summary,
    week_start: weekStart,
    week_end: thisWeekEnd,
    last_week: lastWeek,
    this_week: thisWeek,
    delta,
    trend: delta === 0 ? "same" : delta > 0 ? "up" : "down",
    reason: digestReason(thisWeekCharges, lastWeekCharges, delta),
    charges: thisWeekCharges,
    generated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase.from("ai_briefings").upsert(
    {
      user_id: userId,
      kind: "weekly_digest",
      week_start: weekStart,
      payload,
    },
    { onConflict: "user_id,kind,week_start" },
  );

  if (upsertError) {
    return json({ ...payload, cached: false });
  }

  return json({ ...payload, cached: false });
});
