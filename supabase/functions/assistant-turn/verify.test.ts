import { explainReply } from "./explain.ts";
import { categoryTotals, chargesInMonth, findByNameFuzzy, findMentionedCategory, matchPresetHint, mentionsUnresolvedCategory, monthlyTotal, normalizeCategoryName } from "./queries.ts";
import { mentionsPriorList, refineIntent, type ClassifiedIntent } from "./gemini-intent.ts";

const BASE: ClassifiedIntent = {
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

Deno.test("custom category lookup ignores spaces and special characters", () => {
  if (normalizeCategoryName("  생 활! 비  ") !== "생활비") throw new Error("category normalization");
  if (normalizeCategoryName("ＯＴＴ") !== "ott") throw new Error("NFKC normalization");
  const found = findMentionedCategory([
    { id: "1", name: "생활!비", key: null, normalized_name: "생활비" },
    { id: "2", name: "생활", key: null, normalized_name: "생활" },
  ], "생활비 카테고리에 어떤 서비스가 있어?");
  if (found?.id !== "1") throw new Error("longest category match");
});

Deno.test("list reply is one row per subscription, not a comma blob", () => {
  const reply = explainReply({
    style: "query",
    facts: {
      period_label: "9월",
      subscriptions: [
        { name: "유튜브", amount: 14900, next_payment_date: "2026-09-02" },
        { name: "넷플릭스", amount: 17000, next_payment_date: "2026-09-29" },
        { name: "넷플릭스", amount: 17000, next_payment_date: "2026-09-29" },
      ],
    },
  });
  if (!reply.includes("9월 결제 예정 구독 3개예요.")) throw new Error(reply);
  if (!reply.includes("\n")) throw new Error("expected newlines");
  if (reply.includes("입니다.")) throw new Error(reply);
  const lines = reply.split("\n").filter((line) => line.trim());
  if (lines.length !== 4) throw new Error(reply);
  if (!lines[1].includes("유튜브") || !lines[1].includes("14,900원")) throw new Error(lines[1]);
});

Deno.test("넷플릭스 preset is entertainment (OTT)", () => {
  const hit = matchPresetHint("넷플릭스");
  if (hit?.id !== "netflix" || hit.category !== "entertainment") {
    throw new Error(JSON.stringify(hit));
  }
});

Deno.test("그중 제일 비싼 follows the prior list", () => {
  if (!mentionsPriorList("그중에서 제일 비싼")) throw new Error("among");
  const got = refineIntent("그중에서 제일 비싼", { ...BASE }, ["유튜브", "넷플릭스"], {
    last_intent: "list_subscriptions",
  });
  if (got.intent !== "expensive_subscriptions") throw new Error(got.intent);
  if (got.limit !== 1) throw new Error(String(got.limit));
});

Deno.test("monthly_total reply splits 월평균 and 예상 지출액", () => {
  const reply = explainReply({
    style: "query",
    facts: {
      monthly_total: 30000,
      monthly_equivalent: 30000,
      month_payment_total: 40000,
      month_expected_total: 52000,
      month_expected_recurring: 42000,
      month_expected_one_time: 10000,
      month_payment_recurring: 30000,
      month_payment_one_time: 10000,
      month_refunds: 0,
      month_scheduled: 12000,
    },
  });
  if (!reply.includes("월평균 구독 지출액은 30,000원")) throw new Error(reply);
  if (!reply.includes("이번 달 예상 지출액은 52,000원")) throw new Error(reply);
  if (!reply.includes("정기 42,000원") || !reply.includes("일회성 10,000원")) throw new Error(reply);
  if (!reply.includes("아직 날짜가 오지 않은 금액은 12,000원")) throw new Error(reply);
});

Deno.test("결제 총액 질문에도 일정 기준 예상액을 먼저 안내", () => {
  const reply = explainReply({
    userText: "이번 달 결제 총액이 얼마야",
    style: "query",
    facts: {
      monthly_total: 30000,
      monthly_equivalent: 30000,
      month_payment_total: 40000,
      month_expected_total: 40000,
      month_expected_recurring: 30000,
      month_expected_one_time: 10000,
      month_payment_recurring: 30000,
      month_payment_one_time: 10000,
      month_refunds: 0,
      month_scheduled: 0,
    },
  });
  if (!reply.startsWith("등록된 결제 일정 기준 이번 달 예상 지출액은 40,000원")) throw new Error(reply);
  if (!reply.includes("월평균 구독 지출액은 30,000원")) throw new Error(reply);
});

Deno.test("one_time is excluded from monthly equivalent and included in its expected month", () => {
  const now = new Date("2026-09-05T00:00:00+09:00");
  const facts = monthlyTotal([
    {
      id: "1",
      name: "넷플릭스",
      amount: 30000,
      billing_cycle: "monthly",
      is_active: true,
      next_payment_date: "2026-09-01",
      category_id: "c",
      account_id: null,
      created_at: "2026-01-01",
      memo: null,
      preset_id: null,
      emoji: null,
      anchor_date: "2026-01-01",
      billing_channel: null,
      lifecycle_status: "active",
      service_end_date: null,
      updated_at: null,
      is_trial: false,
      trial_ends_at: null,
    },
    {
      id: "2",
      name: "단건",
      amount: 10000,
      billing_cycle: "one_time",
      is_active: true,
      next_payment_date: "2026-09-03",
      category_id: "c",
      account_id: null,
      created_at: "2026-09-03",
      memo: null,
      preset_id: null,
      emoji: null,
      anchor_date: "2026-09-03",
      billing_channel: null,
      lifecycle_status: "active",
      service_end_date: null,
      updated_at: null,
      is_trial: false,
      trial_ends_at: null,
    },
  ], now);
  if (facts.monthly_equivalent !== 30000) throw new Error(JSON.stringify(facts));
  if (facts.month_payment_total !== 40000) throw new Error(JSON.stringify(facts));
  if (facts.month_expected_total !== 40000) throw new Error(JSON.stringify(facts));
  if (facts.next_month_expected_total !== 30000) throw new Error(JSON.stringify(facts));
  if (facts.month_payment_recurring !== 30000 || facts.month_payment_one_time !== 10000) {
    throw new Error(JSON.stringify(facts));
  }
  const yearly = chargesInMonth(
    { amount: 120000, billing_cycle: "yearly", anchor_date: "2026-09-01" },
    2026,
    9,
  );
  if (yearly.length !== 1 || yearly[0].amount !== 120000) throw new Error(JSON.stringify(yearly));
});

Deno.test("카테고리 답변은 비중·개수·합계를 함께 안내한다", () => {
  const categories = [
    { id: "c1", name: "엔터테인먼트" },
    { id: "c2", name: "음악" },
  ] as unknown as Parameters<typeof categoryTotals>[1];
  const subs = [
    { id: "1", name: "넷플릭스", amount: 17000, billing_cycle: "monthly", category_id: "c1" },
    { id: "2", name: "디즈니+", amount: 3000, billing_cycle: "monthly", category_id: "c1" },
    { id: "3", name: "스포티파이", amount: 10000, billing_cycle: "monthly", category_id: "c2" },
  ] as unknown as Parameters<typeof categoryTotals>[0];

  const facts = categoryTotals(subs, categories) as unknown as Record<string, unknown>;
  const reply = explainReply({ userText: "카테고리 현황 보여줘", facts, style: "query" });

  if (!reply.includes("월평균 구독 지출액 30,000원")) throw new Error(reply);
  if (!reply.includes("엔터테인먼트 20,000원 (67%, 2개)")) throw new Error(reply);
  if (!reply.includes("음악 10,000원 (33%, 1개)")) throw new Error(reply);
  if (!reply.includes("가장 비중이 큰 건 엔터테인먼트예요.")) throw new Error(reply);
  // 금액이 큰 카테고리가 먼저 온다.
  if (reply.indexOf("엔터테인먼트") > reply.indexOf("음악")) throw new Error(reply);
});

Deno.test("프리셋 매칭은 한 글자 오타를 허용한다", () => {
  const typos: [string, string][] = [
    ["넽플릭스", "netflix"],
    ["넷플맄스", "netflix"],
    ["왓차", "watcha"],
    ["와챠", "watcha"],
    ["아도비", "adobe"],
    ["쿠파", "coupang"],
  ];
  for (const [typo, expectedId] of typos) {
    const hit = matchPresetHint(typo);
    if (hit?.id !== expectedId) throw new Error(`${typo}: ${JSON.stringify(hit)}`);
  }
});

Deno.test("프리셋 매칭은 다른 서비스와 겹칠 만큼 관대하지 않다", () => {
  const misses = ["노션", "구글", "카톡", "멜론", "챗지피티", "지멜"];
  for (const text of misses) {
    if (matchPresetHint(text) !== null) {
      throw new Error(`${text}: ${JSON.stringify(matchPresetHint(text))}`);
    }
  }
});

Deno.test("커스텀 카테고리 조회는 오타를 허용하되 이름은 고치지 않는다", () => {
  const categories = [
    { id: "1", name: "생활비", key: null, normalized_name: "생활비" },
    { id: "2", name: "생활", key: null, normalized_name: "생활" },
    { id: "3", name: "구독료", key: null, normalized_name: "구독료" },
  ] as unknown as Parameters<typeof findMentionedCategory>[0];

  const typoHit = findMentionedCategory(categories, "생왈비 카테고리에 뭐있어?");
  if (typoHit?.id !== "1") throw new Error(`오타 매칭 실패: ${JSON.stringify(typoHit)}`);
  if (typoHit.name !== "생활비") throw new Error(`카테고리 이름이 바뀌면 안 된다: ${typoHit.name}`);

  // 조사가 붙어도 접두 비교로 찾는다.
  const withParticle = findMentionedCategory(categories, "생활비는 얼마나 썼어?");
  if (withParticle?.id !== "1") throw new Error(`조사 처리 실패: ${JSON.stringify(withParticle)}`);

  // 짧은 카테고리("생활")가 정확히 일치하면, 더 긴 카테고리("생활비")로의 오타 추정보다 우선한다.
  const exactShort = findMentionedCategory(categories, "생활 카테고리 보여줘");
  if (exactShort?.id !== "2") throw new Error(`정확 일치 우선 실패: ${JSON.stringify(exactShort)}`);

  // "구독"은 "구독료"의 접두이자 흔한 일반 단어라 오탐 위험이 크다 — 매칭되면 안 된다.
  if (findMentionedCategory(categories, "구독 목록 보여줘") !== undefined) {
    throw new Error("흔한 단어가 짧은 카테고리명에 오탐되면 안 된다");
  }
});

Deno.test("구독 이름 오타는 후보로만 뜨고 이름을 대신 고치지 않는다", () => {
  const mk = (id: string, name: string) => ({
    id, name, amount: 1000, billing_cycle: "monthly", is_active: true,
    next_payment_date: null, category_id: "c", account_id: null, created_at: "",
    memo: null, preset_id: null, emoji: null, anchor_date: "2026-01-01",
    billing_channel: null, lifecycle_status: "active", service_end_date: null, updated_at: null, is_trial: false, trial_ends_at: null,
  }) as unknown as Parameters<typeof findByNameFuzzy>[0][number];
  const subs = [mk("1", "넷플릭스"), mk("2", "디즈니+"), mk("3", "유튜브 프리미엄")];

  const typo = findByNameFuzzy(subs, "넽플릭스");
  if (typo.length !== 1 || typo[0].id !== "1") throw new Error(JSON.stringify(typo));
  if (typo[0].name !== "넷플릭스") throw new Error(`이름이 바뀌면 안 된다: ${typo[0].name}`);

  // 이 목록에 없는 서비스는 억지로 후보를 만들지 않는다.
  if (findByNameFuzzy(subs, "왓챠").length !== 0) throw new Error("존재하지 않는 서비스가 매칭되면 안 된다");
  if (findByNameFuzzy(subs, "쿠팡").length !== 0) throw new Error("존재하지 않는 서비스가 매칭되면 안 된다");
});

Deno.test("카테고리 이름을 대려다 실패한 문장만 후보 제시 대상으로 잡는다", () => {
  const attempted = ["생왈비 카테고리에 뭐있어?", "넷플릭스구독카테고리뭐야"];
  for (const text of attempted) {
    if (!mentionsUnresolvedCategory(text)) throw new Error(`시도로 잡혀야 한다: ${text}`);
  }
  const generic = ["카테고리 현황 보여줘", "카테고리 보여줘", "구독 목록 보여줘", "이번 달 얼마 나가?"];
  for (const text of generic) {
    if (mentionsUnresolvedCategory(text)) throw new Error(`일반 질문인데 시도로 잡혔다: ${text}`);
  }
});
