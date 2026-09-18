import {
  calendarDateFromMonthDay,
  createNameFromText,
  cleanServiceName,
  invalidBillingDay,
  isConfirmUtterance,
  isRejectUtterance,
  isCorrectionUtterance,
  classifyConfirmationDecision,
  isDuplicateAffirmativeUtterance,
  isDuplicateDeleteUtterance,
  isNonAnswerAccountUtterance,
  isDuplicateSameUtterance,
  isDuplicateSeparateUtterance,
  parseCreateDayNumber,
  parseCreateMonthNumber,
  parseWonAmount,
  parseKoreanDate,
  parseBillingDate,
  parseSpokenCycle,
  parseRelativeDayWord,
  parseClassifiedIntent,
  refineIntent,
  spokenAmountIssue,
  parseAccountFromText,
  type ClassifiedIntent,
} from "./gemini-intent.ts";
import { accountTakenByDuplicate, matchPresetHint, monthlyCanonicalAnchor, nextPaymentFromAnchor, type ToolSubscription } from "./queries.ts";
import { FOLLOW_UP_INTENTS, FOLLOW_UP_SUGGESTIONS, STARTER_SUGGESTIONS } from "./suggestions.ts";
import { explainReply } from "./explain.ts";

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

Deno.test("parses Korean amounts including 만원 and trailing digits", () => {
  if (parseWonAmount("3만원") !== 30000) throw new Error("3만원");
  if (parseWonAmount("3만") !== 30000) throw new Error("3만");
  if (parseWonAmount("30000원") !== 30000) throw new Error("30000원");
  if (parseWonAmount("홍티비 30000") !== 30000) throw new Error("홍티비 30000");
  if (parseWonAmount("홍티비30000원 등록") !== 30000) throw new Error("홍티비30000원 등록");
});

Deno.test("amount-only after create keeps the pending name", () => {
  const listed: ClassifiedIntent = { ...BASE, intent: "list_subscriptions", amount: 30000 };
  const got = refineIntent("3만원", listed, ["유튜브", "넷플릭스"], {
    last_intent: "create_subscription",
    last_name: "홍티비",
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 30000) throw new Error(String(got.amount));
});

Deno.test("amount correction after create keeps the pending name", () => {
  const got = refineIntent("아니, 금액은 18000원이야", { ...BASE, intent: "update_subscription", amount: 18000 }, [], {
    last_intent: "create_subscription",
    last_name: "홍티비",
    last_amount: 17000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 18000) throw new Error(String(got.amount));
});

Deno.test("name plus bare amount creates even without 등록", () => {
  const listed: ClassifiedIntent = { ...BASE, intent: "list_subscriptions", amount: 30000 };
  const got = refineIntent("홍티비 30000", listed, ["유튜브", "넷플릭스"]);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 30000) throw new Error(String(got.amount));
});

Deno.test("name plus amount plus 등록 still creates", () => {
  const got = refineIntent("홍티비 30000원 등록", { ...BASE }, ["유튜브"]);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 30000) throw new Error(String(got.amount));
});

Deno.test("amount before a calendar date still parses", () => {
  if (parseWonAmount("홍티비 20000원 10월 1일 등록") !== 20000) {
    throw new Error(String(parseWonAmount("홍티비 20000원 10월 1일 등록")));
  }
});

Deno.test("홍티비 20000원 10월 1일 등록 creates with amount and date", () => {
  const got = refineIntent("홍티비 20000원 10월 1일 등록", { ...BASE }, []);
  const expectedDate = parseKoreanDate("10월 1일");
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (!expectedDate || got.anchor_date !== expectedDate) throw new Error(String(got.anchor_date));
});

Deno.test("list-looking Gemini output still creates when 등록 and amount+date are present", () => {
  const listed: ClassifiedIntent = {
    ...BASE,
    intent: "list_subscriptions",
    period: { type: "calendar_month", days: null, year: 2026, month: 10 },
  };
  const got = refineIntent("홍티비 20000원 10월 1일 등록", listed, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.anchor_date !== parseKoreanDate("10월 1일")) throw new Error(String(got.anchor_date));
});

Deno.test("이하 keeps list lookup", () => {
  const got = refineIntent("3만원 이하", { ...BASE, intent: "list_subscriptions", amount: 30000 }, []);
  if (got.intent === "create_subscription") throw new Error("should not create");
});

Deno.test("박티비 추가 creates without 등록", () => {
  const got = refineIntent("박티비 추가", { ...BASE }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "박티비") throw new Error(String(got.service_name));
});

Deno.test("홍티비 2만원으로 변경 updates amount", () => {
  const got = refineIntent("홍티비 2만원으로 변경", { ...BASE }, ["홍티비", "유튜브"]);
  if (got.intent !== "update_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
});

Deno.test("결제일 10월 2일로 변경 after update keeps last name", () => {
  const guessed: ClassifiedIntent = { ...BASE, service_name: "결제일" };
  const got = refineIntent("결제일 10월 2일로 변경", guessed, ["홍티비", "유튜브"], {
    last_intent: "update_subscription",
    last_name: "홍티비",
  });
  const expected = parseKoreanDate("10월 2일");
  if (got.intent !== "update_subscription") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
  if (got.amount != null) throw new Error(String(got.amount));
  if (!expected || got.anchor_date !== expected) throw new Error(String(got.anchor_date));
});

Deno.test("유튜브 해지 is a cancellation guide", () => {
  const got = refineIntent("유튜브 해지", { ...BASE }, ["유튜브"]);
  if (got.intent !== "cancellation_guide") throw new Error(got.intent);
  if (got.service_name !== "유튜브") throw new Error(String(got.service_name));
});

Deno.test("name plus amount without date stays create with null date", () => {
  const got = refineIntent("스포티파이 20000원", { ...BASE }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "스포티파이") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.billing_cycle != null) throw new Error(String(got.billing_cycle));
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
});

Deno.test("매달 15일 after create fills date and keeps amount", () => {
  const got = refineIntent("매달 15일", { ...BASE, intent: "unknown" }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  const expected = monthlyCanonicalAnchor(15);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "스포티파이") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.billing_cycle !== "monthly") throw new Error(String(got.billing_cycle));
  if (!expected || got.anchor_date !== expected) throw new Error(String(got.anchor_date));
});

