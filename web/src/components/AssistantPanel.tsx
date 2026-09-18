import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { CancelGuideCard } from '@/components/assistant/CancelGuideCard';
import { ChatActionCard } from '@/components/assistant/ChatActionCard';
import { ChatInlineCard } from '@/components/assistant/ChatInlineCard';
import { CleanupRecommendCard } from '@/components/assistant/CleanupRecommendCard';
import { LifecycleConfirmCard } from '@/components/assistant/LifecycleConfirmCard';
import { InstitutionPicker, InstrumentForm } from '@/components/PaymentInstrumentEditor';
import { SuggestionChips } from '@/components/assistant/SuggestionChips';
import { UsageCheckinCard } from '@/components/assistant/UsageCheckinCard';
import { STARTER_SUGGESTIONS, followUpSuggestions } from '@/lib/assistant-suggestions';
import { formatCurrency, formatShortDate, getDaysUntil, getMonthlyTotal, getUpcomingSubscriptions } from '@/lib/calc';
import { invokeCancelGuide } from '@/lib/cancel-guide';
import { invokeClaude } from '@/lib/claude';
import { duplicateAccountIssue, duplicateAccountMessage } from '@/lib/duplicate-account';
import { MULTI_RECEIPT_MESSAGE, MULTI_RECEIPT_TITLE, readReceiptFile, type ReceiptImage } from '@/lib/image';
import { stripChatMarkdown, breakChatSentences, candidateDetailLines, listReplyCaption, resolveRankedSubscriptions, matchCreatedSubscription, keepsAssistantFollowup, resolveCancelListDeleteTargets, isListLikeAssistantIntent, pendingExtractHasUpdateValue } from '@/lib/chat-text';
import {
  bindPendingAssistantTarget,
  confirmPendingAssistantAction,
  invokeAssistantTurn,
  loadAssistantSession,
  resetAssistantSession,
  skipAssistantFollowup,
} from '@/lib/assistant-turn';
import { advanceSubscriptionLifecycle, syncMyLifecycleDue } from '@/lib/lifecycle';
import { createPaymentInstrument, createSubscription } from '@/lib/data';
import { findInstitution } from '@/lib/financial-institutions';
import {
  extractFromPending,
  isAssistantActionExpired,
  parsedFromPendingExtract,
  type AssistantTurnResponse,
  type CleanupRecommendation,
  type LifecycleUpdatePayload,
} from '@/types/assistant-turn';
import {
  deleteSubscription,
  toggleSubscriptionActive,
  updateSubscription,
} from '@/lib/data';
import { recordAssistantCheckin } from '@/lib/briefing-events';
import {
  mergeExtractIntoSubscription,
  subscriptionToParsed,
  toParsedSubscription,
  withInferredCategory,
} from '@/lib/extract';
import { newIdempotencyKey, resolveAssistantUsageCheckin } from '@/lib/usage-checkin';
import type { CancelGuideRequest, CancelGuideResponse } from '@/types/cancel-guide';
import type { ClaudeBriefingContext, ClaudeChatMessage, ClaudeExtract, ClaudeManageAction, ClaudeUsageCheckin, ParsedSubscription } from '@/types/extract';
import type { Category, LifecycleStatus, Subscription } from '@/types';

type ChatItem = {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  imageUri?: string;
  imageName?: string;
  extract?: ParsedSubscription | null;
  /** 체험·전환 관련 표현이 섞여 있던 등록 요청 — 이름을 한 번 더 확인해 달라는 경고를 보여준다. */
  nameNeedsReview?: boolean;
  registered?: boolean;
  editedViaModal?: boolean;
  dismissed?: boolean;
  action?: ClaudeManageAction;
  subscriptionId?: string;
  preview?: ParsedSubscription;
  previousAmount?: number;
  confirmed?: boolean;
  candidates?: Subscription[];
  pendingAction?: ClaudeManageAction;
  pendingExtract?: ClaudeExtract | null;
  candidatesResolved?: boolean;
  cancelGuide?: CancelGuideResponse;
  pendingCancel?: CancelGuideRequest;
  saveChannelTargetId?: string;
  usageCheckin?: ClaudeUsageCheckin;
  usageIdempotencyKey?: string;
  pendingActionId?: string;
  sessionVersion?: number;
  expiresAt?: string;
  cleanupRecommendations?: CleanupRecommendation[];
  lifecycleUpdate?: LifecycleUpdatePayload;
  awaitingSkip?: boolean;
  listed?: Subscription[];
  duplicateCreate?: boolean;
  /** 영수증 이미지에서 만들어진 duplicateCreate 카드인지("별도로 추가"의 로컬 처리 분기용). */
  fromReceiptImage?: boolean;
  /** 계정 필요 알림 후 이 카드가 채팅 답장을 기다리는 중인지. */
  awaitingAccount?: boolean;
  intent?: string;
  categoryCandidates?: string[];
  /** "결제수단 추가하고 싶어" 요청 — 계좌/신용카드/체크카드 버튼을 보여준다. */
  paymentInstrumentRequest?: boolean;
  /** 버튼을 눌러 이 메시지 안에서 결제수단 등록 폼을 여는 중인지. */
  paymentInstrumentStep?: 'picker' | 'form';
  paymentInstrumentKind?: 'bank' | 'card';
  paymentInstrumentCardType?: 'credit' | 'check';
  paymentInstrumentInstitutionKey?: string;
  paymentInstrumentSaved?: {
    name: string;
    kind: string;
    last4: string;
    institution: string;
    cardType?: string;
  };
};

type AssistantLaunch = {
  prompt?: string;
  eventId?: string;
  subscriptionId?: string;
  intent?: string;
  entrySource?: string;
};

type AssistantPanelProps = {
  open: boolean;
  initialPrompt?: string;
  launch?: AssistantLaunch;
  subscriptions: Subscription[];
  categories: Category[];
  onClose: () => void;
  onReload: () => Promise<Subscription[] | void> | void;
  onUsageCheckinSaved?: () => void;
  onEditDraft: (
    parsed: ParsedSubscription,
    subscriptionId: string | undefined,
    onSaved: (saved: Subscription) => void
  ) => void;
};

const FALLBACK_GREETING =
  '안녕하세요! 구독 등록을 도와드릴게요. 서비스 이름과 금액, 주기를 알려주세요.';
const UPCOMING_WINDOW_DAYS = 7;

function buildGreetingText(subscriptions: Subscription[]): string {
  const total = getMonthlyTotal(subscriptions);
  if (total <= 0) return FALLBACK_GREETING;

  const parts = [`월평균 구독 지출액은 ${formatCurrency(total)}이에요.`];
  const next = getUpcomingSubscriptions(subscriptions, UPCOMING_WINDOW_DAYS)[0];
  if (next) {
    const days = getDaysUntil(next.next_payment_date);
    const when = days <= 0 ? '오늘' : `${days}일 뒤`;
    parts.push(`${when} ${next.name} 결제가 있어요.`);
  }
  return parts.join(' ');
}

