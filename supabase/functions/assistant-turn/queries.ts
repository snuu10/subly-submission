import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type ToolSubscription = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: string;
  is_active: boolean;
  next_payment_date: string;
  category_id: string;
  account_id: string | null;
  created_at: string;
  memo: string | null;
  preset_id: string | null;
  emoji: string | null;
  anchor_date: string;
  billing_channel: string | null;
  lifecycle_status: string;
  service_end_date: string | null;
  updated_at: string | null;
  is_trial: boolean;
  trial_ends_at: string | null;
};

export type CategoryRow = {
  id: string;
  name: string;
  key: string | null;
  normalized_name?: string | null;
};

export function monthlyAmount(amount: number, cycle: string): number {
  if (cycle === "yearly") return Math.round(amount / 12);
  if (cycle === "one_time") return 0;
  return amount;
}

function daysUntil(isoDate: string): number {
  const now = new Date();
  const seoul = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  seoul.setHours(0, 0, 0, 0);
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(year, (month ?? 1) - 1, day ?? 1);
  return Math.round((target.getTime() - seoul.getTime()) / 86_400_000);
}

const PRESET_HINTS: { id: string; names: string[]; category: string }[] = [
  { id: "netflix", names: ["넷플릭스", "netflix"], category: "entertainment" },
  { id: "youtube-premium", names: ["유튜브", "youtube"], category: "entertainment" },
  { id: "tving", names: ["티빙", "tving"], category: "entertainment" },
  { id: "disney-plus", names: ["디즈니+", "disney+", "disneyplus"], category: "entertainment" },
  { id: "wavve", names: ["웨이브", "wavve"], category: "entertainment" },
  { id: "watcha", names: ["왓챠", "watcha"], category: "entertainment" },
  { id: "apple-tv", names: ["애플tv", "appletv", "애플티비"], category: "entertainment" },
  { id: "chatgpt", names: ["chatgpt", "챗gpt"], category: "work" },
  { id: "google-ai", names: ["googleai", "gemini"], category: "work" },
  { id: "claude", names: ["claude", "클로드"], category: "work" },
  { id: "perplexity", names: ["perplexity"], category: "work" },
  { id: "adobe", names: ["어도비", "adobe", "포토샵", "photoshop"], category: "work" },
  { id: "icloud", names: ["icloud"], category: "cloud" },
  { id: "microsoft-365", names: ["ms365", "microsoft365", "오피스365"], category: "cloud" },
  { id: "kakao-emoticon", names: ["카카오"], category: "etc" },
  { id: "naver-plus", names: ["네이버+", "네이버플러스"], category: "etc" },
  { id: "coupang", names: ["쿠팡"], category: "etc" },
  { id: "toss-prime", names: ["토스"], category: "etc" },
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = row;
  }
  return prev[b.length];
}

// 글자 하나 정도의 오타("넽플릭스" 등)를 허용한다. 길이에 비례해 관대해지면 서로 다른
// 서비스끼리 뭉개지므로, 짧은 이름일수록 편집 거리를 더 엄격히 제한한다.
function typoTolerance(length: number): number {
  if (length <= 3) return 1;
  if (length <= 6) return 1;
  return 2;
}

function fuzzyPresetMatch(needle: string): { id: string; category: string } | null {
  if (needle.length < 2) return null;
  let best: { id: string; category: string; distance: number } | null = null;
  for (const row of PRESET_HINTS) {
    for (const item of row.names) {
      const value = normalizeName(item);
      if (value.length < 2) continue;
      if (Math.abs(value.length - needle.length) > typoTolerance(Math.max(value.length, needle.length))) continue;
      const distance = levenshtein(needle, value);
      if (distance > typoTolerance(Math.max(value.length, needle.length))) continue;
      if (!best || distance < best.distance) best = { id: row.id, category: row.category, distance };
    }
  }
  return best ? { id: best.id, category: best.category } : null;
}

