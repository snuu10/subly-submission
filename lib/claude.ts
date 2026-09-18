import { supabase } from '@/lib/supabase';
import {
  normalizeClaudeAction,
  normalizeClaudeCandidateIds,
  normalizeClaudeExtract,
  normalizeClaudeSubscriptionId,
  normalizeClaudeUsageCheckin,
} from '@/lib/extract';
import type {
  ClaudeBriefingContext,
  ClaudeChatMessage,
  ClaudeExtract,
  ClaudeProxyResponse,
  ClaudeSubscriptionHint,
} from '@/types/extract';

export type ClaudeInvokeInput = {
  mode: 'extract' | 'chat';
  text?: string;
  image_base64?: string;
  media_type?: string;
  history?: ClaudeChatMessage[];
  categories?: { name: string; key: string | null }[];
  subscriptions?: ClaudeSubscriptionHint[];
  briefing_context?: ClaudeBriefingContext;
};

export async function invokeClaude(input: ClaudeInvokeInput): Promise<ClaudeProxyResponse> {
  const { data, error } = await supabase.functions.invoke('claude-proxy', {
    body: input,
  });

  if (error) {
    throw new Error(mapClaudeError(await readFunctionError(error)));
  }

  const payload = data as {
    reply?: unknown;
    extract?: unknown;
    action?: unknown;
    subscription_id?: unknown;
    candidate_ids?: unknown;
    usage_checkin?: unknown;
    error?: string;
  } | null;
  if (!payload) {
    throw new Error('AI 응답이 비어 있습니다.');
  }
  if (payload.error) {
    throw new Error(mapClaudeError(payload.error));
  }

  return {
    reply: typeof payload.reply === 'string' && payload.reply.trim() ? payload.reply.trim() : '확인했어요.',
    extract: normalizeClaudeExtract(payload.extract) as ClaudeExtract | null,
    action: normalizeClaudeAction(payload.action),
    subscription_id: normalizeClaudeSubscriptionId(payload.subscription_id),
    candidate_ids: normalizeClaudeCandidateIds(payload.candidate_ids),
    usage_checkin: normalizeClaudeUsageCheckin(payload.usage_checkin),
  };
}

function mapClaudeError(message: string): string {
  if (message.includes('ANTHROPIC_API_KEY') || message.includes('API key')) {
    return 'AI 키가 아직 설정되지 않았어요. supabase secrets set ANTHROPIC_API_KEY 로 등록해 주세요.';
  }
  if (message.includes('Failed to send a request to the Edge Function') || message.includes('not found')) {
    return 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return message || 'AI 요청에 실패했습니다.';
}

async function readFunctionError(error: { message: string; context?: Response }): Promise<string> {
  if (error.context) {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // 본문을 못 읽으면 기본 메시지를 쓴다.
    }
  }
  return error.message;
}
