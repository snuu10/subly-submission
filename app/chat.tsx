import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatActionCard } from '@/components/ChatActionCard';
import { CancelGuideCard } from '@/components/CancelGuideCard';
import { ChatInlineCard } from '@/components/ChatInlineCard';
import { CleanupRecommendCard } from '@/components/CleanupRecommendCard';
import { LifecycleConfirmCard } from '@/components/LifecycleConfirmCard';
import { SuggestionChips } from '@/components/SuggestionChips';
import { UsageCheckinCard } from '@/components/UsageCheckinCard';
import { ScreenNav, ScreenShell } from '@/components/ScreenNav';
import { STARTER_SUGGESTIONS, followUpSuggestions } from '@/constants/assistant-suggestions';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { stripChatMarkdown, breakChatSentences, candidateDetailLines, listReplyCaption, resolveRankedSubscriptions, matchCreatedSubscription, keepsAssistantFollowup, resolveCancelListDeleteTargets, isListLikeAssistantIntent, pendingExtractHasUpdateValue } from '@/lib/chat-text';
import {
  bindPendingAssistantTarget,
  confirmPendingAssistantAction,
  invokeAssistantTurn,
  loadAssistantSession,
  resetAssistantSession,
  skipAssistantFollowup,
} from '@/lib/assistant-turn';
import { invokeCancelGuide } from '@/lib/cancel-guide';
import { invokeClaude } from '@/lib/claude';
import { notify } from '@/lib/confirm';
import { duplicateAccountIssue, duplicateAccountMessage } from '@/lib/duplicate-account';
import { advanceSubscriptionLifecycle, syncMyLifecycleDue } from '@/lib/lifecycle';
import {
  extractFromPending,
  isAssistantActionExpired,
  parsedFromPendingExtract,
  type CleanupRecommendation,
  type LifecycleUpdatePayload,
} from '@/types/assistant-turn';
import { recordAssistantCheckin } from '@/lib/briefing-events';
import {
  mergeExtractIntoSubscription,
  subscriptionToParsed,
  toParsedSubscription,
  withInferredCategory,
} from '@/lib/extract';
import { newIdempotencyKey, resolveAssistantUsageCheckin } from '@/lib/usage-checkin';
import { pickReceiptImage, claudeMediaType, type PickedReceipt } from '@/lib/image-pick';
import { useCategoryStore } from '@/stores/category-store';
import {
  computeNextPaymentDate,
  formatCurrency,
  formatShortDate,
  getDaysUntil,
  getMonthlyTotal,
  getUpcomingSubscriptions,
  useSubscriptionStore,
} from '@/stores/subscription-store';
import type { CancelGuideRequest, CancelGuideResponse } from '@/types/cancel-guide';
import type { AssistantTurnResponse } from '@/types/assistant-turn';
import type { ClaudeBriefingContext, ClaudeExtract, ClaudeManageAction, ClaudeUsageCheckin, ParsedSubscription } from '@/types/extract';
import type { Subscription, LifecycleStatus } from '@/types/subscription';

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
  /** 이미 등록된 항목을 채팅 카드의 "수정"으로 열어 모달에서 다시 저장했는지. */
  editedViaModal?: boolean;
  dismissed?: boolean;
  action?: ClaudeManageAction;
  subscriptionId?: string;
  preview?: ParsedSubscription;
  previousAmount?: number;
  confirmed?: boolean;
  /** 동명 구독이 여러 개일 때 사용자가 고를 후보. 고르기 전까지는 action/preview를 만들지 않는다. */
  candidates?: Subscription[];
  pendingAction?: ClaudeManageAction;
  pendingExtract?: ClaudeExtract | null;
  /** 후보 중 하나를 골라 확인 카드가 떴는지. false/undefined면 칩 목록을 보여준다. */
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
  /** 등록 초안이 동명과 겹칠 때 변경/별도 추가/유지 칩 */
  duplicateCreate?: boolean;
  /** 영수증 이미지에서 만들어진 duplicateCreate 카드인지("별도로 추가"의 로컬 처리 분기용). */
  fromReceiptImage?: boolean;
  /** 계정 필요 알림 후 이 카드가 채팅 답장을 기다리는 중인지. */
  awaitingAccount?: boolean;
  intent?: string;
  categoryCandidates?: string[];
  /** "결제수단 추가하고 싶어" 요청 — 계좌/신용카드/체크카드 버튼을 보여준다. */
  paymentInstrumentRequest?: boolean;
  /** 결제수단 등록 완료 후 돌아와서 보여줄 요약 카드. */
  paymentInstrumentSaved?: {
    name: string;
    kind: string;
    last4: string;
    institution: string;
    cardType?: string;
  };
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

/** assistant-turn 서버(gemini-intent.ts)의 판별 로직을 이 화면 전용으로 복제한 것 — 런타임이 달라 직접 import할 수 없다. */
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

function firstParam(value?: string | string[]): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
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