export function matchPresetHint(name: string): { id: string; category: string } | null {
  const needle = normalizeName(name);
  if (!needle) return null;
  const exact = PRESET_HINTS.find((row) => row.names.some((item) => normalizeName(item) === needle));
  if (exact) return { id: exact.id, category: exact.category };
  const fuzzy = PRESET_HINTS.find((row) =>
    row.names.some((item) => {
      const value = normalizeName(item);
      return value.length >= 2 && (needle.includes(value) || value.includes(needle));
    })
  );
  if (fuzzy) return { id: fuzzy.id, category: fuzzy.category };
  return fuzzyPresetMatch(needle);
}

export function peerCategoryKey(
  all: ToolSubscription[],
  name: string,
  categories: CategoryRow[],
): string | null {
  const needle = normalizeName(name);
  if (!needle) return null;
  const counts = new Map<string, number>();
  for (const item of all) {
    if (normalizeName(item.name) !== needle) continue;
    const cat = categories.find((row) => row.id === item.category_id);
    if (!cat?.key || cat.key === "etc") continue;
    counts.set(cat.key, (counts.get(cat.key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

export function normalizeCategoryName(value: string): string {
  // ChatGPT 수정: 기존 특수문자 카테고리도 질문에서 안정적으로 찾는 비교 키다.
  return value.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, "");
}

// 카테고리 "이름"을 고치지 않는다 — 사용자가 만든 이름은 그대로 저장·표시된다.
// 여기서 허용하는 오타는 기존 카테고리를 "찾는" 질문 텍스트에만 적용된다.
//
// 어절(공백 기준 토큰)의 앞부분만 키와 비교한다. 한국어는 조사가 단어 뒤에 붙으므로
// ("생활비는", "생활비가") 접두 비교로 충분하고, 문장 전체를 이어붙여 슬라이딩하면
// "생활"과 그 뒤에 오는 낱말이 우연히 "생활비"와 1글자 차이로 겹쳐 엉뚱한 카테고리가
// 뽑히는 사고가 난다. 짧은 표준 단어("구독")가 짧은 카테고리명("구독료")의 접두라서
// 편집거리 1로 걸리는 경우도 이 방식이면 걸러진다 — 토큰 길이가 키보다 짧으면 아예
// 시도하지 않는다.
function fuzzyMatchesToken(token: string, key: string): boolean {
  if (key.length < 2 || token.length < key.length) return false;
  return levenshtein(token.slice(0, key.length), key) <= typoTolerance(key.length);
}

export function findMentionedCategory(categories: CategoryRow[], text: string): CategoryRow | undefined {
  const question = normalizeCategoryName(text);
  const exact = [...categories]
    .filter((category) => {
      const key = category.normalized_name || normalizeCategoryName(category.name);
      return key.length > 0 && question.includes(key);
    })
    .sort((a, b) => normalizeCategoryName(b.name).length - normalizeCategoryName(a.name).length)[0];
  if (exact) return exact;

  const tokens = text.split(/\s+/).map((token) => normalizeCategoryName(token)).filter(Boolean);
  return [...categories]
    .filter((category) => {
      const key = category.normalized_name || normalizeCategoryName(category.name);
      return key.length > 0 && tokens.some((token) => fuzzyMatchesToken(token, key));
    })
    .sort((a, b) => normalizeCategoryName(b.name).length - normalizeCategoryName(a.name).length)[0];
}

// 카테고리 조회 문장에서 일반적으로 쓰이는 동사·명사를 뺀 나머지가 있으면, 그건
// 사용자가 특정 카테고리 이름을 대려 한 시도로 본다. findMentionedCategory가
// (오타 허용까지 포함해) 아무것도 못 찾았을 때만 호출해서, 그 시도가 실패했는지 본다.
const CATEGORY_QUERY_FILLER_WORDS = new Set([
  "카테고리", "카테고리에", "카테고리는", "카테고리가", "카테고리별",
  "현황", "내역", "조회", "상세", "보여줘", "알려줘", "뭐", "뭐야", "뭐있어",
  "있어", "목록", "구독", "서비스", "얼마", "지출", "결제", "분석",
  "이번", "다음", "지난", "이번달", "다음달", "지난달", "달", "월",
  "나가", "나가요", "나갔어", "썼어", "쓴",
]);

export function mentionsUnresolvedCategory(text: string): boolean {
  const tokens = text.split(/\s+/).map((token) => normalizeCategoryName(token)).filter(Boolean);
  return tokens.some((token) => token.length >= 2 && !CATEGORY_QUERY_FILLER_WORDS.has(token));
}

export async function fetchSubscriptions(client: SupabaseClient): Promise<ToolSubscription[]> {
  const { data, error } = await client
    .from("subscriptions")
    .select(
      "id,name,amount,billing_cycle,is_active,next_payment_date,category_id,account_id,created_at,memo,preset_id,emoji,anchor_date,billing_channel,lifecycle_status,service_end_date,updated_at,is_trial,trial_ends_at",
    )
    .order("next_payment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ToolSubscription[];
}

export async function fetchCategories(client: SupabaseClient): Promise<CategoryRow[]> {
  const { data, error } = await client.from("categories").select("id,name,key,normalized_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryRow[];
}

export function accountTakenByDuplicate(
  siblings: ToolSubscription[],
  account: string,
): boolean {
  const key = account.trim().toLowerCase();
  if (!key) return false;
  return siblings.some((item) => (item.account_id ?? "").trim().toLowerCase() === key);
}

export function findByName(all: ToolSubscription[], query: string): ToolSubscription[] {
  const needle = normalizeName(query);
  if (needle.length < 2) return [];
  return all.filter((item) => {
    const name = normalizeName(item.name);
    return name.length >= 2 && (name.includes(needle) || needle.includes(name));
  });
}

// 정확 일치·부분 일치가 전부 실패했을 때만 쓰는 마지막 수단. 이름 자체를 추측해 고치지
// 않고, 후보로만 띄워 사용자가 직접 고르게 한다 (구독은 프리셋과 달리 개수가 적고
// 사용자마다 달라 오탐 비용이 낮다). 가까운 순으로 최대 limit개.
export function findByNameFuzzy(
  all: ToolSubscription[],
  query: string,
  limit = 3,
): ToolSubscription[] {
  const needle = normalizeName(query);
  if (needle.length < 2) return [];
  return all
    .map((item) => {
      const name = normalizeName(item.name);
      if (name.length < 2) return null;
      const tol = typoTolerance(Math.max(name.length, needle.length));
      if (Math.abs(name.length - needle.length) > tol) return null;
      const distance = levenshtein(needle, name);
      return distance <= tol ? { item, distance } : null;
    })
    .filter((row): row is { item: ToolSubscription; distance: number } => row !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((row) => row.item);
}

export type ChargeKind = "recurring" | "one_time";

export function chargesInMonth(
  item: Pick<ToolSubscription, "amount" | "billing_cycle" | "anchor_date">,
  year: number,
  month: number,
): { date: string; amount: number; kind: ChargeKind }[] {
  const kind: ChargeKind = item.billing_cycle === "one_time" ? "one_time" : "recurring";
  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, lastDayOfMonth(year, month));
  const anchor = item.anchor_date.slice(0, 10);

  if (item.billing_cycle === "one_time") {
    return anchor >= start && anchor <= end ? [{ date: anchor, amount: item.amount, kind }] : [];
  }

  const cycle = item.billing_cycle === "yearly" ? "yearly" : "monthly";
  const charges: { date: string; amount: number; kind: ChargeKind }[] = [];
  let from = seoulMidnight(year, month, 1);
  let guard = 0;
  while (guard < 8) {
    const cursor = nextPaymentFromAnchor(anchor, cycle, from);
    if (!cursor || cursor > end) break;
    if (cursor >= start) charges.push({ date: cursor, amount: item.amount, kind });
    const [nextYear, nextMonth, nextDay] = cursor.split("-").map(Number);
    const tomorrow = addCalendarDays(nextYear, nextMonth, nextDay, 1);
    from = seoulMidnight(tomorrow.year, tomorrow.month, tomorrow.day);
    guard += 1;
  }
  return charges;
}

function seoulMidnight(year: number, month: number, day: number): Date {
  return new Date(`${isoDate(year, month, day)}T00:00:00+09:00`);
}

export function monthPaymentBreakdown(active: ToolSubscription[], now = new Date()) {
  const today = seoulYmd(now);
  const asOf = isoDate(today.year, today.month, today.day);
  let recurring = 0;
  let oneTime = 0;
  let scheduled = 0;
  let scheduledRecurring = 0;
  let scheduledOneTime = 0;

  for (const item of active) {
    for (const charge of chargesInMonth(item, today.year, today.month)) {
      if (charge.date > asOf) {
        scheduled += charge.amount;
        if (charge.kind === "one_time") scheduledOneTime += charge.amount;
        else scheduledRecurring += charge.amount;
      }
      else if (charge.kind === "one_time") oneTime += charge.amount;
      else recurring += charge.amount;
    }
  }

  const refunds = 0;
  return {
    // 하위 호환용: 오늘까지 일정상 지난 금액이며 실제 결제 확인액이 아니다.
    month_payment_total: recurring + oneTime - refunds,
    month_payment_recurring: recurring,
    month_payment_one_time: oneTime,
    month_expected_total: recurring + oneTime + scheduled - refunds,
    month_expected_recurring: recurring + scheduledRecurring,
    month_expected_one_time: oneTime + scheduledOneTime,
    month_refunds: refunds,
    month_scheduled: scheduled,
  };
}

export function monthlyTotal(active: ToolSubscription[], now = new Date()) {
  const total = active.reduce((sum, item) => sum + monthlyAmount(item.amount, item.billing_cycle), 0);
  const today = seoulYmd(now);
  const nextMonth = shiftMonth(today.year, today.month, 1);
  const nextMonthExpected = active.reduce(
    (sum, item) => sum + chargesInMonth(item, nextMonth.year, nextMonth.month)
      .reduce((chargeSum, charge) => chargeSum + charge.amount, 0),
    0,
  );
  return {
    monthly_total: total,
    monthly_equivalent: total,
    active_count: active.length,
    next_month_expected_total: nextMonthExpected,
    ...monthPaymentBreakdown(active, now),
  };
}

export function categoryTotals(active: ToolSubscription[], categories: CategoryRow[]) {
  const byId = new Map(categories.map((row) => [row.id, row.name]));
  const totals = new Map<string, { amount: number; count: number }>();
  for (const item of active) {
    const label = byId.get(item.category_id) ?? "기타";
    const bucket = totals.get(label) ?? { amount: 0, count: 0 };
    bucket.amount += monthlyAmount(item.amount, item.billing_cycle);
    bucket.count += 1;
    totals.set(label, bucket);
  }
  return {
    totals: Array.from(totals, ([category, bucket]) => ({
      category,
      amount: bucket.amount,
      count: bucket.count,
    })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "ko")),
  };
}

export function categorizedSubscriptions(active: ToolSubscription[], categories: CategoryRow[]) {
  const byId = new Map(categories.map((row) => [row.id, row.name]));
  return {
    subscriptions: active.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      billing_cycle: item.billing_cycle,
      next_payment_date: item.next_payment_date,
      category: byId.get(item.category_id) ?? "기타",
    })),
    totals: categoryTotals(active, categories).totals,
    summary: active.length === 0 ? "해당하는 구독이 없어요." : undefined,
  };
}

export function seoulYmd(now = new Date()): { year: number; month: number; day: number; weekday: number } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = ymd.split("-").map(Number);
  const wdLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[wdLabel] ?? 1;
  return { year, month, day, weekday };
}

export function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 매월 N일: 이번 달 N일(없는 달은 말일)이 오늘 이후면 그날짜, 지났으면 다음 달. Asia/Seoul. */
export function nextMonthlyBillingDate(dayOfMonth: number, now = new Date()): string | null {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const today = seoulYmd(now);
  const thisDay = Math.min(dayOfMonth, lastDayOfMonth(today.year, today.month));
  if (thisDay >= today.day) return isoDate(today.year, today.month, thisDay);
  const next = shiftMonth(today.year, today.month, 1);
  const nextDay = Math.min(dayOfMonth, lastDayOfMonth(next.year, next.month));
  return isoDate(next.year, next.month, nextDay);
}

/** 월간 기준일. 1월은 31일까지 있어 31일이 다음 달에 28일로 굳지 않는다. */
export function monthlyCanonicalAnchor(dayOfMonth: number, now = new Date()): string | null {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const today = seoulYmd(now);
  return isoDate(today.year, 1, dayOfMonth);
}

export function nextWeeklyBillingDate(weekday: number, now = new Date()): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const today = seoulYmd(now);
  const delta = (weekday - today.weekday + 7) % 7;
  const next = addCalendarDays(today.year, today.month, today.day, delta);
  return isoDate(next.year, next.month, next.day);
}