Deno.test("bare 15일 after create is monthly billing day", () => {
  const got = refineIntent("15일", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.billing_cycle !== "monthly") throw new Error(String(got.billing_cycle));
  if (got.anchor_date !== monthlyCanonicalAnchor(15)) throw new Error(String(got.anchor_date));
});

Deno.test("bare 15 after create keeps amount and leaves date empty", () => {
  const guessed: ClassifiedIntent = { ...BASE, amount: 15 };
  const got = refineIntent("15", guessed, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
    last_cycle: "monthly",
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "스포티파이") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
  if (parseCreateDayNumber("15") !== 15) throw new Error("day");
  if (parseCreateDayNumber("15일") !== 15) throw new Error("day labeled");
});

Deno.test("9 and 9월 after pending day stay create without filling date", () => {
  const guessed: ClassifiedIntent = { ...BASE, amount: 9 };
  for (const text of ["9", "9월"]) {
    const got = refineIntent(text, guessed, [], {
      last_intent: "create_subscription",
      last_name: "스포티파이",
      last_amount: 20000,
      last_cycle: "monthly",
      last_pending_day: 15,
    });
    if (got.intent !== "create_subscription") throw new Error(`${text} ${got.intent}`);
    if (got.amount !== 20000) throw new Error(`${text} ${got.amount}`);
    if (got.anchor_date != null) throw new Error(`${text} ${got.anchor_date}`);
  }
  if (parseCreateMonthNumber("9", { allowBare: true }) !== 9) throw new Error("bare month");
  if (parseCreateMonthNumber("9월") !== 9) throw new Error("labeled month");
  if (parseCreateMonthNumber("9") != null) throw new Error("bare month without flag");
  if (parseCreateMonthNumber("15", { allowBare: true }) != null) throw new Error("day is not month");
  if (calendarDateFromMonthDay(2, 31) != null) throw new Error("invalid calendar");
  const combined = calendarDateFromMonthDay(9, 15);
  if (!combined || !combined.endsWith("-09-15")) throw new Error(String(combined));
});

Deno.test("넷플릭스 월 17000원 매달 25일 등록 has date", () => {
  const got = refineIntent("넷플릭스 월 17000원 매달 25일 등록", { ...BASE }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "넷플릭스") throw new Error(String(got.service_name));
  if (got.amount !== 17000) throw new Error(String(got.amount));
  if (got.billing_cycle !== "monthly") throw new Error(String(got.billing_cycle));
  if (got.anchor_date !== monthlyCanonicalAnchor(25)) throw new Error(String(got.anchor_date));
});

