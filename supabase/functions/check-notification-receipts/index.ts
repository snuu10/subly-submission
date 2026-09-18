import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 게이트웨이(verify_jwt=true)가 서명을 이미 검증했으므로, 여기서는 role 클레임만 확인한다.
function isServiceRoleRequest(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const parts = authHeader.slice(7).split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

type ExpoReceipt = {
  status: "ok" | "error";
  message?: string;
  details?: Record<string, unknown>;
};

async function fetchExpoReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const result: Record<string, ExpoReceipt> = {};
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ids: chunk }),
        // ChatGPT 수정: 무응답 조회는 다음 Cron으로 넘긴다(푸시를 재발송하지 않음).
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => null)) as { data?: Record<string, ExpoReceipt> } | null;
      if (res.ok && body?.data) Object.assign(result, body.data);
    } catch {
      // 이번 실행에서 이 배치는 건너뛰고 다음 실행에서 다시 시도한다.
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const authHeader = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase is not configured" }, 503);
  if (!isServiceRoleRequest(authHeader)) return json({ error: "Forbidden" }, 403);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const nowIso = new Date().toISOString();
  const readyCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from("notification_push_deliveries")
    // ChatGPT 수정: 당시 토큰/소유자를 보존해 계정 전환 후 다른 기기를 비활성화하지 않는다.
    .select("id, expo_ticket_id, device_id, attempted_token, attempted_user_id, attempt_count")
    .eq("status", "ticket_ok")
    .not("expo_ticket_id", "is", null)
    .lte("sent_at", readyCutoff)
    .order("sent_at")
    .limit(1000);

  if (error) return json({ error: error.message }, 500);

  let disabledCount = 0;

  if (pending && pending.length > 0) {
    const idToDelivery = new Map(pending.map((p) => [p.expo_ticket_id as string, p]));
    const receipts = await fetchExpoReceipts(pending.map((p) => p.expo_ticket_id as string));

    for (const [ticketId, receipt] of Object.entries(receipts)) {
      const delivery = idToDelivery.get(ticketId);
      if (!delivery) continue;
      if (receipt?.status !== "ok" && receipt?.status !== "error") continue;
      const isOk = receipt.status === "ok";
      const errorCode = !isOk ? (receipt.details?.error as string | undefined) : undefined;

      // ChatGPT 수정: 성공이 아닌 명확한 일시 오류만 제한된 재시도 큐로 돌린다.
      const retry = errorCode === "MessageRateExceeded" && delivery.attempt_count < 5;
      const { data: updated, error: updateError } = await supabase
        .from("notification_push_deliveries")
        .update({
          status: isOk ? "delivered" : retry ? "retry" : "error",
          error_code: errorCode ?? null,
          error_message: isOk ? null : (receipt.message ?? null),
          checked_at: nowIso,
          next_attempt_at: new Date(Date.now() + 5 * 60 * 1000 * 2 ** Math.max(0, delivery.attempt_count - 1)).toISOString(),
        })
        .eq("id", delivery.id as string)
        .eq("status", "ticket_ok")
        .eq("expo_ticket_id", ticketId)
        .select("id");
      if (updateError) return json({ error: updateError.message }, 500);
      if (!updated?.length) continue;

      if (errorCode === "DeviceNotRegistered") {
        if (!delivery.attempted_token || !delivery.attempted_user_id) continue;
        const { data: disabled, error: disableError } = await supabase.from("notification_devices")
          .update({ enabled: false, updated_at: nowIso })
          .eq("id", delivery.device_id).eq("expo_push_token", delivery.attempted_token)
          .eq("user_id", delivery.attempted_user_id).select("id");
        if (disableError) return json({ error: disableError.message }, 500);
        disabledCount += disabled?.length ?? 0;
      }
    }

  }

  // Expo Receipt는 발급 후 일정 기간이 지나면 사라진다. 하루가 지나도 못 받은 티켓은
  // 더 재시도하지 않고 unknown으로 종료해 매 실행마다 계속 재조회되는 것을 막는다.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // ChatGPT 수정: DB 갱신 실패를 정상 처리로 보고하지 않는다.
  const { error: staleError } = await supabase
    .from("notification_push_deliveries")
    .update({ status: "unknown", checked_at: nowIso })
    .eq("status", "ticket_ok")
    .lte("sent_at", staleCutoff);
  if (staleError) return json({ error: staleError.message }, 500);

  return json({ checked: pending?.length ?? 0, disabled: disabledCount });
});