export function nextYearlyBillingDate(month: number, day: number, now = new Date()): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = seoulYmd(now);
  for (let year = today.year; year <= today.year + 4; year++) {
    const last = lastDayOfMonth(year, month);
    if (day > last && !(month === 2 && day === 29)) return null;
    const useDay = Math.min(day, last);
    if (year > today.year || month > today.month || (month === today.month && useDay >= today.day)) {
      return isoDate(year, month, useDay);
    }
  }
  return null;
}

export function yearlyCanonicalAnchor(month: number, day: number, now = new Date()): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = seoulYmd(now);
  if (month === 2 && day === 29) {
    const leap = today.year % 4 === 0 && (today.year % 100 !== 0 || today.year % 400 === 0)
      ? today.year
      : today.year - (today.year % 4 || 4);
    return isoDate(leap, 2, 29);
  }
  const last = lastDayOfMonth(today.year, month);
  if (day > last) return null;
  return isoDate(today.year, month, day);
}

function ymdNum(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** 원래 기준일에 N주기를 더한다. 직전 말일 보정값이 다음 달에 이어지지 않는다. */
export function nextPaymentFromAnchor(
  anchor: string,
  cycle: "monthly" | "yearly" | "one_time",
  now = new Date(),
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  if (cycle === "one_time") return anchor;
  const [ay, am, ad] = anchor.split("-").map(Number);
  const today = seoulYmd(now);
  const from = ymdNum(today.year, today.month, today.day);
  if (cycle === "yearly") {
    for (let n = 0; n < 20; n++) {
      const year = ay + n;
      const day = Math.min(ad, lastDayOfMonth(year, am));
      if (ymdNum(year, am, day) >= from) return isoDate(year, am, day);
    }
    return null;
  }
  for (let n = 0; n < 48; n++) {
    const shifted = shiftMonth(ay, am, n);
    const day = Math.min(ad, lastDayOfMonth(shifted.year, shifted.month));
    if (ymdNum(shifted.year, shifted.month, day) >= from) {
      return isoDate(shifted.year, shifted.month, day);
    }
  }
  return null;
}

export function shiftMonth(year: number, month: number, delta: number) {
  const dt = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
}

/** 월요일 시작, Asia/Seoul 달력 주. */
export function weekRange(kind: "this_week" | "next_week"): { start: string; end: string } {
  const today = seoulYmd();
  const fromMonday = today.weekday === 0 ? 6 : today.weekday - 1;
  const monday = addCalendarDays(today.year, today.month, today.day, -fromMonday);
  const start = kind === "next_week" ? addCalendarDays(monday.year, monday.month, monday.day, 7) : monday;
  const end = addCalendarDays(start.year, start.month, start.day, 6);
  return {
    start: isoDate(start.year, start.month, start.day),
    end: isoDate(end.year, end.month, end.day),
  };
}

type ListedFacts = {
  subscriptions: Array<{
    id: string;
    name: string;
    amount: number;
    billing_cycle: string;
    next_payment_date: string;
  }>;
  summary?: string;
  period_label?: string;
};

function listedFacts(rows: ToolSubscription[], extra?: { summary?: string; period_label?: string }): ListedFacts {
  const sorted = [...rows].sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date));
  return {
    subscriptions: sorted.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      billing_cycle: item.billing_cycle,
      next_payment_date: item.next_payment_date,
    })),
    ...extra,
  };
}

