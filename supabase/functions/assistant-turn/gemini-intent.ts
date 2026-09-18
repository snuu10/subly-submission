import {
  addCalendarDays,
  isoDate,
  monthlyCanonicalAnchor,
  nextMonthlyBillingDate,
  nextWeeklyBillingDate,
  nextYearlyBillingDate,
  normalizeName,
  seoulYmd,
  shiftMonth,
  yearlyCanonicalAnchor,
} from "./queries.ts";
import { claudeText, parseClaudeJson } from "../_shared/claude.ts";

export const ASSISTANT_INTENTS = [
  "monthly_total",
  "expensive_subscriptions",
  "upcoming_payments",
  "list_subscriptions",
  "category_analysis",
  "period_comparison",
  "price_increases",
  "cleanup_candidates",
  "cancel_savings",
  "usage_checkin",
  "cancellation_guide",
  "lifecycle_update",
  "create_subscription",
  "update_subscription",
  "delete_subscription",
  "pause_subscription",
  "resume_subscription",
  "unknown",
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export const USAGE_RESPONSES = ["used_recently", "occasionally", "not_used", "unsure"] as const;
export type UsageResponse = (typeof USAGE_RESPONSES)[number];

export const BILLING_CYCLES = ["monthly", "yearly", "one_time"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const CATEGORY_KEYS = [
  "entertainment",
  "music",
  "work",
  "health",
  "education",
  "cloud",
  "etc",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
export const LIFECYCLE_STATUSES = [
  "active",
  "guide_reviewed",
  "cancel_requested",
  "ending_scheduled",
  "ended",
  "end_confirm_needed",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export type ReferentKind = "none" | "ordinal" | "pronoun" | "name";
export type PeriodType =
  | "this_month"
  | "last_month"
  | "next_n_days"
  | "calendar_month"
  | "this_week"
  | "next_week"
  | "unknown";

export type ClassifiedPeriod = {
  type: PeriodType;
  days: number | null;
  year: number | null;
  month: number | null;
};

export type ClassifiedIntent = {
  intent: AssistantIntent;
  service_name: string | null;
  limit: number | null;
  period: ClassifiedPeriod;
  referent: { kind: ReferentKind; ordinal: number | null; name: string | null };
  usage_response: UsageResponse | null;
  amount: number | null;
  billing_cycle: BillingCycle | null;
  anchor_date: string | null;
  category_key: CategoryKey | null;
  lifecycle_status: LifecycleStatus | null;
  is_trial: boolean | null;
  /** 'yyyy-MM-dd' 체험 종료일(= 첫 유료 결제일). anchor_date와 별개로 보관 */
  trial_ends_at: string | null;
  /** 0~1. LLM이 이 의도 판정에 얼마나 확신하는지. 규칙 기반으로 재분류된 경우는 1로 강제한다. */
  confidence: number;
};

/** 관리형/실행형 의도에서 confidence가 이 값 미만이면 바로 실행하지 않고 먼저 확인을 묻는다. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const PERIOD_TYPES: readonly PeriodType[] = [
  "this_month",
  "last_month",
  "next_n_days",
  "calendar_month",
  "this_week",
  "next_week",
  "unknown",
];

export function scrubPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(CARD_RE, "[card]")
    .replace(UUID_RE, "[id]")
    .slice(0, 280)
    .trim();
}

const UNKNOWN: ClassifiedIntent = {
  intent: "unknown",
  service_name: null,
  limit: null,
  period: { type: "unknown", days: null, year: null, month: null },
  referent: { kind: "none", ordinal: null, name: null },
  usage_response: null,
  amount: null,
  billing_cycle: null,
  anchor_date: null,
  category_key: null,
  lifecycle_status: null,
  is_trial: null,
  trial_ends_at: null,
  confidence: 1,
};

function emptyPeriod(): ClassifiedPeriod {
  return { type: "unknown", days: null, year: null, month: null };
}

function asIntent(value: unknown): AssistantIntent {
  return typeof value === "string" && (ASSISTANT_INTENTS as readonly string[]).includes(value)
    ? (value as AssistantIntent)
    : "unknown";
}

function asUsage(value: unknown): UsageResponse | null {
  return typeof value === "string" && (USAGE_RESPONSES as readonly string[]).includes(value)
    ? (value as UsageResponse)
    : null;
}

function asCycle(value: unknown): BillingCycle | null {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value)
    ? (value as BillingCycle)
    : null;
}

function asCategoryKey(value: unknown): CategoryKey | null {
  return typeof value === "string" && (CATEGORY_KEYS as readonly string[]).includes(value)
    ? (value as CategoryKey)
    : null;
}

function asAmount(value: unknown): number | null {
  const n = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value.replace(/,/g, ""))
    : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function asLimit(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function asYearMonth(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function asPeriod(value: unknown): ClassifiedPeriod {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyPeriod();
  const row = value as Record<string, unknown>;
  const type = typeof row.type === "string" && (PERIOD_TYPES as readonly string[]).includes(row.type)
    ? row.type as PeriodType
    : "unknown";
  const daysRaw = typeof row.days === "number" ? row.days : Number(row.days);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.round(daysRaw))) : null;
  const yearRaw = asYearMonth(row.year);
  const monthRaw = asYearMonth(row.month);
  const month = monthRaw != null && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;
  const today = seoulYmd();
  const year = yearRaw != null && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : null;
  if (type === "calendar_month" && month != null) {
    return { type, days: null, year: year ?? today.year, month };
  }
  if (type === "next_n_days") {
    return { type, days: days ?? 7, year: null, month: null };
  }
  return { type, days: type === "unknown" ? days : null, year, month };
}

function asReferent(value: unknown): ClassifiedIntent["referent"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "none", ordinal: null, name: null };
  }
  const row = value as Record<string, unknown>;
  const kind = row.kind === "ordinal" || row.kind === "pronoun" || row.kind === "name"
    ? row.kind
    : "none";
  const ordinalRaw = typeof row.ordinal === "number" ? row.ordinal : Number(row.ordinal);
  const ordinal = Number.isFinite(ordinalRaw) ? Math.round(ordinalRaw) : null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  return {
    kind,
    ordinal: kind === "ordinal" && ordinal && ordinal > 0 ? ordinal : null,
    name: kind === "name" ? name : null,
  };
}

function asLifecycle(value: unknown): LifecycleStatus | null {
  return typeof value === "string" && (LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as LifecycleStatus)
    : null;
}

function asDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** 범위 밖이거나 숫자가 아니면 1(=항상 진행)로 폴백한다 — LLM이 필드를 안 주더라도 게이트가
 * 오작동(항상 확인 질문)하지 않게 하는 안전한 기본값이다. */
function asConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return 1;
  return n;
}

export function parseClassifiedIntent(raw: unknown): ClassifiedIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...UNKNOWN };
  const row = raw as Record<string, unknown>;
  const parsed: ClassifiedIntent = {
    intent: asIntent(row.intent),
    service_name: cleanServiceName(
      typeof row.service_name === "string" ? row.service_name : null,
    ),
    limit: asLimit(row.limit),
    period: asPeriod(row.period),
    referent: asReferent(row.referent),
    usage_response: asUsage(row.usage_response),
    amount: asAmount(row.amount),
    billing_cycle: asCycle(row.billing_cycle),
    anchor_date: asDate(row.anchor_date),
    category_key: asCategoryKey(row.category_key),
    lifecycle_status: asLifecycle(row.lifecycle_status),
    is_trial: typeof row.is_trial === "boolean" ? row.is_trial : null,
    trial_ends_at: asDate(row.trial_ends_at),
    confidence: asConfidence(row.confidence),
  };
  return enforceSlots(parsed);
}

export function matchServiceName(userText: string, names: string[]): string | null {
  const compact = normalizeName(userText);
  if (!compact) return null;
  const unique = [...new Set(names.filter((name) => name.trim()))];
  unique.sort((a, b) => normalizeName(b).length - normalizeName(a).length);
  for (const name of unique) {
    const needle = normalizeName(name);
    if (needle.length >= 2 && compact.includes(needle)) return name;
  }
  const leftover = compact.replace(/삭제|지워줘|지워|구독삭제|목록에서|빼줘|빼기|빼|구독/g, "");
  if (leftover.length < 2) return null;
  const hits = unique.filter((name) => {
    const n = normalizeName(name);
    return n.includes(leftover) || leftover.includes(n);
  });
  return hits.length === 1 ? hits[0] : null;
}

export function mentionsPriorList(text: string): boolean {
  return /그중|그중에서|목록중|에서제일|에서가장|그목록/.test(text.replace(/\s+/g, ""));
}

export function parseWonAmount(text: string): number | null {
  return parseKoreanAmount(text);
}

const ACTION_TAIL_RE =
  /(?:을|를)?(?:으로|로)?(?:등록|추가(?:해줘|해|하기)?|변경|바꿔줘|바꿔|수정해줘|수정|해줘|할게|할래|하기)?$/;
const DATE_KO_COMPACT_RE = /(?:\d{4}년)?\d{1,2}월\d{1,2}일/g;
const DATE_ISO_RE = /\d{4}-\d{1,2}-\d{1,2}/g;
const DATE_SLASH_COMPACT_RE = /\d{1,2}[./]\d{1,2}(?:일)?(?![만천원\d])/g;

function stripSpokenDate(compact: string): string {
  return compact
    .replace(DATE_KO_COMPACT_RE, "")
    .replace(DATE_ISO_RE, "")
    .replace(DATE_SLASH_COMPACT_RE, "");
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 등록 초안의 결제 일. 15, 또는 월을 물은 뒤의 15일. */
export function parseCreateDayNumber(text: string): number | null {
  const compact = text.replace(/\s+/g, "");
  const match = compact.match(/^(\d{1,2})일?$/);
  if (!match) return null;
  const day = Number(match[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

/** 등록 초안에서 월. 9월, 또는 allowBare일 때 9. */
export function parseCreateMonthNumber(text: string, opts: { allowBare?: boolean } = {}): number | null {
  const compact = text.replace(/\s+/g, "");
  const labeled = compact.match(/^(\d{1,2})월$/);
  if (labeled) {
    const month = Number(labeled[1]);
    if (month >= 1 && month <= 12) return month;
    return null;
  }
  if (opts.allowBare) {
    const bare = compact.match(/^(\d{1,2})$/);
    if (!bare) return null;
    const month = Number(bare[1]);
    if (month >= 1 && month <= 12) return month;
  }
  return null;
}

export function calendarDateFromMonthDay(month: number, day: number, now = new Date()): string | null {
  return toIsoDate(seoulYmd(now).year, month, day);
}

export function parseKoreanDate(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  const iso = compact.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const korean = compact.match(/(?:(\d{4})년)?(\d{1,2})월(\d{1,2})일/);
  if (korean) {
    const year = korean[1] ? Number(korean[1]) : seoulYmd().year;
    return toIsoDate(year, Number(korean[2]), Number(korean[3]));
  }
  const slash = compact.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?:일)?(?![만천원\d])/);
  if (slash) {
    return toIsoDate(seoulYmd().year, Number(slash[1]), Number(slash[2]));
  }
  return null;
}

/** "오늘 기준으로 7일 뒤", "7일 후"처럼 상대적으로 말한 날짜. 체험 종료일에 흔히 쓰인다. */
export function parseRelativeKoreanDate(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  const match = compact.match(/(\d{1,3})일(?:뒤|후)(?:에)?/);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days <= 0 || days > 365) return null;
  const today = seoulYmd();
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

const WEEKDAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

/** "내일"/"모레"/"글피"/"이번주·다음주 O요일"처럼 상대 요일·일수로 말한 날짜. "오늘"은
 * parseBillingDate가 별도로 처리하므로 여기서는 다루지 않는다. */
export function parseRelativeDayWord(text: string, now = new Date()): string | null {
  const compact = text.replace(/\s+/g, "");
  const today = seoulYmd(now);

  if (/내일/.test(compact)) {
    const next = addCalendarDays(today.year, today.month, today.day, 1);
    return isoDate(next.year, next.month, next.day);
  }
  if (/모레/.test(compact)) {
    const next = addCalendarDays(today.year, today.month, today.day, 2);
    return isoDate(next.year, next.month, next.day);
  }
  if (/글피/.test(compact)) {
    const next = addCalendarDays(today.year, today.month, today.day, 3);
    return isoDate(next.year, next.month, next.day);
  }

  const weekMatch = compact.match(/(이번주|다음주)([일월화수목금토])요일/);
  if (weekMatch) {
    const weekday = WEEKDAY_INDEX[weekMatch[2]];
    const thisWeek = nextWeeklyBillingDate(weekday, now);
    if (!thisWeek) return null;
    if (weekMatch[1] === "이번주") return thisWeek;
    const [y, m, d] = thisWeek.split("-").map(Number);
    const next = addCalendarDays(y, m, d, 7);
    return isoDate(next.year, next.month, next.day);
  }

  return null;
}

export type ParsedBillingDate = {
  date: string;
  next: string | null;
  cycle: BillingCycle | null;
  day: number | null;
};

export function parseSpokenCycle(text: string): BillingCycle | null {
  const compact = text.replace(/\s+/g, "");
  if (/일회성|일시불|단건|한번만|한번결제/.test(compact) || /일회(?!원)/.test(compact)) {
    return "one_time";
  }
  if (/매년|연간/.test(compact) || /연[\d만천원]/.test(compact)) return "yearly";
  if (/매월|매달|월간/.test(compact) || /매일\d{1,3}일/.test(compact)) return "monthly";
  if (/월[\d,]+원/.test(compact)) return "monthly";
  return null;
}

export function parseBillingDate(
  text: string,
  opts: { allowBareDay?: boolean } = {},
): ParsedBillingDate | null {
  const compact = text.replace(/\s+/g, "");
  if (/오늘결제|오늘냈|오늘했어/.test(compact) || compact === "오늘") {
    const today = seoulYmd();
    const date = isoDate(today.year, today.month, today.day);
    return { date, next: date, cycle: parseSpokenCycle(text), day: today.day };
  }

  const relativeDay = parseRelativeDayWord(text);
  if (relativeDay) {
    const day = Number(relativeDay.slice(8, 10));
    return { date: relativeDay, next: relativeDay, cycle: parseSpokenCycle(text), day };
  }

  const yearly = compact.match(/(?:매년|연간)(?:(\d{4})년)?(\d{1,2})월(\d{1,2})일/);
  if (yearly) {
    const month = Number(yearly[2]);
    const day = Number(yearly[3]);
    const next = nextYearlyBillingDate(month, day);
    const date = yearlyCanonicalAnchor(month, day);
    if (!date || !next) return null;
    return { date, next, cycle: "yearly", day };
  }

  const nextPay = compact.match(/다음결제일(?:은|이)?(?:(\d{4})년)?(\d{1,2})월(\d{1,2})일/);
  if (nextPay) {
    const year = nextPay[1] ? Number(nextPay[1]) : seoulYmd().year;
    const date = toIsoDate(year, Number(nextPay[2]), Number(nextPay[3]));
    if (!date) return null;
    return { date, next: date, cycle: parseSpokenCycle(text), day: Number(nextPay[3]) };
  }

  const monthly = compact.match(/(?:매월|매달|매일|월간)(\d{1,2})일/);
  if (monthly) {
    const day = Number(monthly[1]);
    const date = monthlyCanonicalAnchor(day);
    const next = nextMonthlyBillingDate(day);
    if (!date || !next) return null;
    return { date, next, cycle: "monthly", day };
  }

  // 「11일 매월 갱신」처럼 결제일을 먼저 말해도 매월 결제로 읽는다.
  // 연·월·일을 모두 말한 달력 날짜는 아래 분기가 맡으므로 여기서 건드리지 않는다.
  if (/매월|매달|월간/.test(compact) && !/\d{1,2}월\d{1,2}일/.test(compact)) {
    const dayFirst = compact.match(/(\d{1,2})일/);
    if (dayFirst) {
      const day = Number(dayFirst[1]);
      const date = monthlyCanonicalAnchor(day);
      const next = nextMonthlyBillingDate(day);
      if (date && next) return { date, next, cycle: "monthly", day };
    }
  }

  const monthlyShort = compact.match(/^월(\d{1,2})일$/);
  if (monthlyShort) {
    const day = Number(monthlyShort[1]);
    const date = monthlyCanonicalAnchor(day);
    const next = nextMonthlyBillingDate(day);
    if (!date || !next) return null;
    return { date, next, cycle: "monthly", day };
  }

  const calendar = parseKoreanDate(text);
  if (calendar) {
    const day = Number(calendar.slice(8, 10));
    return { date: calendar, next: calendar, cycle: parseSpokenCycle(text), day };
  }

  const namedDay = compact.match(
    /결제(?:일|날짜)(?:을|를)?(?:은|는)?(?:매월|매달|월간)?(\d{1,2})일/,
  );
  if (namedDay) {
    const day = Number(namedDay[1]);
    const date = monthlyCanonicalAnchor(day);
    const next = nextMonthlyBillingDate(day);
    if (!date || !next) return null;
    return { date, next, cycle: parseSpokenCycle(text), day };
  }

  if (opts.allowBareDay) {
    const bare = compact.match(/^(\d{1,2})일(?:요금|결제)?$/);
    if (bare) {
      const day = Number(bare[1]);
      const date = monthlyCanonicalAnchor(day);
      const next = nextMonthlyBillingDate(day);
      if (!date || !next) return null;
      return { date, next, cycle: "monthly", day };
    }
  }
  return null;
}

/** 변경 발화에서 결제일(1–31). 금액이 아니라 일이다. */
export function parseUpdateBillingDay(text: string): number | null {
  const invalid = invalidBillingDay(text);
  if (invalid != null) return null;
  const parsed = parseBillingDate(text, { allowBareDay: true });
  if (parsed?.day != null && parsed.day >= 1 && parsed.day <= 31) return parsed.day;
  return parseCreateDayNumber(text);
}

export type SpokenAmountIssue = "malformed" | "negative" | "zero" | "approximate";

/** 저장하면 안 되는 금액 표현. Gemini가 숫자를 채워도 버린다. */
export function spokenAmountIssue(text: string): SpokenAmountIssue | null {
  const compact = text.replace(/\s+/g, "").replace(/,/g, "");
  if (!compact) return null;
  if (/원원/.test(compact)) return "malformed";
  if (/-|−|－|음수|마이너스/.test(compact) && /\d/.test(compact)) return "negative";
  if (/쯤|대략/.test(compact)) return "approximate";
  if (/(?:^|[^\d])0원/.test(compact) || /무료|공짜/.test(compact)) return "zero";
  return null;
}

function parseKoreanAmount(text: string): number | null {
  if (spokenAmountIssue(text)) return null;
  const compact = text.replace(/\s+/g, "").replace(/,/g, "");
  if (!compact) return null;
  const stripped = stripSpokenDate(
    compact.replace(ACTION_TAIL_RE, "").replace(/(?:으로|로)$/, ""),
  );
  const man = stripped.match(/(\d+)만(?:(\d+)천)?(?:원)?$/);
  if (man) {
    const n = Number(man[1]) * 10_000 + (man[2] ? Number(man[2]) * 1_000 : 0);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const cheon = stripped.match(/(\d+)천(?:원)?$/);
  if (cheon) {
    const n = Number(cheon[1]) * 1_000;
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const withWon = stripped.match(/(\d+)원$/);
  if (withWon) {
    const n = Number(withWon[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const anyWon = stripped.match(/(\d{3,7})원/);
  if (anyWon) {
    const n = Number(anyWon[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const anyMan = stripped.match(/(\d+)만(?:(\d+)천)?(?:원)?/);
  if (anyMan) {
    const n = Number(anyMan[1]) * 10_000 + (anyMan[2] ? Number(anyMan[2]) * 1_000 : 0);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  if (/^\d{3,7}$/.test(stripped)) {
    const n = Number(stripped);
    if (n >= 100) return Math.round(n);
  }
  if (/[가-힣a-zA-Z]/.test(stripped)) {
    const trailing = stripped.match(/(\d{3,7})$/);
    if (trailing) {
      const n = Number(trailing[1]);
      if (n >= 100) return Math.round(n);
    }
  }
  return null;
}

/** 끝의 목적·보조사만 뗀다. 서비스명에 붙은 '호주 티비를' → '호주 티비'. */
export function cleanServiceName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  let t = name.trim();
  // AI가 더 잘 알아듣게 하려고 "구독명 : 우리하나"처럼 스스로 라벨을 붙여 말하는 사용자가
  // 있다 — 의도와 반대로 그 라벨 자체가 이름에 그대로 남는 사고로 이어지므로 먼저 뗀다.
  t = t.replace(/^(?:구독명|서비스명|상품명|이름)\s*[:：]\s*/, "").trim();
  // "웨이브 7900원, 매월 8일" 같은 문장에서 금액·날짜 구절만 잘라내면 그 사이 쉼표가
  // 이름에 그대로 남는다("웨이브,"). 서비스명에 쉼표가 올 일이 없으므로 통째로 제거한다.
  t = t.replace(/[,，]+/g, " ").trim();
  t = t.replace(/[은는을를]\s*$/u, "").trim();
  if (!t || t.length < 2) return null;
  return t.slice(0, 80);
}

/** 한글 받침이면 을, 없으면 를. 라틴·숫자는 를. */
export function objectParticle(name: string): "을" | "를" {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "를";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

/** 문장 안 서비스명. 카드·목록 제목에는 쓰지 않는다. */
export function quotedServiceName(name: string): string {
  const t = name.trim().replace(/^["“「]|["”」]$/g, "").trim();
  if (!t || t === "이 구독") return t || name.trim();
  return `"${t}"`;
}

export function withObjectParticle(text: string): string {
  const t = text.trimEnd();
  return `${quotedServiceName(t)}${objectParticle(t)}`;
}

export function createNameFromText(userText: string): string | null {
  const compact = userText.replace(/\s+/g, "");
  if (/^(구독)?(등록|추가)(해줘|할게|할래|하기)?$/.test(compact)) return null;
  let t = userText.trim().replace(/[.!?]+$/g, "").trim();
  t = t.replace(/\s*(을|를)?\s*(등록|추가)(해줘|할게|할래|하기)?\s*[.!?]*$/g, "").trim();
  t = t.replace(/\s*(을|를)?\s*(으로|로)?\s*(변경|바꿔|수정)(해줘|할게|할래|하기)?\s*$/g, "").trim();
  t = t.replace(/\s*(을|를)?\s*해지(방법|안내|하기)?\s*$/g, "").trim();
  t = t.replace(/\s*(을|를)?\s*(보여줘|알려줘|보여|알려)\s*$/g, "").trim();
  t = t.replace(/\s*(구독)?\s*(내역|조회|상세|현황)\s*$/g, "").trim();
  t = t.replace(/\s*구독\s*$/g, "").trim();
  t = t.replace(/다음\s*결제일(은|이)?/g, " ").trim();
  t = t.replace(/결제\s*일(을|를|은|는|이)?/g, " ").trim();
  t = t.replace(/결제\s*날짜(를|을|은|는)?/g, " ").trim();
  t = t.replace(/결제\s*주기(를|을|은|는)?/g, " ").trim();
  // "오늘 기준으로 7일 뒤 종료"처럼 체험 종료를 상대 날짜로 말한 부분은 이름에서 뺀다.
  t = t.replace(/오늘\s*기준(?:으로)?\s*\d{1,3}\s*일\s*(?:뒤|후)(?:에)?\s*(?:종료)?/g, " ").trim();
  t = t.replace(/\d{1,3}\s*일\s*(?:뒤|후)(?:에)?\s*(?:종료)?/g, " ").trim();
  // 체험 상태를 나타내는 조사까지 함께 뺀다. "멜론 무료체험으로 18일 구독 등록해줘"에서
  // `무료체험`만 지우면 `으로`가 서비스명에 남아 "멜론 으로"로 등록된다.
  t = t.replace(/(?:무료\s*체험|체험판|체험(?:\s*중|이에요)?)(?:으로|로|인)?/g, " ").trim();
  // "무료체험 ... 9월 18일 유료일 결제 시작"처럼 체험→유료 전환 시점을 묘사하는 말은 이름이
  // 아니다. 아래 결제 전용 스트리퍼는 "결제"만 지우고 뒤에 붙은 "시작"은 고아로 남기므로,
  // "결제 시작"을 하나의 구로 먼저 지워야 한다.
  t = t.replace(/유료\s*(?:전환|일)/g, " ").trim();
  t = t.replace(/결제\s*시작/g, " ").trim();
  t = t.replace(/(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ").trim();
  t = t.replace(/(?:매월|매달|매일|월간)\s*\d{1,3}\s*일/g, " ").trim();
  t = t.replace(/^월\s*\d{1,3}\s*일$/g, " ").trim();
  t = t.replace(/\d{1,3}\s*일(?:요금|결제)?/g, " ").trim();
  t = t.replace(/매주\s*(월|화|수|목|금|토|일)(요일)?/g, " ").trim();
  t = t.replace(/주간\s*(월|화|수|목|금|토|일)(요일)?/g, " ").trim();
  t = t.replace(/(?:이번주|다음주)\s*(월|화|수|목|금|토|일)요일(?:부터)?/g, " ").trim();
  t = t.replace(/(?:내일|모레|글피)(?:부터)?/g, " ").trim();
  t = t.replace(/일회성|일시불|단건|한번만|일회/g, " ").trim();
  t = t.replace(/매년|연간/g, " ").trim();
  // 「11일 매월 갱신」처럼 주기·갱신 표현이 날짜 뒤에 와도 이름에 섞이지 않게 한다.
  t = t.replace(/자동\s*갱신|자동\s*결제|정기\s*결제|갱신/g, " ").trim();
  t = t.replace(/(?:^|\s)(?:매월|매달|매일|월간|매주|주간)(?=\s|$)/g, " ").trim();
  t = t.replace(/다음\s*결제일(은|이)?/g, " ").trim();
  t = t.replace(/오늘\s*(결제(했어)?|냈(어)?|했어)/g, " ").trim();
  t = t.replace(/결제돼[요어]?\.?/g, " ").trim();
  t = t.replace(/결제예요\.?/g, " ").trim();
  t = t.replace(/결제야\.?/g, " ").trim();
  t = t.replace(/결재야\.?/g, " ").trim();
  t = t.replace(/결제됩니다\.?/g, " ").trim();
  t = t.replace(/결제되고/g, " ").trim();
  t = t.replace(/(?:으로|로)?\s*결제\s*(돼|되고|됩니다|해|야)?/g, " ").trim();
  t = t.replace(/이고|이며/g, " ").trim();
  t = t.replace(/(?:^|\s)(?:연|월|주)(?=\s*[\d,])/g, " ").trim();
  t = t.replace(/^\d{1,2}\s*월$/g, " ").trim();
  t = t.replace(/^\d{1,2}$/g, " ").trim();
  t = t.replace(/\d{4}-\d{1,2}-\d{1,2}/g, " ").trim();
  t = t.replace(/\d{1,2}[./]\d{1,2}(?:\s*일)?(?![만천원\d])/g, " ").trim();
  t = t.replace(/월?\s*[\d,]+만(?:[\d,]+천)?원+/g, "").trim();
  t = t.replace(/월?\s*[\d,]+천원+/g, "").trim();
  t = t.replace(/월?\s*[\d,]+원+/g, "").trim();
  t = t.replace(/\s*[\d,]{3,7}\s*/g, " ").trim();
  t = t.replace(/[.]/g, " ").trim();
  t = t.replace(/\s+에(\s|$)/g, " ").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t || parseKoreanAmount(t) != null || isFieldLabelName(t) || /^\d{1,2}월?$/.test(t.replace(/\s+/g, ""))) {
    return null;
  }
  return cleanServiceName(t);
}

export function isFieldLabelName(name: string | null | undefined): boolean {
  if (!name) return true;
  const compact = name.replace(/\s+/g, "");
  return /^(결제일|결제날짜|다음결제일|결제주기|금액|가격|주기|카테고리|목록|리스트|계정|아이디|이메일)$/.test(compact);
}

function looksLikePriceFilter(compact: string): boolean {
  return /이하|미만|이상|초과|까지|아래|넘는/.test(compact);
}

// 서비스명에 체험·전환 관련 단어가 섞여 들어가는 사고가 반복됐다("하나 유료일 시작" 등).
// 정규식으로 다 못 잡는 새 표현이 또 나올 수 있으니, 이런 키워드가 원문에 있었으면 등록
// 확인 카드에 "이름을 확인해 주세요" 경고를 띄워 사용자가 한 번 더 보게 한다.
export function looksLikeRiskyNameSource(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /무료체험|체험판|유료\s*(?:전환|일)|결제\s*시작|첫달\s*무료|첫\s*달\s*무료/.test(compact);
}

export function looksLikeDateAttempt(compact: string): boolean {
  return /(?:매월|매달|매일|월간)\d{1,3}일|^월\d{1,3}일$|(?:\d{4}년)?\d{1,2}월\d{1,3}일|^\d{1,3}일$|^\d{1,2}월$|^\d{1,2}$|(?:매주|주간)|매년|연간|^월간$|^연간$|일회성|일시불|단건|한번만|일회|다음결제일|결제(?:일|날짜)(?:을|를)?(?:은|는)?(?:매월|매달|월간)?\d{1,3}일|오늘결제|오늘냈|오늘했어|^오늘$|\d{1,3}일(?:뒤|후)(?:에)?|내일|모레|글피|(?:이번주|다음주)[일월화수목금토]요일/.test(
    compact,
  );
}

/** 달력에 없는 일. 32일, 매월 0일. */
export function invalidBillingDay(text: string): number | null {
  const compact = text.replace(/\s+/g, "");
  const matches = compact.matchAll(/(?:매월|매달|매일|월간)?(\d{1,3})일/g);
  for (const match of matches) {
    const day = Number(match[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) return day;
  }
  return null;
}

export function isConfirmUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^(네|예|응|그래|좋아|좋아요|맞아|확인|확인할게|확인해요|진행해줘|등록해줘|등록할게|그렇게해줘|변경해줘|변경할게|바꿔줘|적용해줘)$/i.test(
    compact,
  );
}

export type ConfirmationDecision = "confirm" | "reject" | "correct" | "unrelated" | "unclear";

/** 확인 대기 중 금액·결제일·서비스명 정정. 거절보다 먼저 본다. */
export function isCorrectionUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  if (/취소할게|취소할래|취소해줘|등록하지마|그만할게|그냥둘게/.test(compact)) return false;
  const hasAmount = parseKoreanAmount(text) != null;
  const hasDate = parseCreateDayNumber(text) != null || parseKoreanDate(text) != null ||
    parseSpokenCycle(text) != null || looksLikeDateAttempt(compact) ||
    /결제일/.test(compact) && /\d{1,2}\s*일/.test(text);
  const hasRename = /아니라|말고/.test(compact);
  if (!hasAmount && !hasDate && !hasRename) return false;
  return /^아니/.test(compact) || hasRename || /금액|결제일|주기|이름은/.test(compact);
}

/** 확인 카드에서 거절. 정정 문장과 짧은 승인보다 나중에 본다. */
export function isRejectUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  if (isCorrectionUtterance(text)) return false;
  if (isConfirmUtterance(text)) return false;
  if (/등록하지마|등록마|하지말|그만할게|그만할래|그냥둘게|그냥둬/.test(compact)) return true;
  if (/그대로둬|그대로둘게|그대로해|취소할게|취소할래|취소해줘|안할래|안할게/.test(compact)) {
    return true;
  }
  if (/^아니[,.]?(요|오)?(취소|그대로)/.test(compact)) return true;
  return /^(아니|아니요|아뇨|괜찮아|취소|됐어)$/.test(compact);
}

function looksUnrelatedToConfirm(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (/등록|추가|넣어줘|확인|취소/.test(compact)) return false;
  return /얼마|목록|리스트|보여줘|알려줘|총액|이번달|다음달/.test(compact);
}

/** 확인 대기 중 사용자 답을 enum으로만 판정한다. Claude 일반 의도보다 먼저 쓴다. */
export function classifyConfirmationDecision(text: string): ConfirmationDecision {
  if (isCorrectionUtterance(text)) return "correct";
  if (isRejectUtterance(text)) return "reject";
  if (isConfirmUtterance(text)) return "confirm";
  if (looksUnrelatedToConfirm(text)) return "unrelated";
  const compact = text.replace(/\s+/g, "");
  if (parseKoreanAmount(text) != null || parseCreateDayNumber(text) != null || parseSpokenCycle(text) != null) {
    return "correct";
  }
  if (looksLikeDateAttempt(compact) || invalidBillingDay(text) != null) return "correct";
  return "unclear";
}

export function emptyClassifiedIntent(): ClassifiedIntent {
  return { ...UNKNOWN };
}

export function isDuplicateSeparateUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /별도|다른계정|다른결제|다른카드|하나더|추가로등록|새로등록|다른구독/.test(compact);
}

export function isDuplicateAffirmativeUtterance(text: string, awaitingDuplicate: boolean): boolean {
  // ChatGPT 수정: 동일한 "네"라도 중복 선택 대기 중일 때만 별도 추가로 해석한다.
  return awaitingDuplicate && isConfirmUtterance(text);
}

/** 동명 칩에서 목록 삭제. 없애줘(해지 안내)와 구분한다. */
export function isDuplicateDeleteUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact || /없애/.test(compact)) return false;
  return /목록에서(삭제|지워|빼)/.test(compact) ||
    /^(삭제|지워|삭제할게|삭제해줘|지워줘)$/.test(compact);
}

export function isDuplicateSameUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^(아니|아니요|기존|기존거야|같은거|같은구독|이미있어|취소)$/.test(compact) ||
    /같은구독|이미등록|기존거/.test(compact);
}

// 동명 구독을 구분하려고 계정을 물었는데, 회피성 답을 그대로 계정값으로 저장하면
// 구분이 안 되는 건 매한가지인데 데이터만 지저분해진다. 등록을 진행시키지 않고 다시 묻는다.
export function isNonAnswerAccountUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "").replace(/[.!?]+$/g, "");
  return /^(없어|없어요|없음|없다|몰라|몰라요|모름|생략|생략할게|건너뛰기|건너뛸게|건너뛰어|패스|스킵|그냥등록|그냥등록해|그냥해줘|나중에|안적을래|안쓸래)$/
    .test(compact);
}

/** 가입 계정. 비밀번호는 받지 않는다. */
export function parseAccountFromText(userText: string, awaiting = false): string | null {
  const trimmed = userText.trim().replace(/[.!?]+$/g, "").trim();
  if (!trimmed) return null;
  if (
    isNonAnswerAccountUtterance(trimmed) ||
    isDuplicateSeparateUtterance(trimmed) ||
    isDuplicateDeleteUtterance(trimmed) ||
    isConfirmUtterance(trimmed) ||
    isRejectUtterance(trimmed) ||
    isDuplicateSameUtterance(trimmed)
  ) {
    return null;
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (spokenAmountIssue(trimmed) || looksLikeDateAttempt(compact) || invalidBillingDay(trimmed) != null) {
    return null;
  }

  const labeled = trimmed.match(/(?:계정|아이디|이메일)(?:을|를)?(?:은|는|:)?\s*(.+)$/i);
  let candidate = labeled?.[1]?.trim() ?? null;
  if (!candidate) {
    const email = trimmed.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (email) candidate = email[0];
  }
  if (!candidate && awaiting) {
    candidate = trimmed.replace(/^(?:계정|아이디|이메일)(?:을|를)?(?:은|는|:)?\s*/i, "").trim();
  }
  if (!candidate) return null;
  candidate = candidate.replace(/\s*(을|를)?\s*(등록|추가)(해줘|할게|할래|하기)?\s*$/g, "").trim();
  if (!candidate || candidate.length < 2 || candidate.length > 80) return null;
  if (parseKoreanAmount(candidate) != null) return null;
  if (isFieldLabelName(candidate)) return null;
  if (/^(등록|추가|변경|삭제|목록|리스트)$/.test(candidate.replace(/\s+/g, ""))) return null;
  return candidate;
}

function asCreateSubscription(
  parsed: ClassifiedIntent,
  name: string | null,
  amount: number | null,
  anchorDate: string | null = null,
  cycle: BillingCycle | null = null,
  isTrial: boolean | null = null,
): ClassifiedIntent {
  return enforceSlots({
    ...parsed,
    intent: "create_subscription",
    service_name: cleanServiceName(name),
    amount,
    billing_cycle: cycle,
    anchor_date: anchorDate,
    referent: { kind: "none", ordinal: null, name: null },
    is_trial: isTrial,
    // 체험은 anchor_date(첫 유료 결제일)와 trial_ends_at이 항상 같은 값을 가리킨다.
    trial_ends_at: isTrial ? anchorDate : null,
    // 정규식 키워드(등록/추가 등)나 진행 중인 등록 흐름 이어가기로 확정된 재분류이므로 확신도를 1로 둔다.
    confidence: 1,
  });
}

export type UpdateAwaitingField = "amount" | "billing_day" | "billing_month" | "weekday";

export type ClassifyContext = {
  last_intent?: string | null;
  last_name?: string | null;
  last_amount?: number | null;
  last_cycle?: BillingCycle | null;
  last_pending_day?: number | null;
  last_pending_month?: number | null;
  last_awaiting_duplicate?: boolean | null;
  last_awaiting_account?: boolean | null;
  last_awaiting_update?: UpdateAwaitingField | null;
  last_listed?: string[] | null;
  recent_turns?: { role: string; content: string }[] | null;
};

/** Gemini가 좁은 enum/기간만 줄 때를 키워드로 보정한다. */
export function refineIntent(
  userText: string,
  parsed: ClassifiedIntent,
  subscriptionNames: string[] = [],
  ctx: ClassifyContext = {},
): ClassifiedIntent {
  const compact = userText.replace(/\s+/g, "");
  const wantsSavings = /절약|아껴|해지하면얼마|해지하면얼마나/.test(compact);
  const confirmedCancellation = /해지신청|신청했어|해지했어|해지했어요|해지완료/.test(compact);
  const wantsCancelHow = /해지방법|어떻게해지|해지하는법|해지하려면|해지안내|해지절차|해지|구독끊|갱신안|갱신하지|취소하는법|취소방법|없애/.test(compact) &&
    !wantsSavings &&
    !confirmedCancellation;
  const wantsLifecycle = /안내확인|해지신청|신청했어|해지했어|해지했어요|해지완료|종료됐|종료확인|아직결제|재결제/.test(compact) &&
    !wantsCancelHow;
  const wantsDelete = /삭제|지워|목록에서빼|구독삭제/.test(compact) && !wantsCancelHow && !wantsLifecycle;
  const wantsRank = /비싼|고액|제일비싸|가장비싸|상위/.test(compact);
  const amongList = mentionsPriorList(userText);
  const pronounLike = amongList || /그거요|그구독|그거(?!중)/.test(compact);
  const wantsNextWeek = /다음주/.test(compact);
  const wantsThisWeek = /이번주/.test(compact);
  const wantsSeven = /7일|일주일/.test(compact);
  const wantsThirty = /30일|한달안|한달이내/.test(compact);
  const wantsUpcoming = /지출예정|결제예정|다가오는결제|곧결제/.test(compact) ||
    wantsNextWeek || wantsThisWeek || wantsSeven || wantsThirty;
  const wantsDetails = /내역|조회|상세|현황/.test(compact);
  const wantsShow = /보여줘|알려줘/.test(compact);
  const wantsList = /리스트|목록|뭐있|어떤구독/.test(compact) || wantsDetails;
  const wantsThisMonth = /이번달/.test(compact);
  const wantsNextMonth = /다음달/.test(compact);
  const monthMatch = compact.match(/(?:(\d{4})년)?(\d{1,2})월/);
  const calendarMonth = monthMatch ? Number(monthMatch[2]) : null;
  const namedMonth = calendarMonth != null && calendarMonth >= 1 && calendarMonth <= 12
    ? calendarMonth
    : null;
  const calendarYear = monthMatch?.[1] ? Number(monthMatch[1]) : seoulYmd().year;
  const wantsSnapshotCompare = /전월|지난달|늘었|줄었|3개월|6개월/.test(compact) ||
    (/대비/.test(compact) && namedMonth == null);
  const wantsInScopeCompare = /비교/.test(compact) && !wantsSnapshotCompare;
  const wantsTrial = /무료체험|체험중|첫달무료|첫달만무료|체험판|trial/i.test(compact);
  const wantsCreate = /등록|추가|넣어줘/.test(compact) && !wantsDelete && !wantsCancelHow &&
    !wantsRank && !wantsSnapshotCompare && !wantsList;
  const wantsUpdate = /바꿔|수정|변경/.test(compact) && !wantsDelete && !wantsCreate && !wantsCancelHow;
  const wantsHike = /가격인상|인상|올랐|비싸졌/.test(compact);
  const wantsCleanup = /정리후보|안쓰는구독|중복구독|정리추천/.test(compact);
  const wantsCategory = /카테고리/.test(compact) && !wantsCreate && !wantsDelete && !wantsCancelHow;
  const priceFilter = looksLikePriceFilter(compact);
  const looksLikeQuery = wantsList || wantsRank || wantsSnapshotCompare || wantsUpcoming ||
    wantsCategory || priceFilter || /얼마야|총액|보여줘/.test(compact);
  const limitMatch = compact.match(/(\d+)개/);
  const wantsTopOne = /제일|가장/.test(compact) && !limitMatch;
  const rankLimit = limitMatch
    ? Math.min(10, Math.max(1, Number(limitMatch[1])))
    : wantsTopOne
    ? 1
    : (parsed.limit ?? 3);
  const amountIssue = spokenAmountIssue(userText);
  const dateOnlyNumber = parseCreateDayNumber(userText) != null ||
    parseCreateMonthNumber(userText, { allowBare: ctx.last_pending_day != null }) != null;
  const dateAttempt = looksLikeDateAttempt(compact) || invalidBillingDay(userText) != null || dateOnlyNumber;
  const spokenAmount = amountIssue ? null : parseKoreanAmount(userText);
  const awaitingUpdate = ctx.last_awaiting_update ?? null;
  const won = spokenAmount ?? (dateAttempt || wantsUpdate || awaitingUpdate ? null : parsed.amount);
  const followupAmount = spokenAmount;
  const allowUpdateBareDay = wantsUpdate ||
    ctx.last_intent === "update_subscription" ||
    awaitingUpdate === "billing_day" ||
    awaitingUpdate === "billing_month";
  const billingDate = parseBillingDate(userText, {
    allowBareDay: allowUpdateBareDay || (
      ctx.last_intent === "create_subscription" &&
      (ctx.last_cycle === "monthly" || ctx.last_cycle == null) &&
      ctx.last_pending_month == null
    ),
  });
  const spokenDate = billingDate?.date ?? parseKoreanDate(userText) ?? parseRelativeKoreanDate(userText) ??
    parseRelativeDayWord(userText);
  const spokenCycle = billingDate?.cycle ?? parseSpokenCycle(userText) ??
    (ctx.last_intent === "create_subscription" ? ctx.last_cycle ?? null : null);
  // "이번 달 얼마 나가?"처럼 지출을 묻는 문장을 Gemini가 헷갈려서 서비스명으로
  // 잘못 추출하면(예: service_name:"이번 달 얼마 나가"), 그 값을 그대로 믿어서
  // 실제 구독명 매칭이 없을 때 폴백으로 쓰면 안 된다 — 아래 monthly_total 등
  // 여러 분기가 "!matchedName"을 전제하는데 이게 깨지면 지출 질문이 통째로
  // 등록 흐름으로 샌다. 지출 질문 패턴이 보이면 Gemini의 service_name 추측을 버린다.
  const looksLikeSpendQuery = /이번달|다음달|구독료|총액|얼마/.test(compact);
  const matchedName = matchServiceName(userText, subscriptionNames) ??
    (looksLikeSpendQuery || isFieldLabelName(parsed.service_name) ? null : parsed.service_name);
  const typedName = createNameFromText(userText);
  const amongReferent = pronounLike
    ? { kind: "pronoun" as const, ordinal: null, name: null }
    : parsed.referent;
  const namedReferent = matchedName
    ? { kind: "name" as const, ordinal: null, name: matchedName }
    : amongReferent;
  const calendarPeriod = namedMonth != null
    ? { type: "calendar_month" as const, days: null, year: calendarYear, month: namedMonth }
    : null;
  const lookupName = matchedName ??
    (typedName && !isFieldLabelName(typedName) ? typedName : null);
  const genericShow = /이번달|다음달|구독료|총액|얼마/.test(compact) && !matchedName;
  // 구독을 지목하지 않은 카테고리 질문은 아래 category_analysis가 맡는다.
  // 「카테고리 현황」처럼 현황·내역이 붙으면 여기서 목록으로 새는 것을 막는다.
  const categoryOverview = wantsCategory && !matchedName;
  if (
    (wantsDetails || wantsShow) &&
    !genericShow &&
    !categoryOverview &&
    !wantsCreate && !wantsDelete && !wantsUpdate && !wantsCancelHow && !wantsLifecycle &&
    followupAmount == null &&
    (lookupName || wantsDetails)
  ) {
    return enforceSlots({
      ...parsed,
      intent: "list_subscriptions",
      service_name: lookupName,
      referent: lookupName
        ? { kind: "name" as const, ordinal: null, name: lookupName }
        : parsed.referent,
      period: parsed.period.type === "unknown"
        ? { type: "this_month", days: null, year: null, month: null }
        : parsed.period,
    });
  }

  if (ctx.last_intent === "create_subscription" && !wantsDelete && !wantsUpdate && !wantsCancelHow && !priceFilter && !wantsList && !looksLikeQuery) {
    const awaitingAccount = ctx.last_awaiting_account === true;
    if (
      ctx.last_name && !wantsList && !wantsRank &&
      (followupAmount != null || spokenDate || spokenCycle || looksLikeDateAttempt(compact) || invalidBillingDay(userText) != null ||
        amountIssue != null || ctx.last_awaiting_duplicate || awaitingAccount ||
        isDuplicateSeparateUtterance(userText) || isDuplicateSameUtterance(userText) ||
        parseAccountFromText(userText, awaitingAccount) != null ||
        parseCreateDayNumber(userText) != null || parseCreateMonthNumber(userText, { allowBare: ctx.last_pending_day != null }) != null)
    ) {
      return asCreateSubscription(
        parsed,
        ctx.last_name,
        followupAmount ?? ctx.last_amount ?? (dateOnlyNumber ? null : parsed.amount),
        spokenDate,
        spokenCycle,
      );
    }
    if (followupAmount != null) {
      const name = ctx.last_name ?? typedName;
      if (name) return asCreateSubscription(parsed, name, followupAmount, spokenDate, spokenCycle);
    }
    if (!ctx.last_name && typedName && !wantsCreate) {
      return asCreateSubscription(parsed, typedName, followupAmount, spokenDate, spokenCycle);
    }
  }

  if (
    ctx.last_intent === "update_subscription" &&
    awaitingUpdate &&
    (followupAmount != null || spokenDate || spokenCycle || invalidBillingDay(userText) != null ||
      parseCreateMonthNumber(userText, { allowBare: awaitingUpdate === "billing_month" }) != null) &&
    !wantsDelete && !wantsCreate && !looksLikeQuery && !wantsCancelHow && !wantsLifecycle
  ) {
    const name = matchedName ?? (isFieldLabelName(parsed.service_name) ? ctx.last_name : parsed.service_name) ??
      ctx.last_name ?? null;
    return enforceSlots({
      ...parsed,
      intent: "update_subscription",
      service_name: name,
      amount: followupAmount,
      billing_cycle: spokenCycle,
      anchor_date: spokenDate,
      referent: matchedName
        ? namedReferent
        : name
        ? { kind: "name" as const, ordinal: null, name }
        : pronounLike
        ? amongReferent
        : { kind: "none", ordinal: null, name: null },
      confidence: 1,
    });
  }

  if (
    ctx.last_intent === "delete_subscription" && (matchedName || pronounLike) && !wantsCreate &&
    !wantsUpdate && !looksLikeQuery && !wantsCancelHow && !wantsLifecycle
  ) {
    return enforceSlots({
      ...parsed,
      intent: "delete_subscription",
      service_name: matchedName,
      referent: namedReferent,
      confidence: 1,
    });
  }

  if (wantsCancelHow) {
    return enforceSlots({
      ...parsed,
      intent: "cancellation_guide",
      service_name: matchedName,
      referent: namedReferent,
      confidence: 1,
    });
  }

  if (wantsLifecycle) {
    let lifecycle: LifecycleStatus = "guide_reviewed";
    if (/아직결제|재결제/.test(compact)) lifecycle = "active";
    else if (/종료확인|종료됐/.test(compact)) lifecycle = "ended";
    else if (confirmedCancellation) lifecycle = "cancel_requested";
    else if (/안내확인/.test(compact)) lifecycle = "guide_reviewed";
    return enforceSlots({
      ...parsed,
      intent: "lifecycle_update",
      lifecycle_status: lifecycle,
      service_name: matchedName,
      referent: namedReferent,
      confidence: 1,
    });
  }

  if (wantsSavings) {
    return enforceSlots({
      ...parsed,
      intent: "cancel_savings",
      service_name: matchedName,
      referent: namedReferent,
      confidence: 1,
    });
  }

  if (wantsHike && !wantsSnapshotCompare && !wantsInScopeCompare) {
    return enforceSlots({ ...parsed, intent: "price_increases" });
  }

  if (wantsCleanup) {
    return enforceSlots({ ...parsed, intent: "cleanup_candidates" });
  }

  if (wantsCategory) {
    return enforceSlots({ ...parsed, intent: "category_analysis" });
  }

  if (
    (wantsThisMonth || wantsNextMonth || /구독료|총액/.test(compact)) &&
    /얼마|총액|나가|비용/.test(compact) &&
    !wantsCreate && !wantsDelete && !wantsUpdate && !wantsCancelHow && !matchedName
  ) {
    return enforceSlots({
      ...parsed,
      intent: "monthly_total",
      period: wantsNextMonth
        ? { type: "calendar_month", days: null, year: shiftMonth(seoulYmd().year, seoulYmd().month, 1).year, month: shiftMonth(seoulYmd().year, seoulYmd().month, 1).month }
        : { type: "this_month", days: null, year: null, month: null },
    });
  }

  if (wantsCreate) {
    return asCreateSubscription(
      parsed,
      typedName ?? matchedName ?? parsed.service_name,
      won,
      spokenDate,
      spokenCycle,
      wantsTrial,
    );
  }

  if (
    typedName &&
    followupAmount != null &&
    !priceFilter &&
    !wantsList &&
    !wantsRank &&
    !wantsSnapshotCompare &&
    !wantsUpcoming &&
    !wantsDelete &&
    !wantsUpdate &&
    !wantsCancelHow &&
    !wantsLifecycle
  ) {
    return asCreateSubscription(parsed, typedName, followupAmount, spokenDate, spokenCycle, wantsTrial);
  }

  if (wantsSnapshotCompare) {
    const months = /6개월/.test(compact) ? 6 : /3개월/.test(compact) ? 3 : 1;
    return enforceSlots({
      ...parsed,
      intent: "period_comparison",
      period: { type: "last_month", days: months, year: null, month: null },
    });
  }

  if (wantsDelete) {
    const inherited = !matchedName &&
        (ctx.last_intent === "cancellation_guide" || ctx.last_intent === "delete_subscription")
      ? ctx.last_name ?? null
      : null;
    const name = matchedName ?? inherited;
    return enforceSlots({
      ...parsed,
      intent: "delete_subscription",
      service_name: name,
      referent: name ? { kind: "name" as const, ordinal: null, name } : namedReferent,
      confidence: 1,
    });
  }

  if (wantsUpdate) {
    const rawName = matchedName ?? typedName ?? parsed.service_name;
    const updateName = !isFieldLabelName(rawName)
      ? rawName
      : ctx.last_intent === "update_subscription"
      ? ctx.last_name ?? null
      : null;
    return enforceSlots({
      ...parsed,
      intent: "update_subscription",
      service_name: updateName,
      amount: followupAmount,
      billing_cycle: spokenCycle,
      anchor_date: spokenDate,
      referent: updateName
        ? { kind: "name" as const, ordinal: null, name: updateName }
        : namedReferent.kind !== "none"
        ? namedReferent
        : { kind: "none", ordinal: null, name: null },
      confidence: 1,
    });
  }

  if (calendarPeriod && (wantsRank || wantsInScopeCompare)) {
    return enforceSlots({
      ...parsed,
      intent: "expensive_subscriptions",
      limit: wantsInScopeCompare && !wantsRank ? 10 : rankLimit,
      period: calendarPeriod,
    });
  }

  if (wantsRank || wantsInScopeCompare) {
    return enforceSlots({
      ...parsed,
      intent: "expensive_subscriptions",
      limit: wantsInScopeCompare && !wantsRank ? 10 : rankLimit,
    });
  }

  if (namedMonth != null && (wantsList || wantsUpcoming) && !wantsRank && !wantsSnapshotCompare) {
    return enforceSlots({
      ...parsed,
      intent: "list_subscriptions",
      period: { type: "calendar_month", days: null, year: calendarYear, month: namedMonth },
    });
  }

  if (wantsList && wantsThisMonth && !wantsRank && !wantsSnapshotCompare) {
    return enforceSlots({
      ...parsed,
      intent: "list_subscriptions",
      period: { type: "this_month", days: null, year: null, month: null },
    });
  }

  if (wantsList && wantsNextMonth && !wantsRank && !wantsSnapshotCompare) {
    const next = shiftMonth(seoulYmd().year, seoulYmd().month, 1);
    return enforceSlots({
      ...parsed,
      intent: "list_subscriptions",
      period: { type: "calendar_month", days: null, year: next.year, month: next.month },
    });
  }

  if (wantsThirty) {
    return enforceSlots({
      ...parsed,
      intent: "upcoming_payments",
      period: { type: "next_n_days", days: 30, year: null, month: null },
    });
  }

  if (wantsSeven) {
    return enforceSlots({
      ...parsed,
      intent: "upcoming_payments",
      period: { type: "next_n_days", days: 7, year: null, month: null },
    });
  }

  if (wantsNextWeek) {
    return enforceSlots({
      ...parsed,
      intent: "upcoming_payments",
      period: { type: "next_week", days: null, year: null, month: null },
    });
  }

  if (wantsThisWeek) {
    return enforceSlots({
      ...parsed,
      intent: "upcoming_payments",
      period: { type: "this_week", days: null, year: null, month: null },
    });
  }

  if (wantsUpcoming && !wantsSnapshotCompare && namedMonth == null) {
    return enforceSlots({
      ...parsed,
      intent: "upcoming_payments",
      period: { type: "next_n_days", days: parsed.period.days ?? 7, year: null, month: null },
    });
  }

  if (wantsList && !wantsRank && !wantsSnapshotCompare) {
    const listedName = lookupName && !isFieldLabelName(lookupName) ? lookupName : null;
    return enforceSlots({
      ...parsed,
      intent: "list_subscriptions",
      service_name: listedName,
      referent: listedName ? { kind: "name" as const, ordinal: null, name: listedName } : { kind: "none", ordinal: null, name: null },
      period: parsed.period.type === "unknown"
        ? { type: "this_month", days: null, year: null, month: null }
        : parsed.period,
    });
  }

  if (parsed.intent === "period_comparison" && !wantsSnapshotCompare) {
    return { ...UNKNOWN };
  }
  if (limitMatch && parsed.intent === "expensive_subscriptions") {
    return { ...parsed, limit: rankLimit };
  }
  if (
    (parsed.intent === "list_subscriptions" || parsed.intent === "unknown") &&
    followupAmount != null &&
    !priceFilter &&
    !wantsList &&
    !wantsRank
  ) {
    if (ctx.last_intent === "create_subscription" && (ctx.last_name || typedName)) {
      return asCreateSubscription(parsed, ctx.last_name ?? typedName, followupAmount, spokenDate, spokenCycle);
    }
    if (typedName) return asCreateSubscription(parsed, typedName, followupAmount, spokenDate, spokenCycle);
  }
  return parsed;
}

function enforceSlots(parsed: ClassifiedIntent): ClassifiedIntent {
  const { intent, referent, service_name } = parsed;
  const hasTarget = Boolean(service_name) || referent.kind !== "none";

  if (intent === "usage_checkin" && (!parsed.usage_response || !hasTarget)) {
    return { ...UNKNOWN };
  }
  if (intent === "cancel_savings" && !hasTarget) {
    return { ...UNKNOWN };
  }
  if (intent === "lifecycle_update" && (!hasTarget || !parsed.lifecycle_status)) {
    return { ...UNKNOWN };
  }
  if (intent === "period_comparison") {
    const months = parsed.period.days === 6 || parsed.period.days === 3 ? parsed.period.days : 1;
    return { ...parsed, period: { type: "last_month", days: months, year: null, month: null } };
  }
  if (intent === "expensive_subscriptions") {
    return { ...parsed, limit: parsed.limit ?? 3 };
  }
  if (intent === "upcoming_payments" && parsed.period.type === "unknown") {
    return {
      ...parsed,
      period: { type: "next_n_days", days: parsed.period.days ?? 7, year: null, month: null },
    };
  }
  if (intent === "list_subscriptions" && parsed.period.type === "unknown") {
    return {
      ...parsed,
      period: { type: "this_month", days: null, year: null, month: null },
    };
  }
  return parsed;
}

export async function classifyCategoryKey(serviceName: string): Promise<CategoryKey | null> {
  const name = scrubPii(serviceName);
  if (name.length < 2) return null;
  const prompt = `당신은 구독 분류기입니다. 검색하지 마세요.
서비스 표시명만 보고 다음 JSON만 출력하세요.
{"category_key":"entertainment|music|work|health|education|cloud|etc"}
규칙:
- entertainment: OTT·영상 (넷플릭스, 티빙, 디즈니+, 유튜브)
- music: 음악
- work: 생산성·AI 도구
- health: 운동·건강
- education: 학습
- cloud: 클라우드·오피스
- etc: 그 외
입력: ${JSON.stringify({ name })}`;

  // Gemini (데모데이: Claude로 대체)
  // const apiKey = Deno.env.get("GEMINI_API_KEY");
  // if (!apiKey) return null;
  // const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3-flash-preview";
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

  try {
    const text = await claudeText({
      system: "JSON만 출력하세요. 마크다운 펜스 없이.",
      user: prompt,
      maxTokens: 80,
    });
    if (!text) return null;
    const parsed = parseClaudeJson(text) as Record<string, unknown>;
    return asCategoryKey(parsed.category_key);
  } catch {
    return null;
  }
}

export async function classifyIntent(
  userText: string,
  subscriptionNames: string[],
  ctx: ClassifyContext = {},
): Promise<ClassifiedIntent> {
  // Gemini (데모데이: Claude로 대체)
  // const apiKey = Deno.env.get("GEMINI_API_KEY");
  // if (!apiKey) return refineIntent(userText, { ...UNKNOWN }, subscriptionNames, ctx);
  // const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3-flash-preview";

  const today = seoulYmd();
  const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  const payload = {
    question: scrubPii(userText),
    known_subscriptions: subscriptionNames.slice(0, 40),
    current_date: isoDate(today.year, today.month, today.day),
    current_weekday: WEEKDAY_LABELS[today.weekday],
    last_intent: ctx.last_intent ?? null,
    last_name: ctx.last_name ?? null,
    last_amount: ctx.last_amount ?? null,
    last_cycle: ctx.last_cycle ?? null,
    last_listed: (ctx.last_listed ?? []).slice(0, 15),
    recent_turns: (ctx.recent_turns ?? []).slice(-6),
  };

  const prompt = `당신은 구독 관리 앱 subly의 의도 분류기입니다. google 검색을 쓰지 마세요.
입력 JSON만 보고 아래 JSON만 출력하세요.
{"intent":"${ASSISTANT_INTENTS.join("|")}","service_name":"문자열또는null","limit":숫자또는null,"period":{"type":"this_month|last_month|next_n_days|calendar_month|this_week|next_week|unknown","days":숫자또는null,"year":숫자또는null,"month":1-12또는null},"referent":{"kind":"none|ordinal|pronoun|name","ordinal":숫자또는null,"name":"문자열또는null"},"usage_response":"used_recently|occasionally|not_used|unsure|null","amount":숫자또는null,"billing_cycle":"monthly|yearly|one_time|null","anchor_date":"YYYY-MM-DD또는null","category_key":"entertainment|music|work|health|education|cloud|etc|null","lifecycle_status":"active|guide_reviewed|cancel_requested|ending_scheduled|ended|end_confirm_needed|null","confidence":0.0-1.0}

규칙:
- 추측하지 마세요. 애매하면 intent는 unknown.
- confidence는 이 intent 판정에 대한 확신도(0.0~1.0)입니다. 문장이 명확하면 0.8 이상, 두 개 이상의 intent로 해석될 수 있거나 확신이 낮으면 0.5 미만으로 주세요. intent가 unknown이면 confidence는 무시되니 신경 쓰지 마세요.
- 이번 달 얼마/구독료/월평균/월 환산 → monthly_total (월평균 구독 지출액. 일회성 제외, 연간은 ÷12). "이번 달 결제 총액/실제로 나간"도 monthly_total이되 계좌 연동이 없으므로 등록된 결제 일정 기준 예상 지출액으로 설명. "이번 달"만으로 period_comparison이 되지 않습니다.
- 구독 목록/리스트(10월 목록, 이번 달 포함) → list_subscriptions. 10월이면 period.type=calendar_month, month=10. "10월 1일 등록"처럼 결제 시작일은 목록이 아님
- 구독 내역/조회/보여줘/알려줘(등록·추가 없이) → list_subscriptions. "홍티비 구독 내역 보여줘"는 등록이 아님. service_name=홍티비. last_intent가 create_subscription이어도 조회
- 비싼/고액 순위 → expensive_subscriptions. "그중에서/N월 목록 중 제일 비싸"는 expensive + 그 달. 제일/가장이면 limit=1
- 결제 예정/다음주/이번주/7일/30일 → upcoming_payments. 며칠이면 period.days
- 카테고리별 분석/카테고리 보여줘/어떻게 분류 → category_analysis. 직전 목록·달이면 그 범위
- 전월 대비/지난달보다/늘었어/3개월/6개월 → period_comparison. period.days는 1|3|6
- N월에서 비교(지난달/늘었 없이) → expensive_subscriptions + calendar_month
- 가격 인상 → price_increases
- 정리 후보/안 쓰는 구독/중복 → cleanup_candidates
- 해지하면 얼마 아껴 → cancel_savings (service_name 필요)
- 사용자가 사용 여부를 직접 말함 → usage_checkin + usage_response
- 실제 서비스 해지 방법 또는 "갱신 안 함" → cancellation_guide. "유튜브 해지"처럼 해지만 있어도 됨. 앱 목록 삭제와 다름
- 해지 안내 확인/실제로 해지함/종료 확인/아직 결제됨 → lifecycle_update + lifecycle_status. 실제 해지를 마쳤다는 표현은 cancel_requested이며 이용 종료일에 자동 종료됨
- 구독 추가 등록 → create_subscription. "박티비 추가", "등록" 모두 됨. 이름만 있어도 됨. 금액 없으면 amount는 null. 사용자가 말하지 않은 billing_cycle·anchor_date는 null. 결제일을 아예 말하지 않았으면 오늘 날짜를 추측해 넣지 않음. 월간으로 추측하지 않음. "홍티비 20000원 10월 1일 등록"은 amount=20000, anchor_date=그해-10-01. 금액을 다시 묻지 않음
- "내일"/"모레"/"글피"/"이번주 O요일"/"다음주 O요일"처럼 상대 날짜로 결제일을 명시하면, 입력의 current_date(오늘 날짜)·current_weekday 기준으로 계산한 실제 YYYY-MM-DD를 anchor_date에 채운다. 이건 사용자가 결제일을 명시한 경우이므로 위 "오늘 날짜를 추측해 넣지 않음" 규칙과 다르다 — 상대 날짜 표현 자체가 명시된 결제일이다
- last_intent가 create_subscription이고 입력이 금액만(3만원, 3만, 30000, 30000원)이면 create_subscription. 목록 조회가 아님. amount는 원 정수(3만원=30000)
- last_intent가 create_subscription이고 직전에 결제 주기·결제일을 물었으며 이번 입력이 날짜·주기 표현(매월 15일, 매달 15일, 매일 15일, 월간 10일, 15일, 15, 9월, 9, 일회성, 한 번만, 매년 9월 15일, 연간 9월 15일, 매월 32일)이면 create_subscription을 유지하고 last_name·last_amount를 이어간다. 32일처럼 달력에 없는 일은 anchor_date를 넣지 않음. "15일"은 매월 15일. 숫자만(15) 있으면 월을 아직 모른다고 보고 amount는 last_amount 유지, anchor_date는 null. 목록 조회가 아님. 추측한 오늘 날짜를 넣지 않음. unknown으로 두지 않음
- 일회성/한 번만/일시불/단건 → billing_cycle=one_time. 결제일은 그 한 번 내는 날. 매주/주간은 주기가 아님
- 금액 오타(2만원원), 음수(-20000원), 0원, 대략(이만원쯤)은 amount를 null. create_subscription을 유지하고 정확한 금액을 다시 물음
- last_intent가 create_subscription이고 중복 여부를 물었으면 "별도 계정/다른 결제"도 create_subscription. 목록 조회가 아님
- last_intent가 create_subscription이고 가입 계정을 물었으면 이메일·아이디만 있어도 create_subscription. 비밀번호는 받지 않음
- "어도비 연 264000원이고 매년 9월 18일에 결제돼. 등록해줘"는 service_name=어도비, amount=264000, billing_cycle=yearly, anchor_date=그해-09-18. 월 금액으로 나누지 않음
- "서비스명 + 금액"은 등록 키워드가 없어도 create_subscription. "홍티비 30000"도 등록. 결제일이 없으면 anchor_date는 null. "이하/미만/목록/내역/보여줘/알려줘"가 있으면 조회
- 금액/주기/날짜 수정·바꿔·변경 → update_subscription. "홍티비 2만원으로 변경"은 amount=20000. 대상만 있어도 됨
- "결제일 10월 2일로 변경"처럼 필드명만 있으면 service_name은 결제일 문자열이 아님. last_intent가 update_subscription이면 last_name을 이어가고 anchor_date만 채움
- 앱 목록에서 삭제/지워 → delete_subscription. 이름 없으면 service_name null
- "없애줘/없애"는 즉시 delete가 아님. cancellation_guide. 앱 목록 삭제 vs 실제 해지 안내를 가른다. "목록"/"리스트"만 있으면 list_subscriptions이고 service_name은 null
- 일시정지/중지 → pause_subscription
- 재개/다시 켜기/다시 시작 → resume_subscription
- "두 번째 거"처럼 서수면 referent.kind=ordinal, ordinal은 1부터. last_listed가 있으면 그 목록의 순서
- "그거/그중/그 구독"이면 referent.kind=pronoun. last_listed를 가리킴
- recent_turns는 직전 대화. 후속 질문(금액만, 그중 제일 비싼, 그거 삭제)은 이 맥락을 이어가세요
- 직전 비서가 등록 금액을 물었으면 3자리 이상 또는 만원 단위가 금액. 결제일을 묻는 중의 1~2자리 숫자(15)나 월(9, 9월)은 금액이 아님
- 서비스명을 말했으면 service_name 또는 referent.kind=name
- 금액은 원 정수. 모르면 null
입력: ${JSON.stringify(payload)}`;

  try {
    const text = await claudeText({
      system: "JSON만 출력하세요. 마크다운 펜스 없이.",
      user: prompt,
      maxTokens: 500,
    });
    if (!text) return refineIntent(userText, { ...UNKNOWN }, subscriptionNames, ctx);

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
    // if (!res.ok) return refineIntent(userText, { ...UNKNOWN }, subscriptionNames, ctx);
    // const json = await res.json() as {
    //   candidates?: { content?: { parts?: { text?: string }[] } }[];
    // };
    // const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const parsed = parseClaudeJson(text);
    return refineIntent(userText, parseClassifiedIntent(parsed), subscriptionNames, ctx);
  } catch {
    return refineIntent(userText, { ...UNKNOWN }, subscriptionNames, ctx);
  }
}
