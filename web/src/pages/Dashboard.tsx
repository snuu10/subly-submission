import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import aiAssistantFab from '../../../assets/images/ai-assistant-fab.png';
import { AppSidebar, type DashboardView } from '@/components/AppSidebar';
import { BrandLockup } from '@/components/BrandLockup';
import { AssistantPanel } from '@/components/AssistantPanel';
import { HeaderMenus } from '@/components/HeaderMenus';
import { DashboardWidgetManager } from '@/components/dashboard/DashboardWidgetManager';
import { DashboardWidgetRemovedToast } from '@/components/dashboard/DashboardWidgetRemovedToast';
import { DashboardWidgetResetDialog } from '@/components/dashboard/DashboardWidgetResetDialog';
import {
  SortableDashboardGrid,
  type SortableDashboardWidget,
} from '@/components/dashboard/SortableDashboardGrid';
import { ReceiptOcrModal, type PendingReceipt } from '@/components/ReceiptOcrModal';
import { SubscriptionForm } from '@/components/SubscriptionForm';
import { BriefingWidget, type AssistantLaunch } from '@/components/widgets/BriefingWidget';
import { CategoryOrderWidget } from '@/components/widgets/CategoryOrderWidget';
import { CategoryWidget } from '@/components/widgets/CategoryWidget';
import { InsightsWidget } from '@/components/widgets/InsightsWidget';
import { MixWidget } from '@/components/widgets/MixWidget';
import { NotificationWidget } from '@/components/widgets/NotificationWidget';
import { SpendWidget } from '@/components/widgets/SpendWidget';
import { SubscriptionListWidget } from '@/components/widgets/SubscriptionListWidget';
import { UpcomingWidget } from '@/components/widgets/UpcomingWidget';
import { UsageHistoryWidget } from '@/components/widgets/UsageHistoryWidget';
import { PaymentInstrumentListWidget } from '@/components/widgets/PaymentInstrumentListWidget';
import { PaymentMethodsWidget } from '@/components/widgets/PaymentMethodsWidget';
import { PaymentStatusWidget } from '@/components/widgets/PaymentStatusWidget';
import { AccountSettingsWidget } from '@/components/widgets/AccountSettingsWidget';
import { AnnouncementDetailModal } from '@/components/AnnouncementDetailModal';
import { AnnouncementsListWidget } from '@/components/widgets/AnnouncementsListWidget';
import {
  countUnreadRecent,
  fetchAnnouncements,
  getMyAnnouncementLastReadAt,
  markAnnouncementsRead,
  type Announcement,
} from '@/lib/announcements';
import { PaymentInstrumentModal } from '@/components/PaymentInstrumentModal';
import { signOut } from '@/lib/auth';
import { saveMyDashboardWidgetPreferences } from '@/lib/dashboard-widget-preferences';
import {
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_HIDDEN_IDS,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  isDeletableDashboardWidget,
  mergeVisibleWidgetOrder,
  normalizeDashboardWidgetPreferences,
  visibleDashboardWidgetIds,
  type DashboardWidgetId,
  type DashboardWidgetPreferences,
} from '@/lib/dashboard-widgets';
import {
  getCategoryTotals,
  getCurrentMonthPaymentBreakdown,
  getMonthlyTotal,
  getProjectedMonths,
  getSpendInsights,
  getStatusMix,
  getUpcomingSubscriptions,
} from '@/lib/calc';
import {
  createPaymentInstrument,
  createSubscription,
  deletePaymentInstrument,
  deleteSubscription,
  fetchDashboardData,
  subscribeDashboard,
  toggleSubscriptionActive,
  updatePaymentInstrument,
  updateSubscription,
  type SubscriptionWriteInput,
} from '@/lib/data';
import { advanceSubscriptionLifecycle } from '@/lib/lifecycle';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
  type AppNotification,
} from '@/lib/notifications';
import type { PaymentInstrument, PaymentInstrumentWrite } from '@/types/payment-instrument';
import { reorderCategoryChips } from '@/lib/category-chip-order';
import { saveReceiptParse } from '@/lib/receipts';
import type { ParsedSubscription } from '@/types/extract';
import type { Category, Subscription } from '@/types';

const VIEW_TITLE: Record<DashboardView, string> = {
  dashboard: '대시보드',
  paymentStatus: '결제 현황',
  list: '구독 목록',
  upcoming: '결제 예정',
  usageHistory: '사용 기록',
  categories: '카테고리',
  banks: '은행',
  cards: '카드',
  settings: '설정',
  announcements: '공지사항',
};