export function listAll(active: ToolSubscription[]) {
  return listedFacts(active, {
    summary: active.length === 0 ? "등록된 구독이 없어요." : undefined,
  });
}

/** is_trial만 보면 체험이 끝난 뒤 다음 결제 주기에 다시 참이 될 수 있어 날짜도 함께 본다. */
export function listTrial(active: ToolSubscription[], todayIso: string) {
  const rows = active.filter((item) => item.is_trial && item.trial_ends_at && item.trial_ends_at >= todayIso);
  return listedFacts(rows, {
    summary: rows.length === 0 ? "무료 체험 중인 구독이 없어요." : undefined,
  });
}

export function listNamed(active: ToolSubscription[], query: string) {
  const rows = findByName(active, query);
  return listedFacts(rows, {
    summary: rows.length === 0 ? `"${query}" 구독을 찾지 못했어요.` : undefined,
  });
}

export function listByMonth(active: ToolSubscription[], year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = active.filter((item) => item.next_payment_date.startsWith(prefix));
  return listedFacts(rows, {
    period_label: `${month}월`,
    summary: rows.length === 0 ? `${month}월에 결제 예정인 구독이 없어요.` : undefined,
  });
}

export function listByRange(active: ToolSubscription[], start: string, end: string, emptySummary: string) {
  const rows = active.filter((item) => item.next_payment_date >= start && item.next_payment_date <= end);
  return listedFacts(rows, { summary: rows.length === 0 ? emptySummary : undefined });
}

