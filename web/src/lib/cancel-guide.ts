import { supabase } from '@/lib/supabase';
import type { CancelGuideRequest, CancelGuideResponse } from '@/types/cancel-guide';

export function looksLikeCancelGuideQuery(text: string): boolean {
  return /해지|취소하는\s*법|취소\s*방법|구독\s*끊|unsubscribe|cancel\s+sub/i.test(text);
}

export async function invokeCancelGuide(input: CancelGuideRequest): Promise<CancelGuideResponse> {
  const { data, error } = await supabase.functions.invoke('cancel-guide', {
    body: {
      ...input,
      platform: input.platform ?? 'web',
      mode: 'curated',
      // 결제 경로를 더 이상 사용자에게 묻지 않는다 — 항상 웹 결제 기준으로 안내한다.
      billing_channel: 'direct_web',
    },
  });

  if (error) {
    throw new Error(mapCancelGuideError(await readFunctionError(error)));
  }

  const payload = data as CancelGuideResponse & { error?: string } | null;
  if (!payload) {
    throw new Error('해지 안내 응답이 비어 있습니다.');
  }
  if (payload.error && !payload.status) {
    throw new Error(mapCancelGuideError(payload.error));
  }
  return payload;
}

function mapCancelGuideError(message: string): string {
  if (message.includes('ANTHROPIC_API_KEY') || message.includes('GEMINI_API_KEY') || message.includes('API key')) {
    return 'AI 키가 아직 설정되지 않았어요.';
  }
  if (message.includes('한도')) return message;
  if (message.includes('Failed to send a request to the Edge Function') || message.includes('not found')) {
    return '해지 안내 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return message || '해지 안내 요청에 실패했습니다.';
}

async function readFunctionError(error: { message: string; context?: Response }): Promise<string> {
  if (error.context) {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // ignore
    }
  }
  return error.message;
}