function greetingItem(text: string): ChatItem {
  return { id: 'greeting', role: 'assistant', text };
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** assistant-turn 서버(gemini-intent.ts)의 판별 로직을 이 화면 전용으로 복제한 것 — 런타임이 달라 직접 import할 수 없다(앱 app/chat.tsx도 동일하게 복제). */
function looksLikeAccountDodge(text: string): boolean {
  const compact = text.replace(/\s+/g, '').replace(/[.!?]+$/g, '');
  return /^(없어|없어요|없음|없다|몰라|몰라요|모름|생략|생략할게|건너뛰기|건너뛸게|건너뛰어|패스|스킵|그냥등록|그냥등록해|그냥해줘|나중에|안적을래|안쓸래)$/.test(
    compact
  );
}

function looksLikeAccountCancel(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /^(취소|취소할게|취소해줘|아니|아니요|그만할게|안할래|안할게|됐어)$/.test(compact);
}

const SKIP_FOLLOWUP = '알겠어요. 이 작업은 건너뛸게요. 다른 질문을 입력해 주세요.';

function isOpenActionItem(item: ChatItem): boolean {
  if (item.role !== 'assistant' || item.dismissed || item.confirmed || item.registered) return false;
  return Boolean(
    item.pendingActionId ||
      item.extract ||
      item.action ||
      item.lifecycleUpdate ||
      item.pendingCancel ||
      item.usageCheckin ||
      item.awaitingSkip ||
      (item.candidates && item.candidates.length > 0 && !item.candidatesResolved)
  );
}

function markActionSkipped(item: ChatItem): ChatItem {
  return {
    ...item,
    dismissed: true,
    candidatesResolved: true,
  };
}

function dismissResolvedPending(prev: ChatItem[], resolvedId?: string | null): ChatItem[] {
  if (!resolvedId) return prev;
  return prev.map((item) =>
    item.pendingActionId === resolvedId ? markActionSkipped(item) : item
  );
}

export function AssistantPanel({
  open,
  initialPrompt,
  launch,
  subscriptions,
  categories,
  onClose,
  onReload,
  onUsageCheckinSaved,
  onEditDraft,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatItem[]>(() => [greetingItem(buildGreetingText(subscriptions))]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImage, setPendingImage] = useState<ReceiptImage | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPrompt = useRef<string | undefined>(undefined);
  const sendingRef = useRef(false);
  const messagesRef = useRef<ChatItem[]>([]);
  const subscriptionsRef = useRef(subscriptions);
  const categoriesRef = useRef(categories);
  const pendingImageRef = useRef<ReceiptImage | null>(null);
  const briefingContextRef = useRef<ClaudeBriefingContext | undefined>(undefined);

  messagesRef.current = messages;
  sendingRef.current = sending;
  subscriptionsRef.current = subscriptions;
  categoriesRef.current = categories;
  pendingImageRef.current = pendingImage;
  briefingContextRef.current = launch
    ? {
        event_id: launch.eventId,
        subscription_id: launch.subscriptionId,
        intent: launch.intent,
        entry_source: launch.entrySource,
      }
    : briefingContextRef.current;

  useEffect(() => {
    const text = buildGreetingText(subscriptions);
    setMessages((prev) => {
      const first = prev[0];
      if (prev.length !== 1 || first?.id !== 'greeting' || first.text === text) return prev;
      return [greetingItem(text)];
    });
  }, [subscriptions]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        await syncMyLifecycleDue().catch(() => undefined);
        const session = await loadAssistantSession();
        if (cancelled || !session || session.pending_action_status !== 'pending' || !session.pending_action) {
          return;
        }
        if (isAssistantActionExpired(session.pending_action.expires_at)) return;
        const pending = session.pending_action;
        const cats = categoriesRef.current;
        const subs = subscriptionsRef.current;
        const fallbackCategory = cats.find((item) => item.key === 'etc')?.id ?? cats[0]?.id;
        setMessages((prev) => {
          if (prev.some((item) => item.pendingActionId === pending.id)) return prev;
          const item: ChatItem = {
            id: nextId(),
            role: 'assistant',
            text: '다른 기기에서 확인을 기다리는 작업이 있어요.',
            pendingActionId: pending.id,
            sessionVersion: session.version,
            expiresAt: pending.expires_at,
          };
          if (pending.kind === 'create') {
            item.extract = parsedFromPendingExtract(pending.extract, fallbackCategory);
            return item.extract ? [...prev, item] : prev;
          }
          const manage = pending.kind;
          const candidates = session.candidate_ids
            .map((id) => subs.find((row) => row.id === id))
            .filter((row): row is Subscription => Boolean(row));
          if (candidates.length > 1 && !pending.subscription_id) {
            item.candidates = candidates;
            item.pendingAction = manage;
            item.pendingExtract = extractFromPending(pending);
            return [...prev, item];
          }
          const target = subs.find((row) => row.id === pending.subscription_id);
          if (!target) return prev;
          item.action = manage;
          item.subscriptionId = target.id;
          item.preview =
            manage === 'update'
              ? parsedFromPendingExtract(pending.extract, target.category_id) ?? subscriptionToParsed(target)
              : subscriptionToParsed(target);
          return [...prev, item];
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const applyCancelGuide = useCallback(
    (
      messageId: string,
      response: CancelGuideResponse,
      request: CancelGuideRequest,
      targetId?: string
    ): boolean => {
      if (response.redirect === 'claude_proxy') return false;

      const text = response.needs_intent
        ? '앱 목록에서 지울까요, 아니면 실제 서비스 해지 방법을 안내할까요?'
        : response.needs_billing_channel
          ? '이 구독은 어디에 결제하고 있나요? 경로를 고르면 해지 안내를 찾아볼게요.'
          : response.search_failed
            ? (response.warnings[0] ?? '최신 공식 절차를 확인하지 못했습니다.')
            : `${response.service_name ?? '구독'} 해지 안내입니다.`;

      setMessages((prev) =>
        prev.map((item) =>
          item.id === messageId
            ? {
                ...item,
                text,
                cancelGuide: response.needs_intent || response.needs_billing_channel ? undefined : response,
                pendingCancel: response.needs_intent || response.needs_billing_channel ? request : undefined,
                saveChannelTargetId: targetId,
              }
            : item
        )
      );
      return true;
    },
    []
  );

  const requestCancelGuide = useCallback(
    async (messageId: string, request: CancelGuideRequest, targetId?: string) => {
      const response = await invokeCancelGuide(request);
      return applyCancelGuide(messageId, response, request, targetId);
    },
    [applyCancelGuide]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const image = pendingImageRef.current;
      if ((!trimmed && !image) || sendingRef.current) return;

      // 영수증은 한 장씩만 처리한다 — 이전 영수증의 선택 카드가 열려 있는 채로
      // 새 영수증을 보내면(별도 카드 2개가 동시에 열려) 계정 답장 가로채기가
      // 가장 최근 카드만 찾아서, 먼저 열린 카드는 답장으로 못 끝내는 사각지대가 생긴다.
      const openReceiptItem = messagesRef.current.find(
        (row) => row.fromReceiptImage && !row.dismissed && !row.registered && !row.confirmed
      );
      if (openReceiptItem) {
        if (looksLikeAccountCancel(trimmed)) {
          setMessages((prev) => [
            ...prev.map((row) => (row.id === openReceiptItem.id ? { ...row, dismissed: true } : row)),
            { id: nextId(), role: 'user', text: trimmed },
            {
              id: nextId(),
              role: 'assistant',
              text: image
                ? '이전 영수증 처리를 취소했어요. 새 영수증을 다시 보내 주세요.'
                : '이전 영수증 처리를 취소했어요.',
            },
          ]);
          setDraft('');
          return;
        }
        if (image) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              text: '영수증은 한 장씩만 처리할 수 있어요. 이전 영수증 처리를 먼저 끝내거나, "취소"라고 답장해서 취소하거나, "그대로 두기"로 닫은 뒤 다시 보내 주세요.',
            },
          ]);
          return;
        }
      }

      const pendingAccountItem = [...messagesRef.current].reverse().find(
        (row) => row.role === 'assistant' && row.awaitingAccount && !row.dismissed && !row.registered
      );
      if (pendingAccountItem?.extract && !image) {
        setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: trimmed }]);
        setDraft('');
        if (looksLikeAccountCancel(trimmed)) {
          setMessages((prev) => [
            ...prev.map((row) => (row.id === pendingAccountItem.id ? { ...row, awaitingAccount: false } : row)),
            { id: nextId(), role: 'assistant', text: '등록을 취소했어요.' },
          ]);
          return;
        }
        if (looksLikeAccountDodge(trimmed)) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              text: '계정을 알아야 어떤 구독인지 구분할 수 있어요. 이메일이나 아이디를 입력해 주세요.',
            },
          ]);
          return;
        }
        const merged = { ...pendingAccountItem.extract, account_id: trimmed };
        const issue = duplicateAccountIssue(subscriptionsRef.current, {
          name: merged.name,
          account_id: merged.account_id,
          preset_id: merged.preset_id,
        });
        if (issue) {
          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: duplicateAccountMessage(issue) }]);
          return;
        }
        try {
          const created = await createSubscription(
            {
              name: merged.name,
              amount: merged.amount,
              billing_cycle: merged.billing_cycle,
              category_id: merged.category_id,
              anchor_date: merged.anchor_date,
              is_active: true,
              preset_id: merged.preset_id,
              account_id: merged.account_id,
            },
            subscriptionsRef.current
          );
          setMessages((prev) => [
            ...prev.map((row) =>
              row.id === pendingAccountItem.id
                ? { ...row, registered: true, subscriptionId: created.id, awaitingAccount: false, extract: merged }
                : row
            ),
            {
              id: nextId(),
              role: 'assistant',
              text: `'${merged.account_id}' 계정으로 ${merged.name} 등록을 마쳤어요.`,
            },
          ]);
          void onReload();
        } catch (caught) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              text: caught instanceof Error ? caught.message : '등록에 실패했습니다.',
            },
          ]);
        }
        return;
      }

      await dismissOpenActions(trimmed);

      const history: ClaudeChatMessage[] = messagesRef.current
        .filter((item) => item.text)
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.text ?? '' }));

      const userRow: ChatItem = {
        id: nextId(),
        role: 'user',
        text: trimmed || undefined,
        imageUri: image?.previewUrl,
        imageName: image?.fileName,
      };
      setMessages((prev) => [...prev, userRow]);
      setDraft('');
      setPendingImage(null);
      setAttachError(null);
      setSending(true);

      const currentSubs = subscriptionsRef.current;
      const currentCats = categoriesRef.current;

      try {
        const response = image
          ? await invokeClaude({
              mode: 'chat',
              text: trimmed || '첨부한 결제 화면에서 구독 정보를 추출해 주세요.',
              image_base64: image.base64,
              media_type: image.mimeType,
              history,
              categories: currentCats.map((item) => ({ name: item.name, key: item.key })),
              subscriptions: currentSubs.map((item) => ({
                id: item.id,
                name: item.name,
                amount: item.amount,
                billing_cycle: item.billing_cycle,
                is_active: item.is_active,
              })),
              briefing_context: briefingContextRef.current,
            })
          : await invokeAssistantTurn({
              text: trimmed,
              history,
              categories: currentCats.map((item) => ({ name: item.name, key: item.key })),
              briefing_context: briefingContextRef.current,
            });

        const turn: AssistantTurnResponse | null = image ? null : (response as AssistantTurnResponse);

        const usageCheckin = resolveAssistantUsageCheckin(response.usage_checkin, trimmed, currentSubs);
        const usageTarget = usageCheckin
          ? currentSubs.find((item) => item.id === usageCheckin.subscription_id)
          : undefined;

        const parsed = usageCheckin
          ? null
          : response.extract &&
              (response.action !== 'create' ||
                (Boolean(response.extract.billing_cycle) && Boolean(response.extract.anchor_date)))
            ? toParsedSubscription(response.extract, currentCats)
            : null;
        const manageAction = usageCheckin
          ? null
          : response.action === 'update' ||
              response.action === 'delete' ||
              response.action === 'pause' ||
              response.action === 'resume'
            ? response.action
            : null;

        const assistant: ChatItem = {
          id: nextId(),
          role: 'assistant',
          text:
            usageCheckin && usageTarget
              ? response.reply || `${usageTarget.name} 사용 여부를 이렇게 기록할까요?`
              : response.reply,
          pendingActionId: turn?.pending_action_id ?? undefined,
          sessionVersion: turn?.session_version,
          expiresAt: turn?.expires_at ?? undefined,
        };

        const listed = isListLikeAssistantIntent(turn?.intent) && !usageCheckin && !parsed && !manageAction
          ? resolveRankedSubscriptions(turn?.ranked_subscription_ids, currentSubs)
          : [];
        if (
          listed.length > 0 &&
          !turn?.cancel_guide &&
          !turn?.cancel_guide_request &&
          !turn?.cleanup_recommendations?.length &&
          !turn?.lifecycle_update
        ) {
          assistant.listed = listed;
          assistant.text = listReplyCaption(response.reply ?? '', listed.length);
        }

        if (turn?.cancel_guide || turn?.cancel_guide_request) {
          assistant.cancelGuide = turn.cancel_guide ?? undefined;
          assistant.pendingCancel = turn.cancel_guide_request ?? undefined;
          assistant.saveChannelTargetId = turn.subscription_id ?? undefined;
        }

        if (turn?.cleanup_recommendations?.length) {
          assistant.cleanupRecommendations = turn.cleanup_recommendations;
        }
        if (turn?.lifecycle_update) {
          assistant.lifecycleUpdate = turn.lifecycle_update;
        }

        if (usageCheckin && usageTarget) {
          assistant.usageCheckin = usageCheckin;
          assistant.usageIdempotencyKey = newIdempotencyKey();
        }

        const target =
          manageAction && response.subscription_id
            ? currentSubs.find((item) => item.id === response.subscription_id)
            : undefined;

        const candidatesFromIds = response.candidate_ids
          ? response.candidate_ids
              .map((id) => currentSubs.find((item) => item.id === id))
              .filter((item): item is Subscription => Boolean(item))
          : [];

        // 영수증 인식(claude-proxy)은 이름이 겹치는지만 알려준다 — 새 등록인지 기존
        // 구독을 고치려는 것인지는 캡션 키워드로 추측하지 않고, 텍스트 대화의
        // duplicateCreate 선택 카드("변경" / "별도로 추가" / "그대로 두기")를
        // 그대로 띄워 사용자가 직접 고르게 한다.
        const receiptNameOverlap = Boolean(
          image &&
            response.extract &&
            ((manageAction === 'update' && target) ||
              (response.candidate_ids && response.candidate_ids.length > 0))
        );

        if (receiptNameOverlap) {
          assistant.duplicateCreate = true;
          assistant.candidates = target ? [target] : candidatesFromIds;
          assistant.pendingAction = 'update';
          assistant.pendingExtract = response.extract;
          assistant.fromReceiptImage = true;
        } else if (target && manageAction) {
          assistant.action = manageAction;
          assistant.subscriptionId = target.id;
          assistant.previousAmount = target.amount;
          assistant.preview =
            manageAction === 'update'
              ? mergeExtractIntoSubscription(target, response.extract, currentCats)
              : subscriptionToParsed(target);
        } else if (manageAction && response.candidate_ids && response.candidate_ids.length > 0) {
          const candidates = candidatesFromIds;

          const duplicateCreate = turn?.intent === 'create_subscription' && manageAction === 'update';
          if (duplicateCreate) {
            assistant.duplicateCreate = true;
            assistant.candidates = candidates;
            assistant.pendingAction = manageAction;
            assistant.pendingExtract = response.extract;
          } else if (candidates.length === 1) {
            const only = candidates[0];
            assistant.action = manageAction;
            assistant.subscriptionId = only.id;
            assistant.previousAmount = only.amount;
            assistant.preview =
              manageAction === 'update'
                ? mergeExtractIntoSubscription(only, response.extract, currentCats)
                : subscriptionToParsed(only);
          } else if (candidates.length > 1) {
            assistant.candidates = candidates;
            assistant.pendingAction = manageAction;
            assistant.pendingExtract = response.extract;
          }
        } else if (parsed && !manageAction) {
          assistant.extract = parsed;
          if (turn?.name_needs_review) assistant.nameNeedsReview = true;
        }

        const manageIntent = turn?.intent === 'create_subscription' ||
          turn?.intent === 'update_subscription' ||
          turn?.intent === 'delete_subscription' ||
          turn?.intent === 'pause_subscription' ||
          turn?.intent === 'resume_subscription';
        assistant.awaitingSkip = Boolean(
          manageIntent && !parsed && !manageAction && !(turn?.candidate_ids && turn.candidate_ids.length > 0)
        );
        assistant.intent = turn?.intent;
        if (turn?.category_candidates?.length) assistant.categoryCandidates = turn.category_candidates;
        if (turn?.payment_instrument_request) assistant.paymentInstrumentRequest = true;

        setMessages((prev) => [...dismissResolvedPending(prev, turn?.resolved_pending_action_id), assistant]);
        void onReload();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'AI 요청에 실패했습니다.';
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: message }]);
      } finally {
        setSending(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) {
      lastPrompt.current = undefined;
      return;
    }
    const prompt = initialPrompt?.trim();
    if (!prompt || lastPrompt.current === prompt) return;
    lastPrompt.current = prompt;
    void send(prompt);
  }, [open, initialPrompt, send]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  async function handleRegister(id: string) {
    const item = messagesRef.current.find((row) => row.id === id);
    if (item?.dismissed) return;
    if (item?.pendingActionId && item.sessionVersion != null) {
      if (isAssistantActionExpired(item.expiresAt)) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: '확인 시간이 지났습니다. 다시 요청해 주세요.' },
        ]);
        return;
      }
      try {
        const result = await confirmPendingAssistantAction(item.pendingActionId, item.sessionVersion);
        if (!result.ok && result.code !== 'already_completed') {
          throw new Error(result.message);
        }
        const sessionId = result.session?.selected_subscription_id ?? undefined;
        setMessages((prev) =>
          prev.map((row) => (row.id === id
            ? {
              ...row,
              registered: true,
              sessionVersion: result.session?.version,
              subscriptionId: sessionId ?? row.subscriptionId,
            }
            : row))
        );
        const nextList = await onReload();
        if (!sessionId && item.extract) {
          const list = Array.isArray(nextList) ? nextList : subscriptionsRef.current;
          const matched = matchCreatedSubscription(list, item.extract)?.id;
          if (matched) {
            setMessages((prev) =>
              prev.map((row) => (row.id === id ? { ...row, subscriptionId: matched } : row))
            );
          }
        }
      } catch (caught) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: caught instanceof Error ? caught.message : '등록에 실패했습니다.',
          },
        ]);
      }
      return;
    }

    // 영수증 이미지 등은 서버 pending action 없이 extract만 온다. 만료된 게 아니라
    // 확인 토큰이 애초에 없는 것이라, 수동 등록과 같은 경로로 바로 저장한다.
    if (item?.extract) {
      const extract = item.extract;
      const issue = duplicateAccountIssue(subscriptionsRef.current, {
        name: extract.name,
        account_id: extract.account_id,
        preset_id: extract.preset_id,
      });
      if (issue) {
        setMessages((prev) => [
          ...prev.map((row) => (row.id === id ? { ...row, awaitingAccount: true } : row)),
          {
            id: nextId(),
            role: 'assistant',
            text: `${duplicateAccountMessage(issue)} 채팅으로 바로 답장해도 등록돼요.`,
          },
        ]);
        return;
      }
      try {
        const created = await createSubscription(
          {
            name: extract.name,
            amount: extract.amount,
            billing_cycle: extract.billing_cycle,
            category_id: extract.category_id,
            anchor_date: extract.anchor_date,
            is_active: true,
            preset_id: extract.preset_id,
            account_id: extract.account_id,
          },
          subscriptionsRef.current
        );
        setMessages((prev) =>
          prev.map((row) => (row.id === id ? { ...row, registered: true, subscriptionId: created.id } : row))
        );
        void onReload();
      } catch (caught) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: caught instanceof Error ? caught.message : '등록에 실패했습니다.',
          },
        ]);
      }
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'assistant', text: '확인 카드가 만료되었습니다. 다시 요청해 주세요.' },
    ]);
  }

  function handleModalSaved(itemId: string, saved: Subscription, wasRegistered: boolean) {
    setMessages((prev) =>
      prev.map((row) =>
        row.id === itemId
          ? {
              ...row,
              extract: subscriptionToParsed(saved),
              subscriptionId: saved.id,
              registered: true,
              editedViaModal: wasRegistered ? true : row.editedViaModal,
            }
          : row
      )
    );
  }

  function focusComposer() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function skipFollowupForItem(item: ChatItem) {
    try {
      const result = await skipAssistantFollowup(
        item.pendingActionId,
        item.pendingActionId ? item.sessionVersion : null
      );
      if (!result.ok && result.code !== 'already_cancelled' && result.code !== 'not_pending') {
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: result.message }]);
        return false;
      }
      return true;
    } catch (caught) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: caught instanceof Error ? caught.message : '이어가기에 실패했습니다.',
        },
      ]);
      return false;
    }
  }

  function applySkip(ids: string[], followUp: boolean) {
    setMessages((prev) => {
      const next = prev.map((item) => (ids.includes(item.id) ? markActionSkipped(item) : item));
      if (!followUp) return next;
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.text === SKIP_FOLLOWUP) return next;
      return [...next, { id: nextId(), role: 'assistant', text: SKIP_FOLLOWUP }];
    });
  }

  async function handleSkipAction(messageId: string) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (!item) return;
    const ok = await skipFollowupForItem(item);
    if (!ok) return;
    applySkip([messageId], true);
    focusComposer();
  }

  async function dismissOpenActions(followupText?: string) {
    if (followupText && keepsAssistantFollowup(followupText)) return;
    const open = messagesRef.current.filter(isOpenActionItem);
    if (open.length === 0) return;
    const pendingItem = [...open].reverse().find((row) => row.pendingActionId);
    if (pendingItem) await skipFollowupForItem(pendingItem);
    applySkip(
      open.map((item) => item.id),
      false
    );
  }

  async function handleRestartChat() {
    try {
      await resetAssistantSession();
    } catch {
      // 세션이 없어도 화면은 처음부터 다시 연다.
    }
    setDraft('');
    setPendingImage(null);
    setAttachError(null);
    setMessages([greetingItem(buildGreetingText(subscriptionsRef.current))]);
    focusComposer();
  }

  async function handleConfirmAction(
    messageId: string,
    action: ClaudeManageAction,
    subscriptionId: string,
    preview: ParsedSubscription
  ) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (item?.dismissed) return;
    if (item?.pendingActionId && item.sessionVersion != null) {
      if (isAssistantActionExpired(item.expiresAt)) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: '확인 시간이 지났습니다. 다시 요청해 주세요.' },
        ]);
        return;
      }
      try {
        const result = await confirmPendingAssistantAction(
          item.pendingActionId,
          item.sessionVersion,
          subscriptionId
        );
        if (!result.ok && result.code !== 'already_completed') {
          throw new Error(result.message);
        }
        setMessages((prev) =>
          prev.map((row) =>
            row.id === messageId ? { ...row, confirmed: true, sessionVersion: result.session?.version } : row
          )
        );
        await onReload();
      } catch (caught) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: caught instanceof Error ? caught.message : '적용에 실패했습니다.',
          },
        ]);
      }
      return;
    }

    const current = subscriptionsRef.current.find((item) => item.id === subscriptionId);
    const toSave = withInferredCategory(preview, categoriesRef.current);
    try {
      if (action === 'update') {
        if (!current) throw new Error('구독을 찾지 못했어요.');
        await updateSubscription(subscriptionId, {
          name: toSave.name,
          amount: toSave.amount,
          billing_cycle: toSave.billing_cycle,
          category_id: toSave.category_id,
          anchor_date: toSave.anchor_date,
          is_active: current.is_active,
          memo: current.memo ?? null,
          preset_id: toSave.preset_id,
          account_id: toSave.account_id ?? current.account_id ?? null,
          emoji: current.emoji ?? null,
          billing_channel: current.billing_channel ?? null,
        }, subscriptionsRef.current);
      } else if (action === 'delete') {
        await deleteSubscription(subscriptionId);
      } else if (action === 'pause') {
        if (!current) throw new Error('구독을 찾지 못했어요.');
        if (current.is_active) await toggleSubscriptionActive(subscriptionId, false);
      } else if (action === 'resume') {
        if (!current) throw new Error('구독을 찾지 못했어요.');
        if (!current.is_active) await toggleSubscriptionActive(subscriptionId, true);
      }

      setMessages((prev) => prev.map((item) => (item.id === messageId ? { ...item, confirmed: true } : item)));
      await onReload();
    } catch (caught) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: caught instanceof Error ? caught.message : '적용에 실패했습니다.',
        },
      ]);
    }
  }

  async function handleConfirmUsageCheckin(messageId: string) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (!item?.usageCheckin || item.confirmed || sendingRef.current) return;
    setSending(true);
    try {
      const result = await recordAssistantCheckin(
        item.usageCheckin.subscription_id,
        item.usageCheckin.response,
        item.usageIdempotencyKey || newIdempotencyKey(),
        'assistant'
      );
      if (!result.ok && result.code !== 'already_answered') {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: result.message || '사용 여부를 저장하지 못했어요.',
          },
        ]);
        return;
      }
      setMessages((prev) => prev.map((row) => (row.id === messageId ? { ...row, confirmed: true } : row)));
      onUsageCheckinSaved?.();
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmLifecycle(messageId: string) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (!item?.lifecycleUpdate || item.confirmed || sendingRef.current) return;
    setSending(true);
    try {
      const result = await advanceSubscriptionLifecycle(
        item.lifecycleUpdate.subscription_id,
        item.lifecycleUpdate.to as LifecycleStatus,
        item.lifecycleUpdate.service_end_date,
      );
      if (!result.ok) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: result.message || '해지 상태를 바꾸지 못했어요.' },
        ]);
        return;
      }
      setMessages((prev) => prev.map((row) => (row.id === messageId ? { ...row, confirmed: true } : row)));
      await onReload();
    } catch (caught) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: caught instanceof Error ? caught.message : '해지 상태를 바꾸지 못했어요.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSelectCandidate(messageId: string, candidate: Subscription) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (item?.pendingActionId && item.sessionVersion != null) {
      void (async () => {
        const result = await bindPendingAssistantTarget(
          item.pendingActionId!,
          candidate.id,
          item.sessionVersion!
        );
        if (!result.ok) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', text: result.message },
          ]);
          return;
        }
        setMessages((prev) =>
          prev.map((row) => {
            if (row.id !== messageId || !row.pendingAction) return row;
            const preview =
              row.pendingAction === 'update'
                ? mergeExtractIntoSubscription(candidate, row.pendingExtract ?? null, categoriesRef.current)
                : subscriptionToParsed(candidate);
            const showConfirm = row.pendingAction !== 'update' ||
              pendingExtractHasUpdateValue(row.pendingExtract);
            const ask = row.pendingAction === 'update' && !showConfirm
              ? `${candidate.name}의 현재 요금은 ${formatCurrency(candidate.amount)}이에요. 얼마로 바꿀까요?`
              : row.text;
            return {
              ...row,
              text: ask,
              action: showConfirm ? row.pendingAction : undefined,
              subscriptionId: showConfirm ? candidate.id : undefined,
              previousAmount: showConfirm ? candidate.amount : undefined,
              preview: showConfirm ? preview : undefined,
              candidatesResolved: true,
              sessionVersion: result.session?.version ?? row.sessionVersion,
            };
          })
        );
      })();
      return;
    }

    setMessages((prev) =>
      prev.map((item) => {
        if (item.id !== messageId || !item.pendingAction) return item;
        const preview =
          item.pendingAction === 'update'
            ? mergeExtractIntoSubscription(candidate, item.pendingExtract ?? null, categoriesRef.current)
            : subscriptionToParsed(candidate);
        const showConfirm = item.pendingAction !== 'update' ||
          pendingExtractHasUpdateValue(item.pendingExtract);
        const ask = item.pendingAction === 'update' && !showConfirm
          ? `${candidate.name}의 현재 요금은 ${formatCurrency(candidate.amount)}이에요. 얼마로 바꿀까요?`
          : item.text;
        return {
          ...item,
          text: ask,
          action: showConfirm ? item.pendingAction : undefined,
          subscriptionId: showConfirm ? candidate.id : undefined,
          previousAmount: showConfirm ? candidate.amount : undefined,
          preview: showConfirm ? preview : undefined,
          candidatesResolved: true,
        };
      })
    );
  }

  function handleReselect(messageId: string) {
    setMessages((prev) =>
      prev.map((item) =>
        item.id === messageId
          ? {
              ...item,
              action: undefined,
              subscriptionId: undefined,
              preview: undefined,
              candidatesResolved: false,
            }
          : item
      )
    );
  }

  async function handlePickCancelIntent(messageId: string, asGuide: boolean) {
    const item = messagesRef.current.find((row) => row.id === messageId);
    if (!item?.pendingCancel) return;
    if (!asGuide) {
      const targets = resolveCancelListDeleteTargets(item, subscriptionsRef.current);
      const only = targets.length === 1 ? targets[0] : null;
      if (targets.length === 0) {
        setMessages((prev) =>
          prev.map((row) =>
            row.id === messageId ? { ...row, pendingCancel: undefined } : row
          )
        );
        void send('목록에서 삭제');
        return;
      }
      setMessages((prev) =>
        prev.map((row) => {
          if (row.id !== messageId) return row;
          if (only) {
            return {
              ...row,
              text: '목록에서 구독을 지울게요. 아래 카드에서 확인해 주세요.',
              pendingCancel: undefined,
              action: 'delete',
              subscriptionId: only.id,
              previousAmount: only.amount,
              preview: subscriptionToParsed(only),
            };
          }
          return {
            ...row,
            text: '어떤 구독을 목록에서 삭제할까요?',
            pendingCancel: undefined,
            candidates: targets,
            pendingAction: 'delete',
            candidatesResolved: false,
          };
        })
      );
      return;
    }
    setSending(true);
    try {
      await requestCancelGuide(
        messageId,
        { ...item.pendingCancel, question_snippet: '해지 방법 알려줘' },
        item.saveChannelTargetId
      );
    } catch (caught) {
      setMessages((prev) =>
        prev.map((row) =>
          row.id === messageId
            ? { ...row, text: caught instanceof Error ? caught.message : '해지 안내에 실패했습니다.' }
            : row
        )
      );
    } finally {
      setSending(false);
    }
  }

  function handleDeleteGuideTarget(messageId: string, subscriptionId: string) {
    const target = subscriptionsRef.current.find((row) => row.id === subscriptionId);
    if (!target) return;
    setMessages((prev) =>
      prev.map((row) =>
        row.id === messageId
          ? {
              ...row,
              text: '목록에서 구독을 지울게요. 아래 카드에서 확인해 주세요.',
              action: 'delete',
              subscriptionId: target.id,
              previousAmount: target.amount,
              preview: subscriptionToParsed(target),
            }
          : row
      )
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  async function applyAttachedFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachError(null);
    if (files.length > 1) {
      setPendingImage(null);
      setAttachError(`${MULTI_RECEIPT_TITLE}\n${MULTI_RECEIPT_MESSAGE}`);
      return;
    }
    try {
      const next = await readReceiptFile(files[0]);
      setPendingImage(next);
    } catch (caught) {
      setPendingImage(null);
      setAttachError(caught instanceof Error ? caught.message : '이미지를 읽지 못했습니다.');
    }
  }

  // 확인 카드가 열려 있으면 다른 명령을 권하지 않는다. 사용자가 무엇에 답해야 하는지 흐려진다.
  const last = messages[messages.length - 1];
  const lastHasOpenCard = Boolean(
    last &&
      last.role === 'assistant' &&
      !last.dismissed &&
      !last.confirmed &&
      (last.action || last.candidates?.length || last.duplicateCreate || last.awaitingSkip ||
        last.usageCheckin || last.lifecycleUpdate || last.pendingCancel || last.cancelGuide)
  );
  const suggestions = sending || !last || last.role !== 'assistant' || lastHasOpenCard
    ? []
    : messages.some((item) => item.role === 'user')
    ? followUpSuggestions(last.intent)
    : STARTER_SUGGESTIONS;
  // 인사말 메시지 하나만 있고 사용자가 아직 아무 말도 안 한 상태 — 대화가 사실상 비어있는 첫 화면이다.
  const isWelcome = messages.length === 1 && messages[0].id === 'greeting';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="flex-1 bg-black/20" aria-label="비서 닫기" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[400px] flex-col border-l border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-extrabold text-text">AI 비서</p>
            <p className="text-xs text-muted">말로 등록·변경·해지 안내까지 도와드려요</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleRestartChat()}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-text hover:bg-background"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:text-text"
            >
              닫기
            </button>
          </div>
        </header>
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {isWelcome ? (
            <div>
              <p className="text-2xl font-extrabold text-primary">안녕하세요!</p>
              <p className="mt-1 text-xl font-extrabold text-text">무엇을 도와드릴까요?</p>
            </div>
          ) : null}
          {messages.map((item) =>
            item.role === 'user' ? (
              <div key={item.id} className="ml-8 space-y-1">
                {item.imageUri ? (
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <img
                      src={item.imageUri}
                      alt={item.imageName ?? '첨부한 영수증'}
                      className="max-h-48 w-full object-cover"
                    />
                  </div>
                ) : null}
                {item.text ? (
                  <div className="rounded-2xl bg-primary px-3 py-2 text-sm text-white">{item.text}</div>
                ) : null}
              </div>
            ) : (
              <div key={item.id} className="mr-4 space-y-2">
                {item.text ? (
                  <div className="whitespace-pre-line rounded-2xl bg-accent px-3 py-2 text-sm text-text">
                    {breakChatSentences(stripChatMarkdown(item.text))}
                  </div>
                ) : null}
                {item.categoryCandidates && !item.dismissed ? (
                  <SuggestionChips
                    suggestions={item.categoryCandidates}
                    disabled={sending}
                    onSelect={(name) => void send(`${name} 카테고리 보여줘`)}
                  />
                ) : null}
                {item.paymentInstrumentRequest && !item.dismissed && !item.paymentInstrumentStep ? (
                  <SuggestionChips
                    suggestions={['계좌', '신용카드', '체크카드']}
                    disabled={sending}
                    onSelect={(label) => {
                      const kind = label === '계좌' ? 'bank' : 'card';
                      const cardType = label === '신용카드' ? 'credit' : label === '체크카드' ? 'check' : undefined;
                      setMessages((prev) =>
                        prev.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                paymentInstrumentStep: 'picker',
                                paymentInstrumentKind: kind,
                                paymentInstrumentCardType: cardType,
                              }
                            : row
                        )
                      );
                    }}
                  />
                ) : null}
                {item.paymentInstrumentStep === 'picker' && item.paymentInstrumentKind ? (
                  <InstitutionPicker
                    classification="personal"
                    onClassification={() => {}}
                    onBack={() =>
                      setMessages((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row))
                      )
                    }
                    onSelect={(nextKind, key) =>
                      setMessages((prev) =>
                        prev.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                paymentInstrumentStep: 'form',
                                paymentInstrumentKind: nextKind,
                                paymentInstrumentInstitutionKey: key,
                              }
                            : row
                        )
                      )
                    }
                  />
                ) : null}
                {item.paymentInstrumentStep === 'form' &&
                item.paymentInstrumentKind &&
                item.paymentInstrumentInstitutionKey ? (
                  <InstrumentForm
                    kind={item.paymentInstrumentKind}
                    institutionKey={item.paymentInstrumentInstitutionKey}
                    classification="personal"
                    editing={null}
                    saving={false}
                    defaultCardType={item.paymentInstrumentCardType}
                    onClassification={() => {}}
                    onChangeInstitution={() =>
                      setMessages((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, paymentInstrumentStep: 'picker' } : row))
                      )
                    }
                    onCancel={() =>
                      setMessages((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row))
                      )
                    }
                    onSave={async (input) => {
                      await createPaymentInstrument(input);
                      const institution = findInstitution(input.kind, input.institution_key);
                      setMessages((prev) => [
                        ...prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row)),
                        {
                          id: nextId(),
                          role: 'assistant',
                          text: '결제수단을 등록했어요.',
                          paymentInstrumentSaved: {
                            name: input.name,
                            kind: input.kind,
                            last4: input.number_last4,
                            institution: institution?.name ?? input.institution_key,
                            cardType: input.card_type ?? undefined,
                          },
                        },
                      ]);
                    }}
                  />
                ) : null}
                {item.paymentInstrumentSaved && !item.dismissed ? (
                  <div className="rounded-2xl border border-border bg-surface p-3">
                    <p className="truncate text-sm font-bold text-text">{item.paymentInstrumentSaved.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {item.paymentInstrumentSaved.institution}
                      {item.paymentInstrumentSaved.cardType
                        ? ` · ${item.paymentInstrumentSaved.cardType === 'credit' ? '신용카드' : '체크카드'}`
                        : item.paymentInstrumentSaved.kind === 'bank'
                          ? ' · 계좌'
                          : ''}
                      {' · '}
                      {item.paymentInstrumentSaved.last4}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setMessages((prev) => [
                            ...prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row)),
                            {
                              id: nextId(),
                              role: 'assistant',
                              text: '어떤 결제수단을 추가할까요? 계좌, 신용카드, 체크카드 중에 골라 주세요.',
                              paymentInstrumentRequest: true,
                            },
                          ])
                        }
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-primary"
                      >
                        + 추가
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMessages((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row))
                          )
                        }
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted"
                      >
                        그만하기
                      </button>
                    </div>
                  </div>
                ) : null}
                {item.listed && item.listed.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                    {item.listed.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <p className="min-w-0 flex-1 truncate text-xs font-bold text-text">{row.name}</p>
                        <p className="text-xs font-bold tabular-nums">{formatCurrency(row.amount)}</p>
                        <p className="w-[4.5rem] text-right text-[11px] text-muted">
                          {formatShortDate(row.next_payment_date)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.extract && !item.dismissed ? (
                  <ChatInlineCard
                    parsed={item.extract}
                    categories={categories}
                    registered={item.registered}
                    editedViaModal={item.editedViaModal}
                    nameNeedsReview={item.nameNeedsReview}
                    onRegister={() => void handleRegister(item.id)}
                    onEdit={() => {
                      const parsed = withInferredCategory(item.extract!, categories);
                      const wasRegistered = Boolean(item.registered);
                      const id = wasRegistered
                        ? item.subscriptionId ?? matchCreatedSubscription(subscriptions, parsed)?.id
                        : undefined;
                      onEditDraft(parsed, id, (saved) => handleModalSaved(item.id, saved, wasRegistered));
                    }}
                    onDismiss={() => void handleSkipAction(item.id)}
                  />
                ) : null}
                {item.usageCheckin && !item.dismissed
                  ? (() => {
                      const target = subscriptions.find(
                        (row) => row.id === item.usageCheckin?.subscription_id
                      );
                      return target ? (
                        <UsageCheckinCard
                          subscription={target}
                          response={item.usageCheckin.response}
                          confirmed={item.confirmed}
                          saving={sending}
                          onConfirm={() => void handleConfirmUsageCheckin(item.id)}
                          onSkip={() => void handleSkipAction(item.id)}
                        />
                      ) : null;
                    })()
                  : null}
                {item.cleanupRecommendations?.map((rec) => (
                  <CleanupRecommendCard
                    key={rec.id}
                    item={rec}
                    onAskGuide={() => void send(`${rec.name} 해지 방법 알려줘`)}
                  />
                ))}
                {item.lifecycleUpdate && !item.dismissed
                  ? (() => {
                      const target = subscriptions.find(
                        (row) => row.id === item.lifecycleUpdate?.subscription_id
                      );
                      return (
                        <LifecycleConfirmCard
                          name={target?.name ?? '이 구독'}
                          to={item.lifecycleUpdate.to}
                          serviceEndDate={item.lifecycleUpdate.service_end_date}
                          confirmed={item.confirmed}
                          saving={sending}
                          onConfirm={() => void handleConfirmLifecycle(item.id)}
                          onSkip={() => void handleSkipAction(item.id)}
                        />
                      );
                    })()
                  : null}
                {item.action && item.subscriptionId && item.preview && !item.dismissed ? (
                  <>
                    <ChatActionCard
                      action={item.action}
                      parsed={item.preview}
                      categories={categories}
                      previousAmount={item.previousAmount}
                      confirmed={item.confirmed}
                      expired={isAssistantActionExpired(item.expiresAt)}
                      onConfirm={() =>
                        void handleConfirmAction(item.id, item.action!, item.subscriptionId!, item.preview!)
                      }
                      onSkip={() => void handleSkipAction(item.id)}
                    />
                    {item.candidates && item.candidates.length > 1 && !item.confirmed ? (
                      <button
                        type="button"
                        onClick={() => handleReselect(item.id)}
                        className="text-xs font-semibold text-primary"
                      >
                        다른 구독이었나요? 다시 고르기
                      </button>
                    ) : null}
                  </>
                ) : null}
                {item.candidates && item.candidates.length > 0 && !item.candidatesResolved && !item.dismissed ? (
                  <div className="space-y-2">
                    <div className="flex w-full flex-none flex-row items-stretch gap-2 overflow-x-auto pb-1">
                      {item.candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => handleSelectCandidate(item.id, candidate)}
                          className="w-52 shrink-0 self-stretch rounded-xl border border-border bg-surface px-3 py-2.5 text-left"
                        >
                          <p className="truncate text-xs font-bold text-text">{candidate.name}</p>
                          {candidateDetailLines(candidate).map((line, index) => (
                            <p
                              key={`${candidate.id}-${index}`}
                              className="break-all text-[11px] leading-[15px] text-muted"
                            >
                              {line}
                            </p>
                          ))}
                        </button>
                      ))}
                    </div>
                    {item.duplicateCreate ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.candidates?.length === 1) {
                              handleSelectCandidate(item.id, item.candidates[0]);
                            }
                          }}
                          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                        >
                          변경
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (item.fromReceiptImage && item.pendingExtract) {
                              const parsed = toParsedSubscription(item.pendingExtract, categories);
                              if (!parsed) return;
                              setMessages((prev) =>
                                prev.map((row) =>
                                  row.id === item.id
                                    ? { ...row, duplicateCreate: false, candidatesResolved: true, extract: parsed }
                                    : row
                                )
                              );
                              return;
                            }
                            void send('별도 구독');
                          }}
                          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                        >
                          별도로 추가
                        </button>
                        {item.fromReceiptImage ? null : (
                          <button
                            type="button"
                            onClick={() => void send('목록에서 삭제')}
                            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                          >
                            삭제
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleSkipAction(item.id)}
                          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                        >
                          그대로 두기
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSkipAction(item.id)}
                        className="text-xs font-semibold text-muted hover:text-text"
                      >
                        대화 이어가기
                      </button>
                    )}
                  </div>
                ) : null}
                {item.cancelGuide
                  ? (() => {
                      const targetId =
                        item.saveChannelTargetId ??
                        item.pendingCancel?.subscription_id ??
                        item.subscriptionId;
                      const target = targetId
                        ? subscriptions.find((row) => row.id === targetId)
                        : undefined;
                      return (
                        <CancelGuideCard
                          guide={item.cancelGuide}
                          subscriptionId={targetId}
                          lifecycleStatus={target?.lifecycle_status}
                          nextPaymentDate={target?.next_payment_date}
                          onChanged={async () => {
                            await onReload();
                          }}
                          onDeleteFromList={(subId) => handleDeleteGuideTarget(item.id, subId)}
                        />
                      );
                    })()
                  : null}
                {item.pendingCancel && !item.dismissed && item.text?.includes('앱 목록에서 지울까요') ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePickCancelIntent(item.id, true)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                    >
                      해지 방법 안내
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePickCancelIntent(item.id, false)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text"
                    >
                      목록에서 삭제
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSkipAction(item.id)}
                      className="text-xs font-semibold text-muted hover:text-text"
                    >
                      대화 이어가기
                    </button>
                  </div>
                ) : null}
                {item.awaitingSkip && !item.dismissed && !item.confirmed ? (
                  <button
                    type="button"
                    onClick={() => void handleSkipAction(item.id)}
                    className="text-xs font-semibold text-muted hover:text-text"
                  >
                    대화 이어가기
                  </button>
                ) : null}
              </div>
            )
          )}
          <SuggestionChips
            suggestions={suggestions}
            disabled={sending}
            onSelect={(text) => void send(text)}
            size={isWelcome ? 'lg' : 'sm'}
          />
          {sending ? <p className="text-xs text-muted">생각 중…</p> : null}
        </div>
        <form onSubmit={onSubmit} className="border-t border-border p-3">
          {attachError ? <p className="mb-2 whitespace-pre-line text-xs text-danger">{attachError}</p> : null}
          {pendingImage ? (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-background px-2 py-2">
              <img
                src={pendingImage.previewUrl}
                alt="첨부한 영수증"
                className="size-10 shrink-0 rounded-lg object-cover"
              />
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-text">{pendingImage.fileName}</p>
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="text-xs font-semibold text-muted hover:text-text"
              >
                취소
              </button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              className="hidden"
              onChange={(event) => {
                void applyAttachedFile(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="영수증 사진 첨부"
              className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-text"
            >
              사진
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="메시지를 입력하세요."
              className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={sending || (!draft.trim() && !pendingImage)}
              className="shrink-0 whitespace-nowrap rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              보내기
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">AI는 실수할 수 있습니다. 응답을 다시 한번 확인해 주세요.</p>
        </form>
      </aside>
    </div>
  );
}