export function upcoming(active: ToolSubscription[], withinDays: number) {
  const rows = active
    .map((item) => ({ ...item, days_until: daysUntil(item.next_payment_date) }))
    .filter((item) => item.days_until >= 0 && item.days_until <= withinDays)
    .sort((a, b) => a.days_until - b.days_until);
  return {
    subscriptions: rows.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      billing_cycle: item.billing_cycle,
      next_payment_date: item.next_payment_date,
      days_until: item.days_until,
    })),
    summary: rows.length === 0 ? "다가오는 결제가 없어요." : undefined,
  };
}

export function expensive(active: ToolSubscription[], limit: number) {
  const rows = [...active]
    .map((item) => ({ ...item, monthly_amount: monthlyAmount(item.amount, item.billing_cycle) }))
    .sort((a, b) => b.monthly_amount - a.monthly_amount)
    .slice(0, Math.max(1, limit));
  return {
    subscriptions: rows.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      billing_cycle: item.billing_cycle,
      monthly_amount: item.monthly_amount,
      next_payment_date: item.next_payment_date,
    })),
    summary: rows.length === 0 ? "해당하는 구독이 없어요." : undefined,
  };
}

export function subscriptionsInPeriod(
  active: ToolSubscription[],
  period: { type: string; year: number | null; month: number | null },
): ToolSubscription[] {
  const today = seoulYmd();
  if (period.type === "calendar_month" && period.month != null) {
    const year = period.year ?? today.year;
    const prefix = `${year}-${String(period.month).padStart(2, "0")}`;
    return active.filter((item) => item.next_payment_date.startsWith(prefix));
  }
  if (period.type === "this_month") {
    const prefix = `${today.year}-${String(today.month).padStart(2, "0")}`;
    return active.filter((item) => item.next_payment_date.startsWith(prefix));
  }
  if (period.type === "last_month") {
    const prev = shiftMonth(today.year, today.month, -1);
    const prefix = `${prev.year}-${String(prev.month).padStart(2, "0")}`;
    return active.filter((item) => item.next_payment_date.startsWith(prefix));
  }
  return active;
}

