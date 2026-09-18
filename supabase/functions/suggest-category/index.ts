import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { claudeText, parseClaudeJson } from "../_shared/claude.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const KEYS = ["entertainment", "music", "work", "health", "education", "cloud", "etc"] as const;
type CategoryKey = (typeof KEYS)[number];

const ICON_KEYS = [
  "film", "music", "play", "cloud", "palette", "file-text", "bot", "tv",
  "dumbbell", "book-open", "gamepad-2", "briefcase-business", "globe-2",
  "package", "heart", "zap",
] as const;
type IconKey = (typeof ICON_KEYS)[number];

const DEFAULT_EMOJI: Record<CategoryKey, string> = {
  entertainment: "🎬",
  music: "🎵",
  work: "💼",
  health: "🏋️",
  education: "📚",
  cloud: "☁️",
  etc: "📦",
};

const DEFAULT_ICON: Record<CategoryKey, IconKey> = {
  entertainment: "film",
  music: "music",
  work: "briefcase-business",
  health: "dumbbell",
  education: "book-open",
  cloud: "cloud",
  etc: "package",
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

function asKey(value: unknown): CategoryKey | null {
  return typeof value === "string" && (KEYS as readonly string[]).includes(value)
    ? (value as CategoryKey)
    : null;
}

function asIconKey(value: unknown): IconKey | null {
  return typeof value === "string" && (ICON_KEYS as readonly string[]).includes(value)
    ? (value as IconKey)
    : null;
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
  if (!userData.user?.id) return json({ error: "Unauthorized" }, 401);

  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = typeof body.name === "string" ? scrubPii(body.name) : "";
  if (name.length < 2) {
    return json({ category_key: "etc", icon_key: DEFAULT_ICON.etc, emoji: DEFAULT_EMOJI.etc });
  }

  const fallback = {
    category_key: "etc" as CategoryKey,
    icon_key: DEFAULT_ICON.etc,
    emoji: DEFAULT_EMOJI.etc,
  };
  // Gemini (데모데이: Claude로 대체)
  // const apiKey = Deno.env.get("GEMINI_API_KEY");
  // if (!apiKey) return json(fallback);
  // const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3-flash-preview";

  const prompt = `당신은 구독 분류기입니다. 검색하지 마세요.
서비스 표시명만 보고 다음 JSON만 출력하세요.
{"category_key":"entertainment|music|work|health|education|cloud|etc","icon_key":"film|music|play|cloud|palette|file-text|bot|tv|dumbbell|book-open|gamepad-2|briefcase-business|globe-2|package|heart|zap"}
규칙:
- entertainment: OTT·영상
- music: 음악
- work: 생산성·AI 도구
- health: 운동·건강
- education: 학습
- cloud: 클라우드·오피스
- etc: 그 외
- icon_key는 서비스의 핵심 용도를 가장 구체적으로 나타내는 허용값 하나만 선택
입력: ${JSON.stringify({ name })}`;

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
    // if (!res.ok) return json(fallback);
    // const payload = await res.json() as {
    //   candidates?: { content?: { parts?: { text?: string }[] } }[];
    // };
    // const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // const parsed = JSON.parse(text) as Record<string, unknown>;

    const text = await claudeText({
      system: "JSON만 출력하세요. 마크다운 펜스 없이.",
      user: prompt,
      maxTokens: 80,
    });
    if (!text) return json(fallback);
    const parsed = parseClaudeJson(text) as Record<string, unknown>;
    const key = asKey(parsed.category_key) ?? "etc";
    const iconKey = asIconKey(parsed.icon_key) ?? DEFAULT_ICON[key];
    // emoji는 구버전 클라이언트 호환용이며 새 앱/웹은 icon_key만 사용한다.
    return json({ category_key: key, icon_key: iconKey, emoji: DEFAULT_EMOJI[key] });
  } catch {
    return json(fallback);
  }
});
