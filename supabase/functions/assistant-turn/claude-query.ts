type SnapshotSub = {
  name: string;
  amount: number;
  billing_cycle: string;
  next_payment_date: string;
  category?: string;
};

/** 조회 unknown일 때만 호출. 등록·삭제는 하지 않는다. */
export async function explainQueryWithClaude(
  userText: string,
  active: SnapshotSub[],
): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  const snapshot = active.slice(0, 80).map((item) => ({
    name: item.name,
    amount: item.amount,
    billing_cycle: item.billing_cycle,
    next_payment_date: item.next_payment_date,
    category: item.category ?? null,
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      max_tokens: 400,
      thinking: { type: "disabled" },
      system: `당신은 구독 관리 앱 subly의 조회 비서입니다.
주어진 구독 스냅샷 사실만 사용해 짧은 한국어로 답하세요.
금액(원)과 결제일(있으면)을 빠뜨리지 마세요.
카테고리 질문이면 스냅샷의 category를 사용하세요.
스냅샷에 없는 구독·금액을 만들지 마세요.
해당 기간에 없으면 없다고 말하세요.
등록·수정·삭제·해지 안내·확인 질문은 하지 마세요.
마크다운과 영어 헤더는 쓰지 마세요.`,
      messages: [{
        role: "user",
        content: JSON.stringify({ question: userText.slice(0, 280), subscriptions: snapshot }),
      }],
    }),
  });

  const payload = await res.json() as {
    error?: { message?: string };
    content?: { type?: string; text?: string }[];
  };
  if (!res.ok) return null;
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .replace(/[*_`#]/g, "")
    .trim();
  return text || null;
}