export function resolveCategoryId(
  categories: CategoryRow[],
  key: string | null,
  name: string | null,
  fallbackId?: string | null,
): string | null {
  const byKey = key ? categories.find((item) => item.key === key) : undefined;
  const categoryNeedle = name ? normalizeCategoryName(name) : "";
  const byName = categoryNeedle
    ? categories.find((item) =>
      (item.normalized_name || normalizeCategoryName(item.name)) === categoryNeedle
    )
    : undefined;
  const fallback = fallbackId ? categories.find((item) => item.id === fallbackId) : undefined;
  const etc = categories.find((item) => item.key === "etc");
  return byKey?.id ?? byName?.id ?? fallback?.id ?? etc?.id ?? categories[0]?.id ?? null;
}

export type SnapshotRow = {
  month_start: string;
  monthly_total: number;
  active_count: number;
  category_totals: Record<string, number>;
};

export type ChangeEventRow = {
  id: string;
  subscription_id: string | null;
  subscription_name: string;
  kind: string;
  old_amount: number | null;
  new_amount: number | null;
  monthly_amount: number | null;
  created_at: string;
};

export type CleanupReason = {
  code: "unused" | "duplicate" | "price_hike";
  evidence: string;
};

export type CleanupRecommendation = {
  id: string;
  name: string;
  amount: number;
  monthly_amount: number;
  monthly_save: number;
  yearly_save: number;
  confidence: "high" | "medium" | "low";
  reasons: CleanupReason[];
};