Deno.test("invalid 2월 31일 after create keeps amount and no date", () => {
  const got = refineIntent("2월 31일", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
  if (parseKoreanDate("2월 31일") != null) throw new Error("should not parse");
  if (parseBillingDate("2월 31일") != null) throw new Error("should not parse billing");
});

Deno.test("create confirm reply includes billing day", () => {
  const reply = explainReply({
    facts: {
      action: "create",
      name: "스포티파이",
      amount: 20000,
      billing_cycle: "monthly",
      anchor_date: "2026-01-15",
      next_payment_date: "2026-09-15",
    },
    style: "confirm",
  });
  if (!reply.includes("매월 15일")) throw new Error(reply);
  if (!reply.includes("월 20,000원")) throw new Error(reply);
  if (!reply.includes("2026년 9월 15일")) throw new Error(reply);
});

Deno.test("연 120000원 after name is yearly without date", () => {
  const got = refineIntent("연 120000원", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "넷플릭스",
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (parseSpokenCycle("연 120000원") !== "yearly") throw new Error("cycle");
  if (got.billing_cycle !== "yearly") throw new Error(String(got.billing_cycle));
  if (got.amount !== 120000) throw new Error(String(got.amount));
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
});

Deno.test("monthly 31 keeps intended day after February", () => {
  const fromMar = new Date("2026-03-01T12:00:00+09:00");
  const fromSep = new Date("2026-09-02T12:00:00+09:00");
  const fromOct = new Date("2026-10-01T12:00:00+09:00");
  const mar = nextPaymentFromAnchor("2026-01-31", "monthly", fromMar);
  const sep = nextPaymentFromAnchor("2026-01-31", "monthly", fromSep);
  const oct = nextPaymentFromAnchor("2026-01-31", "monthly", fromOct);
  if (mar !== "2026-03-31") throw new Error(String(mar));
  if (sep !== "2026-09-30") throw new Error(String(sep));
  if (oct !== "2026-10-31") throw new Error(String(oct));
});

Deno.test("Gemini guessed monthly today is ignored for name plus amount", () => {
  const guessed: ClassifiedIntent = {
    ...BASE,
    intent: "create_subscription",
    service_name: "스포티파이",
    amount: 20000,
    billing_cycle: "monthly",
    anchor_date: "2026-09-02",
  };
  const got = refineIntent("스포티파이 20000원", guessed, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.billing_cycle != null) throw new Error(String(got.billing_cycle));
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
});

Deno.test("월간 10일 after create is monthly day 10", () => {
  const got = refineIntent("월간 10일", { ...BASE, intent: "unknown" }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "스포티파이") throw new Error(String(got.service_name));
  if (got.amount !== 20000) throw new Error(String(got.amount));
  if (got.billing_cycle !== "monthly") throw new Error(String(got.billing_cycle));
  if (got.anchor_date !== monthlyCanonicalAnchor(10)) throw new Error(String(got.anchor_date));
  if (parseBillingDate("월간 10일")?.cycle !== "monthly") throw new Error("parse");
});

Deno.test("매월 15일 after create fills monthly date", () => {
  const got = refineIntent("매월 15일", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.billing_cycle !== "monthly") throw new Error(String(got.billing_cycle));
  if (got.anchor_date !== monthlyCanonicalAnchor(15)) throw new Error(String(got.anchor_date));
  if (got.amount !== 20000) throw new Error(String(got.amount));
});

Deno.test("매주 금요일 after create is not a billing cycle", () => {
  const got = refineIntent("매주 금요일", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.billing_cycle != null) throw new Error(String(got.billing_cycle));
});

Deno.test("일회성 after create is one_time", () => {
  const got = refineIntent("일회성", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.billing_cycle !== "one_time") throw new Error(String(got.billing_cycle));
  if (got.amount !== 20000) throw new Error(String(got.amount));
});

Deno.test("일회성 9월 15일 after create fills date", () => {
  const got = refineIntent("일회성 9월 15일", { ...BASE }, [], {
    last_intent: "create_subscription",
    last_name: "스포티파이",
    last_amount: 20000,
  });
  if (got.billing_cycle !== "one_time") throw new Error(String(got.billing_cycle));
  if (!got.anchor_date || !got.anchor_date.endsWith("-09-15")) {
    throw new Error(String(got.anchor_date));
  }
});

Deno.test("parseBillingDate understands 오늘 결제했어 and next payment date", () => {
  const today = parseBillingDate("오늘 결제했어");
  if (!today?.date) throw new Error("today");
  const next = parseBillingDate("다음 결제일은 10월 3일");
  if (next?.date !== parseKoreanDate("10월 3일")) throw new Error(String(next?.date));
  const yearly = parseBillingDate("매년 9월 15일");
  if (yearly?.cycle !== "yearly") throw new Error(String(yearly?.cycle));
});

Deno.test("rejects malformed negative zero and approximate amounts", () => {
  if (parseWonAmount("2만원원") != null) throw new Error("double won");
  if (parseWonAmount("-20000원") != null) throw new Error("negative");
  if (parseWonAmount("0원") != null) throw new Error("zero");
  if (parseWonAmount("이만원쯤") != null) throw new Error("approx");
  if (parseWonAmount("2만원") !== 20000) throw new Error("valid man");
  if (spokenAmountIssue("2만원원") !== "malformed") throw new Error("issue malformed");
  if (spokenAmountIssue("-20000원") !== "negative") throw new Error("issue negative");
  if (spokenAmountIssue("0원") !== "zero") throw new Error("issue zero");
  if (spokenAmountIssue("이만원쯤") !== "approximate") throw new Error("issue approx");
});

Deno.test("adobe yearly sentence keeps service name and yearly cycle", () => {
  const text = "어도비 연 264,000원이고 매년 9월 18일에 결제돼. 등록해줘.";
  const name = createNameFromText(text);
  if (name !== "어도비") throw new Error(String(name));
  const got = refineIntent(text, { ...BASE, amount: 22000, billing_cycle: "monthly" }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "어도비") throw new Error(String(got.service_name));
  if (got.amount !== 264000) throw new Error(String(got.amount));
  if (got.billing_cycle !== "yearly") throw new Error(String(got.billing_cycle));
  if (got.anchor_date !== parseKoreanDate("9월 18일") && got.anchor_date !== parseBillingDate(text)?.date) {
    throw new Error(String(got.anchor_date));
  }
  if (matchPresetHint("어도비")?.category !== "work") throw new Error("preset");
});

Deno.test("invalid 32nd day after create stays create without date", () => {
  for (const text of ["매월 32일", "매일 32일", "32일"]) {
    const got = refineIntent(text, { ...BASE, intent: "unknown", amount: 32 }, [], {
      last_intent: "create_subscription",
      last_name: "스포티파이",
      last_amount: 10000,
      last_cycle: "monthly",
    });
    if (got.intent !== "create_subscription") throw new Error(`${text} ${got.intent}`);
    if (got.amount !== 10000) throw new Error(`${text} ${got.amount}`);
    if (got.anchor_date != null) throw new Error(`${text} ${got.anchor_date}`);
    if (invalidBillingDay(text) !== 32) throw new Error(`${text} day`);
  }
  if (parseSpokenCycle("매일 32일") !== "monthly") throw new Error("매일 cycle");
});

Deno.test("create confirm yearly reply uses yearly amount not monthly", () => {
  const reply = explainReply({
    facts: {
      action: "create",
      name: "어도비",
      amount: 264000,
      billing_cycle: "yearly",
      anchor_date: "2026-09-18",
      next_payment_date: "2026-09-18",
      monthly_equivalent: 22000,
    },
    style: "confirm",
  });
  if (!reply.includes("연 264,000원")) throw new Error(reply);
  if (!reply.includes("매년 9월 18일")) throw new Error(reply);
  if (!reply.includes("월 환산 22,000원")) throw new Error(reply);
  if (reply.includes("월 264,000원")) throw new Error(reply);
});

Deno.test("update confirm reply shows before and after amount", () => {
  const reply = explainReply({
    facts: {
      action: "update",
      name: "넷플릭스",
      previous_amount: 17000,
      amount: 19000,
    },
    style: "confirm",
  });
  if (!reply.includes("17,000원에서 19,000원")) throw new Error(reply);
});

Deno.test("변경해줘 is a confirm utterance", () => {
  if (!isConfirmUtterance("변경해줘")) throw new Error("confirm");
  if (isConfirmUtterance("넷플릭스 요금 19,000원으로 바꿔줘")) throw new Error("full update");
});

Deno.test("홍티비 구독 내역 보여줘 lists instead of creating", () => {
  if (createNameFromText("홍티비 구독 내역 보여줘") !== "홍티비") {
    throw new Error(String(createNameFromText("홍티비 구독 내역 보여줘")));
  }
  const created: ClassifiedIntent = { ...BASE, intent: "create_subscription", service_name: "홍티비" };
  const got = refineIntent("홍티비 구독 내역 보여줘", created, ["홍티비"], {
    last_intent: "create_subscription",
    last_name: "홍티비",
    last_amount: 20000,
    last_awaiting_duplicate: true,
  });
  if (got.intent !== "list_subscriptions") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
});

Deno.test("홍티비 보여줘 lists the named subscription", () => {
  const got = refineIntent("홍티비 보여줘", { ...BASE, intent: "create_subscription" }, ["홍티비"]);
  if (got.intent !== "list_subscriptions") throw new Error(got.intent);
  if (got.service_name !== "홍티비") throw new Error(String(got.service_name));
});

Deno.test("결제야 does not pollute the create name", () => {
  const spotify = "스포티파이 월 20000원이고 매월 10일 결제야. 등록해줘";
  if (createNameFromText(spotify) !== "스포티파이") {
    throw new Error(String(createNameFromText(spotify)));
  }
  const got = refineIntent(spotify, { ...BASE }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "스포티파이") throw new Error(String(got.service_name));

  const name = createNameFromText("크루드레그십 월 18000원이고 매월 14일 결제야. 등록해줘");
  if (name !== "크루드레그십") throw new Error(String(name));
  if (name?.includes("야")) throw new Error(String(name));
});

Deno.test("목록 is a list query without a service name", () => {
  const got = refineIntent("목록", { ...BASE, service_name: "목록" }, ["넷플릭스"]);
  if (got.intent !== "list_subscriptions") throw new Error(got.intent);
  if (got.service_name != null) throw new Error(String(got.service_name));
});

Deno.test("weekly briefing follow-up stays a read-only upcoming query", () => {
  const text = "이번 주 결제 예정 금액 389,800원이 어떤 구독으로 구성됐는지 구독별로 알려줘.";
  const got = refineIntent(text, { ...BASE, intent: "period_comparison" }, ["넷플릭스", "디즈니+"]);
  if (got.intent !== "upcoming_payments") throw new Error(got.intent);
  if (got.period.type !== "this_week") throw new Error(got.period.type);
});

Deno.test("없애줘 is cancellation_guide not delete", () => {
  const bare = refineIntent("없애줘", { ...BASE }, ["넷플릭스"]);
  if (bare.intent === "delete_subscription") throw new Error(bare.intent);
  if (bare.intent !== "cancellation_guide") throw new Error(bare.intent);
  const named = refineIntent("넷플릭스 없애줘", { ...BASE }, ["넷플릭스"]);
  if (named.intent !== "cancellation_guide") throw new Error(named.intent);
  if (named.service_name !== "넷플릭스") throw new Error(String(named.service_name));
});

Deno.test("아니 취소할게 rejects pending and 변경해줘 still confirms", () => {
  if (!isRejectUtterance("아니, 취소할게")) throw new Error("reject comma");
  if (!isRejectUtterance("취소할게")) throw new Error("cancel");
  if (!isRejectUtterance("그대로 둬")) throw new Error("keep");
  if (!isRejectUtterance("아니")) throw new Error("no");
  if (!isRejectUtterance("등록하지 마")) throw new Error("don't register");
  if (!isRejectUtterance("그만할게")) throw new Error("stop");
  if (!isRejectUtterance("됐어")) throw new Error("enough");
  if (!isRejectUtterance("그냥 둘게")) throw new Error("leave it");
  if (!isRejectUtterance("취소")) throw new Error("cancel bare");
  if (isRejectUtterance("변경해줘")) throw new Error("confirm is not reject");
  if (!isConfirmUtterance("변경해줘")) throw new Error("confirm");
  if (isConfirmUtterance("해줘")) throw new Error("bare 해줘 is not confirm");
  if (isRejectUtterance("아니, 금액은 18000원이야")) throw new Error("amount correct is not reject");
});

Deno.test("confirmation decision enum for pending replies", () => {
  if (classifyConfirmationDecision("아니, 취소할게") !== "reject") throw new Error("reject");
  if (classifyConfirmationDecision("등록해줘") !== "confirm") throw new Error("confirm");
  if (classifyConfirmationDecision("네") !== "confirm") throw new Error("yes");
  if (classifyConfirmationDecision("그렇게 해줘") !== "confirm") throw new Error("do so");
  if (classifyConfirmationDecision("아니, 금액은 18000원이야") !== "correct") throw new Error("amount");
  if (classifyConfirmationDecision("아니, 결제일은 20일이야") !== "correct") throw new Error("day");
  if (classifyConfirmationDecision("아니, 스포티파이가 아니라 멜론이야") !== "correct") throw new Error("rename");
  if (classifyConfirmationDecision("이번 달 얼마 나가?") !== "unrelated") throw new Error("unrelated");
  if (classifyConfirmationDecision("해줘") !== "unclear") throw new Error("unclear 해줘");
});

Deno.test("아니 on its own is duplicate-keep, not a field correction", () => {
  if (classifyConfirmationDecision("아니") !== "reject") throw new Error("bare no");
  if (isCorrectionUtterance("아니")) throw new Error("bare no is not correct");
});

Deno.test("duplicate choice keeps short yes/no deterministic", () => {
  if (classifyConfirmationDecision("네") !== "confirm") throw new Error("yes must add separately");
  if (!isDuplicateAffirmativeUtterance("네", true)) throw new Error("yes in duplicate state");
  if (isDuplicateAffirmativeUtterance("네", false)) throw new Error("yes outside duplicate state");
  if (!isDuplicateAffirmativeUtterance("좋아요", true)) throw new Error("natural affirmative");
  if (!isDuplicateSameUtterance("아니요")) throw new Error("no must keep existing");
  if (!isDuplicateSeparateUtterance("별도로 추가")) throw new Error("separate chip");
});

// 버그: "별도 구독"은 isConfirmUtterance 정확 매칭 목록에 없어 classifyConfirmationDecision이
// unclear로 판정한다. index.ts의 pendingReady 처리 중 awaitingDuplicate/awaitingAccount를
// 배제하지 않는 분기가 있으면, 이 "unclear" 판정이 그 분기를 가로채 초안(name 포함)을 날려버린다
// (실제 재현: 넷플릭스 중복 등록에서 "별도 구독" 선택 후 서비스명이 사라지고 엉뚱한 이름으로 등록됨).
// isDuplicateSeparateUtterance 자체는 정상 인식하므로, index.ts 쪽에서 반드시
// awaitingDuplicate/awaitingAccount 상태일 때 이 catch-all보다 먼저 처리해야 한다.
Deno.test("별도 구독 is not a clean confirm — awaitingDuplicate must intercept it first", () => {
  const decision = classifyConfirmationDecision("별도 구독");
  if (decision === "confirm" || decision === "reject") {
    throw new Error(`expected an ambiguous decision, got ${decision}`);
  }
  if (!isDuplicateSeparateUtterance("별도 구독")) throw new Error("separate utterance must still be recognized");
});

Deno.test("이번 달 얼마 나가 is monthly_total after a cancelled create", () => {
  const got = refineIntent("이번 달 얼마 나가?", { ...BASE }, ["넷플릭스"], { last_intent: null });
  if (got.intent !== "monthly_total") throw new Error(got.intent);
});

Deno.test("목록에서 삭제 is a duplicate-picker delete, 없애줘 is not", () => {
  if (!isDuplicateDeleteUtterance("목록에서 삭제")) throw new Error("list delete");
  if (!isDuplicateDeleteUtterance("삭제해줘")) throw new Error("delete please");
  if (isDuplicateDeleteUtterance("없애줘")) throw new Error("eopsae");
  if (isDuplicateDeleteUtterance("별도 구독")) throw new Error("separate");
});

Deno.test("after cancel-guide, 목록에서 삭제 keeps the last service name", () => {
  const got = refineIntent("목록에서 삭제", { ...BASE }, ["유튜브", "넷플릭스"], {
    last_intent: "cancellation_guide",
    last_name: "유튜브",
  });
  if (got.intent !== "delete_subscription") throw new Error(got.intent);
  if (got.service_name !== "유튜브") throw new Error(String(got.service_name));
});

Deno.test("parseAccountFromText reads labeled account and email", () => {
  if (parseAccountFromText("계정 a@x.com") !== "a@x.com") throw new Error("labeled");
  if (parseAccountFromText("foo@bar.com") !== "foo@bar.com") throw new Error("email");
  if (parseAccountFromText("netflix_id", true) !== "netflix_id") throw new Error("awaiting");
  if (parseAccountFromText("별도 구독") != null) throw new Error("separate chip");
});

Deno.test("계정을 물었을 때 회피성 답은 계정값으로 저장되지 않는다", () => {
  const dodges = ["없어", "없어요", "없음", "몰라", "건너뛰기", "패스", "그냥 등록", "나중에"];
  for (const text of dodges) {
    if (!isNonAnswerAccountUtterance(text)) throw new Error(`회피성 답으로 잡혀야 한다: ${text}`);
    if (parseAccountFromText(text, true) != null) {
      throw new Error(`계정값으로 새면 안 된다: ${text} -> ${parseAccountFromText(text, true)}`);
    }
  }
  // 진짜 계정처럼 보이는 답은 여전히 정상 파싱된다 (회귀 없음).
  if (isNonAnswerAccountUtterance("netflix_id")) throw new Error("실제 계정을 회피성 답으로 잡으면 안 된다");
  if (parseAccountFromText("netflix_id", true) !== "netflix_id") throw new Error("실제 계정 파싱 회귀");
  if (parseAccountFromText("chan@gmail.com", true) !== "chan@gmail.com") throw new Error("이메일 파싱 회귀");
});

Deno.test("계정을 물었을 때 진짜 취소 발화와 회피성 답은 서로 겹치지 않는다", () => {
  // "없어" 류는 재질문 대상이지 취소가 아니다 — 등록 자체를 그만두는 게 아니라
  // 계정을 다시 물어야 한다. isRejectUtterance와 겹치면 index.ts의 취소 분기가
  // 먼저 가로채 재질문 로직이 죽는다.
  const dodges = ["없어", "없어요", "없음", "몰라", "건너뛰기", "패스", "그냥 등록", "나중에"];
  for (const text of dodges) {
    if (isRejectUtterance(text)) throw new Error(`회피성 답이 취소로도 잡히면 안 된다: ${text}`);
  }
  // 반대로 진짜 취소 발화는 회피성 답 목록에 없어야, 등록 전체를 초기화하는 분기로
  // 정확히 간다(재질문 루프에 갇히지 않는다).
  const cancels = ["취소", "취소할게", "아니", "됐어", "그만할게", "안할래"];
  for (const text of cancels) {
    if (!isRejectUtterance(text)) throw new Error(`취소 발화로 잡혀야 한다: ${text}`);
    if (isNonAnswerAccountUtterance(text)) throw new Error(`취소 발화가 회피성 답으로도 잡히면 안 된다: ${text}`);
  }
});

Deno.test("same account is taken only among the provided same-service siblings", () => {
  const netflix = { account_id: "a@x.com" } as ToolSubscription;
  if (!accountTakenByDuplicate([netflix], "a@x.com")) throw new Error("same service taken");
  if (accountTakenByDuplicate([], "a@x.com")) throw new Error("watcha list empty");
});

Deno.test("strips object particles from spoken create names", () => {
  const au = "호주 티비를 연 1999원 매년 10월 15일 결제 등록";
  if (createNameFromText(au) !== "호주 티비") throw new Error(String(createNameFromText(au)));
  if (createNameFromText("넷플릭스를 등록해줘") !== "넷플릭스") {
    throw new Error(String(createNameFromText("넷플릭스를 등록해줘")));
  }
  if (cleanServiceName("호주 티비를") !== "호주 티비") throw new Error(String(cleanServiceName("호주 티비를")));
  const got = refineIntent(au, { ...BASE, service_name: "호주 티비를", amount: 1999, billing_cycle: "yearly" }, []);
  if (got.service_name !== "호주 티비") throw new Error(String(got.service_name));
});

Deno.test("stray comma from amount/date clause does not leak into the create name", () => {
  // 버그: "웨이브 7900원, 매월 8일. 구독 등록해줘"에서 금액·날짜 구절만 지우면
  // 그 사이 쉼표가 그대로 남아 서비스명이 "웨이브,"로 저장됐다.
  const text = "웨이브 7900원, 매월 8일. 구독 등록해줘";
  if (createNameFromText(text) !== "웨이브") {
    throw new Error(String(createNameFromText(text)));
  }
  if (cleanServiceName("웨이브,") !== "웨이브") throw new Error(String(cleanServiceName("웨이브,")));
});

Deno.test("user-typed '구독명 : X' label prefix does not leak into the create name", () => {
  // 버그: AI가 더 잘 알아듣게 하려고 "구독명 : 우리하나"라고 스스로 라벨을 붙여 말했는데,
  // 그 라벨(" 구독명 : ")이 그대로 이름에 남아 "구독명 : 우리하나"로 저장됐다.
  if (createNameFromText("구독명 : 우리하나") !== "우리하나") {
    throw new Error(String(createNameFromText("구독명 : 우리하나")));
  }
  if (cleanServiceName("구독명 : 우리하나") !== "우리하나") {
    throw new Error(String(cleanServiceName("구독명 : 우리하나")));
  }
  if (cleanServiceName("서비스명:넷플릭스") !== "넷플릭스") {
    throw new Error(String(cleanServiceName("서비스명:넷플릭스")));
  }
  if (cleanServiceName("이름 : 디즈니플러스") !== "디즈니플러스") {
    throw new Error(String(cleanServiceName("이름 : 디즈니플러스")));
  }
});

Deno.test("trial marker particles do not leak into the create name", () => {
  const text = "멜론 무료체험으로 18일 구독 등록해줘";
  if (createNameFromText(text) !== "멜론") {
    throw new Error(String(createNameFromText(text)));
  }

  const got = refineIntent(text, { ...BASE }, []);
  if (got.intent !== "create_subscription") throw new Error(got.intent);
  if (got.service_name !== "멜론") throw new Error(String(got.service_name));
  if (got.is_trial !== true) throw new Error(String(got.is_trial));
});

Deno.test("trial-to-paid transition wording (유료일/결제 시작) does not leak into the create name", () => {
  // 버그: "하나 무료체험 15000원 월간 9월 18일 유료일 결제 시작"을 그대로 등록하면
  // 서비스명이 "하나 유료일 시작"으로 저장됐다. "결제" 전용 스트리퍼가 "결제"만 지우고
  // 뒤에 붙은 "시작"을 고아로 남기는 게 원인이었다.
  const text = "하나 무료체험 15000원 월간 9월 18일 유료일 결제 시작";
  if (createNameFromText(text) !== "하나") {
    throw new Error(String(createNameFromText(text)));
  }
});

Deno.test("parseRelativeDayWord resolves 내일/모레/글피/요일 relative to a fixed now", () => {
  // 고정 시각: 2026-09-17(목요일) 낮 12시 KST.
  const now = new Date("2026-09-17T12:00:00+09:00");
  if (parseRelativeDayWord("내일", now) !== "2026-09-18") {
    throw new Error(String(parseRelativeDayWord("내일", now)));
  }
  if (parseRelativeDayWord("모레", now) !== "2026-09-19") {
    throw new Error(String(parseRelativeDayWord("모레", now)));
  }
  if (parseRelativeDayWord("글피", now) !== "2026-09-20") {
    throw new Error(String(parseRelativeDayWord("글피", now)));
  }
  // 목요일 기준 "이번주 금요일"은 아직 지나지 않은 이번주 금요일.
  if (parseRelativeDayWord("이번주 금요일", now) !== "2026-09-18") {
    throw new Error(String(parseRelativeDayWord("이번주 금요일", now)));
  }
  // 목요일 기준 "다음주 월요일"은 이번주 월요일(이미 지남)의 다음 발생일 + 7일.
  if (parseRelativeDayWord("다음주 월요일", now) !== "2026-09-28") {
    throw new Error(String(parseRelativeDayWord("다음주 월요일", now)));
  }
  if (parseRelativeDayWord("그냥 텍스트", now) !== null) {
    throw new Error(String(parseRelativeDayWord("그냥 텍스트", now)));
  }
});

Deno.test("relative day words in a create sentence don't leak into the service name", () => {
  const text1 = "웨이브 7900원 내일부터 매월 결제 등록해줘";
  if (createNameFromText(text1) !== "웨이브") {
    throw new Error(String(createNameFromText(text1)));
  }
  const text2 = "넷플릭스 17000원 다음주 월요일 등록해줘";
  if (createNameFromText(text2) !== "넷플릭스") {
    throw new Error(String(createNameFromText(text2)));
  }
});

Deno.test("refineIntent resolves 내일/다음주 O요일 into anchor_date for create_subscription", () => {
  const tomorrow = "웨이브 7900원 내일 등록해줘";
  const got1 = refineIntent(tomorrow, { ...BASE }, []);
  if (got1.intent !== "create_subscription") throw new Error(got1.intent);
  if (got1.service_name !== "웨이브") throw new Error(String(got1.service_name));
  if (got1.anchor_date !== parseRelativeDayWord("내일")) {
    throw new Error(String(got1.anchor_date));
  }

  const nextMonday = "넷플릭스 17000원 다음주 월요일 등록해줘";
  const got2 = refineIntent(nextMonday, { ...BASE }, []);
  if (got2.intent !== "create_subscription") throw new Error(got2.intent);
  if (got2.service_name !== "넷플릭스") throw new Error(String(got2.service_name));
  if (got2.anchor_date !== parseRelativeDayWord("다음주 월요일")) {
    throw new Error(String(got2.anchor_date));
  }
});

Deno.test("create confirm uses 를 for 호주 티비 not 를을", () => {
  const reply = explainReply({
    facts: {
      action: "create",
      name: "호주 티비",
      amount: 1999,
      billing_cycle: "yearly",
      anchor_date: "2026-10-15",
      next_payment_date: "2026-10-15",
      monthly_equivalent: 167,
    },
    style: "confirm",
  });
  if (!reply.includes('"호주 티비"를 연 1,999원')) throw new Error(reply);
  if (reply.includes("를을") || reply.includes("호주 티비를을")) throw new Error(reply);
});

Deno.test("quoted names keep 을/를 from the hangul not the quote", () => {
  const melon = explainReply({
    facts: { action: "delete", name: "멜론" },
    style: "confirm",
  });
  if (!melon.includes('"멜론"을 목록에서 삭제할까요?')) throw new Error(melon);
  const youtube = explainReply({
    facts: { action: "delete", name: "유튜브" },
    style: "confirm",
  });
  if (!youtube.includes('"유튜브"를 목록에서 삭제할까요?')) throw new Error(youtube);
});

Deno.test("parseBillingDate reads 결제일 N일 without treating it as an amount", () => {
  const cases = [
    "유튜브 결제일을 25일로 바꿔줘",
    "결제일 25일로 변경",
    "결제 날짜를 25일로 변경해줘",
  ];
  for (const text of cases) {
    const parsed = parseBillingDate(text);
    if (parsed?.day !== 25) throw new Error(`${text} day=${parsed?.day}`);
    const got = refineIntent(text, { ...BASE, amount: 14900, anchor_date: "2026-01-01" }, ["유튜브"]);
    if (got.intent !== "update_subscription") throw new Error(`${text} intent=${got.intent}`);
    if (got.amount != null) throw new Error(`${text} amount=${got.amount}`);
    if (got.anchor_date == null || Number(got.anchor_date.slice(8, 10)) !== 25) {
      throw new Error(`${text} anchor=${got.anchor_date}`);
    }
  }
});

Deno.test("calendar 결제일 10월 2일 wins over 결제일+N일", () => {
  const parsed = parseBillingDate("결제일 10월 2일로 변경");
  if (parsed?.date?.slice(5) !== "10-02") throw new Error(String(parsed?.date));
});

Deno.test("bare 25일 after update ask is a day not 25원", () => {
  const got = refineIntent("25일", { ...BASE, amount: 25000 }, ["유튜브"], {
    last_intent: "update_subscription",
    last_name: "유튜브",
    last_amount: 14900,
    last_awaiting_update: "billing_day",
  });
  if (got.intent !== "update_subscription") throw new Error(got.intent);
  if (got.amount != null) throw new Error(String(got.amount));
  if (got.anchor_date == null || Number(got.anchor_date.slice(8, 10)) !== 25) {
    throw new Error(String(got.anchor_date));
  }
});

Deno.test("32일 is an invalid billing day and does not update", () => {
  if (invalidBillingDay("유튜브 결제일을 32일로 바꿔줘") !== 32) {
    throw new Error(String(invalidBillingDay("유튜브 결제일을 32일로 바꿔줘")));
  }
  const parsed = parseBillingDate("유튜브 결제일을 32일로 바꿔줘");
  if (parsed != null) throw new Error(JSON.stringify(parsed));
  const got = refineIntent("유튜브 결제일을 32일로 바꿔줘", { ...BASE, amount: 14900 }, ["유튜브"]);
  if (got.intent !== "update_subscription") throw new Error(got.intent);
  if (got.anchor_date != null) throw new Error(String(got.anchor_date));
  if (got.amount != null) throw new Error(String(got.amount));
});

Deno.test("completed update amount is not reused on a new value-less update", () => {
  const got = refineIntent("넷플릭스 금액 바꿔줘", { ...BASE, amount: 22000 }, ["넷플릭스"], {
    last_intent: "update_subscription",
    last_name: "넷플릭스",
    last_amount: 22000,
  });
  if (got.intent !== "update_subscription") throw new Error(got.intent);
  if (got.amount != null) throw new Error(String(got.amount));
  if (got.service_name !== "넷플릭스") throw new Error(String(got.service_name));
});

Deno.test("update date confirm has no quotes and names both days", () => {
  const reply = explainReply({
    facts: {
      action: "update",
      name: "유튜브",
      previous_anchor_date: "2026-01-21",
      anchor_date: "2026-01-25",
      billing_cycle: "monthly",
      previous_billing_cycle: "monthly",
    },
    style: "confirm",
  });
  if (reply.includes('"유튜브"')) throw new Error(reply);
  if (!reply.includes("유튜브 결제일을 매월 21일에서 매월 25일로 변경할까요?")) throw new Error(reply);
});

Deno.test("실제 해지 완료 발화는 삭제가 아닌 해지 생명주기 변경이다", () => {
  for (const text of ["넷플릭스 해지했어", "넷플릭스 해지 완료했어요"]) {
    const got = refineIntent(text, { ...BASE }, ["넷플릭스"]);
    if (got.intent !== "lifecycle_update") throw new Error(`${text}: ${got.intent}`);
    if (got.lifecycle_status !== "cancel_requested") {
      throw new Error(`${text}: ${String(got.lifecycle_status)}`);
    }
    if (got.service_name !== "넷플릭스") throw new Error(`${text}: ${String(got.service_name)}`);
  }
});

Deno.test("현황·내역이 붙은 카테고리 질문도 category_analysis다", () => {
  for (const text of [
    "카테고리 현황 보여줘",
    "카테고리 현황",
    "카테고리 내역",
    "카테고리별 지출 보여줘",
    "카테고리 보여줘",
    "카테고리별 분석",
  ]) {
    const got = refineIntent(text, { ...BASE }, ["넷플릭스", "디즈니+"]);
    if (got.intent !== "category_analysis") throw new Error(`${text}: ${got.intent}`);
  }
});

Deno.test("카테고리 질문이 목록·결제예정 조회를 가로채지 않는다", () => {
  const list = refineIntent("구독 목록 보여줘", { ...BASE }, ["넷플릭스"]);
  if (list.intent !== "list_subscriptions") throw new Error(list.intent);
  const total = refineIntent("이번 달 얼마 나가?", { ...BASE }, ["넷플릭스"]);
  if (total.intent !== "monthly_total") throw new Error(total.intent);
});

Deno.test("추천 명령어는 모두 의도한 intent로 분류된다", () => {
  for (const item of STARTER_SUGGESTIONS) {
    const got = refineIntent(item.label, { ...BASE }, ["넷플릭스", "디즈니+"]);
    if (got.intent !== item.intent) {
      throw new Error(`${item.label}: ${got.intent} (기대 ${item.intent})`);
    }
    // 등록 문구에 이름이 새어 들어가면 그 문장이 구독 이름이 된다.
    if (item.expectsNoServiceName && got.service_name != null) {
      throw new Error(`${item.label}: service_name=${got.service_name}`);
    }
  }

  for (const [intent, labels] of Object.entries(FOLLOW_UP_SUGGESTIONS)) {
    if (labels.length === 0) throw new Error(`${intent}: 후속 추천이 비어 있다`);
    for (const label of labels) {
      const expected = FOLLOW_UP_INTENTS[label];
      if (!expected) throw new Error(`${label}: FOLLOW_UP_INTENTS에 기대 의도가 없다`);
      const got = refineIntent(label, { ...BASE }, ["넷플릭스", "디즈니+"]);
      if (got.intent !== expected) throw new Error(`${label}: ${got.intent} (기대 ${expected})`);
    }
  }
});

Deno.test("앱·웹 추천 목록이 정본과 어긋나지 않는다", async () => {
  const canonicalStarters = STARTER_SUGGESTIONS.map((item) => item.label);
  const copies = [
    await import("../../../constants/assistant-suggestions.ts"),
    await import("../../../web/src/lib/assistant-suggestions.ts"),
  ];

  for (const copy of copies) {
    if (JSON.stringify(copy.STARTER_SUGGESTIONS) !== JSON.stringify(canonicalStarters)) {
      throw new Error(`시작 추천 불일치: ${JSON.stringify(copy.STARTER_SUGGESTIONS)}`);
    }
    if (JSON.stringify(copy.FOLLOW_UP_SUGGESTIONS) !== JSON.stringify(FOLLOW_UP_SUGGESTIONS)) {
      throw new Error(`맥락 추천 불일치: ${JSON.stringify(copy.FOLLOW_UP_SUGGESTIONS)}`);
    }
  }
});

Deno.test("주기·갱신 표현이 날짜 뒤에 와도 서비스명에 섞이지 않는다", () => {
  const cases: [string, string, string | null, string | null][] = [
    // 발화, 기대 이름, 기대 주기, 기대 결제일
    ["노션 5000원 11일 매월 갱신", "노션", "monthly", monthlyCanonicalAnchor(11)],
    ["노션 5000원 11일에 매월 갱신", "노션", "monthly", monthlyCanonicalAnchor(11)],
    ["노션 5000원 11일 매달 결제", "노션", "monthly", monthlyCanonicalAnchor(11)],
    // 주기가 모호한 「자동 갱신」은 이름만 정리하고 주기는 되묻는다.
    ["노션 5000원 11일 자동 갱신", "노션", null, null],
  ];

  for (const [text, name, cycle, anchor] of cases) {
    const got = refineIntent(text, { ...BASE }, []);
    if (got.intent !== "create_subscription") throw new Error(`${text}: ${got.intent}`);
    if (got.service_name !== name) throw new Error(`${text}: 이름 ${String(got.service_name)}`);
    if (got.billing_cycle !== cycle) throw new Error(`${text}: 주기 ${String(got.billing_cycle)}`);
    if (got.anchor_date !== anchor) throw new Error(`${text}: 결제일 ${String(got.anchor_date)}`);
  }
});

Deno.test("주기어 제거가 이름에 든 같은 글자를 깎지 않는다", () => {
  const got = refineIntent("매일유업 5000원 매월 11일", { ...BASE }, []);
  if (got.service_name !== "매일유업") throw new Error(String(got.service_name));

  // 주기어가 날짜 앞에 오는 기존 표현과 달력 날짜는 그대로 동작한다.
  const monthly = refineIntent("넷플릭스 17000원 매월 25일 등록", { ...BASE }, []);
  if (monthly.service_name !== "넷플릭스" || monthly.billing_cycle !== "monthly") {
    throw new Error(JSON.stringify(monthly));
  }
  const yearly = refineIntent("어도비 120000원 매년 3월 5일", { ...BASE }, []);
  if (yearly.service_name !== "어도비" || yearly.billing_cycle !== "yearly") {
    throw new Error(JSON.stringify(yearly));
  }
});

Deno.test("Gemini가 지출 질문을 서비스명으로 잘못 뽑아도 monthly_total로 분류된다", () => {
  // "이번 달 얼마 나가?"를 Gemini가 헷갈려 service_name에 문장 전체를 넣어 보내는 경우 —
  // 실제로 이 응답 때문에 "정확한 결제 금액을 알려 주세요"라는 등록 흐름 되묻기가 나왔었다.
  const gotWrongGuess = refineIntent(
    "이번 달 얼마 나가?",
    { ...BASE, intent: "create_subscription", service_name: "이번 달 얼마 나가" },
    ["디즈니+"],
  );
  if (gotWrongGuess.intent !== "monthly_total") throw new Error(gotWrongGuess.intent);

  const gotNextMonth = refineIntent(
    "다음 달 얼마 나가?",
    { ...BASE, intent: "create_subscription", service_name: "다음 달 얼마 나가" },
    ["디즈니+"],
  );
  if (gotNextMonth.intent !== "monthly_total") throw new Error(gotNextMonth.intent);

  // 실제 구독명을 지목한 경우는 여전히 그 이름으로 매칭된다(회귀 없음).
  const gotRealMatch = refineIntent("넷플릭스 5000원 등록해줘", { ...BASE }, ["디즈니+"]);
  if (gotRealMatch.intent !== "create_subscription" || gotRealMatch.service_name !== "넷플릭스") {
    throw new Error(JSON.stringify(gotRealMatch));
  }
});

Deno.test("parseClassifiedIntent parses and clamps confidence", () => {
  const withValue = parseClassifiedIntent({ intent: "unknown", confidence: 0.3 });
  if (withValue.confidence !== 0.3) throw new Error(String(withValue.confidence));

  const outOfRange = parseClassifiedIntent({ intent: "unknown", confidence: 1.7 });
  if (outOfRange.confidence !== 1) throw new Error(String(outOfRange.confidence));

  const negative = parseClassifiedIntent({ intent: "unknown", confidence: -0.2 });
  if (negative.confidence !== 1) throw new Error(String(negative.confidence));

  const missing = parseClassifiedIntent({ intent: "unknown" });
  if (missing.confidence !== 1) throw new Error(String(missing.confidence));

  const notANumber = parseClassifiedIntent({ intent: "unknown", confidence: "낮음" });
  if (notANumber.confidence !== 1) throw new Error(String(notANumber.confidence));
});

Deno.test("rule-based reclassification forces confidence to 1", () => {
  // LLM이 낮은 확신도로 준 값이라도, 정규식 키워드로 명확히 재분류되면 확신도를 1로 올린다 —
  // 이래야 index.ts의 confidence 게이트가 이미 규칙으로 확정된 케이스를 다시 되묻지 않는다.
  const lowConfidenceGuess: ClassifiedIntent = { ...BASE, confidence: 0.2 };

  const cancelGuide = refineIntent("넷플릭스 해지 방법 알려줘", lowConfidenceGuess, []);
  if (cancelGuide.intent !== "cancellation_guide") throw new Error(cancelGuide.intent);
  if (cancelGuide.confidence !== 1) throw new Error(String(cancelGuide.confidence));

  const create = refineIntent("웨이브 7900원 매월 8일 등록해줘", lowConfidenceGuess, []);
  if (create.intent !== "create_subscription") throw new Error(create.intent);
  if (create.confidence !== 1) throw new Error(String(create.confidence));
});
