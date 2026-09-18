/** Anthropic Messages API. 데모데이 동안 Gemini 대신 쓴다. */

export function claudeModel(): string {
  return Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
}

export async function claudeText(input: {
  system?: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: claudeModel(),
      max_tokens: input.maxTokens ?? 800,
      thinking: { type: "disabled" },
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: "user", content: input.user }],
    }),
  });
  if (!res.ok) return null;
  const payload = await res.json() as {
    content?: { type?: string; text?: string }[];
  };
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  return text || null;
}

export function parseClaudeJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(stripped);
}