function asCategoryTotals(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

export async function fetchSnapshots(client: SupabaseClient, limit = 8): Promise<SnapshotRow[]> {
  const { data, error } = await client
    .from("subscription_monthly_snapshots")
    .select("month_start,monthly_total,active_count,category_totals")
    .order("month_start", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    month_start: (row as { month_start: string }).month_start,
    monthly_total: Number((row as { monthly_total: number }).monthly_total) || 0,
    active_count: Number((row as { active_count: number }).active_count) || 0,
    category_totals: asCategoryTotals((row as { category_totals: unknown }).category_totals),
  }));
}

export async function fetchAmountChanges(client: SupabaseClient): Promise<ChangeEventRow[]> {
  const { data, error } = await client
    .from("subscription_change_events")
    .select("id,subscription_id,subscription_name,kind,old_amount,new_amount,monthly_amount,created_at")
    .eq("kind", "amount")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeEventRow[];
}

export function periodComparison(snapshots: SnapshotRow[], months: number, thisMonthChanges: ChangeEventRow[]) {
  const window = snapshots.slice(0, Math.max(1, months + 1));
  if (window.length < 2) {
    const current = window[0];
    const hikes = thisMonthChanges.filter((item) =>
      (item.new_amount ?? 0) > (item.old_amount ?? 0)
    );
    return {
      comparable: false,
      months,
      current_total: current?.monthly_total ?? null,
      summary: current
        ? `월평균 구독 지출액은 ${current.monthly_total.toLocaleString("ko-KR")}원이에요. 지난달 스냅샷이 아직 없어 비교할 수 없어요.`
        : "아직 월별 지출 이력이 없어요.",
      this_month_changes: hikes.map((item) => ({
        name: item.subscription_name,
        old_amount: item.old_amount,
        new_amount: item.new_amount,
      })),
    };
  }
  const latest = window[0];
  const previous = window[1];
  const delta = latest.monthly_total - previous.monthly_total;
  const points = window.slice(0, months === 1 ? 2 : months).map((row) => ({
    month_start: row.month_start,
    monthly_total: row.monthly_total,
  }));
  return {
    comparable: true,
    months,
    current_total: latest.monthly_total,
    previous_total: previous.monthly_total,
    delta,
    points,
  };
}

export function priceIncreases(events: ChangeEventRow[]) {
  const rows = events.filter((item) =>
    typeof item.old_amount === "number" &&
    typeof item.new_amount === "number" &&
    item.new_amount > item.old_amount
  );
  return {
    increases: rows.map((item) => ({
      id: item.subscription_id,
      name: item.subscription_name,
      old_amount: item.old_amount,
      new_amount: item.new_amount,
      created_at: item.created_at.slice(0, 10),
    })),
    summary: rows.length === 0 ? "기록된 가격 인상이 없어요." : undefined,
  };
}