export function ChatScreen({ hideBack = false }: { hideBack?: boolean }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { openAdd, openEdit } = useSubscriptionModal();
  const addSubscription = useSubscriptionStore((state) => state.addSubscription);
  const updateSubscription = useSubscriptionStore((state) => state.updateSubscription);
  const removeSubscription = useSubscriptionStore((state) => state.removeSubscription);
  const toggleActive = useSubscriptionStore((state) => state.toggleActive);
  const fetchSubscriptions = useSubscriptionStore((state) => state.fetchSubscriptions);
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const categories = useCategoryStore((state) => state.categories);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const params = useLocalSearchParams<{
    prompt?: string | string[];
    eventId?: string | string[];
    subscriptionId?: string | string[];
    intent?: string | string[];
    entrySource?: string | string[];
    pmSaved?: string | string[];
    pmKind?: string | string[];
    pmLast4?: string | string[];
    pmInstitution?: string | string[];
    pmCardType?: string | string[];
  }>();
  const briefingContextRef = useRef<ClaudeBriefingContext | undefined>(undefined);
  const [messages, setMessages] = useState<ChatItem[]>(() => [
    greetingItem(buildGreetingText(useSubscriptionStore.getState().subscriptions)),
  ]);
  const [draft, setDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PickedReceipt | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const prompt = firstParam(params.prompt);
    const eventId = firstParam(params.eventId);
    const subscriptionId = firstParam(params.subscriptionId);
    const intent = firstParam(params.intent);
    const entrySource = firstParam(params.entrySource);
    if (eventId || subscriptionId || intent || entrySource) {
      briefingContextRef.current = {
        event_id: eventId,
        subscription_id: subscriptionId,
        intent,
        entry_source: entrySource,
      };
    }
    if (!prompt && !eventId && !subscriptionId && !intent && !entrySource) return;
    if (prompt) setDraft(prompt);
    router.setParams({
      prompt: undefined,
      eventId: undefined,
      subscriptionId: undefined,
      intent: undefined,
      entrySource: undefined,
    });
  }, [params.prompt, params.eventId, params.subscriptionId, params.intent, params.entrySource]);

  useEffect(() => {
    const name = firstParam(params.pmSaved);
    const kind = firstParam(params.pmKind);
    const last4 = firstParam(params.pmLast4);
    const institution = firstParam(params.pmInstitution);
    if (!name || !kind || !last4 || !institution) return;
    const cardType = firstParam(params.pmCardType);
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: 'assistant',
        text: '결제수단을 등록했어요.',
        paymentInstrumentSaved: { name, kind, last4, institution, cardType },
      },
    ]);
    router.setParams({ pmSaved: undefined, pmKind: undefined, pmLast4: undefined, pmInstitution: undefined, pmCardType: undefined });
  }, [params.pmSaved, params.pmKind, params.pmLast4, params.pmInstitution, params.pmCardType]);

  useEffect(() => {
    const text = buildGreetingText(subscriptions);
    setMessages((prev) => {
      const first = prev[0];
      if (prev.length !== 1 || first?.id !== 'greeting' || first.text === text) {
        return prev;
      }
      return [greetingItem(text)];
    });
  }, [subscriptions]);

  useEffect(() => {
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
        const cats = useCategoryStore.getState().categories;
        const subs = useSubscriptionStore.getState().subscriptions;
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
        // 세션이 없어도 채팅은 열린다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToEnd = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const handleAttach = async () => {
    const picked = await pickReceiptImage('library');
    if (picked) setPendingImage(picked);
  };

  const handleRegister = async (id: string, parsed: ParsedSubscription) => {
    const item = messages.find((row) => row.id === id);
    if (item?.dismissed) return;
    if (item?.pendingActionId && item.sessionVersion != null) {
      if (isAssistantActionExpired(item.expiresAt)) {
        notify('만료됨', '확인 시간이 지났습니다. 다시 요청해 주세요.');
        return;
      }
      try {
        const result = await confirmPendingAssistantAction(item.pendingActionId, item.sessionVersion);
        if (!result.ok && result.code !== 'already_completed') {
          notify('등록 실패', result.message);
          return;
        }
        await fetchSubscriptions();
        const createdId = result.session?.selected_subscription_id
          ?? matchCreatedSubscription(useSubscriptionStore.getState().subscriptions, parsed)?.id;
        setMessages((prev) =>
          prev.map((row) => (row.id === id
            ? { ...row, registered: true, sessionVersion: result.session?.version, subscriptionId: createdId ?? row.subscriptionId }
            : row))
        );
      } catch (error) {
        notify('등록 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
      }
      return;
    }

    // 영수증 이미지는 claude-proxy를 타므로 서버 pending action이 없다.
    // 만료된 게 아니라 확인 토큰이 애초에 없는 것이라, 수동 등록과 같은 경로로 바로 저장한다.
    const issue = duplicateAccountIssue(useSubscriptionStore.getState().subscriptions, {
      name: parsed.name,
      account_id: parsed.account_id,
      preset_id: parsed.preset_id,
    });
    if (issue) {
      setMessages((prev) => prev.map((row) => (row.id === id ? { ...row, awaitingAccount: true } : row)));
      notify('계정 필요', `${duplicateAccountMessage(issue)} 채팅으로 바로 답장해도 등록돼요.`);
      return;
    }

    try {
      const created = await addSubscription({
        name: parsed.name,
        amount: parsed.amount,
        billing_cycle: parsed.billing_cycle,
        category_id: parsed.category_id,
        anchor_date: parsed.anchor_date,
        next_payment_date: parsed.next_payment_date
          ?? computeNextPaymentDate(parsed.anchor_date, parsed.billing_cycle),
        preset_id: parsed.preset_id,
        is_active: true,
        account_id: parsed.account_id,
      });
      if (!created) {
        notify('등록 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
        return;
      }
      setMessages((prev) =>
        prev.map((row) => (row.id === id ? { ...row, registered: true, subscriptionId: created.id } : row))
      );
    } catch (error) {
      notify('등록 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
    }
  };

  const focusComposer = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const skipFollowupForItem = async (item: ChatItem, notifyOnError: boolean) => {
    try {
      const result = await skipAssistantFollowup(
        item.pendingActionId,
        item.pendingActionId ? item.sessionVersion : null
      );
      if (!result.ok && result.code !== 'already_cancelled' && result.code !== 'not_pending') {
        if (notifyOnError) notify('이어가기 실패', result.message);
        return false;
      }
      return true;
    } catch (caught) {
      if (notifyOnError) {
        notify('이어가기 실패', caught instanceof Error ? caught.message : '다시 시도해 주세요.');
      }
      return false;
    }
  };

  const applySkip = (ids: string[], followUp: boolean) => {
    setMessages((prev) => {
      const next = prev.map((item) => (ids.includes(item.id) ? markActionSkipped(item) : item));
      if (!followUp) return next;
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.text === SKIP_FOLLOWUP) return next;
      return [...next, { id: nextId(), role: 'assistant', text: SKIP_FOLLOWUP }];
    });
  };

  const handleSkipAction = async (messageId: string) => {
    const item = messages.find((row) => row.id === messageId);
    if (!item) return;
    const ok = await skipFollowupForItem(item, true);
    if (!ok) return;
    applySkip([messageId], true);
    focusComposer();
    scrollToEnd();
  };

  const dismissOpenActions = async (followupText?: string) => {
    if (followupText && keepsAssistantFollowup(followupText)) return;
    const open = messages.filter(isOpenActionItem);
    if (open.length === 0) return;
    const pendingItem = [...open].reverse().find((row) => row.pendingActionId);
    if (pendingItem) await skipFollowupForItem(pendingItem, false);
    applySkip(
      open.map((item) => item.id),
      false
    );
  };

  const handleRestartChat = async () => {
    try {
      await resetAssistantSession();
    } catch {
      // 세션이 없어도 화면은 처음부터 다시 연다.
    }
    setDraft('');
    setPendingImage(null);
    setMessages([greetingItem(buildGreetingText(useSubscriptionStore.getState().subscriptions))]);
    focusComposer();
  };

  const handleModalSaved = (itemId: string, saved: Subscription, wasRegistered: boolean) => {
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
  };

  const handleEdit = (item: ChatItem) => {
    if (item.registered) {
      const id = item.subscriptionId
        ?? (item.extract
          ? matchCreatedSubscription(useSubscriptionStore.getState().subscriptions, item.extract)?.id
          : undefined);
      if (id) {
        openEdit(id, (saved) => handleModalSaved(item.id, saved, true));
        return;
      }
    }
    const parsed = item.extract;
    if (!parsed) return;
    const toEdit = withInferredCategory(parsed, useCategoryStore.getState().categories);
    openAdd(
      {
        name: toEdit.name,
        amount: toEdit.amount,
        billing_cycle: toEdit.billing_cycle,
        category_id: toEdit.category_id,
        anchor_date: toEdit.anchor_date,
        account_id: toEdit.account_id,
        preset_id: toEdit.preset_id,
      },
      (saved) => handleModalSaved(item.id, saved, false)
    );
  };

  const handleConfirmAction = async (
    messageId: string,
    action: ClaudeManageAction,
    subscriptionId: string,
    preview: ParsedSubscription
  ) => {
    const item = messages.find((row) => row.id === messageId);
    if (item?.dismissed) return;
    if (item?.pendingActionId && item.sessionVersion != null) {
      if (isAssistantActionExpired(item.expiresAt)) {
        notify('만료됨', '확인 시간이 지났습니다. 다시 요청해 주세요.');
        return;
      }
      try {
        const result = await confirmPendingAssistantAction(
          item.pendingActionId,
          item.sessionVersion,
          subscriptionId
        );
        if (!result.ok && result.code !== 'already_completed') {
          notify('변경 실패', result.message);
          return;
        }
        await fetchSubscriptions();
        setMessages((prev) =>
          prev.map((row) =>
            row.id === messageId ? { ...row, confirmed: true, sessionVersion: result.session?.version } : row
          )
        );
      } catch (error) {
        notify('변경 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
      }
      return;
    }

    const current = useSubscriptionStore
      .getState()
      .subscriptions.find((item) => item.id === subscriptionId);
    const toSave = withInferredCategory(preview, useCategoryStore.getState().categories);

    if (action === 'update') {
      if (!current) {
        notify('변경 실패', '구독을 찾지 못했어요.');
        return;
      }
      const updated = await updateSubscription(subscriptionId, {
        name: toSave.name,
        amount: toSave.amount,
        billing_cycle: toSave.billing_cycle,
        category_id: toSave.category_id,
        anchor_date: toSave.anchor_date,
        next_payment_date: computeNextPaymentDate(toSave.anchor_date, toSave.billing_cycle),
        preset_id: toSave.preset_id,
        is_active: current.is_active,
        memo: current.memo,
        emoji: current.emoji,
        account_id: toSave.account_id,
      });
      if (!updated) {
        notify('변경 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
        return;
      }
    } else if (action === 'delete') {
      await removeSubscription(subscriptionId);
      const error = useSubscriptionStore.getState().error;
      if (error) {
        notify('삭제 실패', error);
        return;
      }
    } else if (action === 'pause') {
      if (!current) {
        notify('변경 실패', '구독을 찾지 못했어요.');
        return;
      }
      if (current.is_active) {
        await toggleActive(subscriptionId);
        const error = useSubscriptionStore.getState().error;
        if (error) {
          notify('변경 실패', error);
          return;
        }
      }
    } else if (action === 'resume') {
      if (!current) {
        notify('변경 실패', '구독을 찾지 못했어요.');
        return;
      }
      if (!current.is_active) {
        await toggleActive(subscriptionId);
        const error = useSubscriptionStore.getState().error;
        if (error) {
          notify('변경 실패', error);
          return;
        }
      }
    }

    setMessages((prev) =>
      prev.map((item) => (item.id === messageId ? { ...item, confirmed: true } : item))
    );
  };

  const handleConfirmUsageCheckin = async (messageId: string) => {
    const item = messages.find((row) => row.id === messageId);
    if (!item?.usageCheckin || item.confirmed || sending) return;
    setSending(true);
    try {
      const result = await recordAssistantCheckin(
        item.usageCheckin.subscription_id,
        item.usageCheckin.response,
        item.usageIdempotencyKey || newIdempotencyKey(),
        'assistant'
      );
      if (!result.ok && result.code !== 'already_answered') {
        notify('저장 실패', result.message || '사용 여부를 저장하지 못했어요.');
        return;
      }
      setMessages((prev) =>
        prev.map((row) => (row.id === messageId ? { ...row, confirmed: true } : row))
      );
    } finally {
      setSending(false);
    }
  };

  const handleConfirmLifecycle = async (messageId: string) => {
    const item = messages.find((row) => row.id === messageId);
    if (!item?.lifecycleUpdate || item.confirmed || sending) return;
    setSending(true);
    try {
      const result = await advanceSubscriptionLifecycle(
        item.lifecycleUpdate.subscription_id,
        item.lifecycleUpdate.to as LifecycleStatus,
        item.lifecycleUpdate.service_end_date,
      );
      if (!result.ok) {
        notify('반영 실패', result.message);
        return;
      }
      setMessages((prev) =>
        prev.map((row) => (row.id === messageId ? { ...row, confirmed: true } : row))
      );
      await fetchSubscriptions();
    } catch (error) {
      notify('반영 실패', error instanceof Error ? error.message : '해지 상태를 바꾸지 못했어요.');
    } finally {
      setSending(false);
    }
  };

  const handleSelectCandidate = (messageId: string, candidate: Subscription) => {
    const item = messages.find((row) => row.id === messageId);
    if (item?.pendingActionId && item.sessionVersion != null) {
      void (async () => {
        const result = await bindPendingAssistantTarget(
          item.pendingActionId!,
          candidate.id,
          item.sessionVersion!
        );
        if (!result.ok) {
          notify('선택 실패', result.message);
          return;
        }
        setMessages((prev) =>
          prev.map((row) => {
            if (row.id !== messageId || !row.pendingAction) return row;
            const preview =
              row.pendingAction === 'update'
                ? mergeExtractIntoSubscription(candidate, row.pendingExtract ?? null, categories)
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
            ? mergeExtractIntoSubscription(candidate, item.pendingExtract ?? null, categories)
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
  };

  const handleReselect = (messageId: string) => {
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
  };

  const applyCancelGuide = (
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
  };

  const requestCancelGuide = async (
    messageId: string,
    request: CancelGuideRequest,
    targetId?: string
  ) => {
    const response = await invokeCancelGuide(request);
    return applyCancelGuide(messageId, response, request, targetId);
  };

  const handlePickCancelIntent = async (messageId: string, asGuide: boolean) => {
    const item = messages.find((row) => row.id === messageId);
    if (!item?.pendingCancel) return;
    if (!asGuide) {
      const targets = resolveCancelListDeleteTargets(item, subscriptions);
      const only = targets.length === 1 ? targets[0] : null;
      if (targets.length === 0) {
        setMessages((prev) =>
          prev.map((row) =>
            row.id === messageId ? { ...row, pendingCancel: undefined } : row
          )
        );
        void handleSend('목록에서 삭제');
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
    } catch (error) {
      setMessages((prev) =>
        prev.map((row) =>
          row.id === messageId
            ? { ...row, text: error instanceof Error ? error.message : '해지 안내에 실패했습니다.' }
            : row
        )
      );
    } finally {
      setSending(false);
    }
  };

  const handleDeleteGuideTarget = (messageId: string, subscriptionId: string) => {
    const target = subscriptions.find((row) => row.id === subscriptionId);
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
  };

  const handleSend = async (preset?: string) => {
    const text = (preset ?? draft).trim();
    if (sending || (!text && !pendingImage)) return;

    // 영수증은 한 장씩만 처리한다 — 이전 영수증의 선택 카드가 열려 있는 채로
    // 새 영수증을 보내면(별도 카드 2개가 동시에 열려) 계정 답장 가로채기가
    // 가장 최근 카드만 찾아서, 먼저 열린 카드는 답장으로 못 끝내는 사각지대가 생긴다.
    const openReceiptItem = messages.find(
      (row) => row.fromReceiptImage && !row.dismissed && !row.registered && !row.confirmed
    );
    if (openReceiptItem) {
      if (looksLikeAccountCancel(text)) {
        setMessages((prev) => [
          ...prev.map((row) => (row.id === openReceiptItem.id ? { ...row, dismissed: true } : row)),
          { id: nextId(), role: 'user', text },
          {
            id: nextId(),
            role: 'assistant',
            text: pendingImage
              ? '이전 영수증 처리를 취소했어요. 새 영수증을 다시 보내 주세요.'
              : '이전 영수증 처리를 취소했어요.',
          },
        ]);
        setDraft('');
        return;
      }
      if (pendingImage) {
        notify(
          '영수증은 한 장씩',
          '이전 영수증 처리를 먼저 끝내거나, "취소"라고 답장해서 취소하거나, "그대로 두기"로 닫은 뒤 다시 보내 주세요.'
        );
        return;
      }
    }

    const pendingAccountItem = [...messages].reverse().find(
      (row) => row.role === 'assistant' && row.awaitingAccount && !row.dismissed && !row.registered
    );
    if (pendingAccountItem?.extract && !pendingImage) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
      setDraft('');
      scrollToEnd();
      if (looksLikeAccountCancel(text)) {
        setMessages((prev) =>
          prev.map((row) => (row.id === pendingAccountItem.id ? { ...row, awaitingAccount: false } : row))
        );
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: '등록을 취소했어요.' }]);
        scrollToEnd();
        return;
      }
      if (looksLikeAccountDodge(text)) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: '계정을 알아야 어떤 구독인지 구분할 수 있어요. 이메일이나 아이디를 입력해 주세요.',
          },
        ]);
        scrollToEnd();
        return;
      }
      const merged = { ...pendingAccountItem.extract, account_id: text.trim() };
      const issue = duplicateAccountIssue(subscriptions, {
        name: merged.name,
        account_id: merged.account_id,
        preset_id: merged.preset_id,
      });
      if (issue) {
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: duplicateAccountMessage(issue) }]);
        scrollToEnd();
        return;
      }
      try {
        const created = await addSubscription({
          name: merged.name,
          amount: merged.amount,
          billing_cycle: merged.billing_cycle,
          category_id: merged.category_id,
          anchor_date: merged.anchor_date,
          next_payment_date: merged.next_payment_date ?? computeNextPaymentDate(merged.anchor_date, merged.billing_cycle),
          preset_id: merged.preset_id,
          is_active: true,
          account_id: merged.account_id,
        });
        if (!created) {
          notify('등록 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
          return;
        }
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
        scrollToEnd();
      } catch (error) {
        notify('등록 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
      }
      return;
    }

    await dismissOpenActions(text);

    const userMessage: ChatItem = {
      id: nextId(),
      role: 'user',
      text: text || undefined,
      imageUri: pendingImage?.uri,
      imageName: pendingImage?.fileName,
    };

    const history = messages
      .filter((item) => item.text)
      .slice(-8)
      .map((item) => ({
        role: item.role,
        content: item.text ?? '',
      }));

    setMessages((prev) => [...prev, userMessage]);
    setDraft('');
    const image = pendingImage;
    setPendingImage(null);
    setSending(true);
    scrollToEnd();

    try {
      const response = image
        ? await invokeClaude({
            mode: 'chat',
            text: text || '첨부한 결제 화면에서 구독 정보를 추출해 주세요.',
            image_base64: image.base64,
            media_type: claudeMediaType(image.mimeType, image.base64),
            history,
            categories: categories.map((item) => ({ name: item.name, key: item.key })),
            subscriptions: subscriptions.map((item) => ({
              id: item.id,
              name: item.name,
              amount: item.amount,
              billing_cycle: item.billing_cycle,
              is_active: item.is_active,
            })),
            briefing_context: briefingContextRef.current,
          })
        : await invokeAssistantTurn({
            text,
            history,
            categories: categories.map((item) => ({ name: item.name, key: item.key })),
            briefing_context: briefingContextRef.current,
          });

      const turn: AssistantTurnResponse | null = image ? null : (response as AssistantTurnResponse);

      const usageCheckin = resolveAssistantUsageCheckin(
        response.usage_checkin,
        text,
        subscriptions
      );
      const usageTarget = usageCheckin
        ? subscriptions.find((item) => item.id === usageCheckin.subscription_id)
        : undefined;

      const parsed = usageCheckin
        ? null
        : response.extract &&
            (response.action !== 'create' ||
              (Boolean(response.extract.billing_cycle) && Boolean(response.extract.anchor_date)))
          ? toParsedSubscription(response.extract, categories)
          : null;
      let manageAction = usageCheckin
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
        text: usageCheckin && usageTarget
          ? response.reply || `${usageTarget.name} 사용 여부를 이렇게 기록할까요?`
          : response.reply,
        pendingActionId: turn?.pending_action_id ?? undefined,
        sessionVersion: turn?.session_version,
        expiresAt: turn?.expires_at ?? undefined,
      };

      const listed = isListLikeAssistantIntent(turn?.intent) && !usageCheckin && !parsed && !manageAction
        ? resolveRankedSubscriptions(turn?.ranked_subscription_ids, subscriptions)
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
          ? subscriptions.find((item) => item.id === response.subscription_id)
          : undefined;

      const candidatesFromIds = response.candidate_ids
        ? response.candidate_ids
            .map((id) => subscriptions.find((item) => item.id === id))
            .filter((item): item is Subscription => Boolean(item))
        : [];

      // 영수증 인식(claude-proxy)은 이름이 겹치는지만 알려준다 — 새 등록인지 기존
      // 구독을 고치려는 것인지는 캡션 키워드로 추측하지 않고, 텍스트 대화의
      // duplicateCreate 선택 카드("기존 구독 변경" / "별도로 추가" / "그대로 두기")를
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
            ? mergeExtractIntoSubscription(target, response.extract, categories)
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
              ? mergeExtractIntoSubscription(only, response.extract, categories)
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
      await fetchSubscriptions();
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: error instanceof Error ? error.message : 'AI 요청에 실패했습니다.',
        },
      ]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  };

  const canSend = !sending && (draft.trim().length > 0 || Boolean(pendingImage));

  // 확인 카드가 열려 있으면 다른 명령을 권하지 않는다. 사용자가 무엇에 답해야 하는지 흐려진다.
  const lastMessage = messages[messages.length - 1];
  const lastHasOpenCard = Boolean(
    lastMessage &&
      lastMessage.role === 'assistant' &&
      !lastMessage.dismissed &&
      !lastMessage.confirmed &&
      (lastMessage.action || lastMessage.candidates?.length || lastMessage.duplicateCreate ||
        lastMessage.awaitingSkip || lastMessage.usageCheckin || lastMessage.lifecycleUpdate ||
        lastMessage.pendingCancel || lastMessage.cancelGuide)
  );
  const suggestions =
    sending || !lastMessage || lastMessage.role !== 'assistant' || lastHasOpenCard
      ? []
      : messages.some((item) => item.role === 'user')
      ? followUpSuggestions(lastMessage.intent)
      : STARTER_SUGGESTIONS;

  return (
    <ScreenShell>
      <ScreenNav
        title="AI 비서"
        subtitle="구독을 말로 등록하거나 물어보세요"
        showBack={!hideBack}
        right={
          <Pressable
            onPress={() => void handleRestartChat()}
            accessibilityLabel="대화를 처음부터 다시 시작"
            hitSlop={8}>
            <Text style={[styles.resetLabel, { color: colors.text }]}>초기화</Text>
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled">
          {messages.map((item) =>
            item.role === 'user' ? (
              <View key={item.id} style={styles.userCol}>
                {item.imageUri ? (
                  <View style={styles.imageWrap}>
                    <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="cover" />
                    {item.imageName ? (
                      <View style={styles.captionBar}>
                        <Text style={styles.caption} numberOfLines={1}>
                          {item.imageName}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {item.text ? (
                  <View style={[styles.userBubble, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.userText, { color: colors.primaryText }]}>{item.text}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View key={item.id} style={styles.botCol}>
                {item.text ? (
                  <View style={[styles.botBubble, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text style={[styles.botText, { color: colors.text }]}>
                      {breakChatSentences(stripChatMarkdown(item.text))}
                    </Text>
                  </View>
                ) : null}
                {item.categoryCandidates && !item.dismissed ? (
                  <SuggestionChips
                    suggestions={item.categoryCandidates}
                    disabled={sending}
                    onSelect={(name) => void handleSend(`${name} 카테고리 보여줘`)}
                  />
                ) : null}
                {item.paymentInstrumentRequest && !item.dismissed ? (
                  <SuggestionChips
                    suggestions={['계좌', '신용카드', '체크카드']}
                    disabled={sending}
                    onSelect={(label) => {
                      setMessages((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row))
                      );
                      const kind = label === '계좌' ? 'bank' : 'card';
                      const cardType = label === '신용카드' ? 'credit' : label === '체크카드' ? 'check' : null;
                      const query = new URLSearchParams({ autoAdd: '1', kind });
                      if (cardType) query.set('cardType', cardType);
                      router.push(`/payment-methods?${query.toString()}` as Href);
                    }}
                  />
                ) : null}
                {item.paymentInstrumentSaved && !item.dismissed ? (
                  <View style={[styles.pmSavedCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text style={[styles.pmSavedTitle, { color: colors.text }]} numberOfLines={1}>
                      {item.paymentInstrumentSaved.name}
                    </Text>
                    <Text style={[styles.pmSavedMeta, { color: colors.muted }]}>
                      {item.paymentInstrumentSaved.institution}
                      {item.paymentInstrumentSaved.cardType
                        ? ` · ${item.paymentInstrumentSaved.cardType === 'credit' ? '신용카드' : '체크카드'}`
                        : item.paymentInstrumentSaved.kind === 'bank'
                          ? ' · 계좌'
                          : ''}
                      {' · '}
                      {item.paymentInstrumentSaved.last4}
                    </Text>
                    <View style={styles.pmSavedActions}>
                      <Pressable
                        onPress={() => {
                          setMessages((prev) => [
                            ...prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row)),
                            {
                              id: nextId(),
                              role: 'assistant',
                              text: '어떤 결제수단을 추가할까요? 계좌, 신용카드, 체크카드 중에 골라 주세요.',
                              paymentInstrumentRequest: true,
                            },
                          ]);
                        }}
                        style={[styles.pmSavedBtn, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.pmSavedBtnLabel, { color: colors.primary }]}>+ 추가</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setMessages((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, dismissed: true } : row))
                          )
                        }
                        style={[styles.pmSavedBtn, { borderWidth: 1, borderColor: colors.border }]}>
                        <Text style={[styles.pmSavedBtnLabel, { color: colors.muted }]}>그만하기</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {item.listed && item.listed.length > 0 ? (
                  <View style={[styles.listedBlock, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    {item.listed.map((row, index) => (
                      <View
                        key={row.id}
                        style={[
                          styles.listedRow,
                          {
                            borderBottomColor: colors.border,
                            borderBottomWidth: index === item.listed!.length - 1 ? 0 : StyleSheet.hairlineWidth,
                          },
                        ]}>
                        <Text style={[styles.listedName, { color: colors.text }]} numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text style={[styles.listedAmount, { color: colors.text }]}>
                          {formatCurrency(row.amount)}
                        </Text>
                        <Text style={[styles.listedDate, { color: colors.muted }]}>
                          {formatShortDate(row.next_payment_date)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {item.extract && !item.dismissed ? (
                  <ChatInlineCard
                    parsed={item.extract}
                    registered={item.registered}
                    editedViaModal={item.editedViaModal}
                    nameNeedsReview={item.nameNeedsReview}
                    onRegister={() => handleRegister(item.id, item.extract!)}
                    onEdit={() => handleEdit(item)}
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
                    onAskGuide={() => void handleSend(`${rec.name} 해지 방법 알려줘`)}
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
                      previousAmount={item.previousAmount}
                      confirmed={item.confirmed}
                      expired={isAssistantActionExpired(item.expiresAt)}
                      onConfirm={() =>
                        handleConfirmAction(item.id, item.action!, item.subscriptionId!, item.preview!)
                      }
                      onSkip={() => void handleSkipAction(item.id)}
                    />
                    {item.candidates && item.candidates.length > 1 && !item.confirmed ? (
                      <Pressable onPress={() => handleReselect(item.id)}>
                        <Text style={[styles.reselect, { color: colors.primary }]}>
                          다른 구독이었나요? 다시 고르기
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
                {item.candidates && item.candidates.length > 0 && !item.candidatesResolved && !item.dismissed ? (
                  <View style={styles.candidateBlock}>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                      showsHorizontalScrollIndicator={false}
                      style={styles.candidateScroll}
                      contentContainerStyle={styles.candidateRow}>
                      {item.candidates.map((candidate) => (
                        <Pressable
                          key={candidate.id}
                          onPress={() => handleSelectCandidate(item.id, candidate)}
                          style={[
                            styles.candidateCard,
                            { borderColor: colors.border, backgroundColor: colors.surface },
                          ]}>
                          <Text style={[styles.candidateName, { color: colors.text }]} numberOfLines={1}>
                            {candidate.name}
                          </Text>
                          {candidateDetailLines(candidate).map((line, index) => (
                            <Text
                              key={`${candidate.id}-${index}`}
                              style={[styles.candidateSub, { color: colors.muted }]}
                              numberOfLines={2}>
                              {line}
                            </Text>
                          ))}
                        </Pressable>
                      ))}
                    </ScrollView>
                    {item.duplicateCreate ? (
                      /* ChatGPT 수정: 중복 등록은 파괴적인 삭제 없이 세 가지 명시적 선택만 제공한다. */
                      <View style={styles.choiceRow}>
                        {item.candidates?.length === 1 ? (
                          <Pressable
                            onPress={() => handleSelectCandidate(item.id, item.candidates![0])}
                            style={[styles.choiceChip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                            <Text style={[styles.candidateName, { color: colors.text }]}>기존 구독 변경</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          onPress={() => {
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
                            void handleSend('별도 구독');
                          }}
                          style={[styles.choiceChip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                          <Text style={[styles.candidateName, { color: colors.text }]}>별도로 추가</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleSkipAction(item.id)}
                          style={[styles.choiceChip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                          <Text style={[styles.candidateName, { color: colors.text }]}>그대로 두기</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => void handleSkipAction(item.id)} hitSlop={8}>
                        <Text style={[styles.reselect, { color: colors.muted }]}>대화 이어가기</Text>
                      </Pressable>
                    )}
                  </View>
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
                          onChanged={() => fetchSubscriptions()}
                          onDeleteFromList={(subId) => handleDeleteGuideTarget(item.id, subId)}
                        />
                      );
                    })()
                  : null}
                {item.pendingCancel && !item.dismissed && item.text?.includes('앱 목록에서 지울까요') ? (
                  <View style={styles.candidateBlock}>
                    <View style={styles.candidateRow}>
                      <Pressable
                        onPress={() => handlePickCancelIntent(item.id, true)}
                        style={[
                          styles.candidateChip,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                        ]}>
                        <Text style={[styles.candidateName, { color: colors.text }]}>해지 방법 안내</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handlePickCancelIntent(item.id, false)}
                        style={[
                          styles.candidateChip,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                        ]}>
                        <Text style={[styles.candidateName, { color: colors.text }]}>목록에서 삭제</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={() => void handleSkipAction(item.id)} hitSlop={8}>
                      <Text style={[styles.reselect, { color: colors.muted }]}>대화 이어가기</Text>
                    </Pressable>
                  </View>
                ) : null}
                {item.awaitingSkip && !item.dismissed && !item.confirmed ? (
                  <Pressable onPress={() => void handleSkipAction(item.id)} hitSlop={8}>
                    <Text style={[styles.reselect, { color: colors.muted }]}>대화 이어가기</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          )}
          <SuggestionChips suggestions={suggestions} disabled={sending} onSelect={(text) => void handleSend(text)} />
          {sending ? (
            <View style={styles.botCol}>
              <View style={[styles.botBubble, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: hideBack ? 12 : Math.max(insets.bottom, 12),
            },
          ]}>
          {pendingImage ? (
            <View style={[styles.pending, { backgroundColor: colors.background }]}>
              <Text style={[styles.pendingName, { color: colors.text }]} numberOfLines={1}>
                {pendingImage.fileName}
              </Text>
              <Pressable onPress={() => setPendingImage(null)}>
                <Text style={[styles.pendingClear, { color: colors.muted }]}>취소</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composerRow}>
            <Pressable
              onPress={handleAttach}
              style={[styles.attach, { borderColor: colors.border }]}
              accessibilityLabel="이미지 첨부">
              <SymbolView
                name={{ ios: 'photo', android: 'image', web: 'image' }}
                tintColor={colors.muted}
                size={18}
              />
            </Pressable>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="메시지를 입력하세요"
              placeholderTextColor={colors.muted}
              style={[styles.field, { backgroundColor: colors.background, color: colors.text }]}
              onSubmitEditing={() => void handleSend()}
              returnKeyType="send"
            />
            <Pressable
              onPress={() => void handleSend()}
              disabled={!canSend}
              style={[styles.send, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.45 }]}
              accessibilityLabel="전송">
              <SymbolView
                name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                tintColor={colors.primaryText}
                size={18}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  pmSavedCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  pmSavedTitle: {
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
  pmSavedMeta: {
    fontSize: 12.5,
    fontFamily: fonts.sansMedium,
  },
  pmSavedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  pmSavedBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pmSavedBtnLabel: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  resetLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  thread: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  threadContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  botCol: {
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: 320,
  },
  userCol: {
    alignItems: 'flex-end',
    gap: 8,
    alignSelf: 'stretch',
  },
  botBubble: {
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listedBlock: {
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listedName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  listedAmount: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  listedDate: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  botText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.sans,
  },
  userBubble: {
    maxWidth: 250,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.sans,
  },
  imageWrap: {
    width: 140,
    height: 176,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  image: {
    width: 140,
    height: 176,
  },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 32,
    backgroundColor: 'rgba(17,24,39,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  caption: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: fonts.sansMedium,
  },
  candidateBlock: {
    alignSelf: 'stretch',
    flexGrow: 0,
    gap: 8,
  },
  candidateScroll: {
    flexGrow: 0,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingRight: 4,
  },
  candidateCard: {
    width: 204,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  candidateChip: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  choiceBlock: {
    gap: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  candidateName: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  candidateSub: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.sansMedium,
  },
  reselect: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    minHeight: 72,
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  pendingName: {
    flex: 1,
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  pendingClear: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    marginLeft: 8,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attach: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function ChatRedirect() {
  return <Redirect href="/(tabs)/assistant" />;
}
