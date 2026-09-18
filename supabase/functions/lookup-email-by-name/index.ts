import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = typeof body.name === "string" ? normalizeName(body.name) : "";
  if (name.length < 1) {
    return json({ error: "이름을 입력해 주세요." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const emails = new Set<string>();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: "조회에 실패했습니다." }, 500);
    for (const user of data.users) {
      const metaName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "";
      if (normalizeName(metaName) !== name) continue;
      if (!user.email) continue;
      emails.add(maskEmail(user.email));
    }
    if (data.users.length < 200) break;
  }

  return json({ emails: [...emails].sort() });
});
