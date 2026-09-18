import { quotedServiceName, withObjectParticle } from "./gemini-intent.ts";

type Facts = Record<string, unknown>;

const FALLBACK = "확인했어요.";

type ListedSub = {
  name: string;
  amount?: number;
  monthly_amount?: number;
  next_payment_date?: string;
  category?: string;
};

/** 조회·확인·재질문은 DB 사실로 문장을 만든다. 조회 unknown만 Claude 폴백. */
export function explainReply(input: {
  userText?: string;
  facts: Facts;
  style: "query" | "confirm" | "clarify";
}): string {
  return fallbackReply(input.style, input.facts, input.userText);
}

function won(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function billingDateLabel(anchor: unknown, cycle: unknown): string | null {
  if (typeof anchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const [, month, day] = anchor.split("-");
  if (cycle === "monthly") return `매월 ${Number(day)}일`;
  if (cycle === "yearly") return `매년 ${Number(month)}월 ${Number(day)}일`;
  if (cycle === "one_time") return `${Number(month)}월 ${Number(day)}일`;
  return `${Number(month)}월 ${Number(day)}일`;
}

function longDate(iso: unknown): string | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-");
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

function cycleAmountLabel(cycle: unknown, amount: number): string {
  if (cycle === "yearly") return `연 ${won(amount)}`;
  if (cycle === "one_time") return `일회 ${won(amount)}`;
  return `월 ${won(amount)}`;
}

function listedSubscriptions(facts: Facts): ListedSub[] {
  const rows = facts.subscriptions;
  if (!Array.isArray(rows)) return [];
  const out: ListedSub[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name) continue;
    out.push({
      name: item.name,
      amount: typeof item.amount === "number" ? item.amount : undefined,
      monthly_amount: typeof item.monthly_amount === "number" ? item.monthly_amount : undefined,
      next_payment_date: typeof item.next_payment_date === "string" ? item.next_payment_date : undefined,
      category: typeof item.category === "string" && item.category ? item.category : undefined,
    });
  }
  return out;
}

function formatListed(item: ListedSub): string {
  const price = item.monthly_amount ?? item.amount;
  const parts = [item.name];
  if (item.category) parts.push(item.category);
  if (typeof price === "number") parts.push(won(price));
  if (item.next_payment_date && /^\d{4}-\d{2}-\d{2}$/.test(item.next_payment_date)) {
    const [, month, day] = item.next_payment_date.split("-");
    parts.push(`${Number(month)}/${Number(day)}`);
  }
  return parts.join(" · ");
}

function listHeader(facts: Facts, count: number): string {
  if (typeof facts.summary === "string" && facts.summary) return facts.summary;
  const period = typeof facts.period_label === "string" && facts.period_label ? facts.period_label : null;
  if (period) return `${period} 결제 예정 구독 ${count}개예요.`;
  return `구독 ${count}개예요.`;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function monthlyTotalReply(facts: Facts, userText?: string): string {
  const equivalent = asNumber(facts.monthly_equivalent) ?? asNumber(facts.monthly_total);
  if (equivalent == null) return FALLBACK;

  const elapsedEstimate = asNumber(facts.month_payment_total);
  const expected = asNumber(facts.month_expected_total) ??
    (elapsedEstimate == null ? null : elapsedEstimate + (asNumber(facts.month_scheduled) ?? 0));
  const recurring = asNumber(facts.month_expected_recurring) ?? asNumber(facts.month_payment_recurring);
  const oneTime = asNumber(facts.month_expected_one_time) ?? asNumber(facts.month_payment_one_time);
  const refunds = asNumber(facts.month_refunds) ?? 0;
  const scheduled = asNumber(facts.month_scheduled) ?? 0;
  const nextMonthExpected = asNumber(facts.next_month_expected_total);
  const asksNextMonth = typeof userText === "string" && /다음\s*달/.test(userText);
  const asksPayment = typeof userText === "string" &&
    /결제 총액|예상 결제|얼마.*나가|실제로 나간|실제 결제|이번 달 낸/.test(userText);

  const split = recurring != null && oneTime != null && (recurring > 0 || oneTime > 0)
    ? ` (정기 ${won(recurring)} + 일회성 ${won(oneTime)})`
    : "";
  const equivalentLine = `월평균 구독 지출액은 ${won(equivalent)}이에요.`;
  const expectedLine = expected != null
    ? `등록된 결제 일정 기준 이번 달 예상 지출액은 ${won(expected)}이에요.${split}`
    : null;

  if (asksNextMonth && nextMonthExpected != null) {
    return `등록된 결제 일정 기준 다음 달 예상 지출액은 ${won(nextMonthExpected)}이에요. 실제 결제 내역과 다를 수 있어요.`;
  }

  const parts: string[] = asksPayment && expectedLine
    ? [expectedLine, equivalentLine]
    : expectedLine && expected !== equivalent
      ? [equivalentLine, expectedLine]
      : [equivalentLine];

  if (refunds > 0) parts.push(`환불 ${won(refunds)}을 빼 반영했어요.`);
  if (scheduled > 0) parts.push(`예상 지출액 중 아직 날짜가 오지 않은 금액은 ${won(scheduled)}이에요.`);
  if (oneTime && oneTime > 0) {
    parts.push("월평균 구독 지출액은 정기 비용만 계산하고, 일회성 결제는 등록된 결제 월의 예상 지출액에만 포함해요.");
  }
  return parts.join(" ");
}

function fallbackReply(style: "query" | "confirm" | "clarify", facts: Facts, userText?: string): string {
  if (style === "clarify") {
    if (typeof facts.message === "string" && facts.message) return facts.message;
    if (typeof facts.summary === "string" && facts.summary) return facts.summary;
    return "어떤 구독을 말씀하시는지 조금 더 구체적으로 알려 주세요.";
  }
  if (style === "confirm") {
    const name = typeof facts.name === "string" ? facts.name : "이 구독";
    const quoted = quotedServiceName(name);
    const amount = typeof facts.amount === "number" ? ` ${won(facts.amount)}` : "";
    const action = facts.action;
    if (facts.usage_response) return `${quoted} 사용 여부를 이렇게 기록할까요?`;
    if (action === "create") {
      const dateLabel = billingDateLabel(facts.anchor_date, facts.billing_cycle);
      if (dateLabel && typeof facts.amount === "number") {
        const nextLabel = longDate(facts.next_payment_date);
        const nextBit = facts.billing_cycle === "one_time" || !nextLabel
          ? ""
          : ` 다음 결제 예정일은 ${nextLabel}이에요.`;
        const monthlyBit = facts.billing_cycle === "yearly" && typeof facts.monthly_equivalent === "number"
          ? ` 월 환산 ${won(facts.monthly_equivalent)}.`
          : "";
        const shortBit = facts.short_month_note === true
          ? " 29~31일은 짧은 달이면 말일에 맞춰 계산해요."
          : "";
        const trialBit = facts.trial_forced_monthly === true
          ? " 무료 체험은 일회성으로 등록할 수 없어서 월간으로 바꿨어요."
          : "";
        return `${withObjectParticle(name)} ${cycleAmountLabel(facts.billing_cycle, facts.amount)}, ${dateLabel} 결제로 등록할까요?${nextBit}${monthlyBit}${shortBit}${trialBit}`;
      }
      return `${withObjectParticle(name)}${amount} 이렇게 등록할까요?`;
    }
    if (action === "update") {
      const prevAmt = typeof facts.previous_amount === "number" ? facts.previous_amount : null;
      const nextAmt = typeof facts.amount === "number" ? facts.amount : null;
      const amountChanged = prevAmt != null && nextAmt != null && prevAmt !== nextAmt;
      const prevDate = billingDateLabel(facts.previous_anchor_date, facts.previous_billing_cycle ?? facts.billing_cycle);
      const nextDate = billingDateLabel(facts.anchor_date, facts.billing_cycle);
      const dateChanged = Boolean(prevDate && nextDate && prevDate !== nextDate);
      if (amountChanged && dateChanged) {
        return `${name} 요금을 ${cycleAmountLabel(facts.billing_cycle, prevAmt)}에서 ${cycleAmountLabel(facts.billing_cycle, nextAmt)}으로, 결제일을 ${prevDate}에서 ${nextDate}로 변경할까요?`;
      }
      if (amountChanged) {
        return `${name} 요금을 ${cycleAmountLabel(facts.previous_billing_cycle ?? facts.billing_cycle, prevAmt)}에서 ${won(nextAmt)}으로 변경할까요?`;
      }
      if (dateChanged) {
        return `${name} 결제일을 ${prevDate}에서 ${nextDate}로 변경할까요?`;
      }
      if (typeof facts.message === "string" && facts.message) return facts.message;
      return `${name}을 이렇게 바꿀까요?`;
    }
    if (action === "delete") return `${withObjectParticle(name)} 목록에서 삭제할까요?`;
    if (action === "pause") return `${withObjectParticle(name)} 일시정지할까요?`;
    if (action === "resume") return `${withObjectParticle(name)} 다시 시작할까요?`;
    if (action === "lifecycle") {
      const to = typeof facts.lifecycle_status === "string" ? facts.lifecycle_status : "";
      if (to === "guide_reviewed") return `${quoted} 해지 안내를 확인한 것으로 기록할까요?`;
      if (to === "cancel_requested") return `${quoted}를 실제로 해지한 것으로 기록할까요? 이용 종료일까지 목록에 유지한 뒤 자동으로 종료합니다.`;
      if (to === "ended") return `${quoted} 이용이 끝난 것으로 확인할까요?`;
      if (to === "active") return `${quoted}가 아직 결제되고 있다면 해지 진행을 되돌릴까요?`;
      return `${quoted} 해지 상태를 이렇게 바꿀까요?`;
    }
    if (typeof facts.summary === "string" && facts.summary) return facts.summary;
    return `${withObjectParticle(name)} 적용할까요?`;
  }
  if (facts.comparable === false) {
    return typeof facts.summary === "string" && facts.summary
      ? facts.summary
      : "아직 가격 이력이 없어 기간을 비교할 수 없어요.";
  }
  if (facts.comparable === true && typeof facts.current_total === "number" && typeof facts.previous_total === "number") {
    const delta = Number(facts.delta) || facts.current_total - facts.previous_total;
    const months = typeof facts.months === "number" ? facts.months : 1;
    const label = months === 6 ? "6개월 전" : months === 3 ? "3개월 전 대비 최근" : "지난달";
    if (delta > 0) return `${label}보다 ${won(delta)} 늘었어요. 월평균 구독 지출액은 ${won(facts.current_total)}입니다.`;
    if (delta < 0) return `${label}보다 ${won(Math.abs(delta))} 줄었어요. 월평균 구독 지출액은 ${won(facts.current_total)}입니다.`;
    return `${label}과 같아요. 월평균 구독 지출액은 ${won(facts.current_total)}입니다.`;
  }
  if (Array.isArray(facts.increases)) {
    const rows = facts.increases.filter((item): item is { name: string; old_amount: number; new_amount: number } =>
      Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string")
    );
    if (rows.length === 0) {
      return typeof facts.summary === "string" && facts.summary ? facts.summary : "기록된 가격 인상이 없어요.";
    }
    return rows.map((item) => `${item.name} ${won(Number(item.old_amount))}→${won(Number(item.new_amount))}`).join("\n");
  }
  if (typeof facts.monthly_save === "number" && typeof facts.name === "string") {
    const yearly = typeof facts.yearly_save === "number" ? facts.yearly_save : facts.monthly_save * 12;
    return `${withObjectParticle(facts.name)} 해지하면 매달 ${won(facts.monthly_save)}, 연 ${won(yearly)}을 아낄 수 있어요. 앱에서 지우는 것과 실제 해지는 다릅니다.`;
  }
  const listed = listedSubscriptions(facts);
  if (Array.isArray(facts.subscriptions) && listed.length === 0) {
    return typeof facts.summary === "string" && facts.summary
      ? facts.summary
      : "해당하는 구독이 없어요.";
  }
  if (listed.length > 0) {
    const first = Array.isArray(facts.subscriptions) ? facts.subscriptions[0] as Record<string, unknown> : null;
    if (first && Array.isArray(first.reasons)) {
      const conf = { high: "높음", medium: "보통", low: "낮음" } as const;
      return listed.map((item, index) => {
        const row = (facts.subscriptions as Record<string, unknown>[])[index];
        const reasons = Array.isArray(row.reasons)
          ? (row.reasons as { evidence?: string }[]).map((reason) => reason.evidence).filter(Boolean).join(" ")
          : "";
        const level = typeof row.confidence === "string" && row.confidence in conf
          ? conf[row.confidence as keyof typeof conf]
          : "보통";
        const save = typeof row.monthly_save === "number" ? ` 월 ${won(row.monthly_save)} 절약` : "";
        return `${item.name}${save}, 신뢰 ${level}. ${reasons}`.trim();
      }).join("\n");
    }
    return `${listHeader(facts, listed.length)}\n\n${listed.map(formatListed).join("\n")}`;
  }
  if (typeof facts.monthly_total === "number" || typeof facts.monthly_equivalent === "number") {
    return monthlyTotalReply(facts, userText);
  }
  if (Array.isArray(facts.totals)) {
    const totals = facts.totals.filter((item): item is { category: string; amount: number } =>
      Boolean(item && typeof item === "object" && typeof (item as { category?: unknown }).category === "string")
    );
    if (totals.length === 0) return "카테고리별 지출이 없어요.";
    const sum = totals.reduce((acc, item) => acc + Number(item.amount), 0);
    const body = totals.map((item) => {
      const amount = Number(item.amount);
      const share = sum > 0 ? Math.round((amount / sum) * 100) : 0;
      const count = Number((item as { count?: unknown }).count);
      const detail = Number.isFinite(count) && count > 0
        ? `${share}%, ${count}개`
        : `${share}%`;
      return `${item.category} ${won(amount)} (${detail})`;
    }).join("\n");
    const head = `월평균 구독 지출액 ${won(sum)}을 카테고리 ${totals.length}개로 나눠봤어요.`;
    const top = totals[0];
    const tail = totals.length > 1 && Number(top.amount) > 0
      ? `\n\n가장 비중이 큰 건 ${top.category}예요.`
      : "";
    const note = typeof facts.snapshot_note === "string" && facts.snapshot_note
      ? `\n${facts.snapshot_note}`
      : "";
    return `${head}\n\n${body}${tail}${note}`;
  }
  if (typeof facts.name === "string" && typeof facts.amount === "number") {
    return `${facts.name}은 ${won(facts.amount)}이에요.`;
  }
  return typeof facts.summary === "string" && facts.summary ? facts.summary : FALLBACK;
}
