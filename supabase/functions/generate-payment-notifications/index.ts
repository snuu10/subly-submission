import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// ChatGPT 수정: 발송 결과 분류와 DB 선점 기반 재시도를 사용한다.
import { sendPushBatch } from "../_shared/notification-push.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 게이트웨이(verify_jwt=true)가 서명을 이미 검증했으므로, 여기서는 role 클레임만 확인한다.
// 프로젝트의 service_role 키 "값"(레거시 JWT/신규 sb_secret 등 형식)에 의존하지 않기 위함이다.
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

function kstISODate(from = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(from);
}

function kstHour(from = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23", // ChatGPT 수정: 자정을 24시로 해석해 발송하지 않도록 한다.
    }).format(from),
  );
}

type Ymd = { y: number; m: number; d: number };

function parseYmd(iso: string): Ymd {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toIso({ y, m, d }: Ymd): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// date-fns의 addMonths/addYears와 동일하게, 대상 월에 없는 날짜는 말일로 clamp한다.
// (앱/웹의 computeNextPaymentDate와 결제일 계산 규칙을 반드시 맞춰야 한다.)
function addMonthsClamped(anchor: Ymd, months: number): Ymd {
  const total = (anchor.m - 1) + months;
  const y = anchor.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function diffDaysYmd(a: Ymd, b: Ymd): number {
  const ta = Date.UTC(a.y, a.m - 1, a.d);
  const tb = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((ta - tb) / 86400000);
}

// 주기를 직전 결과가 아니라 항상 anchor에 배수로 더한다 (stores/subscription-store.ts와 동일 규칙).
function nextPaymentDateYmd(anchorIso: string, cycle: string, today: Ymd): Ymd {
  const anchor = parseYmd(anchorIso);
  if (cycle === "one_time") return anchor;
  const stepMonths = cycle === "yearly" ? 12 : 1;
  let periods = 0;
  let next = anchor;
  let guard = 0;
  while (compareYmd(next, today) < 0 && guard < 2000) {
    periods += 1;
    next = addMonthsClamped(anchor, periods * stepMonths);
    guard += 1;
  }
  return next;
}

const REMINDER_OFFSETS = [3, 1];
const KRW = new Intl.NumberFormat("ko-KR");
// ChatGPT 수정: 설정 시간에는 동일 알림을 무음 채널로 보낸다.
const NORMAL_CHANNEL_ID = "payment-reminders-v2";
const SILENT_CHANNEL_ID = "payment-reminders-silent-v1";

type PreferenceRow = {
  user_id: string;
  notifications_enabled: boolean;
  payment_due_enabled: boolean;
  payment_due_d3_enabled: boolean;
  payment_due_d1_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
};

function allowsReminder(preference: PreferenceRow | undefined, offset: number): boolean {
  if (!preference) return true;
  if (!preference.notifications_enabled || !preference.payment_due_enabled) return false;
  return offset === 3 ? preference.payment_due_d3_enabled :
    offset === 1 ? preference.payment_due_d1_enabled :
    offset === 0 ? true : false;
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function localMinutes(from: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(from);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function isQuietHours(preference: PreferenceRow | undefined, from: Date): boolean {
  if (!preference?.quiet_hours_enabled) return false;
  const nowMinutes = localMinutes(from, preference.timezone || "Asia/Seoul");
  const start = minutesFromTime(preference.quiet_start);
  const end = minutesFromTime(preference.quiet_end);
  if (start === end) return true;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

function titleFor(offset: number, name: string): string {
  return offset === 1 ? `내일 ${name} 결제 예정` : `${offset}일 후 ${name} 결제 예정`;
}

function bodyFor(paymentDate: Ymd, amount: number): string {
  return `${paymentDate.m}월 ${paymentDate.d}일 · ${KRW.format(amount)}원 결제 예정`;
}

// 체험 종료(D0)는 오전에 이미 결제가 발생했을 수 있어 "결제 전"이라 단정하지 않는다.
function trialTitleFor(name: string): string {
  return `${name} 무료 체험이 오늘 끝나요`;
}

function trialBodyFor(amount: number): string {
  return `오늘부터 ${KRW.format(amount)}원이 결제될 수 있어요`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const authHeader = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase is not configured" }, 503);
  if (!isServiceRoleRequest(authHeader)) return json({ error: "Forbidden" }, 403);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date();
  const todayIso = kstISODate(now);
  const hour = kstHour(now);
  // ChatGPT 수정: 발송 기준 시각(KST 오전 9시) 이전 실행은 건너뛰고 이후 5분마다 재시도한다.
  // 그날 몫이 누락 없이 만들어진다 (고유 제약으로 중복 생성은 막힌다).
  if (hour < 9) return json({ skipped: "before-9am-kst" });

  const today = parseYmd(todayIso);

  // ChatGPT 수정: 기본 응답 행 제한을 넘는 활성 구독도 누락하지 않는다.
  const subs = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("subscriptions")
      .select("id, user_id, name, amount, billing_cycle, anchor_date, is_active, is_trial, trial_ends_at")
      .eq("is_active", true).order("id").range(from, from + 499);
    if (error) return json({ error: error.message }, 500);
    subs.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }

  // ChatGPT 수정: 생성 전 사용자별 D-3/D-1 수신 설정을 한 번에 읽는다.
  const preferences = [] as PreferenceRow[];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("notification_preferences")
      .select("user_id,notifications_enabled,payment_due_enabled,payment_due_d3_enabled,payment_due_d1_enabled,push_enabled,quiet_hours_enabled,quiet_start,quiet_end,timezone")
      .order("user_id").range(from, from + 499);
    if (error) return json({ error: error.message }, 500);
    preferences.push(...((data ?? []) as PreferenceRow[]));
    if (!data || data.length < 500) break;
  }
  const preferencesByUser = new Map(preferences.map((item) => [item.user_id, item]));

  type NotificationRow = {
    user_id: string;
    subscription_id: string;
    kind: string;
    payment_date: string;
    reminder_offset: number;
    title: string;
    body: string;
    target_path: string;
  };
  const rows: NotificationRow[] = [];

  for (const sub of subs ?? []) {
    const name = typeof sub.name === "string" && sub.name.trim() ? sub.name.trim() : "구독";
    const amount = Number(sub.amount) || 0;

    // 체험 종료(D0): is_trial과 trial_ends_at 날짜로만 판정한다 — is_trial 하나만 보면
    // 체험이 끝난 뒤 다음 결제 주기에도 이 알림이 다시 생길 수 있다.
    const trialEndsAt = typeof sub.trial_ends_at === "string" ? sub.trial_ends_at : null;
    if (sub.is_trial === true && trialEndsAt === todayIso) {
      if (allowsReminder(preferencesByUser.get(sub.user_id), 0)) {
        rows.push({
          user_id: sub.user_id,
          subscription_id: sub.id,
          kind: "trial_ending",
          payment_date: trialEndsAt,
          reminder_offset: 0,
          title: trialTitleFor(name),
          body: trialBodyFor(amount),
          target_path: `/subscription/${sub.id}`,
        });
      }
    }

    const anchor = typeof sub.anchor_date === "string" ? sub.anchor_date : null;
    if (!anchor) continue;
    const cycle = typeof sub.billing_cycle === "string" ? sub.billing_cycle : "monthly";
    const paymentYmd = nextPaymentDateYmd(anchor, cycle, today);
    const daysUntil = diffDaysYmd(paymentYmd, today);
    if (!REMINDER_OFFSETS.includes(daysUntil)) continue;
    if (!allowsReminder(preferencesByUser.get(sub.user_id), daysUntil)) continue;

    rows.push({
      user_id: sub.user_id,
      subscription_id: sub.id,
      kind: "payment_due",
      payment_date: toIso(paymentYmd),
      reminder_offset: daysUntil,
      title: titleFor(daysUntil, name),
      body: bodyFor(paymentYmd, amount),
      target_path: `/subscription/${sub.id}`,
    });
  }

  // ChatGPT 수정: 생성 결과가 0개여도 기존 알림의 대기/재시도 작업은 계속 처리한다.
  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.from("notifications").upsert(rows.slice(i, i + 500), {
      onConflict: "user_id,subscription_id,payment_date,reminder_offset",
      ignoreDuplicates: true,
    }).select("id");
    if (error) return json({ error: error.message }, 500);
    created += data?.length ?? 0;
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_notification_deliveries", { p_limit: 100 });
  if (claimError) return json({ error: claimError.message }, 500);
  type Job = {
    id: string; notification_id: string; device_id: string; user_id: string; token: string;
    title: string; body: string; subscription_id: string; claim_token: string; badge: number;
  };
  // ChatGPT 수정: 전송 전 오류는 claimed로 남아 복구 가능하며, 한 RPC로 직전 상태를 검증한다.
  const candidates = (claimed ?? []) as Job[];
  if (!candidates.length) return json({ created, attempted: 0, accepted: 0 });
  const { data: started, error: startError } = await supabase.rpc("start_notification_deliveries", {
    p_claims: candidates.map((job) => ({ id: job.id, claim_token: job.claim_token })),
  });
  if (startError) return json({ error: startError.message }, 500);
  const startedIds = new Set((started ?? []).map((row: { id: string }) => row.id));
  const jobs = candidates.filter((job) => startedIds.has(job.id));

  const outcomes = await sendPushBatch(jobs.map((job) => {
    const preference = preferencesByUser.get(job.user_id);
    const silent = isQuietHours(preference, now);
    return {
      to: job.token, title: job.title, body: job.body, badge: job.badge,
      channelId: silent ? SILENT_CHANNEL_ID : NORMAL_CHANNEL_ID,
      sound: silent ? null : "default" as const,
      data: {
        kind: "payment_due",
        notificationId: job.notification_id,
        subscriptionId: job.subscription_id,
        silent,
      },
    };
  }));
  let accepted = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const result = outcomes[i];
    const { error } = await supabase.rpc("finish_notification_delivery", {
      p_id: job.id, p_claim: job.claim_token, p_status: result.status,
      p_ticket: result.ticket ?? null, p_code: result.code ?? null, p_message: result.message ?? null,
    });
    // DB 기록 실패는 그대로 보고한다. sending lease가 만료되면 unknown으로 남는다.
    if (error) return json({ error: error.message }, 500);
    if (result.status === "ticket_ok") accepted++;
  }
  return json({ created, attempted: jobs.length, accepted });
});