export function cancelSavings(target: ToolSubscription) {
  const monthly_save = monthlyAmount(target.amount, target.billing_cycle);
  return {
    id: target.id,
    name: target.name,
    amount: target.amount,
    monthly_save,
    yearly_save: monthly_save * 12,
  };
}

function confidenceOf(reasons: CleanupReason[]): "high" | "medium" | "low" {
  const unused = reasons.some((item) => item.code === "unused");
  const dup = reasons.some((item) => item.code === "duplicate");
  const hike = reasons.some((item) => item.code === "price_hike");
  if (unused && (dup || hike)) return "high";
  if (unused || dup) return "medium";
  return "low";
}

export async function cleanupCandidates(
  client: SupabaseClient,
  active: ToolSubscription[],
): Promise<{ subscriptions: CleanupRecommendation[] }> {
  if (active.length === 0) return { subscriptions: [] };

  const ids = active.map((item) => item.id);
  const [{ data: checkins, error: checkinError }, amountEvents] = await Promise.all([
    client
      .from("usage_checkins")
      .select("subscription_id, response, created_at")
      .in("subscription_id", ids)
      .order("created_at", { ascending: false }),
    fetchAmountChanges(client),
  ]);
  if (checkinError) throw new Error(checkinError.message);

  const latest = new Map<string, string>();
  for (const row of checkins ?? []) {
    const id = (row as { subscription_id: string }).subscription_id;
    if (!latest.has(id)) latest.set(id, (row as { response: string }).response);
  }

  const nameGroups = new Map<string, ToolSubscription[]>();
  const presetGroups = new Map<string, ToolSubscription[]>();
  for (const item of active) {
    const key = normalizeName(item.name);
    nameGroups.set(key, [...(nameGroups.get(key) ?? []), item]);
    if (item.preset_id) {
      presetGroups.set(item.preset_id, [...(presetGroups.get(item.preset_id) ?? []), item]);
    }
  }
  const duplicateIds = new Set<string>();
  for (const group of [...nameGroups.values(), ...presetGroups.values()]) {
    if (group.length > 1) {
      for (const item of group) duplicateIds.add(item.id);
    }
  }

  const hikeBySub = new Map<string, ChangeEventRow>();
  for (const event of amountEvents) {
    if (!event.subscription_id) continue;
    if ((event.new_amount ?? 0) <= (event.old_amount ?? 0)) continue;
    if (!hikeBySub.has(event.subscription_id)) hikeBySub.set(event.subscription_id, event);
  }

  const rows: CleanupRecommendation[] = [];
  for (const item of active) {
    const reasons: CleanupReason[] = [];
    if (latest.get(item.id) === "not_used") {
      reasons.push({ code: "unused", evidence: "최근 사용 체크인에서 안 쓴다고 답했어요." });
    }
    if (duplicateIds.has(item.id)) {
      reasons.push({ code: "duplicate", evidence: "같은 이름 또는 같은 서비스 프리셋이 두 개 이상이에요." });
    }
    const hike = hikeBySub.get(item.id);
    if (hike) {
      reasons.push({
        code: "price_hike",
        evidence: `${(hike.old_amount ?? 0).toLocaleString("ko-KR")}원에서 ${(hike.new_amount ?? 0).toLocaleString("ko-KR")}원으로 올랐어요.`,
      });
    }
    if (reasons.length === 0) continue;
    const monthly = monthlyAmount(item.amount, item.billing_cycle);
    rows.push({
      id: item.id,
      name: item.name,
      amount: item.amount,
      monthly_amount: monthly,
      monthly_save: monthly,
      yearly_save: monthly * 12,
      confidence: confidenceOf(reasons),
      reasons,
    });
  }

  rows.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence];
    return b.monthly_save - a.monthly_save;
  });
  return { subscriptions: rows };
}
