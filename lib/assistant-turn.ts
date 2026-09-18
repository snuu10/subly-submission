import { supabase } from '@/lib/supabase';
import { devicePlatform } from '@/lib/cancel-guide';
import {
  normalizeClaudeAction,
  normalizeClaudeCandidateIds,
  normalizeClaudeExtract,
  normalizeClaudeSubscriptionId,
  normalizeClaudeUsageCheckin,
} from '@/lib/extract';
import type {
  AssistantRpcResult,
  AssistantSession,
  AssistantTurnResponse,
} from '@/types/assistant-turn';
import { parseAssistantSession, parseCleanupRecommendations, parseLifecycleUpdate } from '@/types/assistant-turn';
import type { CancelGuideRequest, CancelGuideResponse } from '@/types/cancel-guide';
import type { ClaudeBriefingContext, ClaudeChatMessage, ClaudeExtract } from '@/types/extract';

export type AssistantTurnInput = {
  text: string;
  history?: ClaudeChatMessage[];
  categories?: { name: string; key: string | null }[];
  briefing_context?: ClaudeBriefingContext;
};

function asRpcResult(data: unknown): AssistantRpcResult {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  return {
    ok: row?.ok === true,
    code: typeof row?.code === 'string' ? row.code : 'error',
    session: parseAssistantSession(row?.session),
    message: typeof row?.message === 'string' ? row.message : '요청에 실패했습니다.',
  };
}

export async function loadAssistantSession(): Promise<AssistantSession | null> {
  const { data, error } = await supabase.rpc('load_assistant_session');
  if (error) throw new Error(error.message);
  const result = asRpcResult(data);
  if (!result.ok) return null;
  return result.session;
}

export async function confirmPendingAssistantAction(
  actionId: string,
  expectedVersion: number,
  subscriptionId?: string | null
): Promise<AssistantRpcResult> {
  const { data, error } = await supabase.rpc('confirm_pending_assistant_action', {
    p_action_id: actionId,
    p_expected_version: expectedVersion,
    p_subscription_id: subscriptionId ?? null,
  });
  if (error) throw new Error(error.message);
  return asRpcResult(data);
}

export async function bindPendingAssistantTarget(
  actionId: string,
  subscriptionId: string,
  expectedVersion: number
): Promise<AssistantRpcResult> {
  const { data, error } = await supabase.rpc('bind_pending_assistant_target', {
    p_action_id: actionId,
    p_subscription_id: subscriptionId,
    p_expected_version: expectedVersion,
  });
  if (error) throw new Error(error.message);
  return asRpcResult(data);
}

export async function cancelPendingAssistantAction(
  actionId: string,
  expectedVersion: number
): Promise<AssistantRpcResult> {
  const { data, error } = await supabase.rpc('cancel_pending_assistant_action', {
    p_action_id: actionId,
    p_expected_version: expectedVersion,
  });
  if (error) throw new Error(error.message);
  return asRpcResult(data);
}

export async function skipAssistantFollowup(
  actionId?: string | null,
  expectedVersion?: number | null
): Promise<AssistantRpcResult> {
  const { data, error } = await supabase.rpc('skip_assistant_followup', {
    p_action_id: actionId ?? null,
    p_expected_version: expectedVersion ?? null,
  });
  if (error) throw new Error(error.message);
  return asRpcResult(data);
}

export async function resetAssistantSession(): Promise<AssistantRpcResult> {
  const { data, error } = await supabase.rpc('reset_assistant_session');
  if (error) throw new Error(error.message);
  return asRpcResult(data);
}

export async function invokeAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResponse> {
  const { data, error } = await supabase.functions.invoke('assistant-turn', {
    body: {
      text: input.text,
      history: input.history,
      categories: input.categories,
      briefing_context: input.briefing_context,
      platform: devicePlatform(),
    },
  });

  if (error) {
    throw new Error(mapTurnError(await readFunctionError(error)));
  }

  const payload = data as {
    reply?: unknown;
    extract?: unknown;
    action?: unknown;
    subscription_id?: unknown;
    candidate_ids?: unknown;
    usage_checkin?: unknown;
    intent?: unknown;
    ranked_subscription_ids?: unknown;
    pending_action_id?: unknown;
    resolved_pending_action_id?: unknown;
    expires_at?: unknown;
    cancel_guide?: unknown;
    cancel_guide_request?: unknown;
    cleanup_recommendations?: unknown;
    lifecycle_update?: unknown;
    category_candidates?: unknown;
    session_version?: unknown;
    payment_instrument_request?: unknown;
    error?: string;
  } | null;

  if (!payload) throw new Error('AI 응답이 비어 있습니다.');
  if (payload.error) throw new Error(mapTurnError(payload.error));

  return {
    reply: typeof payload.reply === 'string' && payload.reply.trim() ? payload.reply.trim() : '확인했어요.',
    extract: normalizeClaudeExtract(payload.extract) as ClaudeExtract | null,
    action: normalizeClaudeAction(payload.action),
    subscription_id: normalizeClaudeSubscriptionId(payload.subscription_id),
    candidate_ids: normalizeClaudeCandidateIds(payload.candidate_ids),
    usage_checkin: normalizeClaudeUsageCheckin(payload.usage_checkin),
    intent: typeof payload.intent === 'string' ? payload.intent : 'unknown',
    ranked_subscription_ids: Array.isArray(payload.ranked_subscription_ids)
      ? payload.ranked_subscription_ids.filter((item): item is string => typeof item === 'string')
      : [],
    pending_action_id: typeof payload.pending_action_id === 'string' ? payload.pending_action_id : null,
    resolved_pending_action_id:
      typeof payload.resolved_pending_action_id === 'string' ? payload.resolved_pending_action_id : null,
    expires_at: typeof payload.expires_at === 'string' ? payload.expires_at : null,
    cancel_guide: payload.cancel_guide && typeof payload.cancel_guide === 'object'
      ? (payload.cancel_guide as CancelGuideResponse)
      : null,
    cancel_guide_request:
      payload.cancel_guide_request && typeof payload.cancel_guide_request === 'object'
        ? (payload.cancel_guide_request as CancelGuideRequest)
        : null,
    cleanup_recommendations: parseCleanupRecommendations(payload.cleanup_recommendations),
    lifecycle_update: parseLifecycleUpdate(payload.lifecycle_update),
    category_candidates: Array.isArray(payload.category_candidates)
      ? payload.category_candidates.filter((item): item is string => typeof item === 'string')
      : null,
    session_version: typeof payload.session_version === 'number' ? payload.session_version : 0,
    payment_instrument_request: payload.payment_instrument_request === true,
  };
}

function mapTurnError(message: string): string {
  if (message.includes('ANTHROPIC_API_KEY') || message.includes('GEMINI_API_KEY') || message.includes('API key')) {
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
      // ignore
    }
  }
  return error.message;
}