function isDesktopWidth(): boolean {
  return window.matchMedia('(min-width: 768px)').matches;
}

const DEFAULT_WIDGET_PREFERENCES = normalizeDashboardWidgetPreferences(
  [],
  DEFAULT_DASHBOARD_HIDDEN_IDS
);

export function DashboardPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // ChatGPT 수정: 정확한 미확인 수와 조회 순서를 목록과 별도로 관리한다.
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const notificationRequest = useRef(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentInstruments, setPaymentInstruments] = useState<PaymentInstrument[]>([]);
  const [instrumentSaving, setInstrumentSaving] = useState(false);
  const [webChipOrderIds, setWebChipOrderIds] = useState<string[] | null>(null);
  const [chipOrderSaving, setChipOrderSaving] = useState(false);
  const [widgetPreferences, setWidgetPreferences] = useState<DashboardWidgetPreferences>(
    DEFAULT_WIDGET_PREFERENCES
  );
  const [widgetManagerOpen, setWidgetManagerOpen] = useState(false);
  const [widgetResetOpen, setWidgetResetOpen] = useState(false);
  const [removedWidgetId, setRemovedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [widgetPreferencesSaving, setWidgetPreferencesSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>();
  const [assistantLaunch, setAssistantLaunch] = useState<AssistantLaunch | undefined>();
  const [briefingEpoch, setBriefingEpoch] = useState(0);
  const [instrumentModal, setInstrumentModal] = useState<{
    editing: PaymentInstrument | null;
  } | null>(null);
  const [announcementModal, setAnnouncementModal] = useState<Announcement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [formDraft, setFormDraft] = useState<ParsedSubscription | null>(null);
  const [formFromOcr, setFormFromOcr] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<PendingReceipt | null>(null);
  const [view, setView] = useState<DashboardView>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : isDesktopWidth()
  );
  const pendingEditSavedRef = useRef<((saved: Subscription) => void) | null>(null);
  const committedWidgetPreferencesRef = useRef(DEFAULT_WIDGET_PREFERENCES);
  const pendingWidgetPreferencesRef = useRef<DashboardWidgetPreferences | null>(null);
  const widgetSaveActiveRef = useRef(false);
  const widgetAddButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const data = await fetchDashboardData();
    setSubscriptions(data.subscriptions);
    setCategories(data.categories);
    setPaymentInstruments(data.paymentInstruments);
    setWebChipOrderIds(data.webChipOrderIds);
    if (!widgetSaveActiveRef.current) {
      setWidgetPreferences(data.dashboardWidgetPreferences);
      committedWidgetPreferencesRef.current = data.dashboardWidgetPreferences;
    }
    setLastUpdated(new Date());
    setError(null);
    return data.subscriptions;
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    load()
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : '데이터를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubscribe = subscribeDashboard(() => {
      void load().catch(() => undefined);
    });

    function onFocus() {
      void load().catch(() => undefined);
    }
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const loadNotifications = useCallback(async () => {
    const request = ++notificationRequest.current;
    const snapshot = await fetchNotifications();
    if (request !== notificationRequest.current) return;
    setNotifications(snapshot.notifications);
    setUnreadNotificationCount(snapshot.unreadCount);
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const [{ items }, lastReadAt] = await Promise.all([
      fetchAnnouncements(3, 0),
      getMyAnnouncementLastReadAt(),
    ]);
    setAnnouncements(items);
    setAnnouncementUnreadCount(countUnreadRecent(items, lastReadAt));
  }, []);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  useEffect(() => {
    // ChatGPT 수정: 포커스 복귀/재연결 시 전체 수를 다시 맞춘다.
    const reload = () => { void loadNotifications().catch(() => setError('알림을 불러오지 못했습니다.')); };
    reload();
    const unsubscribe = subscribeNotifications(reload);
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    return () => {
      ++notificationRequest.current;
      unsubscribe();
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
    };
  }, [loadNotifications]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    function onChange() {
      const desktop = media.matches;
      setIsDesktop(desktop);
      if (!desktop) setSidebarOpen(false);
    }
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function openAssistant(launch?: AssistantLaunch | string) {
    const next = typeof launch === 'string' ? { prompt: launch, entrySource: 'home' } : launch;
    setAssistantLaunch(next);
    setAssistantPrompt(next?.prompt);
    setAssistantOpen(true);
    if (!isDesktop) setSidebarOpen(false);
  }

  const closeWidgetManager = useCallback(() => {
    if (!widgetSaveActiveRef.current) setWidgetManagerOpen(false);
  }, []);

  const closeWidgetReset = useCallback(() => {
    if (!widgetSaveActiveRef.current) setWidgetResetOpen(false);
  }, []);

  const closeRemovedWidgetToast = useCallback(() => setRemovedWidgetId(null), []);

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setFormDraft(null);
    setFormFromOcr(false);
    setPendingReceipt(null);
    pendingEditSavedRef.current = null;
  }

  function openAdd(draft?: ParsedSubscription, fromOcr = false) {
    setEditing(null);
    setFormDraft(draft ?? null);
    setFormFromOcr(fromOcr);
    if (!fromOcr) setPendingReceipt(null);
    setFormOpen(true);
    if (!isDesktop) setSidebarOpen(false);
  }

  function openOcr() {
    setFormOpen(false);
    setEditing(null);
    setFormDraft(null);
    setFormFromOcr(false);
    setPendingReceipt(null);
    setOcrOpen(true);
    if (!isDesktop) setSidebarOpen(false);
  }

  function openEdit(item: Subscription) {
    setFormDraft(null);
    setFormFromOcr(false);
    setPendingReceipt(null);
    setEditing(item);
    setFormOpen(true);
  }

  async function handleSave(input: SubscriptionWriteInput) {
    const editingId = editing?.id;
    let createdId: string | undefined;
    if (editing) {
      await updateSubscription(editing.id, input, subscriptions);
    } else {
      const created = await createSubscription(input, subscriptions);
      createdId = created.id;
      if (pendingReceipt) {
        await saveReceiptParse(pendingReceipt.uploadId, pendingReceipt.extract, created.id).catch(
          () => undefined
        );
        setPendingReceipt(null);
      }
    }
    const list = await load();
    const savedId = editingId ?? createdId;
    const saved = savedId ? list.find((item) => item.id === savedId) : undefined;
    if (saved && pendingEditSavedRef.current) {
      pendingEditSavedRef.current(saved);
      pendingEditSavedRef.current = null;
    }
  }

  async function handleDeleteFromForm() {
    if (!editing) return;
    await deleteSubscription(editing.id);
    await load();
  }

  async function handleToggle(item: Subscription) {
    try {
      const nextActive = !item.is_active;
      // 종료/종료 예정 상태에서 "다시 시작"하면 lifecycle_status도 active로 되돌려야
      // 목록의 상태 필터(종료 등)에 계속 남는 문제가 생기지 않는다.
      const needsLifecycleReset =
        nextActive && item.lifecycle_status != null && item.lifecycle_status !== 'active';
      if (needsLifecycleReset) {
        const result = await advanceSubscriptionLifecycle(item.id, 'active');
        if (!result.ok) throw new Error(result.message);
      } else {
        await toggleSubscriptionActive(item.id, nextActive);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상태를 바꾸지 못했습니다.');
    }
  }

  async function handleDelete(item: Subscription) {
    if (!window.confirm(`${item.name}을(를) 삭제할까요?`)) return;
    try {
      await deleteSubscription(item.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '삭제하지 못했습니다.');
    }
  }

  async function handleReorderChips(ids: string[]) {
    const previous = webChipOrderIds;
    setWebChipOrderIds(ids);
    setChipOrderSaving(true);
    try {
      const result = await reorderCategoryChips('web', ids);
      if (!result.ok) {
        setWebChipOrderIds(previous);
        setError(result.message || '순서를 저장하지 못했습니다.');
        return;
      }
      setWebChipOrderIds(result.webIds);
    } finally {
      setChipOrderSaving(false);
    }
  }

  function queueWidgetPreferences(next: DashboardWidgetPreferences) {
    setWidgetPreferences(next);
    pendingWidgetPreferencesRef.current = next;
    if (widgetSaveActiveRef.current) return;
    widgetSaveActiveRef.current = true;
    setWidgetPreferencesSaving(true);
    void flushWidgetPreferences();
  }

  async function flushWidgetPreferences() {
    while (pendingWidgetPreferencesRef.current) {
      const next = pendingWidgetPreferencesRef.current;
      pendingWidgetPreferencesRef.current = null;
      const result = await saveMyDashboardWidgetPreferences(next.orderIds, next.hiddenIds);
      if (!result.ok) {
        if (!pendingWidgetPreferencesRef.current) {
          setWidgetPreferences(committedWidgetPreferencesRef.current);
        }
        setError(result.message || '위젯 설정을 저장하지 못했습니다. 다시 시도해 주세요.');
        continue;
      }
      const saved = { orderIds: result.orderIds, hiddenIds: result.hiddenIds };
      committedWidgetPreferencesRef.current = saved;
      if (!pendingWidgetPreferencesRef.current) setWidgetPreferences(saved);
      setError(null);
    }
    widgetSaveActiveRef.current = false;
    setWidgetPreferencesSaving(false);
  }

  function handleReorderWidgets(visibleIds: DashboardWidgetId[]) {
    queueWidgetPreferences({
      ...widgetPreferences,
      orderIds: mergeVisibleWidgetOrder(
        widgetPreferences.orderIds,
        widgetPreferences.hiddenIds,
        visibleIds
      ),
    });
  }

  function handleApplyWidgetVisibility(hiddenIds: DashboardWidgetId[]) {
    const removed = hiddenIds.find((id) => !widgetPreferences.hiddenIds.includes(id));
    queueWidgetPreferences({ ...widgetPreferences, hiddenIds });
    setWidgetManagerOpen(false);
    if (removed) setRemovedWidgetId(removed);
  }

  function handleResetWidgets() {
    queueWidgetPreferences({
      orderIds: [...DEFAULT_DASHBOARD_WIDGET_ORDER],
      hiddenIds: [...DEFAULT_DASHBOARD_HIDDEN_IDS],
    });
    setWidgetResetOpen(false);
    setRemovedWidgetId(null);
  }

  function handleDeleteWidget(id: DashboardWidgetId) {
    if (!isDeletableDashboardWidget(id) || widgetPreferences.hiddenIds.includes(id)) return;
    queueWidgetPreferences({
      ...widgetPreferences,
      hiddenIds: [...widgetPreferences.hiddenIds, id],
    });
    setRemovedWidgetId(id);
    window.requestAnimationFrame(() => widgetAddButtonRef.current?.focus());
  }

  async function handleSaveInstrument(input: PaymentInstrumentWrite, id?: string) {
    setInstrumentSaving(true);
    try {
      if (id) await updatePaymentInstrument(id, input);
      else await createPaymentInstrument(input);
      await load();
    } finally {
      setInstrumentSaving(false);
    }
  }

  async function handleDeleteInstrument(id: string) {
    await deletePaymentInstrument(id);
    await load();
  }

  async function handleSelectNotification(item: AppNotification) {
    if (!item.read_at) {
      // ChatGPT 수정: DB 성공 후 재조회하여 낙관적 갱신 실패/배지 오차를 방지한다.
      ++notificationRequest.current;
      try {
        await markNotificationRead(item.id);
        await loadNotifications();
      } catch {
        setError('읽음 처리에 실패했습니다. 다시 시도해주세요.');
        return;
      }
    }
    const target = item.subscription_id
      ? subscriptions.find((row) => row.id === item.subscription_id)
      : undefined;
    if (target) openEdit(target);
  }

  async function handleMarkAllNotificationsRead() {
    // ChatGPT 수정: 목록 밖 미확인 알림까지 처리하고 서버 집계값으로 갱신한다.
    ++notificationRequest.current;
    try {
      await markAllNotificationsRead();
      await loadNotifications();
    } catch {
      setError('읽음 처리에 실패했습니다. 다시 시도해주세요.');
    }
  }

  async function handleSelectAnnouncement(item: Announcement) {
    setAnnouncementModal(item);
  }

  async function handleMarkAllRead() {
    await Promise.all([
      announcementUnreadCount > 0 ? markAnnouncementsRead() : Promise.resolve(),
      unreadNotificationCount > 0 ? markAllNotificationsRead() : Promise.resolve(),
    ]);
    setAnnouncementUnreadCount(0);
    await loadNotifications();
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
      setBriefingEpoch((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setRefreshing(false);
    }
  }

  const monthlyTotal = getMonthlyTotal(subscriptions);
  const monthPayment = getCurrentMonthPaymentBreakdown(subscriptions);
  const upcoming = getUpcomingSubscriptions(subscriptions, 7);
  const categoryRows = getCategoryTotals(subscriptions, categories);
  const insights = getSpendInsights(subscriptions, categories);
  const projected = getProjectedMonths(subscriptions);
  const statusRows = getStatusMix(subscriptions);
  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    insights: (
      <InsightsWidget insights={insights} refreshKey={briefingEpoch} onAsk={openAssistant} />
    ),
    briefing: (
      <BriefingWidget
        subscriptions={subscriptions}
        categories={categories}
        refreshKey={briefingEpoch}
        onAsk={openAssistant}
        onOpenList={() => setView('list')}
        onEdit={openEdit}
        onReload={async () => {
          await load();
        }}
      />
    ),
    category: <CategoryWidget rows={categoryRows} />,
    spend: (
      <SpendWidget
        monthlyTotal={monthlyTotal}
        monthPaymentTotal={monthPayment.expectedTotal}
        nextMonthPaymentTotal={projected[1]?.amount ?? 0}
      />
    ),
    upcoming: <UpcomingWidget items={upcoming} onSelect={openEdit} />,
    mix: <MixWidget rows={categoryRows} statusRows={statusRows} />,
    subscriptions: (
      <SubscriptionListWidget
        compact
        items={subscriptions}
        categories={categories}
        chipOrderIds={webChipOrderIds}
        onAdd={() => openAdd()}
        onEdit={openEdit}
        onToggle={(item) => void handleToggle(item)}
        onDelete={(item) => void handleDelete(item)}
      />
    ),
    'payment-instruments': (
      <PaymentInstrumentListWidget
        instruments={paymentInstruments}
        onAdd={() => setInstrumentModal({ editing: null })}
        onSelect={(item) => setInstrumentModal({ editing: item })}
      />
    ),
    notifications: (
      <NotificationWidget
        notifications={notifications}
        onSelect={(item) => void handleSelectNotification(item)}
        onMarkAllRead={() => void handleMarkAllNotificationsRead()}
      />
    ),
  };
  const visibleWidgetIds = visibleDashboardWidgetIds(widgetPreferences);
  const sortableWidgets: SortableDashboardWidget[] = visibleWidgetIds.map((id) => ({
    id,
    title: DASHBOARD_WIDGETS.find((widget) => widget.id === id)?.title ?? id,
    deletable: isDeletableDashboardWidget(id),
    content: widgetContent[id],
  }));
  const removedWidgetTitle = removedWidgetId
    ? DASHBOARD_WIDGETS.find((widget) => widget.id === removedWidgetId)?.title
    : null;

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && !isDesktop ? (
        <button
          type="button"
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div
        className={`${
          isDesktop ? 'sticky top-0 h-screen' : 'fixed inset-y-0 left-0 z-30 h-full'
        } ${sidebarOpen ? '' : 'pointer-events-none'}`}
      >
        <AppSidebar
          open={sidebarOpen}
          view={view}
          onNavigate={setView}
          onAdd={() => openAdd()}
          onAssistant={() => openAssistant()}
          onCloseMobile={() => {
            if (!isDesktop) setSidebarOpen(false);
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <button
                type="button"
                aria-label={sidebarOpen ? '메뉴 닫기' : '메뉴 열기'}
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent hover:text-text sm:size-9"
              >
                <HamburgerIcon />
              </button>
              <div className="min-w-0">
                <BrandLockup />
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <h1 className="text-base font-extrabold text-text sm:text-xl">{VIEW_TITLE[view]}</h1>
                  {view === 'dashboard' ? (
                    <>
                      <HeaderDirectButton onClick={() => openAdd()} icon={<GridIcon />} label="구독 추가" />
                      <HeaderDirectButton
                        onClick={() => setInstrumentModal({ editing: null })}
                        icon={<CardIcon />}
                        label="결제수단 추가"
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex w-full items-center justify-between gap-1 border-t border-border pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
              <HeaderMenus
                notifications={notifications}
                unreadCount={unreadNotificationCount}
                onSelectNotification={(item) => void handleSelectNotification(item)}
                announcements={announcements}
                announcementUnreadCount={announcementUnreadCount}
                onSelectAnnouncement={(item) => void handleSelectAnnouncement(item)}
                onViewAllAnnouncements={() => setView('announcements')}
                onOpenSettings={() => setView('settings')}
                onMarkAllRead={() => void handleMarkAllRead()}
                lastUpdated={lastUpdated}
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                onAdd={() => openAdd()}
              />
              <a
                href="/releases"
                aria-label="Android 앱 다운로드"
                title="Android 앱 다운로드"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent hover:text-text sm:size-9"
              >
                <DownloadIcon />
              </a>
              <button
                type="button"
                onClick={() => openAssistant()}
                className="shrink-0 rounded-xl bg-primary px-2.5 py-1.5 text-xs font-semibold text-white sm:px-3 sm:py-2 sm:text-sm"
              >
                비서
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="shrink-0 rounded-xl border border-border px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-text sm:px-3 sm:py-2 sm:text-sm"
              >
                로그아웃
              </button>
            </div>
          </div>
        </header>

        <main
          className={`mx-auto w-full flex-1 px-3 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6 ${
            view === 'dashboard'
              ? 'max-w-[1520px]'
              : view === 'paymentStatus'
                ? 'max-w-[1400px]'
                : 'max-w-[1200px]'
          }`}
        >
          {loading ? <p className="text-sm text-muted">불러오는 중…</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}

          {view === 'dashboard' && !loading ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
                  <GripHintIcon />
                  <span>위젯의 핸들을 드래그해 원하는 위치로 옮기세요.</span>
                  {widgetPreferencesSaving ? (
                    <span className="shrink-0 font-bold text-primary" role="status">
                      저장 중…
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    ref={widgetAddButtonRef}
                    type="button"
                    onClick={() => setWidgetManagerOpen(true)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-[#4338CA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <PlusIcon />
                    위젯 추가
                  </button>
                  <button
                    type="button"
                    disabled={widgetPreferencesSaving}
                    onClick={() => setWidgetResetOpen(true)}
                    className="min-h-10 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-bold text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-45"
                  >
                    위젯 초기화
                  </button>
                </div>
              </div>

              {sortableWidgets.length > 0 ? (
                <SortableDashboardGrid
                  widgets={sortableWidgets}
                  disabled={widgetPreferencesSaving || widgetManagerOpen}
                  onReorder={handleReorderWidgets}
                  onDelete={handleDeleteWidget}
                />
              ) : (
                <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-6 text-center">
                  <WidgetEmptyIcon />
                  <h2 className="mt-4 text-base font-extrabold text-text">표시 중인 위젯이 없어요</h2>
                  <p className="mt-1 text-sm text-muted">필요한 위젯을 다시 선택해 대시보드를 구성하세요.</p>
                  <button
                    type="button"
                    onClick={() => setWidgetManagerOpen(true)}
                    className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    + 위젯 추가
                  </button>
                </section>
              )}
            </div>
          ) : null}

          {view === 'paymentStatus' && !loading ? (
            <PaymentStatusWidget subscriptions={subscriptions} instruments={paymentInstruments} />
          ) : null}

          {view === 'list' && !loading ? (
            <SubscriptionListWidget
              items={subscriptions}
              categories={categories}
              chipOrderIds={webChipOrderIds}
              onEdit={openEdit}
              onToggle={(item) => void handleToggle(item)}
              onDelete={(item) => void handleDelete(item)}
            />
          ) : null}

          {view === 'upcoming' && !loading ? (
            <UpcomingWidget items={upcoming} onSelect={openEdit} />
          ) : null}

          {view === 'categories' && !loading ? (
            <CategoryOrderWidget
              categories={categories}
              chipOrderIds={webChipOrderIds}
              saving={chipOrderSaving}
              onReorder={(ids) => void handleReorderChips(ids)}
            />
          ) : null}

          {view === 'banks' && !loading ? (
            <PaymentMethodsWidget
              kind="bank"
              instruments={paymentInstruments}
              saving={instrumentSaving}
              onSave={(input, id) => handleSaveInstrument(input, id)}
              onDelete={(id) => handleDeleteInstrument(id)}
            />
          ) : null}

          {view === 'cards' && !loading ? (
            <PaymentMethodsWidget
              kind="card"
              instruments={paymentInstruments}
              saving={instrumentSaving}
              onSave={(input, id) => handleSaveInstrument(input, id)}
              onDelete={(id) => handleDeleteInstrument(id)}
            />
          ) : null}

          {view === 'settings' ? (
            <AccountSettingsWidget onOpenAnnouncements={() => setView('announcements')} />
          ) : null}
          {view === 'announcements' ? (
            <AnnouncementsListWidget onSelectAnnouncement={(item) => setAnnouncementModal(item)} />
          ) : null}

          {view === 'usageHistory' ? (
            <UsageHistoryWidget
              subscriptions={subscriptions}
              onOpenSubscription={(id) => {
                const hit = subscriptions.find((item) => item.id === id);
                if (hit) openEdit(hit);
                else window.alert('이 구독은 목록에 없어요.');
              }}
            />
          ) : null}
        </main>
      </div>

      <DashboardWidgetManager
        open={widgetManagerOpen}
        hiddenIds={widgetPreferences.hiddenIds}
        saving={widgetPreferencesSaving}
        onClose={closeWidgetManager}
        onApply={handleApplyWidgetVisibility}
      />

      <DashboardWidgetResetDialog
        open={widgetResetOpen}
        saving={widgetPreferencesSaving}
        onClose={closeWidgetReset}
        onReset={handleResetWidgets}
      />

      {removedWidgetTitle ? (
        <DashboardWidgetRemovedToast
          widgetTitle={removedWidgetTitle}
          onClose={closeRemovedWidgetToast}
        />
      ) : null}

      {ocrOpen ? (
        <ReceiptOcrModal
          categories={categories}
          onClose={() => setOcrOpen(false)}
          onExtracted={(parsed, pending) => {
            setOcrOpen(false);
            setPendingReceipt(pending);
            openAdd(parsed, true);
          }}
        />
      ) : null}

      {announcementModal ? (
        <AnnouncementDetailModal
          announcement={announcementModal}
          onClose={() => setAnnouncementModal(null)}
        />
      ) : null}

      {instrumentModal ? (
        <PaymentInstrumentModal
          editing={instrumentModal.editing}
          saving={instrumentSaving}
          onClose={() => setInstrumentModal(null)}
          onSave={handleSaveInstrument}
          onDelete={(id) => handleDeleteInstrument(id)}
        />
      ) : null}

      {formOpen ? (
        <SubscriptionForm
          categories={categories}
          subscriptions={subscriptions}
          paymentInstruments={paymentInstruments}
          editing={editing}
          draft={formDraft}
          fromOcr={formFromOcr}
          onClose={closeForm}
          onSave={handleSave}
          onDelete={editing ? handleDeleteFromForm : undefined}
          onReceipt={openOcr}
        />
      ) : null}

      <AssistantPanel
        open={assistantOpen}
        initialPrompt={assistantPrompt}
        launch={assistantLaunch}
        subscriptions={subscriptions}
        categories={categories}
        onReload={load}
        onUsageCheckinSaved={() => setBriefingEpoch((value) => value + 1)}
        onEditDraft={(parsed, subscriptionId, onSaved) => {
          pendingEditSavedRef.current = onSaved;
          if (subscriptionId) {
            const hit = subscriptions.find((item) => item.id === subscriptionId);
            if (hit) {
              openEdit(hit);
              return;
            }
            void load().then((list) => {
              const found = list.find((item) => item.id === subscriptionId);
              if (found) openEdit(found);
              else openAdd(parsed);
            });
            return;
          }
          openAdd(parsed);
        }}
        onClose={() => {
          setAssistantOpen(false);
          setAssistantPrompt(undefined);
          setAssistantLaunch(undefined);
        }}
      />

      {!assistantOpen ? (
        <button
          type="button"
          onClick={() => openAssistant()}
          aria-label="AI 비서 열기"
          title="AI 비서"
          className="fixed bottom-8 right-5 z-40 size-14 overflow-hidden rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-10 md:right-6"
        >
          <img src={aiAssistantFab} alt="" className="size-full" />
        </button>
      ) : null}
    </div>
  );
}

function HeaderDirectButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-xl border border-primary px-2 py-1 text-xs font-bold text-primary hover:bg-accent sm:px-3 sm:py-1.5"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GripHintIcon() {
  return (
    <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="16" cy="6" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WidgetEmptyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect x="5" y="5" width="12" height="12" rx="3" fill="#EEF2FF" stroke="#4F46E5" strokeWidth="1.5" />
      <rect x="23" y="5" width="12" height="12" rx="3" fill="#EEF2FF" stroke="#4F46E5" strokeWidth="1.5" />
      <rect x="5" y="23" width="12" height="12" rx="3" fill="#EEF2FF" stroke="#4F46E5" strokeWidth="1.5" />
      <path d="M24 29h10m-5-5v10" stroke="#4F46E5" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
